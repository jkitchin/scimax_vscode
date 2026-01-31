/**
 * Agenda command - display scheduled items, deadlines, TODOs
 *
 * Uses the same settings as the VS Code extension for consistent behavior.
 */

import { createCliDatabase, CliDatabase, CliAgendaItem, CliHeadingRecord } from '../database';
import { loadSettings, AgendaSettings } from '../settings';

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

export async function agendaCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const view = args.subcommand || 'today';
    const settings = loadSettings();
    const db = await createCliDatabase(config.dbPath);

    try {
        switch (view) {
            case 'today':
                await showTodayAgenda(db, settings.agenda);
                break;
            case 'week':
                await showWeekAgenda(db, settings.agenda);
                break;
            case 'todos':
                await showTodos(db, args.flags, settings.agenda);
                break;
            case 'overdue':
                await showOverdue(db, settings.agenda);
                break;
            default:
                console.log(`Unknown agenda view: ${view}`);
                console.log('Available: today, week, todos, overdue');
        }
    } finally {
        await db.close();
    }
}

async function showTodayAgenda(db: CliDatabase, settings: AgendaSettings): Promise<void> {
    console.log('=== Today\'s Agenda ===\n');

    const items = await db.getAgendaItems(1);

    // Filter based on settings
    const filtered = items.filter(item => {
        // Skip done items unless showDone is true
        if (!settings.showDone && item.todo_state && settings.doneStates.includes(item.todo_state)) {
            return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        console.log('No items scheduled for today.');
        return;
    }

    for (const item of filtered) {
        const marker = item.todo_state || '   ';
        const prefix = item.days_until === 0 ? 'Today' : `In ${item.days_until}d`;
        console.log(`  ${marker.padEnd(8)} ${prefix.padEnd(8)} ${item.title}`);
        console.log(`           ${item.file_path}:${item.line_number}`);
    }
}

async function showWeekAgenda(db: CliDatabase, settings: AgendaSettings): Promise<void> {
    console.log(`=== ${settings.defaultSpan}-Day Agenda ===\n`);

    const items = await db.getAgendaItems(settings.defaultSpan);

    // Filter based on settings
    const filtered = items.filter(item => {
        // Skip done items unless showDone is true
        if (!settings.showDone && item.todo_state && settings.doneStates.includes(item.todo_state)) {
            return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        console.log(`No items scheduled for the next ${settings.defaultSpan} days.`);
        return;
    }

    // Group by days until
    const grouped = new Map<number, typeof filtered>();
    for (const item of filtered) {
        const days = item.days_until ?? 999;
        if (!grouped.has(days)) {
            grouped.set(days, []);
        }
        grouped.get(days)!.push(item);
    }

    const sortedDays = [...grouped.keys()].sort((a, b) => a - b);

    for (const days of sortedDays) {
        const dayLabel = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
        console.log(`${dayLabel}:`);

        for (const item of grouped.get(days)!) {
            const marker = item.todo_state || '   ';
            console.log(`  ${marker.padEnd(8)} ${item.title}`);
        }
        console.log();
    }
}

async function showTodos(db: CliDatabase, flags: Record<string, string | boolean>, settings: AgendaSettings): Promise<void> {
    const state = typeof flags.state === 'string' ? flags.state : undefined;

    console.log(`=== TODO Items${state ? ` (${state})` : ''} ===\n`);

    const headings = await db.searchHeadings('', { limit: 500 });

    // Filter to those with TODO states using settings
    const todos = headings.filter((h: CliHeadingRecord) => {
        if (!h.todo_state) return false;
        if (state && h.todo_state !== state) return false;
        // Exclude done states using settings (unless showDone is true)
        if (!state && !settings.showDone && settings.doneStates.includes(h.todo_state)) return false;
        return true;
    });

    if (todos.length === 0) {
        console.log('No TODO items found.');
        return;
    }

    // Group by state, prioritizing active states from settings
    const byState = new Map<string, typeof todos>();
    for (const todo of todos) {
        const s = todo.todo_state!;
        if (!byState.has(s)) {
            byState.set(s, []);
        }
        byState.get(s)!.push(todo);
    }

    // Sort states: active states first (in order), then done states
    const stateOrder = [...settings.todoStates, ...settings.doneStates];
    const sortedStates = [...byState.keys()].sort((a, b) => {
        const aIdx = stateOrder.indexOf(a);
        const bIdx = stateOrder.indexOf(b);
        if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
    });

    for (const todoState of sortedStates) {
        const items = byState.get(todoState)!;
        console.log(`${todoState} (${items.length}):`);
        for (const item of items.slice(0, 20)) { // Limit output
            console.log(`  ${item.title}`);
            console.log(`    ${item.file_path}:${item.line_number}`);
        }
        if (items.length > 20) {
            console.log(`  ... and ${items.length - 20} more`);
        }
        console.log();
    }
}

async function showOverdue(db: CliDatabase, settings: AgendaSettings): Promise<void> {
    console.log('=== Overdue Items ===\n');

    // Get items with negative days_until (past deadline)
    const items = await db.getAgendaItems(0);
    const overdue = items.filter((i: CliAgendaItem) => {
        if ((i.days_until ?? 0) >= 0) return false;
        // Skip done items unless showDone is true
        if (!settings.showDone && i.todo_state && settings.doneStates.includes(i.todo_state)) {
            return false;
        }
        return true;
    });

    if (overdue.length === 0) {
        console.log('No overdue items!');
        return;
    }

    for (const item of overdue) {
        const daysOverdue = Math.abs(item.days_until ?? 0);
        const marker = item.todo_state || '   ';
        console.log(`  ${marker.padEnd(8)} ${daysOverdue}d overdue: ${item.title}`);
        console.log(`           ${item.file_path}:${item.line_number}`);
    }
}
