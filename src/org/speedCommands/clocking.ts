/**
 * Speed Command Clocking Functions
 *
 * Clock in and clock out of tasks for time tracking.
 * Includes clock history, status bar, and navigation.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { generateClockIn, generateClockOut, parseClockLine } from '../../parser/orgClocking';

// Extension context for persistence
let extensionContext: vscode.ExtensionContext | undefined;

// Track the currently running clock globally
let currentClock: {
    filePath: string;
    lineNumber: number;
    headingLine: number;
    headingTitle: string;
    startTime: Date;
} | null = null;

// Clock history (most recent first)
const MAX_HISTORY_SIZE = 20;
let clockHistory: Array<{
    filePath: string;
    headingLine: number;
    headingTitle: string;
    lastClocked: string; // ISO date string
}> = [];

// Status bar item
let clockStatusBar: vscode.StatusBarItem | undefined;
let statusBarUpdateInterval: NodeJS.Timeout | undefined;

/**
 * Initialize clocking with extension context for persistence
 */
export function initializeClocking(context: vscode.ExtensionContext): void {
    extensionContext = context;

    // Load persisted clock history
    const savedHistory = context.globalState.get<typeof clockHistory>('scimax.clockHistory');
    if (savedHistory) {
        clockHistory = savedHistory;
    }

    // Load persisted running clock
    const savedClock = context.globalState.get<{
        filePath: string;
        lineNumber: number;
        headingLine: number;
        headingTitle: string;
        startTime: string;
    }>('scimax.currentClock');

    if (savedClock) {
        currentClock = {
            ...savedClock,
            startTime: new Date(savedClock.startTime)
        };
    }

    // Create status bar item
    clockStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        50
    );
    clockStatusBar.command = 'scimax.clock.menu';
    context.subscriptions.push(clockStatusBar);

    // Update status bar immediately and start interval
    updateStatusBar();
    statusBarUpdateInterval = setInterval(updateStatusBar, 60000); // Update every minute

    context.subscriptions.push({
        dispose: () => {
            if (statusBarUpdateInterval) {
                clearInterval(statusBarUpdateInterval);
            }
        }
    });
}

/**
 * Save clock state to persistence
 */
async function saveClockState(): Promise<void> {
    if (!extensionContext) return;

    // Save current clock
    if (currentClock) {
        await extensionContext.globalState.update('scimax.currentClock', {
            ...currentClock,
            startTime: currentClock.startTime.toISOString()
        });
    } else {
        await extensionContext.globalState.update('scimax.currentClock', undefined);
    }

    // Save history
    await extensionContext.globalState.update('scimax.clockHistory', clockHistory);
}

/**
 * Add entry to clock history
 */
function addToHistory(filePath: string, headingLine: number, headingTitle: string): void {
    // Remove existing entry for same heading if present
    clockHistory = clockHistory.filter(
        h => !(h.filePath === filePath && h.headingLine === headingLine)
    );

    // Add to front
    clockHistory.unshift({
        filePath,
        headingLine,
        headingTitle,
        lastClocked: new Date().toISOString()
    });

    // Trim to max size
    if (clockHistory.length > MAX_HISTORY_SIZE) {
        clockHistory = clockHistory.slice(0, MAX_HISTORY_SIZE);
    }
}

/**
 * Update the status bar with current clock info
 */
function updateStatusBar(): void {
    if (!clockStatusBar) return;

    if (currentClock) {
        const duration = Math.round((new Date().getTime() - currentClock.startTime.getTime()) / 60000);
        const hours = Math.floor(duration / 60);
        const mins = duration % 60;
        const durationStr = `${hours}:${String(mins).padStart(2, '0')}`;

        // Truncate title if too long
        const title = currentClock.headingTitle.length > 20
            ? currentClock.headingTitle.substring(0, 20) + '...'
            : currentClock.headingTitle;

        clockStatusBar.text = `$(clock) ${durationStr} - ${title}`;
        clockStatusBar.tooltip = `Clocked in: ${currentClock.headingTitle}\nStarted: ${currentClock.startTime.toLocaleTimeString()}\nClick for clock menu`;
        clockStatusBar.backgroundColor = undefined;
        clockStatusBar.show();
    } else {
        clockStatusBar.text = '$(clock) No clock';
        clockStatusBar.tooltip = 'Click to clock in to last task or select from history';
        clockStatusBar.hide(); // Hide when no clock is running
    }
}

/**
 * Extract heading title from heading line
 */
function extractHeadingTitle(line: string): string {
    const match = line.match(/^\*+\s+(?:TODO|DONE|NEXT|WAITING|CANCELLED|HOLD)?\s*(.*?)(?:\s+:[^:]+:)?\s*$/);
    return match ? match[1].trim() : 'task';
}

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
 * Find heading containing a line
 */
function findContainingHeading(document: vscode.TextDocument, line: number): number {
    for (let i = line; i >= 0; i--) {
        if (getHeadingLevel(document, i) > 0) {
            return i;
        }
    }
    return -1;
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
        headingLine = findContainingHeading(document, position.line);
        if (headingLine < 0) {
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

    // Get heading title before any edits
    const headingText = document.lineAt(headingLine).text;
    const headingTitle = extractHeadingTitle(headingText);

    // Ensure logbook drawer exists
    const logbook = await ensureLogbookDrawer(editor, headingLine);

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
        headingTitle: headingTitle,
        startTime: new Date()
    };

    // Add to history
    addToHistory(document.uri.fsPath, headingLine, headingTitle);

    // Save state
    await saveClockState();
    updateStatusBar();

    vscode.window.showInformationMessage(`Clocked in: ${headingTitle}`);
}

/**
 * Clock in to a specific heading (for clock-in-last and history)
 */
async function clockInToHeading(filePath: string, headingLine: number): Promise<void> {
    // Open the file
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc);

    // Verify heading still exists
    if (headingLine >= doc.lineCount || getHeadingLevel(doc, headingLine) === 0) {
        vscode.window.showErrorMessage('Heading no longer exists at that location');
        return;
    }

    // Move cursor to heading
    const pos = new vscode.Position(headingLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    // Clock in
    await clockIn();
}

/**
 * Clock out of the current task
 */
export async function clockOut(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!currentClock) {
        // Try to find a running clock in the current file if we have an editor
        if (editor) {
            const document = editor.document;
            const position = editor.selection.active;

            // Find the heading
            let headingLine = findContainingHeading(document, position.line);

            if (headingLine >= 0) {
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
                        const headingText = document.lineAt(headingLine).text;
                        currentClock = {
                            filePath: document.uri.fsPath,
                            lineNumber: running.lineNumber,
                            headingLine: headingLine,
                            headingTitle: extractHeadingTitle(headingText),
                            startTime: running.startTime
                        };
                    }
                }
            }
        }

        if (!currentClock) {
            vscode.window.showInformationMessage('No running clock found');
            return;
        }
    }

    // Find the document with the running clock
    let clockEditor = editor;
    if (!editor || editor.document.uri.fsPath !== currentClock.filePath) {
        // Need to open the file with the running clock
        const doc = await vscode.workspace.openTextDocument(currentClock.filePath);
        clockEditor = await vscode.window.showTextDocument(doc);
    }

    const document = clockEditor!.document;

    // Find the running clock line
    const line = document.lineAt(currentClock.lineNumber);
    const clockEntry = parseClockLine(line.text.trim());

    if (!clockEntry || clockEntry.end) {
        // Clock was already closed or not found
        currentClock = null;
        await saveClockState();
        updateStatusBar();
        vscode.window.showInformationMessage('Clock already closed');
        return;
    }

    // Generate clock-out line
    const clockOutLine = generateClockOut(currentClock.startTime);

    await clockEditor!.edit(editBuilder => {
        editBuilder.replace(line.range, clockOutLine);
    });

    // Calculate duration for message
    const duration = Math.round((new Date().getTime() - currentClock.startTime.getTime()) / 60000);
    const hours = Math.floor(duration / 60);
    const mins = duration % 60;
    const durationStr = `${hours}:${String(mins).padStart(2, '0')}`;

    const title = currentClock.headingTitle;
    currentClock = null;

    await saveClockState();
    updateStatusBar();

    vscode.window.showInformationMessage(`Clocked out: ${title} (${durationStr})`);
}

/**
 * Cancel the current clock without saving
 */
export async function clockCancel(): Promise<void> {
    if (!currentClock) {
        vscode.window.showInformationMessage('No running clock to cancel');
        return;
    }

    const answer = await vscode.window.showWarningMessage(
        `Cancel clock on "${currentClock.headingTitle}"? Time will not be recorded.`,
        { modal: true },
        'Cancel Clock',
        'Keep Running'
    );

    if (answer !== 'Cancel Clock') return;

    // Open file and remove the clock line
    const doc = await vscode.workspace.openTextDocument(currentClock.filePath);
    const editor = await vscode.window.showTextDocument(doc);

    const line = doc.lineAt(currentClock.lineNumber);

    await editor.edit(editBuilder => {
        // Delete the entire line including newline
        const range = new vscode.Range(
            currentClock!.lineNumber, 0,
            currentClock!.lineNumber + 1, 0
        );
        editBuilder.delete(range);
    });

    currentClock = null;
    await saveClockState();
    updateStatusBar();

    vscode.window.showInformationMessage('Clock cancelled');
}

/**
 * Jump to the currently clocked task
 */
export async function clockGoto(): Promise<void> {
    if (!currentClock) {
        vscode.window.showInformationMessage('No running clock');
        return;
    }

    // Open the file
    const doc = await vscode.workspace.openTextDocument(currentClock.filePath);
    const editor = await vscode.window.showTextDocument(doc);

    // Move cursor to the heading
    const pos = new vscode.Position(currentClock.headingLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/**
 * Clock in to the last clocked task
 */
export async function clockInLast(): Promise<void> {
    if (currentClock) {
        vscode.window.showInformationMessage('A clock is already running. Clock out first.');
        return;
    }

    if (clockHistory.length === 0) {
        vscode.window.showInformationMessage('No clock history available');
        return;
    }

    const lastTask = clockHistory[0];
    await clockInToHeading(lastTask.filePath, lastTask.headingLine);
}

/**
 * Show clock history and allow selecting a task to clock in
 */
export async function clockSelect(): Promise<void> {
    if (clockHistory.length === 0) {
        vscode.window.showInformationMessage('No clock history available');
        return;
    }

    const items = clockHistory.map(h => ({
        label: h.headingTitle,
        description: new Date(h.lastClocked).toLocaleDateString(),
        detail: h.filePath,
        historyEntry: h
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a task to clock in',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (!selected) return;

    // Clock out if needed
    if (currentClock) {
        await clockOut();
    }

    await clockInToHeading(selected.historyEntry.filePath, selected.historyEntry.headingLine);
}

/**
 * Show clock menu (called from status bar)
 */
export async function showClockMenu(): Promise<void> {
    const items: (vscode.QuickPickItem & { action: string })[] = [];

    if (currentClock) {
        const duration = Math.round((new Date().getTime() - currentClock.startTime.getTime()) / 60000);
        const hours = Math.floor(duration / 60);
        const mins = duration % 60;

        items.push(
            {
                label: `$(clock) Currently: ${currentClock.headingTitle}`,
                description: `${hours}:${String(mins).padStart(2, '0')}`,
                action: 'info',
                kind: vscode.QuickPickItemKind.Separator
            } as any,
            { label: '$(arrow-right) Go to clocked task', action: 'goto' },
            { label: '$(debug-stop) Clock out', action: 'out' },
            { label: '$(close) Cancel clock', action: 'cancel' }
        );
    } else {
        items.push(
            { label: '$(play) Clock in to last task', action: 'last', description: clockHistory[0]?.headingTitle },
            { label: '$(history) Select from history', action: 'select' }
        );
    }

    // Add history items
    if (clockHistory.length > 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, action: '' } as any);
        items.push({ label: 'Recent tasks', kind: vscode.QuickPickItemKind.Separator, action: '' } as any);

        for (const h of clockHistory.slice(0, 5)) {
            items.push({
                label: `$(bookmark) ${h.headingTitle}`,
                description: new Date(h.lastClocked).toLocaleDateString(),
                action: `history:${clockHistory.indexOf(h)}`
            });
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Clock Menu'
    });

    if (!selected || !selected.action) return;

    switch (selected.action) {
        case 'goto':
            await clockGoto();
            break;
        case 'out':
            await clockOut();
            break;
        case 'cancel':
            await clockCancel();
            break;
        case 'last':
            await clockInLast();
            break;
        case 'select':
            await clockSelect();
            break;
        default:
            if (selected.action.startsWith('history:')) {
                const idx = parseInt(selected.action.split(':')[1]);
                const entry = clockHistory[idx];
                if (entry) {
                    if (currentClock) await clockOut();
                    await clockInToHeading(entry.filePath, entry.headingLine);
                }
            }
    }
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
        duration: `${hours}:${String(mins).padStart(2, '0')}`,
        task: currentClock.headingTitle
    };
}

/**
 * Get clock history
 */
export function getClockHistory(): typeof clockHistory {
    return [...clockHistory];
}

/**
 * Clear clock history
 */
export async function clearClockHistory(): Promise<void> {
    clockHistory = [];
    await saveClockState();
    vscode.window.showInformationMessage('Clock history cleared');
}
