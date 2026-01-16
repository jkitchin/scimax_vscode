/**
 * Agenda command - display scheduled items, deadlines, TODOs
 *
 * NOTE: This is a sketch. The ScimaxDb class currently requires VS Code context.
 * To fully implement CLI support, we'd need to:
 * 1. Extract database core into a context-free class (CliDatabase)
 * 2. Have ScimaxDb extend/wrap CliDatabase for VS Code features
 * 3. Use CliDatabase directly in CLI commands
 */

import { createCliDatabase, CliDatabase, CliAgendaItem, CliHeadingRecord } from '../database';

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
    const db = await createCliDatabase(config.dbPath);

    try {
        switch (view) {
            case 'today':
                await showTodayAgenda(db);
                break;
            case 'week':
                await showWeekAgenda(db);
                break;
            case 'todos':
                await showTodos(db, args.flags);
                break;
            case 'overdue':
                await showOverdue(db);
                break;
            default:
                console.log(`Unknown agenda view: ${view}`);
                console.log('Available: today, week, todos, overdue');
        }
    } finally {
        await db.close();
    }
}

async function showTodayAgenda(db: CliDatabase): Promise<void> {
    console.log('=== Today\'s Agenda ===\n');

    const items = await db.getAgendaItems(1);

    if (items.length === 0) {
        console.log('No items scheduled for today.');
        return;
    }

    for (const item of items) {
        const marker = item.todo_state || '   ';
        const prefix = item.days_until === 0 ? 'Today' : `In ${item.days_until}d`;
        console.log(`  ${marker.padEnd(8)} ${prefix.padEnd(8)} ${item.title}`);
        console.log(`           ${item.file_path}:${item.line_number}`);
    }
}

async function showWeekAgenda(db: CliDatabase): Promise<void> {
    console.log('=== Week Agenda ===\n');

    const items = await db.getAgendaItems(7);

    if (items.length === 0) {
        console.log('No items scheduled for this week.');
        return;
    }

    // Group by days until
    const grouped = new Map<number, typeof items>();
    for (const item of items) {
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

async function showTodos(db: CliDatabase, flags: Record<string, string | boolean>): Promise<void> {
    const state = typeof flags.state === 'string' ? flags.state : undefined;

    console.log(`=== TODO Items${state ? ` (${state})` : ''} ===\n`);

    const headings = await db.searchHeadings('', { limit: 500 });

    // Filter to those with TODO states
    const todos = headings.filter((h: CliHeadingRecord) => {
        if (!h.todo_state) return false;
        if (state && h.todo_state !== state) return false;
        // Exclude done states
        if (!state && (h.todo_state === 'DONE' || h.todo_state === 'CANCELLED')) return false;
        return true;
    });

    if (todos.length === 0) {
        console.log('No TODO items found.');
        return;
    }

    // Group by state
    const byState = new Map<string, typeof todos>();
    for (const todo of todos) {
        const s = todo.todo_state!;
        if (!byState.has(s)) {
            byState.set(s, []);
        }
        byState.get(s)!.push(todo);
    }

    for (const [todoState, items] of byState) {
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

async function showOverdue(db: CliDatabase): Promise<void> {
    console.log('=== Overdue Items ===\n');

    // Get items with negative days_until (past deadline)
    const items = await db.getAgendaItems(0);
    const overdue = items.filter((i: CliAgendaItem) => (i.days_until ?? 0) < 0);

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
