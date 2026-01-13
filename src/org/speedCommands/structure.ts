/**
 * Speed Command Structure Functions
 *
 * Yank (paste) subtrees and narrow/widen view.
 */

import * as vscode from 'vscode';
import { getHeadingLevel, getSubtreeRange } from './context';

// Store narrowed state
let narrowedRange: { uri: string; startLine: number; endLine: number } | null = null;

/**
 * Yank (paste) subtree from clipboard
 */
export async function yankSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Get clipboard content
    const clipboardText = await vscode.env.clipboard.readText();

    if (!clipboardText.trim()) {
        vscode.window.showInformationMessage('Clipboard is empty');
        return;
    }

    // Check if clipboard contains a heading
    const isOrg = document.languageId === 'org';
    const headingPattern = isOrg ? /^\*+\s/ : /^#+\s/;

    if (!headingPattern.test(clipboardText)) {
        // Not a subtree, just paste normally
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        return;
    }

    // Find the current heading level context
    let currentLevel = 0;
    let insertAfterLine = position.line;

    // If on a heading, insert after current subtree
    const lineLevel = getHeadingLevel(document, position.line);
    if (lineLevel > 0) {
        currentLevel = lineLevel;
        const { endLine } = getSubtreeRange(document, position.line);
        insertAfterLine = endLine;
    } else {
        // Find the nearest heading above
        for (let i = position.line - 1; i >= 0; i--) {
            const level = getHeadingLevel(document, i);
            if (level > 0) {
                currentLevel = level;
                const { endLine } = getSubtreeRange(document, i);
                insertAfterLine = endLine;
                break;
            }
        }
    }

    // Adjust heading levels in clipboard to match context
    const clipboardLevel = getClipboardHeadingLevel(clipboardText, isOrg);
    let adjustedText = clipboardText;

    if (currentLevel > 0 && clipboardLevel > 0 && clipboardLevel !== currentLevel) {
        const levelDiff = currentLevel - clipboardLevel;
        adjustedText = adjustHeadingLevels(clipboardText, levelDiff, isOrg);
    }

    // Ensure text ends with newline
    if (!adjustedText.endsWith('\n')) {
        adjustedText += '\n';
    }

    // Insert at the end of current subtree
    await editor.edit(editBuilder => {
        editBuilder.insert(
            new vscode.Position(insertAfterLine + 1, 0),
            adjustedText
        );
    });

    vscode.window.showInformationMessage('Subtree yanked');
}

/**
 * Get the level of the first heading in text
 */
function getClipboardHeadingLevel(text: string, isOrg: boolean): number {
    const pattern = isOrg ? /^(\*+)\s/m : /^(#+)\s/m;
    const match = text.match(pattern);
    return match ? match[1].length : 0;
}

/**
 * Adjust all heading levels in text by delta
 */
function adjustHeadingLevels(text: string, delta: number, isOrg: boolean): string {
    const char = isOrg ? '*' : '#';
    const pattern = new RegExp(`^(${char}+)(\\s)`, 'gm');

    return text.replace(pattern, (match, stars, space) => {
        const newLevel = Math.max(1, stars.length + delta);
        return char.repeat(newLevel) + space;
    });
}

/**
 * Narrow view to current subtree
 * This uses VS Code's folding to simulate narrowing
 */
export async function narrowToSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    let headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        // Search backward for heading
        for (let i = position.line - 1; i >= 0; i--) {
            if (getHeadingLevel(document, i) > 0) {
                headingLine = i;
                break;
            }
        }
        if (getHeadingLevel(document, headingLine) === 0) {
            vscode.window.showInformationMessage('No heading found');
            return;
        }
    }

    const { startLine, endLine } = getSubtreeRange(document, headingLine);

    // Store narrowed state
    narrowedRange = {
        uri: document.uri.toString(),
        startLine,
        endLine
    };

    // Fold everything except the subtree
    await vscode.commands.executeCommand('editor.foldAll');

    // Unfold the target subtree
    await vscode.commands.executeCommand('editor.unfold', {
        selectionLines: Array.from({ length: endLine - startLine + 1 }, (_, i) => startLine + i),
        direction: 'down',
        levels: 100
    });

    // Move cursor to start of subtree
    const newPos = new vscode.Position(startLine, 0);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.InCenter);

    vscode.window.setStatusBarMessage('Narrowed to subtree (press S to widen)', 3000);
}

/**
 * Widen view (undo narrowing)
 */
export async function widen(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Unfold everything
    await vscode.commands.executeCommand('editor.unfoldAll');

    // Clear narrowed state
    narrowedRange = null;

    vscode.window.setStatusBarMessage('Widened', 2000);
}

/**
 * Copy subtree to clipboard
 */
export async function copySubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    let headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const { startLine, endLine } = getSubtreeRange(document, headingLine);

    // Get subtree content
    const subtreeRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
    const subtreeText = document.getText(subtreeRange);

    // Copy to clipboard
    await vscode.env.clipboard.writeText(subtreeText);

    vscode.window.showInformationMessage('Subtree copied to clipboard');
}

/**
 * Mark subtree for cut/copy operations
 */
export async function markSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    let headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const { startLine, endLine } = getSubtreeRange(document, headingLine);

    // Select the subtree
    const startPos = new vscode.Position(startLine, 0);
    const endPos = new vscode.Position(endLine, document.lineAt(endLine).text.length);
    editor.selection = new vscode.Selection(startPos, endPos);

    vscode.window.showInformationMessage('Subtree selected');
}
