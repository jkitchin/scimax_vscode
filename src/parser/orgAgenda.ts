/**
 * Org-mode agenda views
 * Provides agenda, todo list, and scheduled item views
 */

import {
    format,
    startOfDay,
    endOfDay,
    startOfWeek,
    endOfWeek,
    addDays,
    isBefore,
    isAfter,
    isSameDay,
    differenceInDays,
    parseISO,
} from 'date-fns';
import type {
    HeadlineElement,
    TimestampObject,
    PlanningElement,
    DiarySexpElement,
} from './orgElementTypes';
import { evaluateDiarySexp, getDiarySexpDates } from './orgDiarySexp';

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Diary sexp entry for agenda integration
 */
export interface DiarySexpEntry {
    /** The diary sexp expression (without %%) */
    sexp: string;
    /** Title/description for the entry */
    title: string;
    /** File path where the sexp is defined */
    file: string;
    /** Line number in the file */
    line: number;
    /** Category (from CATEGORY property or file) */
    category?: string;
}

/**
 * Agenda item representing a scheduled/deadline entry
 */
export interface AgendaItem {
    /** Headline text */
    title: string;
    /** TODO state if present */
    todoState?: string;
    /** Priority (A, B, C, etc.) */
    priority?: string;
    /** Tags */
    tags: string[];
    /** File path */
    file: string;
    /** Line number */
    line: number;
    /** Scheduled timestamp */
    scheduled?: Date;
    /** Deadline timestamp */
    deadline?: Date;
    /** Closed timestamp */
    closed?: Date;
    /** Active timestamp (for diary entries) */
    timestamp?: Date;
    /** Days until deadline (negative = overdue) */
    daysUntil?: number;
    /** Whether item is overdue */
    overdue?: boolean;
    /** Category (from CATEGORY property or file) */
    category?: string;
    /** Original headline element */
    headline: HeadlineElement;
    /** Agenda type for display */
    agendaType: 'scheduled' | 'deadline' | 'timestamp' | 'todo' | 'diary';
    /** Time of day if specified */
    time?: string;
    /** Duration if specified */
    duration?: number;
    /** Repeat interval if present */
    repeater?: string;
}

/**
 * Agenda view configuration
 */
export interface AgendaViewConfig {
    /** View type */
    type: 'day' | 'week' | 'month' | 'fortnight' | 'custom';
    /** Start date */
    startDate: Date;
    /** Number of days to show */
    days: number;
    /** Filter by TODO states */
    todoStates?: string[];
    /** Filter by tags (include) */
    includeTags?: string[];
    /** Filter by tags (exclude) */
    excludeTags?: string[];
    /** Filter by priority */
    priorities?: string[];
    /** Filter by category */
    categories?: string[];
    /** Filter by specific files (absolute paths) */
    files?: string[];
    /** Whether to show done items */
    showDone?: boolean;
    /** Whether to show habits */
    showHabits?: boolean;
    /** Sort order */
    sortBy?: 'time' | 'priority' | 'category' | 'todo' | 'tag';
    /** Group by */
    groupBy?: 'date' | 'category' | 'todo' | 'tag' | 'priority';
}

/**
 * Grouped agenda view
 */
export interface AgendaView {
    /** View configuration */
    config: AgendaViewConfig;
    /** Items grouped by date or category */
    groups: AgendaGroup[];
    /** Total item count */
    totalItems: number;
    /** Total files scanned */
    totalFiles: number;
    /** Date range covered */
    dateRange: { start: Date; end: Date };
}

/**
 * Group of agenda items
 */
export interface AgendaGroup {
    /** Group label (date string, category name, etc.) */
    label: string;
    /** Group key (for sorting/filtering) */
    key: string;
    /** Items in this group */
    items: AgendaItem[];
}

/**
 * Todo list view
 */
export interface TodoListView {
    /** All TODO items grouped by state */
    byState: Map<string, AgendaItem[]>;
    /** All TODO items grouped by priority */
    byPriority: Map<string, AgendaItem[]>;
    /** Total counts */
    counts: {
        total: number;
        byState: Record<string, number>;
        byPriority: Record<string, number>;
    };
}

// =============================================================================
// Agenda Generation
// =============================================================================

/**
 * Generate agenda view from headlines
 */
export function generateAgendaView(
    headlines: HeadlineElement[],
    files: Map<string, string>, // headline -> file path
    config: Partial<AgendaViewConfig> = {},
    diarySexps: DiarySexpEntry[] = [],
    totalFiles: number = 0
): AgendaView {
    const fullConfig: AgendaViewConfig = {
        type: 'week',
        startDate: startOfDay(new Date()),
        days: 7,
        showDone: false,
        showHabits: true,
        sortBy: 'time',
        groupBy: 'date',
        ...config,
    };

    // Calculate date range
    const startDate = startOfDay(fullConfig.startDate);
    const endDate = endOfDay(addDays(startDate, fullConfig.days - 1));

    // Extract agenda items
    const items: AgendaItem[] = [];

    for (const headline of headlines) {
        const file = files.get(getHeadlineKey(headline)) || 'unknown';
        const agendaItems = extractAgendaItems(headline, file, startDate, endDate, fullConfig);
        items.push(...agendaItems);
    }

    // Extract diary sexp items
    if (diarySexps.length > 0) {
        const diarySexpItems = extractDiarySexpItems(diarySexps, startDate, endDate);
        items.push(...diarySexpItems);
    }

    // Apply filters
    const filteredItems = filterAgendaItems(items, fullConfig);

    // Sort items
    const sortedItems = sortAgendaItems(filteredItems, fullConfig.sortBy);

    // Group items
    const groups = groupAgendaItems(sortedItems, fullConfig.groupBy, startDate, fullConfig.days);

    return {
        config: fullConfig,
        groups,
        totalItems: sortedItems.length,
        totalFiles,
        dateRange: { start: startDate, end: endDate },
    };
}

/**
 * Extract agenda items from a headline
 */
function extractAgendaItems(
    headline: HeadlineElement,
    file: string,
    startDate: Date,
    endDate: Date,
    config: AgendaViewConfig
): AgendaItem[] {
    const items: AgendaItem[] = [];
    const baseItem = {
        title: headline.properties.rawValue,
        todoState: headline.properties.todoKeyword,
        priority: headline.properties.priority,
        tags: headline.properties.tags,
        file,
        line: headline.properties.lineNumber,
        category: headline.propertiesDrawer?.CATEGORY || file.split('/').pop()?.replace('.org', ''),
        headline,
    };

    // Check planning element - include all items with scheduled/deadline
    if (headline.planning) {
        // Scheduled
        if (headline.planning.properties.scheduled) {
            const date = timestampToDate(headline.planning.properties.scheduled);
            if (date && isInRange(date, startDate, endDate)) {
                items.push({
                    ...baseItem,
                    scheduled: date,
                    agendaType: 'scheduled',
                    time: getTimeString(headline.planning.properties.scheduled),
                    daysUntil: differenceInDays(date, new Date()),
                    repeater: getRepeaterString(headline.planning.properties.scheduled),
                });
            }
        }

        // Deadline
        if (headline.planning.properties.deadline) {
            const date = timestampToDate(headline.planning.properties.deadline);
            if (date) {
                const daysUntil = differenceInDays(date, startOfDay(new Date()));
                const overdue = daysUntil < 0;

                // Show deadlines in range, or overdue deadlines
                if (isInRange(date, startDate, endDate) || overdue) {
                    items.push({
                        ...baseItem,
                        deadline: date,
                        agendaType: 'deadline',
                        time: getTimeString(headline.planning.properties.deadline),
                        daysUntil,
                        overdue,
                        repeater: getRepeaterString(headline.planning.properties.deadline),
                    });
                }
            }
        }

        // Closed (for done items)
        if (headline.planning.properties.closed && config.showDone) {
            const date = timestampToDate(headline.planning.properties.closed);
            if (date && isInRange(date, startDate, endDate)) {
                items.push({
                    ...baseItem,
                    closed: date,
                    agendaType: 'timestamp',
                    time: getTimeString(headline.planning.properties.closed),
                });
            }
        }
    }

    // Process child headlines recursively
    for (const child of headline.children) {
        items.push(...extractAgendaItems(child, file, startDate, endDate, config));
    }

    return items;
}

/**
 * Extract agenda items from diary sexps
 */
function extractDiarySexpItems(
    diarySexps: DiarySexpEntry[],
    startDate: Date,
    endDate: Date
): AgendaItem[] {
    const items: AgendaItem[] = [];

    for (const entry of diarySexps) {
        // Get all matching dates in the range
        const matches = getDiarySexpDates(entry.sexp, startDate, endDate);

        for (const match of matches) {
            // Create a minimal headline element for diary entries
            const dummyHeadline: HeadlineElement = {
                type: 'headline',
                range: { start: 0, end: 0 },
                postBlank: 0,
                properties: {
                    level: 1,
                    todoKeyword: undefined,
                    priority: undefined,
                    title: [], // Parsed title objects (empty for diary entries)
                    rawValue: entry.title,
                    tags: [],
                    lineNumber: entry.line,
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                },
                children: [],
            };

            items.push({
                title: entry.title,
                tags: [],
                file: entry.file,
                line: entry.line,
                timestamp: match.date,
                category: entry.category,
                headline: dummyHeadline,
                agendaType: 'diary',
                // Add years info if anniversary
                daysUntil: match.result.years !== undefined ? match.result.years : undefined,
            });
        }
    }

    return items;
}

/**
 * Filter agenda items based on configuration
 */
function filterAgendaItems(items: AgendaItem[], config: AgendaViewConfig): AgendaItem[] {
    return items.filter(item => {
        // Filter by TODO state
        if (config.todoStates && config.todoStates.length > 0) {
            if (!item.todoState || !config.todoStates.includes(item.todoState)) {
                return false;
            }
        }

        // Filter done items
        if (!config.showDone && item.todoState === 'DONE') {
            return false;
        }

        // Filter by tags (include)
        if (config.includeTags && config.includeTags.length > 0) {
            if (!config.includeTags.some(tag => item.tags.includes(tag))) {
                return false;
            }
        }

        // Filter by tags (exclude)
        if (config.excludeTags && config.excludeTags.length > 0) {
            if (config.excludeTags.some(tag => item.tags.includes(tag))) {
                return false;
            }
        }

        // Filter by priority
        if (config.priorities && config.priorities.length > 0) {
            if (!item.priority || !config.priorities.includes(item.priority)) {
                return false;
            }
        }

        // Filter by category
        if (config.categories && config.categories.length > 0) {
            if (!item.category || !config.categories.includes(item.category)) {
                return false;
            }
        }

        // Filter habits if disabled
        if (!config.showHabits && item.tags.includes('HABIT')) {
            return false;
        }

        // Filter by specific files
        if (config.files && config.files.length > 0) {
            if (!config.files.includes(item.file)) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Sort agenda items
 */
function sortAgendaItems(
    items: AgendaItem[],
    sortBy: AgendaViewConfig['sortBy'] = 'time'
): AgendaItem[] {
    return [...items].sort((a, b) => {
        switch (sortBy) {
            case 'time': {
                const dateA = a.scheduled || a.deadline || a.timestamp || new Date(0);
                const dateB = b.scheduled || b.deadline || b.timestamp || new Date(0);
                return dateA.getTime() - dateB.getTime();
            }
            case 'priority': {
                const priA = a.priority || 'Z';
                const priB = b.priority || 'Z';
                return priA.localeCompare(priB);
            }
            case 'category': {
                const catA = a.category || '';
                const catB = b.category || '';
                return catA.localeCompare(catB);
            }
            case 'todo': {
                const todoA = a.todoState || 'ZZZZZ';
                const todoB = b.todoState || 'ZZZZZ';
                return todoA.localeCompare(todoB);
            }
            case 'tag': {
                const tagA = a.tags[0] || '';
                const tagB = b.tags[0] || '';
                return tagA.localeCompare(tagB);
            }
            default:
                return 0;
        }
    });
}

/**
 * Group agenda items
 */
function groupAgendaItems(
    items: AgendaItem[],
    groupBy: AgendaViewConfig['groupBy'] = 'date',
    startDate: Date,
    days: number
): AgendaGroup[] {
    const groups: AgendaGroup[] = [];

    switch (groupBy) {
        case 'date': {
            // Create groups for each day
            for (let i = 0; i < days; i++) {
                const date = addDays(startDate, i);
                const dateKey = format(date, 'yyyy-MM-dd');
                const dateLabel = formatDateLabel(date);

                const dayItems = items.filter(item => {
                    const itemDate = item.scheduled || item.deadline || item.timestamp;
                    return itemDate && isSameDay(itemDate, date);
                });

                groups.push({
                    label: dateLabel,
                    key: dateKey,
                    items: dayItems,
                });
            }

            // Add overdue items to today
            const overdueItems = items.filter(item => item.overdue);
            if (overdueItems.length > 0) {
                const todayGroup = groups.find(g => g.key === format(new Date(), 'yyyy-MM-dd'));
                if (todayGroup) {
                    todayGroup.items.unshift(...overdueItems.filter(item =>
                        !todayGroup.items.includes(item)
                    ));
                }
            }
            break;
        }

        case 'category': {
            const categoryMap = new Map<string, AgendaItem[]>();
            for (const item of items) {
                const category = item.category || 'Uncategorized';
                if (!categoryMap.has(category)) {
                    categoryMap.set(category, []);
                }
                categoryMap.get(category)!.push(item);
            }

            for (const [category, categoryItems] of categoryMap) {
                groups.push({
                    label: category,
                    key: category,
                    items: categoryItems,
                });
            }
            break;
        }

        case 'todo': {
            const todoMap = new Map<string, AgendaItem[]>();
            for (const item of items) {
                const state = item.todoState || 'No State';
                if (!todoMap.has(state)) {
                    todoMap.set(state, []);
                }
                todoMap.get(state)!.push(item);
            }

            for (const [state, stateItems] of todoMap) {
                groups.push({
                    label: state,
                    key: state,
                    items: stateItems,
                });
            }
            break;
        }

        case 'priority': {
            const priorityMap = new Map<string, AgendaItem[]>();
            for (const item of items) {
                const priority = item.priority || 'No Priority';
                if (!priorityMap.has(priority)) {
                    priorityMap.set(priority, []);
                }
                priorityMap.get(priority)!.push(item);
            }

            // Sort priority groups
            const sortedPriorities = Array.from(priorityMap.keys()).sort();
            for (const priority of sortedPriorities) {
                groups.push({
                    label: priority === 'No Priority' ? priority : `Priority ${priority}`,
                    key: priority,
                    items: priorityMap.get(priority)!,
                });
            }
            break;
        }

        case 'tag': {
            const tagMap = new Map<string, AgendaItem[]>();
            for (const item of items) {
                const tag = item.tags[0] || 'Untagged';
                if (!tagMap.has(tag)) {
                    tagMap.set(tag, []);
                }
                tagMap.get(tag)!.push(item);
            }

            for (const [tag, tagItems] of tagMap) {
                groups.push({
                    label: tag,
                    key: tag,
                    items: tagItems,
                });
            }
            break;
        }
    }

    return groups;
}

// =============================================================================
// Todo List Generation
// =============================================================================

/**
 * Generate a TODO list view from headlines
 */
export function generateTodoList(
    headlines: HeadlineElement[],
    files: Map<string, string>,
    options: {
        states?: string[];
        excludeDone?: boolean;
        tags?: string[];
    } = {}
): TodoListView {
    const byState = new Map<string, AgendaItem[]>();
    const byPriority = new Map<string, AgendaItem[]>();
    const counts = {
        total: 0,
        byState: {} as Record<string, number>,
        byPriority: {} as Record<string, number>,
    };

    const processHeadline = (headline: HeadlineElement) => {
        // Only include items with TODO state
        if (!headline.properties.todoKeyword) {
            headline.children.forEach(processHeadline);
            return;
        }

        const state = headline.properties.todoKeyword;
        const priority = headline.properties.priority || 'None';
        const file = files.get(getHeadlineKey(headline)) || 'unknown';

        // Apply filters
        if (options.states && !options.states.includes(state)) {
            headline.children.forEach(processHeadline);
            return;
        }

        if (options.excludeDone && (state === 'DONE' || state === 'CANCELLED')) {
            headline.children.forEach(processHeadline);
            return;
        }

        if (options.tags && options.tags.length > 0) {
            if (!options.tags.some(tag => headline.properties.tags.includes(tag))) {
                headline.children.forEach(processHeadline);
                return;
            }
        }

        const item: AgendaItem = {
            title: headline.properties.rawValue,
            todoState: state,
            priority: headline.properties.priority,
            tags: headline.properties.tags,
            file,
            line: headline.properties.lineNumber,
            category: headline.propertiesDrawer?.CATEGORY,
            headline,
            agendaType: 'todo',
        };

        // Add planning info if present
        if (headline.planning) {
            if (headline.planning.properties.scheduled) {
                item.scheduled = timestampToDate(headline.planning.properties.scheduled);
            }
            if (headline.planning.properties.deadline) {
                item.deadline = timestampToDate(headline.planning.properties.deadline);
                if (item.deadline) {
                    item.daysUntil = differenceInDays(item.deadline, startOfDay(new Date()));
                    item.overdue = item.daysUntil < 0;
                }
            }
        }

        // Add to maps
        if (!byState.has(state)) {
            byState.set(state, []);
        }
        byState.get(state)!.push(item);

        if (!byPriority.has(priority)) {
            byPriority.set(priority, []);
        }
        byPriority.get(priority)!.push(item);

        // Update counts
        counts.total++;
        counts.byState[state] = (counts.byState[state] || 0) + 1;
        counts.byPriority[priority] = (counts.byPriority[priority] || 0) + 1;

        // Process children
        headline.children.forEach(processHeadline);
    };

    headlines.forEach(processHeadline);

    return { byState, byPriority, counts };
}

// =============================================================================
// Helper Functions
// =============================================================================

function getHeadlineKey(headline: HeadlineElement): string {
    return `${headline.properties.lineNumber}:${headline.properties.rawValue}`;
}

function timestampToDate(ts: TimestampObject): Date | undefined {
    const { yearStart, monthStart, dayStart, hourStart, minuteStart } = ts.properties;

    if (!yearStart || !monthStart || !dayStart) {
        return undefined;
    }

    return new Date(
        yearStart,
        monthStart - 1,
        dayStart,
        hourStart || 0,
        minuteStart || 0
    );
}

function getTimeString(ts: TimestampObject): string | undefined {
    const { hourStart, minuteStart } = ts.properties;

    if (hourStart === undefined) {
        return undefined;
    }

    return `${String(hourStart).padStart(2, '0')}:${String(minuteStart || 0).padStart(2, '0')}`;
}

function getRepeaterString(ts: TimestampObject): string | undefined {
    const { repeaterType, repeaterValue, repeaterUnit } = ts.properties;

    if (!repeaterType) {
        return undefined;
    }

    return `${repeaterType}${repeaterValue}${repeaterUnit}`;
}

function isInRange(date: Date, start: Date, end: Date): boolean {
    return !isBefore(date, start) && !isAfter(date, end);
}

function formatDateLabel(date: Date): string {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);

    if (isSameDay(date, today)) {
        return `Today (${format(date, 'EEEE, MMM d')})`;
    } else if (isSameDay(date, tomorrow)) {
        return `Tomorrow (${format(date, 'EEEE, MMM d')})`;
    } else if (isSameDay(date, yesterday)) {
        return `Yesterday (${format(date, 'EEEE, MMM d')})`;
    } else {
        return format(date, 'EEEE, MMMM d, yyyy');
    }
}

// =============================================================================
// Agenda Formatting
// =============================================================================

/**
 * Format agenda item for display
 */
export function formatAgendaItem(item: AgendaItem): string {
    const parts: string[] = [];

    // Category
    if (item.category) {
        parts.push(`${item.category}:`.padEnd(12));
    }

    // Time
    if (item.time) {
        parts.push(item.time.padEnd(6));
    } else {
        parts.push(''.padEnd(6));
    }

    // Type indicator
    switch (item.agendaType) {
        case 'scheduled':
            parts.push('Scheduled:');
            break;
        case 'deadline':
            if (item.overdue) {
                parts.push(`In ${Math.abs(item.daysUntil!)} d.:`);
            } else if (item.daysUntil === 0) {
                parts.push('Deadline:');
            } else {
                parts.push(`In ${item.daysUntil} d.:`);
            }
            break;
        case 'timestamp':
            parts.push('');
            break;
        case 'diary':
            // For anniversaries, show years
            if (item.daysUntil !== undefined) {
                parts.push(`(${item.daysUntil} years)`);
            } else {
                parts.push('Sexp:');
            }
            break;
        case 'todo':
            parts.push('');
            break;
    }

    // TODO state
    if (item.todoState) {
        parts.push(item.todoState);
    }

    // Priority
    if (item.priority) {
        parts.push(`[#${item.priority}]`);
    }

    // Title
    parts.push(item.title);

    // Tags
    if (item.tags.length > 0) {
        parts.push(':' + item.tags.join(':') + ':');
    }

    return parts.join(' ');
}

/**
 * Format agenda view as text
 */
export function formatAgendaView(view: AgendaView): string {
    const lines: string[] = [];

    // Header
    lines.push(`Agenda for ${format(view.dateRange.start, 'MMM d')} - ${format(view.dateRange.end, 'MMM d, yyyy')}`);
    lines.push('='.repeat(70));
    lines.push('');

    // Groups
    for (const group of view.groups) {
        if (group.items.length === 0) continue;

        lines.push(group.label);
        lines.push('-'.repeat(group.label.length));

        for (const item of group.items) {
            lines.push('  ' + formatAgendaItem(item));
        }

        lines.push('');
    }

    // Footer
    lines.push(`Total: ${view.totalItems} items`);

    return lines.join('\n');
}

// =============================================================================
// Exports
// =============================================================================

export {
    formatDateLabel,
    timestampToDate,
};
