import * as vscode from 'vscode';
import { isInTable, moveRowUp, moveRowDown, moveColumnLeft, moveColumnRight } from './tableProvider';

/**
 * TODO states for cycling
 */
const TODO_STATES = ['', 'TODO', 'DONE'];

/**
 * Check if line is an org heading and return match info
 */
function getOrgHeadingInfo(line: string): { level: number; todoState: string; rest: string } | null {
    // Match: stars, optional TODO/DONE, rest of heading
    const match = line.match(/^(\*+)\s+(?:(TODO|DONE)\s+)?(.*)$/);
    if (!match) return null;
    return {
        level: match[1].length,
        todoState: match[2] || '',
        rest: match[3]
    };
}

/**
 * Check if line is a markdown heading and return match info
 */
function getMarkdownHeadingInfo(line: string): { level: number; todoState: string; rest: string } | null {
    // Match: hashes, optional TODO/DONE, rest of heading
    const match = line.match(/^(#{1,6})\s+(?:(TODO|DONE)\s+)?(.*)$/);
    if (!match) return null;
    return {
        level: match[1].length,
        todoState: match[2] || '',
        rest: match[3]
    };
}

/**
 * Cycle TODO state forward: (none) → TODO → DONE → (none)
 */
function cycleTodoForward(current: string): string {
    const idx = TODO_STATES.indexOf(current);
    return TODO_STATES[(idx + 1) % TODO_STATES.length];
}

/**
 * Cycle TODO state backward: (none) → DONE → TODO → (none)
 */
function cycleTodoBackward(current: string): string {
    const idx = TODO_STATES.indexOf(current);
    return TODO_STATES[(idx - 1 + TODO_STATES.length) % TODO_STATES.length];
}

/**
 * Format heading with new TODO state
 */
function formatHeading(prefix: string, todoState: string, rest: string): string {
    if (todoState) {
        return `${prefix} ${todoState} ${rest}`;
    } else {
        return `${prefix} ${rest}`;
    }
}

/**
 * Cycle TODO state on heading
 */
async function cycleTodoState(forward: boolean): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;
    const isOrg = document.languageId === 'org';

    const headingInfo = isOrg
        ? getOrgHeadingInfo(lineText)
        : getMarkdownHeadingInfo(lineText);

    if (!headingInfo) return false;

    const newState = forward
        ? cycleTodoForward(headingInfo.todoState)
        : cycleTodoBackward(headingInfo.todoState);

    const prefix = isOrg
        ? '*'.repeat(headingInfo.level)
        : '#'.repeat(headingInfo.level);

    const newLine = formatHeading(prefix, newState, headingInfo.rest);

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLine);
    });

    return true;
}

/**
 * Timestamp patterns for org-mode and markdown
 * Supports: <2024-01-15 Mon>, [2024-01-15], @due(2024-01-15), etc.
 * With optional time: <2024-01-15 Mon 14:30>
 * With repeater: <2024-01-15 Mon +1w>, <2024-01-15 Mon .+1d>, <2024-01-15 Mon ++1m>
 */

// Repeater types:
// +1w  - shift date to future, keeping it on same day of week
// .+1w - shift from today
// ++1w - shift to next future occurrence

const TIMESTAMP_PATTERNS = {
    // Org active: <2024-01-15 Mon> or <2024-01-15 Mon 14:30> or with repeater
    orgActive: /<(\d{4})-(\d{2})-(\d{2})(?:\s+\w{2,3})?(?:\s+(\d{2}):(\d{2}))?(?:\s+([\.\+]+\d+[hdwmy]))?\s*>/g,
    // Org inactive: [2024-01-15 Mon] or [2024-01-15 Mon 14:30]
    orgInactive: /\[(\d{4})-(\d{2})-(\d{2})(?:\s+\w{2,3})?(?:\s+(\d{2}):(\d{2}))?(?:\s+([\.\+]+\d+[hdwmy]))?\]/g,
    // Markdown style: @due(2024-01-15) or @scheduled(2024-01-15)
    markdown: /@(due|scheduled|deadline)\((\d{4})-(\d{2})-(\d{2})\)/g,
    // ISO date: 2024-01-15
    isoDate: /\b(\d{4})-(\d{2})-(\d{2})\b/g
};

interface TimestampMatch {
    start: number;
    end: number;
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    repeater?: string;
    type: 'orgActive' | 'orgInactive' | 'markdown' | 'isoDate';
    prefix?: string; // For markdown style (@due, @scheduled)
}

/**
 * Find timestamp at cursor position
 */
function findTimestampAtCursor(document: vscode.TextDocument, position: vscode.Position): TimestampMatch | null {
    const line = document.lineAt(position.line).text;
    const cursorCol = position.character;

    // Try each pattern
    for (const [type, pattern] of Object.entries(TIMESTAMP_PATTERNS)) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = match.index + match[0].length;

            if (cursorCol >= start && cursorCol <= end) {
                if (type === 'orgActive' || type === 'orgInactive') {
                    return {
                        start,
                        end,
                        year: parseInt(match[1]),
                        month: parseInt(match[2]),
                        day: parseInt(match[3]),
                        hour: match[4] ? parseInt(match[4]) : undefined,
                        minute: match[5] ? parseInt(match[5]) : undefined,
                        repeater: match[6],
                        type: type as 'orgActive' | 'orgInactive'
                    };
                } else if (type === 'markdown') {
                    return {
                        start,
                        end,
                        year: parseInt(match[2]),
                        month: parseInt(match[3]),
                        day: parseInt(match[4]),
                        type: 'markdown',
                        prefix: match[1]
                    };
                } else if (type === 'isoDate') {
                    return {
                        start,
                        end,
                        year: parseInt(match[1]),
                        month: parseInt(match[2]),
                        day: parseInt(match[3]),
                        type: 'isoDate'
                    };
                }
            }
        }
    }

    return null;
}

/**
 * Determine which component of the timestamp the cursor is on
 */
function getTimestampComponent(
    line: string,
    cursorCol: number,
    ts: TimestampMatch
): 'year' | 'month' | 'day' | 'hour' | 'minute' | 'repeater' {
    const text = line.substring(ts.start, ts.end);
    const relativePos = cursorCol - ts.start;

    // Find positions of each component in the timestamp
    // Format: <YYYY-MM-DD Day HH:MM +1w>
    const yearMatch = text.match(/(\d{4})/);
    const monthMatch = text.match(/\d{4}-(\d{2})/);
    const dayMatch = text.match(/\d{4}-\d{2}-(\d{2})/);
    const timeMatch = text.match(/(\d{2}):(\d{2})/);
    const repeaterMatch = text.match(/([\.\+]+\d+[hdwmy])/);

    if (yearMatch && relativePos >= yearMatch.index! && relativePos < yearMatch.index! + 4) {
        return 'year';
    }
    if (monthMatch && relativePos >= text.indexOf('-') + 1 && relativePos < text.indexOf('-') + 3) {
        return 'month';
    }
    if (dayMatch) {
        const secondDash = text.indexOf('-', text.indexOf('-') + 1);
        if (relativePos >= secondDash + 1 && relativePos < secondDash + 3) {
            return 'day';
        }
    }
    if (timeMatch && ts.hour !== undefined) {
        const timeStart = text.indexOf(timeMatch[0]);
        if (relativePos >= timeStart && relativePos < timeStart + 2) {
            return 'hour';
        }
        if (relativePos >= timeStart + 3 && relativePos < timeStart + 5) {
            return 'minute';
        }
    }
    if (repeaterMatch && ts.repeater) {
        const repStart = text.indexOf(repeaterMatch[0]);
        if (relativePos >= repStart) {
            return 'repeater';
        }
    }

    // Default to day
    return 'day';
}

/**
 * Get day of week abbreviation
 */
function getDayOfWeek(date: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
}

/**
 * Format timestamp back to string
 */
function formatTimestamp(ts: TimestampMatch, date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dow = getDayOfWeek(date);

    if (ts.type === 'orgActive') {
        let result = `<${year}-${month}-${day} ${dow}`;
        if (ts.hour !== undefined && ts.minute !== undefined) {
            result += ` ${String(ts.hour).padStart(2, '0')}:${String(ts.minute).padStart(2, '0')}`;
        }
        if (ts.repeater) {
            result += ` ${ts.repeater}`;
        }
        result += '>';
        return result;
    } else if (ts.type === 'orgInactive') {
        let result = `[${year}-${month}-${day} ${dow}`;
        if (ts.hour !== undefined && ts.minute !== undefined) {
            result += ` ${String(ts.hour).padStart(2, '0')}:${String(ts.minute).padStart(2, '0')}`;
        }
        if (ts.repeater) {
            result += ` ${ts.repeater}`;
        }
        result += ']';
        return result;
    } else if (ts.type === 'markdown') {
        return `@${ts.prefix}(${year}-${month}-${day})`;
    } else {
        return `${year}-${month}-${day}`;
    }
}

/**
 * Parse repeater string into components
 */
function parseRepeater(repeater: string): { type: string; value: number; unit: string } | null {
    const match = repeater.match(/^([\.\+]+)(\d+)([hdwmy])$/);
    if (!match) return null;
    return {
        type: match[1],
        value: parseInt(match[2]),
        unit: match[3]
    };
}

/**
 * Format repeater back to string
 */
function formatRepeater(type: string, value: number, unit: string): string {
    return `${type}${value}${unit}`;
}

/**
 * Adjust timestamp component
 */
function adjustTimestamp(
    ts: TimestampMatch,
    component: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'repeater',
    delta: number
): { newTimestamp: string; newHour?: number; newMinute?: number } {
    const date = new Date(ts.year, ts.month - 1, ts.day);
    let newHour = ts.hour;
    let newMinute = ts.minute;
    let newRepeater = ts.repeater;

    switch (component) {
        case 'year':
            date.setFullYear(date.getFullYear() + delta);
            break;
        case 'month':
            date.setMonth(date.getMonth() + delta);
            break;
        case 'day':
            date.setDate(date.getDate() + delta);
            break;
        case 'hour':
            if (newHour !== undefined) {
                newHour = (newHour + delta + 24) % 24;
            }
            break;
        case 'minute':
            if (newMinute !== undefined) {
                newMinute += delta * 5; // Increment by 5 minutes
                if (newMinute >= 60) {
                    newMinute = 0;
                    if (newHour !== undefined) newHour = (newHour + 1) % 24;
                } else if (newMinute < 0) {
                    newMinute = 55;
                    if (newHour !== undefined) newHour = (newHour - 1 + 24) % 24;
                }
            }
            break;
        case 'repeater':
            if (newRepeater) {
                const rep = parseRepeater(newRepeater);
                if (rep) {
                    rep.value = Math.max(1, rep.value + delta);
                    newRepeater = formatRepeater(rep.type, rep.value, rep.unit);
                }
            }
            break;
    }

    const newTs = { ...ts, hour: newHour, minute: newMinute, repeater: newRepeater };
    return {
        newTimestamp: formatTimestamp(newTs, date),
        newHour,
        newMinute
    };
}

/**
 * Shift timestamp up (increment) or move table row up
 */
async function shiftTimestampUp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Check if in table first
    if (isInTable(document, position)) {
        const moved = await moveRowUp();
        if (moved) return;
    }

    const ts = findTimestampAtCursor(document, position);
    if (!ts) {
        // No timestamp found, let default shift-up behavior happen
        await vscode.commands.executeCommand('editor.action.moveLinesUpAction');
        return;
    }

    const line = document.lineAt(position.line).text;
    const component = getTimestampComponent(line, position.character, ts);
    const { newTimestamp } = adjustTimestamp(ts, component, 1);

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            position.line, ts.start,
            position.line, ts.end
        );
        editBuilder.replace(range, newTimestamp);
    });

    // Keep cursor on same component
    const newPosition = new vscode.Position(position.line, position.character);
    editor.selection = new vscode.Selection(newPosition, newPosition);
}

/**
 * Shift timestamp down (decrement) or move table row down
 */
async function shiftTimestampDown(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Check if in table first
    if (isInTable(document, position)) {
        const moved = await moveRowDown();
        if (moved) return;
    }

    const ts = findTimestampAtCursor(document, position);
    if (!ts) {
        // No timestamp found, let default shift-down behavior happen
        await vscode.commands.executeCommand('editor.action.moveLinesDownAction');
        return;
    }

    const line = document.lineAt(position.line).text;
    const component = getTimestampComponent(line, position.character, ts);
    const { newTimestamp } = adjustTimestamp(ts, component, -1);

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            position.line, ts.start,
            position.line, ts.end
        );
        editBuilder.replace(range, newTimestamp);
    });

    // Keep cursor on same component
    const newPosition = new vscode.Position(position.line, position.character);
    editor.selection = new vscode.Selection(newPosition, newPosition);
}

/**
 * Insert a new timestamp at cursor
 */
async function insertTimestamp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dow = getDayOfWeek(now);

    const options = [
        { label: 'Active timestamp', description: `<${year}-${month}-${day} ${dow}>`, value: 'active' },
        { label: 'Inactive timestamp', description: `[${year}-${month}-${day} ${dow}]`, value: 'inactive' },
        { label: 'Active with time', description: `<${year}-${month}-${day} ${dow} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}>`, value: 'activeTime' },
        { label: 'Date only', description: `${year}-${month}-${day}`, value: 'iso' },
        { label: 'Repeating (daily)', description: `<${year}-${month}-${day} ${dow} +1d>`, value: 'daily' },
        { label: 'Repeating (weekly)', description: `<${year}-${month}-${day} ${dow} +1w>`, value: 'weekly' },
        { label: 'Repeating (monthly)', description: `<${year}-${month}-${day} ${dow} +1m>`, value: 'monthly' },
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select timestamp format'
    });

    if (!selected) return;

    let timestamp = '';
    switch (selected.value) {
        case 'active':
            timestamp = `<${year}-${month}-${day} ${dow}>`;
            break;
        case 'inactive':
            timestamp = `[${year}-${month}-${day} ${dow}]`;
            break;
        case 'activeTime':
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            timestamp = `<${year}-${month}-${day} ${dow} ${hours}:${minutes}>`;
            break;
        case 'iso':
            timestamp = `${year}-${month}-${day}`;
            break;
        case 'daily':
            timestamp = `<${year}-${month}-${day} ${dow} +1d>`;
            break;
        case 'weekly':
            timestamp = `<${year}-${month}-${day} ${dow} +1w>`;
            break;
        case 'monthly':
            timestamp = `<${year}-${month}-${day} ${dow} +1m>`;
            break;
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, timestamp);
    });
}

/**
 * Add or change repeater on timestamp
 */
async function addRepeater(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    const ts = findTimestampAtCursor(document, position);
    if (!ts) {
        vscode.window.showInformationMessage('No timestamp at cursor');
        return;
    }

    if (ts.type !== 'orgActive' && ts.type !== 'orgInactive') {
        vscode.window.showInformationMessage('Repeaters only work with org-style timestamps');
        return;
    }

    const options = [
        { label: '+1d', description: 'Daily' },
        { label: '+1w', description: 'Weekly' },
        { label: '+2w', description: 'Bi-weekly' },
        { label: '+1m', description: 'Monthly' },
        { label: '+1y', description: 'Yearly' },
        { label: '.+1d', description: 'Daily from completion' },
        { label: '.+1w', description: 'Weekly from completion' },
        { label: '++1w', description: 'Weekly, next future' },
        { label: 'Remove', description: 'Remove repeater' },
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select repeater type'
    });

    if (!selected) return;

    const newTs = { ...ts };
    if (selected.label === 'Remove') {
        newTs.repeater = undefined;
    } else {
        newTs.repeater = selected.label;
    }

    const date = new Date(ts.year, ts.month - 1, ts.day);
    const newTimestamp = formatTimestamp(newTs, date);

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            position.line, ts.start,
            position.line, ts.end
        );
        editBuilder.replace(range, newTimestamp);
    });
}

/**
 * Shift timestamp left (previous day), cycle TODO backward, or move table column left
 */
async function shiftTimestampLeft(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Check if in table first
    if (isInTable(document, position)) {
        const moved = await moveColumnLeft();
        if (moved) return;
    }

    // Check if on a heading - cycle TODO state backward
    const cycled = await cycleTodoState(false);
    if (cycled) return;

    const ts = findTimestampAtCursor(document, position);
    if (!ts) return;

    // Shift left decreases the day by 1
    const date = new Date(ts.year, ts.month - 1, ts.day);
    date.setDate(date.getDate() - 1);

    const newTimestamp = formatTimestamp(ts, date);

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            position.line, ts.start,
            position.line, ts.end
        );
        editBuilder.replace(range, newTimestamp);
    });
}

/**
 * Shift timestamp right (next day), cycle TODO forward, or move table column right
 */
async function shiftTimestampRight(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Check if in table first
    if (isInTable(document, position)) {
        const moved = await moveColumnRight();
        if (moved) return;
    }

    // Check if on a heading - cycle TODO state forward
    const cycled = await cycleTodoState(true);
    if (cycled) return;

    const ts = findTimestampAtCursor(document, position);
    if (!ts) return;

    // Shift right increases the day by 1
    const date = new Date(ts.year, ts.month - 1, ts.day);
    date.setDate(date.getDate() + 1);

    const newTimestamp = formatTimestamp(ts, date);

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            position.line, ts.start,
            position.line, ts.end
        );
        editBuilder.replace(range, newTimestamp);
    });
}

/**
 * Register timestamp commands
 */
export function registerTimestampCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.shiftTimestampUp', shiftTimestampUp),
        vscode.commands.registerCommand('scimax.org.shiftTimestampDown', shiftTimestampDown),
        vscode.commands.registerCommand('scimax.org.shiftTimestampLeft', shiftTimestampLeft),
        vscode.commands.registerCommand('scimax.org.shiftTimestampRight', shiftTimestampRight),
        vscode.commands.registerCommand('scimax.org.insertTimestamp', insertTimestamp),
        vscode.commands.registerCommand('scimax.org.addRepeater', addRepeater)
    );
}
