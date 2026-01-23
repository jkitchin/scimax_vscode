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
// Pre-compiled Regex Patterns (Performance Optimization)
// =============================================================================

// Table patterns
const RE_TABLE_EL_LINE = /^\s*\+[-+]+\+\s*$/;
const RE_TABLE_RULE_FULL = /^\|[-+]+\|$/;
const RE_TABLE_RULE_START = /^\|-/;
const RE_TABLE_CELLS = /^\|(.+)\|$/;
const RE_ALIGNMENT_COOKIE = /^<([lcr])(\d*)>$/;

// List patterns - pre-compiled for performance
const RE_UNORDERED_BULLET = /^(\s*)([-+*])\s+/;
const RE_ORDERED_BULLET = /^(\s*)(\d+[.)])\s+/;
const RE_DESCRIPTIVE = /^(\s*)([-+*])\s+(.+?)\s*::\s*/;
const RE_CHECKBOX = /^\[([X \-])\]\s*/;
const RE_DESCRIPTIVE_TAG = /^(\s*[-+*]\s+)(.+?)\s*::\s*/;

// Planning patterns
const RE_PLANNING_START = /^(SCHEDULED:|DEADLINE:|CLOSED:)/;
const RE_SCHEDULED_TS = /SCHEDULED:\s*(<[^>]+>|\[[^\]]+\])/;
const RE_DEADLINE_TS = /DEADLINE:\s*(<[^>]+>|\[[^\]]+\])/;
const RE_CLOSED_TS = /CLOSED:\s*(\[[^\]]+\])/;

// Clock pattern
const RE_CLOCK = /^CLOCK:\s*(\[[^\]]+\])(?:--(\[[^\]]+\]))?\s*(?:=>\s*(\d+:\d+))?/;

// Timestamp pattern
const RE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2})(?:-(\d{2}):(\d{2}))?)?(?:\s+([.+]?\+\d+[hdwmy]))?(?:\s+(-{1,2}\d+[hdwmy]))?$/;
const RE_REPEATER = /^([.+]?\+)(\d+)([hdwmy])$/;
const RE_WARNING = /^(-{1,2})(\d+)([hdwmy])$/;

// Drawer patterns
const RE_DRAWER_START = /^:(\w+):$/;
const RE_PROPERTY_LINE = /^:(\S+):\s*(.*)$/;

// Keyword pattern
const RE_KEYWORD = /^#\+(\w+):\s*(.*)$/;

// Horizontal rule
const RE_HORIZONTAL_RULE = /^\s*-{5,}\s*$/;

// Fixed width
const RE_FIXED_WIDTH_CONTENT = /^:\s?(.*)$/;

// Comment
const RE_COMMENT = /^#\s+(.*)$|^#$/;

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
    // Fast path: check first char before regex
    const isTableEl = lines.some(line => {
        const trimmed = line.trimStart();
        return trimmed[0] === '+' && RE_TABLE_EL_LINE.test(line);
    });

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

    // Fast path: check first char for rule detection
    // Check for rule row (horizontal separator)
    if (trimmed[0] === '|' && trimmed[1] === '-') {
        // It's a rule row - full regex only needed for edge cases
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
    // Fast path: only run regex if line starts and ends with |
    const cellMatch = trimmed[0] === '|' && trimmed[trimmed.length - 1] === '|'
        ? trimmed.match(RE_TABLE_CELLS)
        : null;
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

            // Check for alignment cookie - fast path: must start with '<'
            if (value[0] === '<') {
                const alignMatch = value.match(RE_ALIGNMENT_COOKIE);
                if (alignMatch) {
                    alignments[i] = alignMatch[1];
                }
            }
        }
    }

    return alignments;
}

/**
 * Check if a line starts a table
 * Uses fast character checks before regex
 */
export function isTableLine(line: string): boolean {
    const trimmed = line.trimStart();
    const firstChar = trimmed[0];
    // Fast path: org tables start with |, table.el with +
    if (firstChar === '|') return true;
    if (firstChar === '+') return RE_TABLE_EL_LINE.test(line);
    return false;
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

    // Fast path: planning lines must start with S, D, or C
    const firstChar = trimmed[0];
    if (firstChar !== 'S' && firstChar !== 'D' && firstChar !== 'C') {
        return null;
    }

    let scheduled: TimestampObject | undefined;
    let deadline: TimestampObject | undefined;
    let closed: TimestampObject | undefined;
    let foundAny = false;

    // Only check for SCHEDULED if line contains it (fast indexOf before regex)
    if (trimmed.includes('SCHEDULED:')) {
        const schedMatch = trimmed.match(RE_SCHEDULED_TS);
        if (schedMatch) {
            const ts = parseTimestampString(schedMatch[1], charOffset + trimmed.indexOf(schedMatch[0]));
            if (ts) {
                scheduled = ts;
                foundAny = true;
            }
        }
    }

    // Only check for DEADLINE if line contains it
    if (trimmed.includes('DEADLINE:')) {
        const deadMatch = trimmed.match(RE_DEADLINE_TS);
        if (deadMatch) {
            const ts = parseTimestampString(deadMatch[1], charOffset + trimmed.indexOf(deadMatch[0]));
            if (ts) {
                deadline = ts;
                foundAny = true;
            }
        }
    }

    // Only check for CLOSED if line contains it
    if (trimmed.includes('CLOSED:')) {
        const closedMatch = trimmed.match(RE_CLOSED_TS);
        if (closedMatch) {
            const ts = parseTimestampString(closedMatch[1], charOffset + trimmed.indexOf(closedMatch[0]));
            if (ts) {
                closed = ts;
                foundAny = true;
            }
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
 * Uses fast character check before regex
 */
export function isPlanningLine(line: string): boolean {
    const trimmed = line.trim();
    const firstChar = trimmed[0];
    // Fast path: planning lines must start with S, D, or C
    if (firstChar !== 'S' && firstChar !== 'D' && firstChar !== 'C') {
        return false;
    }
    return RE_PLANNING_START.test(trimmed);
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

    // Fast path: clock lines must start with 'C'
    if (trimmed[0] !== 'C') {
        return null;
    }

    // CLOCK: [timestamp]--[timestamp] => duration
    // or CLOCK: [timestamp] (running)
    const match = trimmed.match(RE_CLOCK);

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
    const isActive = tsStr[0] === '<';
    const inner = tsStr.slice(1, -1); // Remove brackets

    // Parse: YYYY-MM-DD DAY HH:MM[-HH:MM] [REPEATER] [WARNING]
    // Use pre-compiled pattern
    const match = inner.match(RE_TIMESTAMP);

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

    // Parse repeater - use pre-compiled pattern
    if (repeaterStr) {
        const repMatch = repeaterStr.match(RE_REPEATER);
        if (repMatch) {
            properties.repeaterType = repMatch[1] as '+' | '++' | '.+';
            properties.repeaterValue = parseInt(repMatch[2], 10);
            properties.repeaterUnit = repMatch[3] as 'h' | 'd' | 'w' | 'm' | 'y';
        }
    }

    // Parse warning - use pre-compiled pattern
    if (warningStr) {
        const warnMatch = warningStr.match(RE_WARNING);
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

    // Fast path: drawer lines must start with ':'
    if (firstLine[0] !== ':') return null;

    const drawerMatch = firstLine.match(RE_DRAWER_START);

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
        const trimmedLine = line.trim();

        // Fast path: property lines must start with ':'
        if (trimmedLine[0] === ':') {
            const propMatch = trimmedLine.match(RE_PROPERTY_LINE);

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
 * Uses fast character check before regex
 */
export function isDrawerStart(line: string): boolean {
    const trimmed = line.trim();
    // Fast path: drawer lines must start with ':'
    if (trimmed[0] !== ':') return false;
    return RE_DRAWER_START.test(trimmed);
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
 * Fast check if a line looks like it could be a list item
 * Uses character checks before regex
 */
function isLikelyListItem(line: string): boolean {
    const trimmed = line.trimStart();
    const firstChar = trimmed[0];
    // Unordered: -, +, *
    if (firstChar === '-' || firstChar === '+' || firstChar === '*') {
        return trimmed.length > 1 && (trimmed[1] === ' ' || trimmed[1] === '\t');
    }
    // Ordered: digit followed by . or )
    if (firstChar >= '0' && firstChar <= '9') {
        // Look for . or ) after digits
        for (let i = 1; i < trimmed.length; i++) {
            if (trimmed[i] >= '0' && trimmed[i] <= '9') continue;
            if (trimmed[i] === '.' || trimmed[i] === ')') {
                return i + 1 < trimmed.length && (trimmed[i + 1] === ' ' || trimmed[i + 1] === '\t');
            }
            break;
        }
    }
    return false;
}

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

    // Fast path: check if line looks like a list item
    if (!isLikelyListItem(firstLine)) {
        return null;
    }

    let listType: 'ordered' | 'unordered' | 'descriptive';

    // Use pre-compiled patterns
    if (RE_DESCRIPTIVE.test(firstLine)) {
        listType = 'descriptive';
    } else if (RE_ORDERED_BULLET.test(firstLine)) {
        listType = 'ordered';
    } else if (RE_UNORDERED_BULLET.test(firstLine)) {
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

        // Fast path: check if line looks like a list item before regex
        let bulletMatch: RegExpMatchArray | null = null;
        if (isLikelyListItem(line)) {
            bulletMatch = line.match(RE_UNORDERED_BULLET) || line.match(RE_ORDERED_BULLET);
        }

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

    // Parse bullet - use pre-compiled patterns
    const bulletMatch = firstLine.match(RE_UNORDERED_BULLET) ||
                       firstLine.match(RE_ORDERED_BULLET);

    if (!bulletMatch) return null;

    bullet = bulletMatch[2];
    contentStart = bulletMatch[0].length;

    // Check for checkbox [ ], [X], [-]
    const afterBullet = firstLine.slice(bulletMatch[0].length);

    // Fast path: checkbox must start with '['
    if (afterBullet[0] === '[') {
        const checkboxMatch = afterBullet.match(RE_CHECKBOX);

        if (checkboxMatch) {
            const checkChar = checkboxMatch[1];
            checkbox = checkChar === 'X' ? 'on' : checkChar === '-' ? 'trans' : 'off';
            contentStart += checkboxMatch[0].length;
        }
    }

    // Check for descriptive tag - use pre-compiled pattern
    if (listType === 'descriptive') {
        const tagMatch = firstLine.match(RE_DESCRIPTIVE_TAG);
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
 * Uses fast character check before regex
 */
export function isListItemLine(line: string): boolean {
    // Use the fast check first
    if (!isLikelyListItem(line)) return false;
    return RE_UNORDERED_BULLET.test(line) || RE_ORDERED_BULLET.test(line);
}

// =============================================================================
// Other Element Parsers
// =============================================================================

/**
 * Parse a keyword line (#+KEY: value)
 * Uses fast character check before regex
 */
export function parseKeyword(
    line: string,
    lineNumber: number,
    charOffset: number
): KeywordElement | null {
    // Fast path: keywords must start with '#+'
    if (line[0] !== '#' || line[1] !== '+') return null;

    const match = line.match(RE_KEYWORD);
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
 * Uses fast character check before regex
 */
export function parseHorizontalRule(
    line: string,
    lineNumber: number,
    charOffset: number
): HorizontalRuleElement | null {
    // Fast path: must start with '-' or whitespace followed by '-'
    const trimmed = line.trimStart();
    if (trimmed[0] !== '-') return null;

    if (!RE_HORIZONTAL_RULE.test(line)) return null;

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
        // Fast path: fixed width lines must start with ':'
        if (line[0] !== ':') continue;

        const match = line.match(RE_FIXED_WIDTH_CONTENT);
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
 * Uses fast character check
 */
export function isFixedWidthLine(line: string): boolean {
    // Fast path: must start with ':'
    if (line[0] !== ':') return false;
    return line.length === 1 || line[1] === ' ' || line[1] === '\t';
}

/**
 * Parse a comment line (# prefix, not #+)
 * Uses fast character check before regex
 */
export function parseComment(
    line: string,
    lineNumber: number,
    charOffset: number
): CommentElement | null {
    // Fast path: comments must start with '#' but not '#+'
    if (line[0] !== '#') return null;
    if (line[1] === '+') return null;

    const match = line.match(RE_COMMENT);
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
 * Uses fast character check
 */
export function isCommentLine(line: string): boolean {
    // Fast path: must start with '#' but not '#+'
    if (line[0] !== '#') return false;
    if (line[1] === '+') return false;
    return line.length === 1 || line[1] === ' ' || line[1] === '\t';
}

// =============================================================================
// Exports
// =============================================================================

export {
    parseTimestampString,
};
