/**
 * Tests for captureProvider.resolveFilePath (issue #47 audit, item E2).
 *
 * Bug: when scimax.capture.defaultDirectory was unset, a relative template
 * `file:` was joined onto the default capture *file* path
 * (e.g. ~/scimax/notes.org/inbox.org). The fix joins against that file's
 * *directory* instead. These tests pin that behavior and the other path
 * shapes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// getDefaultCaptureFile() reads scimax.capture.defaultFile; return an absolute
// path so expandTilde is a no-op and the resolved directory is deterministic.
const DEFAULT_CAPTURE_FILE = '/home/user/scimax/notes.org';

vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: vi.fn((section?: string) => ({
            get: vi.fn((key: string, defaultValue?: any) => {
                if (section === 'scimax.capture' && key === 'defaultFile') return DEFAULT_CAPTURE_FILE;
                return defaultValue;
            }),
        })),
    },
}));

import { resolveFilePath } from '../captureProvider';

describe('captureProvider.resolveFilePath', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('joins a relative path against the DIRECTORY of the default capture file when no defaultDir', () => {
        // Regression for E2: must be .../scimax/inbox.org, not
        // .../scimax/notes.org/inbox.org.
        expect(resolveFilePath('inbox.org', '')).toBe(path.join('/home/user/scimax', 'inbox.org'));
    });

    it('joins a relative path against an explicit defaultDir when provided', () => {
        expect(resolveFilePath('inbox.org', '/tmp/org')).toBe(path.join('/tmp/org', 'inbox.org'));
    });

    it('returns absolute paths unchanged', () => {
        expect(resolveFilePath('/abs/path/todo.org', '')).toBe('/abs/path/todo.org');
    });

    it('falls back to the default capture file when filePath is empty', () => {
        expect(resolveFilePath('', '')).toBe(DEFAULT_CAPTURE_FILE);
    });
});
