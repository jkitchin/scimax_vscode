/**
 * Speed Command Planning Functions
 *
 * Add/edit SCHEDULED and DEADLINE timestamps.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { parseRelativeDate, getDateExpressionExamples } from '../../utils/dateParser';
import { formatOrgTimestamp as formatTimestamp } from '../../parser/orgRepeater';

/**
 * Format a date as an org-mode timestamp (wrapper for consistency)
 */
function formatOrgTimestamp(date: Date, includeTime = false): string {
    if (includeTime) {
        return formatTimestamp(date, {
            hour: date.getHours(),
            minute: date.getMinutes(),
        });
    }
    return formatTimestamp(date, {});
}


/**
 * Find the planning line for a heading (contains SCHEDULED, DEADLINE, or CLOSED)
 * Returns the line number and whether the specific keyword exists on it
 */
function findPlanningLine(
    document: vscode.TextDocument,
    headingLine: number,
    keyword: 'SCHEDULED' | 'DEADLINE'
): { lineNumber: number; text: string; hasKeyword: boolean } | null {
    // Search in lines below heading until next heading or content
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        // Check if we've hit the next heading
        const nextLevel = getHeadingLevel(document, i);
        if (nextLevel > 0) break;

        // Check if this is a planning line (has any planning keyword)
        if (/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(line)) {
            // Check if this specific keyword exists
            const keywordPattern = new RegExp(`${keyword}:\\s*<[^>]+>`);
            return {
                lineNumber: i,
                text: line,
                hasKeyword: keywordPattern.test(line)
            };
        }

        // If we've hit content (non-empty, non-planning line), stop searching
        // Planning lines should be immediately after heading
        if (line.trim()) {
            // Unless it's a drawer or property
            if (!/^\s*:/.test(line)) break;
        }
    }

    return null;
}

/**
 * Get the indent for planning lines based on heading
 */
function getPlanningIndent(document: vscode.TextDocument, headingLine: number): string {
    // In org-mode, planning lines are typically not indented
    // But we check if there's an existing pattern
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const nextLevel = getHeadingLevel(document, i);
        if (nextLevel > 0) break;

        const match = line.match(/^(\s*)(SCHEDULED|DEADLINE|CLOSED):/);
        if (match) {
            return match[1];
        }

        if (line.trim() && !/^\s*:/.test(line)) break;
    }

    return '';
}

/**
 * Prompt user for a date using natural language input
 */
async function promptForDate(title: string): Promise<Date | null> {
    const input = await vscode.window.showInputBox({
        prompt: title,
        placeHolder: 'today, tomorrow, +2d, monday, jan 15, 2026-01-15',
        validateInput: (value) => {
            if (!value) return null;
            const parsed = parseRelativeDate(value);
            if (!parsed) return `Invalid date. ${getDateExpressionExamples()}`;
            return null;
        }
    });

    if (!input) return null;
    return parseRelativeDate(input);
}

/**
 * Add or edit a planning timestamp (SCHEDULED or DEADLINE)
 */
async function addPlanningTimestamp(keyword: 'SCHEDULED' | 'DEADLINE'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading we're on or below
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

    // Prompt for date
    const date = await promptForDate(`Set ${keyword}`);
    if (!date) return;

    const timestamp = formatOrgTimestamp(date);
    const indent = getPlanningIndent(document, headingLine);

    // Check for existing planning line
    const existing = findPlanningLine(document, headingLine, keyword);

    if (existing) {
        const line = document.lineAt(existing.lineNumber);

        if (existing.hasKeyword) {
            // Replace existing timestamp for this keyword
            const keywordPattern = new RegExp(`${keyword}:\\s*<[^>]+>`);
            const newLine = line.text.replace(keywordPattern, `${keyword}: ${timestamp}`);

            await editor.edit(editBuilder => {
                editBuilder.replace(line.range, newLine);
            });
        } else {
            // Append this keyword to the existing planning line
            // Add it at the end of the line
            const newLine = `${line.text} ${keyword}: ${timestamp}`;

            await editor.edit(editBuilder => {
                editBuilder.replace(line.range, newLine);
            });
        }
    } else {
        // Insert new planning line right after the heading
        await editor.edit(editBuilder => {
            // Check if there's a line after the heading
            if (headingLine + 1 < document.lineCount) {
                // Normal case: insert at the beginning of the next line
                const newLine = `${indent}${keyword}: ${timestamp}\n`;
                editBuilder.insert(new vscode.Position(headingLine + 1, 0), newLine);
            } else {
                // Heading is the last line of the file - insert at end with preceding newline
                const headingLineObj = document.lineAt(headingLine);
                editBuilder.insert(headingLineObj.range.end, `\n${indent}${keyword}: ${timestamp}`);
            }
        });
    }
}

/**
 * Add or edit SCHEDULED timestamp
 */
export async function addSchedule(): Promise<void> {
    await addPlanningTimestamp('SCHEDULED');
}

/**
 * Add or edit DEADLINE timestamp
 */
export async function addDeadline(): Promise<void> {
    await addPlanningTimestamp('DEADLINE');
}
