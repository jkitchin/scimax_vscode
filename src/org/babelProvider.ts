/**
 * VS Code integration for Org Babel code block execution
 * Provides commands for executing source blocks and managing results
 */

import * as vscode from 'vscode';
import {
    executeSourceBlock,
    formatResult,
    parseHeaderArguments,
    parseResultsFormat,
    executorRegistry,
    type ExecutionResult,
    type ExecutionContext,
    type HeaderArguments,
} from '../parser/orgBabel';
import type { SrcBlockElement } from '../parser/orgElementTypes';
import { findInlineSrcAtPosition, findInlineBabelCallAtPosition } from '../parser/orgBabelAdvanced';

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

/**
 * Information about a source block found in the document
 */
interface SourceBlockInfo {
    language: string;
    parameters: string;
    code: string;
    name?: string;
    startLine: number;
    endLine: number;
    codeStartLine: number;
    codeEndLine: number;
    resultsLine?: number;
    resultsEndLine?: number;
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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for #+NAME: before a block
        const nameMatch = line.match(/^\s*#\+NAME:\s*(.+?)\s*$/i);
        if (nameMatch) {
            blockName = nameMatch[1];
            continue;
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
            };
            blockName = undefined;
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

                if (nextLine.match(/^#\+RESULTS:?/i)) {
                    currentBlock.resultsLine = j;
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
 * Find all source blocks in the document
 */
function findAllSourceBlocks(document: vscode.TextDocument): SourceBlockInfo[] {
    const text = document.getText();
    const lines = text.split('\n');
    const blocks: SourceBlockInfo[] = [];
    let currentBlock: Partial<SourceBlockInfo> | null = null;
    let blockName: string | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const nameMatch = line.match(/^\s*#\+NAME:\s*(.+?)\s*$/i);
        if (nameMatch) {
            blockName = nameMatch[1];
            continue;
        }

        const beginMatch = line.match(/^\s*#\+BEGIN_SRC\s+(\S+)(.*)?$/i);
        if (beginMatch) {
            currentBlock = {
                language: beginMatch[1],
                parameters: (beginMatch[2] || '').trim(),
                startLine: i,
                codeStartLine: i + 1,
                name: blockName,
            };
            blockName = undefined;
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

                if (nextLine.match(/^#\+RESULTS:?/i)) {
                    currentBlock.resultsLine = j;
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

    // Check if language is supported
    if (!executorRegistry.isSupported(language)) {
        const msg = `No executor available for language: ${language}`;
        channel.appendLine(`[ERROR] ${msg}`);
        vscode.window.showErrorMessage(msg);
        return {
            success: false,
            error: new Error(msg),
        };
    }

    // Parse header arguments
    const headers = parseHeaderArguments(block.parameters);

    // Check if evaluation is disabled
    if (headers.eval === 'no' || headers.eval === 'never-export') {
        channel.appendLine(`[INFO] Skipping block (eval: ${headers.eval})`);
        return {
            success: true,
            stdout: '',
        };
    }

    // Build execution context
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const documentDir = editor.document.uri.fsPath.replace(/[/\\][^/\\]+$/, '');

    const context: ExecutionContext = {
        cwd: headers.dir || documentDir || workspaceFolder,
        timeout: 60000, // 60 second default timeout
    };

    // Create the SrcBlockElement for the executor
    const srcBlock: SrcBlockElement = {
        type: 'src-block',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            language: block.language,
            value: block.code,
            parameters: block.parameters,
            preserveIndent: false,
            headers: headers as Record<string, string>,
            lineNumber: block.startLine,
            endLineNumber: block.endLine,
        },
    };

    // Log execution start
    channel.appendLine(`\n${'='.repeat(60)}`);
    channel.appendLine(`Executing ${language} block${block.name ? ` (${block.name})` : ''}`);
    channel.appendLine(`${'='.repeat(60)}`);
    channel.appendLine(`Code:\n${block.code}`);
    channel.appendLine('-'.repeat(60));

    showStatus(`Executing ${language}...`);

    try {
        // Execute the block
        const result = await executeSourceBlock(srcBlock, context);

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

        if (resultsFormat.handling !== 'silent') {
            // Format and insert results
            const resultText = formatResult(result, resultsFormat);
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
 */
async function executeSourceBlockAtCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    if (editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('Not an org-mode file');
        return;
    }

    const block = findSourceBlockAtCursor(editor.document, editor.selection.active);
    if (!block) {
        vscode.window.showWarningMessage('No source block at cursor position');
        return;
    }

    await executeBlock(editor, block);
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
 * Command: Clear results from source block
 * @param blockLine Optional line number of the source block (from CodeLens)
 */
async function clearResultsAtCursor(blockLine?: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    // If blockLine is provided, use it to find the block; otherwise use cursor position
    let block: SourceBlockInfo | null;
    if (blockLine !== undefined) {
        // Find the block at the specified line
        const blocks = findAllSourceBlocks(editor.document);
        block = blocks.find(b => b.startLine === blockLine) || null;
    } else {
        block = findSourceBlockAtCursor(editor.document, editor.selection.active);
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

    // Register status bar item disposal
    context.subscriptions.push({
        dispose: () => {
            statusBarItem?.dispose();
            outputChannel?.dispose();
        },
    });

    // Setup source block context tracking for C-c C-c keybinding
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;

            // Only check for org files
            if (document.languageId !== 'org') {
                vscode.commands.executeCommand('setContext', 'scimax.inSourceBlock', false);
                vscode.commands.executeCommand('setContext', 'scimax.inInlineSrc', false);
                return;
            }

            const position = editor.selection.active;
            const inBlock = findSourceBlockAtCursor(document, position) !== null;
            vscode.commands.executeCommand('setContext', 'scimax.inSourceBlock', inBlock);

            // Check for inline src block or inline babel call
            const text = document.getText();
            const offset = document.offsetAt(position);
            const inInlineSrc = findInlineSrcAtPosition(text, offset) !== null;
            const inInlineBabelCall = findInlineBabelCallAtPosition(text, offset) !== null;
            vscode.commands.executeCommand('setContext', 'scimax.inInlineSrc', inInlineSrc);
            vscode.commands.executeCommand('setContext', 'scimax.inInlineBabelCall', inInlineBabelCall);
        })
    );
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

            const range = new vscode.Range(block.startLine, 0, block.startLine, 0);

            // Run button
            codeLenses.push(
                new vscode.CodeLens(range, {
                    title: '▶ Run',
                    command: 'scimax.org.executeBlock',
                    tooltip: `Execute ${block.language} block`,
                })
            );

            // Check supported language with caching
            let isSupported = this.supportedLanguageCache.get(block.language);
            if (isSupported === undefined) {
                isSupported = executorRegistry.isSupported(block.language);
                this.supportedLanguageCache.set(block.language, isSupported);
            }

            codeLenses.push(
                new vscode.CodeLens(range, {
                    title: `${block.language}${isSupported ? '' : ' (unsupported)'}`,
                    command: '',
                    tooltip: isSupported
                        ? `Language: ${block.language}`
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
