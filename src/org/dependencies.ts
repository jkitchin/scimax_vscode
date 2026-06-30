/**
 * TODO task dependencies (org-depend style, simplified).
 *
 * A task declares what it depends on with a single `:DEPENDS:` property holding
 * whitespace-separated `id:` links:
 *
 *   * TODO Write paper
 *     :PROPERTIES:
 *     :ID: paper-7f3a
 *     :DEPENDS: id:analysis-9b2 id:figures-4c1
 *     :END:
 *
 * Two behaviors are derived from that one edge:
 *   - BLOCKING (forward read): the task can't move to a DONE state until every
 *     dependency it points at is DONE.
 *   - TRIGGERING (reverse edge, indexed in the DB): when a task becomes DONE, any
 *     task that depends on it and is now fully unblocked is surfaced / promoted.
 *
 * A parent with `:ORDERED: t` additionally forces its direct children to be
 * completed top-to-bottom (pure structure, no ids needed).
 *
 * Dependency resolution is DB-backed (`dependencies` edge table + `getHeadingById`)
 * so it works across files. Results reflect the last indexed (saved) state.
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import {
    HeadingRecord,
    DependencyRecord,
    parseDependsIds,
    getPropCaseInsensitive,
} from '../database/scimaxDbCore';
import { getTodoStatesFromText } from './todoStates';

export const DEPENDS_PROPERTY = 'DEPENDS';
export const ORDERED_PROPERTY = 'ORDERED';

/** Done states recognized everywhere, regardless of a file's `#+TODO:` line. */
const DEFAULT_DONE_STATES = new Set(['DONE', 'CANCELLED', 'CANCELED']);

/** A dependency target and its resolved current state. */
export interface Blocker {
    /** Normalized target id (no `id:` prefix). */
    id: string;
    /** Whether the id resolved to an indexed heading. */
    found: boolean;
    title?: string;
    todoState?: string | null;
    filePath?: string;
    lineNumber?: number;
    /** True when this dependency is satisfied (target exists and is DONE). */
    satisfied: boolean;
}

/** Re-exported so callers parse `:DEPENDS:` values consistently. */
export function parseDepends(value: string | undefined): string[] {
    return value ? parseDependsIds(value) : [];
}

/**
 * Is `state` a DONE state? Uses the optional per-document done set when given,
 * always falling back to the universal defaults so cross-file targets resolve
 * even when we don't have the target file's workflow handy.
 */
export function isDoneStateName(
    state: string | null | undefined,
    doneStates?: Set<string>
): boolean {
    if (!state) return false;
    if (doneStates && doneStates.has(state)) return true;
    return DEFAULT_DONE_STATES.has(state);
}

// ---------------------------------------------------------------------------
// Editor helpers (live buffer)
// ---------------------------------------------------------------------------

/** Line number (0-based) of the heading enclosing `line`, or -1 if none. */
export function findEnclosingHeadingLine(document: vscode.TextDocument, line: number): number {
    for (let i = line; i >= 0; i--) {
        if (/^\*+\s+/.test(document.lineAt(i).text)) return i;
    }
    return -1;
}

/** Read a property (case-insensitive) from the drawer below a heading line. */
export function readHeadingProperty(
    document: vscode.TextDocument,
    headingLine: number,
    property: string
): string | undefined {
    const re = new RegExp(`^\\s*:${property}:\\s*(.+?)\\s*$`, 'i');
    const last = Math.min(headingLine + 60, document.lineCount - 1);
    for (let i = headingLine + 1; i <= last; i++) {
        const text = document.lineAt(i).text;
        if (/^\*+\s/.test(text)) break;
        const m = text.match(re);
        if (m) return m[1].trim();
        if (/^\s*:END:/i.test(text)) break;
    }
    return undefined;
}

/** The DEPENDS ids declared on the heading enclosing `line`. */
export function getDependsAt(document: vscode.TextDocument, line: number): string[] {
    const headingLine = findEnclosingHeadingLine(document, line);
    if (headingLine < 0) return [];
    return parseDepends(readHeadingProperty(document, headingLine, DEPENDS_PROPERTY));
}

/** The `:ID:` of the heading enclosing `line`, if any. */
export function getIdAt(document: vscode.TextDocument, line: number): string | undefined {
    const headingLine = findEnclosingHeadingLine(document, line);
    if (headingLine < 0) return undefined;
    const raw = readHeadingProperty(document, headingLine, 'ID');
    return raw ? raw.replace(/^id:/i, '') : undefined;
}

// ---------------------------------------------------------------------------
// ORDERED (sequential subtasks)
// ---------------------------------------------------------------------------

/**
 * If the heading at `headingLine` has an ancestor marked `:ORDERED: t`, return
 * the title of the first earlier sibling under that ancestor that is not yet
 * DONE (i.e. the one that must be completed first). Returns null when not
 * ORDERED or when all earlier siblings are done.
 */
export function getOrderedBlocker(
    document: vscode.TextDocument,
    headingLine: number,
    doneStates: Set<string>
): string | null {
    const lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);

    const levelOf = (i: number): number => {
        const m = lines[i].match(/^(\*+)\s/);
        return m ? m[1].length : 0;
    };
    const myLevel = levelOf(headingLine);
    if (myLevel === 0) return null;

    // Find the parent heading (nearest earlier heading with a smaller level).
    let parentLine = -1;
    for (let i = headingLine - 1; i >= 0; i--) {
        const lv = levelOf(i);
        if (lv > 0 && lv < myLevel) { parentLine = i; break; }
    }
    if (parentLine < 0) return null;

    const orderedRaw = readHeadingPropertyFromLines(lines, parentLine, ORDERED_PROPERTY);
    if (!isTruthy(orderedRaw)) return null;

    const parentLevel = levelOf(parentLine);
    const todoStates = getTodoStatesFromText(document.getText());
    // Walk siblings (same level, contiguous under parent) before this heading.
    for (let i = parentLine + 1; i < headingLine; i++) {
        const lv = levelOf(i);
        if (lv === 0) continue;
        if (lv <= parentLevel) break;       // left the parent's subtree
        if (lv !== myLevel) continue;       // only direct siblings
        const m = lines[i].match(/^\*+\s+(.*)$/);
        if (!m) continue;
        const rest = m[1].trim();
        const firstToken = rest.split(/\s+/)[0];
        const state = todoStates.has(firstToken) ? firstToken : '';
        if (state && !isDoneStateName(state, doneStates)) {
            return stripStateAndTags(rest, todoStates);
        }
        // A sibling with no TODO keyword at all is treated as a non-task and skipped.
    }
    return null;
}

function readHeadingPropertyFromLines(lines: string[], headingLine: number, property: string): string | undefined {
    const re = new RegExp(`^\\s*:${property}:\\s*(.+?)\\s*$`, 'i');
    const last = Math.min(headingLine + 60, lines.length - 1);
    for (let i = headingLine + 1; i <= last; i++) {
        if (/^\*+\s/.test(lines[i])) break;
        const m = lines[i].match(re);
        if (m) return m[1].trim();
        if (/^\s*:END:/i.test(lines[i])) break;
    }
    return undefined;
}

function isTruthy(value: string | undefined): boolean {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    return v === 't' || v === 'true' || v === 'yes' || v === 'on';
}

function stripStateAndTags(rest: string, todoStates: Set<string>): string {
    let r = rest.replace(/\s+:[\w@#%:]+:\s*$/, '').trim();
    const sp = r.indexOf(' ');
    const firstToken = sp === -1 ? r : r.slice(0, sp);
    if (todoStates.has(firstToken)) r = sp === -1 ? '' : r.slice(sp + 1).trim();
    r = r.replace(/^\[#[A-Za-z0-9]\]\s*/, '').trim();
    return r;
}

// ---------------------------------------------------------------------------
// DB-backed resolution
// ---------------------------------------------------------------------------

/** Resolve each dependency id to its current state. */
export async function resolveBlockers(
    dependsIds: string[],
    doneStates?: Set<string>
): Promise<Blocker[]> {
    const db = await getDatabase();
    const out: Blocker[] = [];
    for (const id of dependsIds) {
        if (!db) { out.push({ id, found: false, satisfied: false }); continue; }
        const heading = await db.getHeadingById(id);
        if (!heading) {
            out.push({ id, found: false, satisfied: false });
            continue;
        }
        const satisfied = isDoneStateName(heading.todo_state, doneStates);
        out.push({
            id,
            found: true,
            title: heading.title,
            todoState: heading.todo_state,
            filePath: heading.file_path,
            lineNumber: heading.line_number,
            satisfied,
        });
    }
    return out;
}

/**
 * Whether an indexed heading record is currently blocked: it declares
 * `:DEPENDS:` and at least one target is not yet satisfied. Reads the heading's
 * properties JSON, so it works for DB rows (e.g. agenda items) without a buffer.
 */
export async function isHeadingBlocked(
    heading: { properties?: string; todo_state?: string | null },
    doneStates?: Set<string>
): Promise<boolean> {
    let props: Record<string, string> = {};
    try { props = JSON.parse(heading.properties || '{}'); } catch { props = {}; }
    const depends = parseDepends(getPropCaseInsensitive(props, DEPENDS_PROPERTY));
    if (depends.length === 0) return false;
    const unmet = await getUnsatisfiedBlockers(depends, doneStates);
    return unmet.length > 0;
}

/** The blockers that are NOT satisfied (missing target or target not DONE). */
export async function getUnsatisfiedBlockers(
    dependsIds: string[],
    doneStates?: Set<string>
): Promise<Blocker[]> {
    const all = await resolveBlockers(dependsIds, doneStates);
    return all.filter(b => !b.satisfied);
}

/**
 * Given a heading id that just became DONE, return the headings that depend on
 * it and are now fully unblocked (every dependency satisfied) and still active.
 * One hop only — we don't recursively cascade.
 */
export async function getNewlyUnblockedDependents(
    doneId: string,
    doneStates?: Set<string>
): Promise<Array<{ edge: DependencyRecord; heading: HeadingRecord }>> {
    const db = await getDatabase();
    if (!db || !doneId) return [];
    const edges = await db.getDependents(doneId);
    const results: Array<{ edge: DependencyRecord; heading: HeadingRecord }> = [];
    const seen = new Set<string>();
    for (const edge of edges) {
        if (!edge.from_id || seen.has(edge.from_id)) continue;
        seen.add(edge.from_id);
        const heading = await db.getHeadingById(edge.from_id);
        if (!heading) continue;
        // Already done? nothing to promote.
        if (isDoneStateName(heading.todo_state, doneStates)) continue;
        // Are all of its dependencies now satisfied? Treat the just-completed
        // id as done even if the DB index hasn't caught up to the live buffer.
        const deps = await db.getDependencies(edge.from_id);
        const unmet = (await getUnsatisfiedBlockers(deps.map(d => d.to_id), doneStates))
            .filter(b => b.id !== doneId);
        if (unmet.length === 0) results.push({ edge, heading });
    }
    return results;
}

// ---------------------------------------------------------------------------
// Cycle detection (over the workspace dependency graph)
// ---------------------------------------------------------------------------

/**
 * Detect dependency cycles across all indexed edges. Returns each cycle as an
 * ordered list of ids (the first id repeats conceptually to close the loop).
 */
export async function findDependencyCycles(): Promise<string[][]> {
    const db = await getDatabase();
    if (!db) return [];
    const edges = await db.getAllDependencies();
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        if (!e.from_id || !e.to_id) continue;
        const list = adj.get(e.from_id) ?? [];
        list.push(e.to_id);
        adj.set(e.from_id, list);
    }

    const cycles: string[][] = [];
    const seenCycleKeys = new Set<string>();
    const state = new Map<string, 0 | 1 | 2>(); // 0/undefined=white, 1=gray, 2=black
    const stack: string[] = [];

    const visit = (node: string): void => {
        state.set(node, 1);
        stack.push(node);
        for (const next of adj.get(node) ?? []) {
            const s = state.get(next) ?? 0;
            if (s === 1) {
                // Found a back-edge: extract the cycle from the stack.
                const idx = stack.indexOf(next);
                if (idx >= 0) {
                    const cycle = stack.slice(idx);
                    const key = [...cycle].sort().join('|');
                    if (!seenCycleKeys.has(key)) {
                        seenCycleKeys.add(key);
                        cycles.push(cycle);
                    }
                }
            } else if (s === 0) {
                visit(next);
            }
        }
        stack.pop();
        state.set(node, 2);
    };

    for (const node of adj.keys()) {
        if ((state.get(node) ?? 0) === 0) visit(node);
    }
    return cycles;
}
