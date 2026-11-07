/**
 * Tests for CLI settings helpers — notebook discovery in particular.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findNotebooksJson, findOrgFiles, getDirectoriesToScan, getNotebookProjectPaths, parseJsonc, shouldExclude } from '../settings';
import type { ScimaxSettings } from '../settings';

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

describe('parseJsonc', () => {
    it('keeps glob patterns that look like block comments', () => {
        // A string-blind /* ... */ regex cut from the first pattern's "/**" to
        // a later "**/", silently dropping every setting in between.
        const text = `{
    "scimax.agenda.exclude": [
        "**/node_modules/**",
        "/Users/me/projects/scimax_vscode/**"
    ],
    "scimax.db.include": ["/Users/me/notes"],
    "scimax.db.exclude": ["/Users/me/.vscode/**"]
}`;
        expect(parseJsonc(text)).toEqual({
            'scimax.agenda.exclude': ['**/node_modules/**', '/Users/me/projects/scimax_vscode/**'],
            'scimax.db.include': ['/Users/me/notes'],
            'scimax.db.exclude': ['/Users/me/.vscode/**'],
        });
    });

    it('strips comments and trailing commas outside strings only', () => {
        const text = `{
    // a line comment
    "url": "https://example.com", /* a block comment */
    "quote": "say \\"//not a comment\\"",
    "list": ["a/*b*/c", "d",  // trailing
    ],
}`;
        expect(parseJsonc(text)).toEqual({
            url: 'https://example.com',
            quote: 'say "//not a comment"',
            list: ['a/*b*/c', 'd'],
        });
    });
});

describe('shouldExclude', () => {
    it('excludes files under a directory glob', () => {
        const patterns = ['/Users/me/projects/scimax_vscode/**'];
        expect(shouldExclude('/Users/me/projects/scimax_vscode/docs/13-agenda.org', patterns)).toBe(true);
        expect(shouldExclude('/Users/me/notes/todo.org', patterns)).toBe(false);
    });
});

describe('file entries in scimax.db.include', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-cli-test-'));
        fs.mkdirSync(path.join(tmpDir, 'notes'));
        fs.writeFileSync(path.join(tmpDir, 'notes', 'a.org'), '* a\n');
        fs.writeFileSync(path.join(tmpDir, 'dashboard.org'), '* TODO dash\n');
        fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# readme\n');
        fs.writeFileSync(path.join(tmpDir, 'data.csv'), 'x,y\n');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const settingsWith = (include: string[]) => ({
        db: { include, exclude: [] },
        journal: { directory: '' },
        agenda: { include: [] },
    }) as unknown as ScimaxSettings;

    it('keeps org and markdown files as scan roots, drops other files', () => {
        const roots = getDirectoriesToScan(settingsWith([
            path.join(tmpDir, 'notes'),
            path.join(tmpDir, 'dashboard.org'),
            path.join(tmpDir, 'readme.md'),
            path.join(tmpDir, 'data.csv'),
            path.join(tmpDir, 'missing.org'),
        ]));
        expect(roots).toContain(path.join(tmpDir, 'notes'));
        expect(roots).toContain(path.join(tmpDir, 'dashboard.org'));
        expect(roots).toContain(path.join(tmpDir, 'readme.md'));
        expect(roots).not.toContain(path.join(tmpDir, 'data.csv'));
        expect(roots).not.toContain(path.join(tmpDir, 'missing.org'));
    });

    it('findOrgFiles returns a file root as itself', () => {
        const file = path.join(tmpDir, 'dashboard.org');
        expect(findOrgFiles(file, [])).toEqual([file]);
    });

    it('a file root beats configured excludes (a file beats a folder), not the built-in ones', () => {
        const file = path.join(tmpDir, 'dashboard.org');
        expect(findOrgFiles(file, [file, tmpDir + '/**'])).toEqual([file]);
        const nm = path.join(tmpDir, 'node_modules');
        fs.mkdirSync(nm);
        fs.writeFileSync(path.join(nm, 'x.org'), '* x\n');
        expect(findOrgFiles(path.join(nm, 'x.org'), [])).toEqual([]);
    });

    it('findOrgFiles applies the size limit to a file root', () => {
        const file = path.join(tmpDir, 'dashboard.org');
        fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024));
        expect(findOrgFiles(file, [], { maxFileSizeMB: 1 })).toEqual([]);
    });
});

describe('findOrgFiles honors scimax.db.fileExtensions', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-cli-test-'));
        for (const name of ['a.org', 'b.md', 'c.markdown', 'd.txt']) {
            fs.writeFileSync(path.join(tmpDir, name), 'x\n');
        }
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const names = (files: string[]) => files.map(f => path.basename(f)).sort();

    it('finds org and md by default', () => {
        expect(names(findOrgFiles(tmpDir, []))).toEqual(['a.org', 'b.md']);
    });

    it('uses the configured list', () => {
        expect(names(findOrgFiles(tmpDir, [], { fileExtensions: ['org'] }))).toEqual(['a.org']);
        expect(names(findOrgFiles(tmpDir, [], { fileExtensions: ['org', 'md', 'markdown'] })))
            .toEqual(['a.org', 'b.md', 'c.markdown']);
    });
});
