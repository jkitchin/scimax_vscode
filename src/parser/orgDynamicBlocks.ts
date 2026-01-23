/**
 * Dynamic Block Execution
 *
 * Implements execution of org-mode dynamic blocks like columnview and clocktable.
 * Dynamic blocks are updated in-place when executed with C-c C-c.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseOrg } from './orgParserUnified';
import { org } from './orgModify';
import type {
    OrgDocumentNode,
    HeadlineElement,
    DynamicBlockElement
} from './orgElementTypes';
import { generateClockTable, type ClockTableConfig } from './orgClocking';

// =============================================================================
// Types
// =============================================================================

interface ColumnViewParams {
    /** Columns to display */
    columns?: string;
    /** Add hlines every N rows (1 = after header only) */
    hlines?: number;
    /** Scope: 'file', 'tree', 'agenda', or specific ID */
    id?: string;
    /** Maximum headline level to include */
    maxlevel?: number;
    /** Skip empty rows */
    skipEmptyRows?: boolean;
    /** Exclude tags */
    excludeTags?: string[];
    /** Match only these tags */
    match?: string;
    /** Indent items based on level */
    indent?: boolean;
}

interface DynamicBlockResult {
    success: boolean;
    content: string;
    error?: string;
}

/**
 * Parsed agenda document for multi-file searches
 */
export interface AgendaDocument {
    filePath: string;
    doc: OrgDocumentNode;
}

// =============================================================================
// Parameter Parsing
// =============================================================================

/**
 * Parse dynamic block arguments string into key-value pairs
 */
function parseBlockArgs(argsString: string | undefined): Record<string, string> {
    if (!argsString) return {};

    const args: Record<string, string> = {};
    // Match :key value pairs
    const regex = /:(\w+)\s+([^\s:]+|"[^"]*")/g;
    let match;

    while ((match = regex.exec(argsString)) !== null) {
        let value = match[2];
        // Remove quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        args[match[1]] = value;
    }

    return args;
}

/**
 * Parse columnview-specific parameters
 */
function parseColumnViewParams(argsString: string | undefined): ColumnViewParams {
    const args = parseBlockArgs(argsString);

    return {
        columns: args.columns,
        hlines: args.hlines ? parseInt(args.hlines, 10) : undefined,
        id: args.id,
        maxlevel: args.maxlevel ? parseInt(args.maxlevel, 10) : undefined,
        skipEmptyRows: args.skip_empty_rows === 't' || args.skip_empty_rows === 'yes',
        excludeTags: args.exclude_tags?.split(':').filter(Boolean),
        match: args.match,
        indent: args.indent === 't' || args.indent === 'yes',
    };
}

/**
 * Parse clocktable-specific parameters
 */
function parseClockTableParams(argsString: string | undefined): ClockTableConfig {
    const args = parseBlockArgs(argsString);

    // Map :scope parameter to ClockTableConfig scope
    let scope: 'file' | 'subtree' | 'agenda' = 'file';
    if (args.scope) {
        if (args.scope === 'tree' || args.scope === 'subtree') {
            scope = 'subtree';
        } else if (args.scope === 'agenda') {
            scope = 'agenda';
        } else if (args.scope === 'file') {
            scope = 'file';
        }
    }

    // Map :block parameter to span
    let span: ClockTableConfig['span'];
    if (args.block) {
        const blockValue = args.block.toLowerCase();
        if (blockValue === 'today') {
            span = 'today';
        } else if (blockValue === 'thisweek') {
            span = 'thisweek';
        } else if (blockValue === 'thismonth') {
            span = 'thismonth';
        } else if (blockValue === 'untilnow') {
            span = 'untilnow';
        }
    }

    return {
        scope,
        maxLevel: args.maxlevel ? parseInt(args.maxlevel, 10) : undefined,
        timestamps: args.timestamps === 't' || args.timestamps === 'yes',
        block: args.block,
        formula: args.formula,
        showFile: args.fileskip0 !== 't' && scope === 'agenda', // Show file column for agenda scope
        span,
    };
}

// =============================================================================
// Column Definitions
// =============================================================================

/**
 * Default column format if none specified
 */
const DEFAULT_COLUMNS = '%ITEM %TODO %PRIORITY %TAGS';

/**
 * Parse column specification string
 * Format: %COLNAME(TITLE) or %COLNAME or %25COLNAME (with width)
 */
function parseColumnSpec(columnsStr: string): Array<{ name: string; title: string; width?: number }> {
    const columns: Array<{ name: string; title: string; width?: number }> = [];

    // Match %WIDTH?COLNAME(TITLE)? patterns
    const regex = /%(\d*)(\w+)(?:\(([^)]+)\))?/g;
    let match;

    while ((match = regex.exec(columnsStr)) !== null) {
        const width = match[1] ? parseInt(match[1], 10) : undefined;
        const name = match[2].toUpperCase();
        const title = match[3] || name;
        columns.push({ name, title, width });
    }

    return columns;
}

/**
 * Format a timestamp object as a string
 */
function formatTimestamp(ts: any): string {
    if (!ts) return '';
    // TimestampObject has year, month, day, etc.
    if (ts.year && ts.month && ts.day) {
        const active = ts.type === 'active' ? '<' : '[';
        const close = ts.type === 'active' ? '>' : ']';
        let str = `${active}${ts.year}-${String(ts.month).padStart(2, '0')}-${String(ts.day).padStart(2, '0')}`;
        if (ts.hour !== undefined) {
            str += ` ${String(ts.hour).padStart(2, '0')}:${String(ts.minute || 0).padStart(2, '0')}`;
        }
        str += close;
        return str;
    }
    return '';
}

/**
 * Get column value from a headline
 */
function getColumnValue(headline: HeadlineElement, columnName: string): string {
    switch (columnName) {
        case 'ITEM':
            return headline.properties.rawValue || '';
        case 'TODO':
            return headline.properties.todoKeyword || '';
        case 'PRIORITY':
            return headline.properties.priority ? `[#${headline.properties.priority}]` : '';
        case 'TAGS':
            return headline.properties.tags.length > 0
                ? ':' + headline.properties.tags.join(':') + ':'
                : '';
        case 'LEVEL':
            return headline.properties.level.toString();
        case 'SCHEDULED':
            return formatTimestamp(headline.planning?.properties.scheduled);
        case 'DEADLINE':
            return formatTimestamp(headline.planning?.properties.deadline);
        case 'CLOSED':
            return formatTimestamp(headline.planning?.properties.closed);
        case 'CLOCKSUM':
            // Would need to calculate from clock entries
            return '';
        case 'EFFORT':
            return headline.properties.effort || headline.propertiesDrawer?.EFFORT || '';
        default:
            // Check properties drawer
            if (headline.propertiesDrawer && columnName in headline.propertiesDrawer) {
                return headline.propertiesDrawer[columnName] || '';
            }
            return '';
    }
}

// =============================================================================
// Columnview Execution
// =============================================================================

/**
 * Execute a columnview dynamic block
 * @param doc - The current document
 * @param params - Column view parameters
 * @param documentPath - Path to current document
 * @param agendaDocuments - Optional parsed agenda documents for multi-file search
 */
export function executeColumnView(
    doc: OrgDocumentNode,
    params: ColumnViewParams,
    documentPath?: string,
    agendaDocuments?: AgendaDocument[]
): DynamicBlockResult {
    try {
        // Parse column specification
        const columnsStr = params.columns || DEFAULT_COLUMNS;
        const columns = parseColumnSpec(columnsStr);

        if (columns.length === 0) {
            return { success: false, content: '', error: 'No valid columns specified' };
        }

        // Get headlines based on scope
        let headlines: HeadlineElement[] = [];

        if (params.id === 'global' || params.id === 'agenda') {
            // Search across agenda files if provided, otherwise fall back to current file
            if (agendaDocuments && agendaDocuments.length > 0) {
                for (const agendaDoc of agendaDocuments) {
                    headlines.push(...org.getAllHeadlines(agendaDoc.doc));
                }
            } else {
                headlines = org.getAllHeadlines(doc);
            }
        } else if (params.id === 'local' || params.id === 'file' || !params.id) {
            // Search current file
            headlines = org.getAllHeadlines(doc);
        } else {
            // Search for specific ID
            headlines = org.filterHeadlines(doc, h =>
                h.propertiesDrawer?.ID === params.id
            );
            if (headlines.length === 1) {
                // Get all children of this headline
                const parent = headlines[0];
                headlines = org.filterHeadlines(doc, h => {
                    // Check if h is a descendant of parent
                    // This is a simplification - would need proper tree traversal
                    return h.properties.level > parent.properties.level;
                });
                headlines.unshift(parent);
            }
        }

        // Filter by maxlevel
        if (params.maxlevel) {
            headlines = headlines.filter(h => h.properties.level <= params.maxlevel!);
        }

        // Filter by tags if match specified
        if (params.match) {
            const matchTags = params.match.split(/[+&]/).map(t => t.trim());
            headlines = headlines.filter(h =>
                matchTags.every(tag => h.properties.tags.includes(tag))
            );
        }

        // Filter out excluded tags
        if (params.excludeTags && params.excludeTags.length > 0) {
            headlines = headlines.filter(h =>
                !params.excludeTags!.some(tag => h.properties.tags.includes(tag))
            );
        }

        // Build table
        const rows: string[][] = [];

        // Header row
        rows.push(columns.map(col => col.title));

        // Data rows
        for (const headline of headlines) {
            const row: string[] = [];
            let hasContent = false;

            for (const col of columns) {
                let value = getColumnValue(headline, col.name);

                // Add indentation for ITEM column if requested
                if (col.name === 'ITEM' && params.indent) {
                    const indent = '  '.repeat(headline.properties.level - 1);
                    value = indent + value;
                }

                if (value) hasContent = true;
                row.push(value);
            }

            // Skip empty rows if requested
            if (params.skipEmptyRows && !hasContent) {
                continue;
            }

            rows.push(row);
        }

        // Generate org table
        const table = generateOrgTable(rows, params.hlines);

        return { success: true, content: table };
    } catch (error) {
        return {
            success: false,
            content: '',
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Generate an org-mode table from rows
 */
function generateOrgTable(rows: string[][], hlines?: number): string {
    if (rows.length === 0) return '';

    // Calculate column widths
    const colWidths: number[] = [];
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            const len = row[i].length;
            if (!colWidths[i] || len > colWidths[i]) {
                colWidths[i] = len;
            }
        }
    }

    // Ensure minimum width
    for (let i = 0; i < colWidths.length; i++) {
        colWidths[i] = Math.max(colWidths[i], 1);
    }

    // Build table string
    const lines: string[] = [];

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];

        // Add hline after header (row 0) if hlines is set
        if (rowIdx === 1 && hlines !== undefined) {
            const hline = '|' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '|';
            lines.push(hline);
        }

        // Build row
        const cells = row.map((cell, i) => ' ' + cell.padEnd(colWidths[i]) + ' ');
        lines.push('|' + cells.join('|') + '|');
    }

    return lines.join('\n');
}

// =============================================================================
// Clocktable Execution
// =============================================================================

/**
 * Execute a clocktable dynamic block
 * @param doc - The current document
 * @param params - Clock table configuration
 * @param documentPath - Path to current document
 * @param agendaDocuments - Optional parsed agenda documents for multi-file search
 */
export function executeClockTable(
    doc: OrgDocumentNode,
    params: ClockTableConfig,
    documentPath?: string,
    agendaDocuments?: AgendaDocument[]
): DynamicBlockResult {
    try {
        // Get headlines based on scope
        let headlines: HeadlineElement[] = [];

        if (params.scope === 'agenda') {
            // Search across agenda files if provided, otherwise fall back to current file
            if (agendaDocuments && agendaDocuments.length > 0) {
                for (const agendaDoc of agendaDocuments) {
                    headlines.push(...org.getAllHeadlines(agendaDoc.doc));
                }
            } else {
                headlines = org.getAllHeadlines(doc);
            }
        } else if (params.scope === 'subtree') {
            // For subtree scope, we would need cursor position context
            // For now, use all headlines in the file
            headlines = org.getAllHeadlines(doc);
        } else {
            // file scope - all headlines in current file
            headlines = org.getAllHeadlines(doc);
        }

        // Filter to top-level headlines only (children are handled recursively in generateClockTable)
        const topLevelHeadlines = headlines.filter(h => h.properties.level === 1);

        // Generate the clock table
        const table = generateClockTable(
            topLevelHeadlines.length > 0 ? topLevelHeadlines : headlines,
            params
        );

        return { success: true, content: table };
    } catch (error) {
        return {
            success: false,
            content: '',
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

// =============================================================================
// Dynamic Block Execution Entry Point
// =============================================================================

/**
 * Execute a dynamic block and return the new content
 * @param blockName - The block type (e.g., 'columnview', 'clocktable')
 * @param argsString - The block arguments string
 * @param doc - The current document
 * @param documentPath - Path to current document
 * @param agendaDocuments - Optional parsed agenda documents for multi-file search
 */
export function executeDynamicBlock(
    blockName: string,
    argsString: string | undefined,
    doc: OrgDocumentNode,
    documentPath?: string,
    agendaDocuments?: AgendaDocument[]
): DynamicBlockResult {
    switch (blockName.toLowerCase()) {
        case 'columnview':
            const params = parseColumnViewParams(argsString);
            return executeColumnView(doc, params, documentPath, agendaDocuments);

        case 'clocktable':
            const clockParams = parseClockTableParams(argsString);
            return executeClockTable(doc, clockParams, documentPath, agendaDocuments);

        default:
            return {
                success: false,
                content: '',
                error: `Unknown dynamic block type: ${blockName}`
            };
    }
}

// =============================================================================
// VS Code Integration
// =============================================================================

/**
 * Find dynamic block at cursor position
 */
export function findDynamicBlockAtCursor(
    document: vscode.TextDocument,
    position: vscode.Position
): { startLine: number; endLine: number; name: string; args: string } | null {
    const line = position.line;

    // Search backwards for #+BEGIN:
    let startLine = -1;
    let blockName = '';
    let blockArgs = '';

    for (let i = line; i >= 0; i--) {
        const text = document.lineAt(i).text;
        const beginMatch = text.match(/^\s*#\+BEGIN:\s*(\w+)\s*(.*)?$/i);
        if (beginMatch) {
            startLine = i;
            blockName = beginMatch[1];
            blockArgs = beginMatch[2] || '';
            break;
        }
        // If we hit another #+END: first, we're not in a block
        if (text.match(/^\s*#\+END:\s*$/i)) {
            return null;
        }
    }

    if (startLine === -1) return null;

    // Search forwards for #+END:
    let endLine = -1;
    for (let i = startLine + 1; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        if (text.match(/^\s*#\+END:\s*$/i)) {
            endLine = i;
            break;
        }
    }

    if (endLine === -1) return null;

    // Check if cursor is within the block
    if (line < startLine || line > endLine) {
        return null;
    }

    return { startLine, endLine, name: blockName, args: blockArgs };
}

/**
 * Load and parse agenda files from configuration
 */
async function loadAgendaDocuments(): Promise<AgendaDocument[]> {
    const config = vscode.workspace.getConfiguration('scimax.agenda');
    const agendaPatterns = config.get<string[]>('files', []);
    const agendaDocs: AgendaDocument[] = [];

    for (const pattern of agendaPatterns) {
        // Handle glob patterns
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100);
        for (const file of files) {
            try {
                const content = await fs.promises.readFile(file.fsPath, 'utf-8');
                const doc = parseOrg(content, { filePath: file.fsPath });
                agendaDocs.push({ filePath: file.fsPath, doc });
            } catch {
                // Skip files that can't be read or parsed
            }
        }
    }

    return agendaDocs;
}

/**
 * Check if block arguments indicate agenda scope
 */
function hasAgendaScope(blockName: string, argsString: string | undefined): boolean {
    if (!argsString) return false;
    const args = parseBlockArgs(argsString);

    if (blockName.toLowerCase() === 'columnview') {
        return args.id === 'global' || args.id === 'agenda';
    } else if (blockName.toLowerCase() === 'clocktable') {
        return args.scope === 'agenda';
    }
    return false;
}

/**
 * Update dynamic block at cursor
 */
export async function updateDynamicBlockAtCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    const block = findDynamicBlockAtCursor(document, position);
    if (!block) {
        vscode.window.showInformationMessage('Not inside a dynamic block');
        return;
    }

    // Parse the full document for context
    const content = document.getText();
    const doc = parseOrg(content, { filePath: document.uri.fsPath });

    // Load agenda documents if scope is 'agenda'
    let agendaDocuments: AgendaDocument[] | undefined;
    if (hasAgendaScope(block.name, block.args)) {
        agendaDocuments = await loadAgendaDocuments();
        if (agendaDocuments.length === 0) {
            vscode.window.showWarningMessage(
                'No agenda files found. Check scimax.agenda settings (includeJournal, includeWorkspace, include).'
            );
        }
    }

    // Execute the block
    const result = executeDynamicBlock(block.name, block.args, doc, document.uri.fsPath, agendaDocuments);

    if (!result.success) {
        vscode.window.showErrorMessage(`Dynamic block error: ${result.error}`);
        return;
    }

    // Replace block content (between BEGIN and END lines)
    const contentStart = new vscode.Position(block.startLine + 1, 0);
    const contentEnd = new vscode.Position(block.endLine, 0);
    const contentRange = new vscode.Range(contentStart, contentEnd);

    const newContent = result.content ? result.content + '\n' : '';

    await editor.edit(editBuilder => {
        editBuilder.replace(contentRange, newContent);
    });

    vscode.window.showInformationMessage(`Updated ${block.name} block`);
}

/**
 * Check if cursor is in a dynamic block
 */
export function isInDynamicBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
    return findDynamicBlockAtCursor(document, position) !== null;
}
