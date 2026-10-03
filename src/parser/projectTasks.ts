/**
 * Project-management view of org tasks, extracted from the parsed AST.
 *
 * This is the shared, synchronous, VS Code-free data layer behind the
 * `project-table` dynamic block and the project view. It reads a document's headlines
 * and resolves the fields project tooling cares about: TODO state, priority,
 * scheduled/deadline dates, effort estimate, assignees, and dependencies.
 *
 * Cross-file concerns (the people database, workspace-wide rollups) live in the
 * async DB layer (src/org/people.ts, src/org/projectQueries.ts); this module is
 * deliberately limited to a single parsed document so it can run inside the
 * synchronous dynamic-block generators.
 */
import type { OrgDocumentNode, HeadlineElement } from './orgElementTypes';
import { getHeadlinePath } from './orgModify';
import { parseEffort } from './orgClocking';

/** Done states recognized regardless of a file's #+TODO: line. */
const DEFAULT_DONE_STATES = new Set(['DONE', 'CANCELLED', 'CANCELED']);

export const ASSIGNEE_PROPERTY = 'ASSIGNEE';
export const DEPENDS_PROPERTY = 'DEPENDS';
export const PERSON_TAG = 'person';

export interface ProjectTask {
    /** The heading's :ID:, if any. */
    id?: string;
    title: string;
    level: number;
    todo?: string;
    isDone: boolean;
    priority?: string;
    scheduled?: Date;
    deadline?: Date;
    effortMinutes?: number;
    /** Assignee handles (from :ASSIGNEE: own+inherited and @tags). */
    assignees: string[];
    /** Tags, own and inherited (ancestors, #+FILETAGS), without @assignee tags. */
    tags: string[];
    /** Normalized ids this task depends on (from :DEPENDS:). */
    dependsIds: string[];
    /** 1-based line number of the heading. */
    line: number;
    /** File the task lives in (set when tasks span several files). */
    file?: string;
    /** Title of the nearest ancestor heading, if any. */
    parentTitle?: string;
    /** Stable id for the task in a chart (own id or a generated token). */
    ganttId: string;
}

/** Parse a :DEPENDS:/assignee list: whitespace or comma separated, id: stripped. */
function splitList(value: string | undefined): string[] {
    if (!value) return [];
    return value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

function parseDependsIds(value: string | undefined): string[] {
    return splitList(value).map(s => s.replace(/^id:/i, '')).filter(Boolean);
}

/** A url/handle-safe slug of a name, used as a fallback assignee handle. */
export function slugify(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function tsToDate(ts: any): Date | undefined {
    // TimestampObject stores components under properties.*Start.
    const p = ts?.properties ?? ts;
    if (!p || !p.yearStart || !p.monthStart || !p.dayStart) return undefined;
    return new Date(p.yearStart, p.monthStart - 1, p.dayStart, p.hourStart ?? 0, p.minuteStart ?? 0);
}

/** Read a property from a headline's drawer, case-insensitively. */
function drawerProp(headline: HeadlineElement, key: string): string | undefined {
    const drawer = headline.propertiesDrawer;
    if (!drawer) return undefined;
    if (drawer[key] !== undefined) return drawer[key];
    const lower = key.toLowerCase();
    for (const k of Object.keys(drawer)) {
        if (k.toLowerCase() === lower) return drawer[k];
    }
    return undefined;
}

/** Assignees declared directly on a headline: :ASSIGNEE: value plus @name tags. */
function ownAssignees(headline: HeadlineElement): string[] {
    const handles: string[] = [];
    for (const h of splitList(drawerProp(headline, ASSIGNEE_PROPERTY))) handles.push(h);
    for (const tag of headline.properties.tags || []) {
        if (tag.startsWith('@') && tag.length > 1) handles.push(tag.slice(1));
    }
    return handles;
}

/**
 * Assignee handles for a headline, with nearest-wins inheritance: the closest
 * ancestor (or the heading itself) that declares an assignee — via :ASSIGNEE:
 * or an @name tag — supplies the assignees. This matches org tag-inheritance
 * semantics, so tagging a subtree :@wei: assigns all its children to wei.
 */
export function getAssignees(doc: OrgDocumentNode, headline: HeadlineElement): string[] {
    const own = ownAssignees(headline);
    if (own.length) return [...new Set(own)];
    // Walk ancestors from nearest to root (getHeadlinePath is root→leaf).
    const path = getHeadlinePath(doc, headline);
    for (let i = path.length - 2; i >= 0; i--) {
        const inherited = ownAssignees(path[i]);
        if (inherited.length) return [...new Set(inherited)];
    }
    return [];
}

/** Split a #+FILETAGS value (":a:b:" or "a b") into tags. */
function fileTags(doc: OrgDocumentNode): string[] {
    const keywords = doc.keywords || {};
    const key = Object.keys(keywords).find(k => k.toUpperCase() === 'FILETAGS');
    return key ? keywords[key].split(/[:\s]+/).filter(Boolean) : [];
}

/**
 * A headline's tags with org's inheritance: #+FILETAGS, then each ancestor's
 * tags, then its own. @name tags are assignees, not tags, so they are left out.
 */
export function getInheritedTags(doc: OrgDocumentNode, headline: HeadlineElement): string[] {
    const tags = [...fileTags(doc)];
    for (const h of getHeadlinePath(doc, headline)) tags.push(...(h.properties.tags || []));
    return [...new Set(tags.filter(t => !t.startsWith('@')))];
}

export interface ExtractOptions {
    /** Only include headlines with a TODO keyword (default true). */
    todoOnly?: boolean;
    /** Restrict to this maximum heading level. */
    maxLevel?: number;
    /** Extra done-state keywords beyond the defaults. */
    doneStates?: Set<string>;
    /** File path recorded on each task. */
    file?: string;
    /**
     * Gantt id bookkeeping shared across calls, so tasks extracted from
     * several files get distinct ganttIds. Created per call when omitted.
     */
    ganttIds?: GanttIdState;
}

/** Gantt ids already handed out, and the counter for generated ones. */
export interface GanttIdState {
    used: Set<string>;
    counter: number;
}

/**
 * Extract project tasks from a set of headlines (already scoped by the caller).
 * Assigns a stable ganttId to each (its :ID:, else `t<index>`), de-duplicated.
 */
export function extractProjectTasks(
    doc: OrgDocumentNode,
    headlines: HeadlineElement[],
    options: ExtractOptions = {}
): ProjectTask[] {
    const todoOnly = options.todoOnly ?? true;
    const doneStates = options.doneStates
        ? new Set([...DEFAULT_DONE_STATES, ...options.doneStates])
        : DEFAULT_DONE_STATES;

    const tasks: ProjectTask[] = [];
    const taskHeadline: HeadlineElement[] = [];
    const ganttIds = options.ganttIds ?? { used: new Set<string>(), counter: 0 };

    for (const h of headlines) {
        const todo = h.properties.todoKeyword || undefined;
        if (todoOnly && !todo) continue;
        if (options.maxLevel && h.properties.level > options.maxLevel) continue;

        const id = drawerProp(h, 'ID')?.replace(/^id:/i, '');
        let ganttId = id && /^[A-Za-z0-9_-]+$/.test(id) ? id : `t${ganttIds.counter}`;
        while (ganttIds.used.has(ganttId)) ganttId = `t${ganttIds.counter}_${++ganttIds.counter}`;
        ganttIds.used.add(ganttId);
        ganttIds.counter++;

        const ancestors = getHeadlinePath(doc, h);
        const parent = ancestors.length >= 2 ? ancestors[ancestors.length - 2] : undefined;

        const effortRaw = h.properties.effort || drawerProp(h, 'EFFORT');
        const effortMinutes = effortRaw ? parseEffort(effortRaw) || undefined : undefined;

        tasks.push({
            id,
            // rawValue normally excludes the priority cookie, but strip a stray
            // leading [#A] defensively so it never leaks into tables or chart labels.
            title: (h.properties.rawValue || '').replace(/^\[#[A-Za-z0-9]\]\s*/, '').trim(),
            level: h.properties.level,
            todo,
            isDone: todo ? doneStates.has(todo) : false,
            priority: h.properties.priority || undefined,
            scheduled: tsToDate(h.planning?.properties?.scheduled),
            deadline: tsToDate(h.planning?.properties?.deadline),
            effortMinutes,
            assignees: getAssignees(doc, h),
            tags: getInheritedTags(doc, h),
            dependsIds: parseDependsIds(drawerProp(h, DEPENDS_PROPERTY)),
            line: (h.position?.start.line ?? 0) + 1,
            file: options.file,
            parentTitle: parent ? (parent.properties.rawValue || '').trim() || undefined : undefined,
            ganttId,
        });
        taskHeadline.push(h);
    }

    injectOrderedDependencies(doc, tasks, taskHeadline);
    return tasks;
}

/**
 * Under a parent marked :ORDERED: t, each child implicitly depends on its
 * previous sibling. Inject those edges so ordered subtasks chain in the chart
 * and show as blocked until the prior step is done — mirroring how ORDERED
 * blocks completion.
 */
function injectOrderedDependencies(
    doc: OrgDocumentNode,
    tasks: ProjectTask[],
    taskHeadline: HeadlineElement[]
): void {
    // Last task id seen at a given (parentLine, level), to chain siblings.
    const lastSiblingId = new Map<string, string>();
    for (let i = 0; i < tasks.length; i++) {
        const h = taskHeadline[i];
        const path = getHeadlinePath(doc, h);
        const parent = path.length >= 2 ? path[path.length - 2] : undefined;
        if (!parent) continue;
        const ordered = drawerProp(parent, ORDERED_PROPERTY);
        if (!isOrderedTruthy(ordered)) continue;
        const key = `${parent.position?.start.line ?? -1}:${tasks[i].level}`;
        const prev = lastSiblingId.get(key);
        if (prev && !tasks[i].dependsIds.includes(prev)) {
            tasks[i].dependsIds.push(prev);
        }
        if (tasks[i].id) lastSiblingId.set(key, tasks[i].id!);
    }
}

const ORDERED_PROPERTY = 'ORDERED';
function isOrderedTruthy(value: string | undefined): boolean {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    return v === 't' || v === 'true' || v === 'yes' || v === 'on';
}

/** True if `task` has an in-scope dependency that is not yet done. */
export function isTaskBlocked(task: ProjectTask, byId: Map<string, ProjectTask>): boolean {
    for (const depId of task.dependsIds) {
        const dep = byId.get(depId);
        // Only same-scope deps can be judged here; unknown ids are ignored.
        if (dep && !dep.isDone) return true;
    }
    return false;
}

/** Convert effort minutes to whole working days (8h/day), min 1. */
export function effortToDays(minutes: number | undefined): number | undefined {
    if (!minutes || minutes <= 0) return undefined;
    return Math.max(1, Math.ceil(minutes / (8 * 60)));
}

/**
 * The fields of an indexed heading row (see HeadingRecord in the database
 * layer) needed to work out its assignees. Kept structural so this module stays
 * free of database imports.
 */
export interface HeadingRow {
    level: number;
    line_number: number;
    /** JSON object of the heading's own properties. */
    properties?: string | null;
    /** The heading's own tags (JSON array, or legacy comma list). */
    tags?: string | null;
}

function rowTags(raw: string | null | undefined): string[] {
    if (!raw) return [];
    const t = raw.trim();
    if (t.startsWith('[')) {
        try {
            const parsed = JSON.parse(t);
            if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
        } catch { /* fall through */ }
    }
    return t.split(',').map(x => x.trim()).filter(Boolean);
}

function rowOwnAssignees(row: HeadingRow): string[] {
    let props: Record<string, string> = {};
    try { props = JSON.parse(row.properties || '{}'); } catch { props = {}; }
    const key = Object.keys(props).find(k => k.toUpperCase() === ASSIGNEE_PROPERTY);
    const handles = splitList(key ? props[key] : undefined);
    for (const tag of rowTags(row.tags)) {
        if (tag.startsWith('@') && tag.length > 1) handles.push(tag.slice(1));
    }
    return handles;
}

/**
 * Assignees of an indexed heading, with the same nearest-wins inheritance as
 * getAssignees: the heading's own :ASSIGNEE:/@tags, else those of its nearest
 * ancestor that has any. `fileRows` are the other headings of the same file;
 * ancestors are the closest preceding rows of each lower level.
 */
export function getRowAssignees(row: HeadingRow, fileRows: HeadingRow[]): string[] {
    const own = rowOwnAssignees(row);
    if (own.length) return [...new Set(own)];
    const before = fileRows
        .filter(r => r.line_number < row.line_number)
        .sort((a, b) => b.line_number - a.line_number);
    let level = row.level;
    for (const r of before) {
        if (r.level >= level) continue;
        level = r.level;
        const inherited = rowOwnAssignees(r);
        if (inherited.length) return [...new Set(inherited)];
        if (level <= 1) break;
    }
    return [];
}

/** Where a task sits on a timeline. `end` is exclusive; milestones have start == end. */
export interface TaskSpan {
    start: Date;
    end: Date;
    milestone: boolean;
}

function addDaysTo(d: Date, n: number): Date {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + n);
    return r;
}

function dayOf(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Lay tasks out on a calendar for the project view's chart:
 * SCHEDULED is the start; else the latest end of in-scope dependencies; else
 * DEADLINE minus the effort; else the project start (the earliest SCHEDULED, or
 * today). EFFORT sets the length in days; a task with SCHEDULED and DEADLINE but
 * no effort runs to the deadline; a task with only a DEADLINE is a milestone;
 * anything else is one day. Keyed by ganttId.
 */
export function scheduleProjectTasks(tasks: ProjectTask[], today: Date = new Date()): Map<string, TaskSpan> {
    const byId = new Map<string, ProjectTask>();
    for (const t of tasks) if (t.id) byId.set(t.id, t);

    let projectStart = dayOf(today);
    for (const t of tasks) if (t.scheduled && t.scheduled < projectStart) projectStart = dayOf(t.scheduled);

    const spans = new Map<string, TaskSpan>();
    const visiting = new Set<ProjectTask>();
    const place = (t: ProjectTask): TaskSpan => {
        const done = spans.get(t.ganttId);
        if (done) return done;
        visiting.add(t);

        const days = effortToDays(t.effortMinutes);
        let span: TaskSpan;
        if (!days && !t.scheduled && t.deadline) {
            const d = dayOf(t.deadline);
            span = { start: d, end: d, milestone: true };
        } else {
            let start: Date | undefined = t.scheduled ? dayOf(t.scheduled) : undefined;
            if (!start) {
                for (const depId of t.dependsIds) {
                    const dep = byId.get(depId);
                    if (!dep || dep === t || visiting.has(dep)) continue; // skip cycles
                    const depEnd = place(dep).end;
                    if (!start || depEnd > start) start = depEnd;
                }
            }
            if (!start && t.deadline && days) start = addDaysTo(dayOf(t.deadline), -days);
            if (!start) start = projectStart;

            let end: Date;
            if (days) end = addDaysTo(start, days);
            else if (t.scheduled && t.deadline && t.deadline > start) end = addDaysTo(dayOf(t.deadline), 1);
            else end = addDaysTo(start, 1);
            span = { start, end, milestone: false };
        }

        visiting.delete(t);
        spans.set(t.ganttId, span);
        return span;
    };
    for (const t of tasks) place(t);
    return spans;
}
