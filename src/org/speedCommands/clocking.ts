/**
 * Speed Command Clocking Functions
 *
 * Clock in and clock out of tasks for time tracking.
 * Includes clock history, status bar, and navigation.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import {
    generateClockIn,
    generateClockOut,
    parseClockLine,
    checkClockConsistency,
    ClockEntry,
    ClockIssue,
    formatClockTimestamp,
    formatDuration,
    collectAllClockEntries,
    collectClockEntries,
    calculateTotalTime,
} from '../../parser/orgClocking';
import { parseOrg } from '../../parser/orgParserUnified';

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

// Clock time decoration type
let clockTimeDecorationType: vscode.TextEditorDecorationType | undefined;
let clockDecorationsEnabled = true;
let decorationUpdateTimeout: NodeJS.Timeout | undefined;
const DECORATION_DEBOUNCE_MS = 500;

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

    // Initialize clock time decorations
    initializeClockDecorations(context);
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

/**
 * Check clock consistency in the current document
 * Reports issues like running clocks, overlaps, future dates, etc.
 */
export async function checkClockConsistencyCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'org') {
        vscode.window.showInformationMessage('Not an org-mode file');
        return;
    }

    // Parse the document and collect all clock entries
    const text = document.getText();
    const ast = parseOrg(text);
    const entries = collectAllClockEntries(ast);

    if (entries.length === 0) {
        vscode.window.showInformationMessage('No clock entries found in this file');
        return;
    }

    // Add file path and find line numbers for each entry
    const entriesWithLocation: ClockEntry[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('CLOCK:')) {
            const parsed = parseClockLine(line.trim());
            if (parsed) {
                parsed.filePath = document.uri.fsPath;
                parsed.lineNumber = i;
                entriesWithLocation.push(parsed);
            }
        }
    }

    // Check for issues
    const issues = checkClockConsistency(entriesWithLocation);

    if (issues.length === 0) {
        vscode.window.showInformationMessage(`All ${entries.length} clock entries are consistent`);
        return;
    }

    // Show issues in a quick pick
    const issueItems: (vscode.QuickPickItem & { issue: ClockIssue })[] = issues.map(issue => {
        const icons: Record<string, string> = {
            'running': '$(clock)',
            'future': '$(calendar)',
            'negative': '$(warning)',
            'long': '$(watch)',
            'overlap': '$(layers)',
            'gap': '$(debug-disconnect)',
        };

        const lineNum = issue.entry.lineNumber !== undefined ? issue.entry.lineNumber + 1 : '?';

        return {
            label: `${icons[issue.type] || '$(error)'} ${issue.type.toUpperCase()}`,
            description: `Line ${lineNum}`,
            detail: issue.message,
            issue,
        };
    });

    const selected = await vscode.window.showQuickPick(issueItems, {
        placeHolder: `Found ${issues.length} clock issue(s) in ${entries.length} entries`,
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (selected && selected.issue.entry.lineNumber !== undefined) {
        // Jump to the issue
        const pos = new vscode.Position(selected.issue.entry.lineNumber, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
}

/**
 * Modify an existing clock entry
 * Allows editing start time, end time, or deleting the entry
 */
export async function modifyClockEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
    }

    const document = editor.document;
    const position = editor.selection.active;

    // Find clock entry at or near current line
    let clockLine = -1;
    let clockEntry: ReturnType<typeof parseClockLine> = null;

    // Check current line first
    const currentLineText = document.lineAt(position.line).text;
    if (currentLineText.includes('CLOCK:')) {
        clockEntry = parseClockLine(currentLineText.trim());
        if (clockEntry) {
            clockLine = position.line;
        }
    }

    // If not on a clock line, search nearby in logbook
    if (clockLine < 0) {
        // Search up to 10 lines up and down for a clock entry
        for (let offset = 1; offset <= 10; offset++) {
            // Search up
            if (position.line - offset >= 0) {
                const lineText = document.lineAt(position.line - offset).text;
                if (lineText.includes('CLOCK:')) {
                    const parsed = parseClockLine(lineText.trim());
                    if (parsed) {
                        clockEntry = parsed;
                        clockLine = position.line - offset;
                        break;
                    }
                }
            }
            // Search down
            if (position.line + offset < document.lineCount) {
                const lineText = document.lineAt(position.line + offset).text;
                if (lineText.includes('CLOCK:')) {
                    const parsed = parseClockLine(lineText.trim());
                    if (parsed) {
                        clockEntry = parsed;
                        clockLine = position.line + offset;
                        break;
                    }
                }
            }
        }
    }

    if (clockLine < 0 || !clockEntry) {
        vscode.window.showInformationMessage('No clock entry found near cursor');
        return;
    }

    // Show modification options
    const options: (vscode.QuickPickItem & { action: string })[] = [
        {
            label: '$(edit) Edit Start Time',
            description: formatClockTimestamp(clockEntry.start),
            action: 'edit-start',
        },
    ];

    if (clockEntry.end) {
        options.push({
            label: '$(edit) Edit End Time',
            description: formatClockTimestamp(clockEntry.end),
            action: 'edit-end',
        });
    } else {
        options.push({
            label: '$(add) Set End Time (Clock Out)',
            description: 'Close this running clock',
            action: 'set-end',
        });
    }

    options.push({
        label: '$(trash) Delete Entry',
        description: 'Remove this clock entry',
        action: 'delete',
    });

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Modify clock entry',
    });

    if (!selected) return;

    switch (selected.action) {
        case 'edit-start': {
            const newTime = await promptForTime('Enter new start time', clockEntry.start);
            if (newTime) {
                clockEntry.start = newTime;
                await updateClockLine(editor, clockLine, clockEntry);
            }
            break;
        }
        case 'edit-end': {
            if (clockEntry.end) {
                const newTime = await promptForTime('Enter new end time', clockEntry.end);
                if (newTime) {
                    clockEntry.end = newTime;
                    await updateClockLine(editor, clockLine, clockEntry);
                }
            }
            break;
        }
        case 'set-end': {
            const newTime = await promptForTime('Enter end time', new Date());
            if (newTime) {
                clockEntry.end = newTime;
                await updateClockLine(editor, clockLine, clockEntry);
            }
            break;
        }
        case 'delete': {
            const confirm = await vscode.window.showWarningMessage(
                'Delete this clock entry?',
                { modal: true },
                'Delete',
                'Cancel'
            );
            if (confirm === 'Delete') {
                await editor.edit(editBuilder => {
                    const range = new vscode.Range(clockLine, 0, clockLine + 1, 0);
                    editBuilder.delete(range);
                });
                vscode.window.showInformationMessage('Clock entry deleted');
            }
            break;
        }
    }
}

/**
 * Prompt user for a time value
 */
async function promptForTime(prompt: string, defaultTime: Date): Promise<Date | null> {
    const defaultStr = `${defaultTime.getFullYear()}-${String(defaultTime.getMonth() + 1).padStart(2, '0')}-${String(defaultTime.getDate()).padStart(2, '0')} ${String(defaultTime.getHours()).padStart(2, '0')}:${String(defaultTime.getMinutes()).padStart(2, '0')}`;

    const input = await vscode.window.showInputBox({
        prompt,
        value: defaultStr,
        placeHolder: 'YYYY-MM-DD HH:MM',
        validateInput: (value) => {
            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
            if (!match) {
                return 'Format: YYYY-MM-DD HH:MM';
            }
            return null;
        },
    });

    if (!input) return null;

    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) return null;

    return new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3]),
        parseInt(match[4]),
        parseInt(match[5])
    );
}

/**
 * Update a clock line with new entry data
 */
async function updateClockLine(
    editor: vscode.TextEditor,
    lineNumber: number,
    entry: ClockEntry
): Promise<void> {
    let newLine: string;

    if (entry.end) {
        const duration = Math.round((entry.end.getTime() - entry.start.getTime()) / 60000);
        newLine = `CLOCK: ${formatClockTimestamp(entry.start)}--${formatClockTimestamp(entry.end)} => ${formatDuration(duration)}`;
    } else {
        newLine = `CLOCK: ${formatClockTimestamp(entry.start)}`;
    }

    const line = editor.document.lineAt(lineNumber);
    const indent = line.text.match(/^(\s*)/)?.[1] || '';

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, indent + newLine);
    });

    vscode.window.showInformationMessage('Clock entry updated');
}

// =============================================================================
// Clock Time Decorations
// =============================================================================

/**
 * Initialize clock time decorations
 * Shows total clocked time as inline decorations on headlines
 */
function initializeClockDecorations(context: vscode.ExtensionContext): void {
    // Create decoration type for clock times
    clockTimeDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
            margin: '0 0 0 1em',
        },
    });

    // Load config
    const config = vscode.workspace.getConfiguration('scimax.clock');
    clockDecorationsEnabled = config.get<boolean>('showInlineTime', true);

    // Update decorations on active editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && clockDecorationsEnabled) {
                debouncedUpdateClockDecorations(editor);
            }
        })
    );

    // Update decorations on document change (debounced to prevent OOM)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === event.document && clockDecorationsEnabled) {
                debouncedUpdateClockDecorations(editor);
            }
        })
    );

    // Watch for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.clock.showInlineTime')) {
                const newConfig = vscode.workspace.getConfiguration('scimax.clock');
                clockDecorationsEnabled = newConfig.get<boolean>('showInlineTime', true);

                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    if (clockDecorationsEnabled) {
                        debouncedUpdateClockDecorations(editor);
                    } else {
                        // Clear decorations
                        editor.setDecorations(clockTimeDecorationType!, []);
                    }
                }
            }
        })
    );

    // Cleanup timeout on dispose
    context.subscriptions.push({
        dispose: () => {
            if (decorationUpdateTimeout) {
                clearTimeout(decorationUpdateTimeout);
            }
        }
    });

    // Initial update (delayed)
    const editor = vscode.window.activeTextEditor;
    if (editor && clockDecorationsEnabled) {
        debouncedUpdateClockDecorations(editor);
    }
}

/**
 * Debounced update for clock decorations
 * Prevents excessive parsing on rapid document changes
 */
function debouncedUpdateClockDecorations(editor: vscode.TextEditor): void {
    if (decorationUpdateTimeout) {
        clearTimeout(decorationUpdateTimeout);
    }
    decorationUpdateTimeout = setTimeout(() => {
        updateClockDecorationsLightweight(editor);
    }, DECORATION_DEBOUNCE_MS);
}

/**
 * Lightweight update for clock decorations - no full AST parsing
 * Scans document line-by-line for headings and CLOCK entries
 */
function updateClockDecorationsLightweight(editor: vscode.TextEditor): void {
    if (!clockTimeDecorationType) return;
    if (editor.document.languageId !== 'org') {
        editor.setDecorations(clockTimeDecorationType, []);
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];
    const document = editor.document;

    // Track headings and their clock totals
    interface HeadingInfo {
        line: number;
        level: number;
        totalMinutes: number;
    }

    const headingStack: HeadingInfo[] = [];
    let currentHeading: HeadingInfo | null = null;

    // Scan document line by line
    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;

        // Check for heading
        const headingMatch = lineText.match(/^(\*+)\s/);
        if (headingMatch) {
            // Save previous heading if it had time
            if (currentHeading && currentHeading.totalMinutes > 0) {
                const lineContent = document.lineAt(currentHeading.line).text;
                const endOfLine = new vscode.Position(currentHeading.line, lineContent.length);
                const timeStr = formatDuration(currentHeading.totalMinutes);

                decorations.push({
                    range: new vscode.Range(endOfLine, endOfLine),
                    renderOptions: {
                        after: {
                            contentText: `[${timeStr}]`,
                        },
                    },
                });
            }

            // Start new heading
            currentHeading = {
                line: i,
                level: headingMatch[1].length,
                totalMinutes: 0,
            };
            continue;
        }

        // Check for CLOCK line
        if (currentHeading && lineText.includes('CLOCK:')) {
            const entry = parseClockLine(lineText.trim());
            if (entry && entry.duration) {
                currentHeading.totalMinutes += entry.duration;
            }
        }
    }

    // Don't forget the last heading
    if (currentHeading && currentHeading.totalMinutes > 0) {
        const lineContent = document.lineAt(currentHeading.line).text;
        const endOfLine = new vscode.Position(currentHeading.line, lineContent.length);
        const timeStr = formatDuration(currentHeading.totalMinutes);

        decorations.push({
            range: new vscode.Range(endOfLine, endOfLine),
            renderOptions: {
                after: {
                    contentText: `[${timeStr}]`,
                },
            },
        });
    }

    editor.setDecorations(clockTimeDecorationType, decorations);
}

/**
 * Toggle clock time decorations
 */
export async function toggleClockDecorations(): Promise<void> {
    clockDecorationsEnabled = !clockDecorationsEnabled;

    const editor = vscode.window.activeTextEditor;
    if (editor) {
        if (clockDecorationsEnabled) {
            updateClockDecorationsLightweight(editor);
            vscode.window.showInformationMessage('Clock time decorations enabled');
        } else {
            if (clockTimeDecorationType) {
                editor.setDecorations(clockTimeDecorationType, []);
            }
            vscode.window.showInformationMessage('Clock time decorations disabled');
        }
    }

    // Save to config
    const config = vscode.workspace.getConfiguration('scimax.clock');
    await config.update('showInlineTime', clockDecorationsEnabled, vscode.ConfigurationTarget.Global);
}

/**
 * Force refresh clock decorations
 */
export function refreshClockDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && clockDecorationsEnabled) {
        updateClockDecorationsLightweight(editor);
    }
}
