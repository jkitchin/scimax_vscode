/**
 * Org-Mode Refile Provider
 *
 * Implements C-c C-w refile command that moves a heading (with its subtree)
 * to a different location, selecting the target via a QuickPick interface.
 */

import * as vscode from 'vscode';
import { getHeadingLevel, getSubtreeRange } from './speedCommands/context';

/**
 * Interface for refile target items in QuickPick
 */
interface RefileTarget extends vscode.QuickPickItem {
    lineNumber: number;
    level: number;
}

/**
 * Collect all headings in the document as refile targets
 * @param document The document to scan
 * @param excludeRange Lines to exclude (the source subtree)
 * @returns Array of refile targets
 */
function collectRefileTargets(
    document: vscode.TextDocument,
    excludeRange: { startLine: number; endLine: number }
): RefileTarget[] {
    const targets: RefileTarget[] = [];
    const isOrg = document.languageId === 'org';
    const headingPattern = isOrg ? /^(\*+)\s+(.*)$/ : /^(#+)\s+(.*)$/;

    for (let i = 0; i < document.lineCount; i++) {
        // Skip lines in the excluded range (source subtree)
        if (i >= excludeRange.startLine && i <= excludeRange.endLine) {
            continue;
        }

        const line = document.lineAt(i).text;
        const match = line.match(headingPattern);

        if (match) {
            const level = match[1].length;
            const title = match[2].trim();

            // Create visual indentation based on level
            const indent = '  '.repeat(level - 1);
            const marker = isOrg ? '*'.repeat(level) : '#'.repeat(level);

            targets.push({
                label: `${indent}${marker} ${title}`,
                description: `Line ${i + 1}`,
                lineNumber: i,
                level: level
            });
        }
    }

    return targets;
}

/**
 * Adjust heading levels in subtree text
 * @param text The subtree text
 * @param currentLevel Current base level of the subtree
 * @param targetLevel Target base level (should be target heading level + 1)
 * @param isOrg Whether this is an org file (vs markdown)
 * @returns Adjusted text with new heading levels
 */
function adjustSubtreeLevels(
    text: string,
    currentLevel: number,
    targetLevel: number,
    isOrg: boolean
): string {
    if (currentLevel === targetLevel) {
        return text;
    }

    const delta = targetLevel - currentLevel;
    const charPattern = isOrg ? '\\*' : '#';  // Escaped for regex
    const charLiteral = isOrg ? '*' : '#';    // Literal for replacement
    const pattern = new RegExp(`^(${charPattern}+)(\\s)`, 'gm');

    return text.replace(pattern, (match, stars, space) => {
        const newLevel = Math.max(1, stars.length + delta);

        // For markdown, warn if level would exceed 6
        if (!isOrg && newLevel > 6) {
            // Cap at 6 for markdown
            return charLiteral.repeat(6) + space;
        }

        return charLiteral.repeat(newLevel) + space;
    });
}

/**
 * Find the insertion point for refiled subtree (end of target's subtree)
 * @param document The document
 * @param targetLine The target heading line number
 * @returns Line number where to insert (after this line)
 */
function findInsertionPoint(document: vscode.TextDocument, targetLine: number): number {
    const targetLevel = getHeadingLevel(document, targetLine);

    // Find the end of the target's subtree
    let insertLine = targetLine;

    for (let i = targetLine + 1; i < document.lineCount; i++) {
        const level = getHeadingLevel(document, i);
        if (level > 0 && level <= targetLevel) {
            // Found a heading at same or higher level - insert before it
            break;
        }
        insertLine = i;
    }

    return insertLine;
}

/**
 * Get the title of the current heading (for display in QuickPick)
 */
function getHeadingTitle(document: vscode.TextDocument, line: number): string {
    const lineText = document.lineAt(line).text;
    const isOrg = document.languageId === 'org';
    const pattern = isOrg ? /^\*+\s+(.*)$/ : /^#+\s+(.*)$/;
    const match = lineText.match(pattern);
    return match ? match[1].trim() : lineText.trim();
}

/**
 * Main refile command
 * @param options Optional configuration
 * @param options.keepOriginal If true, copy instead of move (refile-copy)
 */
export async function refileSubtree(options?: { keepOriginal?: boolean }): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;

    // Check if we're in an org or markdown file
    if (!['org', 'markdown'].includes(document.languageId)) {
        vscode.window.showWarningMessage('Refile is only available in org and markdown files');
        return;
    }

    const position = editor.selection.active;
    const isOrg = document.languageId === 'org';

    // Get the current subtree
    const subtreeRange = getSubtreeRange(document, position.line);
    const sourceLevel = getHeadingLevel(document, subtreeRange.startLine);

    if (sourceLevel === 0) {
        vscode.window.showWarningMessage('Cursor is not on or in a heading');
        return;
    }

    // Collect refile targets (excluding the source subtree)
    const targets = collectRefileTargets(document, subtreeRange);

    if (targets.length === 0) {
        vscode.window.showInformationMessage('No other headings to refile to');
        return;
    }

    // Get source heading title for display
    const sourceTitle = getHeadingTitle(document, subtreeRange.startLine);
    const actionWord = options?.keepOriginal ? 'Copy' : 'Refile';

    // Show QuickPick with targets
    const selected = await vscode.window.showQuickPick(targets, {
        placeHolder: `${actionWord} "${sourceTitle}" to...`,
        matchOnDescription: true
    });

    if (!selected) {
        return; // User cancelled
    }

    // Get the subtree text
    const startPos = new vscode.Position(subtreeRange.startLine, 0);
    const endPos = new vscode.Position(
        subtreeRange.endLine,
        document.lineAt(subtreeRange.endLine).text.length
    );
    let subtreeText = document.getText(new vscode.Range(startPos, endPos));

    // Calculate the new level (target level + 1, as we become a child)
    const targetLevel = selected.level;
    const newLevel = targetLevel + 1;

    // Warn for markdown level limit
    if (!isOrg && newLevel > 6) {
        const proceed = await vscode.window.showWarningMessage(
            'Markdown headings cannot exceed level 6. Some headings will be capped at level 6.',
            'Continue',
            'Cancel'
        );
        if (proceed !== 'Continue') {
            return;
        }
    }

    // Adjust heading levels in the subtree
    subtreeText = adjustSubtreeLevels(subtreeText, sourceLevel, newLevel, isOrg);

    // Ensure subtree text ends with newline
    if (!subtreeText.endsWith('\n')) {
        subtreeText += '\n';
    }

    // Find insertion point (end of target's subtree)
    // Need to account for potential line shifts after deletion
    let insertAfterLine = findInsertionPoint(document, selected.lineNumber);

    // Determine if target is before or after the source
    const targetBeforeSource = selected.lineNumber < subtreeRange.startLine;

    await editor.edit(editBuilder => {
        if (options?.keepOriginal) {
            // Copy mode: just insert at target location
            // Insert after the last line of target's subtree
            const insertPos = new vscode.Position(insertAfterLine + 1, 0);
            editBuilder.insert(insertPos, subtreeText);
        } else {
            // Move mode: delete source and insert at target

            // If target is after source, we need to adjust for the deletion
            if (!targetBeforeSource) {
                // Calculate how many lines we're removing
                const linesToRemove = subtreeRange.endLine - subtreeRange.startLine + 1;
                insertAfterLine -= linesToRemove;
            }

            // Delete the source subtree (include the newline after)
            const deleteEnd = subtreeRange.endLine + 1 < document.lineCount
                ? new vscode.Position(subtreeRange.endLine + 1, 0)
                : new vscode.Position(subtreeRange.endLine, document.lineAt(subtreeRange.endLine).text.length);
            editBuilder.delete(new vscode.Range(startPos, deleteEnd));

            // Insert at the target location
            const insertPos = new vscode.Position(insertAfterLine + 1, 0);
            editBuilder.insert(insertPos, subtreeText);
        }
    });

    // Show success message
    const targetTitle = getHeadingTitle(document, selected.lineNumber);
    const verb = options?.keepOriginal ? 'Copied' : 'Refiled';
    vscode.window.showInformationMessage(`${verb} to "${targetTitle}"`);
}

/**
 * Refile copy - copy subtree to target (keep original)
 */
export async function refileCopySubtree(): Promise<void> {
    await refileSubtree({ keepOriginal: true });
}

/**
 * Register refile commands
 */
export function registerRefileCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.refile', refileSubtree),
        vscode.commands.registerCommand('scimax.org.refileCopy', refileCopySubtree)
    );
}
