/**
 * Speed Command Visibility Functions
 *
 * Control folding and visibility of headings and content.
 */

import * as vscode from 'vscode';
import { getHeadingLevel, getSubtreeRange } from './context';

/**
 * Show all children of the current subtree
 */
export async function showAllChildren(): Promise<void> {
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

    // Unfold all lines in the subtree
    await vscode.commands.executeCommand('editor.unfold', {
        selectionLines: Array.from({ length: endLine - startLine + 1 }, (_, i) => startLine + i),
        direction: 'down',
        levels: 100  // Unfold all levels
    });

    vscode.window.setStatusBarMessage('Showing all children', 2000);
}

/**
 * Fold everything to show only top-level headings (overview)
 */
export async function showOverview(): Promise<void> {
    await vscode.commands.executeCommand('editor.foldAll');
    vscode.window.setStatusBarMessage('Overview: All folded', 2000);
}

/**
 * Fold to show only headings up to a certain level
 */
export async function foldToLevel(level: number): Promise<void> {
    // First unfold everything, then fold to level
    await vscode.commands.executeCommand('editor.unfoldAll');
    await vscode.commands.executeCommand(`editor.foldLevel${level}`);
    vscode.window.setStatusBarMessage(`Showing level ${level}`, 2000);
}

/**
 * Show contents (fold to level 2 - shows first two heading levels)
 */
export async function showContents(): Promise<void> {
    await foldToLevel(2);
    vscode.window.setStatusBarMessage('Contents: Level 2', 2000);
}

/**
 * Expand all headings
 */
export async function showAll(): Promise<void> {
    await vscode.commands.executeCommand('editor.unfoldAll');
    vscode.window.setStatusBarMessage('Show all: Expanded', 2000);
}
