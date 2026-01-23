/**
 * VS Code integration for Org Babel code block execution
 * Provides commands for executing source blocks and managing results
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    executeSourceBlock,
    formatResult,
    parseHeaderArguments,
    parseResultsFormat,
    executorRegistry,
    computeCodeHash,
    type ExecutionResult,
    type ExecutionContext,
    type HeaderArguments,
} from '../parser/orgBabel';
import type { SrcBlockElement } from '../parser/orgElementTypes';
import { findInlineSrcAtPosition, findInlineBabelCallAtPosition, parseCallLine, executeCall, type TangleBlock, type InlineBabelCall } from '../parser/orgBabelAdvanced';
import { OrgParser } from '../parser/orgParser';
import { getKernelManager } from '../jupyter/kernelManager';

// Output channel for Babel execution
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Get or create the output channel
 */
function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Org Babel');
    }
    return outputChannel;
}

/**
 * Get file-level header arguments from #+PROPERTY: declarations
 * Supports both generic header-args and language-specific header-args:lang
 *
 * @param document The text document to parse
 * @param language The source block language (for language-specific args)
 * @returns Merged header arguments (generic + language-specific)
 */
function getFileLevelHeaderArgs(document: vscode.TextDocument, language: string): HeaderArguments {
    const parser = new OrgParser();
    const orgDoc = parser.parse(document.getText());

    let mergedArgs: HeaderArguments = {};

    // First, apply generic header-args
    const genericHeaderArgs = orgDoc.properties['header-args'];
    if (genericHeaderArgs) {
        mergedArgs = { ...parseHeaderArguments(genericHeaderArgs) };
    }

    // Then, apply language-specific header-args (overrides generic)
    const langKey = `header-args:${language.toLowerCase()}`;
    const langHeaderArgs = orgDoc.properties[langKey];
    if (langHeaderArgs) {
        const langArgs = parseHeaderArguments(langHeaderArgs);
        mergedArgs = { ...mergedArgs, ...langArgs };
    }

    return mergedArgs;
}

/**
 * Status bar item for showing execution status
 */
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Get or create the status bar item
 */
function getStatusBarItem(): vscode.StatusBarItem {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
    }
    return statusBarItem;
}

/**
 * Show execution status in status bar
 */
function showStatus(message: string, isError = false): void {
    const item = getStatusBarItem();
    item.text = `$(sync~spin) ${message}`;
    if (isError) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
        item.backgroundColor = undefined;
    }
    item.show();
}

/**
 * Hide status bar item
 */
function hideStatus(): void {
    const item = getStatusBarItem();
    item.hide();
}

// =============================================================================
// Org Context for Source Blocks
// =============================================================================

/**
 * Org context object that gets injected into JS/TS source blocks
 */
interface OrgContext {
    /** Path to the current file */
    file: string;
    /** Line number of the source block */
    line: number;
    /** Current heading info (if inside a heading) */
    heading?: {
        title: string;
        level: number;
        tags: string[];
        todoState?: string;
        priority?: string;
        properties: Record<string, string>;
    };
    /** All properties (including inherited) */
    properties: Record<string, string>;
    /** Document-level keywords */
    keywords: Record<string, string>;
}

/**
 * Build org context for a source block at a given line
 */
function buildOrgContext(document: vscode.TextDocument, blockLine: number): OrgContext {
    const parser = new OrgParser();
    const orgDoc = parser.parse(document.getText());

    const context: OrgContext = {
        file: document.uri.fsPath,
        line: blockLine,
        properties: {},
        keywords: orgDoc.keywords,
    };

    // Add document-level properties
    Object.assign(context.properties, orgDoc.properties);

    // Find the heading containing this source block
    const allHeadings = parser.flattenHeadings(orgDoc);

    // Find the closest heading before the block line
    let containingHeading = null;
    for (const heading of allHeadings) {
        if (heading.lineNumber <= blockLine) {
            containingHeading = heading;
        } else {
            break;
        }
    }

    if (containingHeading) {
        context.heading = {
            title: containingHeading.title,
            level: containingHeading.level,
            tags: containingHeading.tags,
            todoState: containingHeading.todoState,
            priority: containingHeading.priority,
            properties: { ...containingHeading.properties },
        };

        // Collect inherited properties by walking up the heading tree
        // Start with this heading's properties
        Object.assign(context.properties, containingHeading.properties);

        // Walk up to find parent headings and inherit their properties
        for (const heading of allHeadings) {
            if (heading.lineNumber < containingHeading.lineNumber &&
                heading.level < containingHeading.level) {
                // This is an ancestor - add its properties (don't override existing)
                for (const [key, value] of Object.entries(heading.properties)) {
                    if (!(key in context.properties)) {
                        context.properties[key] = value;
                    }
                }
            }
        }
    }

    return context;
}

/**
 * Generate JavaScript code to inject the __org__ context object
 */
function generateOrgContextCode(context: OrgContext): string {
    return `const __org__ = ${JSON.stringify(context, null, 2)};
__org__.getProperty = (key) => __org__.properties[key];
__org__.getKeyword = (key) => __org__.keywords[key];
`;
}

/**
 * Execute a "scimax" source block in the extension context
 * This provides full access to the VS Code API
 */
async function executeScimaxBlock(
    editor: vscode.TextEditor,
    block: SourceBlockInfo,
    channel: vscode.OutputChannel
): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
        // Build org context
        const orgContext = buildOrgContext(editor.document, block.startLine);

        // Capture console output
        const outputs: string[] = [];
        const mockConsole = {
            log: (...args: unknown[]) => outputs.push(args.map(String).join(' ')),
            error: (...args: unknown[]) => outputs.push('ERROR: ' + args.map(String).join(' ')),
            warn: (...args: unknown[]) => outputs.push('WARN: ' + args.map(String).join(' ')),
            info: (...args: unknown[]) => outputs.push(args.map(String).join(' ')),
        };

        // Create the execution context with useful APIs
        const contextObj = {
            vscode,
            __org__: {
                ...orgContext,
                getProperty: (key: string) => orgContext.properties[key],
                getKeyword: (key: string) => orgContext.keywords[key],
            },
            console: mockConsole,
            // Helper to open a file and optionally go to a line
            openFile: async (filePath: string, line?: number) => {
                const absPath = path.isAbsolute(filePath)
                    ? filePath
                    : path.resolve(path.dirname(editor.document.uri.fsPath), filePath);
                const doc = await vscode.workspace.openTextDocument(absPath);
                const ed = await vscode.window.showTextDocument(doc);
                if (line !== undefined) {
                    const pos = new vscode.Position(line - 1, 0);
                    ed.selection = new vscode.Selection(pos, pos);
                    ed.revealRange(new vscode.Range(pos, pos));
                }
                return ed;
            },
            // Helper to read and parse an org file
            parseOrgFile: (filePath: string) => {
                const fs = require('fs');
                const absPath = path.isAbsolute(filePath)
                    ? filePath
                    : path.resolve(path.dirname(editor.document.uri.fsPath), filePath);
                const content = fs.readFileSync(absPath, 'utf-8');
                const parser = new OrgParser();
                return parser.parse(content);
            },
            // Helper to get property from any org file (with inheritance)
            getPropertyFromFile: (filePath: string, propName: string, lineNum?: number) => {
                const fs = require('fs');
                const absPath = path.isAbsolute(filePath)
                    ? filePath
                    : path.resolve(path.dirname(editor.document.uri.fsPath), filePath);
                const content = fs.readFileSync(absPath, 'utf-8');
                const parser = new OrgParser();
                const doc = parser.parse(content);

                // If no line specified, check document properties
                if (lineNum === undefined) {
                    return doc.properties[propName];
                }

                // Find heading at or before the line
                const headings = parser.flattenHeadings(doc);
                const properties: Record<string, string> = { ...doc.properties };

                for (const h of headings) {
                    if (h.lineNumber <= lineNum) {
                        Object.assign(properties, h.properties);
                    }
                }
                return properties[propName];
            },
            // Current editor
            editor,
            // Path utilities
            path,
            // Require for loading modules
            require,
        };

        // Wrap code in async function to allow await
        const wrappedCode = `
(async () => {
    ${block.code}
})()
`;

        // Execute using Function constructor with context
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction(
            ...Object.keys(contextObj),
            wrappedCode
        );

        const result = await fn(...Object.values(contextObj));

        // If the code returned a value, add it to outputs
        if (result !== undefined) {
            outputs.push(String(result));
        }

        return {
            success: true,
            stdout: outputs.join('\n'),
            executionTime: Date.now() - startTime,
        };

    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
            stderr: error instanceof Error ? error.stack : String(error),
            executionTime: Date.now() - startTime,
        };
    }
}

// =============================================================================
// Named Element Resolution
// =============================================================================

/**
 * Find a named table in the document and return its data as a 2D array
 */
function findNamedTable(document: vscode.TextDocument, name: string): unknown[][] | null {
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const nameMatch = line.match(/^#\+(NAME|TBLNAME):\s*(.+?)\s*$/i);

        if (nameMatch && nameMatch[2] === name) {
            // Found the name, look for table on next lines
            if (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
                const tableData: unknown[][] = [];

                for (let j = i + 1; j < lines.length; j++) {
                    const tableLine = lines[j].trim();
                    if (!tableLine.startsWith('|')) break;

                    // Skip separator lines (|---+---|)
                    if (tableLine.match(/^\|[-+]+\|?$/)) continue;

                    // Parse table row
                    const cells = tableLine
                        .split('|')
                        .slice(1, -1)  // Remove first and last empty strings
                        .map(cell => {
                            const trimmed = cell.trim();
                            // Try to convert to number
                            const num = Number(trimmed);
                            return isNaN(num) ? trimmed : num;
                        });

                    if (cells.length > 0) {
                        tableData.push(cells);
                    }
                }

                return tableData.length > 0 ? tableData : null;
            }
        }
    }

    return null;
}

/**
 * Find named results (#+NAME: followed by #+RESULTS:)
 * Supports both:
 * 1. #+NAME: directly above #+RESULTS: (standalone named results)
 * 2. #+NAME: above a source block that has #+RESULTS: after it
 * 3. #+RESULTS: name format (name on the RESULTS line itself)
 */
function findNamedResults(document: vscode.TextDocument, name: string): string | null {
    const text = document.getText();
    const lines = text.split('\n');

    // First, try to find #+RESULTS: name format (name on RESULTS line)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const resultsMatch = line.match(/^#\+RESULTS:\s*(.+?)\s*$/i);
        if (resultsMatch && resultsMatch[1] === name) {
            // Found #+RESULTS: name - collect the result lines
            const resultLines: string[] = [];
            for (let k = i + 1; k < lines.length; k++) {
                const resultLine = lines[k];
                // Results end at empty line or new element (but not verbatim lines starting with : )
                if (resultLine.trim() === '' ||
                    (resultLine.trim().startsWith('#+') && !resultLine.trim().startsWith(': '))) {
                    break;
                }
                // Remove verbatim prefix if present
                resultLines.push(resultLine.replace(/^: /, ''));
            }
            if (resultLines.length > 0) {
                return resultLines.join('\n');
            }
        }
    }

    // Then try #+NAME: above source block or #+RESULTS:
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Check for #+NAME: with matching name
        const nameMatch = line.match(/^#\+NAME:\s*(.+?)\s*$/i);
        if (nameMatch && nameMatch[1] === name) {
            // Look for #+RESULTS: after this #+NAME:
            for (let j = i + 1; j < lines.length; j++) {
                const checkLine = lines[j].trim();

                // Found #+RESULTS: - collect the result lines
                if (checkLine.match(/^#\+RESULTS/i)) {
                    const resultLines: string[] = [];
                    for (let k = j + 1; k < lines.length; k++) {
                        const resultLine = lines[k];
                        // Results end at empty line or new element (but not verbatim lines starting with : )
                        if (resultLine.trim() === '' ||
                            (resultLine.trim().startsWith('#+') && !resultLine.trim().startsWith(': '))) {
                            break;
                        }
                        // Remove verbatim prefix if present
                        resultLines.push(resultLine.replace(/^: /, ''));
                    }
                    if (resultLines.length > 0) {
                        return resultLines.join('\n');
                    }
                }

                // Skip source blocks - they might be between #+NAME: and #+RESULTS:
                if (checkLine.match(/^#\+BEGIN_SRC/i)) {
                    // Find the end of the source block
                    for (let k = j + 1; k < lines.length; k++) {
                        if (lines[k].trim().match(/^#\+END_SRC/i)) {
                            j = k; // Continue searching after the source block
                            break;
                        }
                    }
                    continue;
                }

                // If we hit another #+NAME: with the SAME name, continue (it might be results)
                // If it's a DIFFERENT name, stop searching
                const innerNameMatch = checkLine.match(/^#\+NAME:\s*(.+?)\s*$/i);
                if (innerNameMatch) {
                    if (innerNameMatch[1] === name) {
                        // Same name - continue looking for #+RESULTS: on the next line
                        continue;
                    } else {
                        // Different name - stop
                        break;
                    }
                }
            }
        }
    }

    return null;
}

/**
 * Resolve a variable value - if it references a named element, fetch its data
 */
function resolveVariableValue(
    document: vscode.TextDocument,
    value: string
): unknown {
    // Check if value looks like a reference (not a literal)
    // References are typically simple identifiers without quotes or special chars
    if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(value)) {
        // Try to find as a named table
        const tableData = findNamedTable(document, value);
        if (tableData) {
            return tableData;
        }

        // Try to find as named results
        const results = findNamedResults(document, value);
        if (results) {
            // Try to parse as JSON, otherwise return as string
            try {
                return JSON.parse(results);
            } catch {
                return results;
            }
        }
    }

    // Return as-is (literal value)
    // Try to parse as number or JSON
    const num = Number(value);
    if (!isNaN(num)) return num;

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/**
 * Resolve all variables in header arguments
 */
function resolveVariables(
    document: vscode.TextDocument,
    headers: HeaderArguments
): Record<string, unknown> | undefined {
    if (!headers.var) return undefined;

    const resolved: Record<string, unknown> = {};
    for (const [varName, varValue] of Object.entries(headers.var)) {
        resolved[varName] = resolveVariableValue(document, varValue as string);
    }

    return resolved;
}

/**
 * Information about a source block found in the document
 */
interface SourceBlockInfo {
    language: string;
    parameters: string;
    code: string;
    name?: string;
    /** Line number of #+NAME: if present */
    nameLine?: number;
    startLine: number;
    endLine: number;
    codeStartLine: number;
    codeEndLine: number;
    resultsLine?: number;
    resultsEndLine?: number;
    /** Cached hash from #+RESULTS[hash]: */
    cachedHash?: string;
}

/**
 * Find the source block at the current cursor position
 */
function findSourceBlockAtCursor(
    document: vscode.TextDocument,
    position: vscode.Position
): SourceBlockInfo | null {
    const text = document.getText();
    const lines = text.split('\n');

    // Find #+BEGIN_SRC and #+END_SRC pairs
    const blocks: SourceBlockInfo[] = [];
    let currentBlock: Partial<SourceBlockInfo> | null = null;
    let blockName: string | undefined;
    let blockNameLine: number | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for #+NAME: before a block
        const nameMatch = line.match(/^\s*#\+NAME:\s*(.+?)\s*$/i);
        if (nameMatch) {
            blockName = nameMatch[1];
            blockNameLine = i;
            continue;
        }

        // If we hit a table (starts with |), the #+NAME: belongs to it, not a following src block
        if (blockName && line.match(/^\s*\|/)) {
            blockName = undefined;
            blockNameLine = undefined;
        }

        // If we hit another #+BEGIN_ block (not SRC), the #+NAME: belongs to it
        if (blockName && line.match(/^\s*#\+BEGIN_(?!SRC)/i)) {
            blockName = undefined;
            blockNameLine = undefined;
        }

        // Check for #+BEGIN_SRC
        const beginMatch = line.match(/^\s*#\+BEGIN_SRC\s+(\S+)(.*)?$/i);
        if (beginMatch) {
            currentBlock = {
                language: beginMatch[1],
                parameters: (beginMatch[2] || '').trim(),
                startLine: i,
                codeStartLine: i + 1,
                name: blockName,
                nameLine: blockNameLine,
            };
            blockName = undefined;
            blockNameLine = undefined;
            continue;
        }

        // Check for #+END_SRC
        if (currentBlock && line.match(/^\s*#\+END_SRC\s*$/i)) {
            currentBlock.endLine = i;
            currentBlock.codeEndLine = i - 1;

            // Extract code
            const codeLines = lines.slice(
                currentBlock.codeStartLine!,
                currentBlock.codeEndLine! + 1
            );
            currentBlock.code = codeLines.join('\n');

            // Look for existing #+RESULTS: after the block
            for (let j = i + 1; j < lines.length; j++) {
                const nextLine = lines[j].trim();
                if (!nextLine) continue; // Skip empty lines

                // Check for #+NAME: - if it doesn't match our block's name,
                // any following #+RESULTS: belongs to a different block
                const nameMatch = nextLine.match(/^#\+NAME:\s*(.+?)\s*$/i);
                if (nameMatch) {
                    const resultName = nameMatch[1];
                    if (currentBlock.name && resultName === currentBlock.name) {
                        // This NAME matches our block, continue looking for RESULTS
                        continue;
                    } else {
                        // This NAME belongs to a different block's results, stop looking
                        break;
                    }
                }

                // Match #+RESULTS: or #+RESULTS[hash]:
                const resultsMatch = nextLine.match(/^#\+RESULTS(?:\[([a-f0-9]+)\])?:?/i);
                if (resultsMatch) {
                    currentBlock.resultsLine = j;
                    // Extract cached hash if present
                    if (resultsMatch[1]) {
                        currentBlock.cachedHash = resultsMatch[1];
                    }
                    // Find end of results
                    let inDrawer = false;
                    let inExportBlock = false;
                    for (let k = j + 1; k < lines.length; k++) {
                        const resultLine = lines[k];
                        const trimmedResult = resultLine.trim();

                        // Track drawer state
                        if (trimmedResult.match(/^:RESULTS:$/i)) {
                            inDrawer = true;
                            currentBlock.resultsEndLine = k;
                            continue;
                        }
                        if (inDrawer && trimmedResult.match(/^:END:$/i)) {
                            currentBlock.resultsEndLine = k;
                            break;
                        }

                        // Track export block state
                        if (trimmedResult.match(/^#\+BEGIN_EXPORT/i)) {
                            inExportBlock = true;
                            currentBlock.resultsEndLine = k;
                            continue;
                        }
                        if (inExportBlock && trimmedResult.match(/^#\+END_EXPORT/i)) {
                            inExportBlock = false;
                            currentBlock.resultsEndLine = k;
                            continue;
                        }

                        // Inside drawer or export block, include everything
                        if (inDrawer || inExportBlock) {
                            currentBlock.resultsEndLine = k;
                            continue;
                        }

                        // Results end at next headline or org keyword (except RESULTS continuation)
                        if (resultLine.match(/^\*+ /)) {
                            currentBlock.resultsEndLine = k - 1;
                            break;
                        }

                        // Check for another org keyword (but not a result continuation)
                        if (trimmedResult.match(/^#\+/) && !trimmedResult.match(/^#\+RESULTS/i)) {
                            currentBlock.resultsEndLine = k - 1;
                            break;
                        }

                        // Empty line after results ends the result block (unless in drawer/export)
                        if (!trimmedResult) {
                            // Check if the next non-empty line is still a result line
                            let foundMoreResults = false;
                            for (let m = k + 1; m < lines.length && m < k + 3; m++) {
                                const nextResultLine = lines[m].trim();
                                if (nextResultLine) {
                                    // Check if it's a valid result continuation
                                    if (nextResultLine.match(/^[:|]/) ||
                                        nextResultLine.match(/^\[\[/) ||
                                        nextResultLine.match(/^-\s/)) {
                                        foundMoreResults = true;
                                    }
                                    break;
                                }
                            }
                            if (!foundMoreResults) {
                                currentBlock.resultsEndLine = k - 1;
                                break;
                            }
                        }

                        // Valid result line patterns:
                        // - Lines starting with : (verbatim output)
                        // - Lines starting with | (tables)
                        // - Lines starting with [[ (file links)
                        // - Lines starting with - (list items)
                        // - Lines that are part of a continued result
                        if (trimmedResult.match(/^[:|]/) ||
                            trimmedResult.match(/^\[\[/) ||
                            trimmedResult.match(/^-\s/) ||
                            trimmedResult === '') {
                            currentBlock.resultsEndLine = k;
                            continue;
                        }

                        // If we reach here, it's not a recognized result pattern
                        currentBlock.resultsEndLine = k - 1;
                        break;
                    }
                    break;
                } else if (nextLine.match(/^\*+ /) || nextLine.match(/^#\+/)) {
                    // Hit another element, no results
                    break;
                }
            }

            blocks.push(currentBlock as SourceBlockInfo);
            currentBlock = null;
        }
    }

    // Find block containing cursor
    const cursorLine = position.line;
    for (const block of blocks) {
        if (cursorLine >= block.startLine && cursorLine <= block.endLine) {
            return block;
        }
        // Also allow cursor on #+RESULTS line
        if (block.resultsLine !== undefined &&
            cursorLine >= block.resultsLine &&
            cursorLine <= (block.resultsEndLine ?? block.resultsLine)) {
            return block;
        }
    }

    return null;
}

/**
 * Find the markdown fenced block at cursor position
 */
function findMarkdownFencedBlockAtCursor(document: vscode.TextDocument, position: vscode.Position): SourceBlockInfo | null {
    const lines = document.getText().split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)$/);

        if (fenceMatch) {
            const fence = fenceMatch[1];
            const fenceChar = fence[0];
            const fenceLen = fence.length;
            const language = fenceMatch[2] || 'text';

            // Look for closing fence
            let closingLine = -1;
            for (let j = i + 1; j < lines.length; j++) {
                const closeMatch = lines[j].match(new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`));
                if (closeMatch) {
                    closingLine = j;
                    break;
                }
            }

            if (closingLine !== -1) {
                // Check if cursor is inside this block
                if (position.line >= i && position.line <= closingLine) {
                    // Extract code content
                    const codeLines = lines.slice(i + 1, closingLine);
                    const code = codeLines.join('\n');

                    return {
                        language: language,
                        parameters: '',
                        code: code,
                        startLine: i,
                        endLine: closingLine,
                        codeStartLine: i + 1,
                        codeEndLine: closingLine - 1,
                    };
                }
                i = closingLine + 1;
                continue;
            }
        }
        i++;
    }
    return null;
}

/**
 * Find all source blocks in the document
 */
function findAllSourceBlocks(document: vscode.TextDocument): SourceBlockInfo[] {
    const text = document.getText();
    const lines = text.split('\n');
    const blocks: SourceBlockInfo[] = [];
    let currentBlock: Partial<SourceBlockInfo> | null = null;
    let blockName: string | undefined;
    let blockNameLine: number | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const nameMatch = line.match(/^\s*#\+NAME:\s*(.+?)\s*$/i);
        if (nameMatch) {
            blockName = nameMatch[1];
            blockNameLine = i;
            continue;
        }

        // If we hit a table (starts with |), the #+NAME: belongs to it, not a following src block
        if (blockName && line.match(/^\s*\|/)) {
            blockName = undefined;
            blockNameLine = undefined;
            // Don't continue - let the loop proceed to check other patterns
        }

        // If we hit another #+BEGIN_ block (not SRC), the #+NAME: belongs to it
        if (blockName && line.match(/^\s*#\+BEGIN_(?!SRC)/i)) {
            blockName = undefined;
            blockNameLine = undefined;
        }

        const beginMatch = line.match(/^\s*#\+BEGIN_SRC\s+(\S+)(.*)?$/i);
        if (beginMatch) {
            currentBlock = {
                language: beginMatch[1],
                parameters: (beginMatch[2] || '').trim(),
                startLine: i,
                codeStartLine: i + 1,
                name: blockName,
                nameLine: blockNameLine,
            };
            blockName = undefined;
            blockNameLine = undefined;
            continue;
        }

        if (currentBlock && line.match(/^\s*#\+END_SRC\s*$/i)) {
            currentBlock.endLine = i;
            currentBlock.codeEndLine = i - 1;

            const codeLines = lines.slice(
                currentBlock.codeStartLine!,
                currentBlock.codeEndLine! + 1
            );
            currentBlock.code = codeLines.join('\n');

            // Look for existing #+RESULTS: after the block
            for (let j = i + 1; j < lines.length; j++) {
                const nextLine = lines[j].trim();
                if (!nextLine) continue; // Skip empty lines

                // Check for #+NAME: - if it doesn't match our block's name,
                // any following #+RESULTS: belongs to a different block
                const nameMatch = nextLine.match(/^#\+NAME:\s*(.+?)\s*$/i);
                if (nameMatch) {
                    const resultName = nameMatch[1];
                    if (currentBlock.name && resultName === currentBlock.name) {
                        // This NAME matches our block, continue looking for RESULTS
                        continue;
                    } else {
                        // This NAME belongs to a different block's results, stop looking
                        break;
                    }
                }

                // Match #+RESULTS: or #+RESULTS[hash]:
                const resultsMatch = nextLine.match(/^#\+RESULTS(?:\[([a-f0-9]+)\])?:?/i);
                if (resultsMatch) {
                    currentBlock.resultsLine = j;
                    // Extract cached hash if present
                    if (resultsMatch[1]) {
                        currentBlock.cachedHash = resultsMatch[1];
                    }
                    // Find end of results
                    let inDrawer = false;
                    let inExportBlock = false;
                    for (let k = j + 1; k < lines.length; k++) {
                        const resultLine = lines[k];
                        const trimmedResult = resultLine.trim();

                        // Track drawer state
                        if (trimmedResult.match(/^:RESULTS:$/i)) {
                            inDrawer = true;
                            currentBlock.resultsEndLine = k;
                            continue;
                        }
                        if (inDrawer && trimmedResult.match(/^:END:$/i)) {
                            currentBlock.resultsEndLine = k;
                            break;
                        }

                        // Track export block state
                        if (trimmedResult.match(/^#\+BEGIN_EXPORT/i)) {
                            inExportBlock = true;
                            currentBlock.resultsEndLine = k;
                            continue;
                        }
                        if (inExportBlock && trimmedResult.match(/^#\+END_EXPORT/i)) {
                            inExportBlock = false;
                            currentBlock.resultsEndLine = k;
                            continue;
                        }

                        // Inside drawer or export block, include everything
                        if (inDrawer || inExportBlock) {
                            currentBlock.resultsEndLine = k;
                            continue;
                        }

                        // Results end at next headline or org keyword (except RESULTS continuation)
                        if (resultLine.match(/^\*+ /)) {
                            currentBlock.resultsEndLine = k - 1;
                            break;
                        }

                        // Check for another org keyword (but not a result continuation)
                        if (trimmedResult.match(/^#\+/) && !trimmedResult.match(/^#\+RESULTS/i)) {
                            currentBlock.resultsEndLine = k - 1;
                            break;
                        }

                        // Empty line after results ends the result block (unless in drawer/export)
                        if (!trimmedResult) {
                            // Check if the next non-empty line is still a result line
                            let foundMoreResults = false;
                            for (let m = k + 1; m < lines.length && m < k + 3; m++) {
                                const nextResultLine = lines[m].trim();
                                if (nextResultLine) {
                                    // Check if it's a valid result continuation
                                    if (nextResultLine.match(/^[:|]/) ||
                                        nextResultLine.match(/^\[\[/) ||
                                        nextResultLine.match(/^-\s/)) {
                                        foundMoreResults = true;
                                    }
                                    break;
                                }
                            }
                            if (!foundMoreResults) {
                                currentBlock.resultsEndLine = k - 1;
                                break;
                            }
                        }

                        // Valid result line patterns:
                        // - Lines starting with : (verbatim output)
                        // - Lines starting with | (tables)
                        // - Lines starting with [[ (file links)
                        // - Lines starting with - (list items)
                        // - Lines that are part of a continued result
                        if (trimmedResult.match(/^[:|]/) ||
                            trimmedResult.match(/^\[\[/) ||
                            trimmedResult.match(/^-\s/) ||
                            trimmedResult === '') {
                            currentBlock.resultsEndLine = k;
                            continue;
                        }

                        // If we reach here, it's not a recognized result pattern
                        currentBlock.resultsEndLine = k - 1;
                        break;
                    }
                    break;
                } else if (nextLine.match(/^\*+ /) || nextLine.match(/^#\+/)) {
                    // Hit another element, no results
                    break;
                }
            }

            blocks.push(currentBlock as SourceBlockInfo);
            currentBlock = null;
        }
    }

    return blocks;
}

/**
 * Build a map of named source blocks for #+CALL: execution
 */
function buildNamedBlockMap(document: vscode.TextDocument): Map<string, TangleBlock> {
    const blocks = findAllSourceBlocks(document);
    const blockMap = new Map<string, TangleBlock>();

    for (const block of blocks) {
        if (block.name) {
            // Extract the code content from the document
            const codeLines: string[] = [];
            for (let i = block.codeStartLine; i < block.endLine; i++) {
                codeLines.push(document.lineAt(i).text);
            }
            const code = codeLines.join('\n');

            // Parse headers from parameters
            const headers = parseHeaderArguments(block.parameters);

            // Extract noweb references from code
            const nowebPattern = /<<([^>]+)>>/g;
            const nowebRefs: string[] = [];
            let nowebMatch;
            while ((nowebMatch = nowebPattern.exec(code)) !== null) {
                nowebRefs.push(nowebMatch[1]);
            }

            blockMap.set(block.name, {
                name: block.name,
                language: block.language,
                code: code,
                lineNumber: block.startLine,
                headers: headers,
                nowebRefs: nowebRefs,
            });
        }
    }

    return blockMap;
}

/**
 * Insert or replace results in the document
 */
async function insertResults(
    editor: vscode.TextEditor,
    block: SourceBlockInfo,
    resultText: string
): Promise<void> {
    const document = editor.document;

    await editor.edit((editBuilder) => {
        if (block.resultsLine !== undefined && block.resultsEndLine !== undefined) {
            // Replace existing results
            const startPos = new vscode.Position(block.resultsLine, 0);
            const endPos = new vscode.Position(
                block.resultsEndLine,
                document.lineAt(block.resultsEndLine).text.length
            );
            const range = new vscode.Range(startPos, endPos);
            editBuilder.replace(range, resultText);
        } else {
            // Insert new results after the block
            const insertLine = block.endLine + 1;
            const insertPos = new vscode.Position(insertLine, 0);
            editBuilder.insert(insertPos, '\n' + resultText + '\n');
        }
    });
}

/**
 * Execute a single source block
 */
async function executeBlock(
    editor: vscode.TextEditor,
    block: SourceBlockInfo
): Promise<ExecutionResult> {
    const channel = getOutputChannel();
    const language = block.language;

    // Check if language is supported (scimax runs in extension context, not via executor)
    if (language.toLowerCase() !== 'scimax' && !executorRegistry.isSupported(language)) {
        const msg = `No executor available for language: ${language}`;
        channel.appendLine(`[ERROR] ${msg}`);
        vscode.window.showErrorMessage(msg);
        return {
            success: false,
            error: new Error(msg),
        };
    }

    // Parse header arguments with file-level inheritance
    // Priority: block headers > language-specific file headers > generic file headers
    const fileLevelHeaders = getFileLevelHeaderArgs(editor.document, language);
    const blockHeaders = parseHeaderArguments(block.parameters);
    const headers: HeaderArguments = { ...fileLevelHeaders, ...blockHeaders };

    // Check if evaluation is disabled
    if (headers.eval === 'no' || headers.eval === 'never-export') {
        channel.appendLine(`[INFO] Skipping block (eval: ${headers.eval})`);
        return {
            success: true,
            stdout: '',
        };
    }

    // Check if we need to query user before executing
    if (headers.eval === 'query' || headers.eval === 'query-export') {
        const blockName = block.name ? ` "${block.name}"` : '';
        const answer = await vscode.window.showWarningMessage(
            `Execute ${language} code block${blockName}?`,
            { modal: true },
            'Yes',
            'No'
        );
        if (answer !== 'Yes') {
            channel.appendLine('[INFO] Execution cancelled by user (eval: query)');
            return {
                success: true,
                stdout: '',
            };
        }
    }

    // Build execution context
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const documentDir = path.dirname(editor.document.uri.fsPath);

    // Resolve :dir header - can be absolute or relative to document directory
    let workingDir = documentDir || workspaceFolder;
    if (headers.dir) {
        // Check if this is a Jupyter block - :dir is not supported for Jupyter kernels
        // because the kernel maintains its own working directory state
        if (language.startsWith('jupyter-')) {
            const msg = `:dir is not supported for Jupyter blocks (${language}). ` +
                `Jupyter kernels maintain their own working directory. ` +
                `Use os.chdir() or equivalent in your code instead.`;
            channel.appendLine(`[ERROR] ${msg}`);
            vscode.window.showErrorMessage(msg);
            return {
                success: false,
                error: new Error(msg),
            };
        }

        // Debug: log values before resolution
        channel.appendLine(`[DEBUG] :dir header value: "${headers.dir}"`);
        channel.appendLine(`[DEBUG] documentDir: "${documentDir}"`);
        channel.appendLine(`[DEBUG] workspaceFolder: "${workspaceFolder}"`);
        channel.appendLine(`[DEBUG] path.isAbsolute(headers.dir): ${path.isAbsolute(headers.dir)}`);

        if (path.isAbsolute(headers.dir)) {
            workingDir = headers.dir;
        } else {
            // Resolve relative path against document directory
            const basePath = documentDir || workspaceFolder || '';
            workingDir = path.resolve(basePath, headers.dir);
            channel.appendLine(`[DEBUG] Resolved "${headers.dir}" relative to "${basePath}" = "${workingDir}"`);
        }

        // Verify the directory exists
        const fs = await import('fs');
        channel.appendLine(`[DEBUG] Checking if workingDir exists: "${workingDir}"`);
        channel.appendLine(`[DEBUG] fs.existsSync(workingDir): ${fs.existsSync(workingDir)}`);
        if (!fs.existsSync(workingDir)) {
            const msg = `:dir directory does not exist: ${workingDir}`;
            channel.appendLine(`[ERROR] ${msg}`);
            vscode.window.showErrorMessage(msg);
            return {
                success: false,
                error: new Error(msg),
            };
        }
        channel.appendLine(`[DEBUG] Directory exists, proceeding with execution`);
    }

    // Resolve variable references (e.g., :var data=my-table)
    const resolvedVars = resolveVariables(editor.document, headers);

    // Log execution context for debugging
    channel.appendLine(`[DEBUG] Executing ${language} block`);
    channel.appendLine(`[DEBUG] Document dir: ${documentDir}`);
    channel.appendLine(`[DEBUG] Working dir: ${workingDir}`);
    if (headers.dir) {
        channel.appendLine(`[DEBUG] :dir header: ${headers.dir}`);
    }

    const context: ExecutionContext = {
        cwd: workingDir,
        timeout: 60000, // 60 second default timeout
        variables: resolvedVars,
        results: headers.results ? parseResultsFormat(headers.results) : undefined,
    };

    // Handle :file header for Python matplotlib
    let codeToExecute = block.code;
    let outputFilePath: string | undefined;

    if (headers.file && ['python', 'python3', 'py'].includes(language.toLowerCase())) {
        // Resolve file path relative to working directory (or document directory as fallback)
        const baseDir = workingDir || documentDir;
        if (path.isAbsolute(headers.file)) {
            outputFilePath = headers.file;
        } else {
            outputFilePath = path.resolve(baseDir, headers.file);
        }

        // Ensure directory exists
        const outputDir = path.dirname(outputFilePath);
        const fs = await import('fs');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Add matplotlib savefig code at the end
        // This handles the common case of plotting with matplotlib
        codeToExecute = `${block.code}
# Auto-added by scimax for :file header
import matplotlib.pyplot as plt
if plt.get_fignums():
    plt.savefig(${JSON.stringify(outputFilePath)}, bbox_inches='tight')
    plt.close()
`;
        channel.appendLine(`[DEBUG] :file header: "${headers.file}" -> "${outputFilePath}"`);
    }

    // Inject __org__ context for JavaScript/TypeScript blocks
    const jsLangs = ['js', 'javascript', 'ts', 'typescript', 'node'];
    if (jsLangs.includes(language.toLowerCase())) {
        const orgContext = buildOrgContext(editor.document, block.startLine);
        const orgContextCode = generateOrgContextCode(orgContext);
        codeToExecute = orgContextCode + codeToExecute;
        channel.appendLine(`[DEBUG] Injected __org__ context for ${language} block`);
    }

    // Create the SrcBlockElement for the executor
    const srcBlock: SrcBlockElement = {
        type: 'src-block',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            language: block.language,
            value: codeToExecute,
            parameters: block.parameters,
            preserveIndent: false,
            headers: headers as Record<string, string>,
            lineNumber: block.startLine,
            endLineNumber: block.endLine,
        },
    };

    // Check for cache hit
    const cacheEnabled = headers.cache === 'yes';
    let codeHash: string | undefined;
    if (cacheEnabled) {
        codeHash = computeCodeHash(block.code);
        if (block.cachedHash && block.cachedHash === codeHash) {
            // Cache hit - code hasn't changed
            channel.appendLine(`\n${'='.repeat(60)}`);
            channel.appendLine(`Cache HIT for ${language} block${block.name ? ` (${block.name})` : ''}`);
            channel.appendLine(`Hash: ${codeHash}`);
            channel.appendLine(`${'='.repeat(60)}`);
            vscode.window.showInformationMessage('Using cached results (code unchanged)');
            return {
                success: true,
                stdout: '',
            };
        }
    }

    // Log execution start
    channel.appendLine(`\n${'='.repeat(60)}`);
    channel.appendLine(`Executing ${language} block${block.name ? ` (${block.name})` : ''}`);
    if (cacheEnabled) {
        channel.appendLine(`Cache: ${block.cachedHash ? 'MISS (code changed)' : 'new'}, Hash: ${codeHash}`);
    }
    channel.appendLine(`${'='.repeat(60)}`);
    channel.appendLine(`Code:\n${block.code}`);
    channel.appendLine('-'.repeat(60));

    showStatus(`Executing ${language}...`);

    try {
        let result: ExecutionResult;

        // Special handling for "scimax" language - runs in extension context
        if (language.toLowerCase() === 'scimax') {
            result = await executeScimaxBlock(editor, block, channel);
        } else {
            // Execute the block normally
            result = await executeSourceBlock(srcBlock, context);
        }

        // Log results
        if (result.success) {
            channel.appendLine(`[SUCCESS] Execution completed in ${result.executionTime}ms`);
            if (result.stdout) {
                channel.appendLine(`Output:\n${result.stdout}`);
            }
            if (result.stderr) {
                channel.appendLine(`Stderr:\n${result.stderr}`);
            }
        } else {
            channel.appendLine(`[ERROR] Execution failed`);
            if (result.error) {
                channel.appendLine(`Error: ${result.error.message}`);
            }
            if (result.stderr) {
                channel.appendLine(`Stderr:\n${result.stderr}`);
            }
        }

        // Check if results should be silent
        const resultsFormat = headers.results
            ? parseResultsFormat(headers.results)
            : {};

        // Pass :wrap header to resultsFormat
        if (headers.wrap) {
            resultsFormat.wrap = headers.wrap;
        }

        if (resultsFormat.handling !== 'silent') {
            let resultText: string;

            // If :file header was used and file was created, return file link
            if (outputFilePath && result.success) {
                const fs = await import('fs');
                if (fs.existsSync(outputFilePath)) {
                    // Use relative path from document directory for the link
                    const relativePath = path.relative(documentDir, outputFilePath);
                    // Create a modified result with file path as output
                    const fileResult = {
                        ...result,
                        stdout: relativePath,
                        resultType: 'file' as const,
                    };
                    resultText = formatResult(fileResult, { ...resultsFormat, type: 'file' }, block.name, cacheEnabled ? codeHash : undefined);
                    channel.appendLine(`[DEBUG] File created: ${outputFilePath}`);
                } else {
                    // File wasn't created - show error
                    const errorResult = {
                        ...result,
                        success: false,
                        stdout: `File not created: ${outputFilePath}`,
                    };
                    resultText = formatResult(errorResult, resultsFormat, block.name, cacheEnabled ? codeHash : undefined);
                    channel.appendLine(`[WARN] :file specified but file not created: ${outputFilePath}`);
                }
            } else {
                // Normal result formatting
                // Pass block.name so named blocks get named results
                // Pass codeHash for :cache yes to include in #+RESULTS[hash]:
                resultText = formatResult(result, resultsFormat, block.name, cacheEnabled ? codeHash : undefined);
            }

            await insertResults(editor, block, resultText);
        }

        hideStatus();
        return result;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        channel.appendLine(`[ERROR] ${errorMessage}`);
        hideStatus();
        vscode.window.showErrorMessage(`Execution failed: ${errorMessage}`);
        return {
            success: false,
            error: error instanceof Error ? error : new Error(errorMessage),
        };
    }
}

/**
 * Command: Execute source block at cursor
 * Also handles #+CALL: lines (org only)
 * Supports both org-mode and markdown fenced code blocks
 */
async function executeSourceBlockAtCursor(lineNumber?: number): Promise<void> {
    console.log(`[executeSourceBlockAtCursor] Called, lineNumber=${lineNumber}`);
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const langId = editor.document.languageId;
    if (langId !== 'org' && langId !== 'markdown') {
        vscode.window.showWarningMessage('Not an org-mode or markdown file');
        return;
    }

    // Use provided line number or cursor position
    const targetLine = lineNumber ?? editor.selection.active.line;
    const position = new vscode.Position(targetLine, 0);

    // For org files, also check for #+CALL: and inline calls
    if (langId === 'org') {
        const currentLine = editor.document.lineAt(targetLine).text;

        // Check if on a #+CALL: line
        const callSpec = parseCallLine(currentLine);

        if (callSpec) {
            // Execute #+CALL:
            await executeCallAtCursor(editor, callSpec);
            return;
        }

        // Check if cursor is on an inline babel call (call_name(args))
        const text = editor.document.getText();
        const offset = editor.document.offsetAt(editor.selection.active);
        const inlineCall = findInlineBabelCallAtPosition(text, offset);

        if (inlineCall) {
            // Execute the inline call directly
            await executeInlineCallAtCursor(editor, inlineCall);
            return;
        }
    }

    // Find source block - use lineNumber if provided, otherwise cursor position
    let block: SourceBlockInfo | null;
    if (langId === 'markdown') {
        // For markdown, use the markdown fenced block finder
        block = findMarkdownFencedBlockAtCursor(editor.document, position);
    } else {
        // For org, use the org source block finder
        if (lineNumber !== undefined) {
            const blocks = findAllSourceBlocks(editor.document);
            block = blocks.find(b => b.startLine === lineNumber) || null;
        } else {
            block = findSourceBlockAtCursor(editor.document, editor.selection.active);
        }
    }

    if (!block) {
        vscode.window.showWarningMessage('No source block at cursor position');
        return;
    }

    await executeBlock(editor, block);
}

/**
 * Execute a #+CALL: line
 */
async function executeCallAtCursor(
    editor: vscode.TextEditor,
    callSpec: { name: string; insideHeaders: string; endHeaders: string; arguments: Record<string, string> }
): Promise<void> {
    const channel = getOutputChannel();
    const document = editor.document;

    channel.appendLine(`\n${'='.repeat(60)}`);
    channel.appendLine(`Executing #+CALL: ${callSpec.name}(${Object.entries(callSpec.arguments).map(([k, v]) => `${k}=${v}`).join(', ')})`);
    channel.appendLine(`${'='.repeat(60)}\n`);

    // Build block map from document
    const blockMap = buildNamedBlockMap(document);

    if (!blockMap.has(callSpec.name)) {
        vscode.window.showErrorMessage(`Named block not found: ${callSpec.name}`);
        channel.appendLine(`[ERROR] Named block not found: ${callSpec.name}`);
        return;
    }

    const targetBlock = blockMap.get(callSpec.name)!;
    channel.appendLine(`[INFO] Found block "${callSpec.name}" (${targetBlock.language}) at line ${targetBlock.lineNumber + 1}`);

    showStatus(`Executing ${callSpec.name}...`);

    try {
        // Get working directory
        const documentDir = path.dirname(document.uri.fsPath);

        // Execute the call, passing document text for resolving named references
        const result = await executeCall(
            callSpec,
            blockMap,
            {
                cwd: documentDir,
            },
            document.getText()
        );

        if (result.success) {
            channel.appendLine(`[OK] Execution successful`);
            if (result.stdout) {
                channel.appendLine(`[OUTPUT]\n${result.stdout}`);
            }

            // Format and insert results after the #+CALL: line
            const resultsFormat = parseResultsFormat(callSpec.endHeaders || 'output');

            // Check if results should be silent
            if (resultsFormat.handling === 'silent') {
                channel.appendLine(`[INFO] Results suppressed (silent)`);
            } else {
                const resultText = formatResult(result, resultsFormat, callSpec.name);

                // Find existing results after the #+CALL: line
                const callLine = editor.selection.active.line;
                await insertCallResults(editor, callLine, resultText);
            }
        } else {
            const errorMsg = result.error?.message || result.stderr || 'Unknown error';
            channel.appendLine(`[ERROR] ${errorMsg}`);
            if (result.stderr) {
                channel.appendLine(`[STDERR]\n${result.stderr}`);
            }
            channel.appendLine(`[DEBUG] Full result: ${JSON.stringify(result, null, 2)}`);
            channel.show();
            vscode.window.showErrorMessage(`Call failed: ${errorMsg}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        channel.appendLine(`[ERROR] ${errorMessage}`);
        vscode.window.showErrorMessage(`Call failed: ${errorMessage}`);
    } finally {
        hideStatus();
    }
}

/**
 * Insert or replace results after a #+CALL: line
 */
async function insertCallResults(
    editor: vscode.TextEditor,
    callLine: number,
    resultText: string
): Promise<void> {
    const document = editor.document;
    const lines = document.getText().split('\n');

    // Look for existing #+RESULTS: after the call line
    let existingResultsStart: number | undefined;
    let existingResultsEnd: number | undefined;

    for (let i = callLine + 1; i < lines.length && i < callLine + 20; i++) {
        const line = lines[i].trim();

        // Skip empty lines
        if (!line) continue;

        // Check for #+RESULTS:
        if (line.match(/^#\+RESULTS:/i)) {
            existingResultsStart = i;
            existingResultsEnd = i;

            // Find end of results
            for (let j = i + 1; j < lines.length; j++) {
                const resultLine = lines[j].trim();
                if (resultLine.match(/^[:|]/) || resultLine.match(/^\[\[/) || resultLine === '') {
                    existingResultsEnd = j;
                } else {
                    break;
                }
            }
            break;
        }

        // If we hit another element, stop looking
        if (line.match(/^#\+/) || line.match(/^\*+ /)) {
            break;
        }
    }

    await editor.edit((editBuilder) => {
        if (existingResultsStart !== undefined && existingResultsEnd !== undefined) {
            // Replace existing results
            const startPos = new vscode.Position(existingResultsStart, 0);
            const endPos = new vscode.Position(
                existingResultsEnd,
                document.lineAt(existingResultsEnd).text.length
            );
            const range = new vscode.Range(startPos, endPos);
            editBuilder.replace(range, resultText);
        } else {
            // Insert new results after the call line
            const insertPos = new vscode.Position(callLine + 1, 0);
            editBuilder.insert(insertPos, '\n' + resultText + '\n');
        }
    });
}

/**
 * Parse inline call arguments string into a record
 * e.g., "x=5, y=10" -> { x: "5", y: "10" }
 */
function parseInlineCallArguments(argsStr: string): Record<string, string> {
    const args: Record<string, string> = {};
    if (!argsStr) return args;

    // Split by comma, handling potential spaces
    const pairs = argsStr.split(/\s*,\s*/);
    for (const pair of pairs) {
        const eqIndex = pair.indexOf('=');
        if (eqIndex > 0) {
            const key = pair.substring(0, eqIndex).trim();
            const value = pair.substring(eqIndex + 1).trim();
            args[key] = value;
        }
    }
    return args;
}

/**
 * Execute an inline babel call (call_name(args))
 */
async function executeInlineCallAtCursor(
    editor: vscode.TextEditor,
    inlineCall: InlineBabelCall
): Promise<void> {
    const channel = getOutputChannel();
    const document = editor.document;

    // Parse the arguments string
    const parsedArgs = parseInlineCallArguments(inlineCall.arguments);
    const callName = inlineCall.name;

    channel.appendLine(`\n${'='.repeat(60)}`);
    channel.appendLine(`Executing call_${callName}(${inlineCall.arguments})`);
    channel.appendLine(`${'='.repeat(60)}\n`);

    // Build block map from document
    const blockMap = buildNamedBlockMap(document);

    if (!blockMap.has(callName)) {
        vscode.window.showErrorMessage(`Named block not found: ${callName}`);
        channel.appendLine(`[ERROR] Named block not found: ${callName}`);
        return;
    }

    const targetBlock = blockMap.get(callName)!;
    channel.appendLine(`[INFO] Found block "${callName}" (${targetBlock.language}) at line ${targetBlock.lineNumber + 1}`);

    showStatus(`Executing ${callName}...`);

    try {
        // Get working directory
        const documentDir = path.dirname(document.uri.fsPath);

        // Execute the call with parsed arguments, passing document text for resolving named references
        const result = await executeCall(
            {
                name: callName,
                insideHeaders: inlineCall.insideHeaders || '',
                endHeaders: inlineCall.endHeaders || '',
                arguments: parsedArgs,
            },
            blockMap,
            {
                cwd: documentDir,
            },
            document.getText()
        );

        if (result.success) {
            channel.appendLine(`[OK] Execution successful`);
            if (result.stdout) {
                channel.appendLine(`[OUTPUT]\n${result.stdout}`);
            }

            // For inline calls, we replace the call with {{{results(output)}}}
            // or just show the result in a message
            const output = result.stdout?.trim() || '';

            // Find the inline call position and replace or show result
            const startOffset = inlineCall.start;
            const endOffset = inlineCall.end;
            const startPos = document.positionAt(startOffset);
            const endPos = document.positionAt(endOffset);

            // Check if there's already a result macro after this call
            const lineText = document.lineAt(inlineCall.line).text;
            const afterCall = lineText.substring(endPos.character);
            const resultMatch = afterCall.match(/^\s*\{{{results\(([^)]*)\)}}}/);

            await editor.edit((editBuilder) => {
                if (resultMatch) {
                    // Replace existing result
                    const resultStart = new vscode.Position(inlineCall.line, endPos.character + afterCall.indexOf(resultMatch[0]));
                    const resultEnd = new vscode.Position(inlineCall.line, resultStart.character + resultMatch[0].length);
                    editBuilder.replace(new vscode.Range(resultStart, resultEnd), ` {{{results(${output})}}}`);
                } else {
                    // Insert result after the call
                    editBuilder.insert(endPos, ` {{{results(${output})}}}`);
                }
            });

            vscode.window.showInformationMessage(`Result: ${output}`);
        } else {
            const errorMsg = result.error?.message || result.stderr || 'Unknown error';
            channel.appendLine(`[ERROR] ${errorMsg}`);
            if (result.stderr) {
                channel.appendLine(`[STDERR]\n${result.stderr}`);
            }
            channel.appendLine(`[DEBUG] Full result: ${JSON.stringify(result, null, 2)}`);
            channel.show();
            vscode.window.showErrorMessage(`Call failed: ${errorMsg}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        channel.appendLine(`[ERROR] ${errorMessage}`);
        vscode.window.showErrorMessage(`Call failed: ${errorMessage}`);
    } finally {
        hideStatus();
    }
}

/**
 * Command: Execute all source blocks in buffer
 */
async function executeAllSourceBlocks(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    if (editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('Not an org-mode file');
        return;
    }

    const blocks = findAllSourceBlocks(editor.document);
    if (blocks.length === 0) {
        vscode.window.showInformationMessage('No source blocks found');
        return;
    }

    const channel = getOutputChannel();
    channel.appendLine(`\nExecuting ${blocks.length} source blocks...`);
    channel.show();

    let successCount = 0;
    let failCount = 0;

    // Execute blocks sequentially (results may depend on previous blocks)
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        showStatus(`Executing block ${i + 1}/${blocks.length}...`);

        // Re-find the block as document may have changed
        const currentBlocks = findAllSourceBlocks(editor.document);
        const currentBlock = currentBlocks[i];

        if (!currentBlock) {
            channel.appendLine(`[WARN] Could not find block ${i + 1} after previous executions`);
            continue;
        }

        const result = await executeBlock(editor, currentBlock);
        if (result.success) {
            successCount++;
        } else {
            failCount++;
        }
    }

    hideStatus();

    const message = `Executed ${blocks.length} blocks: ${successCount} succeeded, ${failCount} failed`;
    if (failCount > 0) {
        vscode.window.showWarningMessage(message);
    } else {
        vscode.window.showInformationMessage(message);
    }
}

/**
 * Command: Clear results from source block or #+CALL: line
 * @param blockLine Optional line number of the source block or call line (from CodeLens)
 */
async function clearResultsAtCursor(blockLine?: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;
    const targetLine = blockLine ?? editor.selection.active.line;

    // Check if this is a #+CALL: line
    const lineText = document.lineAt(targetLine).text;
    if (lineText.match(/^\s*#\+CALL:\s*\S+/i)) {
        // Clear results after the #+CALL: line
        await clearCallResults(editor, targetLine);
        return;
    }

    // Otherwise, find the source block
    let block: SourceBlockInfo | null;
    if (blockLine !== undefined) {
        // Find the block at the specified line
        const blocks = findAllSourceBlocks(document);
        block = blocks.find(b => b.startLine === blockLine) || null;
    } else {
        block = findSourceBlockAtCursor(document, editor.selection.active);
    }

    if (!block) {
        vscode.window.showWarningMessage('No source block found');
        return;
    }

    if (block.resultsLine === undefined || block.resultsEndLine === undefined) {
        vscode.window.showInformationMessage('No results to clear');
        return;
    }

    await editor.edit((editBuilder) => {
        // Delete only the results (from #+RESULTS: line to end of results)
        const startPos = new vscode.Position(block!.resultsLine!, 0);
        const endPos = new vscode.Position(
            block!.resultsEndLine! + 1,
            0
        );
        const range = new vscode.Range(startPos, endPos);
        editBuilder.delete(range);
    });
}

/**
 * Clear results after a #+CALL: line
 */
async function clearCallResults(editor: vscode.TextEditor, callLine: number): Promise<void> {
    const document = editor.document;
    const lines = document.getText().split('\n');

    // Look for existing #+RESULTS: after the call line
    let existingResultsStart: number | undefined;
    let existingResultsEnd: number | undefined;

    for (let i = callLine + 1; i < lines.length && i < callLine + 20; i++) {
        const line = lines[i].trim();

        // Skip empty lines
        if (!line) continue;

        // Check for #+RESULTS:
        if (line.match(/^#\+RESULTS:/i)) {
            existingResultsStart = i;
            existingResultsEnd = i;

            // Find end of results
            for (let j = i + 1; j < lines.length; j++) {
                const resultLine = lines[j].trim();
                if (resultLine.match(/^[:|]/) || resultLine.match(/^\[\[/) || resultLine === '') {
                    existingResultsEnd = j;
                } else {
                    break;
                }
            }
            break;
        }

        // If we hit another element, stop looking
        if (line.match(/^#\+/) || line.match(/^\*+ /)) {
            break;
        }
    }

    if (existingResultsStart === undefined) {
        vscode.window.showInformationMessage('No results to clear');
        return;
    }

    await editor.edit((editBuilder) => {
        const startPos = new vscode.Position(existingResultsStart!, 0);
        const endPos = new vscode.Position(existingResultsEnd! + 1, 0);
        const range = new vscode.Range(startPos, endPos);
        editBuilder.delete(range);
    });
}

/**
 * Command: Clear all results in buffer
 */
async function clearAllResults(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const blocks = findAllSourceBlocks(editor.document);
    const blocksWithResults = blocks.filter(b => b.resultsLine !== undefined);

    if (blocksWithResults.length === 0) {
        vscode.window.showInformationMessage('No results to clear');
        return;
    }

    // Delete in reverse order to preserve line numbers
    await editor.edit((editBuilder) => {
        for (const block of blocksWithResults.reverse()) {
            if (block.resultsLine === undefined || block.resultsEndLine === undefined) continue;

            // Delete only the results (from #+RESULTS: line to end of results)
            const startPos = new vscode.Position(block.resultsLine, 0);
            const endPos = new vscode.Position(block.resultsEndLine + 1, 0);
            const range = new vscode.Range(startPos, endPos);
            editBuilder.delete(range);
        }
    });

    vscode.window.showInformationMessage(`Cleared results from ${blocksWithResults.length} blocks`);
}

/**
 * Command: Show Babel output channel
 */
function showBabelOutput(): void {
    getOutputChannel().show();
}

/**
 * Command: Check available executors
 */
async function checkExecutors(): Promise<void> {
    const channel = getOutputChannel();
    channel.appendLine('\nChecking available executors...');
    channel.show();

    const languages = executorRegistry.getLanguages();

    for (const lang of languages) {
        const executor = executorRegistry.getExecutor(lang);
        if (executor) {
            const available = await executor.isAvailable();
            const status = available ? '✓' : '✗';
            channel.appendLine(`  ${status} ${lang}`);
        }
    }

    channel.appendLine('');
}

/**
 * Get source block information for CodeLens
 */
export function getSourceBlocksForCodeLens(
    document: vscode.TextDocument
): Array<{ range: vscode.Range; language: string; name?: string }> {
    const blocks = findAllSourceBlocks(document);
    return blocks.map(block => ({
        range: new vscode.Range(block.startLine, 0, block.endLine, 0),
        language: block.language,
        name: block.name,
    }));
}

/**
 * Get the session name for a source block
 * Returns the session from headers, or 'default' if :session is present without value,
 * or null if no session is specified
 */
function getBlockSessionName(block: SourceBlockInfo): string | null {
    const headers = parseHeaderArguments(block.parameters);
    return headers.session || null;
}

/**
 * Check if a source block uses a Jupyter kernel
 */
function isJupyterBlock(block: SourceBlockInfo): boolean {
    return block.language.startsWith('jupyter-');
}

/**
 * Get the kernel ID for a Jupyter block's session
 */
function getKernelIdForBlock(block: SourceBlockInfo): string | null {
    if (!isJupyterBlock(block)) {
        return null;
    }

    const sessionName = getBlockSessionName(block) || 'default';
    const manager = getKernelManager();
    return manager.getKernelIdBySession(sessionName);
}

/**
 * Command: Interrupt kernel for block at cursor
 */
async function interruptBlockKernel(blockLine?: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;
    const position = blockLine !== undefined
        ? new vscode.Position(blockLine, 0)
        : editor.selection.active;

    const block = findSourceBlockAtCursor(document, position);
    if (!block) {
        vscode.window.showWarningMessage('No source block found at cursor');
        return;
    }

    if (!isJupyterBlock(block)) {
        vscode.window.showWarningMessage('Interrupt only works with Jupyter blocks');
        return;
    }

    const kernelId = getKernelIdForBlock(block);
    if (!kernelId) {
        vscode.window.showWarningMessage('No active kernel for this block\'s session');
        return;
    }

    const manager = getKernelManager();
    const channel = getOutputChannel();

    try {
        channel.appendLine(`Interrupting kernel for session...`);
        await manager.interruptKernel(kernelId);
        channel.appendLine('Kernel interrupted');
        vscode.window.showInformationMessage('Jupyter kernel interrupted');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        channel.appendLine(`Failed to interrupt kernel: ${message}`);
        vscode.window.showErrorMessage(`Failed to interrupt kernel: ${message}`);
    }
}

/**
 * Command: Restart kernel for block at cursor
 */
async function restartBlockKernel(blockLine?: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;
    const position = blockLine !== undefined
        ? new vscode.Position(blockLine, 0)
        : editor.selection.active;

    const block = findSourceBlockAtCursor(document, position);
    if (!block) {
        vscode.window.showWarningMessage('No source block found at cursor');
        return;
    }

    if (!isJupyterBlock(block)) {
        vscode.window.showWarningMessage('Restart only works with Jupyter blocks');
        return;
    }

    const kernelId = getKernelIdForBlock(block);
    if (!kernelId) {
        vscode.window.showWarningMessage('No active kernel for this block\'s session');
        return;
    }

    const manager = getKernelManager();
    const channel = getOutputChannel();

    try {
        channel.appendLine(`Restarting kernel for session...`);
        await manager.restartKernel(kernelId);
        channel.appendLine('Kernel restarted');
        vscode.window.showInformationMessage('Jupyter kernel restarted');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        channel.appendLine(`Failed to restart kernel: ${message}`);
        vscode.window.showErrorMessage(`Failed to restart kernel: ${message}`);
    }
}

/**
 * Register Babel commands
 */
export function registerBabelCommands(context: vscode.ExtensionContext): void {
    // Execute source block at cursor (C-c C-c equivalent)
    // Uses existing command name from package.json
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.executeBlock',
            executeSourceBlockAtCursor
        )
    );

    // Execute all source blocks
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.executeAllBlocks',
            executeAllSourceBlocks
        )
    );

    // Clear results at cursor
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.clearResults',
            clearResultsAtCursor
        )
    );

    // Clear all results
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.clearAllResults',
            clearAllResults
        )
    );

    // Show Babel output
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.showBabelOutput',
            showBabelOutput
        )
    );

    // Check executors
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.checkExecutors',
            checkExecutors
        )
    );

    // Interrupt kernel for block
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.interruptBlockKernel',
            interruptBlockKernel
        )
    );

    // Restart kernel for block
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.restartBlockKernel',
            restartBlockKernel
        )
    );

    // Register status bar item disposal
    context.subscriptions.push({
        dispose: () => {
            statusBarItem?.dispose();
            outputChannel?.dispose();
        },
    });

    // Helper function to check if cursor is inside a markdown fenced code block
    function isInMarkdownFencedBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
        const lines = document.getText().split('\n');
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)$/);

            if (fenceMatch) {
                const fence = fenceMatch[1];
                const fenceChar = fence[0];
                const fenceLen = fence.length;

                // Look for closing fence
                let closingLine = -1;
                for (let j = i + 1; j < lines.length; j++) {
                    const closeMatch = lines[j].match(new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`));
                    if (closeMatch) {
                        closingLine = j;
                        break;
                    }
                }

                if (closingLine !== -1) {
                    // Check if cursor is inside this block
                    if (position.line >= i && position.line <= closingLine) {
                        return true;
                    }
                    i = closingLine + 1;
                    continue;
                }
            }
            i++;
        }
        return false;
    }

    // Helper function to update babel context for keybinding conditions
    function updateBabelContext(editor: vscode.TextEditor | undefined): void {
        if (!editor) {
            vscode.commands.executeCommand('setContext', 'scimax.inSourceBlock', false);
            vscode.commands.executeCommand('setContext', 'scimax.inInlineSrc', false);
            vscode.commands.executeCommand('setContext', 'scimax.inInlineBabelCall', false);
            vscode.commands.executeCommand('setContext', 'scimax.onCallLine', false);
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;

        // Check for markdown files
        if (document.languageId === 'markdown') {
            const inFencedBlock = isInMarkdownFencedBlock(document, position);
            vscode.commands.executeCommand('setContext', 'scimax.inSourceBlock', inFencedBlock);
            vscode.commands.executeCommand('setContext', 'scimax.inInlineSrc', false);
            vscode.commands.executeCommand('setContext', 'scimax.inInlineBabelCall', false);
            vscode.commands.executeCommand('setContext', 'scimax.onCallLine', false);
            return;
        }

        // Only check for org files beyond this point
        if (document.languageId !== 'org') {
            vscode.commands.executeCommand('setContext', 'scimax.inSourceBlock', false);
            vscode.commands.executeCommand('setContext', 'scimax.inInlineSrc', false);
            vscode.commands.executeCommand('setContext', 'scimax.inInlineBabelCall', false);
            vscode.commands.executeCommand('setContext', 'scimax.onCallLine', false);
            return;
        }

        const blockInfo = findSourceBlockAtCursor(document, position);
        const inBlock = blockInfo !== null;
        vscode.commands.executeCommand('setContext', 'scimax.inSourceBlock', inBlock);

        // Check if on a #+CALL: line
        const currentLineText = document.lineAt(position.line).text;
        const onCallLine = /^\s*#\+CALL:\s*\S+/i.test(currentLineText);
        vscode.commands.executeCommand('setContext', 'scimax.onCallLine', onCallLine);

        // Check for inline src block or inline babel call
        const text = document.getText();
        const offset = document.offsetAt(position);
        const inInlineSrc = findInlineSrcAtPosition(text, offset) !== null;
        const inInlineBabelCall = findInlineBabelCallAtPosition(text, offset) !== null;
        vscode.commands.executeCommand('setContext', 'scimax.inInlineSrc', inInlineSrc);
        vscode.commands.executeCommand('setContext', 'scimax.inInlineBabelCall', inInlineBabelCall);
    }

    // Setup source block context tracking for C-c C-c keybinding
    // Update on selection change
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            updateBabelContext(e.textEditor);
        })
    );

    // Update when switching to a different editor
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            updateBabelContext(editor);
        })
    );

    // Initialize context for the current editor when extension activates
    updateBabelContext(vscode.window.activeTextEditor);
}

// Cache for source blocks to avoid re-parsing
interface BlockCacheEntry {
    version: number;
    blocks: SourceBlockInfo[];
}
const blockCache = new Map<string, BlockCacheEntry>();
const MAX_BLOCK_CACHE_SIZE = 10;

/**
 * Code Lens provider for source blocks
 * Optimized with caching and early cancellation checks
 */
export class BabelCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    // Pre-cache supported languages to avoid repeated lookups
    private supportedLanguageCache = new Map<string, boolean>();

    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        // Early cancellation check
        if (token.isCancellationRequested) {
            return [];
        }

        if (document.languageId !== 'org') {
            return [];
        }

        // Check cache first
        const cacheKey = document.uri.toString();
        const cached = blockCache.get(cacheKey);
        let blocks: SourceBlockInfo[];

        if (cached && cached.version === document.version) {
            blocks = cached.blocks;
        } else {
            // Early cancellation check before parsing
            if (token.isCancellationRequested) {
                return [];
            }

            blocks = findAllSourceBlocks(document);

            // Update cache (use LRU-style eviction)
            if (blockCache.size >= MAX_BLOCK_CACHE_SIZE) {
                const firstKey = blockCache.keys().next().value;
                if (firstKey) blockCache.delete(firstKey);
            }
            blockCache.set(cacheKey, { version: document.version, blocks });
        }

        // Another cancellation check after potentially expensive parsing
        if (token.isCancellationRequested) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];

        for (const block of blocks) {
            // Check cancellation periodically during CodeLens creation
            if (token.isCancellationRequested) {
                return [];
            }

            // Use nameLine if present, otherwise startLine (#+BEGIN_SRC line)
            const codeLensLine = block.nameLine !== undefined ? block.nameLine : block.startLine;
            const range = new vscode.Range(codeLensLine, 0, codeLensLine, 0);

            // Check supported language with caching
            let isSupported = this.supportedLanguageCache.get(block.language);
            if (isSupported === undefined) {
                isSupported = executorRegistry.isSupported(block.language);
                this.supportedLanguageCache.set(block.language, isSupported);
            }

            // Data/markup languages that are not meant to be executed
            // Don't show "(unsupported)" for these - they're for data, not code
            const dataLanguages = new Set([
                'json', 'yaml', 'yml', 'xml', 'html', 'css', 'scss', 'less',
                'text', 'txt', 'markdown', 'md', 'org', 'csv', 'tsv',
                'toml', 'ini', 'conf', 'config', 'cfg',
                'data', 'example', 'output', 'result', 'raw',
                'diff', 'patch', 'log', 'svg', 'graphviz', 'dot',
                'plantuml', 'mermaid', 'ditaa', 'ascii', 'artist',
                'latex', 'tex', 'bibtex', 'bib',
            ]);
            const isDataLanguage = dataLanguages.has(block.language.toLowerCase());

            // Run button - only for supported languages
            if (isSupported) {
                codeLenses.push(
                    new vscode.CodeLens(range, {
                        title: '▶ Run',
                        command: 'scimax.org.executeBlock',
                        tooltip: `Execute ${block.language} block`,
                    })
                );
            }

            // Language label - don't show "(unsupported)" for data languages
            const showUnsupported = !isSupported && !isDataLanguage;
            codeLenses.push(
                new vscode.CodeLens(range, {
                    title: `${block.language}${showUnsupported ? ' (unsupported)' : ''}`,
                    command: '',
                    tooltip: isSupported
                        ? `Language: ${block.language}`
                        : isDataLanguage
                            ? `Data format: ${block.language}`
                            : `No executor for ${block.language}`,
                })
            );

            // Clear results button if results exist
            if (block.resultsLine !== undefined) {
                codeLenses.push(
                    new vscode.CodeLens(range, {
                        title: '✕ Clear',
                        command: 'scimax.org.clearResults',
                        arguments: [block.startLine],
                        tooltip: 'Clear results',
                    })
                );
            }

            // Interrupt and Restart buttons for Jupyter blocks
            if (isJupyterBlock(block)) {
                codeLenses.push(
                    new vscode.CodeLens(range, {
                        title: '⏹ Interrupt',
                        command: 'scimax.org.interruptBlockKernel',
                        arguments: [block.startLine],
                        tooltip: 'Interrupt kernel execution',
                    })
                );
                codeLenses.push(
                    new vscode.CodeLens(range, {
                        title: '↻ Restart',
                        command: 'scimax.org.restartBlockKernel',
                        arguments: [block.startLine],
                        tooltip: 'Restart the Jupyter kernel',
                    })
                );
            }
        }

        // Add code lenses for #+CALL: lines
        const text = document.getText();
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (token.isCancellationRequested) {
                return codeLenses;
            }

            const line = lines[i];
            // Match #+CALL: lines
            if (line.match(/^\s*#\+CALL:\s*\S+/i)) {
                const range = new vscode.Range(i, 0, i, 0);

                // Run button
                codeLenses.push(
                    new vscode.CodeLens(range, {
                        title: '▶ Run',
                        command: 'scimax.org.executeBlock',
                        arguments: [i],
                        tooltip: 'Execute this call',
                    })
                );

                // Clear results button
                codeLenses.push(
                    new vscode.CodeLens(range, {
                        title: '✕ Clear',
                        command: 'scimax.org.clearResults',
                        arguments: [i],
                        tooltip: 'Clear results',
                    })
                );
            }
        }

        return codeLenses;
    }
}

/**
 * Register the Code Lens provider
 */
export function registerBabelCodeLens(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'org', scheme: 'file' },
            new BabelCodeLensProvider()
        )
    );
}
