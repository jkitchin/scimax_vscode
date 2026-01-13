/**
 * Org-mode Table Formula Evaluator
 * Implements #+TBLFM: spreadsheet-like calculations
 *
 * Supports:
 * - Column references: $1, $2, $3, ...
 * - Field references: @2$3 (row 2, column 3)
 * - Range references: @2$1..@5$3
 * - Special references: $# (column count), @# (row count)
 * - Remote table references: remote(tablename, @2$3)
 * - Functions: vsum, vmean, vmin, vmax, vcount, etc.
 * - Basic arithmetic: +, -, *, /, ^, %
 */

import * as vscode from 'vscode';

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
    row?: number;
    endColumn?: number;
    endRow?: number;
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
    let maxCols = 0;
    let dataRowIndex = 0;

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
        } else {
            const cellValues = parseTableRow(lineText);
            const row: TableCell[] = cellValues.map((value, col) => ({
                value,
                row: dataRowIndex,
                col: col + 1, // 1-indexed like org-mode
                isHeader: dataRowIndex === 0 && cells.length === 0,
                isHline: false,
            }));
            cells.push(row);
            maxCols = Math.max(maxCols, cellValues.length);
            dataRowIndex++;
        }
    }

    return {
        name: tableName,
        cells,
        startLine,
        endLine,
        tblfmLine,
        formulas,
        columnCount: maxCols,
        dataRowCount: cells.filter(row => !row[0]?.isHline).length,
    };
}

function isTableLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function parseTableRow(line: string): string[] {
    const trimmed = line.trim().slice(1, -1); // Remove outer |
    return trimmed.split('|').map(cell => cell.trim());
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

    // Field reference: @2$3
    const fieldMatch = targetStr.match(/^@(\d+)\$(\d+)$/);
    if (fieldMatch) {
        return {
            type: 'field',
            row: parseInt(fieldMatch[1], 10),
            column: parseInt(fieldMatch[2], 10),
        };
    }

    // Range reference: @2$1..@5$3
    const rangeMatch = targetStr.match(/^@(\d+)\$(\d+)\.\.@(\d+)\$(\d+)$/);
    if (rangeMatch) {
        return {
            type: 'range',
            row: parseInt(rangeMatch[1], 10),
            column: parseInt(rangeMatch[2], 10),
            endRow: parseInt(rangeMatch[3], 10),
            endColumn: parseInt(rangeMatch[4], 10),
        };
    }

    return null;
}

// =============================================================================
// Expression Evaluation
// =============================================================================

/**
 * Evaluate a formula expression
 */
export function evaluateExpression(
    expression: string,
    context: EvalContext
): number | string {
    try {
        // Replace cell references with values
        let evalExpr = expression;

        // Replace range functions first
        evalExpr = evalExpr.replace(
            /v(sum|mean|min|max|count|prod)\(([^)]+)\)/gi,
            (_, func, rangeExpr) => {
                const values = resolveRange(rangeExpr.trim(), context);
                const nums = values.map(v => parseFloat(v)).filter(n => !isNaN(n));
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
                return String(resolveCellRef(cellRef.trim(), remoteContext));
            }
        );

        // Replace field references @R$C
        evalExpr = evalExpr.replace(
            /@(\d+)\$(\d+)/g,
            (_, row, col) => {
                return String(getCellValue(
                    context.table,
                    parseInt(row, 10),
                    parseInt(col, 10)
                ));
            }
        );

        // Replace column references $C with current row
        evalExpr = evalExpr.replace(
            /\$(\d+)/g,
            (_, col) => {
                return String(getCellValue(
                    context.table,
                    context.currentRow,
                    parseInt(col, 10)
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

        // Handle power operator (^ -> **)
        evalExpr = evalExpr.replace(/\^/g, '**');

        // Evaluate the expression safely
        return safeEval(evalExpr);
    } catch (error) {
        return `#ERROR: ${error}`;
    }
}

/**
 * Resolve a range reference to array of values
 */
function resolveRange(rangeExpr: string, context: EvalContext): string[] {
    const values: string[] = [];

    // Parse range @R1$C1..@R2$C2
    const rangeMatch = rangeExpr.match(/@(\d+)\$(\d+)\.\.@(\d+)\$(\d+)/);
    if (rangeMatch) {
        const startRow = parseInt(rangeMatch[1], 10);
        const startCol = parseInt(rangeMatch[2], 10);
        const endRow = parseInt(rangeMatch[3], 10);
        const endCol = parseInt(rangeMatch[4], 10);

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const val = getCellValue(context.table, r, c);
                values.push(String(val));
            }
        }
        return values;
    }

    // Parse column range $C1..$C2 (all data rows)
    const colRangeMatch = rangeExpr.match(/\$(\d+)\.\.\$(\d+)/);
    if (colRangeMatch) {
        const startCol = parseInt(colRangeMatch[1], 10);
        const endCol = parseInt(colRangeMatch[2], 10);

        for (let r = 1; r <= context.table.dataRowCount; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const val = getCellValue(context.table, r, c);
                values.push(String(val));
            }
        }
        return values;
    }

    // Parse single column $C (all data rows)
    const colMatch = rangeExpr.match(/\$(\d+)/);
    if (colMatch) {
        const col = parseInt(colMatch[1], 10);
        for (let r = 1; r <= context.table.dataRowCount; r++) {
            const val = getCellValue(context.table, r, col);
            values.push(String(val));
        }
        return values;
    }

    // Parse row range @R$C1..@R$C2 (same row, different columns)
    const rowRangeMatch = rangeExpr.match(/@(\d+)\$(\d+)\.\.@\1\$(\d+)/);
    if (rowRangeMatch) {
        const row = parseInt(rowRangeMatch[1], 10);
        const startCol = parseInt(rowRangeMatch[2], 10);
        const endCol = parseInt(rowRangeMatch[3], 10);

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
 */
function resolveCellRef(cellRef: string, context: EvalContext): number | string {
    const match = cellRef.match(/@(\d+)\$(\d+)/);
    if (match) {
        return getCellValue(
            context.table,
            parseInt(match[1], 10),
            parseInt(match[2], 10)
        );
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

        if (ch === '*' && expr[i + 1] === '*') {
            tokens.push({ type: 'operator', value: '**' });
            i += 2;
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
 * Apply all formulas to a table and return updated cell values
 */
export function applyFormulas(
    table: ParsedTable,
    document: vscode.TextDocument,
    namedTables: Map<string, ParsedTable>
): Map<string, string> {
    const updates = new Map<string, string>();

    for (const formula of table.formulas) {
        const context: EvalContext = {
            table,
            currentRow: 1,
            currentCol: 1,
            document,
            namedTables,
        };

        switch (formula.target.type) {
            case 'column': {
                // Apply formula to all data rows in the column
                const col = formula.target.column!;
                for (let row = 1; row <= table.dataRowCount; row++) {
                    context.currentRow = row;
                    context.currentCol = col;
                    const result = evaluateExpression(formula.expression, context);
                    const formatted = formatResult(result, formula.format);
                    updates.set(`@${row}$${col}`, formatted);
                }
                break;
            }

            case 'field': {
                // Apply formula to single cell
                const row = formula.target.row!;
                const col = formula.target.column!;
                context.currentRow = row;
                context.currentCol = col;
                const result = evaluateExpression(formula.expression, context);
                const formatted = formatResult(result, formula.format);
                updates.set(`@${row}$${col}`, formatted);
                break;
            }

            case 'range': {
                // Apply formula to range of cells
                const startRow = formula.target.row!;
                const startCol = formula.target.column!;
                const endRow = formula.target.endRow!;
                const endCol = formula.target.endColumn!;

                for (let row = startRow; row <= endRow; row++) {
                    for (let col = startCol; col <= endCol; col++) {
                        context.currentRow = row;
                        context.currentCol = col;
                        const result = evaluateExpression(formula.expression, context);
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

    // Parse format string (e.g., "%.2f", "%d", "%s")
    const match = format.match(/%(\d+)?\.?(\d+)?([dfseg])/i);
    if (!match) {
        return String(result);
    }

    const [, width, precision, type] = match;
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

    // Apply formulas
    const updates = applyFormulas(table, document, namedTables);
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
- $1, $2, $3... - Column by number
- @2$3 - Cell at row 2, column 3
- @2$1..@2$5 - Range from @2$1 to @2$5
- $# - Total number of columns
- @# - Total number of rows

## Functions
- vsum(range) - Sum of values
- vmean(range) - Average of values
- vmin(range) - Minimum value
- vmax(range) - Maximum value
- vcount(range) - Count of values
- vprod(range) - Product of values

## Operators
- +, -, *, / - Basic arithmetic
- ^ or ** - Power
- % - Modulo

## Examples
- $3=$1+$2 - Column 3 = Column 1 + Column 2
- @5$3=vsum(@2$3..@4$3) - Sum of column 3, rows 2-4
- @2$4=vsum(@2$1..@2$3) - Sum of row 2, columns 1-3

## Format Specifiers
- ;%.2f - 2 decimal places
- ;%d - Integer
- ;%.0f - No decimals
`;
            const doc = { content: helpText, language: 'markdown' };
            vscode.workspace.openTextDocument(doc).then(d => vscode.window.showTextDocument(d));
        })
    );
}
