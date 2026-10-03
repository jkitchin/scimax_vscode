/**
 * Offer to move the tasks that wait on a task whose deadline moved.
 *
 * Used by the deadline command (C-c C-d, speed `d`, the project view's
 * Set Deadline...) and by Shift+Up/Down on a DEADLINE date. The tasks come from
 * the task's project (see projectData.ts); see planningShift.ts for which tasks
 * move and how their dates change.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { loadProjectTasks, projectRootFor, type ProjectTaskInfo } from './projectData';
import {
    dayDelta,
    dependentsToShift,
    headingDeadline,
    headingForPlanningLine,
    planningLines,
    shiftPlanningLine,
} from '../parser/planningShift';
import { isoDay } from './projectGantt';

function linesOf(document: vscode.TextDocument): string[] {
    return document.getText().split(/\r?\n/);
}

/** The deadline of the heading on 0-based `headingLine`. */
export function deadlineAt(document: vscode.TextDocument, headingLine: number): Date | undefined {
    return headingDeadline(linesOf(document), headingLine);
}

/**
 * The heading on 0-based `headingLine` had deadline `before`; if it now has a
 * different one, list the tasks waiting on it and move the ones the user keeps
 * checked by the same number of days. Returns how many tasks moved.
 */
export async function offerShiftDependents(
    document: vscode.TextDocument,
    headingLine: number,
    before: Date | undefined
): Promise<number> {
    const after = deadlineAt(document, headingLine);
    if (!before || !after || document.uri.scheme !== 'file') return 0;
    const days = dayDelta(before, after);
    if (days === 0) return 0;

    const root = projectRootFor(document.uri);
    if (!root) return 0;
    const tasks = await loadProjectTasks(root);
    const task = tasks.find(t => t.file === document.uri.fsPath && t.line === headingLine + 1);
    if (!task) return 0;
    return chooseAndShiftDependents(root, task, tasks, days, `The deadline of "${task.title}"`, document);
}

/**
 * `task` (one of the project `tasks` under `root`) moved `days` days: list the
 * unfinished tasks that wait on it and move the ones the user keeps checked by
 * the same days. `subject` names what moved, for the prompt. Changed files are
 * saved, except `keepUnsaved` (the document the user is editing). Returns how
 * many tasks moved.
 */
export async function chooseAndShiftDependents(
    root: string,
    task: ProjectTaskInfo,
    tasks: ProjectTaskInfo[],
    days: number,
    subject: string,
    keepUnsaved?: vscode.TextDocument
): Promise<number> {
    if (days === 0) return 0;
    const dependents = dependentsToShift(task, tasks);
    if (dependents.length === 0) return 0;

    const amount = `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'}`;
    interface Item extends vscode.QuickPickItem { task: ProjectTaskInfo }
    const items: Item[] = dependents.map(t => ({
        label: [t.todo, t.title].filter(Boolean).join(' '),
        description: [
            t.scheduled ? `scheduled ${isoDay(t.scheduled)}` : '',
            t.deadline ? `deadline ${isoDay(t.deadline)}` : '',
        ].filter(Boolean).join(', '),
        detail: `${path.relative(root, t.file)}:${t.line}`,
        picked: true,
        task: t,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: `${subject} moved ${amount}. Move the tasks that depend on it too?`,
        placeHolder: 'Uncheck tasks to leave alone; Escape moves none',
        canPickMany: true,
        matchOnDetail: true,
    });
    if (!picked?.length) return 0;

    // One edit per file; planning lines sit under their heading, so the
    // tasks' lines stay valid while editing.
    const byFile = new Map<string, ProjectTaskInfo[]>();
    for (const { task: t } of picked) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
    let moved = 0;
    for (const [file, fileTasks] of byFile) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const lines = linesOf(doc);
        const edit = new vscode.WorkspaceEdit();
        for (const t of fileTasks) {
            for (const i of planningLines(lines, t.line - 1)) {
                const shifted = shiftPlanningLine(lines[i], days);
                if (shifted !== lines[i]) edit.replace(doc.uri, doc.lineAt(i).range, shifted);
            }
            moved++;
        }
        if (await vscode.workspace.applyEdit(edit) && doc.isDirty && doc !== keepUnsaved) await doc.save();
    }
    vscode.window.showInformationMessage(`Moved ${moved} dependent task${moved === 1 ? '' : 's'} ${amount}.`);
    return moved;
}

/**
 * Shift+Up/Down on a DEADLINE date: presses come one day at a time, so wait
 * until they stop (a pause, or the cursor leaving the line, or another file)
 * and offer once for the whole move.
 */
interface PendingShift {
    document: vscode.TextDocument;
    planningLine: number;
    headingLine: number;
    before: Date;
    timer: NodeJS.Timeout;
}

const SETTLE_MS = 1500;
let pending: PendingShift | undefined;

function settle(): void {
    if (!pending) return;
    const { document, headingLine, before, timer } = pending;
    clearTimeout(timer);
    pending = undefined;
    void offerShiftDependents(document, headingLine, before);
}

/**
 * Call before Shift+Up/Down changes the timestamp on `line`. Does nothing
 * unless it is a DEADLINE date on a heading's planning line in an org file.
 */
export function noteDeadlineShiftStart(document: vscode.TextDocument, line: number, character: number): void {
    if (document.languageId !== 'org') return;
    const text = document.lineAt(line).text;
    const m = /\bDEADLINE:\s*[<[][^>\]]*[>\]]/.exec(text);
    if (!m || character < m.index || character > m.index + m[0].length) return;

    if (pending && (pending.document !== document || pending.planningLine !== line)) settle();
    if (pending) {
        clearTimeout(pending.timer);
        pending.timer = setTimeout(settle, SETTLE_MS);
        return;
    }
    const lines = linesOf(document);
    const headingLine = headingForPlanningLine(lines, line);
    const before = headingLine >= 0 ? headingDeadline(lines, headingLine) : undefined;
    if (!before) return;
    pending = { document, planningLine: line, headingLine, before, timer: setTimeout(settle, SETTLE_MS) };
}

/** Settle a pending Shift+Up/Down move when the cursor leaves its line. */
export function registerDeadlineShiftTracking(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (pending && (e.textEditor.document !== pending.document
                || e.selections[0].active.line !== pending.planningLine)) settle();
        }),
        vscode.window.onDidChangeActiveTextEditor(() => settle()),
        { dispose: () => { if (pending) clearTimeout(pending.timer); pending = undefined; } }
    );
}
