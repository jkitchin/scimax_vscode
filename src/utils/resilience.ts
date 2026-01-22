/**
 * Resilience Utilities
 *
 * Provides retry logic and timeout handling for async operations.
 * Used primarily for database operations that may fail transiently.
 */

import { createLogger } from './logger';

const log = createLogger('Resilience');

/**
 * Options for retry behavior
 */
export interface RetryOptions {
    /** Maximum number of attempts (default: 3) */
    maxAttempts?: number;
    /** Base delay in ms for exponential backoff (default: 100) */
    baseDelayMs?: number;
    /** Maximum delay in ms (default: 5000) */
    maxDelayMs?: number;
    /** Function to determine if error is retryable (default: isTransientError) */
    isRetryable?: (error: unknown) => boolean;
    /** Operation name for logging */
    operationName?: string;
}

/**
 * Options for timeout behavior
 */
export interface TimeoutOptions {
    /** Timeout in milliseconds */
    timeoutMs: number;
    /** Operation name for error message */
    operationName?: string;
}

/**
 * Error thrown when operation times out
 */
export class TimeoutError extends Error {
    constructor(operationName: string, timeoutMs: number) {
        super(`Operation '${operationName}' timed out after ${timeoutMs}ms`);
        this.name = 'TimeoutError';
    }
}

/**
 * Error thrown when all retry attempts fail
 */
export class RetryExhaustedError extends Error {
    public readonly lastError: Error;
    public readonly attempts: number;

    constructor(operationName: string, attempts: number, lastError: Error) {
        super(`Operation '${operationName}' failed after ${attempts} attempts: ${lastError.message}`);
        this.name = 'RetryExhaustedError';
        this.lastError = lastError;
        this.attempts = attempts;
    }
}

/**
 * Determine if an error is likely transient and worth retrying
 */
export function isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();

    // SQLite transient errors
    if (message.includes('database is locked') ||
        message.includes('database is busy') ||
        message.includes('sqlite_busy') ||
        message.includes('cannot commit transaction') ||
        message.includes('disk i/o error') ||
        message.includes('unable to open database')) {
        return true;
    }

    // Network/connection errors
    if (message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('etimedout') ||
        message.includes('network') ||
        message.includes('connection')) {
        return true;
    }

    // File system transient errors
    if (message.includes('ebusy') ||
        message.includes('eagain') ||
        message.includes('resource temporarily unavailable')) {
        return true;
    }

    return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    // Exponential backoff: base * 2^attempt
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
    // Add jitter (0-50% of delay) to prevent thundering herd
    const jitter = Math.random() * exponentialDelay * 0.5;
    // Cap at max delay
    return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Execute a function with retry logic
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Result of the function
 * @throws RetryExhaustedError if all attempts fail
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *     () => db.execute('SELECT * FROM files'),
 *     { maxAttempts: 3, operationName: 'query files' }
 * );
 * ```
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        baseDelayMs = 100,
        maxDelayMs = 5000,
        isRetryable = isTransientError,
        operationName = 'operation'
    } = options;

    let lastError: Error = new Error('No attempts made');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Check if we should retry
            if (attempt < maxAttempts && isRetryable(error)) {
                const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
                log.warn(`${operationName} failed (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(delay)}ms`, {
                    error: lastError.message,
                    attempt,
                    maxAttempts
                });
                await sleep(delay);
            } else if (attempt < maxAttempts) {
                // Non-retryable error, don't retry
                log.debug(`${operationName} failed with non-retryable error`, {
                    error: lastError.message
                });
                throw lastError;
            }
        }
    }

    // All attempts exhausted
    log.error(`${operationName} failed after ${maxAttempts} attempts`, lastError);
    throw new RetryExhaustedError(operationName, maxAttempts, lastError);
}

/**
 * Execute a function with a timeout
 *
 * @param fn - Async function to execute
 * @param options - Timeout options
 * @returns Result of the function
 * @throws TimeoutError if operation exceeds timeout
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *     () => db.execute('SELECT * FROM files'),
 *     { timeoutMs: 30000, operationName: 'query files' }
 * );
 * ```
 */
export async function withTimeout<T>(
    fn: () => Promise<T>,
    options: TimeoutOptions
): Promise<T> {
    const { timeoutMs, operationName = 'operation' } = options;

    return new Promise<T>((resolve, reject) => {
        let settled = false;

        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                log.warn(`${operationName} timed out after ${timeoutMs}ms`);
                reject(new TimeoutError(operationName, timeoutMs));
            }
        }, timeoutMs);

        fn()
            .then(result => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(result);
                }
            })
            .catch(error => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
    });
}

/**
 * Execute a function with both retry and timeout
 *
 * Each attempt has its own timeout. The total time could be
 * up to: maxAttempts * timeoutMs + total retry delays
 *
 * @example
 * ```typescript
 * const result = await withRetryAndTimeout(
 *     () => db.execute('SELECT * FROM files'),
 *     { maxAttempts: 3, operationName: 'query files' },
 *     { timeoutMs: 30000 }
 * );
 * ```
 */
export async function withRetryAndTimeout<T>(
    fn: () => Promise<T>,
    retryOptions: RetryOptions = {},
    timeoutOptions: TimeoutOptions
): Promise<T> {
    const operationName = retryOptions.operationName || timeoutOptions.operationName || 'operation';

    return withRetry(
        () => withTimeout(fn, { ...timeoutOptions, operationName }),
        {
            ...retryOptions,
            operationName,
            // Timeout errors are retryable by default
            isRetryable: (error) => {
                if (error instanceof TimeoutError) {
                    return true;
                }
                return (retryOptions.isRetryable || isTransientError)(error);
            }
        }
    );
}

/**
 * Create a debounced version of an async function
 * Only the last call within the delay window will execute
 */
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    delayMs: number
): T {
    let timeoutId: NodeJS.Timeout | null = null;
    let pendingResolve: ((value: any) => void) | null = null;
    let pendingReject: ((error: any) => void) | null = null;

    return ((...args: Parameters<T>): Promise<ReturnType<T>> => {
        return new Promise((resolve, reject) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                // Resolve previous pending call with undefined
                if (pendingResolve) {
                    pendingResolve(undefined);
                }
            }

            pendingResolve = resolve;
            pendingReject = reject;

            timeoutId = setTimeout(async () => {
                timeoutId = null;
                try {
                    const result = await fn(...args);
                    if (pendingResolve) {
                        pendingResolve(result);
                        pendingResolve = null;
                        pendingReject = null;
                    }
                } catch (error) {
                    if (pendingReject) {
                        pendingReject(error);
                        pendingResolve = null;
                        pendingReject = null;
                    }
                }
            }, delayMs);
        });
    }) as T;
}
