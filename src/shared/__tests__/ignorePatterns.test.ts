/**
 * Tests for ignore pattern utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Mock fs module
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn()
}));

import * as fs from 'fs';
import {
    DEFAULT_IGNORE_PATTERNS,
    BASELINE_DB_EXCLUDE,
    withBaselineExcludes,
    loadIgnorePatterns,
    shouldIgnore,
    mergePatterns
} from '../ignorePatterns';

describe('DEFAULT_IGNORE_PATTERNS', () => {
    it('should include common directories to ignore', () => {
        expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('.git');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('__pycache__');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('dist');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('build');
    });

    it('should include common file patterns to ignore', () => {
        expect(DEFAULT_IGNORE_PATTERNS).toContain('*.pyc');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('*.class');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('.DS_Store');
    });

    it('should include virtual environment directories', () => {
        expect(DEFAULT_IGNORE_PATTERNS).toContain('venv');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('.venv');
        expect(DEFAULT_IGNORE_PATTERNS).toContain('env');
    });
});

describe('loadIgnorePatterns', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return default patterns when no ignore files exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const patterns = loadIgnorePatterns('/project');

        expect(patterns).toEqual(expect.arrayContaining(DEFAULT_IGNORE_PATTERNS));
    });

    it('should load patterns from .gitignore', () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => {
            return String(p).endsWith('.gitignore');
        });
        vi.mocked(fs.readFileSync).mockReturnValue('*.log\ntemp/\n# comment\n');

        const patterns = loadIgnorePatterns('/project');

        expect(patterns).toContain('*.log');
        expect(patterns).toContain('temp/');
        expect(patterns).not.toContain('# comment');
    });

    it('should load patterns from .projectileignore', () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => {
            return String(p).endsWith('.projectileignore');
        });
        vi.mocked(fs.readFileSync).mockReturnValue('vendor/\ndata/');

        const patterns = loadIgnorePatterns('/project');

        expect(patterns).toContain('vendor/');
        expect(patterns).toContain('data/');
    });

    it('should combine default and file patterns', () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => {
            return String(p).endsWith('.gitignore');
        });
        vi.mocked(fs.readFileSync).mockReturnValue('custom-ignore/');

        const patterns = loadIgnorePatterns('/project');

        // Should have defaults
        expect(patterns).toContain('node_modules');
        // Should have custom
        expect(patterns).toContain('custom-ignore/');
    });

    it('should skip defaults when includeDefaults is false', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const patterns = loadIgnorePatterns('/project', false);

        expect(patterns).not.toContain('node_modules');
        expect(patterns).toHaveLength(0);
    });
});

describe('shouldIgnore', () => {
    it('should match exact directory names', () => {
        const patterns = ['node_modules', '.git'];

        expect(shouldIgnore('node_modules', patterns)).toBe(true);
        expect(shouldIgnore('src/node_modules', patterns)).toBe(true);
        expect(shouldIgnore('.git', patterns)).toBe(true);
    });

    it('should match wildcard patterns', () => {
        const patterns = ['*.pyc', '*.log'];

        expect(shouldIgnore('test.pyc', patterns)).toBe(true);
        expect(shouldIgnore('src/cache.pyc', patterns)).toBe(true);
        expect(shouldIgnore('app.log', patterns)).toBe(true);
    });

    it('should not match non-matching paths', () => {
        const patterns = ['node_modules', '*.pyc'];

        expect(shouldIgnore('src/main.ts', patterns)).toBe(false);
        expect(shouldIgnore('README.md', patterns)).toBe(false);
    });

    it('should handle path with directory separators', () => {
        const patterns = ['dist'];

        expect(shouldIgnore(`dist${path.sep}bundle.js`, patterns)).toBe(true);
        expect(shouldIgnore(`src${path.sep}dist${path.sep}file.js`, patterns)).toBe(true);
    });

    it('should handle patterns with leading/trailing slashes', () => {
        const patterns = ['/build/', 'cache/'];

        expect(shouldIgnore('build', patterns)).toBe(true);
        expect(shouldIgnore('cache', patterns)).toBe(true);
    });
});

describe('mergePatterns', () => {
    it('should combine multiple pattern arrays', () => {
        const patterns1 = ['node_modules', 'dist'];
        const patterns2 = ['*.log', 'temp'];
        const patterns3 = ['build'];

        const merged = mergePatterns(patterns1, patterns2, patterns3);

        expect(merged).toContain('node_modules');
        expect(merged).toContain('dist');
        expect(merged).toContain('*.log');
        expect(merged).toContain('temp');
        expect(merged).toContain('build');
    });

    it('should deduplicate patterns', () => {
        const patterns1 = ['node_modules', 'dist'];
        const patterns2 = ['dist', 'build'];

        const merged = mergePatterns(patterns1, patterns2);

        const distCount = merged.filter(p => p === 'dist').length;
        expect(distCount).toBe(1);
    });

    it('should handle empty arrays', () => {
        const merged = mergePatterns([], ['one'], []);

        expect(merged).toEqual(['one']);
    });
});

describe('withBaselineExcludes', () => {
    // A VS Code settings array replaces the contributed default rather than
    // extending it, so a user who excludes one personal path must not thereby
    // re-enable indexing of node_modules or the editor's local history.
    it('keeps the baseline when the user configured their own patterns', () => {
        const merged = withBaselineExcludes(['~/notes/scratch.org']);

        expect(merged).toContain('~/notes/scratch.org');
        for (const pattern of BASELINE_DB_EXCLUDE) {
            expect(merged).toContain(pattern);
        }
    });

    it('returns the baseline when nothing is configured', () => {
        expect(withBaselineExcludes(undefined)).toEqual(BASELINE_DB_EXCLUDE);
        expect(withBaselineExcludes([])).toEqual(BASELINE_DB_EXCLUDE);
    });

    it('does not duplicate a pattern the user also listed', () => {
        const merged = withBaselineExcludes(['**/node_modules/**']);

        expect(merged.filter(p => p === '**/node_modules/**')).toHaveLength(1);
    });

    it("excludes VS Code's local history, which duplicates every edited file", () => {
        expect(BASELINE_DB_EXCLUDE).toContain('**/Code/User/History/**');
    });
});
