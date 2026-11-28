/**
 * The team view's model: each person's planned work, week by week, against
 * their capacity, across every project. Pure (no vscode), so it is tested
 * directly and the CLI could share it.
 *
 * Load: an open task's effort is spread evenly over the working days of its
 * scheduled span (scheduleProjectTasks, the same layout the Gantt chart
 * draws), and split evenly between its assignees. Work whose span lies before
 * the first week shown is overdue; work after the last week is later.
 *
 * Capacity: a person's :CAPACITY: (`32h/week`, `4d/week`, `80%` of a full
 * week, or plain hours), reduced on the working days they are away. Time away
 * is a subheading of the person titled "Away..." (or tagged :away:) with a
 * date range, `<2026-12-21 Mon>--<2027-01-01 Fri>`, or a single date.
 */

import { scheduleProjectTasks, type ProjectTask } from '../parser/projectTasks';

/** Hours in a full working week and day. */
export const WEEK_HOURS = 40;
export const DAY_HOURS = 8;

export interface TeamPerson {
    handle: string;
    name: string;
    role?: string;
    /** Planned hours a week, or undefined when :CAPACITY: is not set. */
    capacity?: number;
    /** Days away, as inclusive [start, end] ISO days. */
    away: Array<[string, string]>;
    filePath?: string;
    line?: number;
}

export interface TeamTask extends ProjectTask {
    file: string;
    /** The project the task belongs to (its folder's name, usually). */
    project: string;
}

/** One task's share of a person's work, in hours per week. */
export interface TeamTaskLoad {
    title: string;
    project: string;
    file: string;
    line: number;
    id?: string;
    todo?: string;
    blocked: boolean;
    /** The hours of this task assigned to this person. */
    hours: number;
    overdue: number;
    weeks: number[];
    later: number;
    start: string;
    end: string;
    deadline?: string;
    /** Other people on the task. */
    with: string[];
}

export interface TeamRow {
    handle: string;
    name: string;
    role?: string;
    /** True for a handle with no :person: heading, and for the unassigned row. */
    unknown: boolean;
    /** Hours a week from :CAPACITY:, or undefined. */
    capacityPerWeek?: number;
    capacity: Array<number | undefined>;
    /** Working days away in each week. */
    awayDays: number[];
    load: number[];
    overdue: number;
    later: number;
    /** Open tasks with no effort, by week they fall in (counted, not timed). */
    unestimated: number;
    tasks: TeamTaskLoad[];
    projects: string[];
    filePath?: string;
    line?: number;
}

export interface TeamModel {
    /** ISO Monday of each week shown. */
    weeks: string[];
    today: string;
    rows: TeamRow[];
    projects: string[];
    /** Open tasks considered, and how many had no assignee. */
    taskCount: number;
}

export interface TeamOptions {
    /** First day shown; moved back to its Monday. */
    start: Date;
    weeks: number;
    today?: Date;
    /** Only these projects (all when empty or undefined). */
    projects?: string[];
    /** Hours a week for a person without :CAPACITY: (undefined: unknown). */
    defaultCapacity?: number;
}

// ---- Dates ------------------------------------------------------------------------

const DAY_MS = 86400000;

function dayOf(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function isoDay(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** The Monday on or before `d`. */
export function mondayOf(d: Date): Date {
    const day = dayOf(d);
    return addDays(day, -((day.getDay() + 6) % 7));
}

function isWorkday(d: Date): boolean {
    return d.getDay() !== 0 && d.getDay() !== 6;
}

function daysBetween(a: Date, b: Date): number {
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

// ---- Capacity and time away -----------------------------------------------------------

/**
 * Hours a week from a :CAPACITY: value: `32h/week`, `32h`, `4d/week`, `4d`,
 * `80%` (of a 40-hour week), `0.5` (a fraction of a week) or `32` (hours).
 * Undefined when it can not be read.
 */
export function parseCapacity(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const v = value.trim().toLowerCase().replace(/\s*(\/|per)\s*(week|wk|w)$/, '');
    let m: RegExpMatchArray | null;
    if ((m = v.match(/^(\d+(?:\.\d+)?)\s*%$/))) return (Number(m[1]) / 100) * WEEK_HOURS;
    if ((m = v.match(/^(\d+(?:\.\d+)?)\s*h(ours?|rs?)?$/))) return Number(m[1]);
    if ((m = v.match(/^(\d+(?:\.\d+)?)\s*d(ays?)?$/))) return Number(m[1]) * DAY_HOURS;
    if ((m = v.match(/^(\d+(?:\.\d+)?)$/))) {
        const n = Number(m[1]);
        return n <= 1 ? n * WEEK_HOURS : n;
    }
    return undefined;
}

const HEADING = /^(\*+)\s+(.*)$/;
const TIMESTAMP = /<(\d{4}-\d{2}-\d{2})[^>]*>/g;

/**
 * The :person: headings' time away in org `lines`: subheadings of a person
 * titled "Away..." or tagged :away:, with the date range (or date) in their
 * title or text. Keyed by the person heading's 1-based line.
 */
export function readAway(lines: string[]): Map<number, Array<[string, string]>> {
    const result = new Map<number, Array<[string, string]>>();
    let person: { line: number; level: number } | undefined;
    let away: { level: number; dates: string[] } | undefined;
    const flush = () => {
        if (person && away && away.dates.length) {
            const list = result.get(person.line) ?? [];
            const [a, b] = [away.dates[0], away.dates[1] ?? away.dates[0]];
            list.push(a <= b ? [a, b] : [b, a]);
            result.set(person.line, list);
        }
        away = undefined;
    };
    lines.forEach((text, i) => {
        const h = text.match(HEADING);
        if (h) {
            flush();
            const level = h[1].length;
            if (person && level <= person.level) person = undefined;
            if (/:person:/i.test(h[2].match(/\s(:[\w@#%:]+:)\s*$/)?.[1] ?? '')) {
                person = { line: i + 1, level };
                return;
            }
            if (person && (/^(TODO\s+|DONE\s+)?away\b/i.test(h[2]) || /:away:\s*$/i.test(h[2]))) {
                away = { level, dates: [] };
                for (const m of h[2].matchAll(TIMESTAMP)) away.dates.push(m[1]);
            }
            return;
        }
        if (away && away.dates.length < 2) {
            for (const m of text.matchAll(TIMESTAMP)) away.dates.push(m[1]);
        }
    });
    flush();
    return result;
}

// ---- The model ----------------------------------------------------------------------------

/** Working days in [start, end) that fall in each week, before the first, and after the last. */
function spreadDays(start: Date, end: Date, weekStarts: Date[]): { overdue: number; weeks: number[]; later: number; total: number } {
    const weeks = weekStarts.map(() => 0);
    let overdue = 0;
    let later = 0;
    let total = 0;
    const first = weekStarts[0];
    const after = addDays(weekStarts[weekStarts.length - 1], 7);
    for (let d = dayOf(start); d < end; d = addDays(d, 1)) {
        if (!isWorkday(d)) continue;
        total++;
        if (d < first) overdue++;
        else if (d >= after) later++;
        else weeks[Math.floor(daysBetween(first, d) / 7)]++;
    }
    return { overdue, weeks, later, total };
}

/** Working days of `away` ranges in each week. */
function awayDaysByWeek(away: Array<[string, string]>, weekStarts: Date[]): number[] {
    return weekStarts.map(w => {
        let n = 0;
        for (let i = 0; i < 5; i++) {
            const d = isoDay(addDays(w, i));
            if (away.some(([a, b]) => d >= a && d <= b)) n++;
        }
        return n;
    });
}

const UNASSIGNED = '(unassigned)';

/**
 * Build the team view: one row per person (the :person: headings, then any
 * other assignee handles, then unassigned work), with their load and
 * capacity per week, and the tasks behind it.
 */
export function buildTeamModel(tasks: TeamTask[], people: TeamPerson[], options: TeamOptions): TeamModel {
    const today = dayOf(options.today ?? new Date());
    const first = mondayOf(options.start);
    const weekStarts = Array.from({ length: Math.max(1, options.weeks) }, (_, i) => addDays(first, 7 * i));
    const projectFilter = options.projects?.length ? new Set(options.projects) : undefined;

    // Lay out every task, so dependencies across projects place them, then keep the filtered ones.
    const spans = scheduleProjectTasks(tasks, today);
    const byId = new Map<string, ProjectTask>();
    for (const t of tasks) if (t.id) byId.set(t.id, t);

    const rows = new Map<string, TeamRow>();
    const row = (handle: string): TeamRow => {
        let r = rows.get(handle);
        if (!r) {
            const p = people.find(x => x.handle === handle);
            const cap = p?.capacity ?? options.defaultCapacity;
            const awayDays = awayDaysByWeek(p?.away ?? [], weekStarts);
            r = {
                handle,
                name: p?.name ?? (handle === UNASSIGNED ? 'Unassigned' : handle),
                role: p?.role,
                unknown: !p,
                capacityPerWeek: p ? cap : undefined,
                capacity: awayDays.map(a => (p && cap !== undefined ? (cap * (5 - a)) / 5 : undefined)),
                awayDays,
                load: weekStarts.map(() => 0),
                overdue: 0,
                later: 0,
                unestimated: 0,
                tasks: [],
                projects: [],
                filePath: p?.filePath,
                line: p?.line,
            };
            rows.set(handle, r);
        }
        return r;
    };
    for (const p of people) row(p.handle);

    const projects = new Set<string>();
    let taskCount = 0;
    for (const t of tasks) {
        projects.add(t.project);
        if (t.isDone || (projectFilter && !projectFilter.has(t.project))) continue;
        const span = spans.get(t.ganttId);
        if (!span || span.milestone) continue;
        taskCount++;
        const handles = t.assignees.length ? t.assignees : [UNASSIGNED];
        const blocked = t.dependsIds.some(id => {
            const dep = byId.get(id);
            return !dep || !dep.isDone;
        });
        const days = spreadDays(span.start, span.end, weekStarts);
        const hours = (t.effortMinutes ?? 0) / 60 / handles.length;
        const perDay = days.total ? hours / days.total : 0;
        for (const handle of handles) {
            const r = row(handle);
            if (!r.projects.includes(t.project)) r.projects.push(t.project);
            if (!t.effortMinutes) r.unestimated++;
            const load: TeamTaskLoad = {
                title: t.title,
                project: t.project,
                file: t.file,
                line: t.line,
                id: t.id,
                todo: t.todo,
                blocked,
                hours,
                overdue: days.overdue * perDay,
                weeks: days.weeks.map(n => n * perDay),
                later: days.later * perDay,
                start: isoDay(span.start),
                end: isoDay(addDays(span.end, -1)),
                deadline: t.deadline ? isoDay(t.deadline) : undefined,
                with: handles.filter(h => h !== handle && h !== UNASSIGNED),
            };
            // A span with no working day (a weekend) books its hours in the week it starts.
            if (!days.total) {
                const after = addDays(weekStarts[weekStarts.length - 1], 7);
                if (span.start < first) load.overdue = hours;
                else if (span.start >= after) load.later = hours;
                else load.weeks[Math.floor(daysBetween(first, span.start) / 7)] = hours;
            }
            r.overdue += load.overdue;
            r.later += load.later;
            load.weeks.forEach((h, i) => { r.load[i] += h; });
            r.tasks.push(load);
        }
    }

    const round = (n: number) => Math.round(n * 10) / 10;
    for (const r of rows.values()) {
        r.load = r.load.map(round);
        r.overdue = round(r.overdue);
        r.later = round(r.later);
        r.tasks.sort((a, b) => a.start.localeCompare(b.start) || a.project.localeCompare(b.project));
        r.projects.sort();
    }

    // People first (by name), then other handles, then unassigned work; rows with nothing to show last.
    const order = (r: TeamRow) => (r.handle === UNASSIGNED ? 2 : r.unknown ? 1 : 0);
    const list = [...rows.values()]
        .filter(r => r.handle !== UNASSIGNED || r.tasks.length)
        .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

    return {
        weeks: weekStarts.map(isoDay),
        today: isoDay(today),
        rows: list,
        projects: [...projects].sort(),
        taskCount,
    };
}

/** Parse an ISO day (for the webview's start control). */
export function parseIsoDay(s: string): Date {
    return parseIso(s);
}
