/**
 * Lazy loader for @libsql/client.
 *
 * Requiring @libsql/client loads libsql's native binding immediately, and on
 * Linux libsql asks detect-libc which C library is in use. detect-libc reads
 * `process.report.getReport().header` without checking that a report came
 * back, and some Electron/VS Code builds return `undefined` there — so the
 * require throws `Cannot read properties of undefined (reading 'header')`.
 *
 * Two defenses:
 * - The client is loaded on first use instead of at module load, so a failure
 *   disables the database rather than stopping the whole extension from
 *   loading (a top-level require runs before activate() can catch anything).
 * - While loading, a missing report is replaced with an empty object, which
 *   makes detect-libc fall back to inspecting ldd, the way it would on a
 *   platform without process.report.
 *
 * Zero VS Code dependencies: used by the CLI as well.
 */

import type * as LibsqlClient from '@libsql/client';

type ProcessReport = { getReport: (...args: unknown[]) => unknown };

let cached: Promise<typeof LibsqlClient> | undefined;

/**
 * Run `fn` with process.report.getReport() guaranteed to return an object.
 * Exported for testing.
 */
export async function withSafeProcessReport<T>(fn: () => Promise<T>): Promise<T> {
    const report = (process as unknown as { report?: ProcessReport }).report;
    if (!report || typeof report.getReport !== 'function') {
        return fn();
    }
    const original = report.getReport;
    report.getReport = function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        return result && typeof result === 'object' ? result : {};
    };
    try {
        return await fn();
    } finally {
        report.getReport = original;
    }
}

/** Load @libsql/client once, on first use. */
export function loadLibsqlClient(): Promise<typeof LibsqlClient> {
    if (!cached) {
        cached = withSafeProcessReport(() => import('@libsql/client'));
        // Let a later call retry instead of caching the failure forever.
        cached.catch(() => { cached = undefined; });
    }
    return cached;
}
