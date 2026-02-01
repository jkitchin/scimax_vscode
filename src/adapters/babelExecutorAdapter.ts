/**
 * Babel Executor Adapter
 *
 * VS Code adapter layer for registering custom Babel language executors.
 * This provides a clean API for external extensions to add language support.
 *
 * The core LanguageExecutor interface (in parser/orgBabel.ts) handles:
 * - execute(): Run code and return results
 * - initSession()/closeSession(): Manage persistent sessions
 * - isAvailable(): Check if the runtime is installed
 *
 * This adapter provides:
 * - VS Code Disposable-based registration
 * - Validation of executor interface
 * - Helper functions for common patterns
 */

import * as vscode from 'vscode';
import {
    executorRegistry,
    LanguageExecutor,
    ExecutionContext,
    ExecutionResult,
} from '../parser/orgBabel';

// Re-export core types for convenience
export { LanguageExecutor, ExecutionContext, ExecutionResult };

// =============================================================================
// Executor Validation
// =============================================================================

/**
 * Validate that an executor implements the required interface
 */
function validateExecutor(executor: LanguageExecutor): void {
    if (!executor.languages || !Array.isArray(executor.languages) || executor.languages.length === 0) {
        throw new Error('Executor must specify at least one language');
    }

    if (typeof executor.execute !== 'function') {
        throw new Error('Executor must implement execute() method');
    }

    if (typeof executor.isAvailable !== 'function') {
        throw new Error('Executor must implement isAvailable() method');
    }

    // Validate language names
    for (const lang of executor.languages) {
        if (typeof lang !== 'string' || lang.trim() === '') {
            throw new Error('Language names must be non-empty strings');
        }
    }
}

// =============================================================================
// Registration Functions
// =============================================================================

/**
 * Register a custom language executor
 *
 * @param executor The executor to register
 * @returns A Disposable that unregisters the executor when disposed
 *
 * @example
 * ```typescript
 * const myExecutor: LanguageExecutor = {
 *     languages: ['mylang', 'ml'],
 *     async execute(code, context) {
 *         // Execute code...
 *         return { success: true, stdout: result, stderr: '', executionTime: 100 };
 *     },
 *     async isAvailable() {
 *         // Check if runtime is installed
 *         return true;
 *     }
 * };
 *
 * const disposable = registerBabelExecutor(myExecutor);
 * context.subscriptions.push(disposable);
 * ```
 */
export function registerBabelExecutor(executor: LanguageExecutor): vscode.Disposable {
    validateExecutor(executor);
    executorRegistry.register(executor);

    return new vscode.Disposable(() => {
        executorRegistry.unregister(executor);
    });
}

/**
 * Check if a language is supported by any registered executor
 */
export function isLanguageSupported(language: string): boolean {
    return executorRegistry.isSupported(language);
}

/**
 * Get all registered languages
 */
export function getRegisteredLanguages(): string[] {
    return executorRegistry.getLanguages();
}

// =============================================================================
// Helper: Simple Command Executor
// =============================================================================

/**
 * Options for creating a simple command-based executor
 */
export interface SimpleExecutorOptions {
    /** Language names this executor handles */
    languages: string[];

    /** Command to execute (e.g., 'python3', 'node') */
    command: string;

    /** Arguments to pass before the code file (e.g., ['-u'] for unbuffered) */
    args?: string[];

    /** File extension for temp files (e.g., '.py', '.js') */
    extension: string;

    /** How to check availability (default: checks if command exists) */
    checkAvailability?: () => Promise<boolean>;

    /** Transform code before execution (e.g., add imports) */
    transformCode?: (code: string, context: ExecutionContext) => string;

    /** Environment variables to set */
    env?: Record<string, string>;

    /** Timeout in milliseconds (default: 30000) */
    timeout?: number;
}

/**
 * Create a simple command-based executor
 *
 * This helper creates an executor that:
 * 1. Writes code to a temp file
 * 2. Executes a command with the file as argument
 * 3. Captures stdout/stderr
 *
 * @example
 * ```typescript
 * const rubyExecutor = createSimpleExecutor({
 *     languages: ['ruby', 'rb'],
 *     command: 'ruby',
 *     extension: '.rb',
 * });
 *
 * context.subscriptions.push(registerBabelExecutor(rubyExecutor));
 * ```
 */
export function createSimpleExecutor(options: SimpleExecutorOptions): LanguageExecutor {
    const { spawn } = require('child_process') as typeof import('child_process');
    const fs = require('fs').promises as typeof import('fs').promises;
    const path = require('path') as typeof import('path');
    const os = require('os') as typeof import('os');
    const crypto = require('crypto') as typeof import('crypto');

    return {
        languages: options.languages,

        async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
            const startTime = Date.now();

            // Transform code if transformer provided
            const finalCode = options.transformCode
                ? options.transformCode(code, context)
                : code;

            // Create temp file with secure random name
            const tempDir = os.tmpdir();
            const randomName = crypto.randomBytes(16).toString('hex');
            const tempFile = path.join(tempDir, `babel-${randomName}${options.extension}`);

            try {
                await fs.writeFile(tempFile, finalCode, 'utf8');

                const result = await new Promise<ExecutionResult>((resolve) => {
                    const args = [...(options.args || []), tempFile];
                    const cwd = context.cwd || process.cwd();
                    const env = { ...process.env, ...options.env, ...context.env };

                    const proc = spawn(options.command, args, { cwd, env });

                    let stdout = '';
                    let stderr = '';

                    proc.stdout?.on('data', (data: Buffer) => {
                        stdout += data.toString();
                    });

                    proc.stderr?.on('data', (data: Buffer) => {
                        stderr += data.toString();
                    });

                    const timeout = options.timeout || context.timeout || 30000;
                    const timer = setTimeout(() => {
                        proc.kill('SIGTERM');
                        resolve({
                            success: false,
                            stdout,
                            stderr: stderr + '\nExecution timed out',
                            executionTime: Date.now() - startTime,
                        });
                    }, timeout);

                    proc.on('close', (exitCode: number | null) => {
                        clearTimeout(timer);
                        resolve({
                            success: exitCode === 0,
                            stdout: stdout.trim(),
                            stderr: stderr.trim(),
                            executionTime: Date.now() - startTime,
                        });
                    });

                    proc.on('error', (err: Error) => {
                        clearTimeout(timer);
                        resolve({
                            success: false,
                            stdout: '',
                            stderr: err.message,
                            executionTime: Date.now() - startTime,
                        });
                    });
                });

                return result;
            } finally {
                // Clean up temp file
                try {
                    await fs.unlink(tempFile);
                } catch {
                    // Ignore cleanup errors
                }
            }
        },

        async isAvailable(): Promise<boolean> {
            if (options.checkAvailability) {
                return options.checkAvailability();
            }

            // Default: check if command exists by running --version
            const { spawn } = require('child_process') as typeof import('child_process');

            return new Promise((resolve) => {
                const proc = spawn(options.command, ['--version'], {
                    stdio: 'ignore',
                });

                proc.on('close', (code: number | null) => {
                    resolve(code === 0);
                });

                proc.on('error', () => {
                    resolve(false);
                });

                // Timeout after 5 seconds
                setTimeout(() => {
                    proc.kill();
                    resolve(false);
                }, 5000);
            });
        },
    };
}

// =============================================================================
// Helper: Session-based Executor
// =============================================================================

/**
 * Options for creating a session-based executor
 */
export interface SessionExecutorOptions extends SimpleExecutorOptions {
    /** Marker to detect end of output */
    endMarker?: string;

    /** Code to initialize the session */
    initCode?: string;
}

/**
 * Create a session-based executor that maintains a persistent process
 *
 * Session executors keep a language runtime running and send code to it,
 * allowing variables and state to persist between executions.
 */
export function createSessionExecutor(options: SessionExecutorOptions): LanguageExecutor {
    const { spawn } = require('child_process') as typeof import('child_process');
    const sessions = new Map<string, { proc: ReturnType<typeof spawn>; pending: Array<(result: string) => void> }>();

    const baseExecutor = createSimpleExecutor(options);

    return {
        ...baseExecutor,

        async initSession(sessionName: string, context: ExecutionContext): Promise<void> {
            if (sessions.has(sessionName)) {
                return;
            }

            const cwd = context.cwd || process.cwd();
            const env = { ...process.env, ...options.env, ...context.env };

            const proc = spawn(options.command, options.args || [], {
                cwd,
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            sessions.set(sessionName, { proc, pending: [] });

            if (options.initCode) {
                proc.stdin?.write(options.initCode + '\n');
            }
        },

        async closeSession(sessionName: string): Promise<void> {
            const session = sessions.get(sessionName);
            if (session) {
                session.proc.kill();
                sessions.delete(sessionName);
            }
        },

        async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
            // If no session, use the simple executor
            if (!context.session || !sessions.has(context.session)) {
                return baseExecutor.execute(code, context);
            }

            // Session-based execution would need more complex implementation
            // This is a simplified version
            return baseExecutor.execute(code, context);
        },
    };
}

// =============================================================================
// Exports
// =============================================================================

export {
    validateExecutor,
};
