/**
 * Gantt rows for the project view, and their Excel and PDF exports.
 *
 * The rows are computed once, here, from the project's tasks and the options
 * the view shows (assignee and tag filters, done tasks, grouping, progress).
 * The webview draws them and the exporters write them, so an export always
 * matches the screen.
 *
 * Progress (optional, off by default): a row with subtasks gets the share of
 * its leaf tasks that is done, by effort or by count; a leaf task with
 * :PROGRESS: gets its own percent. DONE counts as finished, CANCELLED drops
 * out. A row whose done share trails the elapsed share of its span is behind.
 *
 * No vscode imports: this module is unit tested directly.
 */

import * as path from 'path';
import {
    scheduleProjectTasks,
    type ProjectTask,
    type TaskSpan,
} from '../parser/projectTasks';

/** A task as the project view needs it. */
export interface GanttTaskInput extends ProjectTask {
    file: string;
    blocked: boolean;
}

export type GanttGroupBy = 'none' | 'assignee' | 'file' | 'parent' | 'outline';
export type GanttStatus = 'done' | 'blocked' | 'active' | 'planned';
export type ProgressWeighting = 'auto' | 'count' | 'effort';

export interface GanttOptions {
    /** Only tasks for this handle; '' means unassigned; undefined means anyone. */
    assignee?: string;
    /** Only tasks with at least one of these tags; empty or undefined means any. */
    tags?: string[];
    /** Files (relative to root, / separators) whose tasks are left out. */
    hiddenFiles?: string[];
    /** Include DONE/CANCELLED tasks (default false). */
    showDone?: boolean;
    groupBy?: GanttGroupBy;
    /** Root the file column is relative to. */
    root?: string;
    /** Show percent complete and behind flags (default false). */
    showProgress?: boolean;
    /** How leaf tasks are weighted in a rollup (default 'auto'). */
    progressWeighting?: ProgressWeighting;
    /** Weight of a task with no EFFORT when weighting by effort (default 1d). */
    defaultEffortMinutes?: number;
    /** Percentage points a row may trail its elapsed share before it is behind (default 10). */
    behindTolerance?: number;
    /** Only rows at most this deep (1 = group headers or top-level headings). */
    maxDepth?: number;
    /** Keys of folded rows: the rows below them are hidden. */
    collapsed?: string[];
    /** Only rows that are behind, with the rows above them for context. */
    behindOnly?: boolean;
}

/** Percent complete of a row. */
export interface GanttProgress {
    /** 0-100. */
    percent: number;
    /** 'own' is the task's own :PROGRESS:; else how its leaf tasks were weighted. */
    method: 'count' | 'effort' | 'own';
    /** Leaf tasks counted (CANCELLED ones are left out). */
    tasks: number;
    /** Of those, how many are DONE. */
    done: number;
    /** Leaf tasks with no EFFORT, given the default effort (effort method only). */
    unestimated: number;
    /** Share of the row's span that has passed by today, 0-100. */
    expected: number;
}

/** Fields every row has. */
interface GanttRowBase {
    /** Stable key, used to fold the row. */
    key: string;
    /** Nesting depth: 1 for group headers and top-level headings, 0 for file rows in an outline. */
    depth: number;
    progress?: GanttProgress;
    /** Done share trails the elapsed share of the span (see behindTolerance). */
    behind?: boolean;
    /** Has rows below it that folding can hide. */
    collapsible?: boolean;
    /** Folded: the rows below it are hidden. */
    collapsed?: boolean;
}

export interface GanttTaskRow extends GanttRowBase {
    kind: 'task';
    title: string;
    todo?: string;
    priority?: string;
    assignees: string[];
    tags: string[];
    /** File relative to the project root. */
    file: string;
    /** Absolute path and 1-based line, for jumping to the task. */
    filePath: string;
    line: number;
    effortMinutes?: number;
    /** yyyy-mm-dd; end is exclusive. */
    start: string;
    end: string;
    milestone: boolean;
    status: GanttStatus;
    ganttId: string;
    /** ganttIds of the shown tasks this one depends on. */
    dependsOn: string[];
    deadline?: string;
    /** The bar ends on its DEADLINE, so dragging its end changes the deadline. */
    endsAtDeadline: boolean;
    /** Has subtasks: the bar spans them and shows their progress, so it is not dragged. */
    summary?: boolean;
}

export interface GanttGroupRow extends GanttRowBase {
    kind: 'group';
    label: string;
    /** Summary bar over the group's tasks (with progress on); end exclusive. */
    start?: string;
    end?: string;
    /** For outline headings: where the heading is. */
    filePath?: string;
    line?: number;
}

export type GanttRow = GanttTaskRow | GanttGroupRow;

export interface GanttModel {
    rows: GanttRow[];
    /** yyyy-mm-dd range covering every bar, padded a little; end exclusive. */
    start: string;
    end: string;
    today: string;
    /** Every assignee handle in the project (for the filter menu). */
    assignees: string[];
    /** Every tag in the project (for the filter menu). */
    tags: string[];
    /** Every file with tasks, relative to root (for the files menu). */
    files: string[];
    groupBy: GanttGroupBy;
    /** Progress is shown. */
    progress: boolean;
    /** How rollups were weighted, when progress is shown. */
    progressMethod?: 'count' | 'effort';
    /** Rows shown that are behind. */
    behindCount: number;
    /** Tasks that pass the filters, before folding hides any. */
    shownTasks: number;
}

export function isoDay(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseIsoDay(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function shiftDays(d: Date, n: number): Date {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + n);
    return r;
}

/** Whole days from a to b (both local dates). */
export function daysBetween(a: Date, b: Date): number {
    const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
}

function groupLabel(t: GanttTaskInput, groupBy: GanttGroupBy, root?: string): string {
    switch (groupBy) {
        case 'assignee': return t.assignees[0] || 'Unassigned';
        case 'file': return relFile(t.file, root);
        case 'parent': return t.parentTitle || 'Top level';
        default: return '';
    }
}

/** File relative to the project root, with / separators on every system. */
function relFile(file: string, root?: string): string {
    const rel = root ? path.relative(root, file) || path.basename(file) : path.basename(file);
    return rel.split(path.sep).join('/');
}

const taskKey = (file: string, line: number) => `${file}:${line}`;

/** The span covering all of `spans`, at least a day long; undefined if empty. */
function envelope(spans: TaskSpan[]): TaskSpan | undefined {
    if (!spans.length) return undefined;
    let start = spans[0].start;
    let end = spans[0].end;
    for (const s of spans) {
        if (s.start < start) start = s.start;
        if (s.end > end) end = s.end;
    }
    if (end <= start) end = shiftDays(start, 1);
    return { start, end, milestone: false };
}

/** Share of a span that has passed by today, 0-100. */
function expectedPercent(span: TaskSpan, today: Date): number {
    const total = daysBetween(span.start, span.end);
    const elapsed = daysBetween(span.start, today);
    if (total <= 0) return elapsed >= 0 ? 100 : 0;
    return Math.max(0, Math.min(100, (100 * elapsed) / total));
}

/** Build the rows the view shows for these tasks and options. */
export function buildGanttModel(
    tasks: GanttTaskInput[],
    options: GanttOptions = {},
    today: Date = new Date()
): GanttModel {
    const spans = scheduleProjectTasks(tasks, today);
    const todayDay = shiftDays(today, 0);
    const groupBy = options.groupBy ?? 'none';
    const showProgress = !!options.showProgress;
    const tolerance = options.behindTolerance ?? 10;
    const defaultEffort = options.defaultEffortMinutes && options.defaultEffortMinutes > 0
        ? options.defaultEffortMinutes : 8 * 60;

    // Scoped: the file, assignee and tag filters. Rollups count these, done
    // or not; shown also drops done tasks unless they are wanted.
    const wantedTags = new Set(options.tags ?? []);
    const hiddenFiles = new Set(options.hiddenFiles ?? []);
    const scoped = tasks.filter(t => {
        if (hiddenFiles.size && hiddenFiles.has(relFile(t.file, options.root))) return false;
        if (wantedTags.size && !t.tags.some(tag => wantedTags.has(tag))) return false;
        if (options.assignee === undefined) return true;
        return options.assignee === '' ? t.assignees.length === 0 : t.assignees.includes(options.assignee);
    });
    const shown = scoped.filter(t => options.showDone || !t.isDone);
    const shownGanttIds = new Set(shown.map(t => t.ganttId));
    const ganttIdOfId = new Map<string, string>();
    for (const t of tasks) if (t.id) ganttIdOfId.set(t.id, t.ganttId);

    // The scoped tasks under each heading (by file:line), at any depth.
    const under = new Map<string, GanttTaskInput[]>();
    for (const t of scoped) {
        for (const a of t.ancestors ?? []) {
            const k = taskKey(t.file, a.line);
            if (!under.has(k)) under.set(k, []);
            under.get(k)!.push(t);
        }
    }
    const below = (k: string) => under.get(k) ?? [];
    const isLeaf = (t: GanttTaskInput) => !under.has(taskKey(t.file, t.line));
    const leavesOf = (t: GanttTaskInput) => isLeaf(t) ? [t] : below(taskKey(t.file, t.line)).filter(isLeaf);

    // Effort weighting when asked, or (auto) when most leaf tasks have an effort.
    const countedLeaves = scoped.filter(t => isLeaf(t) && !t.cancelled);
    const estimated = countedLeaves.filter(t => t.effortMinutes).length;
    const weighting = options.progressWeighting ?? 'auto';
    const method: 'count' | 'effort' = weighting === 'auto'
        ? (countedLeaves.length > 0 && estimated * 2 >= countedLeaves.length ? 'effort' : 'count')
        : weighting;

    const rollup = (leaves: GanttTaskInput[], span: TaskSpan): GanttProgress | undefined => {
        const counted = [...new Set(leaves)].filter(t => !t.cancelled);
        if (!counted.length) return undefined;
        let total = 0, doneWeight = 0, done = 0, unestimated = 0;
        for (const t of counted) {
            let w = 1;
            if (method === 'effort') {
                w = t.effortMinutes || defaultEffort;
                if (!t.effortMinutes) unestimated++;
            }
            const f = t.isDone ? 1 : (t.progress ?? 0) / 100;
            if (t.isDone) done++;
            total += w;
            doneWeight += w * f;
        }
        return {
            percent: (100 * doneWeight) / total,
            method, tasks: counted.length, done, unestimated,
            expected: expectedPercent(span, todayDay),
        };
    };

    const isBehind = (p: GanttProgress | undefined, span: TaskSpan, finished: boolean): boolean => {
        if (!p || finished || p.percent >= 100) return false;
        if (todayDay >= span.end) return true;
        if (todayDay <= span.start) return false;
        return p.percent < p.expected - tolerance;
    };

    const hasOwnPlan = (t: GanttTaskInput) => !!(t.scheduled || t.deadline || t.effortMinutes);
    /** Bars under a heading: leaves, and planned tasks that have subtasks; not dropped work. */
    const spansBelow = (k: string) => below(k)
        .filter(t => !t.cancelled && (isLeaf(t) || hasOwnPlan(t)))
        .map(t => spans.get(t.ganttId)!);

    const toRow = (t: GanttTaskInput, depth: number): GanttTaskRow => {
        const k = taskKey(t.file, t.line);
        const summary = showProgress && !isLeaf(t);
        let span = spans.get(t.ganttId)!;
        if (summary) span = envelope([...(hasOwnPlan(t) ? [span] : []), ...spansBelow(k)]) ?? span;

        let status: GanttStatus = 'planned';
        if (t.isDone) status = 'done';
        else if (t.blocked) status = 'blocked';
        // In progress only when its own SCHEDULED date has come; a bar placed
        // at the project start or after its dependencies has not started.
        else if (t.scheduled && !span.milestone && span.start <= todayDay) status = 'active';

        let progress: GanttProgress | undefined;
        if (summary) {
            progress = rollup(leavesOf(t), span);
        } else if (showProgress && t.progress !== undefined && !t.isDone && !span.milestone) {
            progress = {
                percent: t.progress, method: 'own', tasks: 1, done: 0, unestimated: 0,
                expected: expectedPercent(span, todayDay),
            };
        }
        return {
            kind: 'task',
            key: k,
            depth,
            title: t.title,
            todo: t.todo,
            priority: t.priority,
            assignees: t.assignees,
            tags: t.tags,
            file: relFile(t.file, options.root),
            filePath: t.file,
            line: t.line,
            effortMinutes: t.effortMinutes,
            start: isoDay(span.start),
            end: isoDay(span.end),
            milestone: span.milestone,
            status,
            ganttId: t.ganttId,
            dependsOn: t.dependsIds
                .map(id => ganttIdOfId.get(id))
                .filter((g): g is string => !!g && shownGanttIds.has(g)),
            deadline: t.deadline ? isoDay(t.deadline) : undefined,
            endsAtDeadline: !summary && !span.milestone && !!t.deadline && isoDay(shiftDays(t.deadline, 1)) === isoDay(span.end),
            summary: summary || undefined,
            progress,
            behind: isBehind(progress, span, t.isDone),
        };
    };

    /** A header row; with progress on, a summary bar over `barSpans` showing `leaves`. */
    const groupRow = (
        key: string, label: string, depth: number,
        leaves: GanttTaskInput[], barSpans: TaskSpan[],
        where?: { filePath: string; line?: number }
    ): GanttGroupRow => {
        const row: GanttGroupRow = { kind: 'group', key, label, depth, ...where };
        if (!showProgress) return row;
        const span = envelope(barSpans);
        if (!span) return row;
        row.start = isoDay(span.start);
        row.end = isoDay(span.end);
        row.progress = rollup(leaves, span);
        row.behind = isBehind(row.progress, span, false);
        return row;
    };

    // Tasks with a deadline come first, then the ones without, each by start.
    const byStart = (a: GanttTaskRow, b: GanttTaskRow) =>
        Number(!a.deadline) - Number(!b.deadline) ||
        a.start.localeCompare(b.start) || a.file.localeCompare(b.file) || a.line - b.line;

    let rows: GanttRow[] = [];
    if (groupBy === 'none') {
        rows.push(...shown.map(t => toRow(t, 1)).sort(byStart));
    } else if (groupBy === 'outline') {
        rows = outlineRows();
    } else {
        const groups = new Map<string, GanttTaskInput[]>();
        for (const t of shown) {
            const label = groupLabel(t, groupBy, options.root);
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label)!.push(t);
        }
        const last = groupBy === 'assignee' ? 'Unassigned' : 'Top level';
        const labels = [...groups.keys()].sort((a, b) =>
            a === last ? 1 : b === last ? -1 : a.localeCompare(b)
        );
        for (const label of labels) {
            const members = groups.get(label)!.map(t => toRow(t, 2)).sort(byStart);
            // Parent groups hold a heading's direct children, so count what is
            // under each; assignee and file groups count their own leaf tasks.
            const leaves = groupBy === 'parent'
                ? scoped.filter(t => groupLabel(t, groupBy) === label).flatMap(leavesOf)
                : scoped.filter(t => isLeaf(t) && groupLabel(t, groupBy, options.root) === label);
            const barSpans = [
                ...members.map(r => ({ start: parseIsoDay(r.start), end: parseIsoDay(r.end), milestone: r.milestone })),
                ...leaves.filter(t => !t.cancelled).map(t => spans.get(t.ganttId)!),
            ];
            rows.push(groupRow(`g:${label}`, label, 1, leaves, barSpans));
            rows.push(...members);
        }
    }

    /**
     * Rows in outline order: per file (with a file row when there are
     * several), each shown task under the headings above it. Headings that
     * are not shown tasks become header rows.
     */
    function outlineRows(): GanttRow[] {
        const out: GanttRow[] = [];
        const files = [...new Set(shown.map(t => t.file))].sort();
        for (const file of files) {
            if (files.length > 1) {
                const leaves = scoped.filter(t => t.file === file && isLeaf(t));
                out.push(groupRow(`f:${file}`, relFile(file, options.root), 0, leaves,
                    scoped.filter(t => t.file === file && !t.cancelled && (isLeaf(t) || hasOwnPlan(t))).map(t => spans.get(t.ganttId)!),
                    { filePath: file }));
            }
            // Every heading line with what to draw for it.
            const entries = new Map<number, { depth: number; title: string; task?: GanttTaskInput }>();
            for (const t of shown.filter(t => t.file === file)) {
                const ancestors = t.ancestors ?? [];
                ancestors.forEach((a, i) => {
                    if (!entries.has(a.line)) entries.set(a.line, { depth: i + 1, title: a.title });
                });
                entries.set(t.line, { depth: ancestors.length + 1, title: t.title, task: t });
            }
            for (const line of [...entries.keys()].sort((a, b) => a - b)) {
                const e = entries.get(line)!;
                if (e.task) {
                    out.push(toRow(e.task, e.depth));
                } else {
                    const k = taskKey(file, line);
                    out.push(groupRow(k, e.title, e.depth, below(k).filter(isLeaf), spansBelow(k), { filePath: file, line }));
                }
            }
        }
        return out;
    }

    rows = foldRows(rows, options);
    if (options.behindOnly) rows = behindWithContext(rows);

    // Range: every shown bar plus today, padded so bars do not touch the edges.
    let min = todayDay;
    let max = shiftDays(todayDay, 1);
    for (const r of rows) {
        if (!r.start || !r.end) continue;
        const s = parseIsoDay(r.start);
        const e = parseIsoDay(r.end);
        if (s < min) min = s;
        if (e > max) max = e;
    }

    const assignees = [...new Set(tasks.flatMap(t => t.assignees))].sort();
    const tags = [...new Set(tasks.flatMap(t => t.tags))].sort((a, b) => a.localeCompare(b));
    const files = [...new Set(tasks.map(t => relFile(t.file, options.root)))].sort();
    return {
        rows,
        start: isoDay(shiftDays(min, -2)),
        end: isoDay(shiftDays(max, 3)),
        today: isoDay(todayDay),
        assignees,
        tags,
        files,
        groupBy,
        progress: showProgress,
        progressMethod: showProgress ? method : undefined,
        behindCount: rows.filter(r => r.behind).length,
        shownTasks: shown.length,
    };
}

/**
 * Mark rows that have deeper rows after them as foldable, then drop the rows
 * below folded rows and rows deeper than maxDepth.
 */
function foldRows(rows: GanttRow[], options: GanttOptions): GanttRow[] {
    const collapsed = new Set(options.collapsed ?? []);
    const maxDepth = options.maxDepth && options.maxDepth > 0 ? options.maxDepth : Infinity;
    const out: GanttRow[] = [];
    let hideBelow = Infinity;
    rows.forEach((row, i) => {
        if (row.depth <= hideBelow) hideBelow = Infinity;
        if (row.depth > hideBelow || row.depth > maxDepth) return;
        const next = rows[i + 1];
        if (next && next.depth > row.depth) {
            // At maxDepth, its children are hidden whatever is folded.
            row.collapsible = row.depth < maxDepth;
            row.collapsed = row.depth >= maxDepth || collapsed.has(row.key);
            if (collapsed.has(row.key)) hideBelow = row.depth;
        }
        out.push(row);
    });
    return out;
}

/** The behind rows, and the rows above each one (shallower, before it) for context. */
function behindWithContext(rows: GanttRow[]): GanttRow[] {
    const keep = new Set<number>();
    const stack: number[] = [];
    rows.forEach((row, i) => {
        while (stack.length && rows[stack[stack.length - 1]].depth >= row.depth) stack.pop();
        if (row.behind) {
            keep.add(i);
            for (const j of stack) keep.add(j);
        }
        stack.push(i);
    });
    const out = rows.filter((_, i) => keep.has(i));
    // A row whose rows below were all filtered out has nothing left to fold.
    out.forEach((row, i) => {
        if (row.collapsible && !row.collapsed && !(out[i + 1]?.depth > row.depth)) row.collapsible = false;
    });
    return out;
}

// =============================================================================
// Excel (.xlsx)
// =============================================================================

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function xmlEscape(s: string): string {
    return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!))
        // Control characters are not allowed in XML 1.0, so they are the point here.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Spreadsheet column letters for a 0-based index (0 -> A, 26 -> AA). */
export function columnName(index: number): string {
    let name = '';
    let n = index + 1;
    while (n > 0) {
        const r = (n - 1) % 26;
        name = String.fromCharCode(65 + r) + name;
        n = Math.floor((n - 1) / 26);
    }
    return name;
}

/** Excel's serial day number for a local date (1900 date system). */
function excelSerial(d: Date): number {
    return daysBetween(new Date(1899, 11, 30), d);
}

/** Style indices into cellXfs in STYLES_XML. */
const XF = {
    text: 0, header: 1, date: 2, group: 3,
    done: 4, blocked: 5, active: 6, planned: 7, milestone: 8,
    weekend: 9, todayHeader: 10, dayHeader: 11,
    summary: 12, hatchSummary: 17, behind: 18, percent: 19,
} as const;

const STATUS_XF: Record<GanttStatus, number> = {
    done: XF.done, blocked: XF.blocked, active: XF.active, planned: XF.planned,
};

/** The same colours, hatched: the done share of a bar. */
const HATCH_XF: Record<GanttStatus, number> = {
    done: 13, blocked: 14, active: 15, planned: 16,
};

const STYLES_XML = XML_HEADER + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><sz val="8"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFC55A11"/><name val="Calibri"/></font>
</fonts>
<fills count="17">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF70AD47"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE15759"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF9DC3E6"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF8497B0"/></patternFill></fill>
<fill><patternFill patternType="darkUp"><fgColor rgb="FF3E6B22"/><bgColor rgb="FF70AD47"/></patternFill></fill>
<fill><patternFill patternType="darkUp"><fgColor rgb="FF8B2425"/><bgColor rgb="FFE15759"/></patternFill></fill>
<fill><patternFill patternType="darkUp"><fgColor rgb="FF1F3864"/><bgColor rgb="FF4472C4"/></patternFill></fill>
<fill><patternFill patternType="darkUp"><fgColor rgb="FF2E5B8A"/><bgColor rgb="FF9DC3E6"/></patternFill></fill>
<fill><patternFill patternType="darkUp"><fgColor rgb="FF333F50"/><bgColor rgb="FF8497B0"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBE5D6"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="20">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="9" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="7" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="8" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="10" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="11" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="12" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="13" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="14" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="15" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="16" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const TABLE_COLUMNS = ['Task', 'File', 'State', 'Pri', 'Who', 'Effort (h)', 'Start', 'End', 'Blocked'];
const PROGRESS_COLUMNS = ['% done', 'Status'];

/** What the Status column says for a row with progress shown. */
function statusText(row: GanttRow): string {
    if (row.behind) return 'behind';
    if (row.kind === 'task' && row.status === 'done') return 'done';
    if (row.progress) return row.progress.percent >= 100 ? 'done' : 'on track';
    return '';
}

/** Leading spaces that show an outline row's depth in a text-only cell. */
function outlineIndent(model: GanttModel, row: GanttRow): string {
    return model.groupBy === 'outline' ? '   '.repeat(Math.max(0, row.depth - 1)) : '';
}

/**
 * An Excel workbook with one sheet: the task table on the left and a day-by-day
 * timeline on the right, each task's days filled in its status colour. Start
 * and End are real dates (End is the last day of the task, inclusive).
 */
export async function ganttToXlsx(model: GanttModel, title = 'Project'): Promise<Buffer> {
    const start = parseIsoDay(model.start);
    const days = daysBetween(start, parseIsoDay(model.end));
    const columns = model.progress ? [...TABLE_COLUMNS, ...PROGRESS_COLUMNS] : TABLE_COLUMNS;
    const pctCol = TABLE_COLUMNS.length;
    const firstDayCol = columns.length;
    const today = model.today;

    const rowsXml: string[] = [];
    const cell = (col: number, row: number, body: string, style = 0, type?: string) =>
        `<c r="${columnName(col)}${row}"${style ? ` s="${style}"` : ''}${type ? ` t="${type}"` : ''}>${body}</c>`;
    const text = (col: number, row: number, s: string, style = 0) =>
        cell(col, row, `<is><t xml:space="preserve">${xmlEscape(s)}</t></is>`, style, 'inlineStr');
    const num = (col: number, row: number, n: number, style = 0) => cell(col, row, `<v>${n}</v>`, style);

    // Row 1: title and month labels. Row 2: headers and day numbers.
    const r1: string[] = [text(0, 1, title, XF.header)];
    const r2: string[] = columns.map((h, i) => text(i, 2, h, XF.header));
    let lastMonth = -1;
    for (let i = 0; i < days; i++) {
        const d = shiftDays(start, i);
        if (d.getMonth() !== lastMonth) {
            r1.push(text(firstDayCol + i, 1, d.toLocaleString('en-US', { month: 'short', year: 'numeric' }), XF.header));
            lastMonth = d.getMonth();
        }
        r2.push(num(firstDayCol + i, 2, d.getDate(), isoDay(d) === today ? XF.todayHeader : XF.dayHeader));
    }
    rowsXml.push(`<row r="1">${r1.join('')}</row>`, `<row r="2">${r2.join('')}</row>`);

    /** Day cells of a bar from `s` to `e` (exclusive), its done share hatched. */
    const barCells = (r: number, s: Date, e: Date, solid: number, hatch: number, percent: number | undefined): string[] => {
        const out: string[] = [];
        const from = daysBetween(start, s);
        const to = daysBetween(start, e);
        const doneTo = percent === undefined ? from : from + Math.round(((to - from) * Math.min(100, percent)) / 100);
        for (let i = 0; i < days; i++) {
            const d = shiftDays(start, i);
            const col = firstDayCol + i;
            if (i >= from && i < to) out.push(cell(col, r, '', i < doneTo ? hatch : solid));
            else if (d.getDay() === 0 || d.getDay() === 6) out.push(cell(col, r, '', XF.weekend));
        }
        return out;
    };
    const progressCells = (r: number, row: GanttRow): string[] => {
        if (!model.progress) return [];
        const out: string[] = [];
        if (row.progress) out.push(num(pctCol, r, Math.round(row.progress.percent) / 100, XF.percent));
        const status = statusText(row);
        if (status) out.push(text(pctCol + 1, r, status, row.behind ? XF.behind : 0));
        return out;
    };

    let r = 3;
    for (const row of model.rows) {
        if (row.kind === 'group') {
            const cells = [text(0, r, outlineIndent(model, row) + row.label, XF.group)];
            if (row.start && row.end) {
                const s = parseIsoDay(row.start);
                const e = parseIsoDay(row.end);
                cells.push(num(6, r, excelSerial(s), XF.date), num(7, r, excelSerial(shiftDays(e, -1)), XF.date));
                cells.push(...progressCells(r, row));
                cells.push(...barCells(r, s, e, XF.summary, XF.hatchSummary, row.progress?.percent));
            }
            rowsXml.push(`<row r="${r}">${cells.join('')}</row>`);
            r++;
            continue;
        }
        const cells: string[] = [
            text(0, r, outlineIndent(model, row) + row.title),
            text(1, r, row.file),
            text(2, r, row.todo ?? ''),
            text(3, r, row.priority ?? ''),
            text(4, r, row.assignees.join(', ')),
        ];
        if (row.effortMinutes) cells.push(num(5, r, Math.round(row.effortMinutes / 6) / 10));
        const s = parseIsoDay(row.start);
        const e = parseIsoDay(row.end);
        cells.push(num(6, r, excelSerial(s), XF.date));
        cells.push(num(7, r, excelSerial(row.milestone ? e : shiftDays(e, -1)), XF.date));
        if (row.status === 'blocked') cells.push(text(8, r, 'yes'));
        cells.push(...progressCells(r, row));

        if (row.milestone) {
            const at = daysBetween(start, s);
            for (let i = 0; i < days; i++) {
                const d = shiftDays(start, i);
                const col = firstDayCol + i;
                if (i === at) cells.push(text(col, r, '◆', XF.milestone));
                else if (d.getDay() === 0 || d.getDay() === 6) cells.push(cell(col, r, '', XF.weekend));
            }
        } else {
            cells.push(...barCells(r, s, e, STATUS_XF[row.status], HATCH_XF[row.status], row.progress?.percent));
        }
        rowsXml.push(`<row r="${r}">${cells.join('')}</row>`);
        r++;
    }

    const lastCol = columnName(firstDayCol + Math.max(0, days - 1));
    const sheet = XML_HEADER + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastCol}${Math.max(2, r - 1)}"/>
<sheetViews><sheetView workbookViewId="0"><pane xSplit="${firstDayCol}" ySplit="2" topLeftCell="${columnName(firstDayCol)}3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>
<col min="1" max="1" width="40" customWidth="1"/>
<col min="2" max="2" width="18" customWidth="1"/>
<col min="3" max="6" width="9" customWidth="1"/>
<col min="7" max="8" width="11" customWidth="1"/>
<col min="9" max="9" width="8" customWidth="1"/>
${model.progress ? '<col min="10" max="11" width="9" customWidth="1"/>' : ''}
<col min="${firstDayCol + 1}" max="${firstDayCol + Math.max(1, days)}" width="3" customWidth="1"/>
</cols>
<sheetData>${rowsXml.join('\n')}</sheetData>
</worksheet>`;

    // Loaded here rather than with the extension: only the Excel export needs it.
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', XML_HEADER + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
    zip.file('_rels/.rels', XML_HEADER + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    zip.file('xl/workbook.xml', XML_HEADER + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Gantt" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', XML_HEADER + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
    zip.file('xl/styles.xml', STYLES_XML);
    zip.file('xl/worksheets/sheet1.xml', sheet);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// =============================================================================
// PDF
// =============================================================================

/** RGB 0-1 fills, matching the webview and the workbook. */
const PDF_COLOURS: Record<GanttStatus | 'milestone' | 'grid' | 'weekend' | 'today' | 'group' | 'text' | 'summary' | 'behind', [number, number, number]> = {
    done: [0.44, 0.68, 0.28],
    blocked: [0.88, 0.34, 0.35],
    active: [0.27, 0.45, 0.77],
    planned: [0.62, 0.76, 0.90],
    milestone: [1.0, 0.75, 0.0],
    grid: [0.85, 0.85, 0.85],
    weekend: [0.95, 0.95, 0.95],
    today: [0.86, 0.15, 0.15],
    group: [0.88, 0.88, 0.88],
    text: [0.1, 0.1, 0.1],
    summary: [0.52, 0.59, 0.69],
    behind: [0.93, 0.49, 0.19],
};

type Rgb = [number, number, number];
/** A colour darkened, for the hatch over it. */
const darker = (c: Rgb): Rgb => [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45];

/**
 * Text for a PDF string in WinAnsiEncoding (Helvetica): escape the delimiters,
 * keep Latin-1, and replace anything else (emoji, CJK) with '?'.
 */
function pdfText(s: string): string {
    let out = '';
    for (const ch of s) {
        const code = ch.codePointAt(0)!;
        if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
        else if (code >= 32 && code < 127) out += ch;
        else if (code >= 160 && code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
        else if (ch === '—' || ch === '–') out += '-';
        else out += '?';
    }
    return out;
}

/** Shorten text to roughly fit width points at a Helvetica size. */
function fitText(s: string, width: number, size: number): string {
    const max = Math.floor(width / (size * 0.5));
    return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + '.';
}

/**
 * A one-page vector PDF of the chart: task names on the left, a day grid with
 * weekends shaded, coloured bars, milestones as diamonds, dependency lines and
 * today's line. The page grows to fit the rows and days, so nothing is cut off;
 * viewers and printers scale it to the paper.
 */
export function ganttToPdf(model: GanttModel, title = 'Project'): Buffer {
    const start = parseIsoDay(model.start);
    const days = Math.max(1, daysBetween(start, parseIsoDay(model.end)));
    const labelW = 260;
    const margin = 36;
    const rowH = 16;
    const headerH = 54;
    const dayW = Math.max(6, Math.min(24, 540 / days));
    const chartW = days * dayW;
    const pageW = Math.min(14400, Math.max(792, margin * 2 + labelW + chartW));
    const pageH = Math.min(14400, Math.max(612, margin * 2 + headerH + model.rows.length * rowH + 30));

    const ops: string[] = [];
    // PDF y grows upwards; work in top-down coordinates and flip here.
    const y = (top: number) => pageH - top;
    const fill = (c: [number, number, number]) => ops.push(`${c.map(v => v.toFixed(3)).join(' ')} rg`);
    const stroke = (c: [number, number, number]) => ops.push(`${c.map(v => v.toFixed(3)).join(' ')} RG`);
    const rect = (x: number, top: number, w: number, h: number) =>
        ops.push(`${x.toFixed(2)} ${y(top + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    const line = (x1: number, t1: number, x2: number, t2: number, width = 0.5) =>
        ops.push(`${width} w ${x1.toFixed(2)} ${y(t1).toFixed(2)} m ${x2.toFixed(2)} ${y(t2).toFixed(2)} l S`);
    const textAt = (x: number, top: number, s: string, size = 9, bold = false) =>
        ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y(top).toFixed(2)} Td (${pdfText(s)}) Tj ET`);
    /** Diagonal stripes clipped to a rectangle. */
    const hatch = (x: number, top: number, w: number, h: number, c: Rgb) => {
        if (w <= 0) return;
        ops.push(`q ${x.toFixed(2)} ${y(top + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re W n`);
        stroke(c);
        for (let sx = x - h; sx < x + w; sx += 3) line(sx, top + h, sx + h, top, 0.9);
        ops.push('Q');
    };
    const dot = (cx: number, cy: number, r: number) => {
        // A circle from four Bezier curves.
        const k = r * 0.5523;
        const p = (px: number, py: number) => `${px.toFixed(2)} ${y(py).toFixed(2)}`;
        ops.push(`${p(cx + r, cy)} m ${p(cx + r, cy - k)} ${p(cx + k, cy - r)} ${p(cx, cy - r)} c ` +
            `${p(cx - k, cy - r)} ${p(cx - r, cy - k)} ${p(cx - r, cy)} c ` +
            `${p(cx - r, cy + k)} ${p(cx - k, cy + r)} ${p(cx, cy + r)} c ` +
            `${p(cx + k, cy + r)} ${p(cx + r, cy + k)} ${p(cx + r, cy)} c f`);
    };
    const todayOffset = daysBetween(start, parseIsoDay(model.today));
    const todayX = margin + labelW + todayOffset * dayW;
    /** A bar's done share hatched, its percent after it, and the behind band under it. */
    const progressBits = (row: GanttRow, x1: number, x2: number, top: number, colour: Rgb) => {
        const p = row.progress;
        if (!p) return;
        const doneX = x1 + ((x2 - x1) * Math.min(100, p.percent)) / 100;
        hatch(x1 + 0.5, top + 3, doneX - x1 - 0.5, rowH - 6, darker(colour));
        if (p.percent > 0 && p.percent < 100) {
            stroke(darker(colour));
            line(doneX, top + 3, doneX, top + rowH - 3, 1);
        }
        fill(PDF_COLOURS.text);
        textAt(x2 + 3, top + 11, `${Math.round(p.percent)}%`, 7, true);
        if (row.behind) {
            fill(PDF_COLOURS.behind);
            const to = Math.min(todayX, x2);
            rect(doneX, top + rowH - 2.6, Math.max(1.5, to - doneX), 1.6);
        }
    };
    const indentOf = (row: GanttRow) => model.groupBy === 'outline' ? Math.max(0, row.depth - 1) * 8 : 0;
    const behindDot = (row: GanttRow, top: number) => {
        if (!row.behind) return;
        fill(PDF_COLOURS.behind);
        dot(margin + labelW - 7, top + rowH / 2, 2.5);
    };

    const chartX = margin + labelW;
    const bodyTop = margin + headerH;
    const bodyH = model.rows.length * rowH;

    fill(PDF_COLOURS.text);
    textAt(margin, margin + 14, title, 14, true);

    // Weekend shading and day grid.
    let lastMonth = -1;
    const labelEvery = dayW >= 14 ? 1 : dayW >= 8 ? 2 : 7;
    for (let i = 0; i < days; i++) {
        const d = shiftDays(start, i);
        const x = chartX + i * dayW;
        if (d.getDay() === 0 || d.getDay() === 6) {
            fill(PDF_COLOURS.weekend);
            rect(x, bodyTop, dayW, bodyH);
        }
        fill(PDF_COLOURS.text);
        if (d.getMonth() !== lastMonth) {
            textAt(x + 1, margin + 34, d.toLocaleString('en-US', { month: 'short', year: 'numeric' }), 8, true);
            lastMonth = d.getMonth();
        }
        if (i % labelEvery === 0) textAt(x + 1, margin + 48, String(d.getDate()), 6);
    }
    stroke(PDF_COLOURS.grid);
    for (let i = 0; i <= days; i++) line(chartX + i * dayW, bodyTop, chartX + i * dayW, bodyTop + bodyH, 0.25);

    // Rows.
    const barOf = new Map<string, { x1: number; x2: number; mid: number }>();
    model.rows.forEach((row, index) => {
        const top = bodyTop + index * rowH;
        stroke(PDF_COLOURS.grid);
        line(margin, top + rowH, chartX + chartW, top + rowH, 0.25);
        const indent = indentOf(row);
        const labelRoom = labelW - 4 - indent - (row.behind ? 10 : 0);
        if (row.kind === 'group') {
            fill(PDF_COLOURS.group);
            rect(margin, top, labelW + chartW, rowH);
            fill(PDF_COLOURS.text);
            textAt(margin + 2 + indent, top + 11.5, fitText(row.label, labelRoom, 9), 9, true);
            behindDot(row, top);
            if (row.start && row.end) {
                const x1 = chartX + daysBetween(start, parseIsoDay(row.start)) * dayW;
                const x2 = chartX + daysBetween(start, parseIsoDay(row.end)) * dayW;
                fill(PDF_COLOURS.summary);
                rect(x1 + 0.5, top + 3, Math.max(1, x2 - x1 - 1), rowH - 6);
                progressBits(row, x1, x2, top, PDF_COLOURS.summary);
            }
            return;
        }
        fill(PDF_COLOURS.text);
        const prefix = row.status === 'blocked' ? '[blocked] ' : '';
        const who = row.assignees.length ? `  @${row.assignees.join(', @')}` : '';
        textAt(margin + 2 + indent, top + 11.5, fitText(`${row.todo ? row.todo + ' ' : ''}${prefix}${row.title}${who}`, labelRoom, 8), 8);
        behindDot(row, top);

        const s = daysBetween(start, parseIsoDay(row.start));
        const e = daysBetween(start, parseIsoDay(row.end));
        const mid = top + rowH / 2;
        if (row.milestone) {
            const cx = chartX + s * dayW + dayW / 2;
            const r = rowH * 0.35;
            fill(PDF_COLOURS.milestone);
            ops.push(`${cx.toFixed(2)} ${y(mid - r).toFixed(2)} m ${(cx + r).toFixed(2)} ${y(mid).toFixed(2)} l ` +
                `${cx.toFixed(2)} ${y(mid + r).toFixed(2)} l ${(cx - r).toFixed(2)} ${y(mid).toFixed(2)} l h f`);
            barOf.set(row.ganttId, { x1: cx - r, x2: cx + r, mid });
        } else {
            const x1 = chartX + s * dayW;
            const x2 = chartX + e * dayW;
            fill(PDF_COLOURS[row.status]);
            rect(x1 + 0.5, top + 3, Math.max(1, x2 - x1 - 1), rowH - 6);
            progressBits(row, x1, x2, top, PDF_COLOURS[row.status]);
            barOf.set(row.ganttId, { x1, x2, mid });
        }
    });

    // Dependency lines: from the end of the dependency to the start of the task.
    stroke([0.4, 0.4, 0.4]);
    for (const row of model.rows) {
        if (row.kind !== 'task') continue;
        const to = barOf.get(row.ganttId);
        for (const dep of row.dependsOn) {
            const from = barOf.get(dep);
            if (!from || !to) continue;
            const elbow = Math.max(from.x2 + 3, Math.min(to.x1 - 3, from.x2 + 6));
            line(from.x2, from.mid, elbow, from.mid);
            line(elbow, from.mid, elbow, to.mid);
            line(elbow, to.mid, to.x1, to.mid);
        }
    }

    // Today.
    if (todayOffset >= 0 && todayOffset <= days) {
        stroke(PDF_COLOURS.today);
        line(todayX, bodyTop - 4, todayX, bodyTop + bodyH, 1);
    }

    // Legend.
    let lx = margin;
    const legendTop = bodyTop + bodyH + 14;
    for (const [label, colour] of [['done', PDF_COLOURS.done], ['blocked', PDF_COLOURS.blocked], ['in progress', PDF_COLOURS.active], ['planned', PDF_COLOURS.planned], ['milestone', PDF_COLOURS.milestone]] as const) {
        fill(colour);
        rect(lx, legendTop - 7, 10, 8);
        fill(PDF_COLOURS.text);
        textAt(lx + 13, legendTop, label, 8);
        lx += 75;
    }
    if (model.progress) {
        fill(PDF_COLOURS.planned);
        rect(lx, legendTop - 7, 10, 8);
        hatch(lx, legendTop - 7, 10, 8, darker(PDF_COLOURS.planned));
        fill(PDF_COLOURS.text);
        textAt(lx + 13, legendTop, 'done share', 8);
        lx += 75;
        fill(PDF_COLOURS.summary);
        rect(lx, legendTop - 7, 10, 8);
        fill(PDF_COLOURS.text);
        textAt(lx + 13, legendTop, 'summary', 8);
        lx += 75;
        fill(PDF_COLOURS.behind);
        dot(lx + 4, legendTop - 3, 3);
        fill(PDF_COLOURS.text);
        textAt(lx + 13, legendTop, 'behind schedule', 8);
    }

    return assemblePdf(ops.join('\n'), pageW, pageH);
}

/** Wrap a content stream in the minimal objects a PDF needs. */
function assemblePdf(content: string, width: number, height: number): Buffer {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(0)} ${height.toFixed(0)}] ` +
            '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    ];
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(Buffer.byteLength(out, 'latin1'));
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}
