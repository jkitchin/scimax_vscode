/**
 * Tests for org-mode agenda views
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    generateAgendaView,
    generateTodoList,
    formatAgendaItem,
    formatAgendaView,
    formatDateLabel,
    timestampToDate,
    type AgendaItem,
    type AgendaViewConfig,
    type DiarySexpEntry,
} from '../orgAgenda';
import type {
    HeadlineElement,
    TimestampObject,
    PlanningElement,
} from '../orgElementTypes';
import { addDays, format, startOfDay } from 'date-fns';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock timestamp object
 */
function createTimestamp(
    year: number,
    month: number,
    day: number,
    hour?: number,
    minute?: number,
    options: {
        repeaterType?: '+' | '++' | '.+';
        repeaterValue?: number;
        repeaterUnit?: 'h' | 'd' | 'w' | 'm' | 'y';
    } = {}
): TimestampObject {
    return {
        type: 'timestamp',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            timestampType: 'active',
            rawValue: `<${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}>`,
            yearStart: year,
            monthStart: month,
            dayStart: day,
            hourStart: hour,
            minuteStart: minute,
            ...options,
        },
    };
}

/**
 * Create a mock planning element
 */
function createPlanning(
    options: {
        scheduled?: TimestampObject;
        deadline?: TimestampObject;
        closed?: TimestampObject;
    } = {}
): PlanningElement {
    return {
        type: 'planning',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            scheduled: options.scheduled,
            deadline: options.deadline,
            closed: options.closed,
        },
    };
}

/**
 * Create a mock headline element
 */
function createHeadline(
    options: {
        title?: string;
        todoKeyword?: string;
        priority?: string;
        tags?: string[];
        lineNumber?: number;
        planning?: PlanningElement;
        category?: string;
        children?: HeadlineElement[];
    } = {}
): HeadlineElement {
    return {
        type: 'headline',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            level: 1,
            rawValue: options.title || 'Test Headline',
            title: [],
            todoKeyword: options.todoKeyword,
            priority: options.priority,
            tags: options.tags || [],
            archivedp: false,
            commentedp: false,
            footnoteSection: false,
            lineNumber: options.lineNumber || 1,
        },
        planning: options.planning,
        propertiesDrawer: options.category ? { CATEGORY: options.category } : undefined,
        children: options.children || [],
    };
}

/**
 * Create a files map for headlines
 */
function createFilesMap(headlines: HeadlineElement[], file: string = '/test/file.org'): Map<string, string> {
    const filesMap = new Map<string, string>();
    const addToMap = (headline: HeadlineElement) => {
        const key = `${headline.properties.lineNumber}:${headline.properties.rawValue}`;
        filesMap.set(key, file);
        headline.children.forEach(addToMap);
    };
    headlines.forEach(addToMap);
    return filesMap;
}

// =============================================================================
// Tests
// =============================================================================

describe('orgAgenda', () => {
    describe('timestampToDate', () => {
        it('converts a timestamp with full date and time', () => {
            const ts = createTimestamp(2024, 6, 15, 14, 30);
            const date = timestampToDate(ts);

            expect(date).not.toBeUndefined();
            expect(date!.getFullYear()).toBe(2024);
            expect(date!.getMonth()).toBe(5); // June (0-indexed)
            expect(date!.getDate()).toBe(15);
            expect(date!.getHours()).toBe(14);
            expect(date!.getMinutes()).toBe(30);
        });

        it('converts a timestamp with date only', () => {
            const ts = createTimestamp(2024, 1, 1);
            const date = timestampToDate(ts);

            expect(date).not.toBeUndefined();
            expect(date!.getFullYear()).toBe(2024);
            expect(date!.getMonth()).toBe(0); // January
            expect(date!.getDate()).toBe(1);
            expect(date!.getHours()).toBe(0);
            expect(date!.getMinutes()).toBe(0);
        });

        it('returns undefined for invalid timestamp', () => {
            const ts: TimestampObject = {
                type: 'timestamp',
                range: { start: 0, end: 0 },
                postBlank: 0,
                properties: {
                    timestampType: 'active',
                    rawValue: '',
                    yearStart: 0,
                    monthStart: 0,
                    dayStart: 0,
                },
            };
            const date = timestampToDate(ts);
            expect(date).toBeUndefined();
        });
    });

    describe('formatDateLabel', () => {
        it('formats today correctly', () => {
            const today = new Date();
            const label = formatDateLabel(today);
            expect(label).toMatch(/^Today \(/);
        });

        it('formats tomorrow correctly', () => {
            const tomorrow = addDays(new Date(), 1);
            const label = formatDateLabel(tomorrow);
            expect(label).toMatch(/^Tomorrow \(/);
        });

        it('formats yesterday correctly', () => {
            const yesterday = addDays(new Date(), -1);
            const label = formatDateLabel(yesterday);
            expect(label).toMatch(/^Yesterday \(/);
        });

        it('formats other dates with full format', () => {
            const date = addDays(new Date(), 5);
            const label = formatDateLabel(date);
            expect(label).toMatch(/^\w+, \w+ \d+, \d{4}$/);
        });
    });

    describe('formatAgendaItem', () => {
        it('formats a scheduled item', () => {
            const dummyHeadline = createHeadline({ title: 'Meeting' });
            const item: AgendaItem = {
                title: 'Meeting',
                tags: [],
                file: '/test/file.org',
                line: 1,
                headline: dummyHeadline,
                agendaType: 'scheduled',
                category: 'work',
                time: '14:00',
            };

            const formatted = formatAgendaItem(item);
            expect(formatted).toContain('work:');
            expect(formatted).toContain('14:00');
            expect(formatted).toContain('Scheduled:');
            expect(formatted).toContain('Meeting');
        });

        it('formats a deadline item with days until', () => {
            const dummyHeadline = createHeadline({ title: 'Report due', todoKeyword: 'TODO', priority: 'A' });
            const item: AgendaItem = {
                title: 'Report due',
                todoState: 'TODO',
                priority: 'A',
                tags: ['work', 'urgent'],
                file: '/test/file.org',
                line: 1,
                headline: dummyHeadline,
                agendaType: 'deadline',
                daysUntil: 3,
                overdue: false,
            };

            const formatted = formatAgendaItem(item);
            expect(formatted).toContain('In 3 d.:');
            expect(formatted).toContain('TODO');
            expect(formatted).toContain('[#A]');
            expect(formatted).toContain('Report due');
            expect(formatted).toContain(':work:urgent:');
        });

        it('formats an overdue deadline', () => {
            const dummyHeadline = createHeadline({ title: 'Overdue task' });
            const item: AgendaItem = {
                title: 'Overdue task',
                tags: [],
                file: '/test/file.org',
                line: 1,
                headline: dummyHeadline,
                agendaType: 'deadline',
                daysUntil: -2,
                overdue: true,
            };

            const formatted = formatAgendaItem(item);
            expect(formatted).toContain('In 2 d.:');
        });

        it('formats a deadline due today', () => {
            const dummyHeadline = createHeadline({ title: 'Due today' });
            const item: AgendaItem = {
                title: 'Due today',
                tags: [],
                file: '/test/file.org',
                line: 1,
                headline: dummyHeadline,
                agendaType: 'deadline',
                daysUntil: 0,
                overdue: false,
            };

            const formatted = formatAgendaItem(item);
            expect(formatted).toContain('Deadline:');
        });

        it('formats a diary sexp item with years', () => {
            const dummyHeadline = createHeadline({ title: 'Birthday' });
            const item: AgendaItem = {
                title: 'Birthday',
                tags: [],
                file: '/test/file.org',
                line: 1,
                headline: dummyHeadline,
                agendaType: 'diary',
                daysUntil: 30,
            };

            const formatted = formatAgendaItem(item);
            expect(formatted).toContain('(30 years)');
            expect(formatted).toContain('Birthday');
        });

        it('formats a diary sexp item without years', () => {
            const dummyHeadline = createHeadline({ title: 'Weekly meeting' });
            const item: AgendaItem = {
                title: 'Weekly meeting',
                tags: [],
                file: '/test/file.org',
                line: 1,
                headline: dummyHeadline,
                agendaType: 'diary',
            };

            const formatted = formatAgendaItem(item);
            expect(formatted).toContain('Sexp:');
        });
    });

    describe('generateAgendaView', () => {
        it('creates an empty view for no headlines', () => {
            const view = generateAgendaView([], new Map(), {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            expect(view.totalItems).toBe(0);
            expect(view.groups.length).toBe(7);
            expect(view.config.days).toBe(7);
        });

        it('extracts scheduled items within date range', () => {
            const scheduled = createTimestamp(2024, 6, 3, 10, 0);
            const headline = createHeadline({
                title: 'Team meeting',
                todoKeyword: 'TODO',
                lineNumber: 5,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline]);
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1), // June 1, 2024
                days: 7,
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].title).toBe('Team meeting');
            expect(items[0].agendaType).toBe('scheduled');
            expect(items[0].time).toBe('10:00');
        });

        it('extracts deadline items within date range', () => {
            const deadline = createTimestamp(2024, 6, 5);
            const headline = createHeadline({
                title: 'Report deadline',
                todoKeyword: 'TODO',
                priority: 'A',
                lineNumber: 10,
                planning: createPlanning({ deadline }),
            });

            const files = createFilesMap([headline]);
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].agendaType).toBe('deadline');
            expect(items[0].priority).toBe('A');
        });

        it('includes overdue deadlines when today is in the view range', () => {
            // Create a deadline in the past (before today)
            const today = new Date();
            const pastDate = addDays(today, -5);
            const pastDeadline = createTimestamp(
                pastDate.getFullYear(),
                pastDate.getMonth() + 1, // createTimestamp expects 1-indexed month
                pastDate.getDate()
            );
            const headline = createHeadline({
                title: 'Overdue task',
                todoKeyword: 'TODO',
                planning: createPlanning({ deadline: pastDeadline }),
            });

            const files = createFilesMap([headline]);
            // View includes today so overdue items are added to today's group
            const view = generateAgendaView([headline], files, {
                startDate: startOfDay(addDays(today, -3)),
                days: 7,
            });

            expect(view.totalItems).toBe(1);
            // Find today's group
            const todayKey = format(today, 'yyyy-MM-dd');
            const todayGroup = view.groups.find(g => g.key === todayKey);
            expect(todayGroup).toBeDefined();
            expect(todayGroup!.items.length).toBe(1);
            expect(todayGroup!.items[0].overdue).toBe(true);
        });

        it('respects todoStates filter', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Task 1',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Task 2',
                todoKeyword: 'DONE',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                todoStates: ['TODO'],
                showDone: true,
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].todoState).toBe('TODO');
        });

        it('respects includeTags filter', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Work task',
                todoKeyword: 'TODO',
                tags: ['work'],
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Home task',
                todoKeyword: 'TODO',
                tags: ['home'],
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                includeTags: ['work'],
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].title).toBe('Work task');
        });

        it('respects excludeTags filter', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Regular task',
                todoKeyword: 'TODO',
                tags: [],
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Hold task',
                todoKeyword: 'TODO',
                tags: ['hold'],
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                excludeTags: ['hold'],
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].title).toBe('Regular task');
        });

        it('respects priorities filter', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'High priority',
                todoKeyword: 'TODO',
                priority: 'A',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Low priority',
                todoKeyword: 'TODO',
                priority: 'C',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                priorities: ['A'],
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].priority).toBe('A');
        });

        it('respects categories filter', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Work task',
                todoKeyword: 'TODO',
                category: 'work',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Personal task',
                todoKeyword: 'TODO',
                category: 'personal',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                categories: ['work'],
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].category).toBe('work');
        });

        it('hides HABIT items when showHabits is false', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Exercise',
                todoKeyword: 'TODO',
                tags: ['HABIT'],
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Meeting',
                todoKeyword: 'TODO',
                tags: [],
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                showHabits: false,
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].title).toBe('Meeting');
        });

        it('hides DONE items when showDone is false', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Completed task',
                todoKeyword: 'DONE',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Open task',
                todoKeyword: 'TODO',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                showDone: false,
            });

            expect(view.totalItems).toBe(1);
            const items = view.groups.flatMap(g => g.items);
            expect(items[0].todoState).toBe('TODO');
        });

        it('sorts by time', () => {
            const scheduled1 = createTimestamp(2024, 6, 3, 14, 0);
            const scheduled2 = createTimestamp(2024, 6, 3, 9, 0);
            const headline1 = createHeadline({
                title: 'Afternoon task',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled: scheduled1 }),
            });
            const headline2 = createHeadline({
                title: 'Morning task',
                todoKeyword: 'TODO',
                lineNumber: 2,
                planning: createPlanning({ scheduled: scheduled2 }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                sortBy: 'time',
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].title).toBe('Morning task');
            expect(items[1].title).toBe('Afternoon task');
        });

        it('sorts by priority', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Low priority',
                todoKeyword: 'TODO',
                priority: 'C',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'High priority',
                todoKeyword: 'TODO',
                priority: 'A',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                sortBy: 'priority',
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].priority).toBe('A');
            expect(items[1].priority).toBe('C');
        });

        it('sorts by category', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Work task',
                todoKeyword: 'TODO',
                category: 'work',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Home task',
                todoKeyword: 'TODO',
                category: 'home',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                sortBy: 'category',
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].category).toBe('home');
            expect(items[1].category).toBe('work');
        });

        it('sorts by todo state', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Task in progress',
                todoKeyword: 'WIP',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Todo task',
                todoKeyword: 'TODO',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                sortBy: 'todo',
                showDone: true,
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].todoState).toBe('TODO');
            expect(items[1].todoState).toBe('WIP');
        });

        it('groups by date (default)', () => {
            const scheduled1 = createTimestamp(2024, 6, 3);
            const scheduled2 = createTimestamp(2024, 6, 5);
            const headline1 = createHeadline({
                title: 'Task 1',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled: scheduled1 }),
            });
            const headline2 = createHeadline({
                title: 'Task 2',
                todoKeyword: 'TODO',
                lineNumber: 2,
                planning: createPlanning({ scheduled: scheduled2 }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                groupBy: 'date',
            });

            // Should have 7 groups (one per day)
            expect(view.groups.length).toBe(7);
            // June 3 group should have 1 item
            const june3Group = view.groups.find(g => g.key === '2024-06-03');
            expect(june3Group?.items.length).toBe(1);
            // June 5 group should have 1 item
            const june5Group = view.groups.find(g => g.key === '2024-06-05');
            expect(june5Group?.items.length).toBe(1);
        });

        it('groups by category', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Work task',
                todoKeyword: 'TODO',
                category: 'work',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Home task',
                todoKeyword: 'TODO',
                category: 'home',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                groupBy: 'category',
            });

            expect(view.groups.length).toBe(2);
            expect(view.groups.map(g => g.key).sort()).toEqual(['home', 'work']);
        });

        it('groups by todo state', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Task 1',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Task 2',
                todoKeyword: 'WIP',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                groupBy: 'todo',
                showDone: true,
            });

            expect(view.groups.length).toBe(2);
            expect(view.groups.map(g => g.key).sort()).toEqual(['TODO', 'WIP']);
        });

        it('groups by priority', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'High priority',
                todoKeyword: 'TODO',
                priority: 'A',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'No priority',
                todoKeyword: 'TODO',
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                groupBy: 'priority',
            });

            expect(view.groups.length).toBe(2);
            const groupKeys = view.groups.map(g => g.key).sort();
            expect(groupKeys).toContain('A');
            expect(groupKeys).toContain('No Priority');
        });

        it('groups by tag', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline1 = createHeadline({
                title: 'Tagged task',
                todoKeyword: 'TODO',
                tags: ['important'],
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });
            const headline2 = createHeadline({
                title: 'Untagged task',
                todoKeyword: 'TODO',
                tags: [],
                lineNumber: 2,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline1, headline2]);
            const view = generateAgendaView([headline1, headline2], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                groupBy: 'tag',
            });

            expect(view.groups.length).toBe(2);
            expect(view.groups.map(g => g.key).sort()).toEqual(['Untagged', 'important']);
        });

        it('processes nested headlines', () => {
            const scheduled1 = createTimestamp(2024, 6, 3);
            const scheduled2 = createTimestamp(2024, 6, 4);
            const childHeadline = createHeadline({
                title: 'Child task',
                todoKeyword: 'TODO',
                lineNumber: 2,
                planning: createPlanning({ scheduled: scheduled2 }),
            });
            const parentHeadline = createHeadline({
                title: 'Parent task',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled: scheduled1 }),
                children: [childHeadline],
            });

            const files = createFilesMap([parentHeadline]);
            const view = generateAgendaView([parentHeadline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            expect(view.totalItems).toBe(2);
        });

        it('extracts repeater information', () => {
            const scheduled = createTimestamp(2024, 6, 3, undefined, undefined, {
                repeaterType: '+',
                repeaterValue: 1,
                repeaterUnit: 'w',
            });
            const headline = createHeadline({
                title: 'Weekly meeting',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline]);
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].repeater).toBe('+1w');
        });
    });

    describe('generateTodoList', () => {
        it('creates an empty list for no headlines', () => {
            const list = generateTodoList([], new Map());

            expect(list.counts.total).toBe(0);
            expect(list.byState.size).toBe(0);
            expect(list.byPriority.size).toBe(0);
        });

        it('includes only headlines with TODO states', () => {
            const headline1 = createHeadline({
                title: 'Todo task',
                todoKeyword: 'TODO',
                lineNumber: 1,
            });
            const headline2 = createHeadline({
                title: 'Plain headline',
                lineNumber: 2,
            });

            const files = createFilesMap([headline1, headline2]);
            const list = generateTodoList([headline1, headline2], files);

            expect(list.counts.total).toBe(1);
            expect(list.byState.has('TODO')).toBe(true);
            expect(list.byState.get('TODO')?.length).toBe(1);
        });

        it('groups items by state', () => {
            const headline1 = createHeadline({
                title: 'Task 1',
                todoKeyword: 'TODO',
                lineNumber: 1,
            });
            const headline2 = createHeadline({
                title: 'Task 2',
                todoKeyword: 'TODO',
                lineNumber: 2,
            });
            const headline3 = createHeadline({
                title: 'Task 3',
                todoKeyword: 'WIP',
                lineNumber: 3,
            });

            const files = createFilesMap([headline1, headline2, headline3]);
            const list = generateTodoList([headline1, headline2, headline3], files);

            expect(list.byState.get('TODO')?.length).toBe(2);
            expect(list.byState.get('WIP')?.length).toBe(1);
            expect(list.counts.byState['TODO']).toBe(2);
            expect(list.counts.byState['WIP']).toBe(1);
        });

        it('groups items by priority', () => {
            const headline1 = createHeadline({
                title: 'High priority',
                todoKeyword: 'TODO',
                priority: 'A',
                lineNumber: 1,
            });
            const headline2 = createHeadline({
                title: 'No priority',
                todoKeyword: 'TODO',
                lineNumber: 2,
            });

            const files = createFilesMap([headline1, headline2]);
            const list = generateTodoList([headline1, headline2], files);

            expect(list.byPriority.get('A')?.length).toBe(1);
            expect(list.byPriority.get('None')?.length).toBe(1);
            expect(list.counts.byPriority['A']).toBe(1);
            expect(list.counts.byPriority['None']).toBe(1);
        });

        it('respects states filter', () => {
            const headline1 = createHeadline({
                title: 'Todo task',
                todoKeyword: 'TODO',
                lineNumber: 1,
            });
            const headline2 = createHeadline({
                title: 'Done task',
                todoKeyword: 'DONE',
                lineNumber: 2,
            });

            const files = createFilesMap([headline1, headline2]);
            const list = generateTodoList([headline1, headline2], files, {
                states: ['TODO'],
            });

            expect(list.counts.total).toBe(1);
            expect(list.byState.has('TODO')).toBe(true);
            expect(list.byState.has('DONE')).toBe(false);
        });

        it('respects excludeDone filter', () => {
            const headline1 = createHeadline({
                title: 'Todo task',
                todoKeyword: 'TODO',
                lineNumber: 1,
            });
            const headline2 = createHeadline({
                title: 'Done task',
                todoKeyword: 'DONE',
                lineNumber: 2,
            });
            const headline3 = createHeadline({
                title: 'Cancelled task',
                todoKeyword: 'CANCELLED',
                lineNumber: 3,
            });

            const files = createFilesMap([headline1, headline2, headline3]);
            const list = generateTodoList([headline1, headline2, headline3], files, {
                excludeDone: true,
            });

            expect(list.counts.total).toBe(1);
            expect(list.byState.has('DONE')).toBe(false);
            expect(list.byState.has('CANCELLED')).toBe(false);
        });

        it('respects tags filter', () => {
            const headline1 = createHeadline({
                title: 'Work task',
                todoKeyword: 'TODO',
                tags: ['work'],
                lineNumber: 1,
            });
            const headline2 = createHeadline({
                title: 'Home task',
                todoKeyword: 'TODO',
                tags: ['home'],
                lineNumber: 2,
            });

            const files = createFilesMap([headline1, headline2]);
            const list = generateTodoList([headline1, headline2], files, {
                tags: ['work'],
            });

            expect(list.counts.total).toBe(1);
            expect(list.byState.get('TODO')?.[0].title).toBe('Work task');
        });

        it('includes planning information', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const deadline = createTimestamp(2024, 6, 10);
            const headline = createHeadline({
                title: 'Task with dates',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled, deadline }),
            });

            const files = createFilesMap([headline]);
            const list = generateTodoList([headline], files);

            const item = list.byState.get('TODO')?.[0];
            expect(item?.scheduled).toBeInstanceOf(Date);
            expect(item?.deadline).toBeInstanceOf(Date);
            expect(item?.daysUntil).toBeDefined();
        });

        it('processes nested headlines', () => {
            const childHeadline = createHeadline({
                title: 'Child task',
                todoKeyword: 'TODO',
                lineNumber: 2,
            });
            const parentHeadline = createHeadline({
                title: 'Parent',
                lineNumber: 1,
                children: [childHeadline],
            });

            const files = createFilesMap([parentHeadline]);
            const list = generateTodoList([parentHeadline], files);

            expect(list.counts.total).toBe(1);
            expect(list.byState.get('TODO')?.[0].title).toBe('Child task');
        });

        it('includes category from properties drawer', () => {
            const headline = createHeadline({
                title: 'Categorized task',
                todoKeyword: 'TODO',
                category: 'myproject',
                lineNumber: 1,
            });

            const files = createFilesMap([headline]);
            const list = generateTodoList([headline], files);

            const item = list.byState.get('TODO')?.[0];
            expect(item?.category).toBe('myproject');
        });
    });

    describe('formatAgendaView', () => {
        it('formats an empty view', () => {
            const view = generateAgendaView([], new Map(), {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            const formatted = formatAgendaView(view);
            expect(formatted).toContain('Agenda for Jun 1 - Jun 7, 2024');
            expect(formatted).toContain('Total: 0 items');
        });

        it('formats a view with items', () => {
            const scheduled = createTimestamp(2024, 6, 3, 10, 0);
            const headline = createHeadline({
                title: 'Team meeting',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline]);
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            const formatted = formatAgendaView(view);
            expect(formatted).toContain('Team meeting');
            expect(formatted).toContain('Total: 1 items');
        });

        it('shows group labels', () => {
            const scheduled = createTimestamp(2024, 6, 3, 10, 0);
            const headline = createHeadline({
                title: 'Task',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline]);
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                groupBy: 'date',
            });

            const formatted = formatAgendaView(view);
            // Should contain the date header for June 3
            expect(formatted).toMatch(/Monday, June 3, 2024/);
        });
    });

    describe('view types', () => {
        it('creates a day view (1 day)', () => {
            const view = generateAgendaView([], new Map(), {
                type: 'day',
                startDate: new Date(2024, 5, 1),
                days: 1,
            });

            expect(view.config.days).toBe(1);
            expect(view.groups.length).toBe(1);
        });

        it('creates a week view (7 days)', () => {
            const view = generateAgendaView([], new Map(), {
                type: 'week',
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            expect(view.config.days).toBe(7);
            expect(view.groups.length).toBe(7);
        });

        it('creates a fortnight view (14 days)', () => {
            const view = generateAgendaView([], new Map(), {
                type: 'fortnight',
                startDate: new Date(2024, 5, 1),
                days: 14,
            });

            expect(view.config.days).toBe(14);
            expect(view.groups.length).toBe(14);
        });

        it('creates a month view (30 days)', () => {
            const view = generateAgendaView([], new Map(), {
                type: 'month',
                startDate: new Date(2024, 5, 1),
                days: 30,
            });

            expect(view.config.days).toBe(30);
            expect(view.groups.length).toBe(30);
        });
    });

    describe('edge cases', () => {
        it('handles headline without rawValue', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: { start: 0, end: 0 },
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: '',
                    title: [],
                    todoKeyword: 'TODO',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const files = new Map<string, string>();
            files.set('1:', '/test/file.org');

            const list = generateTodoList([headline], files);
            expect(list.counts.total).toBe(1);
        });

        it('handles headline with no file mapping', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline = createHeadline({
                title: 'Orphan task',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });

            // Empty files map
            const view = generateAgendaView([headline], new Map(), {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].file).toBe('unknown');
        });

        it('handles timestamp without time', () => {
            const scheduled = createTimestamp(2024, 6, 3); // No time
            const headline = createHeadline({
                title: 'All day event',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
            });

            const files = createFilesMap([headline]);
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].time).toBeUndefined();
        });

        it('extracts category from filename when no CATEGORY property', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const headline = createHeadline({
                title: 'Task',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled }),
                // No category property
            });

            const files = createFilesMap([headline], '/projects/myproject.org');
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            const items = view.groups.flatMap(g => g.items);
            expect(items[0].category).toBe('myproject');
        });

        it('handles multiple items on same day', () => {
            const scheduled1 = createTimestamp(2024, 6, 3, 9, 0);
            const scheduled2 = createTimestamp(2024, 6, 3, 14, 0);
            const scheduled3 = createTimestamp(2024, 6, 3, 18, 0);

            const headline1 = createHeadline({
                title: 'Morning meeting',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled: scheduled1 }),
            });
            const headline2 = createHeadline({
                title: 'Afternoon task',
                todoKeyword: 'TODO',
                lineNumber: 2,
                planning: createPlanning({ scheduled: scheduled2 }),
            });
            const headline3 = createHeadline({
                title: 'Evening event',
                todoKeyword: 'TODO',
                lineNumber: 3,
                planning: createPlanning({ scheduled: scheduled3 }),
            });

            const files = createFilesMap([headline1, headline2, headline3]);
            const view = generateAgendaView([headline1, headline2, headline3], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
                sortBy: 'time',
            });

            const june3Group = view.groups.find(g => g.key === '2024-06-03');
            expect(june3Group?.items.length).toBe(3);
            expect(june3Group?.items[0].title).toBe('Morning meeting');
            expect(june3Group?.items[1].title).toBe('Afternoon task');
            expect(june3Group?.items[2].title).toBe('Evening event');
        });

        it('handles item with both scheduled and deadline', () => {
            const scheduled = createTimestamp(2024, 6, 3);
            const deadline = createTimestamp(2024, 6, 5);
            const headline = createHeadline({
                title: 'Task with both dates',
                todoKeyword: 'TODO',
                lineNumber: 1,
                planning: createPlanning({ scheduled, deadline }),
            });

            const files = createFilesMap([headline]);
            const view = generateAgendaView([headline], files, {
                startDate: new Date(2024, 5, 1),
                days: 7,
            });

            // Should create two items - one for scheduled, one for deadline
            expect(view.totalItems).toBe(2);
            const items = view.groups.flatMap(g => g.items);
            const types = items.map(i => i.agendaType);
            expect(types).toContain('scheduled');
            expect(types).toContain('deadline');
        });
    });
});
