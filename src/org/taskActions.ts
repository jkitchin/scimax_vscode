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
import * as path from 'path';
import { currentHeadingLine, runOnSourceHeading } from './agendaDocumentProvider';
import { planningLines, shiftPlanningLine } from '../parser/planningShift';
import { headingLineRegex, isMarkdownPath } from '../parser/markdownTasks';

/** What VS Code passes to a webview/context command: the row's data-vscode-context. */
export interface TaskContext {
    /** The webview's viewType */
    view?: string;
    filePath?: string;
    /** 1-based heading line */
    line?: number;
    /** The heading's title, to find it again if edits since moved it */
    title?: string;
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

// ---------------------------------------------------------------------------
// Undo / redo
//
// An action edits (and saves) the task's file outside the view, so the view
// has no editor whose undo history Cmd-Z could use; once a TODO goes DONE its
// row vanishes and there is nothing left to click. Instead each action that
// changes one file records that file's whole text before and after, per view.
// Undo puts the before text back (Redo the after text) and saves. Whole-text
// snapshots also cover the side edits an action makes: CLOSED stamps, LOGBOOK
// notes, repeaters and the like.
// ---------------------------------------------------------------------------

interface UndoEntry {
    file: string;
    before: string;
    after: string;
    /** What was done, for messages: "Cycle TODO state" */
    label: string;
}

/** Most actions kept per view. */
const MAX_UNDO = 50;

const undoStacks = new Map<string, UndoEntry[]>();
const redoStacks = new Map<string, UndoEntry[]>();

/** Commands that edit more than the task's own file, which a one-file snapshot cannot undo. */
const NOT_UNDOABLE = new Set(['scimax.org.refile', 'scimax.speed.archiveSubtree', 'scimax.org.storeLink']);

const COMMAND_LABELS: Record<string, string> = {
    'scimax.org.cycleTodo': 'TODO state change',
    'scimax.org.assignTask': 'assignment',
    'scimax.speed.setTags': 'tag change',
    'scimax.speed.setEffort': 'effort change',
    'scimax.speed.schedule': 'scheduled date change',
    'scimax.speed.deadline': 'deadline change',
    'scimax.speed.clockIn': 'clock in',
    'scimax.speed.priorityA': 'priority change',
    'scimax.speed.priorityB': 'priority change',
    'scimax.speed.priorityC': 'priority change',
    'scimax.speed.priorityNone': 'priority change',
};

/** The file's current text: an open editor's, unsaved edits included, else the disk's. */
async function fileText(file: string): Promise<string | undefined> {
    try {
        return (await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText();
    } catch {
        return undefined;
    }
}

/** Run `action` on `file`, and if the file's text changed, record it for undo in `view`. */
async function recordingUndo<T>(view: string | undefined, file: string, label: string, action: () => Promise<T>): Promise<T> {
    const before = view ? await fileText(file) : undefined;
    const result = await action();
    if (view && before !== undefined) {
        const after = await fileText(file);
        if (after !== undefined && after !== before) {
            const stack = undoStacks.get(view) ?? [];
            stack.push({ file, before, after, label });
            if (stack.length > MAX_UNDO) stack.shift();
            undoStacks.set(view, stack);
            redoStacks.delete(view);
        }
    }
    return result;
}

/** Replace a file's whole text and save it. */
async function writeWholeFile(file: string, text: string): Promise<boolean> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    if (!(await vscode.workspace.applyEdit(edit))) return false;
    await doc.save();
    return true;
}

/**
 * Undo (or redo) the last action taken from `view`. If the file was edited
 * some other way since, ask before overwriting those edits.
 */
export async function undoTaskAction(view: string, redo = false): Promise<boolean> {
    const from = (redo ? redoStacks : undoStacks).get(view) ?? [];
    const entry = from.pop();
    const verb = redo ? 'Redo' : 'Undo';
    if (!entry) {
        vscode.window.setStatusBarMessage(`Nothing to ${verb.toLowerCase()} in this view`, 3000);
        return false;
    }
    const expected = redo ? entry.before : entry.after;
    const target = redo ? entry.after : entry.before;
    const name = path.basename(entry.file);

    const current = await fileText(entry.file);
    if (current === undefined) {
        vscode.window.showErrorMessage(`Could not ${verb.toLowerCase()}: ${name} can no longer be read.`);
        return false;
    }
    if (current !== expected) {
        const choice = await vscode.window.showWarningMessage(
            `${name} has changed since the ${entry.label}. ${verb} anyway? Changes made to the file since then would be lost.`,
            { modal: true },
            `${verb} Anyway`
        );
        if (!choice) {
            from.push(entry);
            return false;
        }
    }

    if (!(await writeWholeFile(entry.file, target))) {
        from.push(entry);
        vscode.window.showErrorMessage(`Could not ${verb.toLowerCase()} the ${entry.label} in ${name}.`);
        return false;
    }

    const to = (redo ? undoStacks : redoStacks).get(view) ?? [];
    to.push(entry);
    (redo ? undoStacks : redoStacks).set(view, to);

    vscode.window.setStatusBarMessage(`${redo ? 'Redid' : 'Undid'} ${entry.label} in ${name}`, 4000);
    await hosts.get(view)?.reload();
    return true;
}

/** Forget a view's undo history (when it closes). */
export function clearTaskUndo(view: string): void {
    undoStacks.delete(view);
    redoStacks.delete(view);
}

/** Run an editing command on a task's heading, then come back and reload. */
export async function runOnTask(arg: TaskContext | undefined, command: string): Promise<boolean> {
    if (!arg?.filePath || !arg.line) return false;
    const host = arg.view ? hosts.get(arg.view) : undefined;
    const run = () => runOnSourceHeading(
        { file: arg.filePath!, line: arg.line!, title: arg.title },
        command,
        () => host?.reveal()
    );
    const changed = NOT_UNDOABLE.has(command)
        ? await run()
        : await recordingUndo(arg.view, arg.filePath, COMMAND_LABELS[command] ?? 'edit', run);
    if (changed) await host?.reload();
    return changed;
}

/** Open a task's heading beside the view. */
export async function revealTask(filePath: string, line: number, title?: string): Promise<void> {
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const pos = new vscode.Position(Math.max(0, currentHeadingLine(doc, line, title) - 1), 0);
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
    const headingLine = currentHeadingLine(doc, arg.line, arg.title) - 1;
    if (!headingLineRegex(isMarkdownPath(arg.filePath)).test(lines[headingLine] ?? '')) {
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
    const moved = await recordingUndo(arg.view, arg.filePath, 'date move', async () => {
        if (!(await vscode.workspace.applyEdit(edit))) return false;
        await doc.save();
        return true;
    });
    if (!moved) {
        vscode.window.showErrorMessage('Could not move the date.');
        return;
    }
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
            arg?.filePath && arg.line ? revealTask(arg.filePath, arg.line, arg.title) : undefined),
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
