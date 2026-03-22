/**
 * Agenda command - display scheduled items, deadlines, TODOs
 *
 * Uses the same settings as the VS Code extension for consistent behavior.
 */

import { createCliDatabase, CliDatabase } from '../database';
import type { ScimaxDbCore, AgendaItem, HeadingRecord } from '../../database/scimaxDbCore';
import { loadSettings, AgendaSettings } from '../settings';
import { vscodeLinkAt } from '../links';
import { format, addDays } from 'date-fns';

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

/** Compute an ISO date string N days from today (for getAgenda `before` option) */
function addDaysToToday(n: number): string {
    return format(addDays(new Date(), n), 'yyyy-MM-dd');
}

/** Flatten an AgendaItem into a plain object suitable for JSON output */
function agendaItemToJson(item: AgendaItem) {
    return {
        title: item.heading.title,
        todo_state: item.heading.todo_state || null,
        type: item.type,
        scheduled: item.heading.scheduled || null,
        deadline: item.heading.deadline || null,
        days_until: item.days_until ?? null,
        overdue: item.overdue ?? false,
        tags: item.heading.tags || null,
        priority: item.heading.priority || null,
        file_path: item.heading.file_path,
        line_number: item.heading.line_number,
    };
}

export async function agendaCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const view = args.subcommand || 'today';
    const json = args.flags.json === true;
    const settings = loadSettings();
    const db = await createCliDatabase(config.dbPath);

    try {
        switch (view) {
            case 'today':
                await showTodayAgenda(db, settings.agenda, json);
                break;
            case 'week':
                await showWeekAgenda(db, settings.agenda, json);
                break;
            case 'todos':
                await showTodos(db, args.flags, settings.agenda, json);
                break;
            case 'overdue':
                await showOverdue(db, settings.agenda, json);
                break;
            default:
                console.log(`Unknown agenda view: ${view}`);
                console.log('Available: today, week, todos, overdue');
        }
    } finally {
        await db.close();
    }
}

function filterAgendaItems(items: AgendaItem[], settings: AgendaSettings): AgendaItem[] {
    return items.filter((item: AgendaItem) => {
        const todoState = item.heading.todo_state;
        if (!todoState) return true; // plain scheduled/deadline with no TODO keyword
        if (settings.todoStates.includes(todoState)) return true; // active TODO state
        if (settings.showDone && settings.doneStates.includes(todoState)) return true; // done (if enabled)
        return false; // unknown/done state (ABANDONDED, DECLINED, DONE, CANCELLED, etc.)
    });
}

async function showTodayAgenda(db: ScimaxDbCore, settings: AgendaSettings, json: boolean): Promise<void> {
    const items = await db.getAgenda({
        before: addDaysToToday(1),
        requireTodoState: settings.requireTodoState,
        doneStates: settings.doneStates,
    });

    const filtered = filterAgendaItems(items, settings);

    if (json) {
        console.log(JSON.stringify({
            view: 'today',
            date: format(new Date(), 'yyyy-MM-dd'),
            count: filtered.length,
            items: filtered.map(agendaItemToJson),
        }, null, 2));
        return;
    }

    console.log('=== Today\'s Agenda ===\n');

    if (filtered.length === 0) {
        console.log('No items scheduled for today.');
        return;
    }

    for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const marker = item.heading.todo_state || '   ';
        const prefix = item.days_until === 0 ? 'Today' : `In ${item.days_until}d`;
        const link = vscodeLinkAt(item.heading.file_path, item.heading.line_number);
        console.log(`  ${String(i + 1).padStart(2)}. ${marker.padEnd(8)} ${prefix.padEnd(8)} ${item.heading.title}`);
        console.log(`           ${link}`);
        console.log();
    }
}

async function showWeekAgenda(db: ScimaxDbCore, settings: AgendaSettings, json: boolean): Promise<void> {
    const items = await db.getAgenda({
        before: addDaysToToday(settings.defaultSpan),
        requireTodoState: settings.requireTodoState,
        doneStates: settings.doneStates,
    });

    const filtered = filterAgendaItems(items, settings);

    if (json) {
        console.log(JSON.stringify({
            view: 'week',
            date: format(new Date(), 'yyyy-MM-dd'),
            span_days: settings.defaultSpan,
            count: filtered.length,
            items: filtered.map(agendaItemToJson),
        }, null, 2));
        return;
    }

    console.log(`=== ${settings.defaultSpan}-Day Agenda ===\n`);

    if (filtered.length === 0) {
        console.log(`No items scheduled for the next ${settings.defaultSpan} days.`);
        return;
    }

    // Group by days until
    const grouped = new Map<number, AgendaItem[]>();
    for (const item of filtered) {
        const days = item.days_until ?? 999;
        if (!grouped.has(days)) grouped.set(days, []);
        grouped.get(days)!.push(item);
    }

    const sortedDays = [...grouped.keys()].sort((a, b) => a - b);

    let idx = 0;
    for (const days of sortedDays) {
        const dayLabel = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
        console.log(`${dayLabel}:`);
        for (const item of grouped.get(days)!) {
            const marker = item.heading.todo_state || '   ';
            const link = vscodeLinkAt(item.heading.file_path, item.heading.line_number);
            console.log(`  ${String(idx + 1).padStart(2)}. ${marker.padEnd(8)} ${item.heading.title}`);
            console.log(`           ${link}`);
            idx++;
        }
        console.log();
    }
}

async function showTodos(db: ScimaxDbCore, flags: Record<string, string | boolean>, settings: AgendaSettings, json: boolean): Promise<void> {
    const state = typeof flags.state === 'string' ? flags.state : undefined;

    const headings = await db.searchHeadings('', { limit: 500 });

    const todos = headings.filter((h: HeadingRecord) => {
        if (!h.todo_state) return false;
        if (state) return h.todo_state === state; // --state flag: show exactly that state
        if (settings.doneStates.includes(h.todo_state)) return settings.showDone; // done states
        return settings.todoStates.includes(h.todo_state); // only configured active states
    });

    if (json) {
        console.log(JSON.stringify({
            view: 'todos',
            state: state || null,
            count: todos.length,
            items: todos.map(h => ({
                title: h.title,
                todo_state: h.todo_state,
                priority: h.priority || null,
                tags: h.tags || null,
                scheduled: h.scheduled || null,
                deadline: h.deadline || null,
                file_path: h.file_path,
                line_number: h.line_number,
            })),
        }, null, 2));
        return;
    }

    console.log(`=== TODO Items${state ? ` (${state})` : ''} ===\n`);

    if (todos.length === 0) {
        console.log('No TODO items found.');
        return;
    }

    // Group by state
    const byState = new Map<string, HeadingRecord[]>();
    for (const todo of todos) {
        const s = todo.todo_state!;
        if (!byState.has(s)) byState.set(s, []);
        byState.get(s)!.push(todo);
    }

    const stateOrder = [...settings.todoStates, ...settings.doneStates];
    const sortedStates = [...byState.keys()].sort((a, b) => {
        const aIdx = stateOrder.indexOf(a);
        const bIdx = stateOrder.indexOf(b);
        if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
    });

    let idx = 0;
    for (const todoState of sortedStates) {
        const items = byState.get(todoState)!;
        console.log(`${todoState} (${items.length}):`);
        for (const item of items.slice(0, 20)) {
            const link = vscodeLinkAt(item.file_path, item.line_number);
            console.log(`  ${String(idx + 1).padStart(2)}. ${item.title}`);
            console.log(`      ${link}`);
            idx++;
        }
        if (items.length > 20) {
            console.log(`  ... and ${items.length - 20} more`);
        }
        console.log();
    }
}

async function showOverdue(db: ScimaxDbCore, settings: AgendaSettings, json: boolean): Promise<void> {
    const items = await db.getAgenda({
        before: addDaysToToday(0),
        requireTodoState: settings.requireTodoState,
        doneStates: settings.doneStates,
    });

    const overdue = items.filter((i: AgendaItem) => {
        if ((i.days_until ?? 0) >= 0) return false;
        const todoState = i.heading.todo_state;
        if (!settings.showDone && todoState && settings.doneStates.includes(todoState)) {
            return false;
        }
        return true;
    });

    if (json) {
        console.log(JSON.stringify({
            view: 'overdue',
            date: format(new Date(), 'yyyy-MM-dd'),
            count: overdue.length,
            items: overdue.map(agendaItemToJson),
        }, null, 2));
        return;
    }

    console.log('=== Overdue Items ===\n');

    if (overdue.length === 0) {
        console.log('No overdue items!');
        return;
    }

    for (let i = 0; i < overdue.length; i++) {
        const item = overdue[i];
        const daysOverdue = Math.abs(item.days_until ?? 0);
        const marker = item.heading.todo_state || '   ';
        const link = vscodeLinkAt(item.heading.file_path, item.heading.line_number);
        console.log(`  ${String(i + 1).padStart(2)}. ${marker.padEnd(8)} ${daysOverdue}d overdue: ${item.heading.title}`);
        console.log(`           ${link}`);
        console.log();
    }
}
