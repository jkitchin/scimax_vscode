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

/** Rectangle mark mode state */
interface RectangleMarkMode {
    anchor: vscode.Position;
    anchorUri: string;
    operation: 'kill' | 'copy' | 'delete' | 'open' | 'clear' | 'numberLines' | 'string';
    decorationType: vscode.TextEditorDecorationType;
    selectionListener: vscode.Disposable;
}

let rectangleMarkMode: RectangleMarkMode | undefined;

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
 * Enter rectangle mark mode - set anchor and start tracking cursor movements
 */
function enterRectangleMarkMode(
    editor: vscode.TextEditor,
    operation: RectangleMarkMode['operation']
): void {
    // If already in rectangle mark mode, execute the new operation immediately
    if (rectangleMarkMode) {
        rectangleMarkMode.operation = operation;
        executeRectangleOperation();
        return;
    }

    const anchor = editor.selection.active;
    const anchorUri = editor.document.uri.toString();

    // Create decoration type for rectangle visualization
    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
        borderStyle: 'solid',
        borderWidth: '1px',
        borderColor: new vscode.ThemeColor('editor.selectionForeground')
    });

    // Track cursor movements to update rectangle
    const selectionListener = vscode.window.onDidChangeTextEditorSelection(e => {
        if (!rectangleMarkMode) { return; }
        if (e.textEditor.document.uri.toString() !== rectangleMarkMode.anchorUri) { return; }

        updateRectangleDecorations(e.textEditor);
    });

    rectangleMarkMode = {
        anchor,
        anchorUri,
        operation,
        decorationType,
        selectionListener
    };

    // Set context for keybindings
    vscode.commands.executeCommand('setContext', 'scimax.rectangleMarkMode', true);

    // Show initial decorations
    updateRectangleDecorations(editor);

    // Visual feedback
    const operationNames = {
        kill: 'Kill',
        copy: 'Copy',
        delete: 'Delete',
        open: 'Open',
        clear: 'Clear',
        numberLines: 'Number Lines',
        string: 'String'
    };
    vscode.window.setStatusBarMessage(
        `Rectangle ${operationNames[operation]} Mode - move cursor to define region, press Enter to execute, Esc to cancel`,
        5000
    );
}

/**
 * Update visual decorations showing the current rectangle region
 */
function updateRectangleDecorations(editor: vscode.TextEditor): void {
    if (!rectangleMarkMode) { return; }

    const currentPos = editor.selection.active;
    const region = computeRectangle(
        rectangleMarkMode.anchor.line,
        rectangleMarkMode.anchor.character,
        currentPos.line,
        currentPos.character
    );

    // Create decoration ranges for each line in the rectangle
    const ranges: vscode.Range[] = [];
    for (let line = region.startLine; line <= region.endLine; line++) {
        ranges.push(new vscode.Range(
            line, region.startCol,
            line, region.endCol
        ));
    }

    editor.setDecorations(rectangleMarkMode.decorationType, ranges);

    // Show current region size in status bar
    const lines = region.endLine - region.startLine + 1;
    const cols = region.endCol - region.startCol;
    const operationNames = {
        kill: 'Kill',
        copy: 'Copy',
        delete: 'Delete',
        open: 'Open',
        clear: 'Clear',
        numberLines: 'Number',
        string: 'String'
    };
    vscode.window.setStatusBarMessage(
        `Rectangle ${operationNames[rectangleMarkMode.operation]}: ${lines}L × ${cols}C | Enter=confirm Esc=cancel`,
        10000
    );
}

/**
 * Execute the pending rectangle operation and exit mark mode
 */
async function executeRectangleOperation(): Promise<void> {
    if (!rectangleMarkMode) { return; }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== rectangleMarkMode.anchorUri) {
        cancelRectangleMarkMode();
        return;
    }

    const currentPos = editor.selection.active;
    const region = computeRectangle(
        rectangleMarkMode.anchor.line,
        rectangleMarkMode.anchor.character,
        currentPos.line,
        currentPos.character
    );

    // Check for zero-width or zero-height rectangle
    if (region.startCol === region.endCol) {
        vscode.window.setStatusBarMessage('Rectangle: zero-width region - cancelled', 3000);
        cancelRectangleMarkMode();
        return;
    }

    if (region.startLine === region.endLine) {
        // Single-line rectangle is allowed, but show info
        vscode.window.setStatusBarMessage(`Rectangle: single line (${region.endCol - region.startCol} cols)`, 1000);
    } else {
        // Multi-line rectangle
        const lines = region.endLine - region.startLine + 1;
        const cols = region.endCol - region.startCol;
        vscode.window.setStatusBarMessage(`Rectangle: ${lines} lines × ${cols} cols`, 1000);
    }

    const doc = editor.document;
    const getLineText = (line: number) => doc.lineAt(line).text;
    const operation = rectangleMarkMode.operation;

    // Clean up mode state before executing (operation might fail)
    cancelRectangleMarkMode();

    // Execute the appropriate operation
    switch (operation) {
        case 'kill': {
            const rectText = extractRectangle(getLineText, region);
            lastKilledRectangle = rectText;
            await vscode.env.clipboard.writeText(rectText.join('\n'));
            const edits = computeDeleteEdits(getLineText, region);
            await applyEdits(editor, edits);
            vscode.window.setStatusBarMessage(`Rectangle killed (${rectText.length} lines)`, 3000);
            break;
        }
        case 'copy': {
            const rectText = extractRectangle(getLineText, region);
            lastKilledRectangle = rectText;
            await vscode.env.clipboard.writeText(rectText.join('\n'));
            vscode.window.setStatusBarMessage(`Rectangle copied (${rectText.length} lines)`, 3000);
            break;
        }
        case 'delete': {
            const edits = computeDeleteEdits(getLineText, region);
            // Debug logging
            console.log('Delete rectangle - Region:', region);
            console.log('Delete rectangle - Edits:', edits.map(e => ({
                line: e.line,
                range: `[${e.startCol}, ${e.endCol})`,
                text: e.text === undefined ? 'DELETE' : `"${e.text}"`
            })));
            await applyEdits(editor, edits);
            vscode.window.setStatusBarMessage('Rectangle deleted', 3000);
            break;
        }
        case 'open': {
            const edits = computeOpenEdits(getLineText, region);
            await applyEdits(editor, edits);
            vscode.window.setStatusBarMessage('Rectangle opened', 3000);
            break;
        }
        case 'clear': {
            const edits = computeClearEdits(getLineText, region);
            // Debug logging
            console.log('Clear rectangle - Region:', region);
            console.log('Clear rectangle - Edits:', edits.map(e => ({
                line: e.line,
                range: `[${e.startCol}, ${e.endCol})`,
                text: `"${e.text}"`,
                textLen: e.text?.length
            })));
            await applyEdits(editor, edits);
            vscode.window.setStatusBarMessage('Rectangle cleared', 3000);
            break;
        }
        case 'numberLines': {
            // Prompt for number format
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

            const edits = computeNumberLineEdits(getLineText, region, startNumber, format);
            await applyEdits(editor, edits);
            vscode.window.setStatusBarMessage('Lines numbered', 3000);
            break;
        }
        case 'string': {
            // Prompt for replacement string
            const str = await vscode.window.showInputBox({
                prompt: 'String rectangle (replacement text for each line)',
            });
            if (str === undefined) { return; } // cancelled

            const edits = computeStringEdits(getLineText, region, str);
            await applyEdits(editor, edits);
            vscode.window.setStatusBarMessage('String rectangle applied', 3000);
            break;
        }
    }
}

/**
 * Cancel rectangle mark mode without executing
 */
function cancelRectangleMarkMode(): void {
    if (!rectangleMarkMode) { return; }

    // Clear decorations
    rectangleMarkMode.decorationType.dispose();

    // Stop listening to selection changes
    rectangleMarkMode.selectionListener.dispose();

    // Clear context for keybindings
    vscode.commands.executeCommand('setContext', 'scimax.rectangleMarkMode', false);

    rectangleMarkMode = undefined;
}

/**
 * Command to confirm rectangle operation (bound to Enter in rectangle mark mode)
 */
async function confirmRectangle(): Promise<void> {
    if (rectangleMarkMode) {
        await executeRectangleOperation();
    }
}

/**
 * Command to cancel rectangle operation (bound to Esc)
 */
function cancelRectangle(): void {
    if (rectangleMarkMode) {
        cancelRectangleMarkMode();
        vscode.window.setStatusBarMessage('Rectangle operation cancelled', 2000);
    }
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

    // If already in rectangle mark mode for this operation, execute it
    if (rectangleMarkMode?.operation === 'kill') {
        await executeRectangleOperation();
        return;
    }

    // If no selection, enter interactive mode
    if (editor.selection.isEmpty) {
        enterRectangleMarkMode(editor, 'kill');
        return;
    }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    lastKilledRectangle = extractRectangle(ctx.getLineText, ctx.region);
    await vscode.env.clipboard.writeText(lastKilledRectangle.join('\n'));
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

    // If already in rectangle mark mode for this operation, execute it
    if (rectangleMarkMode?.operation === 'copy') {
        await executeRectangleOperation();
        return;
    }

    // If no selection, enter interactive mode
    if (editor.selection.isEmpty) {
        enterRectangleMarkMode(editor, 'copy');
        return;
    }

    const ctx = getSelectionContext(editor);
    if (!ctx) { return; }

    lastKilledRectangle = extractRectangle(ctx.getLineText, ctx.region);
    await vscode.env.clipboard.writeText(lastKilledRectangle.join('\n'));

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

    // If already in rectangle mark mode for this operation, execute it
    if (rectangleMarkMode?.operation === 'delete') {
        await executeRectangleOperation();
        return;
    }

    // If no selection, enter interactive mode
    if (editor.selection.isEmpty) {
        enterRectangleMarkMode(editor, 'delete');
        return;
    }

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

    // If already in rectangle mark mode for this operation, execute it
    if (rectangleMarkMode?.operation === 'open') {
        await executeRectangleOperation();
        return;
    }

    // If no selection, enter interactive mode
    if (editor.selection.isEmpty) {
        enterRectangleMarkMode(editor, 'open');
        return;
    }

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

    // If already in rectangle mark mode for this operation, execute it
    if (rectangleMarkMode?.operation === 'clear') {
        await executeRectangleOperation();
        return;
    }

    // If no selection, enter interactive mode
    if (editor.selection.isEmpty) {
        enterRectangleMarkMode(editor, 'clear');
        return;
    }

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

    // If already in rectangle mark mode for this operation, execute it
    if (rectangleMarkMode?.operation === 'numberLines') {
        await executeRectangleOperation();
        return;
    }

    // If no selection, enter interactive mode
    if (editor.selection.isEmpty) {
        enterRectangleMarkMode(editor, 'numberLines');
        return;
    }

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

    // If already in rectangle mark mode for this operation, execute it
    if (rectangleMarkMode?.operation === 'string') {
        await executeRectangleOperation();
        return;
    }

    // If no selection, enter interactive mode
    if (editor.selection.isEmpty) {
        enterRectangleMarkMode(editor, 'string');
        return;
    }

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
        vscode.commands.registerCommand('scimax.rectangle.confirm', confirmRectangle),
        vscode.commands.registerCommand('scimax.rectangle.cancel', cancelRectangle),
    );

    // Clean up rectangle mark mode when switching editors
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            if (rectangleMarkMode) {
                cancelRectangleMarkMode();
            }
        })
    );

    // Clean up on extension deactivation
    context.subscriptions.push({
        dispose: () => {
            if (rectangleMarkMode) {
                cancelRectangleMarkMode();
            }
        }
    });
}
