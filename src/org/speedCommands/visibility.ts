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

/**
 * Parse #+STARTUP: options from the beginning of a document
 * Returns an array of startup option strings (e.g., ['overview', 'indent'])
 */
export function parseStartupOptions(document: vscode.TextDocument): string[] {
    // Only check the first 50 lines for performance
    const maxLines = Math.min(50, document.lineCount);
    for (let i = 0; i < maxLines; i++) {
        const line = document.lineAt(i).text;
        // Match #+STARTUP: with optional values, handling comments
        const match = line.match(/^#\+STARTUP:\s*(.*)$/i);
        if (match) {
            // Remove comments (anything after #) and split by whitespace
            const value = match[1].split('#')[0].trim();
            if (value) {
                return value.split(/\s+/).map(s => s.toLowerCase());
            }
        }
    }
    return [];
}

/**
 * Apply startup visibility options to the active editor
 * Silently applies folding without status bar messages
 */
export async function applyStartupVisibility(options: string[]): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    let applied = false;

    for (const option of options) {
        switch (option) {
            case 'overview':
            case 'fold':
                // Fold everything - show only top-level headings
                await vscode.commands.executeCommand('editor.foldAll');
                applied = true;
                break;

            case 'content':
            case 'contents':
                // Show all headings but fold body text
                await vscode.commands.executeCommand('editor.unfoldAll');
                await vscode.commands.executeCommand('editor.foldLevel2');
                applied = true;
                break;

            case 'showall':
            case 'showeverything':
            case 'nofold':
                // Expand everything
                await vscode.commands.executeCommand('editor.unfoldAll');
                applied = true;
                break;

            case 'show2levels':
                await vscode.commands.executeCommand('editor.unfoldAll');
                await vscode.commands.executeCommand('editor.foldLevel2');
                applied = true;
                break;

            case 'show3levels':
                await vscode.commands.executeCommand('editor.unfoldAll');
                await vscode.commands.executeCommand('editor.foldLevel3');
                applied = true;
                break;

            case 'show4levels':
                await vscode.commands.executeCommand('editor.unfoldAll');
                await vscode.commands.executeCommand('editor.foldLevel4');
                applied = true;
                break;

            case 'show5levels':
                await vscode.commands.executeCommand('editor.unfoldAll');
                await vscode.commands.executeCommand('editor.foldLevel5');
                applied = true;
                break;

            // Ignore other options (indent, hidestars, etc.) - not related to folding
        }

        // Stop after first visibility option is applied
        if (applied) break;
    }

    return applied;
}
