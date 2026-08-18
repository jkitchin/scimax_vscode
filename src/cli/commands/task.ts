/**
 * Task command - project management over org task graphs.
 *
 * A task is an org heading carrying an `:ID:` property. Blocking comes from two
 * sources, and both must be honored or the answers are wrong:
 *
 *   - `:DEPENDS: id:a id:b`  explicit edges, indexed in the `dependencies` table
 *   - `:ORDERED: t`          on a parent, forcing its children to run in order
 *
 * ORDERED edges are NOT stored anywhere; the extension derives them from
 * document structure at edit time. This module reconstructs them from heading
 * levels so `ready`/`blocked` matches what the editor enforces. Reading only
 * the dependencies table reports sequential subtasks as ready when they are not.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createCliDatabase } from '../database';
import type { ScimaxDbCore, HeadingRecord, DependencyRecord } from '../../database/scimaxDbCore';
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

const DONE_STATES = new Set(['DONE', 'CANCELLED', 'CANCELED']);

export interface Task {
    id: string;
    title: string;
    state: string | null;
    assignee: string | null;
    effort: string | null;
    effortDays: number;
    scheduled: string | null;
    deadline: string | null;
    priority: string | null;
    filePath: string;
    lineNumber: number;
    level: number;
    /** Unfinished ids this task waits on (explicit + ORDERED). */
    blockedBy: string[];
}

// ============================================================
// Loading
// ============================================================

function props(h: HeadingRecord): Record<string, string> {
    if (!h.properties) return {};
    try {
        const parsed = typeof h.properties === 'string' ? JSON.parse(h.properties) : h.properties;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed || {})) {
            out[k.toUpperCase()] = String(v);
        }
        return out;
    } catch {
        return {};
    }
}

/** Parse an org effort string into days. Only `Nd` and `Nh` are understood. */
function effortToDays(effort: string | null): number {
    if (!effort) return 0;
    const d = effort.match(/^([\d.]+)\s*d$/i);
    if (d) return parseFloat(d[1]);
    const h = effort.match(/^([\d.]+)\s*h$/i);
    if (h) return parseFloat(h[1]) / 8;
    return 0;
}

/**
 * Derive implicit edges from `:ORDERED: t` parents: each direct child depends
 * on the previous sibling. Uses heading levels to establish parentage, which is
 * why the full outline is loaded rather than only tasks.
 */
function orderedEdges(headings: HeadingRecord[]): Array<{ from: string; to: string }> {
    const edges: Array<{ from: string; to: string }> = [];

    for (let i = 0; i < headings.length; i++) {
        const parent = headings[i];
        if ((props(parent).ORDERED || '').toLowerCase() !== 't') continue;

        // Direct children: level+1, until a heading at or above the parent's level.
        let prevChildId: string | null = null;
        for (let j = i + 1; j < headings.length; j++) {
            const h = headings[j];
            if (h.level <= parent.level) break;
            if (h.level !== parent.level + 1) continue;

            const id = props(h).ID;
            if (!id) continue;
            if (prevChildId) edges.push({ from: id, to: prevChildId });
            prevChildId = id;
        }
    }
    return edges;
}

/** Load one project file into a task graph with blocking resolved. */
export async function loadProject(db: ScimaxDbCore, filePath: string): Promise<Task[]> {
    const headings = await db.getHeadingsInFile(filePath);
    if (headings.length === 0) return [];

    const explicit: DependencyRecord[] = await db.getAllDependencies();
    const edges = [
        ...explicit.filter(e => e.file_path === filePath).map(e => ({ from: e.from_id, to: e.to_id })),
        ...orderedEdges(headings),
    ];

    const tasks: Task[] = [];
    const doneIds = new Set<string>();

    for (const h of headings) {
        const p = props(h);
        if (!p.ID) continue;
        if (h.todo_state && DONE_STATES.has(h.todo_state)) doneIds.add(p.ID);
        tasks.push({
            id: p.ID,
            title: h.title,
            state: h.todo_state || null,
            assignee: p.ASSIGNEE || null,
            effort: p.EFFORT || null,
            effortDays: effortToDays(p.EFFORT || null),
            scheduled: h.scheduled || null,
            deadline: h.deadline || null,
            priority: h.priority || null,
            filePath: h.file_path,
            lineNumber: h.line_number,
            level: h.level,
            blockedBy: [],
        });
    }

    const byId = new Map(tasks.map(t => [t.id, t]));
    for (const e of edges) {
        const from = byId.get(e.from);
        if (!from) continue;
        if (doneIds.has(e.to)) continue;      // satisfied
        if (!from.blockedBy.includes(e.to)) from.blockedBy.push(e.to);
    }

    return tasks;
}

/** Open tasks only (a done task is not actionable). */
function openTasks(tasks: Task[]): Task[] {
    return tasks.filter(t => t.state && !DONE_STATES.has(t.state));
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

/** Resolve the project file to operate on. */
async function resolveFile(db: ScimaxDbCore, args: ParsedArgs): Promise<string | null> {
    const explicitFile = typeof args.flags.file === 'string' ? args.flags.file : undefined;
    const candidate = explicitFile || args.args.find(a => a.endsWith('.org'));
    if (candidate) return fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;

    const projects = await findProjectFiles(db, localRoot(args));
    if (projects.length === 0) return null;
    return projects[0].file;
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
    if (t.assignee) bits.push(`@${t.assignee}`);
    if (t.effort) bits.push(t.effort);
    if (t.priority) bits.push(`[#${t.priority}]`);
    if (t.deadline) bits.push(`due ${t.deadline}`);
    else if (t.scheduled) bits.push(`sched ${t.scheduled}`);
    const meta = bits.length ? `  (${bits.join(', ')})` : '';

    console.log(`  ${String(n).padStart(2)}. ${(t.state || '').padEnd(6)} ${t.title}${meta}`);
    if (t.blockedBy.length) {
        const names = t.blockedBy.map(id => byId.get(id)?.title || id).join(', ');
        console.log(`      waiting on: ${names}`);
    }
    console.log(`      ${vscodeLinkAt(t.filePath, t.lineNumber)}`);
}

// ============================================================
// Subcommands
// ============================================================

async function taskNext(db: ScimaxDbCore, file: string, json: boolean): Promise<void> {
    const tasks = await loadProject(db, file);
    const open = openTasks(tasks);
    const ready = open.filter(t => t.blockedBy.length === 0);
    const cp = criticalPath(tasks);
    const onPath = new Set(cp.path.map(t => t.id));
    const ranked = rankReady(ready, onPath);

    if (json) {
        console.log(JSON.stringify({
            file,
            ready_count: ready.length,
            blocked_count: open.length - ready.length,
            critical_path_days: cp.days,
            critical_path: cp.path.map(t => t.id),
            recommended: ranked[0] ? taskToJson(ranked[0]) : null,
            ready: ranked.map(taskToJson),
        }, null, 2));
        return;
    }

    console.log(`=== Next Actions ===\n${file}\n`);
    if (ranked.length === 0) {
        console.log(open.length === 0
            ? 'No open tasks.'
            : `Nothing is actionable — all ${open.length} open tasks are blocked.`);
        return;
    }

    const byId = new Map(tasks.map(t => [t.id, t]));
    console.log(`Ready now (${ranked.length} of ${open.length} open):\n`);
    ranked.forEach((t, i) => printTask(i + 1, t, byId));

    if (cp.path.length) {
        console.log(`\nCritical path — ${cp.days}d of remaining work:`);
        console.log(`  ${cp.path.map(t => t.id).join(' -> ')}`);
        const gate = cp.path.find(t => t.blockedBy.length === 0);
        if (gate) console.log(`\nStart with "${gate.title}" — it gates the longest chain.`);
    }
}

async function taskList(db: ScimaxDbCore, file: string, args: ParsedArgs, json: boolean): Promise<void> {
    const tasks = await loadProject(db, file);
    let open = openTasks(tasks);

    const assignee = typeof args.flags.assignee === 'string' ? args.flags.assignee : undefined;
    if (assignee) open = open.filter(t => t.assignee === assignee);
    if (args.flags.ready === true) open = open.filter(t => t.blockedBy.length === 0);
    if (args.flags.blocked === true) open = open.filter(t => t.blockedBy.length > 0);

    open.sort((a, b) => (a.blockedBy.length - b.blockedBy.length) || (a.lineNumber - b.lineNumber));

    if (json) {
        console.log(JSON.stringify({ file, count: open.length, items: open.map(taskToJson) }, null, 2));
        return;
    }

    console.log(`=== Tasks ===\n${file}\n`);
    if (open.length === 0) { console.log('No matching tasks.'); return; }
    const byId = new Map(tasks.map(t => [t.id, t]));
    open.forEach((t, i) => printTask(i + 1, t, byId));
}

async function taskWho(db: ScimaxDbCore, file: string, json: boolean): Promise<void> {
    const tasks = await loadProject(db, file);
    const open = openTasks(tasks);

    const rows = new Map<string, { open: number; ready: number; days: number; unestimated: number }>();
    for (const t of open) {
        const who = t.assignee || '(unassigned)';
        const r = rows.get(who) || { open: 0, ready: 0, days: 0, unestimated: 0 };
        r.open++;
        if (t.blockedBy.length === 0) r.ready++;
        r.days += t.effortDays;
        if (!t.effort) r.unestimated++;
        rows.set(who, r);
    }

    const sorted = [...rows.entries()].sort((a, b) => b[1].days - a[1].days);

    if (json) {
        console.log(JSON.stringify({
            file,
            assignees: sorted.map(([who, r]) => ({ assignee: who, ...r })),
        }, null, 2));
        return;
    }

    console.log(`=== Workload ===\n${file}\n`);
    console.log('  assignee        open  ready  days  unestimated');
    for (const [who, r] of sorted) {
        console.log(`  ${who.padEnd(15)} ${String(r.open).padStart(4)} ${String(r.ready).padStart(6)} ${String(r.days).padStart(5)} ${String(r.unestimated).padStart(12)}`);
    }
    console.log('\n  days counts only Nd/Nh efforts; unestimated tasks contribute 0.');
}

async function taskShow(db: ScimaxDbCore, file: string, id: string, json: boolean): Promise<void> {
    const tasks = await loadProject(db, file);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const t = byId.get(id);
    if (!t) {
        console.error(`No task with id "${id}" in ${file}`);
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

async function taskDone(db: ScimaxDbCore, file: string, id: string, args: ParsedArgs, json: boolean): Promise<void> {
    const tasks = await loadProject(db, file);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const t = byId.get(id);
    if (!t) {
        console.error(`No task with id "${id}" in ${file}`);
        process.exitCode = 1;
        return;
    }
    if (t.state && DONE_STATES.has(t.state)) {
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
    const after = await loadProject(db, file);
    const nowReady = after.filter(o => o.blockedBy.length === 0
        && o.state && !DONE_STATES.has(o.state)
        && tasks.find(p => p.id === o.id)?.blockedBy.includes(id));

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
        nowReady.forEach(o => console.log(`  - ${o.title}${o.assignee ? ` (@${o.assignee})` : ''}`));
    }
}

async function taskAssign(db: ScimaxDbCore, file: string, id: string, who: string, json: boolean): Promise<void> {
    const tasks = await loadProject(db, file);
    const t = tasks.find(x => x.id === id);
    if (!t) {
        console.error(`No task with id "${id}" in ${file}`);
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
        console.log(JSON.stringify({ id, title: t.title, assignee: who, previous: t.assignee }));
        return;
    }
    console.log(`Assigned "${t.title}" to ${who}${t.assignee ? ` (was ${t.assignee})` : ''}.`);
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
    --file <path>    Project file (otherwise the file with the most tasks)
    --local          Only consider files under the current directory
    --json           Structured output
    --force          Allow 'done' on a blocked task

NOTES:
    A task is a heading with an :ID: property. Blocking comes from :DEPENDS:
    and from :ORDERED: parents; both are honored. Writes update the org file
    and reindex it immediately.

    File selection is global by default: the database spans every indexed file,
    so 'scimax task next' answers from any directory. Use --local to confine it
    to the current project, or name the file outright.
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

        const file = await resolveFile(db, args);
        if (!file) {
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

        switch (sub) {
            case 'next': await taskNext(db, file, json); break;
            case 'list': await taskList(db, file, args, json); break;
            case 'who': await taskWho(db, file, json); break;
            case 'path': {
                const tasks = await loadProject(db, file);
                const cp = criticalPath(tasks);
                if (json) {
                    console.log(JSON.stringify({ file, days: cp.days, path: cp.path.map(taskToJson) }, null, 2));
                    break;
                }
                console.log(`=== Critical Path ===\n${file}\n`);
                if (!cp.path.length) { console.log('No open tasks.'); break; }
                console.log(`${cp.days}d of remaining work across ${cp.path.length} tasks:\n`);
                cp.path.forEach((t, i) => {
                    const mark = t.blockedBy.length === 0 ? '>' : ' ';
                    console.log(`  ${mark} ${String(i + 1).padStart(2)}. ${(t.effort || '-').padStart(4)}  ${t.title}${t.assignee ? `  @${t.assignee}` : ''}`);
                });
                console.log('\n  ">" marks tasks that are ready to start.');
                break;
            }
            case 'show': {
                if (!operands[0]) { console.error('Usage: scimax task show <id>'); process.exitCode = 1; break; }
                await taskShow(db, file, operands[0], json);
                break;
            }
            case 'done': {
                if (!operands[0]) { console.error('Usage: scimax task done <id>'); process.exitCode = 1; break; }
                await taskDone(db, file, operands[0], args, json);
                break;
            }
            case 'assign': {
                if (!operands[0] || !operands[1]) {
                    console.error('Usage: scimax task assign <id> <who>');
                    process.exitCode = 1;
                    break;
                }
                await taskAssign(db, file, operands[0], operands[1], json);
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
