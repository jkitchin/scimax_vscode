/**
 * Table parsing, measuring and formatting for org-mode and Markdown tables,
 * with no dependency on VS Code, so the extension (tableProvider.ts) and the
 * CLI (`scimax table align`) align tables identically.
 *
 * Org table format:
 * | col1 | col2 | col3 |
 * |------+------+------|
 * | a    | b    | c    |
 *
 * Markdown table format:
 * | col1 | col2 | col3 |
 * |------|------|------|
 * | a    | b    | c    |
 */

import { isMarkdownLike } from '../shared/markdownLike';

/** The parts of a document the table code reads (vscode.TextDocument fits). */
export interface TableDocument {
    readonly languageId: string;
    readonly lineCount: number;
    lineAt(line: number): { readonly text: string };
}

export type ColumnAlignment = 'l' | 'c' | 'r';

/**
 * GFM delimiter-row alignment: ':---' left, ':---:' center, '---:' right,
 * '---' none (null).
 */
export type GfmAlignment = ColumnAlignment | null;

export interface TableInfo {
    startLine: number;
    endLine: number;
    rows: string[][];
    separatorLines: number[]; // Lines that are separator rows (|---|)
    columnWidths: number[];
    specRow?: number; // Line index of column spec row (relative to table start)
    columnAlignments: ColumnAlignment[]; // Alignment for each column
    columnMinWidths: (number | undefined)[]; // Minimum widths from cookies
    columnMaxWidths: (number | undefined)[]; // Max display widths for truncation (from <N> without alignment)
    columnSpecs: ColumnSpec[]; // Raw cookies from the column spec row (empty if none)
    /**
     * Markdown only: per-column alignment from the GFM delimiter row (the
     * first separator row). Undefined for org tables and for Markdown tables
     * without a delimiter row.
     */
    gfmAlignments?: GfmAlignment[];
    /** Markdown only: the GFM delimiter row is line 2 of the table (index 1). */
    hasGfmHeader?: boolean;
}

/**
 * Get the display width of a string, accounting for wide characters (emojis, CJK, etc.)
 * Most emojis and CJK characters display as 2 columns wide in monospace fonts.
 */
/**
 * Get the display width of a single character
 */
export function getCharWidth(char: string): number {
    const code = char.codePointAt(0);
    if (code === undefined) return 0;

    // Variation selectors and ZWJ don't add width
    if ((code >= 0xFE00 && code <= 0xFE0F) || code === 0x200D) {
        return 0;
    }

    // Emoji ranges (simplified - covers most common emojis)
    if (
        (code >= 0x1F300 && code <= 0x1F9FF) || // Miscellaneous Symbols and Pictographs, Emoticons, etc.
        (code >= 0x2600 && code <= 0x26FF) ||   // Miscellaneous Symbols
        (code >= 0x2700 && code <= 0x27BF) ||   // Dingbats
        (code >= 0x231A && code <= 0x231B) ||   // Watch, Hourglass
        (code >= 0x23E9 && code <= 0x23F3) ||   // Various symbols
        (code >= 0x23F8 && code <= 0x23FA) ||   // Various symbols
        (code >= 0x25AA && code <= 0x25AB) ||   // Small squares
        (code >= 0x25B6 && code <= 0x25C0) ||   // Triangles
        (code >= 0x25FB && code <= 0x25FE) ||   // Squares
        (code >= 0x2614 && code <= 0x2615) ||   // Umbrella, hot beverage
        (code >= 0x2648 && code <= 0x2653) ||   // Zodiac
        (code >= 0x267F && code <= 0x267F) ||   // Wheelchair
        (code >= 0x2693 && code <= 0x2693) ||   // Anchor
        (code >= 0x26A1 && code <= 0x26A1) ||   // High voltage
        (code >= 0x26AA && code <= 0x26AB) ||   // Circles
        (code >= 0x26BD && code <= 0x26BE) ||   // Soccer, baseball
        (code >= 0x26C4 && code <= 0x26C5) ||   // Snowman, sun
        (code >= 0x26CE && code <= 0x26CE) ||   // Ophiuchus
        (code >= 0x26D4 && code <= 0x26D4) ||   // No entry
        (code >= 0x26EA && code <= 0x26EA) ||   // Church
        (code >= 0x26F2 && code <= 0x26F3) ||   // Fountain, golf
        (code >= 0x26F5 && code <= 0x26F5) ||   // Sailboat
        (code >= 0x26FA && code <= 0x26FA) ||   // Tent
        (code >= 0x26FD && code <= 0x26FD) ||   // Fuel pump
        (code >= 0x2702 && code <= 0x2702) ||   // Scissors
        (code >= 0x2705 && code <= 0x2705) ||   // Check mark
        (code >= 0x2708 && code <= 0x270D) ||   // Airplane to writing hand
        (code >= 0x270F && code <= 0x270F) ||   // Pencil
        (code >= 0x2712 && code <= 0x2712) ||   // Black nib
        (code >= 0x2714 && code <= 0x2714) ||   // Check mark
        (code >= 0x2716 && code <= 0x2716) ||   // X mark
        (code >= 0x271D && code <= 0x271D) ||   // Cross
        (code >= 0x2721 && code <= 0x2721) ||   // Star of David
        (code >= 0x2728 && code <= 0x2728) ||   // Sparkles
        (code >= 0x2733 && code <= 0x2734) ||   // Eight spoked asterisk
        (code >= 0x2744 && code <= 0x2744) ||   // Snowflake
        (code >= 0x2747 && code <= 0x2747) ||   // Sparkle
        (code >= 0x274C && code <= 0x274C) ||   // Cross mark
        (code >= 0x274E && code <= 0x274E) ||   // Cross mark
        (code >= 0x2753 && code <= 0x2755) ||   // Question marks
        (code >= 0x2757 && code <= 0x2757) ||   // Exclamation
        (code >= 0x2763 && code <= 0x2764) ||   // Heart exclamation, heart
        (code >= 0x2795 && code <= 0x2797) ||   // Plus, minus, divide
        (code >= 0x27A1 && code <= 0x27A1) ||   // Right arrow
        (code >= 0x27B0 && code <= 0x27B0) ||   // Curly loop
        (code >= 0x27BF && code <= 0x27BF) ||   // Double curly loop
        (code >= 0x2934 && code <= 0x2935) ||   // Arrows
        (code >= 0x2B05 && code <= 0x2B07) ||   // Arrows
        (code >= 0x2B1B && code <= 0x2B1C) ||   // Squares
        (code >= 0x2B50 && code <= 0x2B50) ||   // Star
        (code >= 0x2B55 && code <= 0x2B55) ||   // Circle
        (code >= 0x3030 && code <= 0x3030) ||   // Wavy dash
        (code >= 0x303D && code <= 0x303D) ||   // Part alternation mark
        (code >= 0x3297 && code <= 0x3297) ||   // Circled ideograph congratulation
        (code >= 0x3299 && code <= 0x3299)      // Circled ideograph secret
    ) {
        return 2;
    }

    // CJK characters
    if (
        (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
        (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
        (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility Ideographs
        (code >= 0x3000 && code <= 0x303F) ||   // CJK Symbols and Punctuation
        (code >= 0xFF00 && code <= 0xFFEF)      // Fullwidth Forms
    ) {
        return 2;
    }

    // Warning sign (U+26A0) and Refresh/cycle symbol (U+1F504)
    if (code === 0x26A0 || code === 0x1F504) {
        return 2;
    }

    return 1;
}

export function getDisplayWidth(str: string): number {
    let width = 0;
    for (const char of str) {
        width += getCharWidth(char);
    }
    return width;
}

export const BRACKET_LINK = /\[\[((?:[^\]\\]|\\.)+)\](?:\[([^\]]+)\])?\]/g;

/**
 * Whether cells are measured as displayed with descriptive links on
 * (scimax.org.descriptiveLinks): [[target][desc]] shows as "desc" and
 * [[target]] as "target". Set per table by setLinkCollapse, so a table with
 * links lines up on screen, as org-table-align does with invisible text.
 */
let collapseLinks = false;

export function setLinkCollapse(collapse: boolean): void {
    collapseLinks = collapse;
}

/**
 * Display width of a cell's content, with links collapsed when they are
 * shown collapsed
 */
export function cellWidth(str: string): number {
    if (collapseLinks && str.includes('[[')) {
        str = str.replace(BRACKET_LINK, (_m, target: string, desc?: string) => desc ?? target);
    }
    return getDisplayWidth(str);
}

/**
 * Pad a string to a target display width (left-aligned, padding on right)
 */
export function padEndDisplayWidth(str: string, targetWidth: number): string {
    const currentWidth = cellWidth(str);
    if (currentWidth >= targetWidth) {
        return str;
    }
    return str + ' '.repeat(targetWidth - currentWidth);
}

/**
 * Pad a string to a target display width (right-aligned, padding on left)
 */
export function padStartDisplayWidth(str: string, targetWidth: number): string {
    const currentWidth = cellWidth(str);
    if (currentWidth >= targetWidth) {
        return str;
    }
    return ' '.repeat(targetWidth - currentWidth) + str;
}

/**
 * Center a string to a target display width
 */
export function centerDisplayWidth(str: string, targetWidth: number): string {
    const currentWidth = cellWidth(str);
    if (currentWidth >= targetWidth) {
        return str;
    }
    const totalPadding = targetWidth - currentWidth;
    const leftPad = Math.floor(totalPadding / 2);
    const rightPad = totalPadding - leftPad;
    return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
}

/**
 * Align a string based on alignment type
 */
export function alignCell(str: string, targetWidth: number, alignment: ColumnAlignment): string {
    switch (alignment) {
        case 'c':
            return centerDisplayWidth(str, targetWidth);
        case 'r':
            return padStartDisplayWidth(str, targetWidth);
        case 'l':
        default:
            return padEndDisplayWidth(str, targetWidth);
    }
}

/**
 * Check if a line is a table row. As in org-mode, a leading | is enough, so a
 * row still being typed (no closing |) or a bare |- separator is part of the
 * table; aligning closes it.
 */
export function isTableRow(line: string): boolean {
    return line.trim().startsWith('|');
}

/**
 * The text between a row's leading | and its closing | (if it has one)
 */
export function rowInner(trimmed: string): string {
    const closed = trimmed.length > 1 && trimmed.endsWith('|') && !trimmed.endsWith('\\|');
    return trimmed.slice(1, closed ? -1 : undefined);
}

export interface ColumnSpec {
    alignment: ColumnAlignment;
    minWidth?: number; // Minimum width from cookie like <l5> (alignment + number)
    maxWidth?: number; // Max display width for truncation from <5> (number only)
}

/**
 * Check if a line is a column spec row (contains alignment/width cookies like <l>, <c>, <r>, <5>, <l5>)
 */
export function isColumnSpecRow(line: string): boolean {
    if (!isTableRow(line)) return false;
    const cells = parseRowSimple(line);
    // A column spec row has at least one cell with a cookie pattern
    // Matches: <l>, <c>, <r>, <5>, <l5>, <c10>, <r3>, etc.
    return cells.some(cell => /^<([lcr]?\d*|[lcr])>$/i.test(cell.trim()));
}

/**
 * Simple row parser that doesn't handle markup (used before full parseRow is defined)
 */
export function parseRowSimple(line: string): string[] {
    return rowInner(line.trim()).split('|').map(cell => cell.trim());
}

/**
 * Parse column spec cookies from a row
 * Handles:
 * - <l>, <c>, <r> - alignment only
 * - <5> - max display width (truncation), defaults to left alignment
 * - <l5>, <c10>, <r3> - alignment with minimum width
 */
export function parseColumnSpecRow(line: string): ColumnSpec[] {
    const cells = parseRowSimple(line);
    return cells.map(cell => {
        const trimmed = cell.trim();
        // Pattern: <alignment?width?> where alignment is l/c/r and width is digits
        const match = trimmed.match(/^<([lcr]?)(\d*)>$/i);
        if (match) {
            const alignChar = match[1].toLowerCase();
            const widthStr = match[2];
            const width = widthStr ? parseInt(widthStr, 10) : undefined;

            // If only a number (no alignment letter), it's a max width for truncation
            // If alignment + number, it's a min width
            if (!alignChar && width !== undefined) {
                return {
                    alignment: 'l' as ColumnAlignment,
                    maxWidth: width
                };
            }

            return {
                alignment: (alignChar === 'c' || alignChar === 'r' ? alignChar : 'l') as ColumnAlignment,
                minWidth: width
            };
        }
        return { alignment: 'l' as ColumnAlignment };
    });
}

// Keep old functions for backward compatibility
export function isAlignmentRow(line: string): boolean {
    return isColumnSpecRow(line);
}

export function parseAlignmentRow(line: string): ColumnAlignment[] {
    return parseColumnSpecRow(line).map(spec => spec.alignment);
}

/**
 * Check if a line is a separator row
 */
export function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim();
    if (!isTableRow(line)) return false;

    // Standard org separator: |---+---| or |---|---|, or the |- shorthand
    if (/^\|-/.test(trimmed) || /^\|[\s\-+:]+\|$/.test(trimmed)) {
        return true;
    }

    // Also detect rows where all cells contain only dashes/colons/spaces
    // This handles user-typed separators like | ---- | ---- |
    const cells = trimmed.split('|').slice(1, -1); // Remove first/last empty from split
    if (cells.length === 0) return false;

    return cells.every(cell => {
        const content = cell.trim();
        // Cell is separator-like if empty or contains only dashes, colons, spaces
        return content === '' || /^[-:]+$/.test(content);
    });
}

/**
 * Parse the per-column alignment of a GFM delimiter row such as
 * |:-----|:---:|------:|---|
 */
export function parseGfmDelimiterRow(line: string): GfmAlignment[] {
    return parseRowSimple(line).map(cell => {
        const left = cell.startsWith(':');
        const right = cell.length > 1 && cell.endsWith(':');
        if (left && right) return 'c';
        if (right) return 'r';
        if (left) return 'l';
        return null;
    });
}

/**
 * Org-mode inline markup delimiters
 * Each maps to its closing delimiter (same character for symmetric markup)
 */
export const MARKUP_DELIMITERS: Record<string, string> = {
    '`': '`',   // code
    '~': '~',   // code (org-mode)
    '=': '=',   // verbatim
    '*': '*',   // bold
    '/': '/',   // italic
    '_': '_',   // underline
    '+': '+',   // strikethrough
};

/**
 * Check if a character at position is a valid markup opener
 * Org-mode markup rules:
 * - Must be preceded by whitespace, start of string, or certain punctuation
 * - The next character cannot be whitespace
 */
export function isValidMarkupOpener(str: string, pos: number, marker: string): boolean {
    // Check PRE condition: preceded by whitespace, start, or punctuation
    if (pos > 0) {
        const prevChar = str[pos - 1];
        const preChars = ' \t\n\r-({\'"';
        if (!preChars.includes(prevChar)) {
            return false;
        }
    }

    // Check BORDER condition: next char cannot be whitespace
    if (pos + 1 < str.length) {
        const nextChar = str[pos + 1];
        if (' \t\n\r'.includes(nextChar)) {
            return false;
        }
    } else {
        // Marker at end of string - not valid opener
        return false;
    }

    return true;
}

/**
 * Check if a character at position is a valid markup closer
 * Org-mode markup rules:
 * - The previous character cannot be whitespace
 * - Must be followed by whitespace, end of string, or certain punctuation
 */
export function isValidMarkupCloser(str: string, pos: number, marker: string): boolean {
    // Check BORDER condition: prev char cannot be whitespace
    if (pos > 0) {
        const prevChar = str[pos - 1];
        if (' \t\n\r'.includes(prevChar)) {
            return false;
        }
    } else {
        // Marker at start of string - not valid closer
        return false;
    }

    // Check POST condition: followed by whitespace, end, or punctuation
    if (pos + 1 < str.length) {
        const nextChar = str[pos + 1];
        const postChars = ' \t\n\r-.,;:!?\'")}|';
        if (!postChars.includes(nextChar)) {
            return false;
        }
    }
    // End of string is valid

    return true;
}

/**
 * Border rules for $...$ inline math, mirroring org-mode (see
 * src/parser/orgObjects.ts). Kept loose enough that "$^{\circ}$C" parses
 * but strict enough that "Profit ($)" does not.
 */
export const DOLLAR_FORBIDDEN_FIRST = new Set([' ', '\t', '\n', '\r', ',', ';', '.', '$']);
export const DOLLAR_FORBIDDEN_LAST = new Set([' ', '\t', '\n', '\r', ',', '.', '$']);

/**
 * If `str[pos]` opens a LaTeX math span, return the index just past its end;
 * otherwise return -1. Recognizes \(...\), \[...\], $$...$$, and $...$ with
 * org-mode's border rules.
 */
export function mathSpanEnd(str: string, pos: number, prevChar: string): number {
    const ch = str[pos];

    if (ch === '\\') {
        const next = str[pos + 1];
        if (next === '(' || next === '[') {
            const closer = next === '(' ? '\\)' : '\\]';
            const end = str.indexOf(closer, pos + 2);
            return end >= 0 ? end + 2 : -1;
        }
        return -1;
    }

    if (ch !== '$') return -1;

    // Display math $$...$$
    if (str[pos + 1] === '$') {
        const end = str.indexOf('$$', pos + 2);
        return end >= 0 ? end + 2 : -1;
    }

    // Inline math $...$
    if (prevChar === '$') return -1;
    const first = str[pos + 1];
    if (first === undefined || DOLLAR_FORBIDDEN_FIRST.has(first)) return -1;

    let searchFrom = pos + 2;
    while (searchFrom < str.length) {
        // Find next $, skipping \X escapes (matches orgObjects.findClosingDelimiter)
        let endPos = -1;
        for (let j = searchFrom; j < str.length; j++) {
            if (str[j] === '$') { endPos = j; break; }
            if (str[j] === '\\') { j++; }
        }
        if (endPos < 0) return -1;

        const content = str.slice(pos + 1, endPos);
        if (content.includes('\n')) return -1;
        const last = content[content.length - 1];
        const nextIsDollar = str[endPos + 1] === '$';
        if (!DOLLAR_FORBIDDEN_LAST.has(last) && !nextIsDollar) {
            return endPos + 1;
        }
        searchFrom = endPos + 1;
    }
    return -1;
}

/**
 * Parse a table row into cells
 * Handles pipes inside markup spans (code, verbatim, bold, etc.),
 * pipes inside LaTeX math (\(...\), \[...\], $...$, $$...$$),
 * and escaped pipes (\|)
 */
export function parseRow(line: string): string[] {
    const inner = rowInner(line.trim());

    const cells: string[] = [];
    let current = '';
    let markupStack: string[] = []; // Stack of open markup delimiters
    let i = 0;

    while (i < inner.length) {
        const char = inner[i];

        // Handle escaped pipe
        if (char === '\\' && i + 1 < inner.length && inner[i + 1] === '|') {
            current += '|';
            i += 2;
            continue;
        }

        // Handle LaTeX math: \(...\), \[...\], $...$, $$...$$
        // Pipes inside math (e.g., |x| for absolute value) must not split cells.
        if (char === '\\' || char === '$') {
            const prev = i > 0 ? inner[i - 1] : ' ';
            const mathEnd = mathSpanEnd(inner, i, prev);
            if (mathEnd > i) {
                current += inner.slice(i, mathEnd);
                i = mathEnd;
                continue;
            }
        }

        // Check if this is a markup delimiter
        if (char in MARKUP_DELIMITERS) {
            const expectedCloser = MARKUP_DELIMITERS[char];

            if (markupStack.length > 0 && markupStack[markupStack.length - 1] === expectedCloser) {
                // Potential closer - check if valid
                if (isValidMarkupCloser(inner, i, char)) {
                    markupStack.pop();
                    current += char;
                    i++;
                    continue;
                }
            }

            // Check if valid opener (only if not already in same markup type)
            if (!markupStack.includes(char) && isValidMarkupOpener(inner, i, char)) {
                markupStack.push(expectedCloser);
                current += char;
                i++;
                continue;
            }

            // Not valid markup, treat as literal
            current += char;
            i++;
            continue;
        }

        // Pipe is always a cell separator - unclosed markup doesn't span cells
        // This handles cases like `| *Heading |` where * is not bold markup
        if (char === '|') {
            cells.push(current.trim());
            current = '';
            // Reset markup stack at cell boundary (unclosed markup doesn't span cells)
            markupStack = [];
            i++;
            continue;
        }

        // Regular character
        current += char;
        i++;
    }

    // Don't forget the last cell
    cells.push(current.trim());

    return cells;
}

/**
 * Constrain a column width to its spec cookie: the column must be wide enough
 * to show the cookie itself and at least minWidth. A <N> maxWidth does not
 * narrow the column in the buffer; it only narrows the display (see
 * computeShrinkRanges), so the cell text is never cut.
 */
export function applyColumnSpecWidth(width: number, spec: ColumnSpec): number {
    // Width of the cookie as rendered, e.g. "<l>" = 3, "<15>" = 4
    let cookieWidth: number;
    if (spec.maxWidth !== undefined) {
        cookieWidth = `<${spec.maxWidth}>`.length;
    } else if (spec.minWidth !== undefined) {
        cookieWidth = `<${spec.alignment}${spec.minWidth}>`.length;
    } else {
        cookieWidth = `<${spec.alignment}>`.length;
    }

    let result = Math.max(width, cookieWidth);
    if (spec.minWidth !== undefined) {
        result = Math.max(result, spec.minWidth);
    }
    return result;
}

/**
 * Find the table boundaries around the cursor
 */
export function findTableAtLine(document: TableDocument, lineNumber: number): TableInfo | null {
    const position = { line: lineNumber };
    const currentLine = document.lineAt(position.line).text;

    // Check if we're on a #+TBLFM line - if so, look for table above
    if (/^\s*#\+TBLFM:/i.test(currentLine)) {
        if (position.line > 0 && isTableRow(document.lineAt(position.line - 1).text)) {
            return findTableAtLine(document, position.line - 1);
        }
        return null;
    }

    if (!isTableRow(currentLine)) {
        return null;
    }

    // Find table start (search upward)
    let startLine = position.line;
    while (startLine > 0 && isTableRow(document.lineAt(startLine - 1).text)) {
        startLine--;
    }

    // Find table end (search downward)
    let endLine = position.line;
    while (endLine < document.lineCount - 1 && isTableRow(document.lineAt(endLine + 1).text)) {
        endLine++;
    }

    // Parse all rows
    const rows: string[][] = [];
    const separatorLines: number[] = [];
    let specRow: number | undefined;
    let columnSpecs: ColumnSpec[] = [];
    let maxColumns = 0;

    for (let i = startLine; i <= endLine; i++) {
        const line = document.lineAt(i).text;
        if (isSeparatorRow(line)) {
            separatorLines.push(i);
            rows.push([]); // Placeholder for separator
        } else if (isColumnSpecRow(line)) {
            specRow = i - startLine;
            columnSpecs = parseColumnSpecRow(line);
            rows.push([]); // Placeholder for spec row
        } else {
            const cells = parseRow(line);
            rows.push(cells);
            maxColumns = Math.max(maxColumns, cells.length);
        }
    }

    // Calculate column widths using display width (accounts for emojis)
    // Don't include spec row in width calculation
    const columnWidths: number[] = new Array(maxColumns).fill(0);
    for (let i = 0; i < rows.length; i++) {
        if (i === specRow) continue; // Skip spec row for width calculation
        const row = rows[i];
        for (let j = 0; j < row.length; j++) {
            columnWidths[j] = Math.max(columnWidths[j], cellWidth(row[j]));
        }
    }

    // Extract alignments, min widths, and max widths from column specs
    const columnAlignments: ColumnAlignment[] = [];
    const columnMinWidths: (number | undefined)[] = [];
    const columnMaxWidths: (number | undefined)[] = [];
    // Markdown: alignment comes from the GFM delimiter row
    let gfmAlignments: GfmAlignment[] | undefined;
    let hasGfmHeader = false;
    if (isMarkdownLike(document.languageId) && separatorLines.length > 0) {
        const parsed = parseGfmDelimiterRow(document.lineAt(separatorLines[0]).text);
        gfmAlignments = [];
        for (let i = 0; i < maxColumns; i++) {
            gfmAlignments.push(parsed[i] ?? null);
        }
        hasGfmHeader = separatorLines[0] === startLine + 1;
    }

    for (let i = 0; i < maxColumns; i++) {
        if (i < columnSpecs.length) {
            columnAlignments.push(columnSpecs[i].alignment);
            columnMinWidths.push(columnSpecs[i].minWidth);
            columnMaxWidths.push(columnSpecs[i].maxWidth);
            columnWidths[i] = applyColumnSpecWidth(columnWidths[i], columnSpecs[i]);
        } else {
            columnAlignments.push(gfmAlignments?.[i] ?? 'l');
            columnMinWidths.push(undefined);
            columnMaxWidths.push(undefined);
        }
    }

    return {
        startLine,
        endLine,
        rows,
        separatorLines,
        columnWidths,
        specRow,
        columnAlignments,
        columnMinWidths,
        columnMaxWidths,
        columnSpecs,
        gfmAlignments,
        hasGfmHeader
    };
}

/**
 * Format a row with proper alignment
 */
export function formatRow(
    cells: string[],
    columnWidths: number[],
    columnAlignments?: ColumnAlignment[]
): string {
    const paddedCells = cells.map((cell, i) => {
        const width = columnWidths[i] || cellWidth(cell);
        const alignment = columnAlignments?.[i] || 'l';
        return alignCell(cell, width, alignment);
    });
    return '| ' + paddedCells.join(' | ') + ' |';
}

/**
 * Format a separator row
 * For org mode: dashes must be width+2 to account for the space padding in data rows
 * Data row:  | cell | = "| " + cell.padEnd(w) + " |"
 * Separator: |------+  = "|" + "-".repeat(w+2) + "+"
 *
 * For markdown: dashes must also be width+2 to match the data row padding
 * Data row:  | cell | = "| " + cell.padEnd(w) + " |"
 * Separator: |------| = "|" + "-".repeat(w+2) + "|"
 */
export function formatSeparator(columnWidths: number[], isOrg: boolean, gfmAlignments?: GfmAlignment[]): string {
    // Each column section in data row is: " " + cell(w) + " " = w+2 chars
    const dashes = columnWidths.map((w, i) => {
        const align = isOrg ? null : gfmAlignments?.[i] ?? null;
        if (!align) return '-'.repeat(w + 2);
        // Keep GFM alignment colons; total section width stays w+2
        const left = align === 'l' || align === 'c' ? ':' : '';
        const right = align === 'r' || align === 'c' ? ':' : '';
        return left + '-'.repeat(Math.max(1, w + 2 - left.length - right.length)) + right;
    });
    if (isOrg) {
        return '|' + dashes.join('+') + '|';
    } else {
        // Markdown uses | instead of + for column separators
        return '|' + dashes.join('|') + '|';
    }
}

/**
 * Cell padding alignment for a Markdown table from its GFM delimiter row
 * (undefined, i.e. left, for org tables and tables without one)
 */
export function gfmCellAlignments(gfmAlignments?: GfmAlignment[]): ColumnAlignment[] | undefined {
    return gfmAlignments?.map(a => a ?? 'l');
}

/**
 * Format a column spec row (alignment/width cookies)
 */
export function formatSpecRow(
    columnWidths: number[],
    columnAlignments: ColumnAlignment[],
    columnMinWidths: (number | undefined)[],
    columnMaxWidths?: (number | undefined)[]
): string {
    const specCells = columnWidths.map((width, i) => {
        const alignment = columnAlignments[i] || 'l';
        const minWidth = columnMinWidths[i];
        const maxWidth = columnMaxWidths?.[i];

        // Build the cookie string
        // <5> = maxWidth only (truncation), defaults to left align
        // <l5> = alignment with minWidth
        // <l> = alignment only
        let cookie: string;
        if (maxWidth !== undefined) {
            // Max width for truncation (no alignment letter)
            cookie = `<${maxWidth}>`;
        } else if (minWidth !== undefined) {
            cookie = `<${alignment}${minWidth}>`;
        } else {
            cookie = `<${alignment}>`;
        }

        // Center the cookie in the cell
        return centerDisplayWidth(cookie, width);
    });
    return '| ' + specCells.join(' | ') + ' |';
}


/**
 * The aligned text of every line of table (as found by findTableAtLine).
 */
export function alignedTableLines(document: TableDocument, table: TableInfo): string[] {
    const isOrg = document.languageId === 'org';
    // The column widths already include min widths from cookies
    const columnWidths = table.columnWidths;
    const newLines: string[] = [];
    for (let i = 0; i < table.rows.length; i++) {
        const lineNum = table.startLine + i;
        if (table.separatorLines.includes(lineNum)) {
            newLines.push(formatSeparator(columnWidths, isOrg, table.gfmAlignments));
        } else if (i === table.specRow) {
            newLines.push(formatSpecRow(columnWidths, table.columnAlignments, table.columnMinWidths, table.columnMaxWidths));
        } else {
            const cells = parseRow(document.lineAt(lineNum).text);
            while (cells.length < columnWidths.length) {
                cells.push('');
            }
            newLines.push(formatRow(cells, columnWidths, table.columnAlignments));
        }
    }
    return newLines;
}

/**
 * Lines inside blocks (#+BEGIN_SRC ... #+END_SRC, ``` fences) are not tables,
 * even when they start with |.
 */
function blockLines(lines: string[], markdown: boolean): boolean[] {
    const inBlock: boolean[] = new Array(lines.length).fill(false);
    let open: RegExp | undefined;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (open) {
            inBlock[i] = true;
            if (open.test(line)) open = undefined;
            continue;
        }
        const org = line.match(/^\s*#\+begin_(\S+)/i);
        const fence = markdown ? line.match(/^\s*(`{3,}|~{3,})/) : null;
        if (org) {
            open = new RegExp(`^\\s*#\\+end_${org[1].replace(/[^\w-]/g, '')}\\b`, 'i');
            inBlock[i] = true;
        } else if (fence) {
            open = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
            inBlock[i] = true;
        }
    }
    return inBlock;
}

export interface AlignTextResult {
    text: string;
    /** Tables found */
    tables: number;
    /** Tables whose text changed */
    changed: number;
}

/**
 * Align every table in a document's text. languageId 'org' gives org
 * separators (|---+---|); 'markdown' (and other Markdown-like ids) gives GFM
 * ones. Line endings are preserved. Tables inside blocks are left alone.
 */
export function alignTablesInText(
    text: string,
    languageId: string,
    options: {
        /** Measure [[target][desc]] as "desc", as the editor shows it (default true) */
        collapseLinks?: boolean;
        /** Align only the table containing this 0-based line */
        line?: number;
    } = {}
): AlignTextResult {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    setLinkCollapse(languageId === 'org' && (options.collapseLinks ?? true));

    const skip = blockLines(lines, isMarkdownLike(languageId));
    let tables = 0;
    let changed = 0;
    let i = 0;
    while (i < lines.length) {
        if (skip[i] || !isTableRow(lines[i])) {
            i++;
            continue;
        }
        // Stop the table where a block starts, so findTableAtLine sees only it
        let end = i;
        while (end + 1 < lines.length && !skip[end + 1] && isTableRow(lines[end + 1])) end++;
        if (options.line !== undefined && (options.line < i || options.line > end)) {
            i = end + 1;
            continue;
        }
        const slice: TableDocument = {
            languageId,
            lineCount: end + 1,
            lineAt: (n: number) => ({ text: lines[n] }),
        };
        const table = findTableAtLine(slice, i);
        if (table) {
            tables++;
            const aligned = alignedTableLines(slice, table);
            if (aligned.some((l, k) => l !== lines[i + k])) changed++;
            lines.splice(i, aligned.length, ...aligned);
        }
        i = end + 1;
    }
    return { text: lines.join(eol), tables, changed };
}
