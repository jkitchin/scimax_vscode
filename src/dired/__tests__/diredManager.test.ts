/**
 * Tests for DiredManager
 *
 * These tests verify the security and correctness of file operations,
 * especially path traversal prevention and input validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock vscode module before importing DiredManager
vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        fs: {
            delete: vi.fn().mockResolvedValue(undefined),
            copy: vi.fn().mockResolvedValue(undefined),
            rename: vi.fn().mockResolvedValue(undefined),
        },
        getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string, defaultValue: any) => defaultValue),
        })),
    },
    Uri: {
        file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }),
    },
    window: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
    },
}));

// Import after mocking
import { DiredManager } from '../diredManager';

describe('DiredManager', () => {
    let testDir: string;
    let manager: DiredManager;

    beforeEach(async () => {
        // Create a temporary test directory
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dired-test-'));

        // Create some test files and directories
        await fs.promises.writeFile(path.join(testDir, 'file1.txt'), 'content1');
        await fs.promises.writeFile(path.join(testDir, 'file2.txt'), 'content2');
        await fs.promises.mkdir(path.join(testDir, 'subdir'));
        await fs.promises.writeFile(path.join(testDir, 'subdir', 'nested.txt'), 'nested');
        await fs.promises.writeFile(path.join(testDir, '.hidden'), 'hidden');

        manager = new DiredManager(testDir);
    });

    afterEach(async () => {
        // Clean up test directory
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        vi.clearAllMocks();
    });

    describe('loadDirectory', () => {
        it('should load directory entries', async () => {
            await manager.loadDirectory();
            const state = manager.getState();

            expect(state.currentDirectory).toBe(testDir);
            expect(state.entries.length).toBeGreaterThan(0);
        });

        it('should not show hidden files by default', async () => {
            await manager.loadDirectory();
            const state = manager.getState();

            const hiddenFile = state.entries.find((e) => e.name === '.hidden');
            expect(hiddenFile).toBeUndefined();
        });

        it('should show hidden files when enabled', async () => {
            // toggleHidden calls loadDirectory internally, need to await it
            await manager.loadDirectory();
            manager.getState().showHidden = true;
            await manager.loadDirectory();
            const state = manager.getState();

            const hiddenFile = state.entries.find((e) => e.name === '.hidden');
            expect(hiddenFile).toBeDefined();
        });

        it('should always show . and .. entries for navigation', async () => {
            await manager.loadDirectory();
            const state = manager.getState();

            // . and .. should always be visible regardless of showHidden setting
            const dotEntry = state.entries.find((e) => e.name === '.');
            const dotDotEntry = state.entries.find((e) => e.name === '..');
            expect(dotEntry).toBeDefined();
            expect(dotDotEntry).toBeDefined();
        });

        it('should throw error for non-existent directory', async () => {
            await expect(manager.loadDirectory('/nonexistent/path/12345'))
                .rejects.toThrow();
        });

        it('should throw error for file instead of directory', async () => {
            const filePath = path.join(testDir, 'file1.txt');
            await expect(manager.loadDirectory(filePath))
                .rejects.toThrow('is not a directory');
        });
    });

    describe('createDirectory - path traversal prevention', () => {
        it('should create a valid directory', async () => {
            await manager.loadDirectory();
            await manager.createDirectory('newdir');

            const exists = await fs.promises.stat(path.join(testDir, 'newdir'))
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(true);
        });

        it('should reject names with forward slashes', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('bad/name'))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject names with backslashes', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('bad\\name'))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject parent directory reference (..)', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('..'))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject current directory reference (.)', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('.'))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject path traversal attempts like ../evil', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('../evil'))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject empty names', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory(''))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject whitespace-only names', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('   '))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject names with null bytes', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('bad\0name'))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject names that are too long', async () => {
            await manager.loadDirectory();
            const longName = 'a'.repeat(300);
            await expect(manager.createDirectory(longName))
                .rejects.toThrow('Invalid directory name');
        });

        it('should reject if directory already exists', async () => {
            await manager.loadDirectory();
            await expect(manager.createDirectory('subdir'))
                .rejects.toThrow('already exists');
        });
    });

    describe('addPendingRename - validation', () => {
        it('should add valid rename', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', 'renamed.txt');

            const state = manager.getState();
            expect(state.pendingRenames.get('file1.txt')).toBe('renamed.txt');
        });

        it('should silently reject invalid new names (with slash)', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', 'bad/name.txt');

            const state = manager.getState();
            expect(state.pendingRenames.has('file1.txt')).toBe(false);
        });

        it('should silently reject parent directory reference', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', '..');

            const state = manager.getState();
            expect(state.pendingRenames.has('file1.txt')).toBe(false);
        });

        it('should silently reject path traversal attempts', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', '../../../etc/passwd');

            const state = manager.getState();
            expect(state.pendingRenames.has('file1.txt')).toBe(false);
        });

        it('should remove rename if new name equals original', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', 'renamed.txt');
            manager.addPendingRename('file1.txt', 'file1.txt');

            const state = manager.getState();
            expect(state.pendingRenames.has('file1.txt')).toBe(false);
        });
    });

    describe('validatePendingRenames', () => {
        it('should detect invalid filenames', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            // Force add an invalid name by directly manipulating state
            manager.getState().pendingRenames.set('file1.txt', 'bad/name.txt');

            const errors = manager.validatePendingRenames();
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain('Invalid filename');
        });

        it('should detect duplicate target names', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', 'same.txt');
            manager.addPendingRename('file2.txt', 'same.txt');

            const errors = manager.validatePendingRenames();
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some((e) => e.includes('Multiple files'))).toBe(true);
        });

        it('should detect conflicts with existing files', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', 'file2.txt');

            const errors = manager.validatePendingRenames();
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain('already exists');
        });

        it('should allow valid renames', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', 'newname.txt');

            const errors = manager.validatePendingRenames();
            expect(errors.length).toBe(0);
        });
    });

    describe('commitWdiredRenames', () => {
        it('should fail validation for forced invalid path traversal', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            // Force add an invalid name by directly manipulating state
            manager.getState().pendingRenames.set('file1.txt', '../escaped.txt');

            const result = await manager.commitWdiredRenames();

            expect(result.renamed.length).toBe(0);
            expect(result.errors.length).toBeGreaterThan(0);

            // Verify the file was NOT renamed (original still exists)
            const exists = await fs.promises.stat(path.join(testDir, 'file1.txt'))
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(true);
        });

        it('should handle non-existent source files', async () => {
            await manager.loadDirectory();
            manager.enterWdiredMode();
            manager.addPendingRename('file1.txt', 'renamed.txt');

            // Delete the source file before commit
            await fs.promises.unlink(path.join(testDir, 'file1.txt'));

            const result = await manager.commitWdiredRenames();

            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('no longer exists');
        });
    });

    describe('deleteFiles', () => {
        it('should verify files exist before deletion', async () => {
            await manager.loadDirectory();

            // Find a file (not a directory) to mark
            const state = manager.getState();
            const fileIndex = state.entries.findIndex((e) => !e.isDirectory);
            expect(fileIndex).toBeGreaterThanOrEqual(0);

            manager.selectIndex(fileIndex);
            manager.markCurrent();

            const markedFile = state.entries[fileIndex];

            // Delete the file before the operation
            await fs.promises.unlink(markedFile.path);

            const result = await manager.deleteFiles(false);

            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('no longer exists');
        });
    });

    describe('copyFiles', () => {
        it('should reject non-existent destination', async () => {
            await manager.loadDirectory();
            manager.markCurrent();

            const result = await manager.copyFiles('/nonexistent/destination/12345');

            expect(result.copied.length).toBe(0);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject file as destination', async () => {
            await manager.loadDirectory();
            manager.markCurrent();

            const result = await manager.copyFiles(path.join(testDir, 'file2.txt'));

            expect(result.copied.length).toBe(0);
            expect(result.errors[0]).toContain('not a directory');
        });

        it('should detect already existing files at destination', async () => {
            await manager.loadDirectory();
            manager.markCurrent();

            // Copy to same directory - file already exists
            const result = await manager.copyFiles(testDir);

            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('Already exists');
        });
    });

    describe('renameFiles (move)', () => {
        it('should reject non-existent destination', async () => {
            await manager.loadDirectory();
            manager.markCurrent();

            const result = await manager.renameFiles('/nonexistent/destination/12345');

            expect(result.renamed.length).toBe(0);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject file as destination', async () => {
            await manager.loadDirectory();
            manager.markCurrent();

            const result = await manager.renameFiles(path.join(testDir, 'file2.txt'));

            expect(result.renamed.length).toBe(0);
            expect(result.errors[0]).toContain('not a directory');
        });
    });

    describe('markByRegex', () => {
        it('should mark files matching pattern', async () => {
            await manager.loadDirectory();

            const count = manager.markByRegex('\\.txt$');

            expect(count).toBeGreaterThan(0);

            const state = manager.getState();
            const markedFiles = state.entries.filter((e) => e.mark === 'marked');
            expect(markedFiles.every((f) => f.name.endsWith('.txt'))).toBe(true);
        });

        it('should handle invalid regex gracefully', async () => {
            await manager.loadDirectory();

            // Invalid regex - unclosed bracket
            const count = manager.markByRegex('[invalid');

            expect(count).toBe(0);
        });

        it('should reject very long patterns (ReDoS prevention)', async () => {
            await manager.loadDirectory();

            const longPattern = 'a'.repeat(200);
            const count = manager.markByRegex(longPattern);

            expect(count).toBe(0);
        });
    });

    describe('navigation', () => {
        it('should navigate to parent directory', async () => {
            await manager.loadDirectory(path.join(testDir, 'subdir'));

            await manager.navigateToParent();

            const state = manager.getState();
            expect(state.currentDirectory).toBe(testDir);
        });

        it('should not navigate above root', async () => {
            // Use platform-appropriate root: '/' on Unix, 'C:\' on Windows
            const root = process.platform === 'win32' ? path.parse(process.cwd()).root : '/';
            await manager.loadDirectory(root);

            await manager.navigateToParent();

            const state = manager.getState();
            expect(state.currentDirectory).toBe(root);
        });
    });

    describe('filter', () => {
        it('should filter entries by pattern', async () => {
            await manager.loadDirectory();
            const initialCount = manager.getState().entries.length;
            expect(initialCount).toBeGreaterThan(0);

            // setFilter calls loadDirectory internally which is async
            // We need to set the filter and then manually call loadDirectory
            manager.getState().filterPattern = '\\.txt$';
            await manager.loadDirectory();

            const filteredCount = manager.getState().entries.length;
            // All entries should be .txt files plus . and .., which is fewer than total
            expect(filteredCount).toBeLessThanOrEqual(initialCount);
            // Verify all filtered entries match the pattern (except . and ..)
            const state = manager.getState();
            const nonDotEntries = state.entries.filter((e) => e.name !== '.' && e.name !== '..');
            expect(nonDotEntries.every((e) => e.name.endsWith('.txt'))).toBe(true);
        });

        it('should handle invalid filter pattern gracefully', async () => {
            await manager.loadDirectory();

            manager.getState().filterPattern = '[invalid';
            await manager.loadDirectory();

            // With invalid regex, all files should be shown (filter treated as no filter)
            const state = manager.getState();
            expect(state.entries.length).toBeGreaterThan(0);
        });
    });

    describe('marking operations', () => {
        it('should mark and unmark files', async () => {
            await manager.loadDirectory();

            manager.markCurrent();
            let state = manager.getState();
            expect(state.entries.some((e) => e.mark === 'marked')).toBe(true);

            manager.selectFirst();
            manager.unmarkCurrent();
            state = manager.getState();
            expect(state.entries[0].mark).toBe('none');
        });

        it('should flag files for deletion', async () => {
            await manager.loadDirectory();

            manager.flagCurrent();
            const state = manager.getState();
            expect(state.entries.some((e) => e.mark === 'flagged')).toBe(true);
        });

        it('should unmark all files', async () => {
            await manager.loadDirectory();

            manager.markCurrent();
            manager.markCurrent();
            manager.unmarkAll();

            const state = manager.getState();
            expect(state.entries.every((e) => e.mark === 'none')).toBe(true);
        });

        it('should toggle all marks', async () => {
            await manager.loadDirectory();

            manager.markCurrent();
            manager.toggleAllMarks();

            const state = manager.getState();
            // The previously marked file should be unmarked, others marked
            expect(state.entries.some((e) => e.mark === 'marked')).toBe(true);
        });
    });

    describe('empty state handling', () => {
        it('should handle operations on empty directory', async () => {
            const emptyDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dired-empty-'));
            try {
                await manager.loadDirectory(emptyDir);

                // These should not throw
                manager.markCurrent();
                manager.unmarkCurrent();
                manager.flagCurrent();

                const state = manager.getState();
                // Empty directory still has . and .. entries
                expect(state.entries.length).toBe(2);
                expect(state.entries[0].name).toBe('.');
                expect(state.entries[1].name).toBe('..');
            } finally {
                await fs.promises.rm(emptyDir, { recursive: true, force: true });
            }
        });

        it('should return empty results for operations with no files selected', async () => {
            await manager.loadDirectory();
            manager.unmarkAll();

            // With selection at a position but nothing marked
            const filesToOperate = manager.getFilesToOperateOn();
            expect(filesToOperate.length).toBe(1); // Current file
        });
    });

    describe('sorting', () => {
        it('should sort entries by different fields', async () => {
            await manager.loadDirectory();

            manager.setSort('name');
            let state = manager.getState();
            const firstByName = state.entries[0]?.name;

            manager.setSort('size');
            state = manager.getState();
            // After sorting by size, order might be different

            manager.setSort('mtime');
            state = manager.getState();
            // After sorting by mtime, order might be different

            // Toggle direction
            manager.setSort('mtime');
            state = manager.getState();
            expect(state.sort.direction).toBe('desc');
        });

        it('should keep directories first regardless of sort', async () => {
            await manager.loadDirectory();

            manager.setSort('name');
            let state = manager.getState();

            // Find first file (non-directory) index
            const firstFileIndex = state.entries.findIndex((e) => !e.isDirectory);
            // Find last directory index
            const lastDirIndex = state.entries
                .map((e, i) => ({ isDir: e.isDirectory, index: i }))
                .filter((x) => x.isDir)
                .pop()?.index ?? -1;

            // All directories should come before files
            if (lastDirIndex >= 0 && firstFileIndex >= 0) {
                expect(lastDirIndex).toBeLessThan(firstFileIndex);
            }
        });
    });
});
