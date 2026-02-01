/**
 * Speed Command Planning Functions
 *
 * Add/edit SCHEDULED and DEADLINE timestamps.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { formatOrgTimestamp as formatTimestamp } from '../../parser/orgRepeater';
import { showCalendarDatePicker } from '../calendarDatePicker';
import { getTodoWorkflowForDocument } from '../todoStates';

// Store extension URI for calendar picker
let extensionUri: vscode.Uri | undefined;

/**
 * Initialize the planning module with extension context
 */
export function initializePlanning(context: vscode.ExtensionContext): void {
    extensionUri = context.extensionUri;
}

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
 * Prompt user for a date using the calendar widget
 * The calendar has a text input at the top for typing date expressions,
 * quick buttons (Today, Tomorrow, Next Week), and a calendar grid.
 */
async function promptForDate(title: string): Promise<Date | null> {
    if (!extensionUri) {
        vscode.window.showErrorMessage('Calendar picker not available - extension not properly initialized');
        return null;
    }
    return showCalendarDatePicker(extensionUri, title);
}

/**
 * Check if heading has a TODO state
 */
function headingHasTodoState(headingText: string, validStates: Set<string>): boolean {
    // Match: stars, space, then check for TODO state
    const match = headingText.match(/^\*+\s+(\S+)/);
    if (!match) return false;
    return validStates.has(match[1]);
}

/**
 * Add TODO state to a heading that doesn't have one
 */
function addTodoStateToHeading(headingText: string, todoState: string): string {
    // Match: stars and space
    const match = headingText.match(/^(\*+\s+)/);
    if (!match) return headingText;
    return match[1] + todoState + ' ' + headingText.slice(match[1].length);
}

/**
 * Add or edit a planning timestamp (SCHEDULED or DEADLINE)
 */
async function addPlanningTimestamp(keyword: 'SCHEDULED' | 'DEADLINE'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Save document URI to restore focus after calendar picker
    const documentUri = document.uri;

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

    // Restore focus to the original document and get fresh editor reference
    // This is necessary because the calendar webview may have taken focus
    const doc = await vscode.workspace.openTextDocument(documentUri);
    const activeEditor = await vscode.window.showTextDocument(doc, { preserveFocus: false });

    const timestamp = formatOrgTimestamp(date);
    const indent = getPlanningIndent(activeEditor.document, headingLine);

    // Get TODO workflow for auto-setting TODO state
    const workflow = getTodoWorkflowForDocument(activeEditor.document);
    const validStates = new Set(workflow.allStates);
    const defaultTodoState = workflow.activeStates[0] || 'TODO';

    // Check if heading needs a TODO state added
    const headingLineObj = activeEditor.document.lineAt(headingLine);
    const needsTodoState = !headingHasTodoState(headingLineObj.text, validStates);

    // Check for existing planning line
    const existing = findPlanningLine(activeEditor.document, headingLine, keyword);

    if (existing) {
        const line = activeEditor.document.lineAt(existing.lineNumber);

        if (existing.hasKeyword) {
            // Replace existing timestamp for this keyword
            const keywordPattern = new RegExp(`${keyword}:\\s*<[^>]+>`);
            const newLine = line.text.replace(keywordPattern, `${keyword}: ${timestamp}`);

            await activeEditor.edit(editBuilder => {
                editBuilder.replace(line.range, newLine);
                // Add TODO state if needed
                if (needsTodoState) {
                    const newHeading = addTodoStateToHeading(headingLineObj.text, defaultTodoState);
                    editBuilder.replace(headingLineObj.range, newHeading);
                }
            });
        } else {
            // Append this keyword to the existing planning line
            // Add it at the end of the line
            const newLine = `${line.text} ${keyword}: ${timestamp}`;

            await activeEditor.edit(editBuilder => {
                editBuilder.replace(line.range, newLine);
                // Add TODO state if needed
                if (needsTodoState) {
                    const newHeading = addTodoStateToHeading(headingLineObj.text, defaultTodoState);
                    editBuilder.replace(headingLineObj.range, newHeading);
                }
            });
        }
    } else {
        // Insert new planning line right after the heading
        await activeEditor.edit(editBuilder => {
            // Add TODO state if needed
            if (needsTodoState) {
                const newHeading = addTodoStateToHeading(headingLineObj.text, defaultTodoState);
                editBuilder.replace(headingLineObj.range, newHeading);
            }

            // Check if there's a line after the heading
            if (headingLine + 1 < activeEditor.document.lineCount) {
                // Normal case: insert at the beginning of the next line
                const newLine = `${indent}${keyword}: ${timestamp}\n`;
                editBuilder.insert(new vscode.Position(headingLine + 1, 0), newLine);
            } else {
                // Heading is the last line of the file - insert at end with preceding newline
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
