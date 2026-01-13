/**
 * Speed Command Clocking Functions
 *
 * Clock in and clock out of tasks for time tracking.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { generateClockIn, generateClockOut, parseClockLine } from '../../parser/orgClocking';

// Track the currently running clock globally
let currentClock: {
    filePath: string;
    lineNumber: number;
    headingLine: number;
    startTime: Date;
} | null = null;

/**
 * Find the LOGBOOK drawer or create one
 */
async function ensureLogbookDrawer(
    editor: vscode.TextEditor,
    headingLine: number
): Promise<{ startLine: number; endLine: number }> {
    const document = editor.document;

    // Search for existing :LOGBOOK: drawer
    let logbookStart = -1;
    let logbookEnd = -1;

    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();

        // Hit next heading
        if (getHeadingLevel(document, i) > 0) break;

        // Skip planning lines
        if (/^(SCHEDULED|DEADLINE|CLOSED):/.test(line)) continue;

        // Skip PROPERTIES drawer
        if (line === ':PROPERTIES:') {
            // Find end of properties
            for (let j = i + 1; j < document.lineCount; j++) {
                if (document.lineAt(j).text.trim() === ':END:') {
                    i = j;
                    break;
                }
            }
            continue;
        }

        if (line === ':LOGBOOK:') {
            logbookStart = i;
        } else if (logbookStart >= 0 && line === ':END:') {
            logbookEnd = i;
            break;
        } else if (logbookStart < 0 && line && !line.startsWith(':')) {
            // Hit content before finding logbook
            break;
        }
    }

    if (logbookStart >= 0 && logbookEnd >= 0) {
        return { startLine: logbookStart, endLine: logbookEnd };
    }

    // Create new logbook drawer
    // Find insertion point (after heading, planning lines, and properties drawer)
    let insertLine = headingLine + 1;
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();
        const level = getHeadingLevel(document, i);
        if (level > 0) break;

        if (/^(SCHEDULED|DEADLINE|CLOSED):/.test(line)) {
            insertLine = i + 1;
        } else if (line === ':PROPERTIES:') {
            // Find end of properties
            for (let j = i + 1; j < document.lineCount; j++) {
                if (document.lineAt(j).text.trim() === ':END:') {
                    insertLine = j + 1;
                    i = j;
                    break;
                }
            }
        } else if (line && !line.startsWith(':')) {
            break;
        }
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(
            new vscode.Position(insertLine, 0),
            ':LOGBOOK:\n:END:\n'
        );
    });

    return { startLine: insertLine, endLine: insertLine + 1 };
}

/**
 * Find running clock in the logbook
 */
function findRunningClock(
    document: vscode.TextDocument,
    logbookStart: number,
    logbookEnd: number
): { lineNumber: number; startTime: Date } | null {
    for (let i = logbookStart + 1; i < logbookEnd; i++) {
        const line = document.lineAt(i).text;
        if (line.includes('CLOCK:') && !line.includes('--')) {
            // Running clock (no end timestamp)
            const entry = parseClockLine(line.trim());
            if (entry && !entry.end) {
                return { lineNumber: i, startTime: entry.start };
            }
        }
    }
    return null;
}

/**
 * Clock in to the current heading
 */
export async function clockIn(): Promise<void> {
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

    // Check if there's already a running clock
    if (currentClock) {
        // Clock out of the previous task first
        const answer = await vscode.window.showQuickPick(
            ['Clock out and switch', 'Cancel'],
            { placeHolder: 'A clock is already running. What would you like to do?' }
        );

        if (answer !== 'Clock out and switch') return;
        await clockOut();
    }

    // Ensure logbook drawer exists
    const logbook = await ensureLogbookDrawer(editor, headingLine);

    // Re-read document after potential edit
    const docAfter = editor.document;

    // Insert clock-in line at the start of logbook
    const clockLine = generateClockIn();
    const insertLine = logbook.startLine + 1;

    await editor.edit(editBuilder => {
        editBuilder.insert(
            new vscode.Position(insertLine, 0),
            clockLine + '\n'
        );
    });

    // Track the running clock
    currentClock = {
        filePath: document.uri.fsPath,
        lineNumber: insertLine,
        headingLine: headingLine,
        startTime: new Date()
    };

    // Get heading title for message
    const headingText = docAfter.lineAt(headingLine).text;
    const titleMatch = headingText.match(/^\*+\s+(?:TODO|DONE|NEXT|WAITING)?\s*(.*?)(?:\s+:[^:]+:)?\s*$/);
    const title = titleMatch ? titleMatch[1].trim() : 'task';

    vscode.window.showInformationMessage(`Clocked in: ${title}`);
}

/**
 * Clock out of the current task
 */
export async function clockOut(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (!currentClock) {
        // Try to find a running clock in the current file
        const document = editor.document;
        const position = editor.selection.active;

        // Find the heading
        let headingLine = position.line;
        if (getHeadingLevel(document, headingLine) === 0) {
            for (let i = position.line - 1; i >= 0; i--) {
                if (getHeadingLevel(document, i) > 0) {
                    headingLine = i;
                    break;
                }
            }
        }

        if (getHeadingLevel(document, headingLine) === 0) {
            vscode.window.showInformationMessage('No running clock found');
            return;
        }

        // Look for logbook
        let logbookStart = -1;
        let logbookEnd = -1;

        for (let i = headingLine + 1; i < document.lineCount; i++) {
            const line = document.lineAt(i).text.trim();
            if (getHeadingLevel(document, i) > 0) break;

            if (line === ':LOGBOOK:') {
                logbookStart = i;
            } else if (logbookStart >= 0 && line === ':END:') {
                logbookEnd = i;
                break;
            }
        }

        if (logbookStart >= 0 && logbookEnd >= 0) {
            const running = findRunningClock(document, logbookStart, logbookEnd);
            if (running) {
                currentClock = {
                    filePath: document.uri.fsPath,
                    lineNumber: running.lineNumber,
                    headingLine: headingLine,
                    startTime: running.startTime
                };
            }
        }

        if (!currentClock) {
            vscode.window.showInformationMessage('No running clock found');
            return;
        }
    }

    // Find the document with the running clock
    let clockEditor = editor;
    if (editor.document.uri.fsPath !== currentClock.filePath) {
        // Need to open the file with the running clock
        const doc = await vscode.workspace.openTextDocument(currentClock.filePath);
        clockEditor = await vscode.window.showTextDocument(doc);
    }

    const document = clockEditor.document;

    // Find the running clock line
    const line = document.lineAt(currentClock.lineNumber);
    const clockEntry = parseClockLine(line.text.trim());

    if (!clockEntry || clockEntry.end) {
        // Clock was already closed or not found
        currentClock = null;
        vscode.window.showInformationMessage('Clock already closed');
        return;
    }

    // Generate clock-out line
    const clockOutLine = generateClockOut(currentClock.startTime);

    await clockEditor.edit(editBuilder => {
        editBuilder.replace(line.range, clockOutLine);
    });

    // Calculate duration for message
    const duration = Math.round((new Date().getTime() - currentClock.startTime.getTime()) / 60000);
    const hours = Math.floor(duration / 60);
    const mins = duration % 60;
    const durationStr = `${hours}:${String(mins).padStart(2, '0')}`;

    currentClock = null;

    vscode.window.showInformationMessage(`Clocked out: ${durationStr}`);
}

/**
 * Get current clock status
 */
export function getClockStatus(): { running: boolean; duration?: string; task?: string } {
    if (!currentClock) {
        return { running: false };
    }

    const duration = Math.round((new Date().getTime() - currentClock.startTime.getTime()) / 60000);
    const hours = Math.floor(duration / 60);
    const mins = duration % 60;

    return {
        running: true,
        duration: `${hours}:${String(mins).padStart(2, '0')}`
    };
}
