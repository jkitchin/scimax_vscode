/**
 * Scimax-ob: Enhanced source block manipulation
 * Inspired by scimax-ob.el from Emacs scimax
 *
 * Provides Jupyter notebook-like editing for org-mode source blocks:
 * - Block creation, splitting, merging, cloning
 * - Navigation between blocks
 * - Execution commands
 * - Header argument manipulation
 */

import * as vscode from 'vscode';
import { executeSourceBlock, formatResult, parseHeaderArguments, ExecutionContext } from '../parser/orgBabel';

// =============================================================================
// Types
// =============================================================================

type BlockFormat = 'org' | 'markdown';

interface SourceBlock {
    language: string;
    parameters: string;
    code: string;
    startLine: number;
    endLine: number;
    codeStartLine: number;
    codeEndLine: number;
    name?: string;
    format: BlockFormat;
    fence?: string;  // For markdown: the fence characters (``` or ~~~)
}

interface BlockPosition {
    block: SourceBlock;
    resultsStart?: number;
    resultsEnd?: number;
}

/**
 * Detect if document is markdown (based on language ID or file extension)
 */
function isMarkdownDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'markdown' ||
        document.fileName.endsWith('.md') ||
        document.fileName.endsWith('.markdown');
}

// =============================================================================
// Block Finding Functions
// =============================================================================

/**
 * Find the source block at the cursor position
 * Supports both org-mode (#+BEGIN_SRC) and markdown fenced code blocks (``` or ~~~)
 */
function findBlockAtCursor(
    document: vscode.TextDocument,
    position: vscode.Position
): BlockPosition | null {
    const text = document.getText();
    const lines = text.split('\n');
    const isMarkdown = isMarkdownDocument(document);

    if (isMarkdown) {
        return findMarkdownBlockAtCursor(lines, position);
    } else {
        return findOrgBlockAtCursor(lines, position);
    }
}

/**
 * Find an org-mode source block at cursor
 */
function findOrgBlockAtCursor(lines: string[], position: vscode.Position): BlockPosition | null {
    // Find #+BEGIN_SRC above cursor
    let blockStart = -1;
    let language = '';
    let parameters = '';
    let blockName: string | undefined;

    for (let i = position.line; i >= 0; i--) {
        const line = lines[i].trim().toLowerCase();
        if (line.startsWith('#+begin_src')) {
            blockStart = i;
            const fullLine = lines[i].trim();
            const match = fullLine.match(/^#\+BEGIN_SRC\s+(\S+)(.*)$/i);
            if (match) {
                language = match[1];
                parameters = match[2].trim();
            }
            // Look for #+NAME: above
            if (i > 0) {
                const prevLine = lines[i - 1].trim();
                const nameMatch = prevLine.match(/^#\+NAME:\s*(.+)$/i);
                if (nameMatch) {
                    blockName = nameMatch[1];
                }
            }
            break;
        }
        if (line.startsWith('#+end_src')) {
            // We're not inside a block
            return null;
        }
    }

    if (blockStart === -1) return null;

    // Find #+END_SRC below
    let blockEnd = -1;
    for (let i = blockStart + 1; i < lines.length; i++) {
        if (lines[i].trim().toLowerCase().startsWith('#+end_src')) {
            blockEnd = i;
            break;
        }
    }

    if (blockEnd === -1) return null;

    // Check if cursor is within the block
    if (position.line < blockStart || position.line > blockEnd) {
        return null;
    }

    // Extract code
    const codeLines = lines.slice(blockStart + 1, blockEnd);
    const code = codeLines.join('\n');

    const block: SourceBlock = {
        language,
        parameters,
        code,
        startLine: blockStart,
        endLine: blockEnd,
        codeStartLine: blockStart + 1,
        codeEndLine: blockEnd - 1,
        name: blockName,
        format: 'org'
    };

    // Find results section
    let resultsStart: number | undefined;
    let resultsEnd: number | undefined;

    for (let i = blockEnd + 1; i < lines.length && i <= blockEnd + 3; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#+RESULTS:') || line.match(/^#\+RESULTS\[.*\]:$/)) {
            resultsStart = i;
            resultsEnd = i;

            // Find end of results
            for (let j = i + 1; j < lines.length; j++) {
                const resultLine = lines[j];
                // Results end when we hit a non-result line
                if (resultLine.match(/^[^:\s]/) && !resultLine.startsWith('|') && !resultLine.startsWith(':')) {
                    if (!resultLine.startsWith('#+') || resultLine.match(/^#\+(BEGIN|END|NAME|CAPTION)/i)) {
                        break;
                    }
                }
                resultsEnd = j;
                if (resultLine.trim() === '' && j > i + 1) {
                    break;
                }
            }
            break;
        }
        if (line !== '' && !line.startsWith('#')) {
            break;
        }
    }

    return {
        block,
        resultsStart,
        resultsEnd
    };
}

/**
 * Find a markdown fenced code block at cursor
 * Uses a simpler approach: scan for all fence pairs and check if cursor is inside one
 */
function findMarkdownBlockAtCursor(lines: string[], position: vscode.Position): BlockPosition | null {
    // Find all fence blocks and check if cursor is inside one
    const blocks: Array<{ start: number; end: number; fence: string; language: string }> = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)$/);

        if (fenceMatch) {
            const fence = fenceMatch[1];
            const language = fenceMatch[2] || '';
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
                blocks.push({
                    start: i,
                    end: closingLine,
                    fence,
                    language
                });
                i = closingLine + 1;
                continue;
            }
        }
        i++;
    }

    // Find the block containing the cursor
    for (const block of blocks) {
        if (position.line >= block.start && position.line <= block.end) {
            const codeLines = lines.slice(block.start + 1, block.end);
            const code = codeLines.join('\n');

            return {
                block: {
                    language: block.language || 'text',
                    parameters: '',
                    code,
                    startLine: block.start,
                    endLine: block.end,
                    codeStartLine: block.start + 1,
                    codeEndLine: block.end - 1,
                    format: 'markdown',
                    fence: block.fence
                }
            };
        }
    }

    return null;
}

/**
 * Find all source blocks in the document
 * Supports both org-mode and markdown syntax
 */
function findAllBlocks(document: vscode.TextDocument): BlockPosition[] {
    const blocks: BlockPosition[] = [];
    const text = document.getText();
    const lines = text.split('\n');
    const isMarkdown = isMarkdownDocument(document);

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (isMarkdown) {
            // Check for markdown fenced code block
            // Match opening fences (with or without language specifier)
            const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)$/);
            if (fenceMatch) {
                const fence = fenceMatch[1];
                const fenceChar = fence[0];
                const fenceLen = fence.length;

                // Check if this could be an opening fence by looking ahead for closing fence
                let hasClosing = false;
                for (let j = i + 1; j < lines.length; j++) {
                    const closingMatch = lines[j].match(new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`));
                    if (closingMatch) {
                        hasClosing = true;
                        break;
                    }
                    // If we find another opening fence with language, stop
                    const nextOpenMatch = lines[j].match(/^(`{3,}|~{3,})(\w+)$/);
                    if (nextOpenMatch) {
                        break;
                    }
                }

                if (hasClosing) {
                    const pos = new vscode.Position(i, 0);
                    const blockPos = findBlockAtCursor(document, pos);
                    if (blockPos) {
                        blocks.push(blockPos);
                        i = blockPos.block.endLine + 1;
                        continue;
                    }
                }
            }
        } else {
            // Check for org-mode source block
            if (line.trim().toLowerCase().startsWith('#+begin_src')) {
                const pos = new vscode.Position(i, 0);
                const blockPos = findBlockAtCursor(document, pos);
                if (blockPos) {
                    blocks.push(blockPos);
                    i = blockPos.block.endLine + 1;
                    continue;
                }
            }
        }
        i++;
    }

    return blocks;
}

/**
 * Find the next source block after the cursor
 */
function findNextBlock(
    document: vscode.TextDocument,
    position: vscode.Position
): BlockPosition | null {
    const blocks = findAllBlocks(document);
    for (const block of blocks) {
        if (block.block.startLine > position.line) {
            return block;
        }
    }
    return null;
}

/**
 * Find the previous source block before the cursor
 */
function findPreviousBlock(
    document: vscode.TextDocument,
    position: vscode.Position
): BlockPosition | null {
    const blocks = findAllBlocks(document);
    let prev: BlockPosition | null = null;
    for (const block of blocks) {
        // Skip if cursor is inside or at the start of this block
        if (position.line >= block.block.startLine && position.line <= block.block.endLine) {
            break;
        }
        if (block.block.startLine >= position.line) {
            break;
        }
        prev = block;
    }
    return prev;
}

// =============================================================================
// Block Syntax Helpers
// =============================================================================

/**
 * Generate opening line for a code block
 */
function generateBlockOpen(language: string, format: BlockFormat, fence?: string, parameters?: string): string {
    if (format === 'markdown') {
        return `${fence || '```'}${language}`;
    } else {
        return `#+BEGIN_SRC ${language}${parameters ? ' ' + parameters : ''}`;
    }
}

/**
 * Generate closing line for a code block
 */
function generateBlockClose(format: BlockFormat, fence?: string): string {
    if (format === 'markdown') {
        return fence || '```';
    } else {
        return '#+END_SRC';
    }
}

/**
 * Generate a complete code block
 */
function generateBlock(language: string, code: string, format: BlockFormat, fence?: string, parameters?: string): string {
    const open = generateBlockOpen(language, format, fence, parameters);
    const close = generateBlockClose(format, fence);
    return `${open}\n${code}\n${close}`;
}

// =============================================================================
// Block Creation Functions
// =============================================================================

/**
 * Insert a new source block above the current position
 */
export async function insertBlockAbove(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const isMarkdown = isMarkdownDocument(editor.document);
    const format: BlockFormat = isMarkdown ? 'markdown' : 'org';
    const currentBlock = findBlockAtCursor(editor.document, editor.selection.active);
    const insertLine = currentBlock ? currentBlock.block.startLine : editor.selection.active.line;

    // Prompt for language
    const language = await vscode.window.showInputBox({
        prompt: 'Source block language',
        value: 'python',
        placeHolder: 'python, sh, js, etc.'
    });

    if (!language) return;

    const blockText = generateBlock(language, '', format) + '\n';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(insertLine, 0), blockText);
    });

    // Move cursor into the block
    const newPos = new vscode.Position(insertLine + 1, 0);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Insert a new source block below the current position
 */
export async function insertBlockBelow(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const isMarkdown = isMarkdownDocument(editor.document);
    const format: BlockFormat = isMarkdown ? 'markdown' : 'org';
    const currentBlock = findBlockAtCursor(editor.document, editor.selection.active);
    let insertLine: number;

    if (currentBlock) {
        // Insert after results if they exist
        insertLine = (currentBlock.resultsEnd ?? currentBlock.block.endLine) + 1;
    } else {
        insertLine = editor.selection.active.line + 1;
    }

    const language = await vscode.window.showInputBox({
        prompt: 'Source block language',
        value: 'python',
        placeHolder: 'python, sh, js, etc.'
    });

    if (!language) return;

    const blockText = '\n' + generateBlock(language, '', format) + '\n';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(insertLine, 0), blockText);
    });

    // Move cursor into the block
    const newPos = new vscode.Position(insertLine + 2, 0);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Insert a block with the same language as the current block
 */
export async function insertBlockBelowSameLanguage(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const isMarkdown = isMarkdownDocument(editor.document);
    const format: BlockFormat = isMarkdown ? 'markdown' : 'org';
    const currentBlock = findBlockAtCursor(editor.document, editor.selection.active);
    const language = currentBlock?.block.language || 'python';
    const fence = currentBlock?.block.fence;

    let insertLine: number;
    if (currentBlock) {
        insertLine = (currentBlock.resultsEnd ?? currentBlock.block.endLine) + 1;
    } else {
        insertLine = editor.selection.active.line + 1;
    }

    const blockText = '\n' + generateBlock(language, '', format, fence) + '\n';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(insertLine, 0), blockText);
    });

    const newPos = new vscode.Position(insertLine + 2, 0);
    editor.selection = new vscode.Selection(newPos, newPos);
}

// =============================================================================
// Block Manipulation Functions
// =============================================================================

/**
 * Split the current block at the cursor position
 */
export async function splitBlock(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const position = editor.selection.active;
    const blockPos = findBlockAtCursor(editor.document, position);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const { block } = blockPos;

    // Only split if cursor is in the code section
    if (position.line <= block.startLine || position.line >= block.endLine) {
        vscode.window.showInformationMessage('Place cursor inside the code to split');
        return;
    }

    const document = editor.document;
    const lines = document.getText().split('\n');

    // Get code before and after cursor
    const codeBefore = lines.slice(block.codeStartLine, position.line + 1);
    const codeAfter = lines.slice(position.line + 1, block.endLine);

    // If cursor is at the end of a line, adjust
    const currentLineText = document.lineAt(position.line).text;
    if (position.character < currentLineText.length) {
        // Split the current line
        const lineText = currentLineText;
        codeBefore[codeBefore.length - 1] = lineText.substring(0, position.character);
        codeAfter.unshift(lineText.substring(position.character));
    }

    // Generate blocks using correct format
    const openLine = generateBlockOpen(block.language, block.format, block.fence, block.parameters);
    const closeLine = generateBlockClose(block.format, block.fence);

    const newContent = [
        openLine,
        ...codeBefore,
        closeLine,
        '',
        openLine,
        ...codeAfter,
        closeLine
    ].join('\n');

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            block.startLine, 0,
            block.endLine, document.lineAt(block.endLine).text.length
        );
        editBuilder.replace(range, newContent);
    });
}

/**
 * Clone the current block (copy below)
 */
export async function cloneBlock(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const { block } = blockPos;
    const document = editor.document;

    // Get the full block text
    const blockRange = new vscode.Range(
        block.startLine, 0,
        block.endLine, document.lineAt(block.endLine).text.length
    );
    const blockText = document.getText(blockRange);

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(block.endLine + 1, 0), '\n' + blockText + '\n');
    });
}

/**
 * Kill (delete) the current block and its results
 */
export async function killBlockAndResults(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const { block, resultsEnd } = blockPos;
    const document = editor.document;

    // Also look for #+NAME: line above
    let startLine = block.startLine;
    if (startLine > 0) {
        const prevLine = document.lineAt(startLine - 1).text.trim();
        if (prevLine.match(/^#\+NAME:/i)) {
            startLine--;
        }
    }

    const endLine = resultsEnd ?? block.endLine;

    // Copy to clipboard
    const blockRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    const blockText = document.getText(blockRange);
    await vscode.env.clipboard.writeText(blockText);

    await editor.edit(editBuilder => {
        editBuilder.delete(blockRange);
    });

    vscode.window.showInformationMessage('Block killed and copied to clipboard');
}

/**
 * Copy the current block and its results
 */
export async function copyBlockAndResults(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const { block, resultsEnd } = blockPos;
    const document = editor.document;

    let startLine = block.startLine;
    if (startLine > 0) {
        const prevLine = document.lineAt(startLine - 1).text.trim();
        if (prevLine.match(/^#\+NAME:/i)) {
            startLine--;
        }
    }

    const endLine = resultsEnd ?? block.endLine;
    const blockRange = new vscode.Range(
        startLine, 0,
        endLine, document.lineAt(endLine).text.length
    );
    const blockText = document.getText(blockRange);

    await vscode.env.clipboard.writeText(blockText);
    vscode.window.showInformationMessage('Block copied to clipboard');
}

/**
 * Move the current block up
 */
export async function moveBlockUp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const prevBlock = findPreviousBlock(editor.document, new vscode.Position(blockPos.block.startLine - 1, 0));

    if (!prevBlock) {
        vscode.window.showInformationMessage('No previous block to swap with');
        return;
    }

    const document = editor.document;
    const { block, resultsEnd } = blockPos;

    // Get current block text (including results)
    let currentStart = block.startLine;
    if (currentStart > 0 && document.lineAt(currentStart - 1).text.match(/^#\+NAME:/i)) {
        currentStart--;
    }
    const currentEnd = resultsEnd ?? block.endLine;
    const currentRange = new vscode.Range(currentStart, 0, currentEnd + 1, 0);
    const currentText = document.getText(currentRange);

    // Get previous block text
    let prevStart = prevBlock.block.startLine;
    if (prevStart > 0 && document.lineAt(prevStart - 1).text.match(/^#\+NAME:/i)) {
        prevStart--;
    }
    const prevEnd = prevBlock.resultsEnd ?? prevBlock.block.endLine;
    const prevRange = new vscode.Range(prevStart, 0, prevEnd + 1, 0);
    const prevText = document.getText(prevRange);

    // Swap them
    await editor.edit(editBuilder => {
        editBuilder.replace(currentRange, prevText);
        editBuilder.replace(prevRange, currentText);
    });

    // Move cursor to new position
    const newPos = new vscode.Position(prevStart + (editor.selection.active.line - currentStart), 0);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Move the current block down
 */
export async function moveBlockDown(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const endLine = blockPos.resultsEnd ?? blockPos.block.endLine;
    const nextBlock = findNextBlock(editor.document, new vscode.Position(endLine + 1, 0));

    if (!nextBlock) {
        vscode.window.showInformationMessage('No next block to swap with');
        return;
    }

    const document = editor.document;
    const { block, resultsEnd } = blockPos;

    // Get current block text
    let currentStart = block.startLine;
    if (currentStart > 0 && document.lineAt(currentStart - 1).text.match(/^#\+NAME:/i)) {
        currentStart--;
    }
    const currentEnd = resultsEnd ?? block.endLine;
    const currentRange = new vscode.Range(currentStart, 0, currentEnd + 1, 0);
    const currentText = document.getText(currentRange);

    // Get next block text
    let nextStart = nextBlock.block.startLine;
    if (nextStart > 0 && document.lineAt(nextStart - 1).text.match(/^#\+NAME:/i)) {
        nextStart--;
    }
    const nextEnd = nextBlock.resultsEnd ?? nextBlock.block.endLine;
    const nextRange = new vscode.Range(nextStart, 0, nextEnd + 1, 0);
    const nextText = document.getText(nextRange);

    // Swap them (do next first since it comes after)
    await editor.edit(editBuilder => {
        editBuilder.replace(nextRange, currentText);
        editBuilder.replace(currentRange, nextText);
    });

    // Move cursor to new position
    const lineOffset = nextEnd - nextStart + 1;
    const newPos = new vscode.Position(
        currentStart + lineOffset + (editor.selection.active.line - currentStart),
        0
    );
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Merge current block with the previous block
 */
export async function mergeWithPrevious(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const prevBlock = findPreviousBlock(editor.document, new vscode.Position(blockPos.block.startLine - 1, 0));

    if (!prevBlock) {
        vscode.window.showInformationMessage('No previous block to merge with');
        return;
    }

    // Check if same language
    if (prevBlock.block.language !== blockPos.block.language) {
        const confirm = await vscode.window.showWarningMessage(
            `Merge blocks with different languages (${prevBlock.block.language} and ${blockPos.block.language})?`,
            'Yes', 'No'
        );
        if (confirm !== 'Yes') return;
    }

    const document = editor.document;

    // Create merged block using the format of the previous block
    const mergedCode = prevBlock.block.code + '\n' + blockPos.block.code;
    const mergedBlock = generateBlock(
        prevBlock.block.language,
        mergedCode,
        prevBlock.block.format,
        prevBlock.block.fence,
        prevBlock.block.parameters
    );

    // Delete both blocks and insert merged
    const startLine = prevBlock.block.startLine;
    const endLine = blockPos.resultsEnd ?? blockPos.block.endLine;

    await editor.edit(editBuilder => {
        const range = new vscode.Range(startLine, 0, endLine + 1, 0);
        editBuilder.replace(range, mergedBlock + '\n');
    });
}

/**
 * Merge current block with the next block
 */
export async function mergeWithNext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const endLine = blockPos.resultsEnd ?? blockPos.block.endLine;
    const nextBlock = findNextBlock(editor.document, new vscode.Position(endLine + 1, 0));

    if (!nextBlock) {
        vscode.window.showInformationMessage('No next block to merge with');
        return;
    }

    if (nextBlock.block.language !== blockPos.block.language) {
        const confirm = await vscode.window.showWarningMessage(
            `Merge blocks with different languages (${blockPos.block.language} and ${nextBlock.block.language})?`,
            'Yes', 'No'
        );
        if (confirm !== 'Yes') return;
    }

    const document = editor.document;

    // Create merged block using the format of the current block
    const mergedCode = blockPos.block.code + '\n' + nextBlock.block.code;
    const mergedBlock = generateBlock(
        blockPos.block.language,
        mergedCode,
        blockPos.block.format,
        blockPos.block.fence,
        blockPos.block.parameters
    );

    // Delete both blocks and insert merged
    const startLine = blockPos.block.startLine;
    const nextEndLine = nextBlock.resultsEnd ?? nextBlock.block.endLine;

    await editor.edit(editBuilder => {
        const range = new vscode.Range(startLine, 0, nextEndLine + 1, 0);
        editBuilder.replace(range, mergedBlock + '\n');
    });
}

// =============================================================================
// Navigation Functions
// =============================================================================

/**
 * Jump to the next source block
 */
export async function nextSourceBlock(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const nextBlock = findNextBlock(editor.document, editor.selection.active);

    if (!nextBlock) {
        vscode.window.showInformationMessage('No more source blocks');
        return;
    }

    const pos = new vscode.Position(nextBlock.block.codeStartLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/**
 * Jump to the previous source block
 */
export async function previousSourceBlock(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const prevBlock = findPreviousBlock(editor.document, editor.selection.active);

    if (!prevBlock) {
        vscode.window.showInformationMessage('No previous source block');
        return;
    }

    const pos = new vscode.Position(prevBlock.block.codeStartLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/**
 * Jump to a source block using quick pick
 */
export async function jumpToSourceBlock(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blocks = findAllBlocks(editor.document);

    if (blocks.length === 0) {
        vscode.window.showInformationMessage('No source blocks in document');
        return;
    }

    const items = blocks.map((bp, index) => {
        const { block } = bp;
        const preview = block.code.split('\n')[0].substring(0, 50);
        return {
            label: `${block.language}${block.name ? ` (${block.name})` : ''}`,
            description: `Line ${block.startLine + 1}`,
            detail: preview,
            block: bp
        };
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Jump to source block...',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        const pos = new vscode.Position(selected.block.block.codeStartLine, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
}

/**
 * Jump to the results of the current block
 */
export async function jumpToResults(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    if (blockPos.resultsStart === undefined) {
        vscode.window.showInformationMessage('No results for this block');
        return;
    }

    const pos = new vscode.Position(blockPos.resultsStart, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

// =============================================================================
// Execution Functions
// =============================================================================

/**
 * Execute current block and move to next
 */
export async function executeAndNext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Execute current block
    await vscode.commands.executeCommand('scimax.org.executeBlock');

    // Wait a moment for execution to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Move to next block
    await nextSourceBlock();
}

/**
 * Execute current block and insert a new empty block after results
 * The new block has the same language and header arguments
 */
export async function executeAndNew(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Find current block first to get language, parameters, and format
    const initialBlockPos = findBlockAtCursor(editor.document, editor.selection.active);
    if (!initialBlockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const { language, parameters, format, fence } = initialBlockPos.block;

    // Execute current block
    await vscode.commands.executeCommand('scimax.org.executeBlock');

    // Wait for execution to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // Re-find block position (results may have been added/modified)
    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);
    if (!blockPos) return;

    // Determine where to insert new block (after results or after closing delimiter)
    const insertLine = (blockPos.resultsEnd !== undefined ? blockPos.resultsEnd : blockPos.block.endLine) + 1;

    // Build new block with same language, parameters, and format
    const newBlockText = '\n' + generateBlock(language, '', format, fence, parameters) + '\n';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(insertLine, 0), newBlockText);
    });

    // Move cursor into the new block (empty line between delimiters)
    const newPos = new vscode.Position(insertLine + 2, 0);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.InCenter);
}

/**
 * Execute all blocks up to the current position
 */
export async function executeToPoint(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const currentLine = editor.selection.active.line;
    const blocks = findAllBlocks(editor.document);

    // Filter blocks that are before or at the cursor
    const blocksToExecute = blocks.filter(bp => bp.block.startLine <= currentLine);

    if (blocksToExecute.length === 0) {
        vscode.window.showInformationMessage('No blocks to execute');
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Executing blocks',
        cancellable: true
    }, async (progress, token) => {
        for (let i = 0; i < blocksToExecute.length; i++) {
            if (token.isCancellationRequested) break;

            progress.report({
                message: `Block ${i + 1} of ${blocksToExecute.length}`,
                increment: 100 / blocksToExecute.length
            });

            const bp = blocksToExecute[i];

            // Move cursor to block and execute
            const pos = new vscode.Position(bp.block.codeStartLine, 0);
            editor.selection = new vscode.Selection(pos, pos);
            await vscode.commands.executeCommand('scimax.org.executeBlock');

            // Small delay between executions
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    });
}

/**
 * Execute all blocks in the buffer
 */
export async function executeAllBlocks(): Promise<void> {
    await vscode.commands.executeCommand('scimax.org.executeAllBlocks');
}

// =============================================================================
// Results Functions
// =============================================================================

/**
 * Clear results for the current block
 */
export async function clearResults(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    if (blockPos.resultsStart === undefined || blockPos.resultsEnd === undefined) {
        vscode.window.showInformationMessage('No results to clear');
        return;
    }

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            blockPos.resultsStart!, 0,
            blockPos.resultsEnd! + 1, 0
        );
        editBuilder.delete(range);
    });
}

/**
 * Clear all results in the buffer
 */
export async function clearAllResults(): Promise<void> {
    await vscode.commands.executeCommand('scimax.babel.clearResults');
}

/**
 * Toggle visibility of results (fold/unfold)
 */
export async function toggleResultsFold(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos || blockPos.resultsStart === undefined) {
        vscode.window.showInformationMessage('No results to toggle');
        return;
    }

    // Use VS Code's built-in folding
    const pos = new vscode.Position(blockPos.resultsStart, 0);
    editor.selection = new vscode.Selection(pos, pos);
    await vscode.commands.executeCommand('editor.toggleFold');
}

// =============================================================================
// Header Functions
// =============================================================================

/**
 * Edit the header arguments of the current block
 */
export async function editHeader(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) {
        vscode.window.showInformationMessage('Not inside a source block');
        return;
    }

    const { block } = blockPos;

    // Parse current headers
    const currentHeaders = parseHeaderArguments(block.parameters);

    // Common header options
    const headerOptions = [
        { label: ':results', description: 'Output format', options: ['output', 'value', 'table', 'list', 'file', 'silent', 'replace', 'append'] },
        { label: ':exports', description: 'Export behavior', options: ['code', 'results', 'both', 'none'] },
        { label: ':session', description: 'Session name', options: ['none', '*python*', '*R*'] },
        { label: ':var', description: 'Variable assignment', options: [] },
        { label: ':dir', description: 'Working directory', options: [] },
        { label: ':file', description: 'Output file', options: [] },
        { label: ':tangle', description: 'Tangle destination', options: ['yes', 'no'] },
        { label: ':eval', description: 'Evaluation policy', options: ['yes', 'no', 'query', 'never-export'] }
    ];

    const selected = await vscode.window.showQuickPick(headerOptions, {
        placeHolder: 'Select header to edit'
    });

    if (!selected) return;

    let newValue: string | undefined;

    if (selected.options.length > 0) {
        newValue = await vscode.window.showQuickPick(selected.options, {
            placeHolder: `Value for ${selected.label}`
        });
    } else {
        newValue = await vscode.window.showInputBox({
            prompt: `Value for ${selected.label}`,
            placeHolder: 'Enter value'
        });
    }

    if (newValue === undefined) return;

    // Build new parameters
    const headerKey = selected.label.substring(1); // Remove :
    const newParams = block.parameters
        ? `${block.parameters} ${selected.label} ${newValue}`
        : `${selected.label} ${newValue}`;

    const newBeginLine = `#+BEGIN_SRC ${block.language} ${newParams}`;

    await editor.edit(editBuilder => {
        const beginLine = editor.document.lineAt(block.startLine);
        editBuilder.replace(beginLine.range, newBeginLine);
    });
}

/**
 * Add or update a specific header argument
 */
export async function updateHeader(key: string, value: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const blockPos = findBlockAtCursor(editor.document, editor.selection.active);

    if (!blockPos) return;

    const { block } = blockPos;
    const paramKey = key.startsWith(':') ? key : `:${key}`;

    // Check if header already exists
    const regex = new RegExp(`${paramKey}\\s+\\S+`);
    let newParams: string;

    if (regex.test(block.parameters)) {
        // Update existing
        newParams = block.parameters.replace(regex, `${paramKey} ${value}`);
    } else {
        // Add new
        newParams = block.parameters ? `${block.parameters} ${paramKey} ${value}` : `${paramKey} ${value}`;
    }

    const newBeginLine = `#+BEGIN_SRC ${block.language} ${newParams}`;

    await editor.edit(editBuilder => {
        const beginLine = editor.document.lineAt(block.startLine);
        editBuilder.replace(beginLine.range, newBeginLine);
    });
}

// =============================================================================
// Command Registration
// =============================================================================

/**
 * Register all scimax-ob commands
 */
export function registerScimaxObCommands(context: vscode.ExtensionContext): void {
    // Block creation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ob.insertBlockAbove', insertBlockAbove),
        vscode.commands.registerCommand('scimax.ob.insertBlockBelow', insertBlockBelow),
        vscode.commands.registerCommand('scimax.ob.insertBlockBelowSame', insertBlockBelowSameLanguage)
    );

    // Block manipulation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ob.splitBlock', splitBlock),
        vscode.commands.registerCommand('scimax.ob.cloneBlock', cloneBlock),
        vscode.commands.registerCommand('scimax.ob.killBlock', killBlockAndResults),
        vscode.commands.registerCommand('scimax.ob.copyBlock', copyBlockAndResults),
        vscode.commands.registerCommand('scimax.ob.moveBlockUp', moveBlockUp),
        vscode.commands.registerCommand('scimax.ob.moveBlockDown', moveBlockDown),
        vscode.commands.registerCommand('scimax.ob.mergeWithPrevious', mergeWithPrevious),
        vscode.commands.registerCommand('scimax.ob.mergeWithNext', mergeWithNext)
    );

    // Navigation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ob.nextBlock', nextSourceBlock),
        vscode.commands.registerCommand('scimax.ob.previousBlock', previousSourceBlock),
        vscode.commands.registerCommand('scimax.ob.jumpToBlock', jumpToSourceBlock),
        vscode.commands.registerCommand('scimax.ob.jumpToResults', jumpToResults)
    );

    // Execution
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ob.executeAndNext', executeAndNext),
        vscode.commands.registerCommand('scimax.ob.executeAndNew', executeAndNew),
        vscode.commands.registerCommand('scimax.ob.executeToPoint', executeToPoint),
        vscode.commands.registerCommand('scimax.ob.executeAll', executeAllBlocks)
    );

    // Results
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ob.clearResults', clearResults),
        vscode.commands.registerCommand('scimax.ob.clearAllResults', clearAllResults),
        vscode.commands.registerCommand('scimax.ob.toggleResults', toggleResultsFold)
    );

    // Header
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ob.editHeader', editHeader)
    );
}
