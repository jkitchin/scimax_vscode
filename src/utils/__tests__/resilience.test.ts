/**
 * Tests for resilience utilities (retry, timeout)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    })
}));

import {
    withRetry,
    withTimeout,
    withRetryAndTimeout,
    isTransientError,
    TimeoutError,
    RetryExhaustedError
} from '../resilience';

describe('isTransientError', () => {
    it('should return true for database locked errors', () => {
        expect(isTransientError(new Error('database is locked'))).toBe(true);
        expect(isTransientError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
    });

    it('should return true for database busy errors', () => {
        expect(isTransientError(new Error('database is busy'))).toBe(true);
    });

    it('should return true for disk I/O errors', () => {
        expect(isTransientError(new Error('disk i/o error'))).toBe(true);
    });

    it('should return true for connection errors', () => {
        expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
        expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
        expect(isTransientError(new Error('Connection reset'))).toBe(true);
    });

    it('should return true for timeout errors', () => {
        expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    });

    it('should return true for file system busy errors', () => {
        expect(isTransientError(new Error('EBUSY: resource busy'))).toBe(true);
        expect(isTransientError(new Error('EAGAIN'))).toBe(true);
    });

    it('should return false for non-transient errors', () => {
        expect(isTransientError(new Error('syntax error'))).toBe(false);
        expect(isTransientError(new Error('no such table'))).toBe(false);
        expect(isTransientError(new Error('UNIQUE constraint failed'))).toBe(false);
    });

    it('should return false for non-Error values', () => {
        expect(isTransientError('string error')).toBe(false);
        expect(isTransientError(null)).toBe(false);
        expect(isTransientError(undefined)).toBe(false);
        expect(isTransientError(42)).toBe(false);
    });
});

describe('withRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const result = await withRetry(fn);

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient error and succeed', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('database is locked'))
            .mockResolvedValue('success');

        const promise = withRetry(fn, { operationName: 'test' });

        // Advance timers through retry delay
        await vi.runAllTimersAsync();

        const result = await promise;
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-transient error', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('syntax error'));

        await expect(withRetry(fn, { operationName: 'test' }))
            .rejects.toThrow('syntax error');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw RetryExhaustedError after max attempts', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('database is locked'));

        const promise = withRetry(fn, { maxAttempts: 3, operationName: 'test' });

        await vi.runAllTimersAsync();

        await expect(promise).rejects.toThrow(RetryExhaustedError);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use custom isRetryable function', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('custom error'));

        const promise = withRetry(fn, {
            maxAttempts: 2,
            isRetryable: () => true,
            operationName: 'test'
        });

        await vi.runAllTimersAsync();

        await expect(promise).rejects.toThrow(RetryExhaustedError);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('withTimeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return result before timeout', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const result = await withTimeout(fn, { timeoutMs: 1000 });

        expect(result).toBe('success');
    });

    it('should throw TimeoutError on timeout', async () => {
        const fn = vi.fn().mockImplementation(
            () => new Promise(resolve => setTimeout(() => resolve('late'), 2000))
        );

        const promise = withTimeout(fn, { timeoutMs: 1000, operationName: 'test' });

        vi.advanceTimersByTime(1001);

        await expect(promise).rejects.toThrow(TimeoutError);
    });

    it('should propagate function errors', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('function error'));

        await expect(withTimeout(fn, { timeoutMs: 1000 }))
            .rejects.toThrow('function error');
    });
});

describe('withRetryAndTimeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should retry on timeout', async () => {
        let callCount = 0;
        const fn = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // First call times out
                return new Promise(resolve => setTimeout(() => resolve('late'), 2000));
            }
            // Second call succeeds quickly
            return Promise.resolve('success');
        });

        const promise = withRetryAndTimeout(
            fn,
            { maxAttempts: 2, operationName: 'test' },
            { timeoutMs: 100 }
        );

        await vi.runAllTimersAsync();

        const result = await promise;
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('TimeoutError', () => {
    it('should have correct name and message', () => {
        const error = new TimeoutError('myOp', 5000);

        expect(error.name).toBe('TimeoutError');
        expect(error.message).toContain('myOp');
        expect(error.message).toContain('5000ms');
    });
});

describe('RetryExhaustedError', () => {
    it('should have correct properties', () => {
        const lastError = new Error('last');
        const error = new RetryExhaustedError('myOp', 3, lastError);

        expect(error.name).toBe('RetryExhaustedError');
        expect(error.message).toContain('myOp');
        expect(error.message).toContain('3 attempts');
        expect(error.lastError).toBe(lastError);
        expect(error.attempts).toBe(3);
    });
});
