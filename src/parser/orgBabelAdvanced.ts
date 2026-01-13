/**
 * Advanced Org Babel Features
 * Implements tangling, noweb references, caching, inline src, and async queue
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
    ExecutionResult,
    ExecutionContext,
    HeaderArguments,
    parseHeaderArguments,
    executeSourceBlock,
    executorRegistry,
} from '../parser/orgBabel';
import type { SrcBlockElement } from '../parser/orgElementTypes';

// =============================================================================
// Types
// =============================================================================

/**
 * Source block with additional metadata for tangling
 */
export interface TangleBlock {
    /** Block name (from #+NAME:) */
    name?: string;
    /** Language */
    language: string;
    /** Code content */
    code: string;
    /** Target file path (:tangle) */
    tangleFile?: string;
    /** Line number in source */
    lineNumber: number;
    /** Header arguments */
    headers: HeaderArguments;
    /** Affiliated keywords */
    affiliated?: Record<string, string>;
    /** Noweb references in code */
    nowebRefs: string[];
}

/**
 * Inline source specification
 */
export interface InlineSrc {
    /** Language */
    language: string;
    /** Code */
    code: string;
    /** Header arguments */
    headers: HeaderArguments;
    /** Start position in document */
    start: number;
    /** End position in document */
    end: number;
    /** Line number */
    line: number;
}

/**
 * Cache entry for executed results
 */
export interface CacheEntry {
    /** Hash of code + variables */
    hash: string;
    /** Cached result */
    result: ExecutionResult;
    /** Timestamp */
    timestamp: number;
    /** Expiration (ms since epoch, 0 = never) */
    expires: number;
}

/**
 * Async execution queue item
 */
export interface QueueItem {
    /** Unique ID */
    id: string;
    /** Block to execute */
    block: SrcBlockElement;
    /** Execution context */
    context: ExecutionContext;
    /** Priority (lower = higher priority) */
    priority: number;
    /** Callback when done */
    callback?: (result: ExecutionResult) => void;
    /** Status */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    /** Result (when completed) */
    result?: ExecutionResult;
}

/**
 * CALL block specification
 */
export interface CallSpec {
    /** Block name to call */
    name: string;
    /** Inside header arguments */
    insideHeaders: string;
    /** End header arguments */
    endHeaders: string;
    /** Arguments to pass */
    arguments: Record<string, string>;
}

// =============================================================================
// Noweb Reference Expansion
// =============================================================================

/**
 * Find all noweb references in code
 */
export function findNowebReferences(code: string): string[] {
    const refs: string[] = [];
    const pattern = /<<([^>]+)>>/g;
    let match;

    while ((match = pattern.exec(code)) !== null) {
        refs.push(match[1].trim());
    }

    return [...new Set(refs)]; // Deduplicate
}

/**
 * Expand noweb references in code
 * @param code Code with noweb references
 * @param blocks Map of block name -> code
 * @param expanded Set of already expanded blocks (for cycle detection)
 */
export function expandNowebReferences(
    code: string,
    blocks: Map<string, TangleBlock>,
    expanded: Set<string> = new Set()
): string {
    const pattern = /^(\s*)<<([^>]+)>>(.*)$/gm;

    return code.replace(pattern, (match, indent, name, rest) => {
        const trimmedName = name.trim();

        // Check for cycles
        if (expanded.has(trimmedName)) {
            return `${indent}/* ERROR: Circular reference to ${trimmedName} */${rest}`;
        }

        const block = blocks.get(trimmedName);
        if (!block) {
            return `${indent}/* ERROR: Block not found: ${trimmedName} */${rest}`;
        }

        // Mark as expanded
        expanded.add(trimmedName);

        // Recursively expand references in the referenced block
        let expandedCode = expandNowebReferences(block.code, blocks, new Set(expanded));

        // Apply indentation to each line
        if (indent) {
            expandedCode = expandedCode
                .split('\n')
                .map((line, i) => (i === 0 ? line : indent + line))
                .join('\n');
        }

        return expandedCode + rest;
    });
}

// =============================================================================
// Source Block Extraction
// =============================================================================

/**
 * Extract all source blocks from document text
 */
export function extractSourceBlocks(text: string): TangleBlock[] {
    const blocks: TangleBlock[] = [];
    const lines = text.split('\n');

    let currentName: string | undefined;
    let currentAffiliated: Record<string, string> = {};
    let inBlock = false;
    let blockStart = 0;
    let blockLanguage = '';
    let blockHeaders = '';
    let blockCode: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for #+NAME:
        const nameMatch = line.match(/^#\+NAME:\s*(.+)$/i);
        if (nameMatch) {
            currentName = nameMatch[1].trim();
            continue;
        }

        // Check for other affiliated keywords
        const affiliatedMatch = line.match(/^#\+(\w+):\s*(.+)$/i);
        if (affiliatedMatch && !line.match(/^#\+BEGIN_/i)) {
            currentAffiliated[affiliatedMatch[1].toUpperCase()] = affiliatedMatch[2];
            continue;
        }

        // Check for #+BEGIN_SRC
        const beginMatch = line.match(/^#\+BEGIN_SRC\s+(\S+)(.*)$/i);
        if (beginMatch) {
            inBlock = true;
            blockStart = i + 1;
            blockLanguage = beginMatch[1];
            blockHeaders = beginMatch[2] || '';
            blockCode = [];
            continue;
        }

        // Check for #+END_SRC
        if (inBlock && line.match(/^#\+END_SRC/i)) {
            const headers = parseHeaderArguments(blockHeaders);
            const code = blockCode.join('\n');

            blocks.push({
                name: currentName,
                language: blockLanguage,
                code,
                tangleFile: headers.tangle,
                lineNumber: blockStart,
                headers,
                affiliated: Object.keys(currentAffiliated).length > 0 ? { ...currentAffiliated } : undefined,
                nowebRefs: findNowebReferences(code),
            });

            // Reset state
            inBlock = false;
            currentName = undefined;
            currentAffiliated = {};
            continue;
        }

        // Collect code inside block
        if (inBlock) {
            blockCode.push(line);
        } else {
            // Reset affiliated keywords if we hit a non-keyword, non-blank line
            if (line.trim() && !line.startsWith('#')) {
                currentName = undefined;
                currentAffiliated = {};
            }
        }
    }

    return blocks;
}

/**
 * Build a map of named blocks
 */
export function buildBlockMap(blocks: TangleBlock[]): Map<string, TangleBlock> {
    const map = new Map<string, TangleBlock>();

    for (const block of blocks) {
        if (block.name) {
            map.set(block.name, block);
        }
    }

    return map;
}

// =============================================================================
// Tangling
// =============================================================================

/**
 * Options for tangling
 */
export interface TangleOptions {
    /** Base directory for relative paths */
    baseDir: string;
    /** Whether to create parent directories */
    mkdirp?: boolean;
    /** Whether to add comments referencing source */
    comments?: 'yes' | 'no' | 'link' | 'org' | 'both' | 'noweb';
    /** Whether to add padlines between blocks */
    padline?: boolean;
    /** Shebang line for scripts */
    shebang?: string;
    /** Only tangle blocks with these names */
    onlyBlocks?: string[];
    /** Expand noweb references */
    noweb?: boolean;
}

/**
 * Result of tangling operation
 */
export interface TangleResult {
    /** Files that were written */
    files: { path: string; blocks: number; lines: number }[];
    /** Errors encountered */
    errors: { block: TangleBlock; error: string }[];
    /** Total blocks tangled */
    totalBlocks: number;
}

/**
 * Tangle source blocks to files
 */
export function tangleBlocks(
    blocks: TangleBlock[],
    options: TangleOptions
): TangleResult {
    const result: TangleResult = {
        files: [],
        errors: [],
        totalBlocks: 0,
    };

    // Group blocks by target file
    const fileGroups = new Map<string, TangleBlock[]>();

    for (const block of blocks) {
        // Skip blocks without tangle target
        if (!block.tangleFile || block.tangleFile === 'no') {
            continue;
        }

        // Skip if filtering by name
        if (options.onlyBlocks && block.name && !options.onlyBlocks.includes(block.name)) {
            continue;
        }

        // Resolve file path
        let targetPath = block.tangleFile;
        if (targetPath === 'yes') {
            // Use default: same name as source with appropriate extension
            const ext = getDefaultExtension(block.language);
            targetPath = `tangled.${ext}`;
        }

        if (!path.isAbsolute(targetPath)) {
            targetPath = path.resolve(options.baseDir, targetPath);
        }

        if (!fileGroups.has(targetPath)) {
            fileGroups.set(targetPath, []);
        }
        fileGroups.get(targetPath)!.push(block);
    }

    // Build block map for noweb expansion
    const blockMap = buildBlockMap(blocks);

    // Write each file
    for (const [filePath, fileBlocks] of fileGroups) {
        try {
            const content: string[] = [];

            // Add shebang if specified
            const firstBlock = fileBlocks[0];
            const shebang = firstBlock.headers.shebang || options.shebang;
            if (shebang) {
                content.push(shebang.startsWith('#!') ? shebang : `#!${shebang}`);
            }

            for (let i = 0; i < fileBlocks.length; i++) {
                const block = fileBlocks[i];

                // Add padline between blocks
                if (i > 0 && options.padline !== false) {
                    content.push('');
                }

                // Add comment header if requested
                if (options.comments && options.comments !== 'no') {
                    const comment = getCommentSyntax(block.language);
                    if (comment) {
                        if (options.comments === 'link' || options.comments === 'both') {
                            content.push(`${comment.start} [[file:${options.baseDir}::${block.lineNumber}][${block.name || 'source'}]] ${comment.end || ''}`);
                        } else if (options.comments === 'org' || options.comments === 'both') {
                            content.push(`${comment.start} BEGIN ${block.name || 'block'} ${comment.end || ''}`);
                        }
                    }
                }

                // Expand noweb references if requested
                let code = block.code;
                if (options.noweb !== false && (block.headers.noweb === 'yes' || block.headers.noweb === 'tangle')) {
                    code = expandNowebReferences(code, blockMap);
                }

                // Add prologue
                if (block.headers.prologue) {
                    content.push(block.headers.prologue);
                }

                // Add the code
                content.push(code);

                // Add epilogue
                if (block.headers.epilogue) {
                    content.push(block.headers.epilogue);
                }

                // Add end comment
                if (options.comments === 'org' || options.comments === 'both') {
                    const comment = getCommentSyntax(block.language);
                    if (comment) {
                        content.push(`${comment.start} END ${block.name || 'block'} ${comment.end || ''}`);
                    }
                }

                result.totalBlocks++;
            }

            // Create parent directories if needed
            if (options.mkdirp !== false) {
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }

            // Write file
            const fileContent = content.join('\n');
            fs.writeFileSync(filePath, fileContent);

            result.files.push({
                path: filePath,
                blocks: fileBlocks.length,
                lines: fileContent.split('\n').length,
            });
        } catch (err) {
            result.errors.push({
                block: fileBlocks[0],
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return result;
}

/**
 * Get default file extension for a language
 */
function getDefaultExtension(language: string): string {
    const extensions: Record<string, string> = {
        python: 'py',
        python3: 'py',
        py: 'py',
        javascript: 'js',
        js: 'js',
        typescript: 'ts',
        ts: 'ts',
        ruby: 'rb',
        perl: 'pl',
        bash: 'sh',
        sh: 'sh',
        shell: 'sh',
        c: 'c',
        'c++': 'cpp',
        cpp: 'cpp',
        java: 'java',
        go: 'go',
        rust: 'rs',
        haskell: 'hs',
        lua: 'lua',
        r: 'R',
        julia: 'jl',
        sql: 'sql',
        html: 'html',
        css: 'css',
        elisp: 'el',
        'emacs-lisp': 'el',
    };

    return extensions[language.toLowerCase()] || 'txt';
}

/**
 * Get comment syntax for a language
 */
function getCommentSyntax(language: string): { start: string; end?: string } | null {
    const comments: Record<string, { start: string; end?: string }> = {
        python: { start: '#' },
        python3: { start: '#' },
        py: { start: '#' },
        javascript: { start: '//' },
        js: { start: '//' },
        typescript: { start: '//' },
        ts: { start: '//' },
        ruby: { start: '#' },
        perl: { start: '#' },
        bash: { start: '#' },
        sh: { start: '#' },
        shell: { start: '#' },
        c: { start: '/*', end: '*/' },
        'c++': { start: '//' },
        cpp: { start: '//' },
        java: { start: '//' },
        go: { start: '//' },
        rust: { start: '//' },
        haskell: { start: '--' },
        lua: { start: '--' },
        r: { start: '#' },
        julia: { start: '#' },
        sql: { start: '--' },
        html: { start: '<!--', end: '-->' },
        css: { start: '/*', end: '*/' },
        elisp: { start: ';;' },
        'emacs-lisp': { start: ';;' },
    };

    return comments[language.toLowerCase()] || null;
}

// =============================================================================
// Result Caching
// =============================================================================

const resultCache = new Map<string, CacheEntry>();

/**
 * Generate a hash for cache key
 */
export function generateCacheHash(
    code: string,
    language: string,
    variables?: Record<string, unknown>
): string {
    const data = JSON.stringify({ code, language, variables: variables || {} });
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Get cached result if available
 */
export function getCachedResult(hash: string): ExecutionResult | null {
    const entry = resultCache.get(hash);

    if (!entry) {
        return null;
    }

    // Check expiration
    if (entry.expires > 0 && Date.now() > entry.expires) {
        resultCache.delete(hash);
        return null;
    }

    return entry.result;
}

/**
 * Cache an execution result
 */
export function cacheResult(
    hash: string,
    result: ExecutionResult,
    ttlMs: number = 0
): void {
    resultCache.set(hash, {
        hash,
        result,
        timestamp: Date.now(),
        expires: ttlMs > 0 ? Date.now() + ttlMs : 0,
    });
}

/**
 * Clear the result cache
 */
export function clearResultCache(): void {
    resultCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { entries: number; hits: number; misses: number } {
    return {
        entries: resultCache.size,
        hits: cacheHits,
        misses: cacheMisses,
    };
}

let cacheHits = 0;
let cacheMisses = 0;

/**
 * Execute with caching support
 */
export async function executeWithCache(
    block: SrcBlockElement,
    context: ExecutionContext,
    headers: HeaderArguments
): Promise<ExecutionResult> {
    // Skip caching if not requested
    if (headers.cache !== 'yes') {
        return executeSourceBlock(block, context);
    }

    // Generate cache key
    const hash = generateCacheHash(
        block.properties.value,
        block.properties.language,
        context.variables
    );

    // Check cache
    const cached = getCachedResult(hash);
    if (cached) {
        cacheHits++;
        return { ...cached, executionTime: 0 }; // Mark as cached
    }

    cacheMisses++;

    // Execute and cache
    const result = await executeSourceBlock(block, context);
    if (result.success) {
        cacheResult(hash, result);
    }

    return result;
}

// =============================================================================
// Inline Source Support
// =============================================================================

/**
 * Pattern for inline src: src_LANG{CODE} or src_LANG[HEADERS]{CODE}
 */
const INLINE_SRC_PATTERN = /src_(\w+)(?:\[([^\]]*)\])?\{([^}]+)\}/g;

/**
 * Find all inline src blocks in text
 */
export function findInlineSrc(text: string): InlineSrc[] {
    const results: InlineSrc[] = [];
    const lines = text.split('\n');
    let offset = 0;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        let match;
        INLINE_SRC_PATTERN.lastIndex = 0;

        while ((match = INLINE_SRC_PATTERN.exec(line)) !== null) {
            results.push({
                language: match[1],
                code: match[3],
                headers: parseHeaderArguments(match[2] || ''),
                start: offset + match.index,
                end: offset + match.index + match[0].length,
                line: lineNum,
            });
        }

        offset += line.length + 1; // +1 for newline
    }

    return results;
}

/**
 * Execute an inline src block
 */
export async function executeInlineSrc(
    inline: InlineSrc,
    baseContext: ExecutionContext = {}
): Promise<ExecutionResult> {
    // Create a minimal block for execution
    const block: SrcBlockElement = {
        type: 'src-block',
        properties: {
            language: inline.language,
            value: inline.code,
            parameters: '',
        },
        range: { start: inline.start, end: inline.end },
    };

    const context: ExecutionContext = {
        ...baseContext,
        cwd: inline.headers.dir || baseContext.cwd,
    };

    return executeSourceBlock(block, context);
}

/**
 * Find inline src at position
 */
export function findInlineSrcAtPosition(
    text: string,
    offset: number
): InlineSrc | null {
    const inlines = findInlineSrc(text);

    for (const inline of inlines) {
        if (offset >= inline.start && offset <= inline.end) {
            return inline;
        }
    }

    return null;
}

// =============================================================================
// #+CALL: Support
// =============================================================================

/**
 * Parse a #+CALL: line
 * Formats:
 *   #+CALL: name()
 *   #+CALL: name(arg=value)
 *   #+CALL: name[:inside-header](arg=value)[:end-header]
 */
export function parseCallLine(line: string): CallSpec | null {
    const match = line.match(/^#\+CALL:\s*(\S+?)(?:\[(.*?)\])?\((.*?)\)(?:\[(.*?)\])?$/i);
    if (!match) return null;

    const name = match[1];
    const insideHeaders = match[2] || '';
    const argsStr = match[3] || '';
    const endHeaders = match[4] || '';

    // Parse arguments
    const args: Record<string, string> = {};
    if (argsStr) {
        const argPattern = /(\w+)=([^,]+)/g;
        let argMatch;
        while ((argMatch = argPattern.exec(argsStr)) !== null) {
            args[argMatch[1]] = argMatch[2].trim();
        }
    }

    return {
        name,
        insideHeaders,
        endHeaders,
        arguments: args,
    };
}

/**
 * Execute a #+CALL: block
 */
export async function executeCall(
    callSpec: CallSpec,
    blocks: Map<string, TangleBlock>,
    baseContext: ExecutionContext = {}
): Promise<ExecutionResult> {
    const block = blocks.get(callSpec.name);
    if (!block) {
        return {
            success: false,
            error: new Error(`Block not found: ${callSpec.name}`),
        };
    }

    // Merge headers
    const insideHeaders = parseHeaderArguments(callSpec.insideHeaders);
    const endHeaders = parseHeaderArguments(callSpec.endHeaders);

    // Create execution context with call arguments as variables
    const context: ExecutionContext = {
        ...baseContext,
        variables: {
            ...baseContext.variables,
            ...callSpec.arguments,
        },
        cwd: insideHeaders.dir || baseContext.cwd,
    };

    // Create block for execution
    const execBlock: SrcBlockElement = {
        type: 'src-block',
        properties: {
            language: block.language,
            value: block.code,
            parameters: '',
        },
        range: { start: 0, end: 0 },
    };

    return executeSourceBlock(execBlock, context);
}

// =============================================================================
// Async Execution Queue
// =============================================================================

class ExecutionQueue {
    private queue: QueueItem[] = [];
    private running: QueueItem | null = null;
    private maxConcurrent: number = 1;
    private paused: boolean = false;
    private onQueueChange?: (queue: QueueItem[]) => void;

    constructor(maxConcurrent: number = 1) {
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * Set callback for queue changes
     */
    setOnQueueChange(callback: (queue: QueueItem[]) => void): void {
        this.onQueueChange = callback;
    }

    /**
     * Add item to queue
     */
    enqueue(
        block: SrcBlockElement,
        context: ExecutionContext,
        priority: number = 0,
        callback?: (result: ExecutionResult) => void
    ): string {
        const id = crypto.randomUUID();

        const item: QueueItem = {
            id,
            block,
            context,
            priority,
            callback,
            status: 'pending',
        };

        // Insert by priority (lower priority value = higher priority)
        let inserted = false;
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].priority > priority) {
                this.queue.splice(i, 0, item);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            this.queue.push(item);
        }

        this.notifyChange();
        this.processNext();

        return id;
    }

    /**
     * Cancel a queued item
     */
    cancel(id: string): boolean {
        const index = this.queue.findIndex(item => item.id === id);
        if (index >= 0) {
            this.queue[index].status = 'cancelled';
            this.queue.splice(index, 1);
            this.notifyChange();
            return true;
        }

        // Can't cancel running item (would need process management)
        return false;
    }

    /**
     * Clear all pending items
     */
    clearPending(): void {
        this.queue = this.queue.filter(item => item.status !== 'pending');
        this.notifyChange();
    }

    /**
     * Pause queue processing
     */
    pause(): void {
        this.paused = true;
    }

    /**
     * Resume queue processing
     */
    resume(): void {
        this.paused = false;
        this.processNext();
    }

    /**
     * Get queue status
     */
    getStatus(): { pending: number; running: number; completed: number } {
        return {
            pending: this.queue.filter(i => i.status === 'pending').length,
            running: this.running ? 1 : 0,
            completed: this.queue.filter(i => i.status === 'completed').length,
        };
    }

    /**
     * Get all items
     */
    getItems(): QueueItem[] {
        return [...this.queue];
    }

    /**
     * Process next item in queue
     */
    private async processNext(): Promise<void> {
        if (this.paused || this.running) {
            return;
        }

        const next = this.queue.find(item => item.status === 'pending');
        if (!next) {
            return;
        }

        this.running = next;
        next.status = 'running';
        this.notifyChange();

        try {
            const result = await executeSourceBlock(next.block, next.context);
            next.result = result;
            next.status = result.success ? 'completed' : 'failed';

            if (next.callback) {
                next.callback(result);
            }
        } catch (err) {
            next.status = 'failed';
            next.result = {
                success: false,
                error: err instanceof Error ? err : new Error(String(err)),
            };

            if (next.callback) {
                next.callback(next.result);
            }
        } finally {
            this.running = null;
            this.notifyChange();
            this.processNext(); // Process next item
        }
    }

    private notifyChange(): void {
        if (this.onQueueChange) {
            this.onQueueChange(this.getItems());
        }
    }
}

// Global execution queue
export const executionQueue = new ExecutionQueue();

// =============================================================================
// Execute to Point
// =============================================================================

/**
 * Find all source blocks up to a given line
 */
export function findBlocksUpToLine(
    text: string,
    targetLine: number
): TangleBlock[] {
    const allBlocks = extractSourceBlocks(text);
    return allBlocks.filter(block => block.lineNumber <= targetLine);
}

/**
 * Execute all blocks up to the cursor position
 */
export async function executeToPoint(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: ExecutionContext = {}
): Promise<ExecutionResult[]> {
    const text = document.getText();
    const blocks = findBlocksUpToLine(text, position.line + 1);
    const results: ExecutionResult[] = [];

    for (const block of blocks) {
        // Create SrcBlockElement
        const srcBlock: SrcBlockElement = {
            type: 'src-block',
            properties: {
                language: block.language,
                value: block.code,
                parameters: '',
            },
            range: { start: 0, end: 0 },
        };

        // Skip non-executable blocks
        if (block.headers.eval === 'no' || block.headers.eval === 'never-export') {
            continue;
        }

        const result = await executeWithCache(srcBlock, context, block.headers);
        results.push(result);

        // Stop on first error if not in lenient mode
        if (!result.success && !context.variables?.['org-babel-confirm-evaluate-answer-no']) {
            break;
        }
    }

    return results;
}

// =============================================================================
// VS Code Integration
// =============================================================================

let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Initialize the babel advanced features
 */
export function initBabelAdvanced(context: vscode.ExtensionContext): void {
    // Create status bar for queue
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    statusBarItem.command = 'scimax.babel.showQueue';
    context.subscriptions.push(statusBarItem);

    // Create output channel
    outputChannel = vscode.window.createOutputChannel('Org Babel');
    context.subscriptions.push(outputChannel);

    // Update status bar on queue changes
    executionQueue.setOnQueueChange((items) => {
        const pending = items.filter(i => i.status === 'pending').length;
        const running = items.filter(i => i.status === 'running').length;

        if (pending > 0 || running > 0) {
            statusBarItem!.text = `$(sync~spin) Babel: ${running} running, ${pending} queued`;
            statusBarItem!.show();
        } else {
            statusBarItem!.hide();
        }
    });
}

/**
 * Register babel advanced commands
 */
export function registerBabelAdvancedCommands(context: vscode.ExtensionContext): void {
    initBabelAdvanced(context);

    // Tangle document
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.tangle', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'org') {
                vscode.window.showWarningMessage('Open an org file to tangle');
                return;
            }

            const text = editor.document.getText();
            const blocks = extractSourceBlocks(text);
            const baseDir = path.dirname(editor.document.uri.fsPath);

            const result = tangleBlocks(blocks, {
                baseDir,
                mkdirp: true,
                comments: 'link',
                padline: true,
                noweb: true,
            });

            if (result.errors.length > 0) {
                for (const err of result.errors) {
                    vscode.window.showErrorMessage(`Tangle error: ${err.error}`);
                }
            }

            if (result.files.length > 0) {
                const fileList = result.files.map(f => path.basename(f.path)).join(', ');
                vscode.window.showInformationMessage(
                    `Tangled ${result.totalBlocks} blocks to ${result.files.length} files: ${fileList}`
                );
            } else {
                vscode.window.showInformationMessage('No blocks to tangle (no :tangle headers)');
            }
        })
    );

    // Execute to point
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.executeToPoint', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'org') {
                return;
            }

            const results = await executeToPoint(editor.document, editor.selection.active, {
                cwd: path.dirname(editor.document.uri.fsPath),
            });

            const successCount = results.filter(r => r.success).length;
            const failCount = results.length - successCount;

            if (failCount > 0) {
                vscode.window.showWarningMessage(
                    `Executed ${results.length} blocks: ${successCount} succeeded, ${failCount} failed`
                );
            } else {
                vscode.window.showInformationMessage(
                    `Executed ${results.length} blocks successfully`
                );
            }
        })
    );

    // Execute inline src at cursor
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.executeInline', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const text = editor.document.getText();
            const offset = editor.document.offsetAt(editor.selection.active);
            const inline = findInlineSrcAtPosition(text, offset);

            if (!inline) {
                vscode.window.showWarningMessage('No inline src block at cursor');
                return;
            }

            const result = await executeInlineSrc(inline, {
                cwd: path.dirname(editor.document.uri.fsPath),
            });

            if (result.success) {
                // Show result in output
                outputChannel?.appendLine(`=== Inline ${inline.language} result ===`);
                outputChannel?.appendLine(result.stdout || '(no output)');
                outputChannel?.show();
            } else {
                vscode.window.showErrorMessage(
                    `Inline execution failed: ${result.error?.message || result.stderr}`
                );
            }
        })
    );

    // Clear cache
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.clearCache', () => {
            clearResultCache();
            vscode.window.showInformationMessage('Babel result cache cleared');
        })
    );

    // Show cache stats
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.cacheStats', () => {
            const stats = getCacheStats();
            vscode.window.showInformationMessage(
                `Babel cache: ${stats.entries} entries, ${stats.hits} hits, ${stats.misses} misses`
            );
        })
    );

    // Show queue
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.showQueue', () => {
            const status = executionQueue.getStatus();
            vscode.window.showInformationMessage(
                `Babel queue: ${status.pending} pending, ${status.running} running, ${status.completed} completed`
            );
        })
    );

    // Clear queue
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.clearQueue', () => {
            executionQueue.clearPending();
            vscode.window.showInformationMessage('Babel execution queue cleared');
        })
    );

    // Queue execution (async)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.queueBlock', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'org') {
                return;
            }

            // Find block at cursor (simplified - would use parser in real implementation)
            const text = editor.document.getText();
            const blocks = extractSourceBlocks(text);
            const cursorLine = editor.selection.active.line + 1;

            const block = blocks.find(b => {
                const endLine = b.lineNumber + b.code.split('\n').length;
                return cursorLine >= b.lineNumber && cursorLine <= endLine;
            });

            if (!block) {
                vscode.window.showWarningMessage('No source block at cursor');
                return;
            }

            // Create SrcBlockElement
            const srcBlock: SrcBlockElement = {
                type: 'src-block',
                properties: {
                    language: block.language,
                    value: block.code,
                    parameters: '',
                },
                range: { start: 0, end: 0 },
            };

            const id = executionQueue.enqueue(
                srcBlock,
                { cwd: path.dirname(editor.document.uri.fsPath) },
                0,
                (result) => {
                    if (result.success) {
                        outputChannel?.appendLine(`=== Block completed ===`);
                        outputChannel?.appendLine(result.stdout || '(no output)');
                    } else {
                        outputChannel?.appendLine(`=== Block failed ===`);
                        outputChannel?.appendLine(result.stderr || result.error?.message || 'Unknown error');
                    }
                }
            );

            vscode.window.showInformationMessage(`Block queued (ID: ${id.substring(0, 8)})`);
        })
    );

    // Pause queue
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.pauseQueue', () => {
            executionQueue.pause();
            vscode.window.showInformationMessage('Babel queue paused');
        })
    );

    // Resume queue
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.resumeQueue', () => {
            executionQueue.resume();
            vscode.window.showInformationMessage('Babel queue resumed');
        })
    );

    // Show babel output
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.babel.showOutput', () => {
            outputChannel?.show();
        })
    );
}
