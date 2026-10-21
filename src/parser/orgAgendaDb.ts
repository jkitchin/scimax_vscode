/**
 * Database rows as agenda items.
 *
 * The extension's agenda, custom agenda commands and the CLI all build their
 * views from `headings` rows, so the conversion lives here, free of vscode
 * imports.
 */

// Per-function imports: the package index loads all of date-fns.
import format from 'date-fns/format';
import addDays from 'date-fns/addDays';
import startOfDay from 'date-fns/startOfDay';
import isSameDay from 'date-fns/isSameDay';
import differenceInDays from 'date-fns/differenceInDays';
import * as path from 'path';
import type { AgendaItem as DbAgendaItem, HeadingRecord } from '../database/scimaxDbCore';
import type { HeadlineElement } from './orgElementTypes';
import { placeWarnedDeadlines, type AgendaGroup, type AgendaItem } from './orgAgenda';
import { parseWarning, warningStart } from './deadlineWarning';
import { parseHeadingTags } from '../org/agendaTags';
import { parseLocalYmd } from '../utils/dateParser';

/** A heading's property drawer, as stored (JSON). */
export function parseHeadingProperties(raw: string | null | undefined): Record<string, string> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (v !== null && v !== undefined) out[k] = String(v);
        }
        return out;
    } catch {
        return {};
    }
}

/** The CATEGORY property, else the file name without its extension. */
export function headingCategory(filePath: string, properties: Record<string, string>): string {
    for (const [k, v] of Object.entries(properties)) {
        if (k.toUpperCase() === 'CATEGORY' && v.trim()) return v.trim();
    }
    return path.basename(filePath).replace(/\.(org|md)$/i, '');
}

/** The local day of a stored timestamp (`2026-10-17 Sat 10:00`). */
function storedDay(raw: string | null | undefined): Date | undefined {
    const m = raw ? /(\d{4}-\d{2}-\d{2})/.exec(raw) : null;
    if (!m) return undefined;
    // Parse as a LOCAL date: new Date('2024-01-27') is UTC midnight, which is
    // the previous evening west of Greenwich.
    const date = parseLocalYmd(m[1]);
    return isNaN(date.getTime()) ? undefined : date;
}

/** The repeater of stored timestamp text ("2024-01-27 Sat +1w -3d" -> "+1w"). */
function storedRepeater(raw: string | null | undefined): string | undefined {
    const m = raw ? /(?:^|\s)(\.\+|\+\+|\+)(\d+)([hdwmy])/.exec(raw) : null;
    return m ? `${m[1]}${m[2]}${m[3]}` : undefined;
}

function storedTime(raw: string | null | undefined): string | undefined {
    const m = raw ? /(\d{1,2}:\d{2})/.exec(raw) : null;
    return m ? m[1] : undefined;
}

/** A minimal HeadlineElement for code that expects parser output. */
function minimalHeadline(heading: HeadingRecord, tags: string[]): HeadlineElement {
    return {
        type: 'headline',
        range: { start: heading.begin_pos, end: heading.begin_pos + heading.title.length },
        postBlank: 0,
        properties: {
            level: heading.level,
            rawValue: heading.title,
            todoKeyword: heading.todo_state || undefined,
            priority: heading.priority || undefined,
            tags,
            archivedp: false,
            commentedp: false,
            footnoteSection: false,
            lineNumber: heading.line_number,
        },
        children: [],
    };
}

/**
 * A heading row as an undated agenda item (TODO lists, tag searches). The
 * planning dates are filled in so sorting and match strings can use them.
 */
export function headingToAgendaItem(heading: HeadingRecord, isDone?: boolean): AgendaItem {
    const tags = parseHeadingTags(heading.tags);
    const properties = parseHeadingProperties(heading.properties);
    return {
        title: heading.title,
        todoState: heading.todo_state || undefined,
        priority: heading.priority || undefined,
        tags,
        inheritedTags: parseHeadingTags(heading.inherited_tags),
        properties,
        level: heading.level,
        isDone: isDone ?? heading.todo_type === 'done',
        file: heading.file_path,
        line: heading.line_number,
        scheduled: storedDay(heading.scheduled),
        deadline: storedDay(heading.deadline),
        closed: storedDay(heading.closed),
        // As in orgAgenda: SCHEDULED's repeater, else DEADLINE's.
        repeater: storedRepeater(heading.scheduled) ?? storedRepeater(heading.deadline),
        category: headingCategory(heading.file_path, properties),
        headline: minimalHeadline(heading, tags),
        agendaType: 'todo',
    };
}

/** A dated database agenda entry (scheduled or deadline) as an agenda item. */
export function dbItemToAgendaItem(dbItem: DbAgendaItem): AgendaItem {
    const base = headingToAgendaItem(dbItem.heading);
    const itemDate = storedDay(dbItem.date);
    const agendaType: AgendaItem['agendaType'] = dbItem.type === 'deadline' ? 'deadline'
        : dbItem.type === 'scheduled' ? 'scheduled' : 'todo';
    const warning = agendaType === 'deadline' && dbItem.date ? parseWarning(dbItem.date) : undefined;

    return {
        ...base,
        // Only the date this entry is placed by, so it is grouped on that day.
        scheduled: agendaType === 'scheduled' ? itemDate : undefined,
        deadline: agendaType === 'deadline' ? itemDate : undefined,
        warningStart: agendaType === 'deadline' && itemDate && warning ? warningStart(itemDate, warning) : undefined,
        daysUntil: dbItem.days_until,
        overdue: dbItem.overdue,
        agendaType,
        time: storedTime(dbItem.date),
        repeater: storedRepeater(dbItem.date) ?? base.repeater,
    };
}

/** "Today", "Tomorrow", "Yesterday", else "Monday Oct 19". */
export function formatDateLabel(date: Date, now: Date = new Date()): string {
    const diff = differenceInDays(startOfDay(date), startOfDay(now));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return `${format(date, 'EEEE')} ${format(date, 'MMM d')}`;
}

/**
 * One group per day from `startDate`, with warned deadlines placed on the
 * days they warn and overdue items listed under today.
 */
export function groupItemsByDate(items: AgendaItem[], startDate: Date, days: number, now: Date = new Date()): AgendaGroup[] {
    const groups: AgendaGroup[] = [];

    for (let i = 0; i < days; i++) {
        const date = addDays(startDate, i);
        groups.push({
            label: formatDateLabel(date, now),
            key: format(date, 'yyyy-MM-dd'),
            items: items.filter(item => {
                const itemDate = item.scheduled || item.deadline || item.timestamp;
                return itemDate && isSameDay(itemDate, date);
            }),
        });
    }

    placeWarnedDeadlines(items, groups, startDate, days);

    const overdueItems = items.filter(item => item.overdue);
    if (overdueItems.length > 0) {
        const todayGroup = groups.find(g => g.key === format(now, 'yyyy-MM-dd'));
        if (todayGroup) {
            for (const item of overdueItems) {
                if (!todayGroup.items.includes(item)) todayGroup.items.unshift(item);
            }
        }
    }

    return groups;
}
