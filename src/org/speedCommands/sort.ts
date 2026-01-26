/**
 * Speed Command Sort Functions
 *
 * Implements org-sort-entries functionality for sorting headings.
 * Supports multiple sort keys like Emacs: alphabetic, numeric, timestamp,
 * deadline, scheduled, priority, TODO order, created, clocking, property.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { getTodoWorkflowForDocument } from '../todoStates';

/**
 * Represents a sortable entry (heading with its subtree)
 */
interface SortableEntry {
    /** Starting line number (0-indexed) */
    startLine: number;
    /** Ending line number (0-indexed, inclusive) */
    endLine: number;
    /** Heading level (number of * or #) */
    level: number;
    /** Full heading line text */
    text: string;
    /** Heading title without TODO/priority/tags */
    title: string;
    /** Full entry body text (for searching timestamps, etc.) */
    body: string;
    /** Computed sort key (set during sorting) */
    sortKey: string | number | Date | null;
}

/**
 * Sort scope information
 */
interface SortScope {
    /** Starting line to sort from */
    startLine: number;
    /** Ending line to sort to */
    endLine: number;
    /** Level of entries to sort */
    level: number;
}

/**
 * Available sort type definitions
 */
const SORT_TYPES = [
    { label: 'a', description: 'Alphabetically' },
    { label: 'A', description: 'Alphabetically (reverse)' },
    { label: 'n', description: 'Numerically' },
    { label: 'N', description: 'Numerically (reverse)' },
    { label: 't', description: 'By timestamp' },
    { label: 'T', description: 'By timestamp (reverse)' },
    { label: 'd', description: 'By deadline' },
    { label: 'D', description: 'By deadline (reverse)' },
    { label: 's', description: 'By scheduled' },
    { label: 'S', description: 'By scheduled (reverse)' },
    { label: 'p', description: 'By priority' },
    { label: 'P', description: 'By priority (reverse)' },
    { label: 'o', description: 'By TODO order' },
    { label: 'O', description: 'By TODO order (reverse)' },
    { label: 'c', description: 'By creation time' },
    { label: 'C', description: 'By creation time (reverse)' },
    { label: 'k', description: 'By clocking time' },
    { label: 'K', description: 'By clocking time (reverse)' },
    { label: 'r', description: 'By property...' },
    { label: 'R', description: 'By property... (reverse)' },
];

/**
 * Parse an org-mode date string to Date object
 * Handles formats like: 2024-01-15, 2024-01-15 Mon, 2024-01-15 Mon 10:30
 */
function parseOrgDate(dateStr: string): Date | null {
    // Extract date part: YYYY-MM-DD
    const dateMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!dateMatch) {
        return null;
    }

    const [, year, month, day] = dateMatch;

    // Extract optional time: HH:MM
    const timeMatch = dateStr.match(/(\d{2}):(\d{2})/);
    const hour = timeMatch ? parseInt(timeMatch[1]) : 0;
    const minute = timeMatch ? parseInt(timeMatch[2]) : 0;

    return new Date(
        parseInt(year),
        parseInt(month) - 1, // JS months are 0-indexed
        parseInt(day),
        hour,
        minute
    );
}

/**
 * Extract the title from a heading, removing TODO state, priority, and tags
 */
function extractTitle(headingText: string, isOrg: boolean): string {
    let title = headingText;

    if (isOrg) {
        // Remove leading stars and space
        title = title.replace(/^\*+\s+/, '');
    } else {
        // Remove leading # and space
        title = title.replace(/^#+\s+/, '');
    }

    // Remove TODO state (common keywords)
    title = title.replace(/^(TODO|DONE|NEXT|WAIT|WAITING|CANCELLED|CANCELED|IN-PROGRESS|HOLD|SOMEDAY)\s+/, '');

    // Remove priority [#A], [#B], [#C]
    title = title.replace(/^\[#[A-Z]\]\s*/, '');

    // Remove trailing tags :tag1:tag2:
    title = title.replace(/\s+:[^\s:]+(?::[^\s:]+)*:\s*$/, '');

    return title.trim();
}

/**
 * Get sort key based on sort type
 */
function getSortKey(
    entry: SortableEntry,
    sortType: string,
    propertyName?: string,
    todoSequence?: string[]
): string | number | Date | null {
    const type = sortType.toLowerCase();

    switch (type) {
        case 'a': { // Alphabetic
            return entry.title.toLowerCase();
        }

        case 'n': { // Numeric - extract leading number from title
            const match = entry.title.match(/^(\d+)/);
            return match ? parseInt(match[1]) : Infinity;
        }

        case 't': { // Timestamp - first active timestamp, fallback to inactive
            // Active timestamp: <2024-01-15 Mon>
            const activeMatch = entry.body.match(/<(\d{4}-\d{2}-\d{2}[^>]*)>/);
            if (activeMatch) {
                return parseOrgDate(activeMatch[1]);
            }
            // Inactive timestamp: [2024-01-15 Mon]
            const inactiveMatch = entry.body.match(/\[(\d{4}-\d{2}-\d{2}[^\]]*)\]/);
            if (inactiveMatch) {
                return parseOrgDate(inactiveMatch[1]);
            }
            return null;
        }

        case 'd': { // Deadline
            const match = entry.body.match(/DEADLINE:\s*<([^>]+)>/);
            return match ? parseOrgDate(match[1]) : null;
        }

        case 's': { // Scheduled
            const match = entry.body.match(/SCHEDULED:\s*<([^>]+)>/);
            return match ? parseOrgDate(match[1]) : null;
        }

        case 'p': { // Priority - [#A]=1, [#B]=2, [#C]=3, none=4
            const match = entry.text.match(/\[#([A-Z])\]/);
            if (match) {
                return match[1].charCodeAt(0) - 64; // A=1, B=2, C=3, etc.
            }
            return 100; // No priority sorts to end
        }

        case 'o': { // TODO order - by position in TODO sequence
            if (!todoSequence) {
                return Infinity;
            }
            // Extract TODO state from heading
            const headingContent = entry.text.replace(/^\*+\s+/, '').replace(/^#+\s+/, '');
            const todoMatch = headingContent.match(/^(\S+)\s/);
            if (todoMatch) {
                const state = todoMatch[1];
                const index = todoSequence.indexOf(state);
                if (index >= 0) {
                    return index;
                }
            }
            return Infinity; // No TODO state sorts to end
        }

        case 'c': { // Created - first inactive timestamp at start of a line
            // Look for timestamp at beginning of line (common org convention for creation)
            const match = entry.body.match(/^[\t ]*\[(\d{4}-\d{2}-\d{2}[^\]]*)\]/m);
            return match ? parseOrgDate(match[1]) : null;
        }

        case 'k': { // Clocking - total clocked time in minutes
            // Sum all CLOCK entries: CLOCK: [time]--[time] => H:MM
            const clockRegex = /CLOCK:.*=>\s*(\d+):(\d+)/g;
            let totalMinutes = 0;
            let clockMatch;
            while ((clockMatch = clockRegex.exec(entry.body)) !== null) {
                const hours = parseInt(clockMatch[1]);
                const minutes = parseInt(clockMatch[2]);
                totalMinutes += hours * 60 + minutes;
            }
            return totalMinutes > 0 ? totalMinutes : null;
        }

        case 'r': { // Property - extract property value
            if (!propertyName) {
                return null;
            }
            // Look in :PROPERTIES: drawer
            const propRegex = new RegExp(`:${propertyName}:\\s*(.+)`, 'i');
            const match = entry.body.match(propRegex);
            return match ? match[1].trim() : null;
        }

        default:
            return null;
    }
}

/**
 * Compare two sort keys
 */
function compareSortKeys(
    a: string | number | Date | null,
    b: string | number | Date | null,
    reverse: boolean
): number {
    // Null values sort to end
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;

    let result: number;

    if (a instanceof Date && b instanceof Date) {
        result = a.getTime() - b.getTime();
    } else if (typeof a === 'number' && typeof b === 'number') {
        result = a - b;
    } else {
        // String comparison
        result = String(a).localeCompare(String(b));
    }

    return reverse ? -result : result;
}

/**
 * Determine the sort scope based on cursor position and selection
 */
function determineSortScope(
    editor: vscode.TextEditor,
    document: vscode.TextDocument
): SortScope | null {
    const selection = editor.selection;
    const position = selection.active;
    const isOrg = document.languageId === 'org';
    const headingPattern = isOrg ? /^\*+\s/ : /^#+\s/;

    // Case 1: Active selection - sort entries within selection
    if (!selection.isEmpty) {
        const startLine = selection.start.line;
        const endLine = selection.end.line;

        // Find the level of first heading in selection
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            if (headingPattern.test(line)) {
                const level = getHeadingLevel(document, i);
                return { startLine, endLine, level };
            }
        }
        return null; // No headings in selection
    }

    const currentLevel = getHeadingLevel(document, position.line);

    // Case 2: Cursor on a heading - sort children of this heading
    if (currentLevel > 0) {
        // Find all direct children (headings at level+1)
        const childLevel = currentLevel + 1;
        let firstChildLine = -1;
        let lastChildEndLine = -1;

        for (let i = position.line + 1; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            const level = getHeadingLevel(document, i);

            if (level > 0) {
                if (level <= currentLevel) {
                    // Hit a sibling or parent, stop
                    break;
                }
                if (level === childLevel) {
                    if (firstChildLine < 0) {
                        firstChildLine = i;
                    }
                    // Find end of this child's subtree
                    let childEnd = i;
                    for (let j = i + 1; j < document.lineCount; j++) {
                        const nextLevel = getHeadingLevel(document, j);
                        if (nextLevel > 0 && nextLevel <= childLevel) {
                            break;
                        }
                        childEnd = j;
                    }
                    lastChildEndLine = childEnd;
                }
            }
        }

        if (firstChildLine >= 0) {
            return { startLine: firstChildLine, endLine: lastChildEndLine, level: childLevel };
        }
        return null; // No children to sort
    }

    // Case 3: Cursor before first heading - sort top-level entries
    // Find if we're before the first heading
    let firstHeadingLine = -1;
    for (let i = 0; i < document.lineCount; i++) {
        if (getHeadingLevel(document, i) > 0) {
            firstHeadingLine = i;
            break;
        }
    }

    if (firstHeadingLine < 0) {
        return null; // No headings in document
    }

    if (position.line < firstHeadingLine) {
        // Sort all top-level headings
        const topLevel = getHeadingLevel(document, firstHeadingLine);
        return { startLine: firstHeadingLine, endLine: document.lineCount - 1, level: topLevel };
    }

    // Cursor is in document body (not on heading) - find parent and sort its children
    for (let i = position.line - 1; i >= 0; i--) {
        const level = getHeadingLevel(document, i);
        if (level > 0) {
            // Found parent heading, sort its children
            const childLevel = level + 1;
            let firstChildLine = -1;
            let lastChildEndLine = -1;

            for (let j = i + 1; j < document.lineCount; j++) {
                const lineLevel = getHeadingLevel(document, j);
                if (lineLevel > 0) {
                    if (lineLevel <= level) {
                        break;
                    }
                    if (lineLevel === childLevel) {
                        if (firstChildLine < 0) {
                            firstChildLine = j;
                        }
                        let childEnd = j;
                        for (let k = j + 1; k < document.lineCount; k++) {
                            const nextLevel = getHeadingLevel(document, k);
                            if (nextLevel > 0 && nextLevel <= childLevel) {
                                break;
                            }
                            childEnd = k;
                        }
                        lastChildEndLine = childEnd;
                    }
                }
            }

            if (firstChildLine >= 0) {
                return { startLine: firstChildLine, endLine: lastChildEndLine, level: childLevel };
            }
            return null;
        }
    }

    // Default: sort top-level headings
    if (firstHeadingLine >= 0) {
        const topLevel = getHeadingLevel(document, firstHeadingLine);
        return { startLine: firstHeadingLine, endLine: document.lineCount - 1, level: topLevel };
    }

    return null;
}

/**
 * Parse entries within the scope into sortable units
 */
function parseEntries(
    document: vscode.TextDocument,
    scope: SortScope
): SortableEntry[] {
    const entries: SortableEntry[] = [];
    const isOrg = document.languageId === 'org';
    let i = scope.startLine;

    while (i <= scope.endLine) {
        const level = getHeadingLevel(document, i);

        if (level === scope.level) {
            // Found an entry at the target level
            const startLine = i;
            const headingText = document.lineAt(i).text;
            let endLine = i;

            // Find the end of this entry's subtree
            for (let j = i + 1; j <= scope.endLine; j++) {
                const nextLevel = getHeadingLevel(document, j);
                if (nextLevel > 0 && nextLevel <= scope.level) {
                    break;
                }
                endLine = j;
            }

            // Get the full body text
            const bodyLines: string[] = [];
            for (let j = startLine; j <= endLine; j++) {
                bodyLines.push(document.lineAt(j).text);
            }
            const body = bodyLines.join('\n');

            entries.push({
                startLine,
                endLine,
                level,
                text: headingText,
                title: extractTitle(headingText, isOrg),
                body,
                sortKey: null
            });

            i = endLine + 1;
        } else {
            i++;
        }
    }

    return entries;
}

/**
 * Main sort function - shows picker and executes sort
 */
export async function orgSort(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const document = editor.document;

    // Determine sort scope
    const scope = determineSortScope(editor, document);
    if (!scope) {
        vscode.window.showInformationMessage('No entries to sort at this location');
        return;
    }

    // Parse entries
    const entries = parseEntries(document, scope);
    if (entries.length < 2) {
        vscode.window.showInformationMessage('Need at least 2 entries to sort');
        return;
    }

    // Show sort type picker
    const items = SORT_TYPES.map(t => ({
        label: t.label,
        description: t.description
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Sort ${entries.length} entries by...`,
        matchOnDescription: true
    });

    if (!selected) {
        return; // Cancelled
    }

    const sortType = selected.label;
    const reverse = sortType === sortType.toUpperCase();

    // For property sorting, prompt for property name
    let propertyName: string | undefined;
    if (sortType.toLowerCase() === 'r') {
        propertyName = await vscode.window.showInputBox({
            prompt: 'Enter property name to sort by',
            placeHolder: 'e.g., EFFORT, PRIORITY, etc.'
        });
        if (!propertyName) {
            return; // Cancelled
        }
    }

    // Get TODO sequence for TODO order sorting
    const todoSequence = sortType.toLowerCase() === 'o'
        ? getTodoWorkflowForDocument(document).allStates
        : undefined;

    // Compute sort keys
    for (const entry of entries) {
        entry.sortKey = getSortKey(entry, sortType, propertyName, todoSequence);
    }

    // Sort entries (stable sort to preserve original order for equal keys)
    const sortedEntries = [...entries].sort((a, b) => {
        return compareSortKeys(a.sortKey, b.sortKey, reverse);
    });

    // Check if order changed
    let orderChanged = false;
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].startLine !== sortedEntries[i].startLine) {
            orderChanged = true;
            break;
        }
    }

    if (!orderChanged) {
        vscode.window.showInformationMessage('Entries already in sorted order');
        return;
    }

    // Build new content
    const newLines: string[] = [];
    for (const entry of sortedEntries) {
        for (let i = entry.startLine; i <= entry.endLine; i++) {
            newLines.push(document.lineAt(i).text);
        }
    }

    // Replace the sorted region
    const startPos = new vscode.Position(scope.startLine, 0);
    const lastEntry = entries[entries.length - 1];
    const endPos = new vscode.Position(
        lastEntry.endLine,
        document.lineAt(lastEntry.endLine).text.length
    );
    const range = new vscode.Range(startPos, endPos);

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newLines.join('\n'));
    });

    vscode.window.showInformationMessage(`Sorted ${entries.length} entries`);
}
