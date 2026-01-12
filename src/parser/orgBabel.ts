/**
 * Org-mode Babel code execution integration
 * Provides source block execution, session management, and result handling
 */

import type { SrcBlockElement, AffiliatedKeywords } from './orgElementTypes';

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Result of executing a source block
 */
export interface ExecutionResult {
    /** Whether execution was successful */
    success: boolean;
    /** Standard output */
    stdout?: string;
    /** Standard error */
    stderr?: string;
    /** Return value (for languages that support it) */
    returnValue?: unknown;
    /** Execution time in milliseconds */
    executionTime?: number;
    /** Error if execution failed */
    error?: Error;
    /** Result type (for formatting) */
    resultType?: 'output' | 'value' | 'table' | 'file' | 'html' | 'latex';
    /** File outputs (for :file header) */
    files?: string[];
}

/**
 * Execution context for a source block
 */
export interface ExecutionContext {
    /** Current working directory */
    cwd?: string;
    /** Environment variables */
    env?: Record<string, string>;
    /** Session name (for persistent sessions) */
    session?: string;
    /** Input from previous block (:var) */
    variables?: Record<string, unknown>;
    /** Timeout in milliseconds */
    timeout?: number;
    /** Whether to tangle (extract) code */
    tangle?: string | boolean;
    /** Whether to include in export */
    exports?: 'code' | 'results' | 'both' | 'none';
    /** Result format */
    results?: ResultFormat;
}

/**
 * Result format specification
 */
export interface ResultFormat {
    /** Collection type: value or output */
    collection?: 'value' | 'output';
    /** Type: table, list, verbatim, etc. */
    type?: 'table' | 'list' | 'verbatim' | 'scalar' | 'file' | 'html' | 'latex' | 'org' | 'pp' | 'drawer';
    /** Format: raw, code, etc. */
    format?: 'raw' | 'code' | 'org' | 'drawer';
    /** Handling: replace, append, prepend, silent */
    handling?: 'replace' | 'append' | 'prepend' | 'silent';
}

/**
 * Language executor interface
 */
export interface LanguageExecutor {
    /** Language name(s) this executor handles */
    languages: string[];
    /** Execute code and return result */
    execute(code: string, context: ExecutionContext): Promise<ExecutionResult>;
    /** Initialize a session */
    initSession?(sessionName: string, context: ExecutionContext): Promise<void>;
    /** Close a session */
    closeSession?(sessionName: string): Promise<void>;
    /** Check if executor is available */
    isAvailable(): Promise<boolean>;
}

/**
 * Parsed header arguments
 */
export interface HeaderArguments {
    /** Variable assignments (:var) */
    var?: Record<string, string>;
    /** Result format (:results) */
    results?: string;
    /** Session name (:session) */
    session?: string;
    /** Export behavior (:exports) */
    exports?: 'code' | 'results' | 'both' | 'none';
    /** Tangling (:tangle) */
    tangle?: string;
    /** No-web style tangling (:noweb) */
    noweb?: 'yes' | 'no' | 'tangle' | 'strip-export';
    /** Cache results (:cache) */
    cache?: 'yes' | 'no';
    /** Run asynchronously (:async) */
    async?: boolean;
    /** Working directory (:dir) */
    dir?: string;
    /** File for results (:file) */
    file?: string;
    /** File extension (:file-ext) */
    fileExt?: string;
    /** Output file description (:file-desc) */
    fileDesc?: string;
    /** Evaluate on export (:eval) */
    eval?: 'yes' | 'no' | 'query' | 'never-export' | 'no-export' | 'query-export';
    /** Wrap results (:wrap) */
    wrap?: string;
    /** Post-processing (:post) */
    post?: string;
    /** Prologue code (:prologue) */
    prologue?: string;
    /** Epilogue code (:epilogue) */
    epilogue?: string;
    /** Column names for tables (:colnames) */
    colnames?: 'yes' | 'no' | 'nil';
    /** Row names for tables (:rownames) */
    rownames?: 'yes' | 'no' | 'nil';
    /** Separator for results (:sep) */
    sep?: string;
    /** Header for results (:hlines) */
    hlines?: 'yes' | 'no';
    /** Command line arguments (:cmdline) */
    cmdline?: string;
    /** Additional custom arguments */
    [key: string]: unknown;
}

// =============================================================================
// Header Argument Parser
// =============================================================================

/**
 * Parse header arguments string into structured object
 */
export function parseHeaderArguments(headerStr: string): HeaderArguments {
    const args: HeaderArguments = {};
    if (!headerStr.trim()) return args;

    // Match :key value pairs
    const pattern = /:(\S+)\s+([^:]+?)(?=\s+:|$)/g;
    let match;

    while ((match = pattern.exec(headerStr)) !== null) {
        const key = match[1].toLowerCase();
        const value = match[2].trim();

        switch (key) {
            case 'var':
                // Parse variable assignments: name=value
                if (!args.var) args.var = {};
                const varMatch = value.match(/^(\S+)=(.+)$/);
                if (varMatch) {
                    args.var[varMatch[1]] = varMatch[2];
                }
                break;

            case 'results':
                args.results = value;
                break;

            case 'session':
                args.session = value === 'none' ? undefined : value;
                break;

            case 'exports':
                if (['code', 'results', 'both', 'none'].includes(value)) {
                    args.exports = value as HeaderArguments['exports'];
                }
                break;

            case 'tangle':
                args.tangle = value;
                break;

            case 'noweb':
                if (['yes', 'no', 'tangle', 'strip-export'].includes(value)) {
                    args.noweb = value as HeaderArguments['noweb'];
                }
                break;

            case 'cache':
                args.cache = value === 'yes' ? 'yes' : 'no';
                break;

            case 'async':
                args.async = value === 'yes' || value === 't';
                break;

            case 'dir':
                args.dir = value;
                break;

            case 'file':
                args.file = value;
                break;

            case 'file-ext':
                args.fileExt = value;
                break;

            case 'file-desc':
                args.fileDesc = value;
                break;

            case 'eval':
                if (['yes', 'no', 'query', 'never-export', 'no-export', 'query-export'].includes(value)) {
                    args.eval = value as HeaderArguments['eval'];
                }
                break;

            case 'wrap':
                args.wrap = value;
                break;

            case 'post':
                args.post = value;
                break;

            case 'prologue':
                args.prologue = value;
                break;

            case 'epilogue':
                args.epilogue = value;
                break;

            case 'colnames':
                args.colnames = value as HeaderArguments['colnames'];
                break;

            case 'rownames':
                args.rownames = value as HeaderArguments['rownames'];
                break;

            case 'sep':
                args.sep = value;
                break;

            case 'hlines':
                args.hlines = value === 'yes' ? 'yes' : 'no';
                break;

            case 'cmdline':
                args.cmdline = value;
                break;

            default:
                // Store unknown arguments as-is
                args[key] = value;
        }
    }

    return args;
}

/**
 * Parse results header argument
 */
export function parseResultsFormat(resultsStr: string): ResultFormat {
    const format: ResultFormat = {};
    const parts = resultsStr.toLowerCase().split(/\s+/);

    for (const part of parts) {
        // Collection
        if (part === 'value' || part === 'output') {
            format.collection = part;
        }
        // Type
        else if (['table', 'list', 'verbatim', 'scalar', 'file', 'html', 'latex', 'org', 'pp', 'drawer'].includes(part)) {
            format.type = part as ResultFormat['type'];
        }
        // Format
        else if (['raw', 'code', 'org', 'drawer'].includes(part)) {
            format.format = part as ResultFormat['format'];
        }
        // Handling
        else if (['replace', 'append', 'prepend', 'silent'].includes(part)) {
            format.handling = part as ResultFormat['handling'];
        }
    }

    return format;
}

/**
 * Serialize header arguments back to string
 */
export function serializeHeaderArguments(args: HeaderArguments): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;

        if (key === 'var' && typeof value === 'object') {
            for (const [varName, varValue] of Object.entries(value)) {
                parts.push(`:var ${varName}=${varValue}`);
            }
        } else if (typeof value === 'boolean') {
            parts.push(`:${key} ${value ? 'yes' : 'no'}`);
        } else {
            parts.push(`:${key} ${value}`);
        }
    }

    return parts.join(' ');
}

// =============================================================================
// Executor Registry
// =============================================================================

/**
 * Registry for language executors
 */
class ExecutorRegistry {
    private executors: Map<string, LanguageExecutor> = new Map();
    private sessions: Map<string, { executor: LanguageExecutor; language: string }> = new Map();

    /**
     * Register a language executor
     */
    register(executor: LanguageExecutor): void {
        for (const lang of executor.languages) {
            this.executors.set(lang.toLowerCase(), executor);
        }
    }

    /**
     * Get executor for a language
     */
    getExecutor(language: string): LanguageExecutor | undefined {
        return this.executors.get(language.toLowerCase());
    }

    /**
     * Get all supported languages
     */
    getLanguages(): string[] {
        return Array.from(new Set(
            Array.from(this.executors.values()).flatMap(e => e.languages)
        ));
    }

    /**
     * Check if a language is supported
     */
    isSupported(language: string): boolean {
        return this.executors.has(language.toLowerCase());
    }

    /**
     * Create or get a session
     */
    async getSession(
        sessionName: string,
        language: string,
        context: ExecutionContext
    ): Promise<void> {
        if (this.sessions.has(sessionName)) {
            return;
        }

        const executor = this.getExecutor(language);
        if (!executor) {
            throw new Error(`No executor for language: ${language}`);
        }

        if (executor.initSession) {
            await executor.initSession(sessionName, context);
        }

        this.sessions.set(sessionName, { executor, language });
    }

    /**
     * Close a session
     */
    async closeSession(sessionName: string): Promise<void> {
        const session = this.sessions.get(sessionName);
        if (!session) return;

        if (session.executor.closeSession) {
            await session.executor.closeSession(sessionName);
        }

        this.sessions.delete(sessionName);
    }

    /**
     * Close all sessions
     */
    async closeAllSessions(): Promise<void> {
        for (const sessionName of this.sessions.keys()) {
            await this.closeSession(sessionName);
        }
    }
}

// Global executor registry
export const executorRegistry = new ExecutorRegistry();

// =============================================================================
// Built-in Executors
// =============================================================================

/**
 * Shell executor (sh, bash)
 */
export const shellExecutor: LanguageExecutor = {
    languages: ['sh', 'bash', 'shell'],

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            const startTime = Date.now();
            const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
            const args = process.platform === 'win32' ? ['/c', code] : ['-c', code];

            const proc = spawn(shell, args, {
                cwd: context.cwd,
                env: { ...process.env, ...context.env },
                timeout: context.timeout,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                resolve({
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    executionTime: Date.now() - startTime,
                    resultType: 'output',
                });
            });

            proc.on('error', (error) => {
                resolve({
                    success: false,
                    error,
                    executionTime: Date.now() - startTime,
                });
            });
        });
    },

    async isAvailable(): Promise<boolean> {
        return true; // Shell is always available
    },
};

/**
 * Python executor
 */
export const pythonExecutor: LanguageExecutor = {
    languages: ['python', 'python3', 'py'],

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            const startTime = Date.now();

            // Wrap code to capture return value if needed
            const wrappedCode = context.variables
                ? Object.entries(context.variables)
                    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                    .join('\n') + '\n' + code
                : code;

            const proc = spawn('python3', ['-c', wrappedCode], {
                cwd: context.cwd,
                env: { ...process.env, ...context.env },
                timeout: context.timeout,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (exitCode) => {
                resolve({
                    success: exitCode === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    executionTime: Date.now() - startTime,
                    resultType: 'output',
                });
            });

            proc.on('error', (error) => {
                resolve({
                    success: false,
                    error,
                    executionTime: Date.now() - startTime,
                });
            });
        });
    },

    async isAvailable(): Promise<boolean> {
        const { spawn } = await import('child_process');
        return new Promise((resolve) => {
            const proc = spawn('python3', ['--version']);
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    },
};

/**
 * JavaScript/Node.js executor
 */
export const nodeExecutor: LanguageExecutor = {
    languages: ['js', 'javascript', 'node', 'nodejs'],

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            const startTime = Date.now();

            // Inject variables
            const varCode = context.variables
                ? Object.entries(context.variables)
                    .map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`)
                    .join('\n') + '\n'
                : '';

            const fullCode = varCode + code;

            const proc = spawn('node', ['-e', fullCode], {
                cwd: context.cwd,
                env: { ...process.env, ...context.env },
                timeout: context.timeout,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (exitCode) => {
                resolve({
                    success: exitCode === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    executionTime: Date.now() - startTime,
                    resultType: 'output',
                });
            });

            proc.on('error', (error) => {
                resolve({
                    success: false,
                    error,
                    executionTime: Date.now() - startTime,
                });
            });
        });
    },

    async isAvailable(): Promise<boolean> {
        const { spawn } = await import('child_process');
        return new Promise((resolve) => {
            const proc = spawn('node', ['--version']);
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    },
};

// Register built-in executors
executorRegistry.register(shellExecutor);
executorRegistry.register(pythonExecutor);
executorRegistry.register(nodeExecutor);

// =============================================================================
// Babel Execution Functions
// =============================================================================

/**
 * Execute a source block
 */
export async function executeSourceBlock(
    block: SrcBlockElement,
    context: Partial<ExecutionContext> = {}
): Promise<ExecutionResult> {
    const language = block.properties.language;
    const code = block.properties.value;

    // Parse header arguments
    const headers = parseHeaderArguments(block.properties.parameters || '');

    // Merge context with header arguments
    // Include the language so executors (like Jupyter) can access it
    const fullContext: ExecutionContext & { language?: string } = {
        ...context,
        language,
        session: headers.session || context.session,
        cwd: headers.dir || context.cwd,
        variables: headers.var ? { ...context.variables, ...parseVariables(headers.var) } : context.variables,
        results: headers.results ? parseResultsFormat(headers.results) : context.results,
        exports: headers.exports || context.exports,
    };

    // Check if we should evaluate
    if (headers.eval === 'no' || headers.eval === 'never-export') {
        return {
            success: true,
            stdout: '',
            resultType: 'output',
        };
    }

    // Get executor
    const executor = executorRegistry.getExecutor(language);
    if (!executor) {
        return {
            success: false,
            error: new Error(`No executor available for language: ${language}`),
        };
    }

    // Check availability
    if (!await executor.isAvailable()) {
        return {
            success: false,
            error: new Error(`Executor for ${language} is not available`),
        };
    }

    // Handle session
    if (fullContext.session) {
        await executorRegistry.getSession(fullContext.session, language, fullContext);
    }

    // Prepend prologue
    let finalCode = code;
    if (headers.prologue) {
        finalCode = headers.prologue + '\n' + finalCode;
    }

    // Append epilogue
    if (headers.epilogue) {
        finalCode = finalCode + '\n' + headers.epilogue;
    }

    // Execute
    const result = await executor.execute(finalCode, fullContext);

    return result;
}

/**
 * Parse variable assignments
 */
function parseVariables(vars: Record<string, string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(vars)) {
        // Try to parse as JSON
        try {
            result[key] = JSON.parse(value);
        } catch {
            // Keep as string
            result[key] = value;
        }
    }

    return result;
}

/**
 * Format execution result for insertion
 */
export function formatResult(
    result: ExecutionResult,
    format: ResultFormat = {}
): string {
    if (!result.success && result.error) {
        return `#+RESULTS:\n: Error: ${result.error.message}`;
    }

    const output = result.stdout || '';
    const files = result.files || [];

    // If no output and no files, return empty results
    if (!output && files.length === 0) {
        return '#+RESULTS:';
    }

    // Determine format
    const type = format.type || result.resultType || 'verbatim';

    let resultText = '';

    // Format text output
    if (output) {
        switch (type) {
            case 'table':
                resultText = formatAsTable(output);
                break;
            case 'list':
                resultText = formatAsList(output);
                break;
            case 'html':
                resultText = `#+RESULTS:\n#+BEGIN_EXPORT html\n${output}\n#+END_EXPORT`;
                break;
            case 'latex':
                resultText = `#+RESULTS:\n#+BEGIN_EXPORT latex\n${output}\n#+END_EXPORT`;
                break;
            case 'org':
                resultText = `#+RESULTS:\n${output}`;
                break;
            case 'drawer':
                resultText = `#+RESULTS:\n:RESULTS:\n${output}\n:END:`;
                break;
            case 'file':
                resultText = `#+RESULTS:\n[[file:${output}]]`;
                break;
            case 'verbatim':
            default:
                resultText = formatAsVerbatim(output);
                break;
        }
    } else {
        resultText = '#+RESULTS:';
    }

    // Append file links (for Jupyter image output, etc.)
    if (files.length > 0) {
        const fileLinks = files.map(f => `[[file:${f}]]`).join('\n');
        if (output) {
            resultText += '\n' + fileLinks;
        } else {
            resultText = '#+RESULTS:\n' + fileLinks;
        }
    }

    return resultText;
}

function formatAsVerbatim(output: string): string {
    const lines = output.split('\n').map(line => `: ${line}`);
    return '#+RESULTS:\n' + lines.join('\n');
}

function formatAsTable(output: string): string {
    // Try to parse as CSV-like data
    const lines = output.trim().split('\n');
    const rows = lines.map(line =>
        '| ' + line.split(/[,\t]/).map(cell => cell.trim()).join(' | ') + ' |'
    );

    return '#+RESULTS:\n' + rows.join('\n');
}

function formatAsList(output: string): string {
    const lines = output.trim().split('\n');
    const items = lines.map(line => `- ${line}`);
    return '#+RESULTS:\n' + items.join('\n');
}

/**
 * Extract tangled code from source blocks
 */
export function tangleSourceBlocks(
    blocks: SrcBlockElement[],
    targetFile?: string
): Map<string, string> {
    const files = new Map<string, string[]>();

    for (const block of blocks) {
        const headers = parseHeaderArguments(block.properties.parameters || '');
        const tangleTo = headers.tangle;

        if (!tangleTo || tangleTo === 'no') continue;

        const file = tangleTo === 'yes'
            ? targetFile || 'output'
            : tangleTo as string;

        if (!files.has(file)) {
            files.set(file, []);
        }

        files.get(file)!.push(block.properties.value);
    }

    // Join code for each file
    const result = new Map<string, string>();
    for (const [file, codeBlocks] of files) {
        result.set(file, codeBlocks.join('\n\n'));
    }

    return result;
}

// =============================================================================
// Exports
// =============================================================================

export {
    ExecutorRegistry,
};
