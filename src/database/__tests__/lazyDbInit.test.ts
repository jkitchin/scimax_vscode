/**
 * A database that cannot start must not be retried by every caller
 * (issue #91: a missing libsql binary logged an error on every access).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ initialize: vi.fn(), warn: vi.fn() }));

vi.mock('vscode', () => ({
    window: { showWarningMessage: h.warn, createStatusBarItem: vi.fn() },
    workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
    StatusBarAlignment: { Right: 2 },
}));
vi.mock('../scimaxDb', () => ({
    ScimaxDb: class { initialize = h.initialize; },
}));
vi.mock('../embeddingService', () => ({ createEmbeddingServiceAsync: vi.fn(async () => null) }));
vi.mock('../secretStorage', () => ({ initSecretStorage: vi.fn() }));

import { getDatabase, isPermanentInitError, resetDatabaseState, setExtensionContext } from '../lazyDb';

function missingModule(): Error {
    const error = new Error("Cannot find module '@libsql/win32-x64-msvc'\nRequire stack: ...");
    (error as Error & { code: string }).code = 'MODULE_NOT_FOUND';
    return error;
}

describe('lazy database initialization failures', () => {
    beforeEach(() => {
        resetDatabaseState();
        setExtensionContext({} as never);
        h.initialize.mockReset();
        h.warn.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it('recognizes a missing or unloadable native module as permanent', () => {
        expect(isPermanentInitError(missingModule())).toBe(true);
        expect(isPermanentInitError(new Error('\\\\?\\C:\\x\\index.node is not a valid Win32 application.'))).toBe(true);
        expect(isPermanentInitError(Object.assign(new Error('x'), { code: 'ERR_DLOPEN_FAILED' }))).toBe(true);
        expect(isPermanentInitError(new Error('SQLITE_BUSY: database is locked'))).toBe(false);
    });

    it('tries once and warns once when libsql is missing', async () => {
        h.initialize.mockRejectedValue(missingModule());
        for (let i = 0; i < 5; i++) expect(await getDatabase()).toBeNull();
        expect(h.initialize).toHaveBeenCalledTimes(1);
        expect(h.warn).toHaveBeenCalledTimes(1);
        expect(h.warn.mock.calls[0][0]).toContain('@libsql/win32-x64-msvc');
    });

    it('waits before retrying any other failure', async () => {
        vi.useFakeTimers();
        h.initialize.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'));
        expect(await getDatabase()).toBeNull();
        expect(await getDatabase()).toBeNull();
        expect(h.initialize).toHaveBeenCalledTimes(1);
        expect(h.warn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(31_000);
        h.initialize.mockResolvedValueOnce(undefined);
        expect(await getDatabase()).not.toBeNull();
        expect(h.initialize).toHaveBeenCalledTimes(2);
    });
});
