/**
 * Org-mode Table Formula Evaluator
 * Implements #+TBLFM: spreadsheet-like calculations
 *
 * Supports:
 * - Column references: $1, $2, $3, ..., $+1, $-2 (relative)
 * - Row references: @1, @2, @0 (current), @+1, @-1 (relative)
 * - Field references: @2$3 (row 2, column 3)
 * - Range references: @2$1..@5$3
 * - Special references: $# (column count), @# (row count), $0, @0 (current)
 * - Named parameters: $name (from $ rows or #+CONSTANTS:)
 * - Remote table references: remote(tablename, @2$3)
 * - Functions: vsum, vmean, vmin, vmax, vcount, etc.
 * - Basic arithmetic: +, -, *, /, ^, %
 * - Duration values: HH:MM:SS with T/U/t format flags
 */

import * as vscode from 'vscode';
import { parseRow } from './tableProvider';

// =============================================================================
// Types
// =============================================================================

export interface TableCell {
    value: string;
    row: number;
    col: number;
    isHeader: boolean;
    isHline: boolean;
}

export interface ParsedTable {
    name?: string;
    cells: TableCell[][];
    startLine: number;
    endLine: number;
    tblfmLine?: number;
    formulas: TableFormula[];
    columnCount: number;
    dataRowCount: number;
    firstDataRow: number; // 1-indexed row number of first data row (after header separator)
    parameters: Map<string, string>; // Named parameters from $ rows (e.g., $max=50)
    columnNames: Map<string, number>; // Column names from header row (column name -> column number)
}

/**
 * Document-level constants from #+CONSTANTS: lines
 */
export interface DocumentConstants {
    constants: Map<string, string>; // name -> value
}

export interface TableFormula {
    raw: string;
    target: FormulaTarget;
    expression: string;
    format?: string;
}

export interface FormulaTarget {
    type: 'column' | 'field' | 'range';
    column?: number;
    row?: number | string;  // Can be number or special like '>', '<', '-1'
    endColumn?: number;
    endRow?: number | string;  // Can be number or special like '>', '<', '-1'
}

export interface CellRef {
    type: 'absolute' | 'relative' | 'special';
    row?: number;
    col?: number;
    special?: '@#' | '$#' | '@>' | '@<' | '$>' | '$<';
}

export interface EvalContext {
    table: ParsedTable;
    currentRow: number;
    currentCol: number;
    document: vscode.TextDocument;
    namedTables: Map<string, ParsedTable>;
    constants: Map<string, string>; // Document-level constants from #+CONSTANTS:
}

// =============================================================================
// Duration Handling
// =============================================================================

/**
 * Parse a duration string in HH:MM or HH:MM:SS format to total seconds
 */
export function parseDuration(value: string): number | null {
    // Match HH:MM:SS or HH:MM format
    const match = value.trim().match(/^(-?)(\d+):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
        return null;
    }

    const negative = match[1] === '-';
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);
    const seconds = match[4] ? parseInt(match[4], 10) : 0;

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return negative ? -totalSeconds : totalSeconds;
}

/**
 * Format seconds as HH:MM:SS duration (T flag)
 */
export function formatDurationHMS(seconds: number): string {
    const negative = seconds < 0;
    seconds = Math.abs(Math.round(seconds));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const prefix = negative ? '-' : '';
    return `${prefix}${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format seconds as HH:MM duration (U flag)
 */
export function formatDurationHM(seconds: number): string {
    const negative = seconds < 0;
    seconds = Math.abs(Math.round(seconds));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const prefix = negative ? '-' : '';
    return `${prefix}${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Format seconds as decimal hours (t flag)
 */
export function formatDurationDecimalHours(seconds: number): string {
    const hours = seconds / 3600;
    return hours.toFixed(2);
}

/**
 * Check if a value looks like a duration
 */
export function isDuration(value: string): boolean {
    return /^-?\d+:\d{2}(:\d{2})?$/.test(value.trim());
}

/**
 * Get cell value, optionally parsing as duration (returns seconds)
 */
function getCellValueAsDuration(table: ParsedTable, row: number, col: number): number {
    const value = getCellValue(table, row, col);
    if (typeof value === 'number') {
        return value;
    }
    const duration = parseDuration(String(value));
    return duration !== null ? duration : 0;
}

// =============================================================================
// Table Parsing
// =============================================================================

/**
 * Parse a table at the given position
 */
export function parseTableAt(
    document: vscode.TextDocument,
    position: vscode.Position
): ParsedTable | null {
    const line = document.lineAt(position.line).text;

    // Check if we're on a #+TBLFM line - if so, look for table above
    if (/^\s*#\+TBLFM:/i.test(line)) {
        if (position.line > 0) {
            const prevLine = document.lineAt(position.line - 1).text;
            if (isTableLine(prevLine)) {
                // Recurse with position on the table line above
                return parseTableAt(document, new vscode.Position(position.line - 1, 0));
            }
        }
        return null;
    }

    if (!isTableLine(line)) {
        return null;
    }

    // Find table boundaries
    let startLine = position.line;
    while (startLine > 0 && isTableLine(document.lineAt(startLine - 1).text)) {
        startLine--;
    }

    let endLine = position.line;
    while (endLine < document.lineCount - 1 && isTableLine(document.lineAt(endLine + 1).text)) {
        endLine++;
    }

    // Check for #+NAME: above the table
    let tableName: string | undefined;
    if (startLine > 0) {
        const prevLine = document.lineAt(startLine - 1).text;
        const nameMatch = prevLine.match(/^#\+NAME:\s*(.+)$/i);
        if (nameMatch) {
            tableName = nameMatch[1].trim();
        }
    }

    // Check for #+TBLFM: below the table
    let tblfmLine: number | undefined;
    const formulas: TableFormula[] = [];
    if (endLine < document.lineCount - 1) {
        const nextLine = document.lineAt(endLine + 1).text;
        const tblfmMatch = nextLine.match(/^#\+TBLFM:\s*(.+)$/i);
        if (tblfmMatch) {
            tblfmLine = endLine + 1;
            formulas.push(...parseFormulas(tblfmMatch[1]));
        }
    }

    // Parse cells
    const cells: TableCell[][] = [];
    const parameters = new Map<string, string>();
    const columnNames = new Map<string, number>();
    let maxCols = 0;
    let dataRowIndex = 0;
    let firstHlineSeen = false;
    let firstDataRow = 1; // Default to row 1 if no hline separator
    let headerRowCells: string[] = [];

    for (let i = startLine; i <= endLine; i++) {
        const lineText = document.lineAt(i).text.trim();
        const isHline = /^\|[-\+]+\|$/.test(lineText);

        if (isHline) {
            cells.push([{
                value: '',
                row: dataRowIndex,
                col: 0,
                isHeader: false,
                isHline: true,
            }]);
            // Track the first hline - data rows start after it
            if (!firstHlineSeen) {
                firstHlineSeen = true;
                firstDataRow = dataRowIndex + 1; // Next row after hline is first data row
            }
        } else {
            const cellValues = parseTableRow(lineText);
            const isHeaderRow = !firstHlineSeen; // Rows before first hline are header rows

            // Check for parameter row (first cell starts with $)
            if (cellValues.length > 0 && cellValues[0].trim().startsWith('$')) {
                // This is a parameter row - extract name=value pairs
                for (const cellValue of cellValues) {
                    const paramMatch = cellValue.trim().match(/^\$(\w+)\s*=\s*(.+)$/);
                    if (paramMatch) {
                        parameters.set(paramMatch[1], paramMatch[2].trim());
                    }
                }
            }

            // Store header row for column name extraction
            if (isHeaderRow && headerRowCells.length === 0) {
                headerRowCells = cellValues;
            }

            const row: TableCell[] = cellValues.map((value, col) => ({
                value,
                row: dataRowIndex,
                col: col + 1, // 1-indexed like org-mode
                isHeader: isHeaderRow,
                isHline: false,
            }));
            cells.push(row);
            maxCols = Math.max(maxCols, cellValues.length);
            dataRowIndex++;
        }
    }

    // Extract column names from header row
    for (let i = 0; i < headerRowCells.length; i++) {
        const name = headerRowCells[i].trim();
        if (name && !name.startsWith('<') && !name.match(/^[-\+]+$/)) {
            // Store column name -> column number (1-indexed)
            columnNames.set(name.toLowerCase(), i + 1);
        }
    }

    // Count only non-header, non-hline rows as data rows
    const totalRows = cells.filter(row => !row[0]?.isHline).length;
    const headerRowCount = firstHlineSeen ? firstDataRow - 1 : 0;
    const dataRowCount = totalRows - headerRowCount;

    return {
        name: tableName,
        cells,
        startLine,
        endLine,
        tblfmLine,
        formulas,
        columnCount: maxCols,
        dataRowCount,
        firstDataRow,
        parameters,
        columnNames,
    };
}

function isTableLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|');
}

/**
 * Parse a table row into cells (delegates to tableProvider's robust parser)
 */
function parseTableRow(line: string): string[] {
    return parseRow(line);
}

// =============================================================================
// Formula Parsing
// =============================================================================

/**
 * Parse #+TBLFM: line into individual formulas
 */
export function parseFormulas(tblfmContent: string): TableFormula[] {
    const formulas: TableFormula[] = [];

    // Split by :: for multiple formulas
    const parts = tblfmContent.split('::').map(s => s.trim()).filter(s => s);

    for (const part of parts) {
        const formula = parseFormula(part);
        if (formula) {
            formulas.push(formula);
        }
    }

    return formulas;
}

/**
 * Parse a single formula like $3=$1+$2 or @2$4=vsum(@2$1..@2$3)
 */
function parseFormula(formulaStr: string): TableFormula | null {
    // Match target=expression;format
    const match = formulaStr.match(/^([^=]+)=(.+?)(?:;(.+))?$/);
    if (!match) {
        return null;
    }

    const [, targetStr, expression, format] = match;
    const target = parseFormulaTarget(targetStr.trim());

    if (!target) {
        return null;
    }

    return {
        raw: formulaStr,
        target,
        expression: expression.trim(),
        format: format?.trim(),
    };
}

/**
 * Parse a row reference that may be numeric, @> (last), @< (first), or @-N (relative)
 * Returns the row specifier string for later resolution
 */
function parseRowRef(rowStr: string): string | number | null {
    if (rowStr === '>') return '>';
    if (rowStr === '<') return '<';
    if (rowStr === 'I') return 'I'; // First hline
    if (rowStr === 'II') return 'II'; // Second hline
    if (rowStr === 'III') return 'III'; // Third hline
    const relMatch = rowStr.match(/^-(\d+)$/);
    if (relMatch) return `-${relMatch[1]}`;
    const numMatch = rowStr.match(/^(\d+)$/);
    if (numMatch) return parseInt(numMatch[1], 10);
    return null;
}

/**
 * Parse formula target (left side of =)
 */
function parseFormulaTarget(targetStr: string): FormulaTarget | null {
    // Column reference: $3
    const colMatch = targetStr.match(/^\$(\d+)$/);
    if (colMatch) {
        return {
            type: 'column',
            column: parseInt(colMatch[1], 10),
        };
    }

    // Field reference with special rows: @>$3, @<$3, @-1$3, @2$3
    const fieldMatch = targetStr.match(/^@([><I]{1,3}|-?\d+)\$(\d+)$/);
    if (fieldMatch) {
        const rowRef = parseRowRef(fieldMatch[1]);
        if (rowRef !== null) {
            return {
                type: 'field',
                row: rowRef,
                column: parseInt(fieldMatch[2], 10),
            };
        }
    }

    // Range reference with special rows: @2$1..@>$3, @2$1..@-1$3
    const rangeMatch = targetStr.match(/^@([><I]{1,3}|-?\d+)\$(\d+)\.\.@([><I]{1,3}|-?\d+)\$(\d+)$/);
    if (rangeMatch) {
        const startRow = parseRowRef(rangeMatch[1]);
        const endRow = parseRowRef(rangeMatch[3]);
        if (startRow !== null && endRow !== null) {
            return {
                type: 'range',
                row: startRow,
                column: parseInt(rangeMatch[2], 10),
                endRow: endRow,
                endColumn: parseInt(rangeMatch[4], 10),
            };
        }
    }

    return null;
}

// =============================================================================
// Expression Evaluation
// =============================================================================

/**
 * Resolve a named reference to its value
 * Checks: table parameters > document constants > column names
 */
function resolveNamedReference(name: string, context: EvalContext): string | null {
    // Check table parameters first (from $ rows)
    if (context.table.parameters.has(name)) {
        return context.table.parameters.get(name)!;
    }

    // Check document constants (from #+CONSTANTS:)
    if (context.constants.has(name)) {
        return context.constants.get(name)!;
    }

    // Check column names - returns column number as string for use in formulas
    const lowerName = name.toLowerCase();
    if (context.table.columnNames.has(lowerName)) {
        // Return the value from the column in the current row
        const col = context.table.columnNames.get(lowerName)!;
        return String(getCellValue(context.table, context.currentRow, col));
    }

    return null;
}

/**
 * Resolve a relative column reference ($+N or $-N) to absolute column number
 */
function resolveRelativeColumn(offset: number, context: EvalContext): number {
    return context.currentCol + offset;
}

/**
 * Resolve a relative row reference (@+N or @-N) to absolute row number
 */
function resolveRelativeRow(offset: number, context: EvalContext): number {
    return context.currentRow + offset;
}

/**
 * Evaluate a formula expression
 */
export function evaluateExpression(
    expression: string,
    context: EvalContext,
    formatFlags?: string
): number | string {
    try {
        // Replace cell references with values
        let evalExpr = expression;

        // Check if we need duration mode (T, U, t flags)
        const durationMode = !!(formatFlags && /[TUt]/.test(formatFlags));

        // Replace range functions first (with duration support)
        evalExpr = evalExpr.replace(
            /v(sum|mean|min|max|count|prod)\(([^)]+)\)/gi,
            (_, func, rangeExpr) => {
                const values = resolveRange(rangeExpr.trim(), context, durationMode);
                const nums = values.map(v => {
                    if (durationMode && isDuration(v)) {
                        return parseDuration(v) ?? 0;
                    }
                    return parseFloat(v);
                }).filter(n => !isNaN(n));
                return String(evaluateFunction(func.toLowerCase(), nums));
            }
        );

        // Replace remote references
        evalExpr = evalExpr.replace(
            /remote\(([^,]+),\s*([^)]+)\)/gi,
            (_, tableName, cellRef) => {
                const remoteTable = context.namedTables.get(tableName.trim());
                if (!remoteTable) {
                    return '0';
                }
                const remoteContext: EvalContext = {
                    ...context,
                    table: remoteTable,
                };
                return String(resolveCellRef(cellRef.trim(), remoteContext, durationMode));
            }
        );

        // Replace @0$0 (current cell) first
        evalExpr = evalExpr.replace(
            /@0\$0/g,
            () => {
                return String(getCellValueForEval(
                    context.table,
                    context.currentRow,
                    context.currentCol,
                    durationMode
                ));
            }
        );

        // Replace @0$C (current row, specific column)
        evalExpr = evalExpr.replace(
            /@0\$(\d+)/g,
            (_, col) => {
                return String(getCellValueForEval(
                    context.table,
                    context.currentRow,
                    parseInt(col, 10),
                    durationMode
                ));
            }
        );

        // Replace @R$0 (specific row, current column)
        evalExpr = evalExpr.replace(
            /@([><]|[+-]?\d+)\$0/g,
            (_, rowRef) => {
                const row = resolveRowRefInExpr(rowRef, context.table, context.currentRow);
                return String(getCellValueForEval(
                    context.table,
                    row,
                    context.currentCol,
                    durationMode
                ));
            }
        );

        // Replace field references @R$C (R can be >, <, 0, +N, -N, or number)
        // Also support relative columns $+N, $-N
        evalExpr = evalExpr.replace(
            /@([><]|[+-]?\d+)\$([+-]?\d+)/g,
            (_, rowRef, colRef) => {
                const row = resolveRowRefInExpr(rowRef, context.table, context.currentRow);
                let col: number;
                if (colRef.startsWith('+') || colRef.startsWith('-')) {
                    col = resolveRelativeColumn(parseInt(colRef, 10), context);
                } else {
                    col = parseInt(colRef, 10);
                }
                return String(getCellValueForEval(
                    context.table,
                    row,
                    col,
                    durationMode
                ));
            }
        );

        // Replace relative column references $+N or $-N with current row
        evalExpr = evalExpr.replace(
            /\$([+-]\d+)/g,
            (_, offset) => {
                const col = resolveRelativeColumn(parseInt(offset, 10), context);
                return String(getCellValueForEval(
                    context.table,
                    context.currentRow,
                    col,
                    durationMode
                ));
            }
        );

        // Replace named references $name (must come before $N to avoid conflicts)
        evalExpr = evalExpr.replace(
            /\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
            (match, name) => {
                const value = resolveNamedReference(name, context);
                if (value !== null) {
                    // If duration mode and value is duration, convert to seconds
                    if (durationMode && isDuration(value)) {
                        return String(parseDuration(value) ?? 0);
                    }
                    const num = parseFloat(value);
                    return isNaN(num) ? value : String(num);
                }
                return match; // Keep original if not found
            }
        );

        // Replace absolute column references $C with current row
        evalExpr = evalExpr.replace(
            /\$(\d+)/g,
            (_, col) => {
                return String(getCellValueForEval(
                    context.table,
                    context.currentRow,
                    parseInt(col, 10),
                    durationMode
                ));
            }
        );

        // Replace special references
        evalExpr = evalExpr.replace(/@#/g, String(context.table.dataRowCount));
        evalExpr = evalExpr.replace(/\$#/g, String(context.table.columnCount));
        evalExpr = evalExpr.replace(/@>/g, String(context.table.dataRowCount));
        evalExpr = evalExpr.replace(/@</g, '1');
        evalExpr = evalExpr.replace(/\$>/g, String(context.table.columnCount));
        evalExpr = evalExpr.replace(/\$</g, '1');
        // Replace @0 and $0 that might remain
        evalExpr = evalExpr.replace(/@0/g, String(context.currentRow));
        evalExpr = evalExpr.replace(/\$0/g, String(context.currentCol));

        // Handle power operator (^ -> **)
        evalExpr = evalExpr.replace(/\^/g, '**');

        // Evaluate the expression safely
        return safeEval(evalExpr);
    } catch (error) {
        return `#ERROR: ${error}`;
    }
}

/**
 * Get cell value for evaluation, with optional duration conversion
 */
function getCellValueForEval(
    table: ParsedTable,
    row: number,
    col: number,
    durationMode?: boolean
): number | string {
    const value = getCellValue(table, row, col);
    if (durationMode && typeof value === 'string' && isDuration(value)) {
        return parseDuration(value) ?? 0;
    }
    return value;
}

/**
 * Count total data rows (excluding hlines) in the table
 */
function countDataRows(table: ParsedTable): number {
    let count = 0;
    for (const row of table.cells) {
        if (row.length > 0 && !row[0].isHline) {
            count++;
        }
    }
    return count;
}

/**
 * Resolve a row reference string to data row index (1-indexed, skipping hlines)
 * This matches org-mode's row numbering where @1 is first data row, @2 is second, etc.
 * @param rowStr - Row reference string: number, '>', '<', '0', '+N', '-N'
 * @param table - The parsed table
 * @param currentRow - Current row for @0 and relative references
 */
function resolveRowRefInExpr(rowStr: string, table: ParsedTable, currentRow?: number): number {
    if (rowStr === '>') {
        // @> means last data row
        return countDataRows(table);
    }
    if (rowStr === '<') {
        // @< means first data row
        return 1;
    }
    if (rowStr === '0') {
        // @0 means current row
        return currentRow ?? 1;
    }
    // Handle @+N (relative forward from current row)
    const forwardMatch = rowStr.match(/^\+(\d+)$/);
    if (forwardMatch) {
        const offset = parseInt(forwardMatch[1], 10);
        return (currentRow ?? 1) + offset;
    }
    // Handle @-N (relative backward from current row or last data row if no current)
    const backMatch = rowStr.match(/^-(\d+)$/);
    if (backMatch) {
        const offset = parseInt(backMatch[1], 10);
        if (currentRow !== undefined) {
            // Relative to current row
            return currentRow - offset;
        }
        // Fallback: relative to last data row (org-mode behavior for TBLFM)
        const lastDataRow = countDataRows(table);
        return lastDataRow - offset;
    }
    return parseInt(rowStr, 10);
}

/**
 * Resolve a range reference to array of values
 * @param durationMode - If true, keep duration strings as-is for later parsing
 */
function resolveRange(rangeExpr: string, context: EvalContext, durationMode?: boolean): string[] {
    const values: string[] = [];

    // Parse range with special row refs @R1$C1..@R2$C2 where R can be >, <, 0, +N, -N, or number
    const rangeMatch = rangeExpr.match(/@([><0]|[+-]?\d+)\$([+-]?\d+)\.\.@([><0]|[+-]?\d+)\$([+-]?\d+)/);
    if (rangeMatch) {
        const startRow = resolveRowRefInExpr(rangeMatch[1], context.table, context.currentRow);
        let startCol = rangeMatch[2].match(/^[+-]/)
            ? context.currentCol + parseInt(rangeMatch[2], 10)
            : parseInt(rangeMatch[2], 10);
        const endRow = resolveRowRefInExpr(rangeMatch[3], context.table, context.currentRow);
        let endCol = rangeMatch[4].match(/^[+-]/)
            ? context.currentCol + parseInt(rangeMatch[4], 10)
            : parseInt(rangeMatch[4], 10);

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const val = getCellValue(context.table, r, c);
                values.push(String(val));
            }
        }
        return values;
    }

    // Parse column range $C1..$C2 (current row, columns C1 to C2)
    // Also supports relative columns: $+1..$+3 or $1..$+2
    const colRangeMatch = rangeExpr.match(/\$([+-]?\d+)\.\.\$([+-]?\d+)/);
    if (colRangeMatch) {
        let startCol = colRangeMatch[1].match(/^[+-]/)
            ? context.currentCol + parseInt(colRangeMatch[1], 10)
            : parseInt(colRangeMatch[1], 10);
        let endCol = colRangeMatch[2].match(/^[+-]/)
            ? context.currentCol + parseInt(colRangeMatch[2], 10)
            : parseInt(colRangeMatch[2], 10);

        // Use the current row from context (set by applyFormulas)
        const row = context.currentRow;
        for (let c = startCol; c <= endCol; c++) {
            const val = getCellValue(context.table, row, c);
            values.push(String(val));
        }
        return values;
    }

    // Parse single column $C (all data rows)
    const colMatch = rangeExpr.match(/^\$(\d+)$/);
    if (colMatch) {
        const col = parseInt(colMatch[1], 10);
        for (let r = 1; r <= context.table.dataRowCount; r++) {
            const val = getCellValue(context.table, r, col);
            values.push(String(val));
        }
        return values;
    }

    // Parse row range @R$C1..@R$C2 (same row, different columns) - supports special row refs
    const rowRangeMatch = rangeExpr.match(/@([><0]|[+-]?\d+)\$([+-]?\d+)\.\.@([><0]|[+-]?\d+)\$([+-]?\d+)/);
    if (rowRangeMatch) {
        const row = resolveRowRefInExpr(rowRangeMatch[1], context.table, context.currentRow);
        let startCol = rowRangeMatch[2].match(/^[+-]/)
            ? context.currentCol + parseInt(rowRangeMatch[2], 10)
            : parseInt(rowRangeMatch[2], 10);
        let endCol = rowRangeMatch[4].match(/^[+-]/)
            ? context.currentCol + parseInt(rowRangeMatch[4], 10)
            : parseInt(rowRangeMatch[4], 10);

        for (let c = startCol; c <= endCol; c++) {
            const val = getCellValue(context.table, row, c);
            values.push(String(val));
        }
        return values;
    }

    return values;
}

/**
 * Resolve a single cell reference
 * @param durationMode - If true and value is duration, return seconds as number
 */
function resolveCellRef(cellRef: string, context: EvalContext, durationMode?: boolean): number | string {
    // Handle @0$0 (current cell)
    if (cellRef === '@0$0') {
        return getCellValueForEval(context.table, context.currentRow, context.currentCol, durationMode);
    }

    // Handle special row refs like @>$2, @<$2, @0$2, @+1$2, @-1$2
    // Also supports relative columns: @2$+1, @2$-1
    const match = cellRef.match(/@([><0]|[+-]?\d+)\$([+-]?\d+)/);
    if (match) {
        const row = resolveRowRefInExpr(match[1], context.table, context.currentRow);
        let col = match[2].match(/^[+-]/)
            ? context.currentCol + parseInt(match[2], 10)
            : parseInt(match[2], 10);
        return getCellValueForEval(context.table, row, col, durationMode);
    }
    return 0;
}

/**
 * Get cell value from table
 */
function getCellValue(table: ParsedTable, row: number, col: number): number | string {
    // Find the actual row (skip hlines)
    let dataRowIndex = 0;
    for (const cellRow of table.cells) {
        if (cellRow[0]?.isHline) {
            continue;
        }
        dataRowIndex++;
        if (dataRowIndex === row) {
            const cell = cellRow.find(c => c.col === col);
            if (cell) {
                const num = parseFloat(cell.value);
                return isNaN(num) ? cell.value : num;
            }
            return '';
        }
    }
    return '';
}

/**
 * Evaluate spreadsheet functions
 */
function evaluateFunction(func: string, values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    switch (func) {
        case 'sum':
        case 'vsum':
            return values.reduce((a, b) => a + b, 0);

        case 'mean':
        case 'vmean':
            return values.reduce((a, b) => a + b, 0) / values.length;

        case 'min':
        case 'vmin':
            return Math.min(...values);

        case 'max':
        case 'vmax':
            return Math.max(...values);

        case 'count':
        case 'vcount':
            return values.length;

        case 'prod':
        case 'vprod':
            return values.reduce((a, b) => a * b, 1);

        case 'sdev':
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
            return Math.sqrt(variance);

        default:
            return 0;
    }
}

/**
 * Safe expression evaluator (no eval())
 */
function safeEval(expr: string): number {
    // Tokenize
    const tokens = tokenize(expr);

    // Parse and evaluate
    return parseExpression(tokens, 0).value;
}

interface Token {
    type: 'number' | 'operator' | 'paren';
    value: string | number;
}

function tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < expr.length) {
        const ch = expr[i];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        if (/[\d.]/.test(ch)) {
            let num = '';
            while (i < expr.length && /[\d.eE\-]/.test(expr[i])) {
                num += expr[i];
                i++;
            }
            tokens.push({ type: 'number', value: parseFloat(num) });
            continue;
        }

        // Check for ** (power) operator BEFORE single *
        if (ch === '*' && expr[i + 1] === '*') {
            tokens.push({ type: 'operator', value: '**' });
            i += 2;
            continue;
        }

        if ('+-*/%'.includes(ch)) {
            // Handle unary minus
            if (ch === '-' && (tokens.length === 0 || tokens[tokens.length - 1].type === 'operator' || tokens[tokens.length - 1].value === '(')) {
                let num = '-';
                i++;
                while (i < expr.length && /[\d.eE]/.test(expr[i])) {
                    num += expr[i];
                    i++;
                }
                tokens.push({ type: 'number', value: parseFloat(num) });
                continue;
            }
            tokens.push({ type: 'operator', value: ch });
            i++;
            continue;
        }

        if ('()'.includes(ch)) {
            tokens.push({ type: 'paren', value: ch });
            i++;
            continue;
        }

        i++;
    }

    return tokens;
}

interface ParseResult {
    value: number;
    pos: number;
}

function parseExpression(tokens: Token[], pos: number): ParseResult {
    let result = parseTerm(tokens, pos);

    while (result.pos < tokens.length) {
        const token = tokens[result.pos];
        if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
            const right = parseTerm(tokens, result.pos + 1);
            if (token.value === '+') {
                result.value += right.value;
            } else {
                result.value -= right.value;
            }
            result.pos = right.pos;
        } else {
            break;
        }
    }

    return result;
}

function parseTerm(tokens: Token[], pos: number): ParseResult {
    let result = parsePower(tokens, pos);

    while (result.pos < tokens.length) {
        const token = tokens[result.pos];
        if (token.type === 'operator' && (token.value === '*' || token.value === '/' || token.value === '%')) {
            const right = parsePower(tokens, result.pos + 1);
            if (token.value === '*') {
                result.value *= right.value;
            } else if (token.value === '/') {
                result.value /= right.value;
            } else {
                result.value %= right.value;
            }
            result.pos = right.pos;
        } else {
            break;
        }
    }

    return result;
}

function parsePower(tokens: Token[], pos: number): ParseResult {
    let result = parseFactor(tokens, pos);

    if (result.pos < tokens.length) {
        const token = tokens[result.pos];
        if (token.type === 'operator' && token.value === '**') {
            const right = parsePower(tokens, result.pos + 1);
            result.value = Math.pow(result.value, right.value);
            result.pos = right.pos;
        }
    }

    return result;
}

function parseFactor(tokens: Token[], pos: number): ParseResult {
    if (pos >= tokens.length) {
        return { value: 0, pos };
    }

    const token = tokens[pos];

    if (token.type === 'number') {
        return { value: token.value as number, pos: pos + 1 };
    }

    if (token.type === 'paren' && token.value === '(') {
        const result = parseExpression(tokens, pos + 1);
        if (result.pos < tokens.length && tokens[result.pos].value === ')') {
            result.pos++;
        }
        return result;
    }

    return { value: 0, pos: pos + 1 };
}

// =============================================================================
// Formula Application
// =============================================================================

/**
 * Resolve a row reference (number or special) to data row index
 * @param rowRef - Row reference: number, '>' (last), '<' (first data), '-N' (relative to last)
 * @param table - The parsed table
 * @param currentRow - Current row for relative references (optional)
 * @returns Data row index (1-indexed, skipping hlines)
 */
function resolveRowRef(rowRef: number | string, table: ParsedTable, currentRow?: number): number {
    if (typeof rowRef === 'number') {
        return rowRef;
    }

    // @> means last data row
    if (rowRef === '>') {
        return countDataRows(table);
    }

    // @< means first data row
    if (rowRef === '<') {
        return 1;
    }

    // @I, @II, @III - find data row after nth hline
    if (rowRef.match(/^I{1,3}$/)) {
        const targetHline = rowRef.length;
        let hlineCount = 0;
        let dataRowCount = 0;
        for (let i = 0; i < table.cells.length; i++) {
            if (table.cells[i].length > 0 && table.cells[i][0].isHline) {
                hlineCount++;
                if (hlineCount === targetHline) {
                    // Return the data row index of the row after this hline
                    return dataRowCount + 1;
                }
            } else {
                dataRowCount++;
            }
        }
        // Fallback to last data row if hline not found
        return countDataRows(table);
    }

    // @-N means N rows before the last data row
    const relMatch = rowRef.match(/^-(\d+)$/);
    if (relMatch) {
        const offset = parseInt(relMatch[1], 10);
        const lastDataRow = countDataRows(table);
        return lastDataRow - offset;
    }

    return 1; // Fallback
}

/**
 * Apply all formulas to a table and return updated cell values
 */
export function applyFormulas(
    table: ParsedTable,
    document: vscode.TextDocument,
    namedTables: Map<string, ParsedTable>,
    constants?: Map<string, string>
): Map<string, string> {
    const updates = new Map<string, string>();

    for (const formula of table.formulas) {
        const context: EvalContext = {
            table,
            currentRow: 1,
            currentCol: 1,
            document,
            namedTables,
            constants: constants ?? new Map(),
        };

        switch (formula.target.type) {
            case 'column': {
                // Apply formula to all data rows in the column (skip header rows)
                const col = formula.target.column!;
                const startRow = table.firstDataRow;
                const endRow = table.firstDataRow + table.dataRowCount - 1;
                for (let row = startRow; row <= endRow; row++) {
                    context.currentRow = row;
                    context.currentCol = col;
                    const result = evaluateExpression(formula.expression, context, formula.format);
                    const formatted = formatResult(result, formula.format);
                    updates.set(`@${row}$${col}`, formatted);
                }
                break;
            }

            case 'field': {
                // Apply formula to single cell - resolve special row refs
                const row = resolveRowRef(formula.target.row!, table);
                const col = formula.target.column!;
                context.currentRow = row;
                context.currentCol = col;
                const result = evaluateExpression(formula.expression, context, formula.format);
                const formatted = formatResult(result, formula.format);
                updates.set(`@${row}$${col}`, formatted);
                break;
            }

            case 'range': {
                // Apply formula to range of cells - resolve special row refs
                const startRow = resolveRowRef(formula.target.row!, table);
                const startCol = formula.target.column!;
                const endRow = resolveRowRef(formula.target.endRow!, table);
                const endCol = formula.target.endColumn!;

                for (let row = startRow; row <= endRow; row++) {
                    for (let col = startCol; col <= endCol; col++) {
                        context.currentRow = row;
                        context.currentCol = col;
                        const result = evaluateExpression(formula.expression, context, formula.format);
                        const formatted = formatResult(result, formula.format);
                        updates.set(`@${row}$${col}`, formatted);
                    }
                }
                break;
            }
        }
    }

    return updates;
}

/**
 * Format result according to format string
 * Supports:
 * - %.2f, %d, %.0f%% (with %% -> literal %)
 * - T flag: format as HH:MM:SS duration (result is seconds)
 * - U flag: format as HH:MM duration (result is seconds)
 * - t flag: format as decimal hours (result is seconds)
 */
function formatResult(result: number | string, format?: string): string {
    if (typeof result === 'string') {
        return result;
    }

    if (!format) {
        // Default: remove trailing zeros for decimals
        if (Number.isInteger(result)) {
            return String(result);
        }
        return result.toFixed(2).replace(/\.?0+$/, '');
    }

    // Check for duration format flags first (T, U, t)
    // These expect the result to be in seconds
    if (format.includes('T')) {
        // Format as HH:MM:SS
        return formatDurationHMS(result);
    }
    if (format.includes('U')) {
        // Format as HH:MM (no seconds)
        return formatDurationHM(result);
    }
    if (format.includes('t')) {
        // Format as decimal hours
        return formatDurationDecimalHours(result);
    }

    // Parse format string (e.g., "%.2f", "%d", "%.0f%%")
    // Capture the format specifier and any suffix (like %%)
    const match = format.match(/^%(\d+)?\.?(\d+)?([dfseg])(.*)$/i);
    if (!match) {
        return String(result);
    }

    const [, width, precision, type, suffix] = match;
    let formatted: string;

    switch (type.toLowerCase()) {
        case 'd':
            formatted = String(Math.round(result));
            break;
        case 'f':
            formatted = precision ? result.toFixed(parseInt(precision, 10)) : result.toFixed(2);
            break;
        case 'e':
            formatted = precision ? result.toExponential(parseInt(precision, 10)) : result.toExponential();
            break;
        case 's':
            formatted = String(result);
            break;
        default:
            formatted = String(result);
    }

    if (width) {
        const w = parseInt(width, 10);
        formatted = formatted.padStart(w, ' ');
    }

    // Handle suffix: %% becomes %, other chars passed through
    if (suffix) {
        const processedSuffix = suffix.replace(/%%/g, '%');
        formatted += processedSuffix;
    }

    return formatted;
}

// =============================================================================
// Table Update
// =============================================================================

/**
 * Generate updated table text with formula results
 */
export function generateUpdatedTable(
    document: vscode.TextDocument,
    table: ParsedTable,
    updates: Map<string, string>
): string {
    const lines: string[] = [];

    let dataRowIndex = 0;
    for (let i = table.startLine; i <= table.endLine; i++) {
        const originalLine = document.lineAt(i).text;

        if (/^\s*\|[-\+]+\|\s*$/.test(originalLine)) {
            // Separator line - keep as is
            lines.push(originalLine);
            continue;
        }

        dataRowIndex++;
        const cells = parseTableRow(originalLine);
        const updatedCells: string[] = [];

        for (let col = 1; col <= cells.length; col++) {
            const key = `@${dataRowIndex}$${col}`;
            const updatedValue = updates.get(key);
            updatedCells.push(updatedValue !== undefined ? updatedValue : cells[col - 1]);
        }

        // Calculate column widths for alignment
        lines.push(formatTableRow(updatedCells));
    }

    return lines.join('\n');
}

/**
 * Format a table row with proper alignment
 */
function formatTableRow(cells: string[]): string {
    return '| ' + cells.join(' | ') + ' |';
}

/**
 * Parse #+CONSTANTS: lines from document to extract named constants
 * Format: #+CONSTANTS: name1=value1 name2=value2 ...
 */
export function parseDocumentConstants(document: vscode.TextDocument): Map<string, string> {
    const constants = new Map<string, string>();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/^#\+CONSTANTS:\s*(.+)$/i);
        if (match) {
            // Parse name=value pairs (space-separated)
            const pairs = match[1].split(/\s+/);
            for (const pair of pairs) {
                const [name, value] = pair.split('=');
                if (name && value !== undefined) {
                    constants.set(name.trim(), value.trim());
                }
            }
        }
    }

    return constants;
}

/**
 * Recalculate table and get edit
 */
export function recalculateTable(
    document: vscode.TextDocument,
    position: vscode.Position
): { range: vscode.Range; newText: string } | null {
    const table = parseTableAt(document, position);
    if (!table || table.formulas.length === 0) {
        return null;
    }

    // Find all named tables in the document for remote references
    const namedTables = findNamedTables(document);

    // Parse document-level constants
    const constants = parseDocumentConstants(document);

    // Apply formulas
    const updates = applyFormulas(table, document, namedTables, constants);
    if (updates.size === 0) {
        return null;
    }

    // Generate updated table
    const newText = generateUpdatedTable(document, table, updates);

    return {
        range: new vscode.Range(table.startLine, 0, table.endLine, document.lineAt(table.endLine).text.length),
        newText,
    };
}

/**
 * Find all named tables in the document
 */
function findNamedTables(document: vscode.TextDocument): Map<string, ParsedTable> {
    const tables = new Map<string, ParsedTable>();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const nameMatch = line.match(/^#\+NAME:\s*(.+)$/i);
        if (nameMatch && i + 1 < document.lineCount) {
            const nextLine = document.lineAt(i + 1).text;
            if (isTableLine(nextLine)) {
                const table = parseTableAt(document, new vscode.Position(i + 1, 0));
                if (table) {
                    tables.set(nameMatch[1].trim(), table);
                }
            }
        }
    }

    return tables;
}

// =============================================================================
// Commands
// =============================================================================

export function registerTableFormulaCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        // Recalculate table
        vscode.commands.registerCommand('scimax.table.recalculate', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const result = recalculateTable(editor.document, editor.selection.active);
            if (!result) {
                vscode.window.showInformationMessage('No table with formulas found at cursor');
                return;
            }

            await editor.edit(editBuilder => {
                editBuilder.replace(result.range, result.newText);
            });

            // Align the table after recalculating
            await vscode.commands.executeCommand('scimax.table.align');

            vscode.window.showInformationMessage('Table recalculated');
        }),

        // Insert column formula
        vscode.commands.registerCommand('scimax.table.insertColumnFormula', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const table = parseTableAt(editor.document, editor.selection.active);
            if (!table) {
                vscode.window.showWarningMessage('No table found at cursor');
                return;
            }

            // Prompt for target column
            const targetCol = await vscode.window.showInputBox({
                prompt: 'Target column number (e.g., 3)',
                placeHolder: '3',
            });
            if (!targetCol) return;

            // Prompt for formula
            const formula = await vscode.window.showInputBox({
                prompt: 'Formula (e.g., $1+$2, vsum($1..$2))',
                placeHolder: '$1+$2',
            });
            if (!formula) return;

            // Insert or update #+TBLFM: line
            const tblfmStr = `$${targetCol}=${formula}`;

            if (table.tblfmLine !== undefined) {
                // Append to existing TBLFM line
                const existingLine = editor.document.lineAt(table.tblfmLine).text;
                const newLine = existingLine + '::' + tblfmStr;
                await editor.edit(editBuilder => {
                    editBuilder.replace(
                        new vscode.Range(table.tblfmLine!, 0, table.tblfmLine!, existingLine.length),
                        newLine
                    );
                });
            } else {
                // Insert new TBLFM line
                const insertPos = new vscode.Position(table.endLine + 1, 0);
                await editor.edit(editBuilder => {
                    editBuilder.insert(insertPos, `#+TBLFM: ${tblfmStr}\n`);
                });
            }

            // Recalculate
            vscode.commands.executeCommand('scimax.table.recalculate');
        }),

        // Insert field formula
        vscode.commands.registerCommand('scimax.table.insertFieldFormula', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const table = parseTableAt(editor.document, editor.selection.active);
            if (!table) {
                vscode.window.showWarningMessage('No table found at cursor');
                return;
            }

            // Prompt for target cell
            const targetCell = await vscode.window.showInputBox({
                prompt: 'Target cell (e.g., @2$3)',
                placeHolder: '@2$3',
            });
            if (!targetCell) return;

            // Prompt for formula
            const formula = await vscode.window.showInputBox({
                prompt: 'Formula (e.g., vsum(@2$1..@2$2))',
                placeHolder: 'vsum(@2$1..@2$2)',
            });
            if (!formula) return;

            // Insert or update #+TBLFM: line
            const tblfmStr = `${targetCell}=${formula}`;

            if (table.tblfmLine !== undefined) {
                const existingLine = editor.document.lineAt(table.tblfmLine).text;
                const newLine = existingLine + '::' + tblfmStr;
                await editor.edit(editBuilder => {
                    editBuilder.replace(
                        new vscode.Range(table.tblfmLine!, 0, table.tblfmLine!, existingLine.length),
                        newLine
                    );
                });
            } else {
                const insertPos = new vscode.Position(table.endLine + 1, 0);
                await editor.edit(editBuilder => {
                    editBuilder.insert(insertPos, `#+TBLFM: ${tblfmStr}\n`);
                });
            }

            vscode.commands.executeCommand('scimax.table.recalculate');
        }),

        // Show table formula help
        vscode.commands.registerCommand('scimax.table.formulaHelp', () => {
            const helpText = `
# Org Table Formula Reference

## Cell References

### Column References
- \`$1\`, \`$2\`, \`$3\`... - Absolute column by number
- \`$0\` - Current column
- \`$+1\`, \`$-2\` - Relative to current column
- \`$<\`, \`$>\` - First/last column
- \`$#\` - Total number of columns

### Row References
- \`@1\`, \`@2\`, \`@3\`... - Absolute row by number
- \`@0\` - Current row
- \`@+1\`, \`@-2\` - Relative to current row
- \`@<\`, \`@>\` - First/last row
- \`@I\`, \`@II\`, \`@III\` - First/second/third hline
- \`@#\` - Total number of rows

### Field References
- \`@2$3\` - Cell at row 2, column 3
- \`@0$0\` - Current cell
- \`@+1$-1\` - Relative references

### Range References
- \`@2$1..@5$3\` - Rectangle from @2$1 to @5$3
- \`$2..$5\` - Columns 2-5 in current row
- \`@2$1..@2$4\` - Row 2, columns 1-4

## Named References

### Table Parameters (in $ rows)
\`\`\`
| $max=100 | $rate=0.15 |
\`\`\`
Then use \`$max\` or \`$rate\` in formulas.

### Document Constants
\`\`\`
#+CONSTANTS: pi=3.14159 tax=0.08
\`\`\`
Then use \`$pi\` or \`$tax\` in formulas.

### Column Names
Header row names can be used: \`$Price\`, \`$Quantity\`

## Remote References
- \`remote(tablename, @2$3)\` - Reference cell from another table
- Tables named with \`#+NAME: tablename\`

## Functions
- \`vsum(range)\` - Sum of values
- \`vmean(range)\` - Average of values
- \`vmin(range)\` - Minimum value
- \`vmax(range)\` - Maximum value
- \`vcount(range)\` - Count of values
- \`vprod(range)\` - Product of values
- \`sdev(range)\` - Standard deviation

## Operators
- \`+\`, \`-\`, \`*\`, \`/\` - Basic arithmetic
- \`^\` or \`**\` - Power
- \`%\` - Modulo

## Format Specifiers

### Number Formats
- \`;%.2f\` - 2 decimal places
- \`;%d\` - Integer
- \`;%.0f%%\` - Percentage

### Duration Formats (for time values like 1:30:00)
- \`;T\` - Output as HH:MM:SS
- \`;U\` - Output as HH:MM (no seconds)
- \`;t\` - Output as decimal hours (1.5)

## Examples

### Basic Calculations
- \`$3=$1+$2\` - Column 3 = Column 1 + Column 2
- \`@5$3=vsum(@2$3..@4$3)\` - Sum of column 3, rows 2-4
- \`@2$4=vsum(@2$1..@2$3)\` - Sum of row 2, columns 1-3

### Duration Calculations
- \`$3=$1+$2;T\` - Add time columns, format as HH:MM:SS
- \`@>$2=vsum(@2$2..@-1$2);U\` - Sum times, format as HH:MM

### Using Parameters
- \`$4=$2*$rate\` - Use table parameter
- \`$3=$1*$tax\` - Use document constant
`;
            const doc = { content: helpText, language: 'markdown' };
            vscode.workspace.openTextDocument(doc).then(d => vscode.window.showTextDocument(d));
        }),

        // Toggle formula highlighting
        vscode.commands.registerCommand('scimax.table.toggleFormulaHighlight', async () => {
            formulaHighlightEnabled = !formulaHighlightEnabled;
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                if (formulaHighlightEnabled) {
                    updateFormulaHighlighting(editor);
                    vscode.window.showInformationMessage('Formula highlighting enabled');
                } else {
                    clearFormulaHighlighting(editor);
                    vscode.window.showInformationMessage('Formula highlighting disabled');
                }
            }
        })
    );

    // Register event handlers for formula highlighting
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && formulaHighlightEnabled) {
                updateFormulaHighlighting(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === event.document && formulaHighlightEnabled) {
                updateFormulaHighlighting(editor);
            }
        }),
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (formulaHighlightEnabled) {
                updateFormulaHighlighting(event.textEditor);
            }
        })
    );
}

// =============================================================================
// Formula Highlighting
// =============================================================================

let formulaHighlightEnabled = false;

// Decoration types for formula highlighting
const formulaTargetDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(100, 200, 100, 0.3)',
    border: '1px solid rgba(100, 200, 100, 0.6)',
});

const formulaSourceDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(100, 150, 255, 0.2)',
    border: '1px dashed rgba(100, 150, 255, 0.5)',
});

const formulaLineDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 200, 100, 0.15)',
});

/**
 * Update formula highlighting for the current editor
 */
function updateFormulaHighlighting(editor: vscode.TextEditor): void {
    const document = editor.document;
    if (!document.fileName.endsWith('.org')) {
        clearFormulaHighlighting(editor);
        return;
    }

    const position = editor.selection.active;
    const table = parseTableAt(document, position);

    if (!table || table.formulas.length === 0) {
        clearFormulaHighlighting(editor);
        return;
    }

    const targetDecorations: vscode.DecorationOptions[] = [];
    const sourceDecorations: vscode.DecorationOptions[] = [];
    const tblfmDecorations: vscode.DecorationOptions[] = [];

    // Highlight the TBLFM line
    if (table.tblfmLine !== undefined) {
        const tblfmLineText = document.lineAt(table.tblfmLine).text;
        tblfmDecorations.push({
            range: new vscode.Range(table.tblfmLine, 0, table.tblfmLine, tblfmLineText.length),
        });
    }

    // For each formula, highlight targets and sources
    for (const formula of table.formulas) {
        // Find target cells
        const targetCells = getFormulaCells(formula.target, table);
        for (const cell of targetCells) {
            const range = getCellRange(document, table, cell.row, cell.col);
            if (range) {
                targetDecorations.push({
                    range,
                    hoverMessage: `Formula target: ${formula.raw}`,
                });
            }
        }

        // Find source cells referenced in the expression
        const sourceCells = extractReferencedCells(formula.expression, table);
        for (const cell of sourceCells) {
            const range = getCellRange(document, table, cell.row, cell.col);
            if (range) {
                sourceDecorations.push({
                    range,
                    hoverMessage: `Referenced in formula`,
                });
            }
        }
    }

    editor.setDecorations(formulaTargetDecorationType, targetDecorations);
    editor.setDecorations(formulaSourceDecorationType, sourceDecorations);
    editor.setDecorations(formulaLineDecorationType, tblfmDecorations);
}

/**
 * Clear all formula highlighting
 */
function clearFormulaHighlighting(editor: vscode.TextEditor): void {
    editor.setDecorations(formulaTargetDecorationType, []);
    editor.setDecorations(formulaSourceDecorationType, []);
    editor.setDecorations(formulaLineDecorationType, []);
}

/**
 * Get all cells affected by a formula target
 */
function getFormulaCells(target: FormulaTarget, table: ParsedTable): Array<{row: number, col: number}> {
    const cells: Array<{row: number, col: number}> = [];

    switch (target.type) {
        case 'column': {
            const col = target.column!;
            const startRow = table.firstDataRow;
            const endRow = table.firstDataRow + table.dataRowCount - 1;
            for (let row = startRow; row <= endRow; row++) {
                cells.push({ row, col });
            }
            break;
        }
        case 'field': {
            const row = resolveRowRef(target.row!, table);
            const col = target.column!;
            cells.push({ row, col });
            break;
        }
        case 'range': {
            const startRow = resolveRowRef(target.row!, table);
            const startCol = target.column!;
            const endRow = resolveRowRef(target.endRow!, table);
            const endCol = target.endColumn!;
            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    cells.push({ row, col });
                }
            }
            break;
        }
    }

    return cells;
}

/**
 * Extract all cell references from a formula expression
 */
function extractReferencedCells(expression: string, table: ParsedTable): Array<{row: number, col: number}> {
    const cells: Array<{row: number, col: number}> = [];
    const seen = new Set<string>();

    // Match @R$C references
    const fieldMatches = expression.matchAll(/@([><0]|[+-]?\d+)\$([+-]?\d+)/g);
    for (const match of fieldMatches) {
        const row = resolveRowRefInExpr(match[1], table);
        const col = parseInt(match[2], 10);
        const key = `${row},${col}`;
        if (!seen.has(key) && row > 0 && col > 0) {
            seen.add(key);
            cells.push({ row, col });
        }
    }

    // Match range references for expanding
    const rangeMatches = expression.matchAll(/@([><0]|[+-]?\d+)\$(\d+)\.\.@([><0]|[+-]?\d+)\$(\d+)/g);
    for (const match of rangeMatches) {
        const startRow = resolveRowRefInExpr(match[1], table);
        const startCol = parseInt(match[2], 10);
        const endRow = resolveRowRefInExpr(match[3], table);
        const endCol = parseInt(match[4], 10);
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const key = `${r},${c}`;
                if (!seen.has(key) && r > 0 && c > 0) {
                    seen.add(key);
                    cells.push({ row: r, col: c });
                }
            }
        }
    }

    return cells;
}

/**
 * Get the text range for a specific cell in the table
 */
function getCellRange(
    document: vscode.TextDocument,
    table: ParsedTable,
    dataRow: number,
    col: number
): vscode.Range | null {
    // Find the document line for this data row
    let currentDataRow = 0;
    let lineIndex = table.startLine;

    for (let i = 0; i < table.cells.length; i++) {
        const row = table.cells[i];
        if (row.length > 0 && !row[0].isHline) {
            currentDataRow++;
            if (currentDataRow === dataRow) {
                // Found the row, now find the column
                const lineText = document.lineAt(lineIndex).text;
                const cellPositions = getCellPositions(lineText);

                if (col >= 1 && col <= cellPositions.length) {
                    const { start, end } = cellPositions[col - 1];
                    return new vscode.Range(lineIndex, start, lineIndex, end);
                }
                return null;
            }
        }
        lineIndex++;
    }

    return null;
}

/**
 * Get start and end positions of each cell in a table row
 */
function getCellPositions(line: string): Array<{start: number, end: number}> {
    const positions: Array<{start: number, end: number}> = [];
    let inCell = false;
    let cellStart = 0;

    for (let i = 0; i < line.length; i++) {
        if (line[i] === '|') {
            if (inCell) {
                // End of cell (trim whitespace)
                let start = cellStart;
                let end = i;
                // Trim leading whitespace
                while (start < end && line[start] === ' ') start++;
                // Trim trailing whitespace
                while (end > start && line[end - 1] === ' ') end--;
                positions.push({ start, end });
            }
            inCell = true;
            cellStart = i + 1;
        }
    }

    return positions;
}
