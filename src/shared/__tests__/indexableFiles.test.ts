import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    DEFAULT_FILE_EXTENSIONS,
    indexableFilesGlob,
    isIndexableFile,
    normalizeExtensions,
} from '../indexableFiles';

describe('scimax.db.fileExtensions', () => {
    it('defaults to org and md', () => {
        expect([...DEFAULT_FILE_EXTENSIONS]).toEqual(['org', 'md']);
        expect(normalizeExtensions(undefined)).toEqual(['.org', '.md']);
    });

    it('package.json declares the same default as the code', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
        // contributes.configuration may be one object or an array of them
        const sections = [pkg.contributes.configuration].flat() as { properties?: Record<string, { default?: unknown }> }[];
        const setting = sections.map(s => s.properties?.['scimax.db.fileExtensions']).find(Boolean);
        expect(setting).toBeDefined();
        expect(setting?.default).toEqual([...DEFAULT_FILE_EXTENSIONS]);
    });

    it('normalizes dots, case, whitespace and duplicates', () => {
        expect(normalizeExtensions(['ORG', '.md', ' markdown ', 'md'])).toEqual(['.org', '.md', '.markdown']);
    });

    it('falls back to the default for an empty or blank list', () => {
        expect(normalizeExtensions([])).toEqual(['.org', '.md']);
        expect(normalizeExtensions(['', '.'])).toEqual(['.org', '.md']);
    });

    it('matches files by extension, case-insensitively', () => {
        expect(isIndexableFile('/a/notes.org')).toBe(true);
        expect(isIndexableFile('/a/README.MD')).toBe(true);
        expect(isIndexableFile('/a/notes.markdown')).toBe(false);
        expect(isIndexableFile('/a/notes.markdown', ['org', 'markdown'])).toBe(true);
        expect(isIndexableFile('/a/notes.md', ['org'])).toBe(false);
        expect(isIndexableFile('/a/data.csv')).toBe(false);
    });

    it('builds the file watcher glob', () => {
        expect(indexableFilesGlob()).toBe('**/*.{org,md}');
        expect(indexableFilesGlob(['org'])).toBe('**/*.org');
    });
});
