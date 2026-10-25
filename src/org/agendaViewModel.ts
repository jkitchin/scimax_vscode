/**
 * The agenda view's model: agenda items and project tasks turned into plain
 * rows the webview can draw. Kept free of vscode so it can be tested.
 *
 * The webview does the tag, file, state, priority and text filtering itself,
 * over every row it is sent, so its menus can list (and count) everything
 * there is to filter by. The extension only chooses the rows: the span, the
 * project, and the custom agenda.
 */

import * as path from 'path';
import format from 'date-fns/format';
import type { AgendaGroup, AgendaItem } from '../parser/orgAgenda';
import type { ProjectTaskInfo } from './projectData';

/** One item line in the view. */
export interface AgendaRow {
    file: string;
    /** 1-based line of the heading */
    line: number;
    title: string;
    todo?: string;
    done: boolean;
    priority?: string;
    /** Own and inherited tags, without duplicates */
    tags: string[];
    /** Assignee handles, own or inherited (:ASSIGNEE: and @tags) */
    assignees: string[];
    /** The heading's own properties, keys upper-cased */
    properties: Record<string, string>;
    /** The org-agenda leader: "Scheduled:", "In 3 d.:", "2 d. ago:", ... */
    leader: string;
    /** The planning date this line shows, so "later by a day" moves that one */
    planning?: 'SCHEDULED' | 'DEADLINE';
    time?: string;
    overdue: boolean;
    blocked: boolean;
    category?: string;
}

export interface AgendaRowGroup {
    label: string;
    key: string;
    /** The group is today's date */
    today?: boolean;
    rows: AgendaRow[];
}

/** A block of groups; a custom agenda has one per block, with a header. */
export interface AgendaSection {
    header?: string;
    groups: AgendaRowGroup[];
}

/** The org-agenda leader for an item, after formatAgendaItem. */
export function agendaLeader(item: AgendaItem): string {
    switch (item.agendaType) {
        case 'scheduled':
            if (item.overdue && item.daysUntil !== undefined && item.daysUntil < 0) {
                return `Sched.${Math.abs(item.daysUntil)}x:`;
            }
            return 'Scheduled:';
        case 'deadline':
            if (item.overdue) return `${Math.abs(item.daysUntil ?? 0)} d. ago:`;
            if (!item.daysUntil) return 'Deadline:';
            return `In ${item.daysUntil} d.:`;
        default:
            return '';
    }
}

function uniqueTags(own: string[], inherited: string[] = []): string[] {
    return [...new Set([...own, ...inherited])];
}

/** Property drawers spell keys in any case; the filter groups them upper-cased. */
function upperKeys(props: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(props ?? {})) out[k.toUpperCase()] = String(v).trim();
    return out;
}

export function rowFromItem(item: AgendaItem): AgendaRow {
    return {
        file: item.file,
        line: item.line,
        title: item.title,
        todo: item.todoState,
        done: item.isDone ?? false,
        priority: item.priority,
        tags: uniqueTags(item.tags, item.inheritedTags),
        assignees: [...new Set(item.assignees ?? [])],
        properties: upperKeys(item.properties ?? item.headline?.propertiesDrawer),
        leader: agendaLeader(item),
        planning: item.agendaType === 'scheduled' ? 'SCHEDULED'
            : item.agendaType === 'deadline' ? 'DEADLINE'
            : undefined,
        time: item.time,
        overdue: item.overdue ?? false,
        blocked: item.blocked ?? false,
        category: item.category,
    };
}

export function rowFromTask(task: ProjectTaskInfo): AgendaRow {
    return {
        file: task.file,
        line: task.line,
        title: task.title,
        todo: task.todo,
        done: task.isDone,
        priority: task.priority,
        tags: uniqueTags(task.tags),
        assignees: task.assignees,
        properties: upperKeys(task.properties),
        leader: '',
        overdue: false,
        blocked: task.blocked,
    };
}

/** Date groups (or any AgendaGroups) as row groups; today's is marked. */
export function rowGroups(groups: AgendaGroup[], now: Date = new Date()): AgendaRowGroup[] {
    const today = format(now, 'yyyy-MM-dd');
    return groups.map(g => ({
        label: g.label,
        key: g.key,
        today: g.key === today || undefined,
        rows: g.items.map(rowFromItem),
    }));
}

/**
 * Rows grouped by TODO keyword, in the order the keywords first appear,
 * then by priority (A first, none last) and title within a keyword.
 */
export function groupByState(rows: AgendaRow[]): AgendaRowGroup[] {
    const byState = new Map<string, AgendaRow[]>();
    for (const row of rows) {
        const state = row.todo ?? '';
        byState.set(state, [...(byState.get(state) ?? []), row]);
    }
    const byPriority = (a: AgendaRow, b: AgendaRow) =>
        a.priority === b.priority ? 0
        : a.priority === undefined ? 1
        : b.priority === undefined ? -1
        : a.priority.localeCompare(b.priority);
    return [...byState].map(([state, list]) => ({
        label: state || 'No keyword',
        key: `todo:${state}`,
        rows: list.sort((a, b) => byPriority(a, b) || a.title.localeCompare(b.title)),
    }));
}

/** True if file is root or under it. */
export function isUnder(file: string, root: string): boolean {
    const rel = path.relative(root, file);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Keep only the rows under root, dropping groups that end up empty unless keepEmpty. */
export function limitToRoot(sections: AgendaSection[], root: string, keepEmpty = false): AgendaSection[] {
    return sections.map(s => ({
        ...s,
        groups: s.groups
            .map(g => ({ ...g, rows: g.rows.filter(r => isUnder(r.file, root)) }))
            .filter(g => keepEmpty || g.rows.length > 0),
    }));
}
