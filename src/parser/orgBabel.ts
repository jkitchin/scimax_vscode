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
    /** Wrap results in a block (:wrap QUOTE wraps in #+BEGIN_QUOTE...#+END_QUOTE) */
    wrap?: string;
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
    /** Shebang line (:shebang) */
    shebang?: string;
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

    // First, handle flag-style arguments (e.g., :session without value means default session)
    // Check for :session alone (not followed by a value before next : or end)
    if (/:session(?:\s*$|\s+:)/i.test(headerStr)) {
        args.session = 'default';
    }

    // Match :key value pairs
    const pattern = /:(\S+)\s+([^:]+?)(?=\s+:|$)/g;
    let match;

    // Helper to strip surrounding quotes from a value
    const stripQuotes = (val: string): string => {
        const trimmed = val.trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    };

    while ((match = pattern.exec(headerStr)) !== null) {
        const key = match[1].toLowerCase();
        const value = stripQuotes(match[2].trim());

        switch (key) {
            case 'var':
                // Parse variable assignments: name=value (may have multiple space-separated)
                if (!args.var) args.var = {};
                // Match all name=value pairs (value can be quoted or unquoted)
                const varPattern = /(\S+?)=(?:"([^"]+)"|'([^']+)'|(\S+))/g;
                let varMatch;
                while ((varMatch = varPattern.exec(value)) !== null) {
                    const varName = varMatch[1];
                    // Use quoted value if present, otherwise unquoted
                    const varValue = varMatch[2] ?? varMatch[3] ?? varMatch[4];
                    args.var[varName] = varValue;
                }
                break;

            case 'results':
                // Concatenate multiple :results values (e.g., :results table :results value)
                args.results = args.results ? `${args.results} ${value}` : value;
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
        const { spawn, execSync } = await import('child_process');
        const fs = await import('fs');

        return new Promise((resolve) => {
            const startTime = Date.now();

            let shell: string;
            let args: string[];

            if (process.platform === 'win32') {
                shell = 'cmd.exe';
                args = ['/c', code];
            } else {
                // Find available shell - prefer bash, fall back to sh
                const bashPaths = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'];
                const foundBash = bashPaths.find(p => fs.existsSync(p));

                if (foundBash) {
                    shell = foundBash;
                } else {
                    // Fall back to /bin/sh (POSIX shell, always available)
                    shell = '/bin/sh';
                }
                args = ['-c', code];
            }

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

            proc.on('close', (exitCode) => {
                resolve({
                    success: exitCode === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    executionTime: Date.now() - startTime,
                    resultType: 'output',
                });
            });

            proc.on('error', (error: NodeJS.ErrnoException) => {
                // Provide more helpful error message for common issues
                let enhancedError = error;
                if (error.code === 'ENOENT') {
                    // Check if it's the shell or the cwd that doesn't exist
                    if (!fs.existsSync(shell)) {
                        enhancedError = new Error(
                            `Shell not found: ${shell}. ` +
                            `Searched: ${['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/bin/sh'].join(', ')}`
                        ) as NodeJS.ErrnoException;
                    } else if (context.cwd && !fs.existsSync(context.cwd)) {
                        enhancedError = new Error(
                            `Working directory not found: ${context.cwd}`
                        ) as NodeJS.ErrnoException;
                    } else {
                        enhancedError = new Error(
                            `ENOENT error spawning ${shell} in ${context.cwd || 'default cwd'}. ` +
                            `Shell exists: ${fs.existsSync(shell)}, CWD exists: ${context.cwd ? fs.existsSync(context.cwd) : 'no cwd'}`
                        ) as NodeJS.ErrnoException;
                    }
                    enhancedError.code = 'ENOENT';
                }
                resolve({
                    success: false,
                    error: enhancedError,
                    executionTime: Date.now() - startTime,
                });
            });
        });
    },

    async isAvailable(): Promise<boolean> {
        return true; // Shell is always available
    },
};

// =============================================================================
// Python Session Manager
// =============================================================================

interface PythonSession {
    process: ReturnType<typeof import('child_process').spawn>;
    pending: Array<{
        resolve: (result: ExecutionResult) => void;
        startTime: number;
    }>;
    cwd?: string;
}

const pythonSessions = new Map<string, PythonSession>();

// Unique markers for output delimiting
const OUTPUT_START_MARKER = '___ORG_BABEL_OUTPUT_START___';
const OUTPUT_END_MARKER = '___ORG_BABEL_OUTPUT_END___';
const ERROR_MARKER = '___ORG_BABEL_ERROR___';

/**
 * Get or create a Python session
 */
async function getPythonSession(sessionName: string, cwd?: string): Promise<PythonSession> {
    let session = pythonSessions.get(sessionName);

    if (session && session.process.exitCode === null) {
        return session;
    }

    // Create new session with persistent Python process
    const { spawn } = await import('child_process');

    // Python wrapper script that reads code blocks and executes them
    const wrapperCode = `
import sys
import traceback

OUTPUT_START = "${OUTPUT_START_MARKER}"
OUTPUT_END = "${OUTPUT_END_MARKER}"
ERROR_MARKER = "${ERROR_MARKER}"

# Shared namespace for the session
__session_globals__ = {}
__session_globals__['__name__'] = '__main__'

while True:
    try:
        # Read number of lines
        line_count_str = sys.stdin.readline()
        if not line_count_str:
            break
        line_count = int(line_count_str.strip())

        # Read the code
        code_lines = []
        for _ in range(line_count):
            code_lines.append(sys.stdin.readline().rstrip('\\n'))
        code = '\\n'.join(code_lines)

        # Execute and capture output
        print(OUTPUT_START, flush=True)
        try:
            exec(compile(code, '<org-babel>', 'exec'), __session_globals__)
        except Exception as e:
            print(f"{ERROR_MARKER}{traceback.format_exc()}", flush=True)
        print(OUTPUT_END, flush=True)
        sys.stdout.flush()
        sys.stderr.flush()

    except Exception as e:
        print(OUTPUT_START, flush=True)
        print(f"{ERROR_MARKER}{traceback.format_exc()}", flush=True)
        print(OUTPUT_END, flush=True)
        sys.stdout.flush()
`;

    const proc = spawn('python3', ['-u', '-c', wrapperCode], {
        cwd,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    session = {
        process: proc,
        pending: [],
        cwd,
    };

    let outputBuffer = '';

    proc.stdout?.on('data', (data) => {
        outputBuffer += data.toString();

        // Check for complete output blocks
        while (true) {
            const startIdx = outputBuffer.indexOf(OUTPUT_START_MARKER);
            const endIdx = outputBuffer.indexOf(OUTPUT_END_MARKER);

            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                // Extract output between markers
                const output = outputBuffer
                    .substring(startIdx + OUTPUT_START_MARKER.length, endIdx)
                    .trim();

                // Remove processed output from buffer
                outputBuffer = outputBuffer.substring(endIdx + OUTPUT_END_MARKER.length);

                // Resolve pending request
                const pending = session!.pending.shift();
                if (pending) {
                    const hasError = output.includes(ERROR_MARKER);
                    const cleanOutput = output.replace(ERROR_MARKER, '').trim();

                    pending.resolve({
                        success: !hasError,
                        stdout: hasError ? '' : cleanOutput,
                        stderr: hasError ? cleanOutput : '',
                        executionTime: Date.now() - pending.startTime,
                        resultType: 'output',
                    });
                }
            } else {
                break;
            }
        }
    });

    proc.stderr?.on('data', (data) => {
        // Stderr is captured but we handle errors through stdout markers
        console.error(`[Python Session ${sessionName}] stderr:`, data.toString());
    });

    proc.on('close', () => {
        // Reject any pending requests
        for (const pending of session!.pending) {
            pending.resolve({
                success: false,
                error: new Error('Python session closed unexpectedly'),
                executionTime: Date.now() - pending.startTime,
            });
        }
        pythonSessions.delete(sessionName);
    });

    pythonSessions.set(sessionName, session);
    return session;
}

/**
 * Execute code in a Python session
 */
async function executeInPythonSession(
    sessionName: string,
    code: string,
    context: ExecutionContext
): Promise<ExecutionResult> {
    const session = await getPythonSession(sessionName, context.cwd);
    const startTime = Date.now();

    return new Promise((resolve) => {
        // Add variable definitions if present
        let fullCode = context.variables
            ? Object.entries(context.variables)
                .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                .join('\n') + '\n' + code
            : code;

        // Check if code contains a 'return' statement (org-babel convention)
        // If so, wrap in a function and call it
        const hasReturnStatement = /^\s*return\s/m.test(fullCode);
        if (hasReturnStatement) {
            // Indent the code and wrap in a function
            const indentedCode = fullCode.split('\n').map(line => '    ' + line).join('\n');
            fullCode = `def __org_babel_fn__():\n${indentedCode}\n__org_babel_result__ = __org_babel_fn__()\nif __org_babel_result__ is not None:\n    print(__org_babel_result__)`;
        }

        // Queue the request
        session.pending.push({ resolve, startTime });

        // Send code to the session
        const lines = fullCode.split('\n');
        session.process.stdin?.write(`${lines.length}\n`);
        for (const line of lines) {
            session.process.stdin?.write(line + '\n');
        }
    });
}

/**
 * Close a Python session
 */
async function closePythonSession(sessionName: string): Promise<void> {
    const session = pythonSessions.get(sessionName);
    if (session) {
        session.process.stdin?.end();
        session.process.kill();
        pythonSessions.delete(sessionName);
    }
}

/**
 * Python executor
 */
export const pythonExecutor: LanguageExecutor = {
    languages: ['python', 'python3', 'py'],

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        // Use session if specified
        if (context.session) {
            return executeInPythonSession(context.session, code, context);
        }

        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            const startTime = Date.now();

            // Add variable definitions
            let wrappedCode = context.variables
                ? Object.entries(context.variables)
                    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                    .join('\n') + '\n' + code
                : code;

            // Check if code contains a 'return' statement (org-babel convention)
            const hasReturnStatement = /^\s*return\s/m.test(code);

            // Handle :results value OR code with return statements
            if (context.results?.collection === 'value' || hasReturnStatement) {
                // Determine output format based on :results type
                const isTableFormat = context.results?.type === 'table';
                // Convert JS boolean to Python boolean
                const pyTableFormat = isTableFormat ? 'True' : 'False';

                // Wrap code to capture the value of the last expression
                // We use exec() for statements and eval() for the final expression
                // Also handle org-babel 'return' convention
                wrappedCode = `
import sys
__org_babel_code__ = ${JSON.stringify(wrappedCode)}
# Split by newlines first, then expand semicolon-separated statements
__org_babel_lines__ = []
for __line__ in __org_babel_code__.strip().split('\\n'):
    # Split by semicolons but preserve strings (simple approach)
    if ';' in __line__ and not ('"""' in __line__ or "'''" in __line__):
        __org_babel_lines__.extend([s.strip() for s in __line__.split(';') if s.strip()])
    else:
        __org_babel_lines__.append(__line__)
__org_babel_table_format__ = ${pyTableFormat}

def __org_babel_format_value__(val):
    """Format value for output, handling table format specially."""
    if __org_babel_table_format__:
        # For table format, output as tab-separated values
        if hasattr(val, '__iter__') and not isinstance(val, (str, bytes, dict)):
            lines = []
            for row in val:
                if hasattr(row, '__iter__') and not isinstance(row, (str, bytes, dict)):
                    lines.append('\\t'.join(str(cell) for cell in row))
                else:
                    lines.append(str(row))
            return '\\n'.join(lines)
    return repr(val)

# Find the last non-empty, non-comment line
__org_babel_last_idx__ = len(__org_babel_lines__) - 1
while __org_babel_last_idx__ >= 0:
    __org_babel_line__ = __org_babel_lines__[__org_babel_last_idx__].strip()
    if __org_babel_line__ and not __org_babel_line__.startswith('#'):
        break
    __org_babel_last_idx__ -= 1

if __org_babel_last_idx__ >= 0:
    # Execute all lines except the last
    __org_babel_setup__ = '\\n'.join(__org_babel_lines__[:__org_babel_last_idx__])
    if __org_babel_setup__.strip():
        exec(__org_babel_setup__)
    # Handle the last line
    __org_babel_last__ = __org_babel_lines__[__org_babel_last_idx__].strip()
    # Handle 'return' statements (org-babel convention - not Python syntax)
    if __org_babel_last__.startswith('return '):
        __org_babel_last__ = __org_babel_last__[7:]  # Strip 'return '
    elif __org_babel_last__ == 'return':
        __org_babel_last__ = 'None'
    # Try to eval the expression, fall back to exec (statement)
    try:
        __org_babel_result__ = eval(__org_babel_last__)
        if __org_babel_result__ is not None:
            print(__org_babel_format_value__(__org_babel_result__))
    except SyntaxError:
        exec(__org_babel_last__)
`;
            }

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

            proc.on('error', (error: NodeJS.ErrnoException) => {
                // Provide more helpful error message for common issues
                const fs = require('fs');
                let enhancedError = error;
                if (error.code === 'ENOENT') {
                    if (context.cwd && !fs.existsSync(context.cwd)) {
                        enhancedError = new Error(
                            `Working directory not found: ${context.cwd}`
                        ) as NodeJS.ErrnoException;
                    } else {
                        enhancedError = new Error(
                            `python3 not found or ENOENT error. CWD: ${context.cwd || 'default'}, ` +
                            `CWD exists: ${context.cwd ? fs.existsSync(context.cwd) : 'no cwd'}`
                        ) as NodeJS.ErrnoException;
                    }
                    enhancedError.code = 'ENOENT';
                }
                resolve({
                    success: false,
                    error: enhancedError,
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

    async initSession(sessionName: string, context: ExecutionContext): Promise<void> {
        await getPythonSession(sessionName, context.cwd);
    },

    async closeSession(sessionName: string): Promise<void> {
        await closePythonSession(sessionName);
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

/**
 * Julia executor
 */
export const juliaExecutor: LanguageExecutor = {
    languages: ['julia', 'jl'],

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            const startTime = Date.now();

            // Inject variables
            let wrappedCode = context.variables
                ? Object.entries(context.variables)
                    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                    .join('\n') + '\n' + code
                : code;

            // Handle :results value - capture the value of the last expression
            if (context.results?.collection === 'value') {
                wrappedCode = `
__org_babel_code__ = ${JSON.stringify(wrappedCode)}
__org_babel_lines__ = split(__org_babel_code__, '\\n')

# Find the last non-empty, non-comment line
__org_babel_last_idx__ = length(__org_babel_lines__)
while __org_babel_last_idx__ >= 1
    __org_babel_line__ = strip(__org_babel_lines__[__org_babel_last_idx__])
    if !isempty(__org_babel_line__) && !startswith(__org_babel_line__, "#")
        break
    end
    global __org_babel_last_idx__ -= 1
end

if __org_babel_last_idx__ >= 1
    # Execute all lines except the last
    __org_babel_setup__ = join(__org_babel_lines__[1:__org_babel_last_idx__-1], '\\n')
    if !isempty(strip(__org_babel_setup__))
        include_string(Main, __org_babel_setup__)
    end
    # Evaluate and print the last line
    __org_babel_result__ = include_string(Main, __org_babel_lines__[__org_babel_last_idx__])
    if __org_babel_result__ !== nothing
        println(__org_babel_result__)
    end
end
`;
            }

            const proc = spawn('julia', ['-e', wrappedCode], {
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
            const proc = spawn('julia', ['--version']);
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    },
};

/**
 * R executor
 */
export const rExecutor: LanguageExecutor = {
    languages: ['r', 'R'],

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            const startTime = Date.now();

            // Inject variables
            let wrappedCode = context.variables
                ? Object.entries(context.variables)
                    .map(([k, v]) => `${k} <- ${JSON.stringify(v)}`)
                    .join('\n') + '\n' + code
                : code;

            // Handle :results value - capture the value of the last expression
            if (context.results?.collection === 'value') {
                // Wrap code to evaluate and print the last expression
                wrappedCode = `
.org_babel_code <- ${JSON.stringify(wrappedCode)}
.org_babel_lines <- strsplit(.org_babel_code, "\\n")[[1]]

# Find the last non-empty, non-comment line
.org_babel_last_idx <- length(.org_babel_lines)
while (.org_babel_last_idx >= 1) {
    .org_babel_line <- trimws(.org_babel_lines[.org_babel_last_idx])
    if (nchar(.org_babel_line) > 0 && !startsWith(.org_babel_line, "#")) {
        break
    }
    .org_babel_last_idx <- .org_babel_last_idx - 1
}

if (.org_babel_last_idx >= 1) {
    # Execute all lines except the last
    if (.org_babel_last_idx > 1) {
        .org_babel_setup <- paste(.org_babel_lines[1:(.org_babel_last_idx-1)], collapse = "\\n")
        if (nchar(trimws(.org_babel_setup)) > 0) {
            eval(parse(text = .org_babel_setup))
        }
    }
    # Evaluate and print the last line
    .org_babel_result <- eval(parse(text = .org_babel_lines[.org_babel_last_idx]))
    if (!is.null(.org_babel_result)) {
        print(.org_babel_result)
    }
}
`;
            }

            // Use Rscript for non-interactive execution
            const proc = spawn('Rscript', ['-e', wrappedCode], {
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
            const proc = spawn('Rscript', ['--version']);
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    },
};

/**
 * TypeScript executor using tsx, ts-node, or bun
 */
export const typescriptExecutor: LanguageExecutor = {
    languages: ['ts', 'typescript'],

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        const { spawn } = await import('child_process');
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const crypto = await import('crypto');

        const startTime = Date.now();

        // Inject variables
        const varCode = context.variables
            ? Object.entries(context.variables)
                .map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`)
                .join('\n') + '\n'
            : '';

        const fullCode = varCode + code;

        // Write code to a temp file (tsx/ts-node need a file)
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `babel-${crypto.randomBytes(16).toString('hex')}.ts`);

        try {
            fs.writeFileSync(tmpFile, fullCode, 'utf-8');

            // Try different TypeScript runners in order of preference
            const runners = [
                { cmd: 'tsx', args: [tmpFile] },
                { cmd: 'npx', args: ['tsx', tmpFile] },
                { cmd: 'ts-node', args: [tmpFile] },
                { cmd: 'bun', args: ['run', tmpFile] },
            ];

            // Find first available runner
            const findRunner = async (): Promise<{ cmd: string; args: string[] } | null> => {
                for (const runner of runners) {
                    const available = await new Promise<boolean>((resolve) => {
                        const proc = spawn(runner.cmd, ['--version'], { stdio: 'ignore' });
                        proc.on('close', (code) => resolve(code === 0));
                        proc.on('error', () => resolve(false));
                    });
                    if (available) return runner;
                }
                return null;
            };

            const runner = await findRunner();
            if (!runner) {
                return {
                    success: false,
                    error: new Error('No TypeScript runner found. Install tsx, ts-node, or bun.'),
                    executionTime: Date.now() - startTime,
                };
            }

            return new Promise((resolve) => {
                const proc = spawn(runner.cmd, runner.args, {
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
                    // Clean up temp file
                    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

                    resolve({
                        success: exitCode === 0,
                        stdout: stdout.trim(),
                        stderr: stderr.trim(),
                        executionTime: Date.now() - startTime,
                        resultType: 'output',
                    });
                });

                proc.on('error', (error) => {
                    // Clean up temp file
                    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

                    resolve({
                        success: false,
                        error,
                        executionTime: Date.now() - startTime,
                    });
                });
            });
        } catch (error) {
            // Clean up temp file on error
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                executionTime: Date.now() - startTime,
            };
        }
    },

    async isAvailable(): Promise<boolean> {
        const { spawn } = await import('child_process');

        // Check for any TypeScript runner (including npx which can run tsx)
        const runners = ['tsx', 'ts-node', 'bun', 'npx'];

        for (const runner of runners) {
            const available = await new Promise<boolean>((resolve) => {
                const proc = spawn(runner, ['--version'], { stdio: 'ignore' });
                proc.on('close', (code) => resolve(code === 0));
                proc.on('error', () => resolve(false));
            });
            if (available) return true;
        }

        return false;
    },
};

// Register built-in executors
executorRegistry.register(shellExecutor);
executorRegistry.register(pythonExecutor);
executorRegistry.register(nodeExecutor);
executorRegistry.register(typescriptExecutor);
executorRegistry.register(juliaExecutor);
executorRegistry.register(rExecutor);

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
    // Note: :dir is handled by the caller (babelProvider) which resolves it to an absolute path
    // and passes it as context.cwd, so we don't override cwd with headers.dir here
    const fullContext: ExecutionContext & { language?: string } = {
        ...context,
        language,
        session: headers.session || context.session,
        // cwd comes from context (already resolved by caller)
        // variables are already resolved by the caller (babelProvider.resolveVariables)
        variables: context.variables,
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
 * Compute SHA1 hash of code for caching
 */
export function computeCodeHash(code: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha1').update(code).digest('hex');
}

/**
 * Format execution result for insertion
 * @param result - The execution result
 * @param format - Result format options
 * @param name - Optional name for the results (from #+NAME: on the source block)
 * @param codeHash - Optional hash for :cache yes results
 */
export function formatResult(
    result: ExecutionResult,
    format: ResultFormat = {},
    name?: string,
    codeHash?: string
): string {
    // Build the results header
    // With cache: #+RESULTS[hash]:
    // With name: #+RESULTS: name or #+RESULTS[hash]: name
    let resultsHeader: string;
    if (codeHash && name) {
        resultsHeader = `#+RESULTS[${codeHash}]: ${name}`;
    } else if (codeHash) {
        resultsHeader = `#+RESULTS[${codeHash}]:`;
    } else if (name) {
        resultsHeader = `#+RESULTS: ${name}`;
    } else {
        resultsHeader = '#+RESULTS:';
    }

    if (!result.success && result.error) {
        return `${resultsHeader}\n: Error: ${result.error.message}`;
    }

    const output = result.stdout || '';
    const files = result.files || [];

    // If no output and no files, return empty results
    if (!output && files.length === 0) {
        return resultsHeader;
    }

    // Determine format type
    // Note: When there are separate files (e.g., images), format stdout as verbatim
    // regardless of resultType, since resultType='file' just indicates files exist
    let type = format.type || result.resultType || 'verbatim';
    if (type === 'file' && files.length > 0 && output) {
        // stdout is text, not a file path - format as verbatim
        type = 'verbatim';
    }

    let resultText = '';

    // Format text output
    if (output) {
        // :wrap takes precedence - wrap output in #+BEGIN_<WRAPPER>...#+END_<WRAPPER>
        if (format.wrap) {
            const wrapperName = format.wrap.toUpperCase();
            resultText = `${resultsHeader}\n#+BEGIN_${wrapperName}\n${output}\n#+END_${wrapperName}`;
        } else {
            switch (type) {
                case 'table':
                    resultText = formatAsTable(output, resultsHeader);
                    break;
                case 'list':
                    resultText = formatAsList(output, resultsHeader);
                    break;
                case 'html':
                    resultText = `${resultsHeader}\n#+BEGIN_EXPORT html\n${output}\n#+END_EXPORT`;
                    break;
                case 'latex':
                    resultText = `${resultsHeader}\n#+BEGIN_EXPORT latex\n${output}\n#+END_EXPORT`;
                    break;
                case 'org':
                    resultText = `${resultsHeader}\n${output}`;
                    break;
                case 'drawer':
                    resultText = `${resultsHeader}\n:RESULTS:\n${output}\n:END:`;
                    break;
                case 'file':
                    // Only use file format when stdout IS the file path (no separate files array)
                    resultText = `${resultsHeader}\n[[file:${output}]]`;
                    break;
                case 'verbatim':
                default:
                    resultText = formatAsVerbatim(output, resultsHeader);
                    break;
            }
        }
    } else {
        resultText = resultsHeader;
    }

    // Append file links (for Jupyter image output, etc.)
    if (files.length > 0) {
        const fileLinks = files.map(f => `[[file:${f}]]`).join('\n');
        if (output) {
            resultText += '\n' + fileLinks;
        } else {
            resultText = `${resultsHeader}\n` + fileLinks;
        }
    }

    return resultText;
}

function formatAsVerbatim(output: string, resultsHeader: string): string {
    const lines = output.split('\n').map(line => `: ${line}`);
    return resultsHeader + '\n' + lines.join('\n');
}

function formatAsTable(output: string, resultsHeader: string): string {
    // Try to parse as CSV-like data
    const lines = output.trim().split('\n');
    const rows = lines.map(line =>
        '| ' + line.split(/[,\t]/).map(cell => cell.trim()).join(' | ') + ' |'
    );

    return resultsHeader + '\n' + rows.join('\n');
}

function formatAsList(output: string, resultsHeader: string): string {
    const lines = output.trim().split('\n');
    const items = lines.map(line => `- ${line}`);
    return resultsHeader + '\n' + items.join('\n');
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
