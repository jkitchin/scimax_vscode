/**
 * Project-management view of org tasks, extracted from the parsed AST.
 *
 * This is the shared, synchronous, VS Code-free data layer behind the
 * `project-table` and `gantt` dynamic blocks. It reads a document's headlines
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
    /** Normalized ids this task depends on (from :DEPENDS:). */
    dependsIds: string[];
    /** 1-based line number of the heading. */
    line: number;
    /** Stable id usable in a Mermaid gantt (own id or a generated token). */
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

export interface ExtractOptions {
    /** Only include headlines with a TODO keyword (default true). */
    todoOnly?: boolean;
    /** Restrict to this maximum heading level. */
    maxLevel?: number;
    /** Extra done-state keywords beyond the defaults. */
    doneStates?: Set<string>;
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
    const usedGanttIds = new Set<string>();
    let counter = 0;

    for (const h of headlines) {
        const todo = h.properties.todoKeyword || undefined;
        if (todoOnly && !todo) continue;
        if (options.maxLevel && h.properties.level > options.maxLevel) continue;

        const id = drawerProp(h, 'ID')?.replace(/^id:/i, '');
        let ganttId = id && /^[A-Za-z0-9_-]+$/.test(id) ? id : `t${counter}`;
        while (usedGanttIds.has(ganttId)) ganttId = `t${counter}_${++counter}`;
        usedGanttIds.add(ganttId);
        counter++;

        const effortRaw = h.properties.effort || drawerProp(h, 'EFFORT');
        const effortMinutes = effortRaw ? parseEffort(effortRaw) || undefined : undefined;

        tasks.push({
            id,
            // rawValue normally excludes the priority cookie, but strip a stray
            // leading [#A] defensively so it never leaks into tables/gantt names.
            title: (h.properties.rawValue || '').replace(/^\[#[A-Za-z0-9]\]\s*/, '').trim(),
            level: h.properties.level,
            todo,
            isDone: todo ? doneStates.has(todo) : false,
            priority: h.properties.priority || undefined,
            scheduled: tsToDate(h.planning?.properties?.scheduled),
            deadline: tsToDate(h.planning?.properties?.deadline),
            effortMinutes,
            assignees: getAssignees(doc, h),
            dependsIds: parseDependsIds(drawerProp(h, DEPENDS_PROPERTY)),
            line: (h.position?.start.line ?? 0) + 1,
            ganttId,
        });
        taskHeadline.push(h);
    }

    injectOrderedDependencies(doc, tasks, taskHeadline);
    return tasks;
}

/**
 * Under a parent marked :ORDERED: t, each child implicitly depends on its
 * previous sibling. Inject those edges so ordered subtasks chain in the gantt
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
