import * as vscode from 'vscode';
import { isInTable, moveRowUp, moveRowDown, moveColumnLeft, moveColumnRight } from './tableProvider';
import { updateStatisticsCookies } from './scimaxOrg';
import {
    advanceDateByRepeater,
    getDayOfWeek,
    REPEATER_TIMESTAMP_PATTERN,
    findRepeaterInLines,
} from '../parser/orgRepeater';

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
 * Priority states for cycling (A is highest, C is lowest, empty means no priority)
 */
const PRIORITY_STATES = ['', 'A', 'B', 'C'];

/**
 * Check if line has an org priority and return match info
 * Matches [#A], [#B], [#C] etc.
 */
function getOrgPriorityInfo(line: string): { priority: string; start: number; end: number } | null {
    const match = line.match(/\[#([A-Z])\]/);
    if (!match || match.index === undefined) return null;
    return {
        priority: match[1],
        start: match.index,
        end: match.index + match[0].length
    };
}

/**
 * Check if cursor is on a heading line (starts with * or #)
 */
function isOnHeadingLine(line: string): boolean {
    return /^(\*+|#{1,6})\s/.test(line);
}

/**
 * Cycle priority up (increase priority): C → B → A → (none) → C
 * In org-mode, A is highest priority, C is lowest
 */
function cyclePriorityUp(current: string): string {
    // Order for increasing priority: '' -> A -> B -> C -> ''
    // Wait, that's decreasing. Let me think again:
    // Up = increase = higher priority = A is higher than B is higher than C
    // So: C -> B -> A -> '' -> C
    const upOrder = ['C', 'B', 'A', ''];
    const idx = upOrder.indexOf(current);
    if (idx === -1) return 'A'; // Unknown, start with A (highest)
    return upOrder[(idx + 1) % upOrder.length];
}

/**
 * Cycle priority down (decrease priority): A → B → C → (none) → A
 */
function cyclePriorityDown(current: string): string {
    // Order for decreasing priority: A -> B -> C -> '' -> A
    const downOrder = ['A', 'B', 'C', ''];
    const idx = downOrder.indexOf(current);
    if (idx === -1) return 'C'; // Unknown, start with C (lowest)
    return downOrder[(idx + 1) % downOrder.length];
}

/**
 * Handle priority cycling on a heading line
 * Returns true if priority was cycled, false otherwise
 */
async function cyclePriorityOnHeading(
    editor: vscode.TextEditor,
    direction: 'up' | 'down'
): Promise<boolean> {
    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    // Only work on heading lines
    if (!isOnHeadingLine(line)) return false;

    const priorityInfo = getOrgPriorityInfo(line);
    const currentPriority = priorityInfo ? priorityInfo.priority : '';
    const newPriority = direction === 'up'
        ? cyclePriorityUp(currentPriority)
        : cyclePriorityDown(currentPriority);

    if (priorityInfo) {
        // Replace existing priority
        if (newPriority === '') {
            // Remove priority completely (including space after it if present)
            await editor.edit(editBuilder => {
                const range = new vscode.Range(
                    position.line, priorityInfo.start,
                    position.line, priorityInfo.end + (line[priorityInfo.end] === ' ' ? 1 : 0)
                );
                editBuilder.replace(range, '');
            });
        } else {
            // Change priority letter
            await editor.edit(editBuilder => {
                const range = new vscode.Range(
                    position.line, priorityInfo.start,
                    position.line, priorityInfo.end
                );
                editBuilder.replace(range, `[#${newPriority}]`);
            });
        }
    } else {
        // Add new priority after TODO keyword or after stars
        // Pattern: * TODO title -> * TODO [#A] title
        // Pattern: * title -> * [#A] title
        const headingMatch = line.match(/^(\*+)\s+(TODO|DONE|NEXT|WAITING|HOLD|SOMEDAY|CANCELLED|CANCELED)?\s*/);
        if (headingMatch) {
            const insertPos = headingMatch[0].length;
            await editor.edit(editBuilder => {
                editBuilder.insert(
                    new vscode.Position(position.line, insertPos),
                    `[#${newPriority}] `
                );
            });
        }
    }

    return true;
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
 * Find DEADLINE or SCHEDULED line with repeater for a heading
 * Wrapper around pure findRepeaterInLines for VS Code documents
 */
function findRepeaterTimestamp(
    document: vscode.TextDocument,
    headingLine: number
): { lineNumber: number; match: RegExpMatchArray; type: 'DEADLINE' | 'SCHEDULED' } | null {
    // Extract lines from document
    const lines: string[] = [];
    const endLine = Math.min(headingLine + 10, document.lineCount);
    for (let i = headingLine; i < endLine; i++) {
        lines.push(document.lineAt(i).text);
    }

    // Use pure function
    const result = findRepeaterInLines(lines, 0);
    if (!result) return null;

    return {
        lineNumber: headingLine + result.lineIndex,
        match: result.match,
        type: result.type
    };
}

/**
 * Cycle TODO state on heading
 * Handles repeating tasks: when transitioning to DONE with a repeater,
 * advances the timestamp and resets to TODO
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

    let newState = forward
        ? cycleTodoForward(headingInfo.todoState)
        : cycleTodoBackward(headingInfo.todoState);

    const prefix = isOrg
        ? '*'.repeat(headingInfo.level)
        : '#'.repeat(headingInfo.level);

    // Check for repeating task when transitioning to DONE
    let repeaterInfo: ReturnType<typeof findRepeaterTimestamp> = null;
    if (isOrg && newState === 'DONE') {
        repeaterInfo = findRepeaterTimestamp(document, position.line);
    }

    if (repeaterInfo) {
        // This is a repeating task - advance the timestamp and reset to TODO
        const match = repeaterInfo.match;
        const year = parseInt(match[3]);
        const month = parseInt(match[4]);
        const day = parseInt(match[5]);
        const hour = match[6] ? parseInt(match[6]) : undefined;
        const minute = match[7] ? parseInt(match[7]) : undefined;
        const repeater = match[8];

        // Advance the date
        const newDate = advanceDateByRepeater(year, month, day, repeater);
        const newYear = newDate.getFullYear();
        const newMonth = String(newDate.getMonth() + 1).padStart(2, '0');
        const newDay = String(newDate.getDate()).padStart(2, '0');
        const dow = getDayOfWeek(newDate);

        // Build new timestamp
        let newTimestamp = `<${newYear}-${newMonth}-${newDay} ${dow}`;
        if (hour !== undefined && minute !== undefined) {
            newTimestamp += ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        }
        newTimestamp += ` ${repeater}>`;

        // Build the new DEADLINE/SCHEDULED line
        const indent = match[1];
        const keyword = match[2];
        const newDeadlineLine = `${indent}${keyword}: ${newTimestamp}`;

        // Reset to TODO instead of DONE
        newState = 'TODO';
        const newLine = formatHeading(prefix, newState, headingInfo.rest);

        // Apply both edits
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
            editBuilder.replace(
                document.lineAt(repeaterInfo!.lineNumber).range,
                newDeadlineLine
            );
        });

        vscode.window.showInformationMessage(
            `Repeating task: ${keyword} shifted to ${newYear}-${newMonth}-${newDay}`
        );
    } else {
        // Normal TODO cycling
        const newLine = formatHeading(prefix, newState, headingInfo.rest);

        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });
    }

    // Update statistics cookies in parent headings (org-mode only)
    if (isOrg) {
        await updateStatisticsCookies(editor, position.line, headingInfo.level);
    }

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
 * Shift timestamp up (increment) or move table row up or cycle priority up
 */
async function shiftTimestampUp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Check if in table first - if in table, only handle table operations
    if (isInTable(document, position)) {
        await moveRowUp();
        return; // Always return if in table, even if move failed (don't fall through)
    }

    // Check if on a timestamp
    const ts = findTimestampAtCursor(document, position);
    if (ts) {
        // Timestamp found, adjust it
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
        return;
    }

    // Check if on a heading line - cycle priority
    const line = document.lineAt(position.line).text;
    if (isOnHeadingLine(line)) {
        const cycled = await cyclePriorityOnHeading(editor, 'up');
        if (cycled) return;
    }

    // No timestamp or heading found, fall back to default text selection
    await vscode.commands.executeCommand('cursorUpSelect');
}

/**
 * Shift timestamp down (decrement) or move table row down or cycle priority down
 */
async function shiftTimestampDown(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Check if in table first - if in table, only handle table operations
    if (isInTable(document, position)) {
        await moveRowDown();
        return; // Always return if in table, even if move failed (don't fall through)
    }

    // Check if on a timestamp
    const ts = findTimestampAtCursor(document, position);
    if (ts) {
        // Timestamp found, adjust it
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
        return;
    }

    // Check if on a heading line - cycle priority
    const line = document.lineAt(position.line).text;
    if (isOnHeadingLine(line)) {
        const cycled = await cyclePriorityOnHeading(editor, 'down');
        if (cycled) return;
    }

    // No timestamp or heading found, fall back to default text selection
    await vscode.commands.executeCommand('cursorDownSelect');
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
    if (!ts) {
        // Not on a timestamp, table, or heading - fall back to default text selection
        await vscode.commands.executeCommand('cursorLeftSelect');
        return;
    }

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
    if (!ts) {
        // Not on a timestamp, table, or heading - fall back to default text selection
        await vscode.commands.executeCommand('cursorRightSelect');
        return;
    }

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
