/**
 * Task command - project management over org task graphs.
 *
 * A task is an org heading carrying an `:ID:` property. Blocking comes from two
 * sources, and both must be honored or the answers are wrong:
 *
 *   - `:DEPENDS: id:a id:b`  explicit edges, indexed in the `dependencies` table
 *   - `:ORDERED: t`          on a parent, forcing its children to run in order
 *
 * Tasks are read from the org files with the same parser the editor's
 * project view uses (src/parser/projectTasks.ts), so assignees (own,
 * inherited and @tags), efforts in every unit, and ORDERED edges mean the
 * same thing here as there. The database is only used to find which files
 * hold tasks.
 *
 * A scope is the set of files whose tasks are listed: every indexed project
 * by default, the current directory with --local, or one file. Blocking is
 * always judged against every indexed task, so a dependency in another file
 * counts as done when it is done.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createCliDatabase } from '../database';
import type { ScimaxDbCore } from '../../database/scimaxDbCore';
import { parseOrg } from '../../parser/orgParserUnified';
import { org } from '../../parser/orgModify';
import { extractProjectTasks } from '../../parser/projectTasks';
import { loadSettings } from '../settings';
import { vscodeLinkAt } from '../links';

interface CliConfig {
    dbPath: string;
    rootDir: string;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    args: string[];
    flags: Record<string, string | boolean>;
}

export interface Task {
    id: string;
    title: string;
    state: string | null;
    /** Whether the state is a done state (DONE, CANCELLED, or configured). */
    done: boolean;
    /** Own, inherited and @tag assignees. */
    assignees: string[];
    /** The assignees joined with spaces, or null (kept for output). */
    assignee: string | null;
    /** The :ASSIGNEE: written on this heading itself, if any. */
    ownAssignee: string | null;
    effort: string | null;
    /** Effort in 8-hour days (0 when there is none). */
    effortDays: number;
    scheduled: string | null;
    deadline: string | null;
    priority: string | null;
    filePath: string;
    lineNumber: number;
    level: number;
    /** Unfinished or unknown ids this task waits on (explicit + ORDERED). */
    blockedBy: string[];
}

/** The tasks a command works on, and every indexed task for resolving dependencies. */
export interface TaskScope {
    /** What the scope covers, for headers: a file, a directory, or "all". */
    label: string;
    files: string[];
    tasks: Task[];
    /** Every loaded task by id, inside and outside the scope. */
    byId: Map<string, Task>;
    /** Ids defined more than once, with where. */
    duplicates: Map<string, string[]>;
}

// ============================================================
// Loading
// ============================================================

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** An org-style date, `2026-12-01 Tue`, which also sorts as a string. */
function orgDate(d: Date | undefined): string | null {
    if (!d) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${DOW[d.getDay()]}`;
}

/**
 * The tasks (headings with a TODO keyword and an :ID:) in org `text`, with
 * dependencies not yet resolved: blockedBy holds every id the task depends on.
 */
export function parseTasks(text: string, filePath: string, doneStates: string[] = []): Task[] {
    const doc = parseOrg(text, { filePath });
    const extracted = extractProjectTasks(doc, org.getAllHeadlines(doc), { todoOnly: true, file: filePath, doneStates: new Set(doneStates) });
    const tasks: Task[] = [];
    for (const t of extracted) {
        if (!t.id) continue;
        const props: Record<string, string> = {};
        for (const [k, v] of Object.entries(t.properties ?? {})) props[k.toUpperCase()] = String(v);
        tasks.push({
            id: t.id,
            title: t.title,
            state: t.todo ?? null,
            done: t.isDone,
            assignees: t.assignees,
            assignee: t.assignees.length ? t.assignees.join(' ') : null,
            ownAssignee: props.ASSIGNEE?.trim() || null,
            effort: props.EFFORT?.trim() || null,
            effortDays: t.effortMinutes ? t.effortMinutes / 480 : 0,
            scheduled: orgDate(t.scheduled),
            deadline: orgDate(t.deadline),
            priority: t.priority ?? null,
            filePath,
            lineNumber: t.line,
            level: t.level,
            blockedBy: [...new Set(t.dependsIds)],
        });
    }
    return tasks;
}

/**
 * Resolve blocking: a task waits on each dependency that is not done, or that
 * no loaded file defines. Returns tasks by id and the ids defined twice.
 */
export function resolveTasks(all: Task[]): { byId: Map<string, Task>; duplicates: Map<string, string[]> } {
    const byId = new Map<string, Task>();
    const duplicates = new Map<string, string[]>();
    for (const t of all) {
        const prior = byId.get(t.id);
        if (prior) {
            const where = duplicates.get(t.id) ?? [`${prior.filePath}:${prior.lineNumber}`];
            where.push(`${t.filePath}:${t.lineNumber}`);
            duplicates.set(t.id, where);
            continue; // The first definition wins, as in the editor.
        }
        byId.set(t.id, t);
    }
    for (const t of all) {
        t.blockedBy = t.blockedBy.filter(id => id !== t.id && !byId.get(id)?.done);
    }
    return { byId, duplicates };
}

/** Read and parse task files; unreadable files are skipped. */
function readTasks(files: string[], doneStates: string[]): Task[] {
    const out: Task[] = [];
    for (const f of files) {
        let text: string;
        try { text = fs.readFileSync(f, 'utf-8'); } catch { continue; }
        out.push(...parseTasks(text, f, doneStates));
    }
    return out;
}

/** Load the tasks of `files`, resolving dependencies against every indexed task file. */
export async function loadScope(db: ScimaxDbCore, label: string, files: string[]): Promise<TaskScope> {
    const doneStates = loadSettings().agenda.doneStates;
    const universe = [...new Set([...files, ...(await findProjectFiles(db)).map(f => f.file)])];
    const all = readTasks(universe, doneStates);
    const { byId, duplicates } = resolveTasks(all);
    const inScope = new Set(files);
    const tasks = all.filter(t => inScope.has(t.filePath) && byId.get(t.id) === t);
    return { label, files, tasks, byId, duplicates };
}

/** Open tasks only (a done task is not actionable). */
function openTasks(tasks: Task[]): Task[] {
    return tasks.filter(t => !t.done);
}

/** Warn about ids defined more than once, which make dependencies ambiguous. */
function warnDuplicates(scope: TaskScope): void {
    for (const [id, where] of scope.duplicates) {
        if (!where.some(w => scope.files.some(f => w.startsWith(f + ':')))) continue;
        console.error(`Warning: :ID: ${id} is defined ${where.length} times (${where.join(', ')}); the first is used.`);
    }
}

// ============================================================
// Critical path
// ============================================================

/**
 * Longest cumulative-effort chain through the graph, counting only unfinished
 * work. Returned as ids in execution order. Guards against cycles.
 */
export function criticalPath(tasks: Task[]): { days: number; path: Task[] } {
    const open = openTasks(tasks);
    const byId = new Map(open.map(t => [t.id, t]));
    const memo = new Map<string, { days: number; path: string[] }>();
    const visiting = new Set<string>();

    // Depth of a task = its own effort + the longest chain of what it waits on.
    function longestTo(id: string): { days: number; path: string[] } {
        const cached = memo.get(id);
        if (cached) return cached;
        const t = byId.get(id);
        if (!t) return { days: 0, path: [] };
        if (visiting.has(id)) return { days: 0, path: [] }; // cycle: stop descending
        visiting.add(id);

        let best = { days: 0, path: [] as string[] };
        for (const dep of t.blockedBy) {
            if (!byId.has(dep)) continue;
            const sub = longestTo(dep);
            if (sub.days > best.days) best = sub;
        }
        visiting.delete(id);

        const result = { days: best.days + t.effortDays, path: [...best.path, id] };
        memo.set(id, result);
        return result;
    }

    let winner = { days: 0, path: [] as string[] };
    for (const t of open) {
        const r = longestTo(t.id);
        if (r.days > winner.days) winner = r;
    }

    return {
        days: winner.days,
        path: winner.path.map(id => byId.get(id)!).filter(Boolean),
    };
}

/** Rank ready tasks: deadline soonest, then priority, then critical-path membership. */
function rankReady(ready: Task[], onPath: Set<string>): Task[] {
    const priRank = (p: string | null) => (p ? p.charCodeAt(0) : 'Z'.charCodeAt(0));
    return [...ready].sort((a, b) => {
        if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
        if (a.deadline && b.deadline && a.deadline !== b.deadline) {
            return a.deadline < b.deadline ? -1 : 1;
        }
        if (priRank(a.priority) !== priRank(b.priority)) return priRank(a.priority) - priRank(b.priority);
        const aOn = onPath.has(a.id), bOn = onPath.has(b.id);
        if (aOn !== bOn) return aOn ? -1 : 1;
        if (!!a.scheduled !== !!b.scheduled) return a.scheduled ? -1 : 1;
        return b.effortDays - a.effortDays;
    });
}

// ============================================================
// Project discovery
// ============================================================

/**
 * The directory `--local` confines discovery to, or undefined when the search
 * is global. Resolved through symlinks because indexed paths are real paths.
 */
export function localRoot(args: ParsedArgs): string | undefined {
    if (args.flags.local !== true) return undefined;
    const cwd = process.cwd();
    return fs.existsSync(cwd) ? fs.realpathSync(cwd) : cwd;
}

/** True when `file` sits inside `root`. Compares whole path segments. */
function isUnder(file: string, root: string): boolean {
    return file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Files that carry task metadata, most tasks first.
 *
 * The database spans every file ever indexed, so this is global unless `root`
 * confines it. That default is deliberate: `scimax task next` should answer
 * from anywhere. Pass a root when the caller asked for the current project.
 */
async function findProjectFiles(
    db: ScimaxDbCore,
    root?: string
): Promise<Array<{ file: string; tasks: number }>> {
    const withDepends = await db.searchByProperty('DEPENDS');
    const withAssignee = await db.searchByProperty('ASSIGNEE');
    const counts = new Map<string, number>();
    for (const h of [...withDepends, ...withAssignee]) {
        if (root && !isUnder(h.file_path, root)) continue;
        counts.set(h.file_path, (counts.get(h.file_path) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([file, tasks]) => ({ file, tasks }))
        .sort((a, b) => b.tasks - a.tasks);
}

/**
 * The scope to operate on: the file named with --file (or as an .org
 * argument), every task file under the current directory with --local, or
 * every indexed task file. Undefined when there are none.
 */
async function resolveScope(db: ScimaxDbCore, args: ParsedArgs): Promise<TaskScope | undefined> {
    const explicitFile = typeof args.flags.file === 'string' ? args.flags.file : undefined;
    const candidate = explicitFile || args.args.find(a => a.endsWith('.org'));
    if (candidate) {
        const file = fs.existsSync(candidate) ? fs.realpathSync(candidate) : path.resolve(candidate);
        return loadScope(db, file, [file]);
    }
    const root = localRoot(args);
    const files = (await findProjectFiles(db, root)).map(f => f.file);
    if (files.length === 0) return undefined;
    const label = root ?? `all indexed projects (${files.length} file${files.length === 1 ? '' : 's'})`;
    return loadScope(db, label, files);
}

// ============================================================
// Output
// ============================================================

function taskToJson(t: Task) {
    return {
        id: t.id,
        title: t.title,
        state: t.state,
        assignee: t.assignee,
        assignees: t.assignees,
        effort: t.effort,
        effort_days: t.effortDays,
        scheduled: t.scheduled,
        deadline: t.deadline,
        priority: t.priority,
        blocked_by: t.blockedBy,
        ready: t.blockedBy.length === 0,
        file_path: t.filePath,
        line_number: t.lineNumber,
    };
}

function printTask(n: number, t: Task, byId: Map<string, Task>): void {
    const bits: string[] = [];
    if (t.assignees.length) bits.push(t.assignees.map(a => `@${a}`).join(' '));
    if (t.effort) bits.push(t.effort);
    if (t.priority) bits.push(`[#${t.priority}]`);
    if (t.deadline) bits.push(`due ${t.deadline}`);
    else if (t.scheduled) bits.push(`sched ${t.scheduled}`);
    const meta = bits.length ? `  (${bits.join(', ')})` : '';

    console.log(`  ${String(n).padStart(2)}. ${(t.state || '').padEnd(6)} ${t.title}${meta}`);
    if (t.blockedBy.length) {
        const names = t.blockedBy.map(id => byId.get(id)?.title || `${id} (not found)`).join(', ');
        console.log(`      waiting on: ${names}`);
    }
    console.log(`      ${vscodeLinkAt(t.filePath, t.lineNumber)}`);
}

// ============================================================
// Subcommands
// ============================================================

function taskNext(scope: TaskScope, json: boolean): void {
    const tasks = scope.tasks;
    const open = openTasks(tasks);
    const ready = open.filter(t => t.blockedBy.length === 0);
    const cp = criticalPath(tasks);
    const onPath = new Set(cp.path.map(t => t.id));
    const ranked = rankReady(ready, onPath);

    if (json) {
        console.log(JSON.stringify({
            scope: scope.label,
            files: scope.files,
            ready_count: ready.length,
            blocked_count: open.length - ready.length,
            critical_path_days: cp.days,
            critical_path: cp.path.map(t => t.id),
            recommended: ranked[0] ? taskToJson(ranked[0]) : null,
            ready: ranked.map(taskToJson),
        }, null, 2));
        return;
    }

    console.log(`=== Next Actions ===\n${scope.label}\n`);
    if (ranked.length === 0) {
        console.log(open.length === 0
            ? 'No open tasks.'
            : `Nothing is actionable — all ${open.length} open tasks are blocked.`);
        return;
    }

    const byId = scope.byId;
    console.log(`Ready now (${ranked.length} of ${open.length} open):\n`);
    ranked.forEach((t, i) => printTask(i + 1, t, byId));

    if (cp.path.length) {
        console.log(`\nCritical path — ${cp.days}d of remaining work:`);
        console.log(`  ${cp.path.map(t => t.id).join(' -> ')}`);
        const gate = cp.path.find(t => t.blockedBy.length === 0);
        if (gate) console.log(`\nStart with "${gate.title}" — it gates the longest chain.`);
    }
}

function taskList(scope: TaskScope, args: ParsedArgs, json: boolean): void {
    const tasks = scope.tasks;
    let open = openTasks(tasks);

    const assignee = typeof args.flags.assignee === 'string' ? args.flags.assignee : undefined;
    if (assignee) open = open.filter(t => t.assignees.includes(assignee));
    if (args.flags.ready === true) open = open.filter(t => t.blockedBy.length === 0);
    if (args.flags.blocked === true) open = open.filter(t => t.blockedBy.length > 0);

    open.sort((a, b) => (a.blockedBy.length - b.blockedBy.length) || (a.lineNumber - b.lineNumber));

    if (json) {
        console.log(JSON.stringify({ scope: scope.label, files: scope.files, count: open.length, items: open.map(taskToJson) }, null, 2));
        return;
    }

    console.log(`=== Tasks ===\n${scope.label}\n`);
    if (open.length === 0) { console.log('No matching tasks.'); return; }
    open.forEach((t, i) => printTask(i + 1, t, scope.byId));
}

function taskWho(scope: TaskScope, json: boolean): void {
    const tasks = scope.tasks;
    const open = openTasks(tasks);

    const rows = new Map<string, { open: number; ready: number; days: number; unestimated: number }>();
    for (const t of open) {
        // A shared task's effort is split evenly between its assignees.
        const people = t.assignees.length ? t.assignees : ['(unassigned)'];
        for (const who of people) {
            const r = rows.get(who) || { open: 0, ready: 0, days: 0, unestimated: 0 };
            r.open++;
            if (t.blockedBy.length === 0) r.ready++;
            r.days += t.effortDays / people.length;
            if (!t.effortDays) r.unestimated++;
            rows.set(who, r);
        }
    }
    for (const r of rows.values()) r.days = Math.round(r.days * 100) / 100;

    const sorted = [...rows.entries()].sort((a, b) => b[1].days - a[1].days);

    if (json) {
        console.log(JSON.stringify({
            scope: scope.label,
            files: scope.files,
            assignees: sorted.map(([who, r]) => ({ assignee: who, ...r })),
        }, null, 2));
        return;
    }

    console.log(`=== Workload ===\n${scope.label}\n`);
    console.log('  assignee        open  ready   days  unestimated');
    for (const [who, r] of sorted) {
        console.log(`  ${who.padEnd(15)} ${String(r.open).padStart(4)} ${String(r.ready).padStart(6)} ${r.days.toFixed(1).padStart(6)} ${String(r.unestimated).padStart(12)}`);
    }
    console.log('\n  days are 8-hour days of open effort; a shared task is split between its assignees.');
}

function taskShow(scope: TaskScope, id: string, json: boolean): void {
    const byId = scope.byId;
    const tasks = [...byId.values()];
    const t = byId.get(id);
    if (!t) {
        console.error(`No task with id "${id}" in any indexed file`);
        process.exitCode = 1;
        return;
    }
    const unblocks = tasks.filter(o => o.blockedBy.includes(id));

    if (json) {
        console.log(JSON.stringify({
            ...taskToJson(t),
            blocked_by_detail: t.blockedBy.map(b => byId.get(b) ? taskToJson(byId.get(b)!) : { id: b, missing: true }),
            unblocks: unblocks.map(taskToJson),
        }, null, 2));
        return;
    }

    console.log(`=== ${t.title} ===\n`);
    console.log(`  id:        ${t.id}`);
    console.log(`  state:     ${t.state || '-'}`);
    console.log(`  assignee:  ${t.assignee || '-'}`);
    console.log(`  file:      ${t.filePath}`);
    console.log(`  effort:    ${t.effort || '-'}`);
    if (t.scheduled) console.log(`  scheduled: ${t.scheduled}`);
    if (t.deadline) console.log(`  deadline:  ${t.deadline}`);
    console.log(`  ${vscodeLinkAt(t.filePath, t.lineNumber)}\n`);

    if (t.blockedBy.length) {
        console.log('  Blocked by:');
        for (const b of t.blockedBy) {
            const bt = byId.get(b);
            console.log(`    - ${bt ? `${bt.state} ${bt.title}` : `${b} (not found)`}`);
        }
    } else {
        console.log('  Ready — nothing is blocking it.');
    }

    if (unblocks.length) {
        console.log('\n  Finishing this unblocks:');
        for (const u of unblocks) {
            const remaining = u.blockedBy.filter(b => b !== id);
            const note = remaining.length ? ` (still waits on ${remaining.join(', ')})` : ' (becomes ready)';
            console.log(`    - ${u.title}${note}`);
        }
    }
}

// ============================================================
// Writes
// ============================================================

/** Rewrite one line of a file in place. */
function replaceLine(filePath: string, lineNumber: number, transform: (line: string) => string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const idx = lineNumber - 1;
    if (idx < 0 || idx >= lines.length) throw new Error(`Line ${lineNumber} out of range in ${filePath}`);
    lines[idx] = transform(lines[idx]);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

async function taskDone(db: ScimaxDbCore, scope: TaskScope, id: string, args: ParsedArgs, json: boolean): Promise<void> {
    const byId = scope.byId;
    const tasks = [...byId.values()];
    const t = byId.get(id);
    if (!t) {
        console.error(`No task with id "${id}" in any indexed file`);
        process.exitCode = 1;
        return;
    }
    if (t.done) {
        console.log(`"${t.title}" is already ${t.state}.`);
        return;
    }

    // Same guard the editor enforces: a blocked task cannot be completed.
    if (t.blockedBy.length > 0 && args.flags.force !== true) {
        const names = t.blockedBy.map(b => byId.get(b)?.title || b);
        console.error(`Blocked: "${t.title}" waits on ${names.join(', ')}.`);
        console.error('Finish those first, or pass --force to override.');
        process.exitCode = 1;
        return;
    }

    const settings = loadSettings();
    const doneState = settings.agenda.doneStates[0] || 'DONE';
    const oldState = t.state;

    replaceLine(t.filePath, t.lineNumber, line => {
        if (oldState) return line.replace(new RegExp(`(^\\*+\\s+)${oldState}\\b`), `$1${doneState}`);
        return line.replace(/^(\*+\s+)/, `$1${doneState} `);
    });

    await db.indexFile(t.filePath);

    // Report what this opened up, using freshly indexed state.
    const after = await loadScope(db, scope.label, scope.files);
    const nowReady = [...after.byId.values()].filter(o => o.blockedBy.length === 0
        && !o.done
        && byId.get(o.id)?.blockedBy.includes(id));

    if (json) {
        console.log(JSON.stringify({
            id, title: t.title, from: oldState, to: doneState,
            unblocked: nowReady.map(taskToJson),
        }, null, 2));
        return;
    }

    console.log(`${oldState || '(none)'} -> ${doneState}: ${t.title}`);
    if (nowReady.length) {
        console.log('\nNow ready:');
        nowReady.forEach(o => console.log(`  - ${o.title}${o.assignees.length ? ` (${o.assignees.map(a => `@${a}`).join(' ')})` : ''}`));
    }
}

async function taskAssign(db: ScimaxDbCore, scope: TaskScope, id: string, who: string, json: boolean): Promise<void> {
    const t = scope.byId.get(id);
    if (!t) {
        console.error(`No task with id "${id}" in any indexed file`);
        process.exitCode = 1;
        return;
    }

    const content = fs.readFileSync(t.filePath, 'utf-8');
    const lines = content.split('\n');

    // Find this heading's properties drawer and set :ASSIGNEE: within it.
    let start = -1, end = -1;
    for (let i = t.lineNumber; i < lines.length; i++) {
        if (/^\*+\s/.test(lines[i])) break;                       // next heading
        if (/^\s*:PROPERTIES:\s*$/i.test(lines[i])) start = i;
        if (start >= 0 && /^\s*:END:\s*$/i.test(lines[i])) { end = i; break; }
    }
    if (start < 0 || end < 0) {
        console.error(`"${t.title}" has no :PROPERTIES: drawer to write :ASSIGNEE: into.`);
        process.exitCode = 1;
        return;
    }

    const indent = (lines[start].match(/^\s*/) || [''])[0];
    let replaced = false;
    for (let i = start + 1; i < end; i++) {
        if (/^\s*:ASSIGNEE:/i.test(lines[i])) {
            lines[i] = `${indent}:ASSIGNEE: ${who}`;
            replaced = true;
            break;
        }
    }
    if (!replaced) lines.splice(end, 0, `${indent}:ASSIGNEE: ${who}`);

    fs.writeFileSync(t.filePath, lines.join('\n'), 'utf-8');
    await db.indexFile(t.filePath);

    if (json) {
        console.log(JSON.stringify({ id, title: t.title, assignee: who, previous: t.ownAssignee }));
        return;
    }
    console.log(`Assigned "${t.title}" to ${who}${t.ownAssignee ? ` (was ${t.ownAssignee})` : ''}.`);
}

// ============================================================
// Entry
// ============================================================

function printTaskHelp(): void {
    console.log(`
scimax task - Project management over org task graphs

USAGE:
    scimax task next [file]              What to work on now, ranked
    scimax task list [file]              Open tasks (--ready, --blocked, --assignee X)
    scimax task who [file]               Workload by assignee
    scimax task show <id> [file]         One task: blockers and what it unblocks
    scimax task path [file]              Critical path through remaining work
    scimax task done <id> [file]         Mark DONE (refuses if blocked; --force overrides)
    scimax task assign <id> <who> [file] Set :ASSIGNEE:
    scimax task files                    List files containing tasks

OPTIONS:
    --file <path>    Only this file's tasks
    --local          Only the task files under the current directory
    --json           Structured output
    --force          Allow 'done' on a blocked task

NOTES:
    A task is a heading with an :ID: property. Blocking comes from :DEPENDS:
    and from :ORDERED: parents; both are honored. Writes update the org file
    and reindex it immediately.

    The scope is global by default: every indexed file with tasks, so
    'scimax task who' is the whole team's workload across projects. Use
    --local to confine it to the current project (run it in the project's
    folder), or name one file. Dependencies are always resolved against every
    indexed task, so a task waiting on another project is blocked only while
    that task is open. Assignees include inherited :ASSIGNEE: and @tags.
`);
}

export async function taskCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    // `scimax task <file>.org` is shorthand for the default view on that file.
    const rawSub = args.subcommand;
    const sub = !rawSub || rawSub.endsWith('.org') ? 'next' : rawSub;
    const json = args.flags.json === true;

    if (sub === 'help' || args.flags.help === true) { printTaskHelp(); return; }

    const db = await createCliDatabase(config.dbPath);
    try {
        if (sub === 'files') {
            const files = await findProjectFiles(db, localRoot(args));
            if (json) { console.log(JSON.stringify({ count: files.length, files }, null, 2)); return; }
            if (files.length === 0) {
                console.log(args.flags.local === true
                    ? `No files with task metadata under ${process.cwd()}.`
                    : 'No files with task metadata found.');
                return;
            }
            console.log('Files with tasks:\n');
            for (const f of files) console.log(`  ${String(f.tasks).padStart(4)}  ${f.file}`);
            return;
        }

        const scope = await resolveScope(db, args);
        if (!scope) {
            console.error(args.flags.local === true
                ? `No project file under ${process.cwd()}. Drop --local to search all indexed files, or pass --file <path>.`
                : 'No project file found. Pass one with --file, or add :ASSIGNEE:/:DEPENDS: properties to a file and run `scimax db sync`.');
            process.exitCode = 1;
            return;
        }

        // parseArgs keeps the subcommand as args[0]; drop it, then ignore any
        // file path so what remains is the id / assignee operands.
        const operands = (rawSub && !rawSub.endsWith('.org') ? args.args.slice(1) : args.args)
            .filter(a => !a.endsWith('.org'));

        warnDuplicates(scope);
        switch (sub) {
            case 'next': taskNext(scope, json); break;
            case 'list': taskList(scope, args, json); break;
            case 'who': taskWho(scope, json); break;
            case 'path': {
                const cp = criticalPath(scope.tasks);
                if (json) {
                    console.log(JSON.stringify({ scope: scope.label, files: scope.files, days: cp.days, path: cp.path.map(taskToJson) }, null, 2));
                    break;
                }
                console.log(`=== Critical Path ===\n${scope.label}\n`);
                if (!cp.path.length) { console.log('No open tasks.'); break; }
                console.log(`${Math.round(cp.days * 10) / 10}d of remaining work across ${cp.path.length} tasks:\n`);
                cp.path.forEach((t, i) => {
                    const mark = t.blockedBy.length === 0 ? '>' : ' ';
                    console.log(`  ${mark} ${String(i + 1).padStart(2)}. ${(t.effort || '-').padStart(4)}  ${t.title}${t.assignees.length ? `  ${t.assignees.map(a => `@${a}`).join(' ')}` : ''}`);
                });
                console.log('\n  ">" marks tasks that are ready to start.');
                break;
            }
            case 'show': {
                if (!operands[0]) { console.error('Usage: scimax task show <id>'); process.exitCode = 1; break; }
                taskShow(scope, operands[0], json);
                break;
            }
            case 'done': {
                if (!operands[0]) { console.error('Usage: scimax task done <id>'); process.exitCode = 1; break; }
                await taskDone(db, scope, operands[0], args, json);
                break;
            }
            case 'assign': {
                if (!operands[0] || !operands[1]) {
                    console.error('Usage: scimax task assign <id> <who>');
                    process.exitCode = 1;
                    break;
                }
                await taskAssign(db, scope, operands[0], operands[1], json);
                break;
            }
            default:
                console.error(`Unknown task subcommand: ${sub}`);
                printTaskHelp();
                process.exitCode = 1;
        }
    } finally {
        await db.close();
    }
}
