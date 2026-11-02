import * as vscode from 'vscode';
import { escapeHtml } from '../utils/escapeUtils';
import { isMarkdownLike } from '../shared/markdownLike';
import {
    TableInfo,
    applyColumnSpecWidth,
    cellWidth,
    formatRow,
    formatSeparator,
    formatSpecRow,
    getCharWidth,
    getDisplayWidth,
    gfmCellAlignments,
    isSeparatorRow,
    isTableRow,
    mathSpanEnd,
    parseRow,
    parseRowSimple,
    setLinkCollapse as setCoreLinkCollapse,
    findTableAtLine,
    alignedTableLines,
    TableDocument,
} from './tableCore';

// Decoration type for hiding overflow text in truncated columns
let truncationDecorationType: vscode.TextEditorDecorationType | undefined;
let ellipsisDecorationType: vscode.TextEditorDecorationType | undefined;

/**
 * VS Code table commands for org-mode and markdown tables. Parsing and
 * formatting live in tableCore.ts.
 */

/**
 * Measure links as displayed (scimax.org.descriptiveLinks) in org tables.
 */
function setLinkCollapse(isOrg: boolean): void {
    setCoreLinkCollapse(isOrg
        && vscode.workspace.getConfiguration('scimax.org').get<boolean>('descriptiveLinks', true));
}

/**
 * Find the table boundaries around position
 */
function findTableAtCursor(document: TableDocument, position: { line: number }): TableInfo | null {
    setLinkCollapse(document.languageId === 'org');
    return findTableAtLine(document, position.line);
}

// parseRow is part of this module's public API (used by tableFormula.ts)
export { parseRow };

/**
 * Get column index at cursor position
 * Column 0 is between first | and second |, etc.
 */
function getColumnAtCursor(line: string, cursorCol: number): number {
    if (!isTableRow(line)) return -1;

    // Count pipes before the cursor, skipping escaped pipes (\|) and any
    // pipes that live inside a LaTeX math span (\(...\), \[...\], $...$, $$...$$).
    let pipeCount = 0;
    const limit = Math.min(cursorCol, line.length);
    let i = 0;
    while (i < limit) {
        const ch = line[i];

        if (ch === '\\' && line[i + 1] === '|') {
            i += 2;
            continue;
        }

        if (ch === '\\' || ch === '$') {
            const prev = i > 0 ? line[i - 1] : ' ';
            const mathEnd = mathSpanEnd(line, i, prev);
            if (mathEnd > i) {
                if (mathEnd > limit) {
                    // Cursor is inside the math span — no further pipes count.
                    break;
                }
                i = mathEnd;
                continue;
            }
        }

        if (ch === '|') {
            pipeCount++;
        }
        i++;
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

    // Get the actual lines
    const currentLineNum = position.line;
    let prevLineNum = currentLineNum - 1;

    // Markdown: the GFM delimiter row must stay line 2 of the table. It
    // cannot move, and the first body row moving up swaps with the header.
    if (table.hasGfmHeader) {
        if (currentRowIndex === 1) {
            vscode.window.showInformationMessage('Cannot move the delimiter row of a Markdown table');
            return false;
        }
        if (currentRowIndex === 2) {
            prevLineNum = table.startLine;
        }
    }

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
    let nextLineNum = currentLineNum + 1;

    // Markdown: the GFM delimiter row must stay line 2 of the table. It
    // cannot move, and the header moving down swaps with the first body row.
    if (table.hasGfmHeader) {
        if (currentRowIndex === 1) {
            vscode.window.showInformationMessage('Cannot move the delimiter row of a Markdown table');
            return false;
        }
        if (currentRowIndex === 0) {
            if (table.rows.length < 3) return false;
            nextLineNum = table.startLine + 2;
        }
    }

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
    // GFM alignment moves with its column
    const gfm = table.gfmAlignments ? [...table.gfmAlignments] : undefined;
    if (gfm && colIndex < gfm.length) {
        [gfm[colIndex - 1], gfm[colIndex]] = [gfm[colIndex], gfm[colIndex - 1]];
    }

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

    // Recalculate column widths after swap (using display width for emojis)
    const newColumnWidths: number[] = [];
    for (const row of newRows) {
        for (let i = 0; i < row.length; i++) {
            newColumnWidths[i] = Math.max(newColumnWidths[i] || 0, cellWidth(row[i]), 1);
        }
    }

    // Second pass: format with new widths
    const newLines: string[] = [];
    for (let i = 0; i < newRows.length; i++) {
        const lineNum = table.startLine + i;
        if (table.separatorLines.includes(lineNum)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg, gfm));
        } else {
            newLines.push(formatRow(newRows[i], newColumnWidths, gfmCellAlignments(gfm)));
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
    // GFM alignment moves with its column
    const gfm = table.gfmAlignments ? [...table.gfmAlignments] : undefined;
    if (gfm && colIndex < gfm.length - 1) {
        [gfm[colIndex], gfm[colIndex + 1]] = [gfm[colIndex + 1], gfm[colIndex]];
    }

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

    // Recalculate column widths after swap (using display width for emojis)
    const newColumnWidths: number[] = [];
    for (const row of newRows) {
        for (let i = 0; i < row.length; i++) {
            newColumnWidths[i] = Math.max(newColumnWidths[i] || 0, cellWidth(row[i]), 1);
        }
    }

    // Second pass: format with new widths
    const newLines: string[] = [];
    for (let i = 0; i < newRows.length; i++) {
        const lineNum = table.startLine + i;
        if (table.separatorLines.includes(lineNum)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg, gfm));
        } else {
            newLines.push(formatRow(newRows[i], newColumnWidths, gfmCellAlignments(gfm)));
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
 * A table row for the purposes of moving a single cell. Data rows are cell
 * arrays; structural rows (separators and the column spec row) are null.
 */
export type CellMoveRow = string[] | null;

export interface CellSwap {
    rows: CellMoveRow[]; // Copy of the input rows with the swap applied
    targetRow: number;   // Row the moved cell landed in
    targetCol: number;   // Column the moved cell landed in
}

/**
 * Swap the cell at (rowIndex, colIndex) with the neighbor dRow/dCol away.
 *
 * Vertical moves step over separator and column spec rows, so a cell can move
 * into or out of a header. Ragged rows are padded with empty cells so the swap
 * lands in the right column. Returns null when the move is not possible: the
 * cursor is on a structural row, or the neighbor is outside the table.
 */
export function swapCell(
    rows: CellMoveRow[],
    rowIndex: number,
    colIndex: number,
    dRow: number,
    dCol: number
): CellSwap | null {
    if (rowIndex < 0 || rowIndex >= rows.length) return null;
    if (colIndex < 0) return null;

    // Can't move a cell that isn't there
    if (!rows[rowIndex]) return null;

    const maxCols = rows.reduce((max, row) => row ? Math.max(max, row.length) : max, 0);
    if (colIndex >= maxCols) return null;

    const targetCol = colIndex + dCol;
    if (targetCol < 0 || targetCol >= maxCols) return null;

    let targetRow = rowIndex;
    if (dRow !== 0) {
        targetRow += dRow;
        // Skip separators and the spec row - they hold no cells
        while (targetRow >= 0 && targetRow < rows.length && !rows[targetRow]) {
            targetRow += dRow;
        }
        if (targetRow < 0 || targetRow >= rows.length) return null;
    }

    const newRows: CellMoveRow[] = rows.map(row => row ? [...row] : null);
    const from = newRows[rowIndex]!;
    const to = newRows[targetRow]!;

    // Pad ragged rows so both cells exist
    const needed = Math.max(colIndex, targetCol) + 1;
    while (from.length < needed) from.push('');
    while (to.length < needed) to.push('');

    // Note: for a horizontal move `from` and `to` are the same array
    const moved = from[colIndex];
    from[colIndex] = to[targetCol];
    to[targetCol] = moved;

    return { rows: newRows, targetRow, targetCol };
}

/**
 * Move the cell at the cursor by one position, swapping it with the cell it
 * displaces, then realign the table and follow the cell with the cursor.
 */
async function moveCell(dRow: number, dCol: number): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const rowIndex = position.line - table.startLine;
    const colIndex = getColumnAtCursor(document.lineAt(position.line).text, position.character);
    if (colIndex < 0) return false;

    // Separators and the spec row are empty placeholders in table.rows
    const rows: CellMoveRow[] = table.rows.map((cells, i) =>
        (table.separatorLines.includes(table.startLine + i) || i === table.specRow) ? null : cells
    );

    const swap = swapCell(rows, rowIndex, colIndex, dRow, dCol);
    if (!swap) return false;

    const isOrg = document.languageId === 'org';

    // Recalculate widths - a swap can change how wide a column needs to be
    const columnWidths: number[] = new Array(table.columnWidths.length).fill(0);
    for (const row of swap.rows) {
        if (!row) continue;
        for (let i = 0; i < row.length; i++) {
            columnWidths[i] = Math.max(columnWidths[i] || 0, cellWidth(row[i]), 1);
        }
    }
    for (let i = 0; i < columnWidths.length; i++) {
        if (i < table.columnSpecs.length) {
            columnWidths[i] = applyColumnSpecWidth(columnWidths[i], table.columnSpecs[i]);
        }
    }

    // Reformat the whole table with the new widths
    const newLines: string[] = [];
    for (let i = 0; i < swap.rows.length; i++) {
        const row = swap.rows[i];
        if (i === table.specRow) {
            newLines.push(formatSpecRow(columnWidths, table.columnAlignments, table.columnMinWidths, table.columnMaxWidths));
        } else if (!row) {
            newLines.push(formatSeparator(columnWidths, isOrg, table.gfmAlignments));
        } else {
            const cells = [...row];
            while (cells.length < columnWidths.length) {
                cells.push('');
            }
            newLines.push(formatRow(cells, columnWidths, table.columnAlignments));
        }
    }

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });

    // Follow the cell
    const newPosition = new vscode.Position(
        table.startLine + swap.targetRow,
        getCursorPositionForColumn(columnWidths, swap.targetCol)
    );
    editor.selection = new vscode.Selection(newPosition, newPosition);

    updateTruncationDecorations(editor);
    codeLensProvider?.refresh();

    return true;
}

/**
 * Move the current cell up, swapping it with the cell above
 */
export async function moveCellUp(): Promise<boolean> {
    return moveCell(-1, 0);
}

/**
 * Move the current cell down, swapping it with the cell below
 */
export async function moveCellDown(): Promise<boolean> {
    return moveCell(1, 0);
}

/**
 * Move the current cell left, swapping it with the cell to its left
 */
export async function moveCellLeft(): Promise<boolean> {
    return moveCell(0, -1);
}

/**
 * Move the current cell right, swapping it with the cell to its right
 */
export async function moveCellRight(): Promise<boolean> {
    return moveCell(0, 1);
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
    // Separator and spec rows are empty placeholders: use the table width
    const numCols = currentRow && currentRow.length ? currentRow.length : table.columnWidths.length;
    const emptyCells = new Array(numCols).fill('');
    const newRow = formatRow(emptyCells, table.columnWidths);

    // Insert after current line. Markdown: below the header means below the
    // GFM delimiter row, which must stay directly under the header.
    const insertLine = table.hasGfmHeader && position.line === table.startLine
        ? table.startLine + 2
        : position.line + 1;
    await editor.edit(editBuilder => {
        const insertPosition = new vscode.Position(insertLine, 0);
        editBuilder.insert(insertPosition, newRow + '\n');
    });

    // Move cursor to new row
    const newPosition = new vscode.Position(insertLine, position.character);
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
    // Separator and spec rows are empty placeholders: use the table width
    const numCols = currentRow && currentRow.length ? currentRow.length : table.columnWidths.length;
    const emptyCells = new Array(numCols).fill('');
    const newRow = formatRow(emptyCells, table.columnWidths);

    // Markdown: the header row and GFM delimiter row must stay together at
    // the top. Nothing can go above the header; above the delimiter means the
    // first body row.
    let insertLine = position.line;
    if (table.hasGfmHeader) {
        if (position.line === table.startLine) {
            vscode.window.showInformationMessage('Cannot insert a row above the header of a Markdown table');
            return false;
        }
        if (position.line === table.startLine + 1) {
            insertLine = table.startLine + 2;
        }
    }

    // Insert before current line
    await editor.edit(editBuilder => {
        const insertPosition = new vscode.Position(insertLine, 0);
        editBuilder.insert(insertPosition, newRow + '\n');
    });

    if (insertLine !== position.line) {
        const newPosition = new vscode.Position(insertLine, position.character);
        editor.selection = new vscode.Selection(newPosition, newPosition);
    }
    // Otherwise the cursor stays on same line number (now the new row)
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

    // Markdown: deleting the header or GFM delimiter row would leave an
    // invalid table
    if (table.hasGfmHeader && position.line <= table.startLine + 1) {
        vscode.window.showInformationMessage(position.line === table.startLine
            ? 'Cannot delete the header row of a Markdown table'
            : 'Cannot delete the delimiter row of a Markdown table');
        return false;
    }

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
 * Insert a new column to the left
 */
export async function insertColumnLeft(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const line = document.lineAt(position.line).text;
    const colIndex = getColumnAtCursor(line, position.character);
    const isOrg = document.languageId === 'org';

    // Add new column before current
    const newColumnWidths = [...table.columnWidths];
    newColumnWidths.splice(colIndex, 0, 3); // Default width of 3

    const gfm = table.gfmAlignments ? [...table.gfmAlignments] : undefined;
    gfm?.splice(colIndex, 0, null); // New column has no alignment

    const newLines: string[] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg, gfm));
        } else {
            const cells = parseRow(lineText);
            cells.splice(colIndex, 0, '');
            newLines.push(formatRow(cells, newColumnWidths, gfmCellAlignments(gfm)));
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

    const gfm = table.gfmAlignments ? [...table.gfmAlignments] : undefined;
    gfm?.splice(colIndex + 1, 0, null); // New column has no alignment

    const newLines: string[] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg, gfm));
        } else {
            const cells = parseRow(lineText);
            cells.splice(colIndex + 1, 0, '');
            newLines.push(formatRow(cells, newColumnWidths, gfmCellAlignments(gfm)));
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

    const gfm = table.gfmAlignments ? [...table.gfmAlignments] : undefined;
    gfm?.splice(colIndex, 1);

    const newLines: string[] = [];
    for (let i = table.startLine; i <= table.endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (isSeparatorRow(lineText)) {
            newLines.push(formatSeparator(newColumnWidths, isOrg, gfm));
        } else {
            const cells = parseRow(lineText);
            cells.splice(colIndex, 1);
            newLines.push(formatRow(cells, newColumnWidths, gfmCellAlignments(gfm)));
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
    return alignTableAt(editor, editor.selection.active);
}

/**
 * Align the table containing position (not necessarily the cursor's table)
 */
async function alignTableAt(editor: vscode.TextEditor, position: vscode.Position): Promise<boolean> {
    const document = editor.document;
    const table = findTableAtCursor(document, position);

    if (!table) return false;

    const newLines = alignedTableLines(document, table);

    // Apply changes
    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });

    // Update truncation decorations after alignment
    updateTruncationDecorations(editor);

    // Refresh CodeLens to update expand buttons
    codeLensProvider?.refresh();

    return true;
}

/**
 * Split delimited text into records, honouring CSV-style "..." quoting:
 * delimiters and newlines inside quotes belong to the field, "" is a quote.
 */
function splitDelimited(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                field += char;
            }
        } else if (char === '"' && field.trim() === '') {
            inQuotes = true;
            field = '';
        } else if (char === delimiter) {
            row.push(field.trim());
            field = '';
        } else if (char === '\n') {
            row.push(field.trim());
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }
    row.push(field.trim());
    rows.push(row);
    return rows;
}

/**
 * Parse pasted or selected text into table rows. Recognises Markdown/org
 * tables, then tab-, comma- or semicolon-separated values (CSV quoting
 * included), then columns separated by runs of spaces (e.g. a terminal or
 * pandas printout), and finally single whitespace. Rows are padded to the
 * same length and newlines inside a quoted field become spaces.
 */
export function parseTableText(text: string): string[][] {
    const normalized = text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
    if (!normalized) return [];
    const lines = normalized.split('\n').filter(line => line.trim() !== '');

    let rows: string[][];
    if (lines.every(line => isTableRow(line))) {
        // Already a table: drop separator rules (|---+---| or | --- | :-: |)
        rows = lines.filter(line => !isSeparatorRow(line)).map(line => parseRow(line));
    } else {
        // Pick the delimiter that splits the most lines into the same number
        // (> 1) of fields. Ties go to the earlier one, so "1,5;2,3" splits on
        // ";" (prose has far more commas than semicolons or tabs).
        let best: string[][] | undefined;
        let bestScore = 0;
        for (const delimiter of ['\t', ';', ',']) {
            const candidate = splitDelimited(normalized, delimiter).filter(r => r.some(c => c !== ''));
            const frequency = new Map<number, number>();
            for (const r of candidate) frequency.set(r.length, (frequency.get(r.length) ?? 0) + 1);
            const [mode, modeCount] = [...frequency].reduce((a, b) => (b[1] > a[1] ? b : a));
            if (mode < 2) continue;
            const score = modeCount / candidate.length;
            if (score > bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
        if (best) {
            rows = best;
        } else {
            const spaceSplit = (re: RegExp) => lines.map(line => line.trim().split(re));
            const wide = spaceSplit(/\s{2,}/);
            rows = wide.some(r => r.length > 1) ? wide : spaceSplit(/\s+/);
        }
    }

    const width = Math.max(...rows.map(r => r.length));
    return rows.map(r => {
        const cells = r.map(c => c.replace(/\s*\n\s*/g, ' '));
        while (cells.length < width) cells.push('');
        return cells;
    });
}

/**
 * Format parsed rows as aligned table lines, with a rule under the first row
 * when there is more than one. Literal pipes in cells are escaped (\vert{} in
 * org, \| in Markdown) so they do not start a new column.
 */
export function formatTableLines(rows: string[][], isOrg: boolean): string[] {
    setLinkCollapse(isOrg);
    const escaped = rows.map(r => r.map(c => c.replace(/\|/g, isOrg ? '\\vert{}' : '\\|')));
    const columnWidths: number[] = [];
    for (const row of escaped) {
        row.forEach((cell, i) => {
            columnWidths[i] = Math.max(columnWidths[i] || 1, cellWidth(cell));
        });
    }
    const lines = escaped.map(row => formatRow(row, columnWidths));
    if (lines.length > 1) {
        lines.splice(1, 0, formatSeparator(columnWidths, isOrg));
    }
    return lines;
}

/**
 * Insert table lines in place of range, or on their own lines at the cursor:
 * a mid-line cursor gets a line break first so the table starts a line.
 */
async function insertTableLines(editor: vscode.TextEditor, lines: string[], range?: vscode.Range): Promise<void> {
    const position = editor.selection.active;
    let text = lines.join('\n');
    let target: vscode.Range;
    let firstLine: number;
    if (range) {
        target = range;
        firstLine = range.start.line;
    } else {
        const lineText = editor.document.lineAt(position.line).text;
        const before = lineText.slice(0, position.character).trim() !== '';
        const after = lineText.slice(position.character).trim() !== '';
        if (before) text = '\n' + text;
        if (after || !before) text += '\n';
        target = new vscode.Range(position, position);
        firstLine = before ? position.line + 1 : position.line;
    }
    await editor.edit(editBuilder => editBuilder.replace(target, text));
    const firstCell = new vscode.Position(firstLine, 2);
    editor.selection = new vscode.Selection(firstCell, firstCell);
}

/**
 * True when text is clearly tabular (not just prose with a comma): two or
 * more lines that are already table rows, or that a tab, semicolon or comma
 * splits into the same number (> 1) of fields on every line.
 */
export function looksLikeTable(text: string): boolean {
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    const lines = normalized.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return false;
    if (lines.every(line => isTableRow(line))) return true;
    return ['\t', ';', ','].some(delimiter => {
        const counts = splitDelimited(normalized, delimiter)
            .filter(r => r.some(c => c !== ''))
            .map(r => r.length);
        return counts[0] > 1 && counts.every(n => n === counts[0]);
    });
}

/**
 * Create a table (C-c |, like Emacs org-table-create-or-convert-from-region):
 * convert the selected text, or offer the clipboard when it holds table
 * data, otherwise insert an empty table.
 */
export async function createTable(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const isOrg = editor.document.languageId === 'org';

    if (!selection.isEmpty) {
        const rows = parseTableText(editor.document.getText(selection));
        if (rows.length === 0) return;
        await insertTableLines(editor, formatTableLines(rows, isOrg), selection);
        return;
    }

    const clipboardText = await vscode.env.clipboard.readText();
    if (looksLikeTable(clipboardText)) {
        const rows = parseTableText(clipboardText);
        const choice = await vscode.window.showQuickPick([
            {
                label: `Insert table from clipboard (${rows.length} × ${rows[0].length})`,
                description: rows[0].join(' | '),
                fromClipboard: true
            },
            { label: 'Create empty table', fromClipboard: false }
        ], { placeHolder: 'Create table' });
        if (!choice) return;
        if (choice.fromClipboard) {
            await insertTableLines(editor, formatTableLines(rows, isOrg));
            return;
        }
    }

    const colsInput = await vscode.window.showInputBox({
        prompt: 'Number of columns',
        value: '3',
        validateInput: (v) => /^\d+$/.test(v) ? null : 'Enter a number'
    });
    if (!colsInput) return;

    const cols = parseInt(colsInput);
    const columnWidths = new Array(cols).fill(10);
    const emptyCells = new Array(cols).fill('');

    // Create a single row table
    const line = formatRow([...emptyCells], columnWidths);
    const insertPos = editor.selection.active;

    await editor.edit(editBuilder => {
        editBuilder.insert(insertPos, line + '\n');
    });

    // Move cursor to first cell (after the first "| ")
    const firstCellPos = new vscode.Position(insertPos.line, 2);
    editor.selection = new vscode.Selection(firstCellPos, firstCellPos);
}

/**
 * Navigate to next cell (Tab)
 * At end of last row, creates a new row below
 */
export async function nextCell(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;

    if (!isInTable(document, position)) return false;

    // Remember the cell by index: aligning can move cells along the line, so
    // the old column may land in a different cell afterwards
    const cellIdx = cellPipes(document.lineAt(position.line).text)
        .filter(p => p < position.character).length - 1;

    // First align the table to ensure consistent formatting
    await alignTable();

    const line = document.lineAt(position.line).text;
    const pipes = cellPipes(line);

    // The | closing the current cell, if another cell follows it
    const nextPipe = !isSeparatorRow(line) && cellIdx + 2 < pipes.length
        ? pipes[cellIdx + 1] : -1;

    if (nextPipe === -1) {
        // At end of row - try to move to next row
        if (position.line < document.lineCount - 1) {
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

        // At end of table - create a new row
        const table = findTableAtCursor(document, position);
        if (table) {
            // Create a new empty row with same number of columns
            const numCols = table.columnWidths.length;
            const emptyCells = new Array(numCols).fill('');
            const newRow = formatRow(emptyCells, table.columnWidths);

            // Insert after current line (or after separator if cursor is on last data row before separator)
            const insertLine = position.line;
            await editor.edit(editBuilder => {
                const insertPosition = new vscode.Position(insertLine + 1, 0);
                editBuilder.insert(insertPosition, newRow + '\n');
            });

            // Move cursor to first cell of new row
            const firstPipePos = 2; // "| "
            const newPos = new vscode.Position(insertLine + 1, firstPipePos);
            editor.selection = new vscode.Selection(newPos, newPos);
            return true;
        }

        return false;
    }

    // Move to start of next cell
    const newPos = new vscode.Position(position.line, nextPipe + 2);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Columns of the cell-separating | characters in a row (escaped \| excluded)
 */
function cellPipes(line: string): number[] {
    const pipes: number[] = [];
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '|' && line[i - 1] !== '\\') pipes.push(i);
    }
    return pipes;
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
    const prevPipe = line.lastIndexOf('|', position.character - 2);

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

    // Markdown: GFM allows only the one delimiter row, under the header. Add
    // it if the table lacks one; a second dashes row would be a body row.
    let insertLine = position.line + 1;
    if (isMarkdownLike(document.languageId)) {
        if (table.separatorLines.length > 0) {
            vscode.window.showInformationMessage('Markdown tables have a single delimiter row under the header; no separator inserted');
            return false;
        }
        insertLine = table.startLine + 1;
    }

    await editor.edit(editBuilder => {
        const insertPosition = new vscode.Position(insertLine, 0);
        editBuilder.insert(insertPosition, separator + '\n');
    });

    return true;
}

// =============================================================================
// Scimax Table Extensions - Named Tables and Export
// =============================================================================

interface NamedTable {
    name: string;
    startLine: number;
    endLine: number;
    rows: string[][];
    separatorLines: number[];
}

/**
 * Find all named tables in the document
 */
function findNamedTables(document: vscode.TextDocument): NamedTable[] {
    const tables: NamedTable[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();

        // Look for #+NAME: or #+TBLNAME:
        const nameMatch = line.match(/^#\+(NAME|TBLNAME):\s*(.+)$/i);
        if (nameMatch) {
            const name = nameMatch[2].trim();

            // Look for table starting on next line
            if (i + 1 < lines.length && isTableRow(lines[i + 1])) {
                const tableStart = i + 1;
                let tableEnd = tableStart;

                // Find table end
                for (let j = tableStart; j < lines.length; j++) {
                    if (!isTableRow(lines[j])) {
                        break;
                    }
                    tableEnd = j;
                }

                // Parse table
                const rows: string[][] = [];
                const separatorLines: number[] = [];

                for (let j = tableStart; j <= tableEnd; j++) {
                    if (isSeparatorRow(lines[j])) {
                        separatorLines.push(j - tableStart);
                        rows.push([]);
                    } else {
                        rows.push(parseRow(lines[j]));
                    }
                }

                tables.push({
                    name,
                    startLine: tableStart,
                    endLine: tableEnd,
                    rows,
                    separatorLines
                });

                i = tableEnd + 1;
                continue;
            }
        }
        i++;
    }

    return tables;
}

/**
 * Jump to a named table
 */
export async function gotoNamedTable(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const tables = findNamedTables(editor.document);

    if (tables.length === 0) {
        vscode.window.showInformationMessage('No named tables in document');
        return;
    }

    const selected = await vscode.window.showQuickPick(
        tables.map(t => ({
            label: t.name,
            description: `Line ${t.startLine + 1}`,
            detail: `${t.rows.filter(r => r.length > 0).length} rows`,
            table: t
        })),
        { placeHolder: 'Jump to table...' }
    );

    if (selected) {
        const pos = new vscode.Position(selected.table.startLine, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
}

/**
 * Get a named table's data as a 2D array
 */
export function getNamedTableData(document: vscode.TextDocument, name: string): string[][] | null {
    const tables = findNamedTables(document);
    const table = tables.find(t => t.name === name);
    if (!table) return null;

    // Return only data rows (not separator rows)
    return table.rows.filter(r => r.length > 0);
}

/**
 * Get a specific row from a named table
 */
export function getTableRow(document: vscode.TextDocument, name: string, rowIndex: number): string[] | null {
    const data = getNamedTableData(document, name);
    if (!data || rowIndex < 0 || rowIndex >= data.length) return null;
    return data[rowIndex];
}

/**
 * Get a specific column from a named table
 */
export function getTableColumn(document: vscode.TextDocument, name: string, colIndex: number): string[] | null {
    const data = getNamedTableData(document, name);
    if (!data) return null;

    const column: string[] = [];
    for (const row of data) {
        if (colIndex < row.length) {
            column.push(row[colIndex]);
        }
    }
    return column.length > 0 ? column : null;
}

/**
 * Export table to CSV format
 */
function tableToCSV(rows: string[][]): string {
    return rows
        .filter(r => r.length > 0)
        .map(row =>
            row.map(cell => {
                // Quote cells containing commas or quotes
                if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
                    return `"${cell.replace(/"/g, '""')}"`;
                }
                return cell;
            }).join(',')
        )
        .join('\n');
}

/**
 * Export table to TSV format
 */
function tableToTSV(rows: string[][]): string {
    return rows
        .filter(r => r.length > 0)
        .map(row => row.join('\t'))
        .join('\n');
}

/**
 * Export table to HTML format
 */
function tableToHTML(rows: string[][]): string {
    const dataRows = rows.filter(r => r.length > 0);
    if (dataRows.length === 0) return '';

    // escapeHtml is imported from '../utils/escapeUtils'

    let html = '<table>\n';

    // First row as header
    html += '  <thead>\n    <tr>\n';
    for (const cell of dataRows[0]) {
        html += `      <th>${escapeHtml(cell)}</th>\n`;
    }
    html += '    </tr>\n  </thead>\n';

    // Rest as body
    if (dataRows.length > 1) {
        html += '  <tbody>\n';
        for (let i = 1; i < dataRows.length; i++) {
            html += '    <tr>\n';
            for (const cell of dataRows[i]) {
                html += `      <td>${escapeHtml(cell)}</td>\n`;
            }
            html += '    </tr>\n';
        }
        html += '  </tbody>\n';
    }

    html += '</table>';
    return html;
}

/**
 * Export table to LaTeX format
 */
function tableToLaTeX(rows: string[][]): string {
    const dataRows = rows.filter(r => r.length > 0);
    if (dataRows.length === 0) return '';

    const escapeLaTeX = (str: string) =>
        str.replace(/&/g, '\\&').replace(/%/g, '\\%').replace(/_/g, '\\_');

    const numCols = Math.max(...dataRows.map(r => r.length));
    const colSpec = 'l'.repeat(numCols);

    let latex = `\\begin{tabular}{${colSpec}}\n\\hline\n`;

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i].map(escapeLaTeX);
        latex += row.join(' & ') + ' \\\\\n';
        if (i === 0) {
            latex += '\\hline\n';
        }
    }

    latex += '\\hline\n\\end{tabular}';
    return latex;
}

/**
 * Export the current table to various formats
 */
export async function exportTable(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const table = findTableAtCursor(editor.document, editor.selection.active);
    if (!table) {
        vscode.window.showInformationMessage('Not in a table');
        return;
    }

    const format = await vscode.window.showQuickPick(
        [
            { label: 'CSV', description: 'Comma-separated values' },
            { label: 'TSV', description: 'Tab-separated values' },
            { label: 'HTML', description: 'HTML table' },
            { label: 'LaTeX', description: 'LaTeX tabular' }
        ],
        { placeHolder: 'Export format' }
    );

    if (!format) return;

    let output: string;
    let extension: string;

    switch (format.label) {
        case 'CSV':
            output = tableToCSV(table.rows);
            extension = 'csv';
            break;
        case 'TSV':
            output = tableToTSV(table.rows);
            extension = 'tsv';
            break;
        case 'HTML':
            output = tableToHTML(table.rows);
            extension = 'html';
            break;
        case 'LaTeX':
            output = tableToLaTeX(table.rows);
            extension = 'tex';
            break;
        default:
            return;
    }

    const destination = await vscode.window.showQuickPick(
        [
            { label: 'Clipboard', description: 'Copy to clipboard' },
            { label: 'File', description: 'Save to file' },
            { label: 'New Tab', description: 'Open in new tab' }
        ],
        { placeHolder: 'Export destination' }
    );

    if (!destination) return;

    switch (destination.label) {
        case 'Clipboard':
            await vscode.env.clipboard.writeText(output);
            vscode.window.showInformationMessage(`Table copied to clipboard as ${format.label}`);
            break;
        case 'File':
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`table.${extension}`),
                filters: { [format.label]: [extension] }
            });
            if (uri) {
                const fs = await import('fs');
                fs.writeFileSync(uri.fsPath, output);
                vscode.window.showInformationMessage(`Table exported to ${uri.fsPath}`);
            }
            break;
        case 'New Tab':
            const doc = await vscode.workspace.openTextDocument({
                content: output,
                language: extension === 'html' ? 'html' : extension === 'tex' ? 'latex' : 'plaintext'
            });
            await vscode.window.showTextDocument(doc);
            break;
    }
}

/**
 * Create a table from clipboard CSV/TSV data
 */
export async function importTableFromClipboard(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const rows = parseTableText(await vscode.env.clipboard.readText());
    if (rows.length === 0) {
        vscode.window.showInformationMessage('Clipboard is empty');
        return;
    }

    await insertTableLines(editor, formatTableLines(rows, editor.document.languageId === 'org'));
}

/**
 * Import a table from a file (CSV or TSV)
 * Prompts for a file and inserts the contents as an aligned org-table
 */
export async function importTableFromFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Prompt for file selection
    const fileUri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import Table',
        filters: {
            'Table Files': ['csv', 'tsv', 'txt'],
            'All Files': ['*']
        }
    });

    if (!fileUri || fileUri.length === 0) {
        return; // User cancelled
    }

    // Read file contents
    const fs = await import('fs');
    const filePath = fileUri[0].fsPath;

    let fileContent: string;
    try {
        fileContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to read file: ${error}`);
        return;
    }

    if (!fileContent.trim()) {
        vscode.window.showInformationMessage('File is empty');
        return;
    }

    const rows = parseTableText(fileContent);
    await insertTableLines(editor, formatTableLines(rows, editor.document.languageId === 'org'));

    vscode.window.showInformationMessage(
        `Imported ${rows.length} rows from ${filePath.split('/').pop()}`
    );
}

/**
 * Sum a column of numbers
 */
export async function sumColumn(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const table = findTableAtCursor(editor.document, editor.selection.active);
    if (!table) {
        vscode.window.showInformationMessage('Not in a table');
        return;
    }

    // Determine which column the cursor is in
    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line).text;
    const colIndex = getColumnIndexAtPosition(line, position.character);

    if (colIndex === -1) {
        vscode.window.showInformationMessage('Could not determine column');
        return;
    }

    // Sum the column (skip header row and separators)
    let sum = 0;
    let count = 0;
    const dataRows = table.rows.filter(r => r.length > 0);

    for (let i = 1; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (colIndex < row.length) {
            const value = parseFloat(row[colIndex].replace(/[^0-9.-]/g, ''));
            if (!isNaN(value)) {
                sum += value;
                count++;
            }
        }
    }

    vscode.window.showInformationMessage(`Sum: ${sum} (${count} values)`);
}

/**
 * Calculate average of a column
 */
export async function averageColumn(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const table = findTableAtCursor(editor.document, editor.selection.active);
    if (!table) {
        vscode.window.showInformationMessage('Not in a table');
        return;
    }

    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line).text;
    const colIndex = getColumnIndexAtPosition(line, position.character);

    if (colIndex === -1) return;

    let sum = 0;
    let count = 0;
    const dataRows = table.rows.filter(r => r.length > 0);

    for (let i = 1; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (colIndex < row.length) {
            const value = parseFloat(row[colIndex].replace(/[^0-9.-]/g, ''));
            if (!isNaN(value)) {
                sum += value;
                count++;
            }
        }
    }

    const avg = count > 0 ? sum / count : 0;
    vscode.window.showInformationMessage(`Average: ${avg.toFixed(2)} (${count} values)`);
}

/**
 * Get the column index at a character position in a table row
 */
function getColumnIndexAtPosition(line: string, charPos: number): number {
    if (!isTableRow(line)) return -1;

    let colIndex = -1;
    let pipeCount = 0;

    for (let i = 0; i < charPos && i < line.length; i++) {
        if (line[i] === '|') {
            pipeCount++;
            colIndex = pipeCount - 1;
        }
    }

    return Math.max(0, colIndex);
}

/**
 * Sort table by the current column
 * Preserves header rows (before first separator) and only sorts data rows
 */
export async function sortByColumn(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const table = findTableAtCursor(editor.document, editor.selection.active);
    if (!table) {
        vscode.window.showInformationMessage('Not in a table');
        return;
    }

    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line).text;
    const colIndex = getColumnIndexAtPosition(line, position.character);

    if (colIndex === -1) return;

    const order = await vscode.window.showQuickPick(
        [
            { label: 'Ascending', value: 'asc' },
            { label: 'Descending', value: 'desc' }
        ],
        { placeHolder: 'Sort order' }
    );

    if (!order) return;

    // Find the first separator line (relative index in table.rows)
    let firstSeparatorIdx = -1;
    for (let i = 0; i < table.rows.length; i++) {
        const lineNum = table.startLine + i;
        if (table.separatorLines.includes(lineNum)) {
            firstSeparatorIdx = i;
            break;
        }
    }

    // If no separator, treat first row as header
    if (firstSeparatorIdx === -1) {
        firstSeparatorIdx = 0;
    }

    // Collect header lines (preserve original text for spec rows)
    // and body rows (for sorting)
    const headerLines: string[] = [];
    const bodyRows: string[][] = [];

    for (let i = 0; i < table.rows.length; i++) {
        const lineNum = table.startLine + i;
        const row = table.rows[i];

        if (i < firstSeparatorIdx) {
            // Header section (before first separator) - preserve original line
            // This handles spec rows (like <l>, <c>, <r>) which are stored as empty arrays
            headerLines.push(editor.document.lineAt(lineNum).text);
        } else if (table.separatorLines.includes(lineNum)) {
            // Skip separators, we'll regenerate them
            continue;
        } else if (i === table.specRow) {
            // Spec row after separator - skip (unusual but possible)
            continue;
        } else if (row.length > 0) {
            // Data row after separator
            bodyRows.push(row);
        }
    }

    // Sort only the body rows
    bodyRows.sort((a, b) => {
        const aVal = colIndex < a.length ? a[colIndex] : '';
        const bVal = colIndex < b.length ? b[colIndex] : '';

        // Try numeric comparison first
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);

        if (!isNaN(aNum) && !isNaN(bNum)) {
            return order.value === 'asc' ? aNum - bNum : bNum - aNum;
        }

        // Fall back to string comparison
        const cmp = aVal.localeCompare(bVal);
        return order.value === 'asc' ? cmp : -cmp;
    });

    // Use existing column widths from table (preserves alignment specs)
    const columnWidths = [...table.columnWidths];

    // Rebuild table preserving structure
    const isOrg = editor.document.languageId === 'org';
    const newLines: string[] = [];

    // Add header lines (preserved original text including spec rows)
    for (const headerLine of headerLines) {
        newLines.push(headerLine);
    }

    // Add separator after headers
    if (headerLines.length > 0 || firstSeparatorIdx > 0) {
        newLines.push(formatSeparator(columnWidths, isOrg, table.gfmAlignments));
    }

    // Add sorted body rows
    for (const row of bodyRows) {
        newLines.push(formatRow(row, columnWidths, table.columnAlignments));
    }

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            table.startLine, 0,
            table.endLine, editor.document.lineAt(table.endLine).text.length
        );
        editBuilder.replace(range, newLines.join('\n'));
    });
}

// =============================================================================
// Table Column Truncation Decorations
// =============================================================================

/**
 * Initialize decoration types for table truncation
 */
function initTruncationDecorations(): void {
    if (!truncationDecorationType) {
        truncationDecorationType = vscode.window.createTextEditorDecorationType({
            // Remove the hidden text from layout entirely; opacity or negative
            // letter-spacing leave a residual width that misaligns the columns
            textDecoration: 'none; display: none;',
        });
    }
    // ellipsisDecorationType is now created dynamically per cell
    if (!ellipsisDecorationType) {
        ellipsisDecorationType = vscode.window.createTextEditorDecorationType({});
    }
}

/**
 * Find all tables in a document
 */
function findAllTables(document: vscode.TextDocument): TableInfo[] {
    const tables: TableInfo[] = [];
    let i = 0;

    while (i < document.lineCount) {
        const line = document.lineAt(i).text;
        if (isTableRow(line)) {
            const table = findTableAtCursor(document, new vscode.Position(i, 0));
            if (table) {
                tables.push(table);
                i = table.endLine + 1;
                continue;
            }
        }
        i++;
    }

    return tables;
}

/**
 * A span of a table line to hide when a <N> column is shown narrowed.
 * `line` is relative to the first line passed to computeShrinkRanges, and
 * start/end are string indices. `ellipsis` marks a cut cell whose hidden span
 * starts with a ">" indicator.
 */
export interface ShrinkRange {
    line: number;
    start: number;
    end: number;
    ellipsis: boolean;
}

/**
 * Compute the spans to hide so that each <N> column displays N wide while the
 * buffer keeps the full cell text (like Emacs org-table-shrink).
 *
 * Each column is hidden inside its own cell, so the columns after it stay
 * lined up. Lines that are not aligned to columnWidths (e.g. mid-edit) and the
 * lines in skipLines are left untouched.
 */
export function computeShrinkRanges(
    lines: string[],
    columnWidths: number[],
    maxWidths: (number | undefined)[],
    specRow?: number,
    skipLines: Set<number> = new Set()
): ShrinkRange[] {
    const ranges: ShrinkRange[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        if (skipLines.has(lineIdx)) continue;
        const line = lines[lineIdx];

        // Map display columns to string indices: indexAt[col] is the index of
        // the character starting at display column col (or the next one)
        const startCol: number[] = [];
        let col = 0;
        for (let i = 0; i < line.length; i++) {
            startCol.push(col);
            col += getCharWidth(line[i]);
        }
        startCol.push(col);
        const indexAt = (target: number): number => {
            const idx = startCol.findIndex(c => c >= target);
            return idx === -1 ? line.length : idx;
        };

        // Cell boundaries of an aligned row: | c0 | c1 | ... with interiors W+2 wide
        const indent = line.length - line.trimStart().length;
        const bounds: number[] = [indent];
        for (const w of columnWidths) {
            bounds.push(bounds[bounds.length - 1] + w + 3);
        }
        const aligned = bounds.every(b => {
            const ch = line[indexAt(b)];
            return startCol[indexAt(b)] === b && (ch === '|' || ch === '+');
        });
        if (!aligned) continue;
        const isSeparator = isSeparatorRow(line);

        for (let j = 0; j < columnWidths.length; j++) {
            const maxWidth = maxWidths[j];
            if (maxWidth === undefined || maxWidth < 1) continue;

            const left = bounds[j] + 1;      // first display column inside the cell
            const right = bounds[j + 1];     // display column of the closing pipe
            const startIdx = indexAt(left);
            const endIdx = indexAt(right);
            const cellText = line.slice(startIdx, endIdx);
            const content = cellText.trim();
            const contentWidth = getDisplayWidth(content);

            // Visible width: N, but always wide enough to show the cookie
            const visible = lineIdx === specRow ? Math.max(maxWidth, contentWidth) : maxWidth;
            if (columnWidths[j] <= visible) continue;

            if (lineIdx === specRow) {
                // Keep the cookie centred in the narrowed cell
                const contentStart = left + (cellText.length - cellText.trimStart().length);
                const pad = 1 + Math.floor((visible - contentWidth) / 2);
                const keepFrom = contentStart - pad;
                const keepTo = keepFrom + visible + 2;
                if (keepFrom > left) {
                    ranges.push({ line: lineIdx, start: startIdx, end: indexAt(keepFrom), ellipsis: false });
                }
                if (keepTo < right) {
                    ranges.push({ line: lineIdx, start: indexAt(keepTo), end: endIdx, ellipsis: false });
                }
                continue;
            }

            // Data and separator rows: keep " " + N columns, hide the rest up
            // to the closing " |". A cut cell shows N-1 characters and ">".
            const cut = !isSeparator && contentWidth > maxWidth;
            const hideFrom = indexAt(left + 1 + (cut ? maxWidth - 1 : maxWidth));
            const hideTo = indexAt(right - 1);
            if (hideFrom < hideTo) {
                ranges.push({ line: lineIdx, start: hideFrom, end: hideTo, ellipsis: cut });
            }
        }
    }

    return ranges;
}

/**
 * Apply truncation decorations to all tables in the active editor.
 * The line with the cursor is shown in full so its text can be edited.
 */
export function updateTruncationDecorations(editor: vscode.TextEditor): void {
    initTruncationDecorations();

    const document = editor.document;

    // Only apply to org files
    if (document.languageId !== 'org') {
        editor.setDecorations(truncationDecorationType!, []);
        editor.setDecorations(ellipsisDecorationType!, []);
        return;
    }

    const cursorLine = editor.selection.active.line;
    const truncationRanges: vscode.DecorationOptions[] = [];
    const ellipsisRanges: vscode.DecorationOptions[] = [];

    for (const table of findAllTables(document)) {
        if (!table.columnMaxWidths.some(w => w !== undefined)) continue;

        const lines: string[] = [];
        for (let i = table.startLine; i <= table.endLine; i++) {
            lines.push(document.lineAt(i).text);
        }
        const skipLines = new Set<number>();
        if (cursorLine >= table.startLine && cursorLine <= table.endLine) {
            skipLines.add(cursorLine - table.startLine);
        }

        const ranges = computeShrinkRanges(lines, table.columnWidths, table.columnMaxWidths, table.specRow, skipLines);
        for (const r of ranges) {
            const lineNum = table.startLine + r.line;
            truncationRanges.push({ range: new vscode.Range(lineNum, r.start, lineNum, r.end) });
            if (r.ellipsis) {
                ellipsisRanges.push({
                    range: new vscode.Range(lineNum, r.start, lineNum, r.start),
                    renderOptions: {
                        after: {
                            contentText: '>',
                            color: new vscode.ThemeColor('editorWarning.foreground')
                        }
                    }
                });
            }
        }
    }

    editor.setDecorations(truncationDecorationType!, truncationRanges);
    editor.setDecorations(ellipsisDecorationType!, ellipsisRanges);
}

/**
 * Clear truncation decorations from an editor
 */
export function clearTruncationDecorations(editor: vscode.TextEditor): void {
    if (truncationDecorationType) {
        editor.setDecorations(truncationDecorationType, []);
    }
    if (ellipsisDecorationType) {
        editor.setDecorations(ellipsisDecorationType, []);
    }
}

/**
 * Hover provider for truncated table cells
 * Shows full cell content when hovering over truncated cells
 */
export class TableCellHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line).text;

        // Check if we're in a table row
        if (!isTableRow(line)) {
            return null;
        }

        // Find the table at this position
        const table = findTableAtCursor(document, position);
        if (!table) {
            return null;
        }

        // Check if any column has truncation
        const hasMaxWidths = table.columnMaxWidths.some(w => w !== undefined);
        if (!hasMaxWidths) {
            return null;
        }

        // Find which column the cursor is in
        const colIndex = getColumnAtCursor(line, position.character);
        if (colIndex < 0) {
            return null;
        }

        // Check if this column has a max width
        const maxWidth = table.columnMaxWidths[colIndex];
        if (maxWidth === undefined) {
            return null;
        }

        // Get the row data
        const rowIdx = position.line - table.startLine;
        if (rowIdx < 0 || rowIdx >= table.rows.length) {
            return null;
        }

        const row = table.rows[rowIdx];
        if (row.length === 0 || colIndex >= row.length) {
            return null;
        }

        const cellContent = row[colIndex];
        const cellWidth = getDisplayWidth(cellContent);

        // Only show hover if content is actually truncated
        if (cellWidth <= maxWidth) {
            return null;
        }

        // Create hover with full content
        const markdown = new vscode.MarkdownString();
        markdown.appendText(cellContent);

        return new vscode.Hover(markdown);
    }
}

/**
 * CodeLens provider for truncated table columns
 * Shows "Expand column" buttons on spec rows with width constraints
 */
export class TableTruncationCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        if (document.languageId !== 'org') {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];
        const tables = findAllTables(document);

        for (const table of tables) {
            // Check if this table has any truncated columns
            const truncatedCols: number[] = [];
            for (let i = 0; i < table.columnMaxWidths.length; i++) {
                if (table.columnMaxWidths[i] !== undefined) {
                    truncatedCols.push(i);
                }
            }

            if (truncatedCols.length === 0) {
                continue;
            }

            // Find the spec row line
            const specRowLine = table.specRow !== undefined
                ? table.startLine + table.specRow
                : table.startLine;

            const range = new vscode.Range(specRowLine, 0, specRowLine, 0);

            // Add a single "Expand all" button if multiple columns truncated
            if (truncatedCols.length > 1) {
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '⊞ Expand all columns',
                    command: 'scimax.table.expandAllColumns',
                    arguments: [document.uri, table.startLine]
                }));
            }

            // Add individual expand buttons for each truncated column
            for (const colIdx of truncatedCols) {
                codeLenses.push(new vscode.CodeLens(range, {
                    title: `⊞ Expand col ${colIdx + 1}`,
                    command: 'scimax.table.expandColumn',
                    arguments: [document.uri, table.startLine, colIdx]
                }));
            }
        }

        return codeLenses;
    }
}

// Singleton instance for refreshing
let codeLensProvider: TableTruncationCodeLensProvider | undefined;

/**
 * Expand a single truncated column (change <N> to <l>)
 */
async function expandColumn(uri: vscode.Uri, tableStartLine: number, colIdx: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri.toString()) {
        return;
    }

    const document = editor.document;
    const table = findTableAtCursor(document, new vscode.Position(tableStartLine, 0));
    if (!table || table.specRow === undefined) {
        return;
    }

    const specRowLine = table.startLine + table.specRow;
    const specRowText = document.lineAt(specRowLine).text;

    // Parse and modify the spec row
    const cells = parseRowSimple(specRowText);
    if (colIdx >= cells.length) {
        return;
    }

    // Change <N> to <l> (preserve any existing alignment from content analysis)
    const currentSpec = cells[colIdx].trim();
    const match = currentSpec.match(/^<(\d+)>$/);
    if (match) {
        cells[colIdx] = '<l>';
    }

    // Rebuild the spec row
    const newSpecRow = '| ' + cells.join(' | ') + ' |';

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            specRowLine, 0,
            specRowLine, specRowText.length
        );
        editBuilder.replace(range, newSpecRow);
    });

    // Re-align this table (a CodeLens click does not move the cursor into it)
    await alignTableAt(editor, new vscode.Position(tableStartLine, 0));

    // Refresh CodeLens
    codeLensProvider?.refresh();
}

/**
 * Expand all truncated columns in a table
 */
async function expandAllColumns(uri: vscode.Uri, tableStartLine: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri.toString()) {
        return;
    }

    const document = editor.document;
    const table = findTableAtCursor(document, new vscode.Position(tableStartLine, 0));
    if (!table || table.specRow === undefined) {
        return;
    }

    const specRowLine = table.startLine + table.specRow;
    const specRowText = document.lineAt(specRowLine).text;

    // Parse and modify the spec row
    const cells = parseRowSimple(specRowText);

    // Change all <N> to <l>
    for (let i = 0; i < cells.length; i++) {
        const currentSpec = cells[i].trim();
        const match = currentSpec.match(/^<(\d+)>$/);
        if (match) {
            cells[i] = '<l>';
        }
    }

    // Rebuild the spec row
    const newSpecRow = '| ' + cells.join(' | ') + ' |';

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            specRowLine, 0,
            specRowLine, specRowText.length
        );
        editBuilder.replace(range, newSpecRow);
    });

    // Re-align this table (a CodeLens click does not move the cursor into it)
    await alignTableAt(editor, new vscode.Position(tableStartLine, 0));

    // Refresh CodeLens
    codeLensProvider?.refresh();
}

/**
 * Register table commands
 */
export function registerTableCommands(context: vscode.ExtensionContext): void {
    // Original commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.table.moveRowUp', moveRowUp),
        vscode.commands.registerCommand('scimax.table.moveRowDown', moveRowDown),
        vscode.commands.registerCommand('scimax.table.moveColumnLeft', moveColumnLeft),
        vscode.commands.registerCommand('scimax.table.moveColumnRight', moveColumnRight),
        vscode.commands.registerCommand('scimax.table.moveCellUp', moveCellUp),
        vscode.commands.registerCommand('scimax.table.moveCellDown', moveCellDown),
        vscode.commands.registerCommand('scimax.table.moveCellLeft', moveCellLeft),
        vscode.commands.registerCommand('scimax.table.moveCellRight', moveCellRight),
        vscode.commands.registerCommand('scimax.table.insertRowBelow', insertRowBelow),
        vscode.commands.registerCommand('scimax.table.insertRowAbove', insertRowAbove),
        vscode.commands.registerCommand('scimax.table.deleteRow', deleteRow),
        vscode.commands.registerCommand('scimax.table.insertColumnLeft', insertColumnLeft),
        vscode.commands.registerCommand('scimax.table.insertColumnRight', insertColumnRight),
        vscode.commands.registerCommand('scimax.table.deleteColumn', deleteColumn),
        vscode.commands.registerCommand('scimax.table.align', alignTable),
        vscode.commands.registerCommand('scimax.table.create', createTable),
        vscode.commands.registerCommand('scimax.table.nextCell', nextCell),
        vscode.commands.registerCommand('scimax.table.prevCell', prevCell),
        vscode.commands.registerCommand('scimax.table.insertSeparator', insertSeparator)
    );

    // Scimax extensions
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.table.gotoNamed', gotoNamedTable),
        vscode.commands.registerCommand('scimax.table.export', exportTable),
        vscode.commands.registerCommand('scimax.table.import', importTableFromClipboard),
        vscode.commands.registerCommand('scimax.table.importFile', importTableFromFile),
        vscode.commands.registerCommand('scimax.table.sumColumn', sumColumn),
        vscode.commands.registerCommand('scimax.table.expandColumn', expandColumn),
        vscode.commands.registerCommand('scimax.table.expandAllColumns', expandAllColumns),
        vscode.commands.registerCommand('scimax.table.averageColumn', averageColumn),
        vscode.commands.registerCommand('scimax.table.sortByColumn', sortByColumn)
    );

    // Initialize truncation decorations
    initTruncationDecorations();

    // Update decorations when active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                updateTruncationDecorations(editor);
            }
        })
    );

    // The cursor's line is shown unshrunk, so update when it moves to another line
    let lastCursorLine = -1;
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(event => {
            const line = event.selections[0]?.active.line ?? -1;
            if (line !== lastCursorLine && event.textEditor.document.languageId === 'org') {
                lastCursorLine = line;
                updateTruncationDecorations(event.textEditor);
            }
        })
    );

    // Update decorations when document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                // Debounce updates to avoid performance issues
                updateTruncationDecorations(editor);
            }
        })
    );

    // Apply decorations to current editor if any
    if (vscode.window.activeTextEditor) {
        updateTruncationDecorations(vscode.window.activeTextEditor);
    }

    // Register hover provider for truncated cells
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'org' },
            new TableCellHoverProvider()
        )
    );

    // Register CodeLens provider for expand buttons on truncated columns
    codeLensProvider = new TableTruncationCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'org' },
            codeLensProvider
        )
    );
}
