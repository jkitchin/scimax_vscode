/**
 * Rectangle editing commands — VS Code integration.
 *
 * Emacs-style rectangle operations: kill, copy, delete, yank, open, clear,
 * number-lines, and string-rectangle.
 */

import * as vscode from 'vscode';
import {
    computeRectangle,
    extractRectangle,
    computeDeleteEdits,
    computeClearEdits,
    computeOpenEdits,
    computeNumberLineEdits,
    computeStringEdits,
    computeYankEdits,
    RectangleText,
    EditDescriptor,
} from './rectangleCore';

/** Module-level rectangle clipboard (separate from system clipboard, matching Emacs) */
let lastKilledRectangle: RectangleText | undefined;

/**
 * Helper: get the line text function and region from the current editor selection.
 * Returns undefined if there's no valid rectangle selection.
 */
function getSelectionContext(editor: vscode.TextEditor) {
    const sel = editor.selection;
    const region = computeRectangle(
        sel.anchor.line, sel.anchor.character,
        sel.active.line, sel.active.character
    );

    if (region.startCol === region.endCol) {
        vscode.window.setStatusBarMessage('Rectangle: zero-width selection', 3000);
        return undefined;
    }

    const doc = editor.document;
    const getLineText = (line: number) => doc.lineAt(line).text;
    return { region, getLineText, doc };
}

/**
 * Helper: apply edit descriptors atomically to the editor.
 */
async function applyEdits(editor: vscode.TextEditor, edits: EditDescriptor[]): Promise<boolean> {
    return editor.edit(editBuilder => {
        for (const edit of edits) {
            const range = new vscode.Range(edit.line, edit.startCol, edit.line, edit.endCol);
            if (edit.text !== undefined) {
                editBuilder.replace(range, edit.text);
            } else {
                editBuilder.delete(range);
            }
        }
    });
}

/**
 * Kill rectangle: delete and save to rectangle clipboard.
 * Emacs: C-x r k (kill-rectangle)
 */
async function killRectangle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    lastKilledRectangle = extractRectangle(ctx.getLineText, ctx.region);
    const edits = computeDeleteEdits(ctx.getLineText, ctx.region);
    await applyEdits(editor, edits);

    vscode.window.setStatusBarMessage(
        `Rectangle killed (${lastKilledRectangle.length} lines)`, 3000
    );
}

/**
 * Copy rectangle: save to rectangle clipboard without deleting.
 * Emacs: C-x r M-w (copy-rectangle-as-kill)
 */
async function copyRectangle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    lastKilledRectangle = extractRectangle(ctx.getLineText, ctx.region);

    vscode.window.setStatusBarMessage(
        `Rectangle copied (${lastKilledRectangle.length} lines)`, 3000
    );
}

/**
 * Delete rectangle: delete without saving.
 * Emacs: C-x r d (delete-rectangle)
 */
async function deleteRectangle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    const edits = computeDeleteEdits(ctx.getLineText, ctx.region);
    await applyEdits(editor, edits);

    vscode.window.setStatusBarMessage('Rectangle deleted', 3000);
}

/**
 * Yank rectangle: insert last killed rectangle at cursor position.
 * Emacs: C-x r y (yank-rectangle)
 */
async function yankRectangle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    if (!lastKilledRectangle) {
        vscode.window.setStatusBarMessage('No rectangle to yank', 3000);
        return;
    }

    const doc = editor.document;
    const pos = editor.selection.active;
    const getLineText = (line: number) => doc.lineAt(line).text;

    const edits = computeYankEdits(
        getLineText, doc.lineCount, pos.line, pos.character, lastKilledRectangle
    );
    await applyEdits(editor, edits);

    vscode.window.setStatusBarMessage(
        `Rectangle yanked (${lastKilledRectangle.length} lines)`, 3000
    );
}

/**
 * Open rectangle: insert blank space filling the rectangle.
 * Emacs: C-x r o (open-rectangle)
 */
async function openRectangle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    const edits = computeOpenEdits(ctx.getLineText, ctx.region);
    await applyEdits(editor, edits);

    vscode.window.setStatusBarMessage('Rectangle opened', 3000);
}

/**
 * Clear rectangle: replace rectangle content with spaces.
 * Emacs: C-x r c (clear-rectangle)
 */
async function clearRectangle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    const edits = computeClearEdits(ctx.getLineText, ctx.region);
    await applyEdits(editor, edits);

    vscode.window.setStatusBarMessage('Rectangle cleared', 3000);
}

/**
 * Number lines: insert line numbers along the left edge of the rectangle.
 * Emacs: C-x r N (rectangle-number-lines)
 */
async function numberLines(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    const input = await vscode.window.showInputBox({
        prompt: 'Start number (default 1), optionally followed by format string (e.g. "1 %d. ")',
        value: '1',
    });
    if (input === undefined) { return; } // cancelled

    let startNumber = 1;
    let format: string | undefined;
    const parts = input.trim().split(/\s+(.+)/);
    if (parts.length >= 1) {
        const parsed = parseInt(parts[0], 10);
        if (!isNaN(parsed)) {
            startNumber = parsed;
        }
    }
    if (parts.length >= 2) {
        format = parts[1];
    }

    const edits = computeNumberLineEdits(ctx.getLineText, ctx.region, startNumber, format);
    await applyEdits(editor, edits);

    vscode.window.setStatusBarMessage('Lines numbered', 3000);
}

/**
 * String rectangle: replace rectangle content with a prompted string.
 * Emacs: C-x r t (string-rectangle)
 */
async function stringRectangle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    const str = await vscode.window.showInputBox({
        prompt: 'String rectangle (replacement text for each line)',
    });
    if (str === undefined) { return; } // cancelled

    const edits = computeStringEdits(ctx.getLineText, ctx.region, str);
    await applyEdits(editor, edits);

    vscode.window.setStatusBarMessage('String rectangle applied', 3000);
}

/**
 * Register all rectangle commands with VS Code.
 */
export function registerRectangleCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.rectangle.kill', killRectangle),
        vscode.commands.registerCommand('scimax.rectangle.copy', copyRectangle),
        vscode.commands.registerCommand('scimax.rectangle.delete', deleteRectangle),
        vscode.commands.registerCommand('scimax.rectangle.yank', yankRectangle),
        vscode.commands.registerCommand('scimax.rectangle.open', openRectangle),
        vscode.commands.registerCommand('scimax.rectangle.clear', clearRectangle),
        vscode.commands.registerCommand('scimax.rectangle.numberLines', numberLines),
        vscode.commands.registerCommand('scimax.rectangle.string', stringRectangle),
    );
}
