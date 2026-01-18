/**
 * Tests for Journal Manager
 * These tests cover path generation, date handling, template rendering, and stats computation
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test configuration - use a global that can be modified
const getTestConfig = (): Record<string, unknown> => ({
    'directory': (globalThis as unknown as { __testConfig?: { directory: string } }).__testConfig?.directory || '',
    'format': (globalThis as unknown as { __testConfig?: { format: string } }).__testConfig?.format || 'org',
    'template': (globalThis as unknown as { __testConfig?: { template: string } }).__testConfig?.template || 'default',
    'dateFormat': (globalThis as unknown as { __testConfig?: { dateFormat: string } }).__testConfig?.dateFormat || 'YYYY-MM-DD',
    'autoTimestamp': (globalThis as unknown as { __testConfig?: { autoTimestamp: boolean } }).__testConfig?.autoTimestamp ?? true,
    'weekStartsOn': (globalThis as unknown as { __testConfig?: { weekStartsOn: string } }).__testConfig?.weekStartsOn || 'monday'
});

// Mock vscode module before importing JournalManager
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string) => getTestConfig()[key])
        })),
        createFileSystemWatcher: vi.fn(() => ({
            onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
            onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
            onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
            dispose: vi.fn()
        })),
        openTextDocument: vi.fn()
    },
    window: {
        showTextDocument: vi.fn(),
        showWarningMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        activeTextEditor: null
    },
    RelativePattern: class RelativePattern {
        constructor(public base: string, public pattern: string) {}
    },
    EventEmitter: class EventEmitter {
        event = vi.fn();
        fire = vi.fn();
        dispose = vi.fn();
    }
}));

// Helper to set test config
function setTestConfig(config: {
    directory?: string;
    format?: 'org' | 'markdown';
    template?: string;
    dateFormat?: string;
    autoTimestamp?: boolean;
    weekStartsOn?: 'sunday' | 'monday';
}) {
    (globalThis as unknown as { __testConfig: typeof config }).__testConfig = {
        directory: config.directory ?? '',
        format: config.format ?? 'org',
        template: config.template ?? 'default',
        dateFormat: config.dateFormat ?? 'YYYY-MM-DD',
        autoTimestamp: config.autoTimestamp ?? true,
        weekStartsOn: config.weekStartsOn ?? 'monday'
    };
}

// Import after mocking
import { JournalManager, JournalEntry, JournalConfig } from '../journalManager';

// Helper to create a mock extension context
function createMockContext(): { subscriptions: { push: Mock }[] } {
    return {
        subscriptions: []
    };
}

// =============================================================================
// Path Generation Tests
// =============================================================================

describe('JournalManager Path Generation', () => {
    let manager: JournalManager;
    let tempDir: string;
    let mockContext: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
        mockContext = createMockContext();

        // Update test configuration
        setTestConfig({
            directory: tempDir,
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
    });

    afterEach(() => {
        manager.dispose();
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('getEntryPath', () => {
        it('should generate correct path for a date', () => {
            const date = new Date(2024, 0, 15); // January 15, 2024
            const entryPath = manager.getEntryPath(date);

            expect(entryPath).toContain('2024');
            expect(entryPath).toContain('01');
            expect(entryPath).toContain('15');
            expect(entryPath).toContain('2024-01-15.org');
        });

        it('should use correct extension based on format', () => {
            const date = new Date(2024, 0, 15);
            const entryPath = manager.getEntryPath(date);

            expect(entryPath.endsWith('.org')).toBe(true);
        });

        it('should pad single digit months and days', () => {
            const date = new Date(2024, 2, 5); // March 5, 2024
            const entryPath = manager.getEntryPath(date);

            expect(entryPath).toContain('2024-03-05');
        });

        it('should create hierarchical path structure', () => {
            const date = new Date(2024, 11, 25); // December 25, 2024
            const entryPath = manager.getEntryPath(date);

            // Path should be: directory/2024/12/25/2024-12-25.org
            expect(entryPath).toContain(path.join('2024', '12', '25'));
        });
    });

    describe('getDateFromPath', () => {
        it('should extract date from valid path', () => {
            const date = manager.getDateFromPath('/path/to/2024-01-15.org');

            expect(date).not.toBeNull();
            expect(date!.getFullYear()).toBe(2024);
            expect(date!.getMonth()).toBe(0); // January
            expect(date!.getDate()).toBe(15);
        });

        it('should return null for invalid filename', () => {
            expect(manager.getDateFromPath('/path/to/notes.org')).toBeNull();
            expect(manager.getDateFromPath('/path/to/2024-1-5.org')).toBeNull();
        });

        it('should handle markdown extension', () => {
            const date = manager.getDateFromPath('/path/to/2024-06-20.md');

            expect(date).not.toBeNull();
            expect(date!.getFullYear()).toBe(2024);
            expect(date!.getMonth()).toBe(5); // June
            expect(date!.getDate()).toBe(20);
        });
    });

    describe('getExtension', () => {
        it('should return .org for org format', () => {
            expect(manager.getExtension()).toBe('.org');
        });
    });

    describe('isJournalFile', () => {
        it('should return true for files in journal directory', () => {
            const filePath = path.join(tempDir, '2024', '01', '15', '2024-01-15.org');
            expect(manager.isJournalFile(filePath)).toBe(true);
        });

        it('should return false for files outside journal directory', () => {
            expect(manager.isJournalFile('/other/path/file.org')).toBe(false);
        });
    });
});

// =============================================================================
// Template Tests
// =============================================================================

describe('JournalManager Templates', () => {
    let manager: JournalManager;
    let tempDir: string;
    let mockContext: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
        mockContext = createMockContext();

        setTestConfig({
            directory: tempDir,
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('getBuiltInTemplates', () => {
        it('should have default template', () => {
            const templates = manager.getBuiltInTemplates();
            expect(templates['default']).toBeDefined();
        });

        it('should have minimal template', () => {
            const templates = manager.getBuiltInTemplates();
            expect(templates['minimal']).toBeDefined();
        });

        it('should have research template', () => {
            const templates = manager.getBuiltInTemplates();
            expect(templates['research']).toBeDefined();
            expect(templates['research']).toContain('Goals for Today');
            expect(templates['research']).toContain('Experiments');
        });

        it('should have meeting template', () => {
            const templates = manager.getBuiltInTemplates();
            expect(templates['meeting']).toBeDefined();
            expect(templates['meeting']).toContain('Attendees');
            expect(templates['meeting']).toContain('Action Items');
        });

        it('should have standup template', () => {
            const templates = manager.getBuiltInTemplates();
            expect(templates['standup']).toBeDefined();
            expect(templates['standup']).toContain('Yesterday');
            expect(templates['standup']).toContain('Today');
            expect(templates['standup']).toContain('Blockers');
        });

        it('should contain date placeholders', () => {
            const templates = manager.getBuiltInTemplates();
            expect(templates['default']).toContain('{{date}}');
            expect(templates['default']).toContain('{{weekday}}');
        });
    });

    describe('getAvailableTemplates', () => {
        it('should return at least the built-in templates', () => {
            const templates = manager.getAvailableTemplates();
            expect(templates).toContain('default');
            expect(templates).toContain('minimal');
            expect(templates).toContain('research');
            expect(templates).toContain('meeting');
            expect(templates).toContain('standup');
        });

        it('should include custom templates from directory', () => {
            // Create custom template directory
            const customDir = path.join(tempDir, '.scimax', 'templates');
            fs.mkdirSync(customDir, { recursive: true });
            fs.writeFileSync(path.join(customDir, 'custom.org'), '# Custom Template');

            const templates = manager.getAvailableTemplates();
            expect(templates).toContain('custom');
        });

        it('should not have duplicates', () => {
            const templates = manager.getAvailableTemplates();
            const uniqueTemplates = [...new Set(templates)];
            expect(templates.length).toBe(uniqueTemplates.length);
        });
    });
});

// =============================================================================
// Entry Management Tests
// =============================================================================

describe('JournalManager Entry Management', () => {
    let manager: JournalManager;
    let tempDir: string;
    let mockContext: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
        mockContext = createMockContext();

        setTestConfig({
            directory: tempDir,
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('getEntry', () => {
        it('should return entry with correct date', () => {
            const date = new Date(2024, 0, 15);
            const entry = manager.getEntry(date);

            expect(entry.date).toEqual(date);
        });

        it('should indicate file does not exist for new entry', () => {
            const date = new Date(2024, 0, 15);
            const entry = manager.getEntry(date);

            expect(entry.exists).toBe(false);
        });

        it('should indicate file exists for created entry', async () => {
            const date = new Date(2024, 0, 15);
            await manager.createEntry(date);

            const entry = manager.getEntry(date);
            expect(entry.exists).toBe(true);
        });
    });

    describe('getTodayEntry', () => {
        it('should return entry for current date', () => {
            const entry = manager.getTodayEntry();
            const today = new Date();

            expect(entry.date.getFullYear()).toBe(today.getFullYear());
            expect(entry.date.getMonth()).toBe(today.getMonth());
            expect(entry.date.getDate()).toBe(today.getDate());
        });
    });

    describe('createEntry', () => {
        it('should create file with template content', async () => {
            const date = new Date(2024, 5, 15); // June 15, 2024
            await manager.createEntry(date);

            const entryPath = manager.getEntryPath(date);
            expect(fs.existsSync(entryPath)).toBe(true);

            const content = fs.readFileSync(entryPath, 'utf8');
            expect(content).toContain('2024-06-15');
            expect(content).toContain('Saturday'); // June 15, 2024 is a Saturday
        });

        it('should create directory structure', async () => {
            const date = new Date(2024, 11, 25);
            await manager.createEntry(date);

            const entryPath = manager.getEntryPath(date);
            expect(fs.existsSync(path.dirname(entryPath))).toBe(true);
        });

        it('should handle multiple entries', async () => {
            const date1 = new Date(2024, 0, 1);
            const date2 = new Date(2024, 0, 2);

            await manager.createEntry(date1);
            await manager.createEntry(date2);

            expect(fs.existsSync(manager.getEntryPath(date1))).toBe(true);
            expect(fs.existsSync(manager.getEntryPath(date2))).toBe(true);
        });
    });

    describe('getAllEntries', () => {
        it('should return empty array when no entries exist', () => {
            const entries = manager.getAllEntries();
            expect(entries).toEqual([]);
        });

        it('should return all created entries', async () => {
            await manager.createEntry(new Date(2024, 0, 1));
            await manager.createEntry(new Date(2024, 0, 2));
            await manager.createEntry(new Date(2024, 0, 3));

            manager.invalidateCache();
            const entries = manager.getAllEntries();
            expect(entries.length).toBe(3);
        });

        it('should sort entries by date ascending', async () => {
            await manager.createEntry(new Date(2024, 0, 3));
            await manager.createEntry(new Date(2024, 0, 1));
            await manager.createEntry(new Date(2024, 0, 2));

            manager.invalidateCache();
            const entries = manager.getAllEntries();
            expect(entries[0].date.getDate()).toBe(1);
            expect(entries[1].date.getDate()).toBe(2);
            expect(entries[2].date.getDate()).toBe(3);
        });

        it('should use cache on subsequent calls', async () => {
            await manager.createEntry(new Date(2024, 0, 1));

            manager.invalidateCache();
            const entries1 = manager.getAllEntries();
            const entries2 = manager.getAllEntries();

            expect(entries1).toBe(entries2); // Same reference from cache
        });
    });

    describe('getEntriesForMonth', () => {
        it('should return entries for specific month', async () => {
            await manager.createEntry(new Date(2024, 0, 15)); // January
            await manager.createEntry(new Date(2024, 1, 15)); // February
            await manager.createEntry(new Date(2024, 0, 20)); // January

            manager.invalidateCache();
            const entries = manager.getEntriesForMonth(2024, 0);
            expect(entries.length).toBe(2);
        });

        it('should return empty for month with no entries', async () => {
            await manager.createEntry(new Date(2024, 0, 15));

            manager.invalidateCache();
            const entries = manager.getEntriesForMonth(2024, 5);
            expect(entries.length).toBe(0);
        });
    });

    describe('getEntriesForYear', () => {
        it('should return entries for specific year', async () => {
            await manager.createEntry(new Date(2024, 0, 1));
            await manager.createEntry(new Date(2024, 6, 1));
            await manager.createEntry(new Date(2023, 6, 1));

            manager.invalidateCache();
            const entries = manager.getEntriesForYear(2024);
            expect(entries.length).toBe(2);
        });
    });

    describe('getEntriesForWeek', () => {
        it('should return entries for current week', async () => {
            // Create entries for this week (assuming week starts Monday)
            const today = new Date();
            await manager.createEntry(today);

            manager.invalidateCache();
            const entries = manager.getEntriesForWeek(today);
            expect(entries.length).toBeGreaterThanOrEqual(1);
        });
    });
});

// =============================================================================
// Statistics Tests
// =============================================================================

describe('JournalManager Statistics', () => {
    let manager: JournalManager;
    let tempDir: string;
    let mockContext: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
        mockContext = createMockContext();

        setTestConfig({
            directory: tempDir,
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('getEntryStats', () => {
        it('should count words correctly', async () => {
            const date = new Date(2024, 0, 1);
            await manager.createEntry(date);

            // Add some content
            const entryPath = manager.getEntryPath(date);
            fs.appendFileSync(entryPath, '\nHello world this is a test');

            const entry = manager.getEntry(date);
            const stats = manager.getEntryStats(entry);

            expect(stats.wordCount).toBeGreaterThan(0);
        });

        it('should count lines correctly', async () => {
            const date = new Date(2024, 0, 1);
            await manager.createEntry(date);

            const entry = manager.getEntry(date);
            const stats = manager.getEntryStats(entry);

            expect(stats.lineCount).toBeGreaterThan(0);
        });

        it('should count tasks', async () => {
            const date = new Date(2024, 0, 1);
            await manager.createEntry(date);

            const entryPath = manager.getEntryPath(date);
            // Default template already has 1 task, we add 2 more + 1 done
            fs.appendFileSync(entryPath, '\n- [ ] Task 1\n- [ ] Task 2\n- [X] Done task');

            const entry = manager.getEntry(date);
            const stats = manager.getEntryStats(entry);

            // Default template has 1 task ("- [ ]") + our 3 added = 4 total
            expect(stats.taskCount).toBe(4);
            expect(stats.doneCount).toBe(1);
        });

        it('should return zeros for non-existent entry', () => {
            const entry: JournalEntry = {
                date: new Date(2024, 0, 1),
                path: '/nonexistent/path.org',
                exists: false
            };

            const stats = manager.getEntryStats(entry);
            expect(stats.wordCount).toBe(0);
            expect(stats.lineCount).toBe(0);
            expect(stats.taskCount).toBe(0);
            expect(stats.doneCount).toBe(0);
        });
    });

    describe('getTotalStats', () => {
        it('should return correct entry count', async () => {
            await manager.createEntry(new Date(2024, 0, 1));
            await manager.createEntry(new Date(2024, 0, 2));

            manager.invalidateCache();
            const stats = manager.getTotalStats();
            expect(stats.entryCount).toBe(2);
        });

        it('should calculate total words', async () => {
            const date1 = new Date(2024, 0, 1);
            const date2 = new Date(2024, 0, 2);

            await manager.createEntry(date1);
            await manager.createEntry(date2);

            manager.invalidateCache();
            const stats = manager.getTotalStats();
            expect(stats.totalWords).toBeGreaterThan(0);
        });

        it('should calculate current streak', async () => {
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const twoDaysAgo = new Date(today);
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

            await manager.createEntry(today);
            await manager.createEntry(yesterday);
            await manager.createEntry(twoDaysAgo);

            manager.invalidateCache();
            const stats = manager.getTotalStats();
            expect(stats.streak).toBe(3);
        });

        it('should calculate longest streak', async () => {
            // Create 5 consecutive entries
            const baseDate = new Date(2024, 0, 1);
            for (let i = 0; i < 5; i++) {
                const date = new Date(baseDate);
                date.setDate(date.getDate() + i);
                await manager.createEntry(date);
            }

            manager.invalidateCache();
            const stats = manager.getTotalStats();
            expect(stats.longestStreak).toBe(5);
        });

        it('should break streak on gap', async () => {
            const today = new Date();
            const threeDaysAgo = new Date(today);
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

            await manager.createEntry(today);
            await manager.createEntry(threeDaysAgo);

            manager.invalidateCache();
            const stats = manager.getTotalStats();
            expect(stats.streak).toBe(1); // Only today counts
        });

        it('should use cache on subsequent calls', async () => {
            await manager.createEntry(new Date(2024, 0, 1));

            manager.invalidateCache();
            const stats1 = manager.getTotalStats();
            const stats2 = manager.getTotalStats();

            // Same reference indicates cache hit
            expect(stats1).toBe(stats2);
        });
    });
});

// =============================================================================
// Search Tests
// =============================================================================

describe('JournalManager Search', () => {
    let manager: JournalManager;
    let tempDir: string;
    let mockContext: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
        mockContext = createMockContext();

        setTestConfig({
            directory: tempDir,
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('searchEntries', () => {
        it('should find entries containing search term', async () => {
            const date = new Date(2024, 0, 1);
            await manager.createEntry(date);

            const entryPath = manager.getEntryPath(date);
            fs.appendFileSync(entryPath, '\nUnique search term here');

            manager.invalidateCache();
            const results = await manager.searchEntries('Unique search term');

            expect(results.length).toBe(1);
            expect(results[0].matches.length).toBeGreaterThan(0);
        });

        it('should be case insensitive', async () => {
            const date = new Date(2024, 0, 1);
            await manager.createEntry(date);

            const entryPath = manager.getEntryPath(date);
            fs.appendFileSync(entryPath, '\nHELLO WORLD');

            manager.invalidateCache();
            const results = await manager.searchEntries('hello world');

            expect(results.length).toBe(1);
        });

        it('should return line numbers', async () => {
            const date = new Date(2024, 0, 1);
            await manager.createEntry(date);

            const entryPath = manager.getEntryPath(date);
            fs.appendFileSync(entryPath, '\nFirst line\nSearchable content\nThird line');

            manager.invalidateCache();
            const results = await manager.searchEntries('Searchable');

            expect(results.length).toBe(1);
            expect(results[0].lineNumbers.length).toBeGreaterThan(0);
        });

        it('should respect limit option', async () => {
            for (let i = 0; i < 5; i++) {
                const date = new Date(2024, 0, i + 1);
                await manager.createEntry(date);
                const entryPath = manager.getEntryPath(date);
                fs.appendFileSync(entryPath, '\nCommon term');
            }

            manager.invalidateCache();
            const results = await manager.searchEntries('Common term', { limit: 2 });

            expect(results.length).toBe(2);
        });

        it('should filter by date range', async () => {
            await manager.createEntry(new Date(2024, 0, 1));
            await manager.createEntry(new Date(2024, 0, 15));
            await manager.createEntry(new Date(2024, 0, 30));

            // Add searchable content to all
            for (const date of [new Date(2024, 0, 1), new Date(2024, 0, 15), new Date(2024, 0, 30)]) {
                const entryPath = manager.getEntryPath(date);
                fs.appendFileSync(entryPath, '\nSearchable');
            }

            manager.invalidateCache();
            const results = await manager.searchEntries('Searchable', {
                startDate: new Date(2024, 0, 10),
                endDate: new Date(2024, 0, 20)
            });

            expect(results.length).toBe(1);
        });

        it('should return empty for no matches', async () => {
            const date = new Date(2024, 0, 1);
            await manager.createEntry(date);

            manager.invalidateCache();
            const results = await manager.searchEntries('nonexistent term xyz');

            expect(results.length).toBe(0);
        });
    });
});

// =============================================================================
// Configuration Tests
// =============================================================================

describe('JournalManager Configuration', () => {
    let tempDir: string;
    let mockContext: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
        mockContext = createMockContext();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should use default directory when none configured', () => {
        setTestConfig({
            directory: '',
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        const manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
        const config = manager.getConfig();

        expect(config.directory).toContain('scimax-journal');
        manager.dispose();
    });

    it('should expand ~ in directory path', () => {
        setTestConfig({
            directory: '~/my-journal',
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        const manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
        const config = manager.getConfig();

        expect(config.directory).not.toContain('~');
        expect(config.directory).toContain('my-journal');
        manager.dispose();
    });

    it('should return config copy', () => {
        setTestConfig({
            directory: tempDir,
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        const manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
        const config = manager.getConfig();

        // Modifying returned config should not affect internal config
        config.format = 'markdown';
        expect(manager.getConfig().format).toBe('org');
        manager.dispose();
    });
});

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('JournalManager Edge Cases', () => {
    let manager: JournalManager;
    let tempDir: string;
    let mockContext: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
        mockContext = createMockContext();

        setTestConfig({
            directory: tempDir,
            format: 'org',
            template: 'default',
            dateFormat: 'YYYY-MM-DD',
            autoTimestamp: true,
            weekStartsOn: 'monday'
        });

        manager = new JournalManager(mockContext as unknown as import('vscode').ExtensionContext);
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should handle leap year dates', async () => {
        const leapDate = new Date(2024, 1, 29); // February 29, 2024 (leap year)
        await manager.createEntry(leapDate);

        const entry = manager.getEntry(leapDate);
        expect(entry.exists).toBe(true);
    });

    it('should handle year boundary', async () => {
        const newYearsEve = new Date(2023, 11, 31);
        const newYearsDay = new Date(2024, 0, 1);

        await manager.createEntry(newYearsEve);
        await manager.createEntry(newYearsDay);

        manager.invalidateCache();
        const entries = manager.getAllEntries();
        expect(entries.length).toBe(2);
    });

    it('should skip hidden directories when scanning', async () => {
        // Create a hidden directory with journal-like files
        const hiddenDir = path.join(tempDir, '.hidden', '2024', '01', '01');
        fs.mkdirSync(hiddenDir, { recursive: true });
        fs.writeFileSync(path.join(hiddenDir, '2024-01-01.org'), 'hidden entry');

        // Create a regular entry
        await manager.createEntry(new Date(2024, 0, 2));

        manager.invalidateCache();
        const entries = manager.getAllEntries();
        expect(entries.length).toBe(1);
        expect(entries[0].date.getDate()).toBe(2);
    });

    it('should handle empty journal directory', () => {
        const entries = manager.getAllEntries();
        expect(entries).toEqual([]);
    });

    it('should invalidate cache properly', async () => {
        await manager.createEntry(new Date(2024, 0, 1));

        manager.invalidateCache();
        const entries1 = manager.getAllEntries();
        expect(entries1.length).toBe(1);

        // Create another entry
        await manager.createEntry(new Date(2024, 0, 2));

        // Without invalidating, cache should still show 1 entry
        // (depends on TTL, so we explicitly invalidate)
        manager.invalidateCache();
        const entries2 = manager.getAllEntries();
        expect(entries2.length).toBe(2);
    });
});
