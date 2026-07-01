/**
 * Shared TODO-completion guard and trigger for dependency enforcement.
 *
 * Two independent commands cycle TODO state — `scimax.org.cycleTodo`
 * (scimaxOrg.ts) and the shift-left/right handler (timestampProvider.ts) — so
 * the org-depend blocking/triggering logic lives here and is called from both,
 * ensuring a task can't be completed past unmet dependencies regardless of which
 * keystroke did it.
 */
import * as vscode from 'vscode';
import { getTodoWorkflowForDocument } from './todoStates';
import {
    getOrderedBlocker,
    getDependsAt,
    getUnsatisfiedBlockers,
    getIdAt,
    getNewlyUnblockedDependents,
    Blocker,
} from './dependencies';

export interface DependConfig {
    enabled: boolean;
    readyState: string;
    autoPromote: boolean;
}

export function getDependConfig(): DependConfig {
    const c = vscode.workspace.getConfiguration('scimax.org.depend');
    return {
        enabled: c.get<boolean>('enabled', true),
        readyState: c.get<string>('readyState', 'NEXT'),
        autoPromote: c.get<boolean>('autoPromote', true),
    };
}

export interface CompletionBlock {
    message: string;
    jump?: { filePath: string; lineNumber: number };
}

function describeBlocker(b: Blocker): string {
    if (!b.found) return `missing dependency "${b.id}"`;
    const state = b.todoState || 'no state';
    return `"${b.title ?? b.id}" (${state})`;
}

/**
 * Determine whether the heading at `line` may not transition to a DONE state
 * yet — either an ORDERED earlier sibling or a `:DEPENDS:` target is unfinished.
 * Returns a block descriptor (with an optional jump location) or null.
 */
export async function checkCompletionBlocked(
    document: vscode.TextDocument,
    line: number,
    doneStates: Set<string>
): Promise<CompletionBlock | null> {
    let headingLine = line;
    for (let i = line; i >= 0; i--) {
        if (/^\*+\s+/.test(document.lineAt(i).text)) { headingLine = i; break; }
    }
    const orderedBlocker = getOrderedBlocker(document, headingLine, doneStates);
    if (orderedBlocker) {
        return { message: `Blocked: earlier task "${orderedBlocker}" is not done (ORDERED)` };
    }

    const dependsIds = getDependsAt(document, line);
    if (dependsIds.length === 0) return null;
    const unmet = await getUnsatisfiedBlockers(dependsIds, doneStates);
    if (unmet.length === 0) return null;

    const first = unmet[0];
    const block: CompletionBlock = {
        message: `Blocked by ${describeBlocker(first)}${unmet.length > 1 ? ` (and ${unmet.length - 1} more)` : ''}`,
    };
    if (first.found && first.filePath && first.lineNumber) {
        block.jump = { filePath: first.filePath, lineNumber: first.lineNumber };
    }
    return block;
}

export async function revealHeadingLocation(filePath: string, lineNumber: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const editor = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(Math.max(0, lineNumber - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/**
 * Run the completion guard for a state change at `line`. Only acts when the
 * heading is transitioning INTO a done state (`isNowDone && !wasDone`). Shows a
 * warning (with jump-to-blocker) and returns true if the change should be
 * refused; false to allow it.
 */
export async function guardCompletion(
    document: vscode.TextDocument,
    line: number,
    doneStates: Set<string>,
    wasDone: boolean,
    isNowDone: boolean
): Promise<boolean> {
    if (!(isNowDone && !wasDone) || !getDependConfig().enabled) return false;
    let blocked: CompletionBlock | null = null;
    try {
        blocked = await checkCompletionBlocked(document, line, doneStates);
    } catch {
        blocked = null; // never let dependency checking break state cycling
    }
    if (!blocked) return false;
    const actions = blocked.jump ? ['Jump to blocker'] : [];
    const choice = await vscode.window.showWarningMessage(blocked.message, ...actions);
    if (choice === 'Jump to blocker' && blocked.jump) {
        await revealHeadingLocation(blocked.jump.filePath, blocked.jump.lineNumber);
    }
    return true;
}

/**
 * After a heading transitions to DONE, surface (and optionally promote) any task
 * that this completion unblocks. One hop only — no recursive cascade.
 */
export async function runDependencyTriggers(document: vscode.TextDocument, line: number): Promise<void> {
    const config = getDependConfig();
    if (!config.enabled) return;
    const doneId = getIdAt(document, line);
    if (!doneId) return;

    const workflow = getTodoWorkflowForDocument(document);
    const doneStates = new Set(workflow.doneStates);

    let unblocked: Awaited<ReturnType<typeof getNewlyUnblockedDependents>>;
    try {
        unblocked = await getNewlyUnblockedDependents(doneId, doneStates);
    } catch {
        return;
    }
    if (unblocked.length === 0) return;

    for (const { heading } of unblocked) {
        let promoted = false;
        if (config.autoPromote && config.readyState) {
            promoted = await promoteDependent(heading.file_path, heading.line_number, config.readyState);
        }
        const verb = promoted ? `is now ready (→ ${config.readyState})` : 'is now ready';
        const choice = await vscode.window.showInformationMessage(`"${heading.title}" ${verb}`, 'Open');
        if (choice === 'Open') {
            await revealHeadingLocation(heading.file_path, heading.line_number);
        }
    }
}

/**
 * Promote a freshly unblocked heading to the configured ready state, but only
 * when it currently sits in its document's first active state (e.g. TODO) and
 * that document defines the ready keyword. Returns true if changed.
 */
async function promoteDependent(filePath: string, lineNumber: number, readyState: string): Promise<boolean> {
    try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const workflow = getTodoWorkflowForDocument(doc);
        if (!workflow.allStates.includes(readyState)) return false;
        const firstActive = workflow.activeStates[0];
        if (!firstActive || firstActive === readyState) return false;

        const lineIdx = Math.max(0, lineNumber - 1);
        if (lineIdx >= doc.lineCount) return false;
        const text = doc.lineAt(lineIdx).text;
        const m = text.match(/^(\*+)\s+(\S+)(\s+.*)?$/);
        if (!m || m[2] !== firstActive) return false;

        const newText = `${m[1]} ${readyState}${m[3] ?? ''}`;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, doc.lineAt(lineIdx).range, newText);
        const ok = await vscode.workspace.applyEdit(edit);
        if (ok) await doc.save();
        return ok;
    } catch {
        return false;
    }
}
