/**
 * Speed Command Planning Functions
 *
 * Add/edit SCHEDULED and DEADLINE timestamps.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { parseRelativeDate, getDateExpressionExamples } from '../../utils/dateParser';

/**
 * Format a date as an org-mode timestamp
 */
function formatOrgTimestamp(date: Date, includeTime = false): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dayName = days[date.getDay()];

    if (includeTime) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `<${year}-${month}-${day} ${dayName} ${hours}:${minutes}>`;
    }

    return `<${year}-${month}-${day} ${dayName}>`;
}


/**
 * Find existing SCHEDULED or DEADLINE line for a heading
 */
function findPlanningLine(
    document: vscode.TextDocument,
    headingLine: number,
    keyword: 'SCHEDULED' | 'DEADLINE'
): { lineNumber: number; text: string } | null {
    const headingLevel = getHeadingLevel(document, headingLine);

    // Search in lines below heading until next heading or content
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        // Check if we've hit the next heading
        const nextLevel = getHeadingLevel(document, i);
        if (nextLevel > 0) break;

        // Check if line contains the keyword
        const pattern = new RegExp(`^\\s*${keyword}:\\s*`);
        if (pattern.test(line)) {
            return { lineNumber: i, text: line };
        }

        // If we've hit content (non-empty, non-planning line), stop searching
        // Planning lines should be immediately after heading
        if (line.trim() && !/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(line)) {
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
 * Prompt user for a date using quick pick with natural language support
 */
async function promptForDate(title: string): Promise<Date | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const formatDisplay = (d: Date) => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${days[d.getDay()]}`;
    };

    const options: (vscode.QuickPickItem & { date?: Date })[] = [
        { label: 'Today', description: formatDisplay(today), date: today },
        { label: 'Tomorrow', description: formatDisplay(tomorrow), date: tomorrow },
        { label: 'Next week', description: formatDisplay(nextWeek), date: nextWeek },
        { label: 'Next month', description: formatDisplay(nextMonth), date: nextMonth },
        { label: 'Enter date...', description: 'Type a date expression (e.g., +2d, monday, jan 15)' },
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: title
    });

    if (!selected) return null;

    if (selected.date) {
        return selected.date;
    }

    // Custom date input with natural language support
    const input = await vscode.window.showInputBox({
        prompt: `Enter date expression. ${getDateExpressionExamples()}`,
        placeHolder: '+2d, monday, jan 15, 2026-01-15',
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
        // Replace existing timestamp
        const line = document.lineAt(existing.lineNumber);
        const newLine = line.text.replace(/<[^>]+>/, timestamp);

        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });
    } else {
        // Insert new planning line
        // Find the best position to insert (after heading, before content)
        let insertLine = headingLine + 1;

        // Check for existing planning lines and insert after them
        for (let i = headingLine + 1; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            const nextLevel = getHeadingLevel(document, i);
            if (nextLevel > 0) break;

            if (/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(line)) {
                insertLine = i + 1;
            } else if (line.trim() && !/^\s*:/.test(line)) {
                break;
            }
        }

        const newLine = `${indent}${keyword}: ${timestamp}\n`;

        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(insertLine, 0), newLine);
        });
    }

    vscode.window.showInformationMessage(`${keyword}: ${timestamp}`);
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
