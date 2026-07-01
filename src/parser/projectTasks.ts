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
import { getInheritedProperty } from './orgModify';
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

/** Assignee handles for a headline: :ASSIGNEE: (own+inherited) plus @tags. */
export function getAssignees(doc: OrgDocumentNode, headline: HeadlineElement): string[] {
    const handles = new Set<string>();
    const own = drawerProp(headline, ASSIGNEE_PROPERTY);
    for (const h of splitList(own)) handles.add(h);
    // Inherited from an ancestor subtree assigned to someone.
    if (handles.size === 0) {
        const inherited = getInheritedProperty(doc, headline, ASSIGNEE_PROPERTY)
            ?? getInheritedProperty(doc, headline, ASSIGNEE_PROPERTY.toLowerCase());
        for (const h of splitList(inherited)) handles.add(h);
    }
    // @name tags are also assignees.
    for (const tag of headline.properties.tags || []) {
        if (tag.startsWith('@') && tag.length > 1) handles.add(tag.slice(1));
    }
    return [...handles];
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
    }
    return tasks;
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
