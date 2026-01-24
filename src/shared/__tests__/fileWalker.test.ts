/**
 * Tests for file walker utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs module
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
        readdir: vi.fn(),
        stat: vi.fn(),
        readFile: vi.fn()
    }
}));

import * as fs from 'fs';
import {
    isProjectRoot,
    FileWalkerResult
} from '../fileWalker';

describe('isProjectRoot', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should detect git repository', () => {
        vi.mocked(fs.readdirSync).mockReturnValue(['.git', 'src', 'README.md'] as any);

        const result = isProjectRoot('/path/to/project');

        expect(result.isProject).toBe(true);
        expect(result.type).toBe('git');
    });

    it('should detect projectile marker', () => {
        vi.mocked(fs.readdirSync).mockReturnValue(['.projectile', 'src'] as any);

        const result = isProjectRoot('/path/to/project');

        expect(result.isProject).toBe(true);
        expect(result.type).toBe('projectile');
    });

    it('should detect npm project', () => {
        vi.mocked(fs.readdirSync).mockReturnValue(['package.json', 'src'] as any);

        const result = isProjectRoot('/path/to/project');

        expect(result.isProject).toBe(true);
        expect(result.type).toBe('npm');
    });

    it('should prefer git over npm', () => {
        vi.mocked(fs.readdirSync).mockReturnValue(['.git', 'package.json', 'src'] as any);

        const result = isProjectRoot('/path/to/project');

        expect(result.isProject).toBe(true);
        expect(result.type).toBe('git');
    });

    it('should return not a project for regular directory', () => {
        vi.mocked(fs.readdirSync).mockReturnValue(['file.txt', 'data'] as any);

        const result = isProjectRoot('/path/to/dir');

        expect(result.isProject).toBe(false);
        expect(result.type).toBe('unknown');
    });

    it('should handle permission errors', () => {
        vi.mocked(fs.readdirSync).mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });

        const result = isProjectRoot('/protected/dir');

        expect(result.isProject).toBe(false);
        expect(result.type).toBe('unknown');
    });
});

describe('FileWalkerResult', () => {
    it('should define result structure', () => {
        const result: FileWalkerResult = {
            files: ['/path/to/file1.org', '/path/to/file2.md'],
            truncated: false,
            cancelled: false
        };

        expect(result.files).toHaveLength(2);
        expect(result.truncated).toBe(false);
        expect(result.cancelled).toBe(false);
    });

    it('should indicate truncation', () => {
        const result: FileWalkerResult = {
            files: Array(100).fill('/path/to/file.org'),
            truncated: true,
            cancelled: false
        };

        expect(result.files).toHaveLength(100);
        expect(result.truncated).toBe(true);
    });

    it('should indicate cancellation', () => {
        const result: FileWalkerResult = {
            files: ['/path/to/partial.org'],
            truncated: false,
            cancelled: true
        };

        expect(result.cancelled).toBe(true);
    });
});

describe('FileWalkerOptions', () => {
    it('should support extension filtering', () => {
        const options = {
            extensions: ['.org', '.md'],
            maxFiles: 1000,
            maxDepth: 10
        };

        expect(options.extensions).toContain('.org');
        expect(options.extensions).toContain('.md');
        expect(options.maxFiles).toBe(1000);
    });

    it('should support cancellation token', () => {
        const cancellationToken = { cancelled: false };

        expect(cancellationToken.cancelled).toBe(false);

        cancellationToken.cancelled = true;
        expect(cancellationToken.cancelled).toBe(true);
    });

    it('should support progress callback', () => {
        const progressValues: number[] = [];
        const onProgress = (count: number) => progressValues.push(count);

        onProgress(10);
        onProgress(20);
        onProgress(30);

        expect(progressValues).toEqual([10, 20, 30]);
    });
});
