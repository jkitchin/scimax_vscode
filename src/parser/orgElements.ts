/**
 * Parser for org-mode block-level elements
 * Handles tables, planning lines, clock entries, drawers, lists, etc.
 */

import type {
    OrgRange,
    TableElement,
    TableRowElement,
    TableCellObject,
    PlanningElement,
    ClockElement,
    TimestampObject,
    PlainListElement,
    ItemElement,
    OrgElement,
    OrgObject,
    DrawerElement,
    PropertyDrawerElement,
    NodePropertyElement,
    KeywordElement,
    HorizontalRuleElement,
    ParagraphElement,
    FixedWidthElement,
    CommentElement,
} from './orgElementTypes';
import { parseObjects } from './orgObjects';

// =============================================================================
// Table Parser
// =============================================================================

/**
 * Options for table parsing
 */
export interface TableParseOptions {
    /** Base offset in the document */
    baseOffset?: number;
    /** Parse cell contents as objects */
    parseCellContents?: boolean;
}

/**
 * Parse an org-mode table from lines
 *
 * @param lines - Array of table lines (including the | characters)
 * @param startLine - Starting line number (0-indexed)
 * @param options - Parsing options
 * @returns Parsed TableElement
 */
export function parseTable(
    lines: string[],
    startLine: number,
    options: TableParseOptions = {}
): TableElement {
    const { baseOffset = 0, parseCellContents = true } = options;
    const rows: TableRowElement[] = [];

    let charOffset = baseOffset;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = charOffset;
        const lineEnd = charOffset + line.length;

        const row = parseTableRow(line, startLine + i, lineStart, parseCellContents);
        rows.push(row);

        charOffset = lineEnd + 1; // +1 for newline
    }

    // Determine table type (org vs table.el)
    // table.el tables have + characters at intersections
    const isTableEl = lines.some(line => /^\s*\+[-+]+\+\s*$/.test(line));

    return {
        type: 'table',
        range: { start: baseOffset, end: charOffset - 1 },
        postBlank: 0,
        properties: {
            tableType: isTableEl ? 'table.el' : 'org',
            value: isTableEl ? lines.join('\n') : undefined,
        },
        children: rows,
    };
}

/**
 * Parse a single table row
 */
function parseTableRow(
    line: string,
    lineNumber: number,
    charOffset: number,
    parseCellContents: boolean
): TableRowElement {
    const trimmed = line.trim();

    // Check for rule row (horizontal separator)
    if (/^\|[-+]+\|$/.test(trimmed) || /^\|-/.test(trimmed)) {
        return {
            type: 'table-row',
            range: { start: charOffset, end: charOffset + line.length },
            postBlank: 0,
            properties: { rowType: 'rule' },
            children: [],
        };
    }

    // Parse data row
    const cells: TableCellObject[] = [];

    // Split by | and extract cell contents
    // Handle the leading and trailing |
    const cellMatch = trimmed.match(/^\|(.+)\|$/);
    if (cellMatch) {
        const cellsStr = cellMatch[1];
        const cellValues = cellsStr.split('|');

        let cellOffset = charOffset + line.indexOf('|') + 1;

        for (const cellValue of cellValues) {
            const value = cellValue.trim();
            const cellStart = cellOffset;
            const cellEnd = cellOffset + cellValue.length;

            const cell: TableCellObject = {
                type: 'table-cell',
                range: { start: cellStart, end: cellEnd },
                postBlank: 0,
                properties: { value },
            };

            // Parse cell contents as objects if enabled
            if (parseCellContents && value) {
                cell.children = parseObjects(value, { baseOffset: cellStart });
            }

            cells.push(cell);
            cellOffset = cellEnd + 1; // +1 for the | separator
        }
    }

    return {
        type: 'table-row',
        range: { start: charOffset, end: charOffset + line.length },
        postBlank: 0,
        properties: { rowType: 'standard' },
        children: cells,
    };
}

/**
 * Extract column alignments from a table
 * Returns array of 'l', 'c', 'r', or undefined for each column
 */
export function getTableAlignments(table: TableElement): (string | undefined)[] {
    // Look for alignment cookies in cells: <l>, <c>, <r>, <l10>, etc.
    const alignments: (string | undefined)[] = [];

    for (const row of table.children) {
        if (row.properties.rowType !== 'standard') continue;

        for (let i = 0; i < row.children.length; i++) {
            const cell = row.children[i];
            const value = cell.properties.value;

            // Check for alignment cookie
            const alignMatch = value.match(/^<([lcr])(\d*)>$/);
            if (alignMatch) {
                alignments[i] = alignMatch[1];
            }
        }
    }

    return alignments;
}

/**
 * Check if a line starts a table
 */
export function isTableLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('|') || /^\s*\+[-+]+\+\s*$/.test(trimmed);
}

// =============================================================================
// Planning Line Parser
// =============================================================================

/**
 * Parse a planning line (SCHEDULED, DEADLINE, CLOSED)
 *
 * @param line - The planning line text
 * @param lineNumber - Line number (0-indexed)
 * @param charOffset - Character offset in document
 * @returns Parsed PlanningElement or null
 */
export function parsePlanningLine(
    line: string,
    lineNumber: number,
    charOffset: number
): PlanningElement | null {
    const trimmed = line.trim();

    // Planning line pattern
    const planningPattern = /^(SCHEDULED:|DEADLINE:|CLOSED:)\s*(<[^>]+>|\[[^\]]+\])/g;

    let scheduled: TimestampObject | undefined;
    let deadline: TimestampObject | undefined;
    let closed: TimestampObject | undefined;

    let match;
    let foundAny = false;

    // Reset lastIndex for global regex
    planningPattern.lastIndex = 0;

    // Try each keyword
    const schedMatch = trimmed.match(/SCHEDULED:\s*(<[^>]+>|\[[^\]]+\])/);
    if (schedMatch) {
        const ts = parseTimestampString(schedMatch[1], charOffset + trimmed.indexOf(schedMatch[0]));
        if (ts) {
            scheduled = ts;
            foundAny = true;
        }
    }

    const deadMatch = trimmed.match(/DEADLINE:\s*(<[^>]+>|\[[^\]]+\])/);
    if (deadMatch) {
        const ts = parseTimestampString(deadMatch[1], charOffset + trimmed.indexOf(deadMatch[0]));
        if (ts) {
            deadline = ts;
            foundAny = true;
        }
    }

    const closedMatch = trimmed.match(/CLOSED:\s*(\[[^\]]+\])/);
    if (closedMatch) {
        const ts = parseTimestampString(closedMatch[1], charOffset + trimmed.indexOf(closedMatch[0]));
        if (ts) {
            closed = ts;
            foundAny = true;
        }
    }

    if (!foundAny) {
        return null;
    }

    return {
        type: 'planning',
        range: { start: charOffset, end: charOffset + line.length },
        postBlank: 0,
        properties: {
            scheduled,
            deadline,
            closed,
        },
    };
}

/**
 * Check if a line is a planning line
 */
export function isPlanningLine(line: string): boolean {
    const trimmed = line.trim();
    return /^(SCHEDULED:|DEADLINE:|CLOSED:)/.test(trimmed);
}

// =============================================================================
// Clock Entry Parser
// =============================================================================

/**
 * Parse a CLOCK entry line
 *
 * @param line - The clock line text
 * @param lineNumber - Line number (0-indexed)
 * @param charOffset - Character offset in document
 * @returns Parsed ClockElement or null
 */
export function parseClockLine(
    line: string,
    lineNumber: number,
    charOffset: number
): ClockElement | null {
    const trimmed = line.trim();

    // CLOCK: [timestamp]--[timestamp] => duration
    // or CLOCK: [timestamp] (running)
    const clockPattern = /^CLOCK:\s*(\[[^\]]+\])(?:--(\[[^\]]+\]))?\s*(?:=>\s*(\d+:\d+))?/;
    const match = trimmed.match(clockPattern);

    if (!match) {
        return null;
    }

    const startTs = parseTimestampString(match[1], charOffset + trimmed.indexOf(match[1]));
    if (!startTs) {
        return null;
    }

    let endTs: TimestampObject | undefined;
    let duration: string | undefined;
    let status: 'running' | 'closed' = 'running';

    if (match[2]) {
        endTs = parseTimestampString(match[2], charOffset + trimmed.indexOf(match[2])) ?? undefined;
        status = 'closed';
    }

    if (match[3]) {
        duration = match[3];
    }

    return {
        type: 'clock',
        range: { start: charOffset, end: charOffset + line.length },
        postBlank: 0,
        properties: {
            start: startTs,
            end: endTs,
            duration,
            status,
        },
    };
}

/**
 * Check if a line is a clock line
 */
export function isClockLine(line: string): boolean {
    return line.trim().startsWith('CLOCK:');
}

// =============================================================================
// Timestamp Parser Helper
// =============================================================================

/**
 * Parse a timestamp string into a TimestampObject
 */
function parseTimestampString(tsStr: string, charOffset: number): TimestampObject | null {
    const isActive = tsStr.startsWith('<');
    const inner = tsStr.slice(1, -1); // Remove brackets

    // Parse: YYYY-MM-DD DAY HH:MM[-HH:MM] [REPEATER] [WARNING]
    const pattern = /^(\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2})(?:-(\d{2}):(\d{2}))?)?(?:\s+([.+]?\+\d+[hdwmy]))?(?:\s+(-{1,2}\d+[hdwmy]))?$/;
    const match = inner.match(pattern);

    if (!match) {
        return null;
    }

    const [
        ,
        yearStr, monthStr, dayStr,
        hourStartStr, minuteStartStr,
        hourEndStr, minuteEndStr,
        repeaterStr, warningStr,
    ] = match;

    const properties: TimestampObject['properties'] = {
        timestampType: isActive ? 'active' : 'inactive',
        rawValue: tsStr,
        yearStart: parseInt(yearStr, 10),
        monthStart: parseInt(monthStr, 10),
        dayStart: parseInt(dayStr, 10),
    };

    if (hourStartStr) {
        properties.hourStart = parseInt(hourStartStr, 10);
        properties.minuteStart = parseInt(minuteStartStr, 10);
    }

    if (hourEndStr) {
        properties.hourEnd = parseInt(hourEndStr, 10);
        properties.minuteEnd = parseInt(minuteEndStr, 10);
    }

    // Parse repeater
    if (repeaterStr) {
        const repMatch = repeaterStr.match(/^([.+]?\+)(\d+)([hdwmy])$/);
        if (repMatch) {
            properties.repeaterType = repMatch[1] as '+' | '++' | '.+';
            properties.repeaterValue = parseInt(repMatch[2], 10);
            properties.repeaterUnit = repMatch[3] as 'h' | 'd' | 'w' | 'm' | 'y';
        }
    }

    // Parse warning
    if (warningStr) {
        const warnMatch = warningStr.match(/^(-{1,2})(\d+)([hdwmy])$/);
        if (warnMatch) {
            properties.warningType = warnMatch[1] as '-' | '--';
            properties.warningValue = parseInt(warnMatch[2], 10);
            properties.warningUnit = warnMatch[3] as 'h' | 'd' | 'w' | 'm' | 'y';
        }
    }

    return {
        type: 'timestamp',
        range: { start: charOffset, end: charOffset + tsStr.length },
        postBlank: 0,
        properties,
    };
}

// =============================================================================
// Drawer Parser
// =============================================================================

/**
 * Parse a drawer block
 *
 * @param lines - Lines including :DRAWER: and :END:
 * @param startLine - Starting line number
 * @param charOffset - Character offset
 * @returns Parsed DrawerElement or null
 */
export function parseDrawer(
    lines: string[],
    startLine: number,
    charOffset: number
): DrawerElement | null {
    if (lines.length < 2) return null;

    const firstLine = lines[0].trim();
    const drawerMatch = firstLine.match(/^:(\w+):$/);

    if (!drawerMatch) return null;

    const drawerName = drawerMatch[1];
    const lastLine = lines[lines.length - 1].trim();

    if (lastLine !== ':END:') return null;

    // Calculate total length
    let totalLength = 0;
    for (const line of lines) {
        totalLength += line.length + 1; // +1 for newline
    }

    return {
        type: 'drawer',
        range: { start: charOffset, end: charOffset + totalLength - 1 },
        postBlank: 0,
        properties: { name: drawerName },
        children: [], // Content parsing would go here
    };
}

/**
 * Parse a properties drawer specifically
 */
export function parsePropertiesDrawer(
    lines: string[],
    startLine: number,
    charOffset: number
): PropertyDrawerElement | null {
    if (lines.length < 2) return null;

    const firstLine = lines[0].trim();
    if (firstLine !== ':PROPERTIES:') return null;

    const lastLine = lines[lines.length - 1].trim();
    if (lastLine !== ':END:') return null;

    const properties: NodePropertyElement[] = [];
    let offset = charOffset + lines[0].length + 1;

    for (let i = 1; i < lines.length - 1; i++) {
        const line = lines[i];
        const propMatch = line.trim().match(/^:(\S+):\s*(.*)$/);

        if (propMatch) {
            properties.push({
                type: 'node-property',
                range: { start: offset, end: offset + line.length },
                postBlank: 0,
                properties: {
                    key: propMatch[1],
                    value: propMatch[2],
                },
            });
        }

        offset += line.length + 1;
    }

    // Calculate total length
    let totalLength = 0;
    for (const line of lines) {
        totalLength += line.length + 1;
    }

    return {
        type: 'property-drawer',
        range: { start: charOffset, end: charOffset + totalLength - 1 },
        postBlank: 0,
        children: properties,
    };
}

/**
 * Check if a line starts a drawer
 */
export function isDrawerStart(line: string): boolean {
    return /^\s*:\w+:\s*$/.test(line);
}

/**
 * Check if a line ends a drawer
 */
export function isDrawerEnd(line: string): boolean {
    return line.trim() === ':END:';
}

// =============================================================================
// List Parser
// =============================================================================

/**
 * List item bullet patterns
 */
const UNORDERED_BULLET_PATTERN = /^(\s*)([-+*])\s+/;
const ORDERED_BULLET_PATTERN = /^(\s*)(\d+[.)])\s+/;
const DESCRIPTIVE_PATTERN = /^(\s*)([-+*])\s+(.+?)\s*::\s*/;

/**
 * Parse a plain list from lines
 */
export function parseList(
    lines: string[],
    startLine: number,
    charOffset: number
): PlainListElement | null {
    if (lines.length === 0) return null;

    const firstLine = lines[0];
    let listType: 'ordered' | 'unordered' | 'descriptive';

    if (DESCRIPTIVE_PATTERN.test(firstLine)) {
        listType = 'descriptive';
    } else if (ORDERED_BULLET_PATTERN.test(firstLine)) {
        listType = 'ordered';
    } else if (UNORDERED_BULLET_PATTERN.test(firstLine)) {
        listType = 'unordered';
    } else {
        return null;
    }

    const items: ItemElement[] = [];
    let currentItemLines: string[] = [];
    let currentItemStart = charOffset;
    let baseIndent = -1;
    let offset = charOffset;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const bulletMatch = line.match(UNORDERED_BULLET_PATTERN) ||
                           line.match(ORDERED_BULLET_PATTERN);

        if (bulletMatch) {
            const indent = bulletMatch[1].length;

            if (baseIndent === -1) {
                baseIndent = indent;
            }

            // New item at same level
            if (indent === baseIndent) {
                // Save previous item
                if (currentItemLines.length > 0) {
                    const item = parseListItem(currentItemLines, listType, currentItemStart);
                    if (item) items.push(item);
                }
                currentItemLines = [line];
                currentItemStart = offset;
            } else {
                // Continuation or nested
                currentItemLines.push(line);
            }
        } else {
            // Continuation line
            currentItemLines.push(line);
        }

        offset += line.length + 1;
    }

    // Don't forget the last item
    if (currentItemLines.length > 0) {
        const item = parseListItem(currentItemLines, listType, currentItemStart);
        if (item) items.push(item);
    }

    if (items.length === 0) return null;

    return {
        type: 'plain-list',
        range: { start: charOffset, end: offset - 1 },
        postBlank: 0,
        properties: { listType },
        children: items,
    };
}

/**
 * Parse a single list item
 */
function parseListItem(
    lines: string[],
    listType: 'ordered' | 'unordered' | 'descriptive',
    charOffset: number
): ItemElement | null {
    if (lines.length === 0) return null;

    const firstLine = lines[0];
    let bullet: string;
    let checkbox: 'on' | 'off' | 'trans' | undefined;
    let tag: OrgObject[] | undefined;
    let contentStart: number;

    // Parse bullet
    const bulletMatch = firstLine.match(UNORDERED_BULLET_PATTERN) ||
                       firstLine.match(ORDERED_BULLET_PATTERN);

    if (!bulletMatch) return null;

    bullet = bulletMatch[2];
    contentStart = bulletMatch[0].length;

    // Check for checkbox [ ], [X], [-]
    const afterBullet = firstLine.slice(bulletMatch[0].length);
    const checkboxMatch = afterBullet.match(/^\[([X \-])\]\s*/);

    if (checkboxMatch) {
        const checkChar = checkboxMatch[1];
        checkbox = checkChar === 'X' ? 'on' : checkChar === '-' ? 'trans' : 'off';
        contentStart += checkboxMatch[0].length;
    }

    // Check for descriptive tag
    if (listType === 'descriptive') {
        const tagMatch = firstLine.match(/^(\s*[-+*]\s+)(.+?)\s*::\s*/);
        if (tagMatch) {
            const tagText = tagMatch[2];
            tag = parseObjects(tagText, { baseOffset: charOffset + tagMatch[1].length });
            contentStart = tagMatch[0].length;
        }
    }

    // Calculate total length
    let totalLength = 0;
    for (const line of lines) {
        totalLength += line.length + 1;
    }

    // Parse content as paragraph(s)
    const contentLines = [firstLine.slice(contentStart), ...lines.slice(1)];
    const content = contentLines.join('\n').trim();

    const children: OrgElement[] = [];
    if (content) {
        children.push({
            type: 'paragraph',
            range: { start: charOffset + contentStart, end: charOffset + totalLength - 1 },
            postBlank: 0,
            children: parseObjects(content, { baseOffset: charOffset + contentStart }),
        } as ParagraphElement);
    }

    return {
        type: 'item',
        range: { start: charOffset, end: charOffset + totalLength - 1 },
        postBlank: 0,
        properties: {
            bullet,
            checkbox,
            tag,
        },
        children,
    };
}

/**
 * Check if a line starts a list item
 */
export function isListItemLine(line: string): boolean {
    return UNORDERED_BULLET_PATTERN.test(line) || ORDERED_BULLET_PATTERN.test(line);
}

// =============================================================================
// Other Element Parsers
// =============================================================================

/**
 * Parse a keyword line (#+KEY: value)
 */
export function parseKeyword(
    line: string,
    lineNumber: number,
    charOffset: number
): KeywordElement | null {
    const match = line.match(/^#\+(\w+):\s*(.*)$/);
    if (!match) return null;

    return {
        type: 'keyword',
        range: { start: charOffset, end: charOffset + line.length },
        postBlank: 0,
        properties: {
            key: match[1].toUpperCase(),
            value: match[2],
        },
    };
}

/**
 * Parse a horizontal rule (5+ dashes)
 */
export function parseHorizontalRule(
    line: string,
    lineNumber: number,
    charOffset: number
): HorizontalRuleElement | null {
    if (!/^\s*-{5,}\s*$/.test(line)) return null;

    return {
        type: 'horizontal-rule',
        range: { start: charOffset, end: charOffset + line.length },
        postBlank: 0,
    };
}

/**
 * Parse fixed-width lines (: prefix)
 */
export function parseFixedWidth(
    lines: string[],
    startLine: number,
    charOffset: number
): FixedWidthElement | null {
    if (lines.length === 0) return null;

    const contentLines: string[] = [];

    for (const line of lines) {
        const match = line.match(/^:\s?(.*)$/);
        if (match) {
            contentLines.push(match[1]);
        }
    }

    if (contentLines.length === 0) return null;

    let totalLength = 0;
    for (const line of lines) {
        totalLength += line.length + 1;
    }

    return {
        type: 'fixed-width',
        range: { start: charOffset, end: charOffset + totalLength - 1 },
        postBlank: 0,
        properties: {
            value: contentLines.join('\n'),
        },
    };
}

/**
 * Check if a line is a fixed-width line
 */
export function isFixedWidthLine(line: string): boolean {
    return /^:\s/.test(line) || line === ':';
}

/**
 * Parse a comment line (# prefix, not #+)
 */
export function parseComment(
    line: string,
    lineNumber: number,
    charOffset: number
): CommentElement | null {
    const match = line.match(/^#\s+(.*)$|^#$/);
    if (!match) return null;

    return {
        type: 'comment',
        range: { start: charOffset, end: charOffset + line.length },
        postBlank: 0,
        properties: {
            value: match[1] || '',
        },
    };
}

/**
 * Check if a line is a comment line
 */
export function isCommentLine(line: string): boolean {
    return /^#(\s|$)/.test(line) && !line.startsWith('#+');
}

// =============================================================================
// Exports
// =============================================================================

export {
    parseTimestampString,
};
