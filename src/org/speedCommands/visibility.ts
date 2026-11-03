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
    const headingLine = position.line;
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
 * Narrow to the current subtree by folding everything else, like org's
 * narrow-to-subtree. Folded text is still in the buffer (search and edits
 * reach it); widen() unfolds it again.
 *
 * Only headings outside the subtree and its ancestors are folded, so the
 * cursor is never inside a fold and stays where it is.
 */
export async function narrowToSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const { startLine, endLine } = getSubtreeRange(document, editor.selection.active.line);
    const level = getHeadingLevel(document, startLine);
    if (level === 0) {
        vscode.window.setStatusBarMessage('Not in a subtree', 2000);
        return;
    }

    // Headings that contain the subtree stay open
    const ancestors = new Set<number>();
    for (let i = startLine - 1, l = level; i >= 0 && l > 1; i--) {
        const h = getHeadingLevel(document, i);
        if (h > 0 && h < l) {
            ancestors.add(i);
            l = h;
        }
    }

    // The outermost headings outside the subtree and its ancestors. A heading
    // with no fold region is skipped: folding it would fold its parent.
    const foldLines: number[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        if (i === startLine) {
            i = endLine;
            continue;
        }
        if (getHeadingLevel(document, i) === 0 || ancestors.has(i)) continue;
        const range = getSubtreeRange(document, i);
        if (hasFoldRegion(document, range.startLine, range.endLine)) foldLines.push(i);
        i = range.endLine;
    }

    const selections = editor.selections;
    await vscode.commands.executeCommand('editor.unfoldAll');
    if (foldLines.length > 0) {
        await vscode.commands.executeCommand('editor.fold', {
            selectionLines: foldLines,
            direction: 'down',
            levels: 1
        });
    }
    editor.selections = selections;
    editor.revealRange(new vscode.Range(startLine, 0, startLine, 0), vscode.TextEditorRevealType.AtTop);

    const heading = document.lineAt(startLine).text.replace(/^[*#]+\s+/, '');
    vscode.window.setStatusBarMessage(`Narrowed to: ${heading}`, 2000);
}

/**
 * Whether the folding provider makes a region for a heading's subtree: it
 * needs a line after the heading, and at the end of the file blank lines
 * don't count.
 */
function hasFoldRegion(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
    let last = endLine;
    if (endLine === document.lineCount - 1) {
        while (last > startLine && document.lineAt(last).isEmptyOrWhitespace) last--;
    }
    return last > startLine;
}

/**
 * Widen after narrowToSubtree (unfold everything)
 */
export async function widen(): Promise<void> {
    await vscode.commands.executeCommand('editor.unfoldAll');
    vscode.window.setStatusBarMessage('Widened', 2000);
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
