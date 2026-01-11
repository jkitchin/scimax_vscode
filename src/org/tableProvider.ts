import * as vscode from 'vscode';

/**
 * Table manipulation for org-mode and markdown tables
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

interface TableInfo {
    startLine: number;
    endLine: number;
    rows: string[][];
    separatorLines: number[]; // Lines that are separator rows (|---|)
    columnWidths: number[];
}

/**
 * Check if a line is a table row
 */
function isTableRow(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|');
}

/**
 * Check if a line is a separator row
 */
function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim();
    if (!isTableRow(line)) return false;
    // Separator rows contain only |, -, +, :, and spaces
    return /^\|[\s\-\+\:]+\|$/.test(trimmed.replace(/\|/g, '|'));
}

/**
 * Parse a table row into cells
 */
function parseRow(line: string): string[] {
    const trimmed = line.trim();
    // Remove leading and trailing |, then split by |
    const inner = trimmed.slice(1, -1);
    return inner.split('|').map(cell => cell.trim());
}

/**
 * Find the table boundaries around the cursor
 */
function findTableAtCursor(document: vscode.TextDocument, position: vscode.Position): TableInfo | null {
    const currentLine = document.lineAt(position.line).text;

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
    let maxColumns = 0;

    for (let i = startLine; i <= endLine; i++) {
        const line = document.lineAt(i).text;
        if (isSeparatorRow(line)) {
            separatorLines.push(i);
            rows.push([]); // Placeholder for separator
        } else {
            const cells = parseRow(line);
            rows.push(cells);
            maxColumns = Math.max(maxColumns, cells.length);
        }
    }

    // Calculate column widths
    const columnWidths: number[] = new Array(maxColumns).fill(0);
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            columnWidths[i] = Math.max(columnWidths[i], row[i].length);
        }
    }

    return {
        startLine,
        endLine,
        rows,
        separatorLines,
        columnWidths
    };
}

/**
 * Format a row with proper alignment
 */
function formatRow(cells: string[], columnWidths: number[]): string {
    const paddedCells = cells.map((cell, i) => {
        const width = columnWidths[i] || cell.length;
        return cell.padEnd(width);
    });
    return '| ' + paddedCells.join(' | ') + ' |';
}

/**
 * Format a separator row
 * For org mode: dashes must be width+2 to account for the space padding in data rows
 * Data row:  | cell | = "| " + cell.padEnd(w) + " |"
 * Separator: |------+  = "|" + "-".repeat(w+2) + "+"
 */
function formatSeparator(columnWidths: number[], isOrg: boolean): string {
    if (isOrg) {
        // Each column section in data row is: " " + cell(w) + " " = w+2 chars
        const dashes = columnWidths.map(w => '-'.repeat(w + 2));
        return '|' + dashes.join('+') + '|';
    } else {
        // Markdown uses spaces around the dashes too
        const dashes = columnWidths.map(w => '-'.repeat(Math.max(w, 1)));
        return '| ' + dashes.join(' | ') + ' |';
    }
}

/**
 * Get column index at cursor position
 * Column 0 is between first | and second |, etc.
 */
function getColumnAtCursor(line: string, cursorCol: number): number {
    if (!isTableRow(line)) return -1;

    // Count how many | characters appear before the cursor
    let pipeCount = 0;
    for (let i = 0; i < cursorCol && i < line.length; i++) {
        if (line[i] === '|') {
            pipeCount++;
        }
    }

    // Column index is pipeCount - 1 (first pipe starts column 0)
    return Math.max(0, pipeCount - 1);
}

/**
 * Check if cursor is in a table
 */
export function isInTable(document: vscode.TextDocument, position: vscode.Position): boolean {
    return isTableRow(document.lineAt(position.line).text);
}

/**
 * Move the current row up
 */
export async function moveRowUp(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const currentRowIndex = position.line - table.startLine;

    // Can't move first row up
    if (currentRowIndex <= 0) return false;

    // Don't swap with separator rows in a way that breaks structure
    const prevRowIndex = currentRowIndex - 1;

    // Get the actual lines
    const currentLineNum = position.line;
    const prevLineNum = currentLineNum - 1;

    const currentLineText = document.lineAt(currentLineNum).text;
    const prevLineText = document.lineAt(prevLineNum).text;

    // Swap the lines
    await editor.edit(editBuilder => {
        const currentRange = new vscode.Range(currentLineNum, 0, currentLineNum, currentLineText.length);
        const prevRange = new vscode.Range(prevLineNum, 0, prevLineNum, prevLineText.length);

        editBuilder.replace(currentRange, prevLineText);
        editBuilder.replace(prevRange, currentLineText);
    });

    // Move cursor up with the row
    const newPosition = new vscode.Position(prevLineNum, position.character);
    editor.selection = new vscode.Selection(newPosition, newPosition);

    return true;
}

/**
 * Move the current row down
 */
export async function moveRowDown(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const currentRowIndex = position.line - table.startLine;

    // Can't move last row down
    if (currentRowIndex >= table.rows.length - 1) return false;

    const currentLineNum = position.line;
    const nextLineNum = currentLineNum + 1;

    const currentLineText = document.lineAt(currentLineNum).text;
    const nextLineText = document.lineAt(nextLineNum).text;

    // Swap the lines
    await editor.edit(editBuilder => {
        const currentRange = new vscode.Range(currentLineNum, 0, currentLineNum, currentLineText.length);
        const nextRange = new vscode.Range(nextLineNum, 0, nextLineNum, nextLineText.length);

        editBuilder.replace(currentRange, nextLineText);
        editBuilder.replace(nextRange, currentLineText);
    });

    // Move cursor down with the row
    const newPosition = new vscode.Position(nextLineNum, position.character);
    editor.selection = new vscode.Selection(newPosition, newPosition);

    return true;
}

/**
 * Calculate cursor position for a specific column in a formatted row
 */
function getCursorPositionForColumn(columnWidths: number[], targetCol: number): number {
    // Start after the first |
    let pos = 2; // "| "
    for (let i = 0; i < targetCol; i++) {
        pos += columnWidths[i] + 3; // width + " | "
    }
    return pos;
}

/**
 * Move the current column left
 */
export async function moveColumnLeft(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const line = document.lineAt(position.line).text;
    const colIndex = getColumnAtCursor(line, position.character);

    // Can't move first column left
    if (colIndex <= 0) return false;

    const isOrg = document.languageId === 'org';

    // First pass: swap columns and collect new cells
    const newRows: string[][] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newRows.push([]); // Placeholder for separator
        } else {
            const cells = parseRow(lineText);
            // Swap columns
            if (colIndex < cells.length && colIndex - 1 >= 0) {
                [cells[colIndex - 1], cells[colIndex]] = [cells[colIndex], cells[colIndex - 1]];
            }
            newRows.push(cells);
        }
    }

    // Recalculate column widths after swap
    const newColumnWidths: number[] = [];
    for (const row of newRows) {
        for (let i = 0; i < row.length; i++) {
            newColumnWidths[i] = Math.max(newColumnWidths[i] || 0, row[i].length, 1);
        }
    }

    // Second pass: format with new widths
    const newLines: string[] = [];
    for (let i = 0; i < newRows.length; i++) {
        const lineNum = table.startLine + i;
        if (table.separatorLines.includes(lineNum)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg));
        } else {
            newLines.push(formatRow(newRows[i], newColumnWidths));
        }
    }

    // Apply changes
    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });

    // Move cursor to follow the column (now at colIndex - 1)
    const newCursorCol = getCursorPositionForColumn(newColumnWidths, colIndex - 1);
    const newPosition = new vscode.Position(position.line, newCursorCol);
    editor.selection = new vscode.Selection(newPosition, newPosition);

    return true;
}

/**
 * Move the current column right
 */
export async function moveColumnRight(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const line = document.lineAt(position.line).text;
    const colIndex = getColumnAtCursor(line, position.character);

    // Find max columns
    const maxCols = Math.max(...table.rows.map(r => r.length));

    // Can't move last column right
    if (colIndex >= maxCols - 1) return false;

    const isOrg = document.languageId === 'org';

    // First pass: swap columns and collect new cells
    const newRows: string[][] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newRows.push([]); // Placeholder for separator
        } else {
            const cells = parseRow(lineText);
            // Swap columns
            if (colIndex < cells.length - 1) {
                [cells[colIndex], cells[colIndex + 1]] = [cells[colIndex + 1], cells[colIndex]];
            }
            newRows.push(cells);
        }
    }

    // Recalculate column widths after swap
    const newColumnWidths: number[] = [];
    for (const row of newRows) {
        for (let i = 0; i < row.length; i++) {
            newColumnWidths[i] = Math.max(newColumnWidths[i] || 0, row[i].length, 1);
        }
    }

    // Second pass: format with new widths
    const newLines: string[] = [];
    for (let i = 0; i < newRows.length; i++) {
        const lineNum = table.startLine + i;
        if (table.separatorLines.includes(lineNum)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg));
        } else {
            newLines.push(formatRow(newRows[i], newColumnWidths));
        }
    }

    // Apply changes
    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });

    // Move cursor to follow the column (now at colIndex + 1)
    const newCursorCol = getCursorPositionForColumn(newColumnWidths, colIndex + 1);
    const newPosition = new vscode.Position(position.line, newCursorCol);
    editor.selection = new vscode.Selection(newPosition, newPosition);

    return true;
}

/**
 * Insert a new row below current
 */
export async function insertRowBelow(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    // Create a new empty row with same number of columns
    const currentRow = table.rows[position.line - table.startLine];
    const numCols = currentRow ? currentRow.length : table.columnWidths.length;
    const emptyCells = new Array(numCols).fill('');
    const newRow = formatRow(emptyCells, table.columnWidths);

    // Insert after current line
    await editor.edit(editBuilder => {
        const insertPosition = new vscode.Position(position.line + 1, 0);
        editBuilder.insert(insertPosition, newRow + '\n');
    });

    // Move cursor to new row
    const newPosition = new vscode.Position(position.line + 1, position.character);
    editor.selection = new vscode.Selection(newPosition, newPosition);

    return true;
}

/**
 * Insert a new row above current
 */
export async function insertRowAbove(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    // Create a new empty row with same number of columns
    const currentRow = table.rows[position.line - table.startLine];
    const numCols = currentRow ? currentRow.length : table.columnWidths.length;
    const emptyCells = new Array(numCols).fill('');
    const newRow = formatRow(emptyCells, table.columnWidths);

    // Insert before current line
    await editor.edit(editBuilder => {
        const insertPosition = new vscode.Position(position.line, 0);
        editBuilder.insert(insertPosition, newRow + '\n');
    });

    // Cursor stays on same line number (which is now the new row)
    return true;
}

/**
 * Delete current row
 */
export async function deleteRow(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    // Don't delete if only one data row remains
    const dataRows = table.rows.filter((_, i) => !table.separatorLines.includes(table.startLine + i));
    if (dataRows.length <= 1) {
        vscode.window.showInformationMessage('Cannot delete the last row');
        return false;
    }

    // Delete current line
    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            position.line, 0,
            position.line + 1, 0
        );
        editBuilder.delete(range);
    });

    return true;
}

/**
 * Insert a new column to the right
 */
export async function insertColumnRight(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const line = document.lineAt(position.line).text;
    const colIndex = getColumnAtCursor(line, position.character);
    const isOrg = document.languageId === 'org';

    // Add new column after current
    const newColumnWidths = [...table.columnWidths];
    newColumnWidths.splice(colIndex + 1, 0, 3); // Default width of 3

    const newLines: string[] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg));
        } else {
            const cells = parseRow(lineText);
            cells.splice(colIndex + 1, 0, '');
            newLines.push(formatRow(cells, newColumnWidths));
        }
    }

    // Apply changes
    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });

    return true;
}

/**
 * Delete current column
 */
export async function deleteColumn(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const line = document.lineAt(position.line).text;
    const colIndex = getColumnAtCursor(line, position.character);
    const isOrg = document.languageId === 'org';

    // Don't delete if only one column remains
    if (table.columnWidths.length <= 1) {
        vscode.window.showInformationMessage('Cannot delete the last column');
        return false;
    }

    // Remove column
    const newColumnWidths = [...table.columnWidths];
    newColumnWidths.splice(colIndex, 1);

    const newLines: string[] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg));
        } else {
            const cells = parseRow(lineText);
            cells.splice(colIndex, 1);
            newLines.push(formatRow(cells, newColumnWidths));
        }
    }

    // Apply changes
    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });

    return true;
}

/**
 * Align/format the entire table
 */
export async function alignTable(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const isOrg = document.languageId === 'org';

    // Recalculate column widths
    const columnWidths: number[] = [];
    for (const row of table.rows) {
        for (let i = 0; i < row.length; i++) {
            columnWidths[i] = Math.max(columnWidths[i] || 0, row[i].length, 1);
        }
    }

    // Reformat all rows
    const newLines: string[] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newLines.push(formatSeparator(columnWidths, isOrg));
        } else {
            const cells = parseRow(lineText);
            // Pad cells array to match column count
            while (cells.length < columnWidths.length) {
                cells.push('');
            }
            newLines.push(formatRow(cells, columnWidths));
        }
    }

    // Apply changes
    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });

    return true;
}

/**
 * Create a new table
 */
export async function createTable(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const rowsInput = await vscode.window.showInputBox({
        prompt: 'Number of rows (excluding header)',
        value: '3',
        validateInput: (v) => /^\d+$/.test(v) ? null : 'Enter a number'
    });
    if (!rowsInput) return;

    const colsInput = await vscode.window.showInputBox({
        prompt: 'Number of columns',
        value: '3',
        validateInput: (v) => /^\d+$/.test(v) ? null : 'Enter a number'
    });
    if (!colsInput) return;

    const rows = parseInt(rowsInput);
    const cols = parseInt(colsInput);
    const isOrg = editor.document.languageId === 'org';

    const columnWidths = new Array(cols).fill(10);
    const emptyCells = new Array(cols).fill('');
    const headerCells = new Array(cols).fill(0).map((_, i) => `col${i + 1}`);

    const lines: string[] = [];
    lines.push(formatRow(headerCells, columnWidths));
    lines.push(formatSeparator(columnWidths, isOrg));
    for (let i = 0; i < rows; i++) {
        lines.push(formatRow([...emptyCells], columnWidths));
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, lines.join('\n') + '\n');
    });
}

/**
 * Navigate to next cell (Tab)
 */
export async function nextCell(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;

    if (!isInTable(document, position)) return false;

    const line = document.lineAt(position.line).text;

    // Find next | after cursor
    let nextPipe = line.indexOf('|', position.character + 1);

    if (nextPipe === -1 || nextPipe >= line.length - 1) {
        // Move to next row
        if (position.line < document.lineCount - 1) {
            const nextLine = document.lineAt(position.line + 1).text;
            if (isTableRow(nextLine)) {
                // Skip separator rows
                let targetLine = position.line + 1;
                while (targetLine < document.lineCount && isSeparatorRow(document.lineAt(targetLine).text)) {
                    targetLine++;
                }
                if (targetLine < document.lineCount && isTableRow(document.lineAt(targetLine).text)) {
                    const firstPipe = document.lineAt(targetLine).text.indexOf('|');
                    const newPos = new vscode.Position(targetLine, firstPipe + 2);
                    editor.selection = new vscode.Selection(newPos, newPos);
                    return true;
                }
            }
        }
        return false;
    }

    // Move to start of next cell
    const newPos = new vscode.Position(position.line, nextPipe + 2);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Navigate to previous cell (Shift+Tab)
 */
export async function prevCell(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;

    if (!isInTable(document, position)) return false;

    const line = document.lineAt(position.line).text;

    // Find previous | before cursor
    let prevPipe = line.lastIndexOf('|', position.character - 2);

    if (prevPipe <= 0) {
        // Move to previous row
        if (position.line > 0) {
            let targetLine = position.line - 1;
            while (targetLine >= 0 && isSeparatorRow(document.lineAt(targetLine).text)) {
                targetLine--;
            }
            if (targetLine >= 0 && isTableRow(document.lineAt(targetLine).text)) {
                const prevLineText = document.lineAt(targetLine).text;
                const lastPipe = prevLineText.lastIndexOf('|', prevLineText.length - 2);
                const newPos = new vscode.Position(targetLine, lastPipe + 2);
                editor.selection = new vscode.Selection(newPos, newPos);
                return true;
            }
        }
        return false;
    }

    // Find the pipe before that one
    const prevPrevPipe = line.lastIndexOf('|', prevPipe - 1);
    const newPos = new vscode.Position(position.line, (prevPrevPipe >= 0 ? prevPrevPipe : 0) + 2);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Insert separator row below current
 */
export async function insertSeparator(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const isOrg = document.languageId === 'org';
    const separator = formatSeparator(table.columnWidths, isOrg);

    await editor.edit(editBuilder => {
        const insertPosition = new vscode.Position(position.line + 1, 0);
        editBuilder.insert(insertPosition, separator + '\n');
    });

    return true;
}

/**
 * Register table commands
 */
export function registerTableCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.table.moveRowUp', moveRowUp),
        vscode.commands.registerCommand('scimax.table.moveRowDown', moveRowDown),
        vscode.commands.registerCommand('scimax.table.moveColumnLeft', moveColumnLeft),
        vscode.commands.registerCommand('scimax.table.moveColumnRight', moveColumnRight),
        vscode.commands.registerCommand('scimax.table.insertRowBelow', insertRowBelow),
        vscode.commands.registerCommand('scimax.table.insertRowAbove', insertRowAbove),
        vscode.commands.registerCommand('scimax.table.deleteRow', deleteRow),
        vscode.commands.registerCommand('scimax.table.insertColumnRight', insertColumnRight),
        vscode.commands.registerCommand('scimax.table.deleteColumn', deleteColumn),
        vscode.commands.registerCommand('scimax.table.align', alignTable),
        vscode.commands.registerCommand('scimax.table.create', createTable),
        vscode.commands.registerCommand('scimax.table.nextCell', nextCell),
        vscode.commands.registerCommand('scimax.table.prevCell', prevCell),
        vscode.commands.registerCommand('scimax.table.insertSeparator', insertSeparator)
    );
}
