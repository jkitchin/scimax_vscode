/**
 * Tests for CLI settings helpers — notebook discovery in particular.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findNotebooksJson, getNotebookProjectPaths } from '../settings';

describe('findNotebooksJson', () => {
    let tmpDir: string;
    const originalEnv = process.env.SCIMAX_NOTEBOOKS_JSON;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-cli-test-'));
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.SCIMAX_NOTEBOOKS_JSON;
        else process.env.SCIMAX_NOTEBOOKS_JSON = originalEnv;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null when no override and no file exists in any variant', () => {
        // The override env var is the only way to deterministically test this
        // without mucking with the user's real VS Code globalStorage. Point it
        // at a nonexistent path so the function returns null.
        process.env.SCIMAX_NOTEBOOKS_JSON = path.join(tmpDir, 'does-not-exist.json');
        expect(findNotebooksJson()).toBeNull();
    });

    it('honors the SCIMAX_NOTEBOOKS_JSON override when the file exists', () => {
        const stub = path.join(tmpDir, 'notebooks.json');
        fs.writeFileSync(stub, JSON.stringify({ notebooks: [] }));
        process.env.SCIMAX_NOTEBOOKS_JSON = stub;
        expect(findNotebooksJson()).toBe(stub);
    });
});

describe('getNotebookProjectPaths', () => {
    let tmpDir: string;
    const originalEnv = process.env.SCIMAX_NOTEBOOKS_JSON;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-cli-test-'));
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.SCIMAX_NOTEBOOKS_JSON;
        else process.env.SCIMAX_NOTEBOOKS_JSON = originalEnv;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty array when no notebooks file is found', () => {
        process.env.SCIMAX_NOTEBOOKS_JSON = path.join(tmpDir, 'missing.json');
        expect(getNotebookProjectPaths()).toEqual([]);
    });

    it('extracts paths from a well-formed notebooks.json', () => {
        const stub = path.join(tmpDir, 'notebooks.json');
        fs.writeFileSync(stub, JSON.stringify({
            notebooks: [
                { id: 'a', name: 'A', path: '/home/u/proj-a', hasGit: true, hasProjectile: false, created: 0, lastAccessed: 0 },
                { id: 'b', name: 'B', path: '/home/u/proj-b', hasGit: false, hasProjectile: true, created: 0, lastAccessed: 0 }
            ]
        }));
        process.env.SCIMAX_NOTEBOOKS_JSON = stub;
        expect(getNotebookProjectPaths()).toEqual(['/home/u/proj-a', '/home/u/proj-b']);
    });

    it('skips entries with missing or non-string paths', () => {
        const stub = path.join(tmpDir, 'notebooks.json');
        fs.writeFileSync(stub, JSON.stringify({
            notebooks: [
                { id: 'a', path: '/home/u/proj-a' },
                { id: 'b', path: '' },
                { id: 'c', path: 42 },
                { id: 'd' }
            ]
        }));
        process.env.SCIMAX_NOTEBOOKS_JSON = stub;
        expect(getNotebookProjectPaths()).toEqual(['/home/u/proj-a']);
    });

    it('returns empty array when JSON is malformed', () => {
        const stub = path.join(tmpDir, 'notebooks.json');
        fs.writeFileSync(stub, '{ not json');
        process.env.SCIMAX_NOTEBOOKS_JSON = stub;
        expect(getNotebookProjectPaths()).toEqual([]);
    });

    it('returns empty array when the notebooks key is missing', () => {
        const stub = path.join(tmpDir, 'notebooks.json');
        fs.writeFileSync(stub, JSON.stringify({}));
        process.env.SCIMAX_NOTEBOOKS_JSON = stub;
        expect(getNotebookProjectPaths()).toEqual([]);
    });
});
