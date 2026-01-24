import * as vscode from 'vscode';
import * as path from 'path';
import {
    MarkdownTask,
    parseTaskLine,
    parseTasksFromFile,
    formatDate,
    formatRelativeDate,
    isOverdue,
    isDueToday,
    isScheduledToday,
    sortTasks
} from './taskParser';
import { parseRelativeDate } from '../utils/dateParser';
import { DAY_NAMES_SHORT, MONTH_NAMES_FULL } from '../utils/dateConstants';

/**
 * Insert a due date at cursor
 */
async function insertDueDate(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const date = await pickDate('Select due date');
    if (!date) return;

    const dateStr = formatDate(date);
    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, `@due(${dateStr}) `);
    });
}

/**
 * Insert a scheduled date at cursor
 */
async function insertScheduledDate(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const date = await pickDate('Select scheduled date');
    if (!date) return;

    const dateStr = formatDate(date);
    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, `@scheduled(${dateStr}) `);
    });
}

/**
 * Insert priority at cursor
 */
async function insertPriority(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const priority = await vscode.window.showQuickPick(
        [
            { label: 'A', description: 'High priority' },
            { label: 'B', description: 'Medium priority' },
            { label: 'C', description: 'Low priority' }
        ],
        { placeHolder: 'Select priority' }
    );

    if (!priority) return;

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, `@priority(${priority.label}) `);
    });
}

/**
 * Insert a new task with template
 */
async function insertTask(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const title = await vscode.window.showInputBox({
        prompt: 'Task title',
        placeHolder: 'Enter task description'
    });

    if (!title) return;

    // Ask for optional due date
    const addDue = await vscode.window.showQuickPick(
        ['No due date', 'Today', 'Tomorrow', 'Next week', 'Pick date...'],
        { placeHolder: 'Add due date?' }
    );

    let dueStr = '';
    if (addDue === 'Today') {
        dueStr = ` @due(${formatDate(new Date())})`;
    } else if (addDue === 'Tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dueStr = ` @due(${formatDate(tomorrow)})`;
    } else if (addDue === 'Next week') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        dueStr = ` @due(${formatDate(nextWeek)})`;
    } else if (addDue === 'Pick date...') {
        const date = await pickDate('Select due date');
        if (date) {
            dueStr = ` @due(${formatDate(date)})`;
        }
    }

    // Ask for optional priority
    const addPriority = await vscode.window.showQuickPick(
        ['No priority', 'A - High', 'B - Medium', 'C - Low'],
        { placeHolder: 'Add priority?' }
    );

    let priorityStr = '';
    if (addPriority?.startsWith('A')) {
        priorityStr = ' @priority(A)';
    } else if (addPriority?.startsWith('B')) {
        priorityStr = ' @priority(B)';
    } else if (addPriority?.startsWith('C')) {
        priorityStr = ' @priority(C)';
    }

    const taskLine = `- [ ] ${title}${priorityStr}${dueStr}\n`;

    await editor.edit(editBuilder => {
        const position = editor.selection.active;
        const lineStart = new vscode.Position(position.line, 0);
        editBuilder.insert(lineStart, taskLine);
    });
}

/**
 * Show agenda view with tasks from workspace
 */
async function showAgenda(): Promise<void> {
    const tasks = await collectAllTasks();

    if (tasks.length === 0) {
        vscode.window.showInformationMessage('No tasks found in workspace');
        return;
    }

    // Group tasks
    const overdue = tasks.filter(t => isOverdue(t));
    const today = tasks.filter(t => isDueToday(t) || isScheduledToday(t));
    const upcoming = tasks.filter(t => {
        if (t.completed) return false;
        if (!t.due && !t.scheduled) return false;
        if (isOverdue(t) || isDueToday(t) || isScheduledToday(t)) return false;
        const targetDate = t.due || t.scheduled!;
        const weekFromNow = new Date();
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        return targetDate <= weekFromNow;
    });
    const other = tasks.filter(t => !t.completed && !isOverdue(t) && !isDueToday(t) && !isScheduledToday(t) && !upcoming.includes(t));
    const completed = tasks.filter(t => t.completed);

    // Build quick pick items
    const items: (vscode.QuickPickItem & { task?: MarkdownTask })[] = [];

    if (overdue.length > 0) {
        items.push({ label: '🔴 Overdue', kind: vscode.QuickPickItemKind.Separator });
        for (const task of sortTasks(overdue)) {
            items.push(formatTaskForQuickPick(task));
        }
    }

    if (today.length > 0) {
        items.push({ label: '📅 Today', kind: vscode.QuickPickItemKind.Separator });
        for (const task of sortTasks(today)) {
            items.push(formatTaskForQuickPick(task));
        }
    }

    if (upcoming.length > 0) {
        items.push({ label: '📆 Upcoming (7 days)', kind: vscode.QuickPickItemKind.Separator });
        for (const task of sortTasks(upcoming)) {
            items.push(formatTaskForQuickPick(task));
        }
    }

    if (other.length > 0) {
        items.push({ label: '📋 Other Tasks', kind: vscode.QuickPickItemKind.Separator });
        for (const task of sortTasks(other).slice(0, 20)) { // Limit to 20
            items.push(formatTaskForQuickPick(task));
        }
    }

    if (completed.length > 0) {
        items.push({ label: `✅ Completed (${completed.length})`, kind: vscode.QuickPickItemKind.Separator });
        for (const task of completed.slice(0, 5)) { // Show only 5 recent
            items.push(formatTaskForQuickPick(task));
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${tasks.length} tasks found - select to jump to task`,
        matchOnDescription: true
    });

    if (selected?.task) {
        await jumpToTask(selected.task);
    }
}

/**
 * Show only today's tasks
 */
async function showTodaysTasks(): Promise<void> {
    const tasks = await collectAllTasks();
    const todaysTasks = tasks.filter(t => isDueToday(t) || isScheduledToday(t) || isOverdue(t));

    if (todaysTasks.length === 0) {
        vscode.window.showInformationMessage('No tasks due today!');
        return;
    }

    const items = sortTasks(todaysTasks).map(formatTaskForQuickPick);

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${todaysTasks.length} tasks for today`,
        matchOnDescription: true
    });

    if (selected?.task) {
        await jumpToTask(selected.task);
    }
}

/**
 * Show tasks by project
 */
async function showTasksByProject(): Promise<void> {
    const tasks = await collectAllTasks();
    const incompleteTasks = tasks.filter(t => !t.completed);

    // Group by project
    const byProject = new Map<string, MarkdownTask[]>();
    for (const task of incompleteTasks) {
        const project = task.project || '(No project)';
        if (!byProject.has(project)) {
            byProject.set(project, []);
        }
        byProject.get(project)!.push(task);
    }

    // Pick project
    const projectItems = Array.from(byProject.entries()).map(([project, tasks]) => ({
        label: project,
        description: `${tasks.length} tasks`
    }));

    const selectedProject = await vscode.window.showQuickPick(projectItems, {
        placeHolder: 'Select project'
    });

    if (!selectedProject) return;

    const projectTasks = byProject.get(selectedProject.label) || [];
    const items = sortTasks(projectTasks).map(formatTaskForQuickPick);

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Tasks in ${selectedProject.label}`,
        matchOnDescription: true
    });

    if (selected?.task) {
        await jumpToTask(selected.task);
    }
}

/**
 * Show tasks by tag
 */
async function showTasksByTag(): Promise<void> {
    const tasks = await collectAllTasks();
    const incompleteTasks = tasks.filter(t => !t.completed);

    // Collect all tags
    const tagCounts = new Map<string, number>();
    for (const task of incompleteTasks) {
        for (const tag of task.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
    }

    if (tagCounts.size === 0) {
        vscode.window.showInformationMessage('No tags found in tasks');
        return;
    }

    // Pick tag
    const tagItems = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => ({
            label: `#${tag}`,
            description: `${count} tasks`
        }));

    const selectedTag = await vscode.window.showQuickPick(tagItems, {
        placeHolder: 'Select tag'
    });

    if (!selectedTag) return;

    const tag = selectedTag.label.slice(1); // Remove #
    const taggedTasks = incompleteTasks.filter(t => t.tags.includes(tag));
    const items = sortTasks(taggedTasks).map(formatTaskForQuickPick);

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Tasks tagged #${tag}`,
        matchOnDescription: true
    });

    if (selected?.task) {
        await jumpToTask(selected.task);
    }
}

/**
 * Collect all tasks from workspace
 */
async function collectAllTasks(): Promise<MarkdownTask[]> {
    const tasks: MarkdownTask[] = [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return tasks;

    // Find all markdown and org files
    const files = await vscode.workspace.findFiles(
        '**/*.{md,markdown,org}',
        '**/node_modules/**',
        500
    );

    for (const file of files) {
        const fileTasks = await parseTasksFromFile(file.fsPath);
        tasks.push(...fileTasks);
    }

    return tasks;
}

/**
 * Format a task for quick pick display
 */
function formatTaskForQuickPick(task: MarkdownTask): vscode.QuickPickItem & { task: MarkdownTask } {
    let icon = task.completed ? '✅' : '⬜';
    if (!task.completed) {
        if (isOverdue(task)) icon = '🔴';
        else if (task.priority === 'A') icon = '🔥';
        else if (task.priority === 'B') icon = '⭐';
    }

    let dateInfo = '';
    if (task.due) {
        dateInfo = `Due: ${formatRelativeDate(task.due)}`;
    } else if (task.scheduled) {
        dateInfo = `Scheduled: ${formatRelativeDate(task.scheduled)}`;
    }

    const tags = task.tags.length > 0 ? task.tags.map(t => `#${t}`).join(' ') : '';

    return {
        label: `${icon} ${task.title}`,
        description: [dateInfo, tags].filter(Boolean).join(' | '),
        detail: path.basename(task.file),
        task
    };
}

/**
 * Jump to a task in its file
 */
async function jumpToTask(task: MarkdownTask): Promise<void> {
    const uri = vscode.Uri.file(task.file);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    const position = new vscode.Position(task.line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/**
 * Get day of week name
 */
function getDayName(date: Date): string {
    return DAY_NAMES_SHORT[date.getDay()];
}

/**
 * Get month name
 */
function getMonthName(date: Date): string {
    return MONTH_NAMES_FULL[date.getMonth()];
}

/**
 * Calendar-style date picker using quick pick
 */
async function pickDate(title: string): Promise<Date | undefined> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    type DateItem = vscode.QuickPickItem & { date?: Date; action?: 'custom' | 'prev' | 'next' };

    // Start showing current month
    let displayMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    while (true) {
        const items: DateItem[] = [];

        // Quick access dates
        items.push({ label: '⚡ Quick Dates', kind: vscode.QuickPickItemKind.Separator });

        const quickDates = [
            { label: 'Today', days: 0 },
            { label: 'Tomorrow', days: 1 },
            { label: '+3 days', days: 3 },
            { label: '+1 week', days: 7 },
            { label: '+2 weeks', days: 14 },
            { label: '+1 month', days: 30 }
        ];

        for (const q of quickDates) {
            const d = new Date(today);
            d.setDate(d.getDate() + q.days);
            items.push({
                label: `  ${q.label}`,
                description: `${getDayName(d)}, ${formatDate(d)}`,
                date: d
            });
        }

        // Calendar view for the month
        const monthYear = `${getMonthName(displayMonth)} ${displayMonth.getFullYear()}`;
        items.push({ label: `📅 ${monthYear}`, kind: vscode.QuickPickItemKind.Separator });

        // Navigation
        items.push({
            label: '  ◀ Previous Month',
            description: '',
            action: 'prev'
        });
        items.push({
            label: '  ▶ Next Month',
            description: '',
            action: 'next'
        });

        // Days header
        items.push({ label: '  Su  Mo  Tu  We  Th  Fr  Sa', kind: vscode.QuickPickItemKind.Separator });

        // Calculate days in month
        const firstDay = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);
        const lastDay = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 0);
        const startPadding = firstDay.getDay();

        // Build week rows
        let currentDay = 1;
        const totalDays = lastDay.getDate();

        while (currentDay <= totalDays) {
            // Build one week
            let weekDates: (Date | null)[] = [];
            for (let dow = 0; dow < 7; dow++) {
                if ((currentDay === 1 && dow < startPadding) || currentDay > totalDays) {
                    weekDates.push(null);
                } else {
                    const d = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), currentDay);
                    weekDates.push(d);
                    currentDay++;
                }
            }

            // Create label with aligned day numbers
            const weekLabel = weekDates.map((d, i) => {
                if (!d) return '    ';
                const dayNum = d.getDate().toString().padStart(2, ' ');
                const isToday = d.getTime() === today.getTime();
                return isToday ? `[${dayNum}]` : ` ${dayNum} `;
            }).join('');

            // Add each day as a separate item for selection
            for (const d of weekDates) {
                if (d) {
                    const isToday = d.getTime() === today.getTime();
                    const isPast = d < today;
                    const dayNum = d.getDate();
                    items.push({
                        label: `  ${isToday ? '▶' : ' '} ${getDayName(d)} ${dayNum}`,
                        description: isPast ? '(past)' : formatDate(d),
                        date: d
                    });
                }
            }
        }

        // Custom option
        items.push({ label: '✏️ Custom', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: '  Enter date manually...',
            description: 'YYYY-MM-DD format',
            action: 'custom'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: title,
            matchOnDescription: true
        });

        if (!selected) return undefined;

        if (selected.action === 'prev') {
            displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1);
            continue;
        }

        if (selected.action === 'next') {
            displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1);
            continue;
        }

        if (selected.action === 'custom') {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter date (YYYY-MM-DD, +2d, +1w, jan 20, tomorrow)',
                placeHolder: formatDate(today),
                validateInput: (value) => {
                    const parsed = parseRelativeDate(value);
                    if (!parsed) {
                        return 'Use YYYY-MM-DD or relative: +2d, +1w, tomorrow, next week';
                    }
                    return null;
                }
            });

            if (input) {
                const parsed = parseRelativeDate(input);
                if (parsed) return parsed;
            }
            return undefined;
        }

        if (selected.date) {
            return selected.date;
        }
    }
}

/**
 * Register all task commands
 */
export function registerTaskCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.markdown.insertTask', insertTask),
        vscode.commands.registerCommand('scimax.markdown.insertDueDate', insertDueDate),
        vscode.commands.registerCommand('scimax.markdown.insertScheduledDate', insertScheduledDate),
        vscode.commands.registerCommand('scimax.markdown.insertPriority', insertPriority),
        vscode.commands.registerCommand('scimax.markdown.showAgenda', showAgenda),
        vscode.commands.registerCommand('scimax.markdown.showTodaysTasks', showTodaysTasks),
        vscode.commands.registerCommand('scimax.markdown.showTasksByProject', showTasksByProject),
        vscode.commands.registerCommand('scimax.markdown.showTasksByTag', showTasksByTag)
    );
}
