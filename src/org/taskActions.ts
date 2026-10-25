/**
 * Right-click actions on a task row in a webview: the project view's Gantt
 * chart and the agenda view share them.
 *
 * Each row carries data-vscode-context with its webviewSection ('task'), the
 * view it belongs to (`view`, the webview's viewType), and the task's file and
 * line. VS Code hands that object to the commands under webview/context in
 * package.json. An action runs the ordinary editing command on the task's
 * heading (runOnSourceHeading), then goes back to the view it came from and
 * has it reload. A view takes part by registering itself with registerTaskHost.
 */

import * as vscode from 'vscode';
import { runOnSourceHeading } from './agendaDocumentProvider';
import { planningLines, shiftPlanningLine } from '../parser/planningShift';

/** What VS Code passes to a webview/context command: the row's data-vscode-context. */
export interface TaskContext {
    /** The webview's viewType */
    view?: string;
    filePath?: string;
    /** 1-based heading line */
    line?: number;
    /** The planning date the row shows (agenda rows) */
    planning?: 'SCHEDULED' | 'DEADLINE';
}

/** A view whose rows the actions act on. */
export interface TaskHost {
    /** Bring the view back to the front after an action. */
    reveal(): void;
    /** Re-read the tasks and redraw. */
    reload(): Promise<void>;
}

const hosts = new Map<string, TaskHost>();

export function registerTaskHost(view: string, host: TaskHost): vscode.Disposable {
    hosts.set(view, host);
    return { dispose: () => { if (hosts.get(view) === host) hosts.delete(view); } };
}

/** Run an editing command on a task's heading, then come back and reload. */
export async function runOnTask(arg: TaskContext | undefined, command: string): Promise<boolean> {
    if (!arg?.filePath || !arg.line) return false;
    const host = arg.view ? hosts.get(arg.view) : undefined;
    const changed = await runOnSourceHeading(
        { file: arg.filePath, line: arg.line },
        command,
        () => host?.reveal()
    );
    if (changed) await host?.reload();
    return changed;
}

/** Open a task's heading beside the view. */
export async function revealTask(filePath: string, line: number): Promise<void> {
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const pos = new vscode.Position(Math.max(0, line - 1), 0);
        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            selection: new vscode.Range(pos, pos),
        });
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch {
        vscode.window.showErrorMessage(`Could not open ${filePath}`);
    }
}

/**
 * Move a task's planning date by `days`: the one its row shows, or both
 * SCHEDULED and DEADLINE when the row does not say. Saves the file.
 */
export async function shiftTask(arg: TaskContext | undefined, days: number): Promise<void> {
    if (!arg?.filePath || !arg.line) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(arg.filePath));
    const lines = doc.getText().split(/\r?\n/);
    const headingLine = arg.line - 1;
    if (!/^\*+\s/.test(lines[headingLine] ?? '')) {
        vscode.window.showWarningMessage('The view is out of date: refresh it and try again.');
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const i of planningLines(lines, headingLine)) {
        const shifted = shiftPlanningLine(lines[i], days, arg.planning);
        if (shifted !== lines[i]) edit.replace(doc.uri, doc.lineAt(i).range, shifted);
    }
    if (edit.size === 0) {
        const what = arg.planning ?? 'SCHEDULED or DEADLINE';
        vscode.window.showInformationMessage(`This task has no ${what} date to move.`);
        return;
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
        vscode.window.showErrorMessage('Could not move the date.');
        return;
    }
    await doc.save();
    await (arg.view ? hosts.get(arg.view) : undefined)?.reload();
}

async function pickPriority(arg?: TaskContext): Promise<void> {
    const picked = await vscode.window.showQuickPick(
        [
            { label: 'A', command: 'scimax.speed.priorityA' },
            { label: 'B', command: 'scimax.speed.priorityB' },
            { label: 'C', command: 'scimax.speed.priorityC' },
            { label: 'None', command: 'scimax.speed.priorityNone' },
        ],
        { placeHolder: 'Priority' }
    );
    if (picked) await runOnTask(arg, picked.command);
}

export function registerTaskActions(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.task.open', (arg?: TaskContext) =>
            arg?.filePath && arg.line ? revealTask(arg.filePath, arg.line) : undefined),
        vscode.commands.registerCommand('scimax.task.priority', pickPriority),
        vscode.commands.registerCommand('scimax.task.later', (arg?: TaskContext) => shiftTask(arg, 1)),
        vscode.commands.registerCommand('scimax.task.earlier', (arg?: TaskContext) => shiftTask(arg, -1)),
        // The rest run one editing command on the heading.
        vscode.commands.registerCommand('scimax.task.cycleTodo', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.org.cycleTodo')),
        vscode.commands.registerCommand('scimax.task.assign', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.org.assignTask')),
        vscode.commands.registerCommand('scimax.task.setTags', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.speed.setTags')),
        vscode.commands.registerCommand('scimax.task.effort', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.speed.setEffort')),
        vscode.commands.registerCommand('scimax.task.schedule', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.speed.schedule')),
        vscode.commands.registerCommand('scimax.task.deadline', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.speed.deadline')),
        vscode.commands.registerCommand('scimax.task.clockIn', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.speed.clockIn')),
        vscode.commands.registerCommand('scimax.task.refile', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.org.refile')),
        vscode.commands.registerCommand('scimax.task.archive', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.speed.archiveSubtree')),
        vscode.commands.registerCommand('scimax.task.storeLink', (arg?: TaskContext) =>
            runOnTask(arg, 'scimax.org.storeLink')),
    );
}
