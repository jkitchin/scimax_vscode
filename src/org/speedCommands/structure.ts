/**
 * Speed Command Structure Functions
 *
 * Yank (paste) subtrees.
 */

import * as vscode from 'vscode';
import { firstHeadingLevel, shiftHeadingLevels } from '../../shared/headingText';
import { pushKill } from '../../killRing/commands';
import { getHeadingLevel, getSubtreeRange } from './context';

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
    const clipboardLevel = firstHeadingLevel(clipboardText, isOrg);
    let adjustedText = clipboardText;

    if (currentLevel > 0 && clipboardLevel > 0 && clipboardLevel !== currentLevel) {
        const levelDiff = currentLevel - clipboardLevel;
        adjustedText = shiftHeadingLevels(clipboardText, levelDiff, isOrg);
    }

    // Ensure text ends with newline
    if (!adjustedText.endsWith('\n')) {
        adjustedText += '\n';
    }

    // Insert at the end of current subtree. When the subtree ends on the last
    // line and the file has no final newline, start a new line first so the
    // heading is not glued onto that line.
    const lastLine = document.lineAt(document.lineCount - 1);
    const atEndWithoutNewline = insertAfterLine + 1 >= document.lineCount && lastLine.text.length > 0;
    await editor.edit(editBuilder => {
        if (atEndWithoutNewline) {
            editBuilder.insert(lastLine.range.end, '\n' + adjustedText.replace(/\n$/, ''));
        } else {
            editBuilder.insert(new vscode.Position(insertAfterLine + 1, 0), adjustedText);
        }
    });

    vscode.window.showInformationMessage('Subtree yanked');
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
    const headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const { startLine, endLine } = getSubtreeRange(document, headingLine);

    // Get subtree content
    const subtreeRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
    const subtreeText = document.getText(subtreeRange);

    // Copy to clipboard
    await pushKill(subtreeText);

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
    const headingLine = position.line;
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
