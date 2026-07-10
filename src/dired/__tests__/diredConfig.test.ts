/**
 * Tests for DiredManager initial state from configuration (issue #47 audit,
 * item D2).
 *
 * Bug: scimax.dired.defaultSort and scimax.dired.showHidden were registered
 * settings but the manager hardcoded name/asc/false and never read them. The
 * fix seeds initial state from config, validating defaultSort against the
 * enum. These tests use a configurable vscode mock (the sibling
 * diredManager.test.ts mock always returns defaults, so this lives separately).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const configValues: Record<string, any> = {};

vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: vi.fn((section?: string) => ({
            get: vi.fn((key: string, defaultValue?: any) => {
                const full = `${section}.${key}`;
                return full in configValues ? configValues[full] : defaultValue;
            }),
        })),
    },
    Uri: { file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }) },
    window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn(), showInformationMessage: vi.fn() },
}));

import { DiredManager } from '../diredManager';

describe('DiredManager initial state from config', () => {
    beforeEach(() => {
        for (const k of Object.keys(configValues)) delete configValues[k];
    });

    it('defaults to name/asc and showHidden=false when nothing configured', () => {
        const m = new DiredManager('/tmp');
        const s = m.getState();
        expect(s.sort.field).toBe('name');
        expect(s.sort.direction).toBe('asc');
        expect(s.showHidden).toBe(false);
    });

    it('seeds sort.field from scimax.dired.defaultSort', () => {
        configValues['scimax.dired.defaultSort'] = 'mtime';
        expect(new DiredManager('/tmp').getState().sort.field).toBe('mtime');
    });

    it('seeds showHidden from scimax.dired.showHidden', () => {
        configValues['scimax.dired.showHidden'] = true;
        expect(new DiredManager('/tmp').getState().showHidden).toBe(true);
    });

    it('accepts every valid SortField', () => {
        for (const field of ['name', 'size', 'mtime', 'extension']) {
            configValues['scimax.dired.defaultSort'] = field;
            expect(new DiredManager('/tmp').getState().sort.field).toBe(field);
        }
    });

    it('falls back to name for an invalid defaultSort value', () => {
        configValues['scimax.dired.defaultSort'] = 'date'; // not a SortField
        expect(new DiredManager('/tmp').getState().sort.field).toBe('name');
    });
});
