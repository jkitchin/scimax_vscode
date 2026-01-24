import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { resolveScimaxPath } from '../utils/pathResolver';

// Use fs.promises for async operations
const fsp = fs.promises;

export interface JournalConfig {
    directory: string;
    format: 'markdown' | 'org';
    template: string;
    dateFormat: string;
    autoTimestamp: boolean;
    weekStartsOn: 'sunday' | 'monday';
}

export interface JournalEntry {
    date: Date;
    path: string;
    exists: boolean;
}

export class JournalManager {
    private config: JournalConfig;
    private context: vscode.ExtensionContext;
    private templateCache: Map<string, string> = new Map();

    // Entry cache for performance
    private entriesCache: JournalEntry[] | null = null;
    private cacheTimestamp: number = 0;
    private readonly CACHE_TTL = 30000; // 30 seconds cache TTL
    private cachePromise: Promise<JournalEntry[]> | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private _onDidChangeEntries = new vscode.EventEmitter<void>();
    public readonly onDidChangeEntries = this._onDidChangeEntries.event;

    // Cached stats for status bar
    private statsCache: { entryCount: number; totalWords: number; streak: number; longestStreak: number } | null = null;
    private statsCacheTimestamp: number = 0;
    private readonly STATS_CACHE_TTL = 60000; // 1 minute for stats

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
        this.ensureDirectoryExists();
        this.setupFileWatcher();
    }

    /**
     * Set up file watcher to invalidate cache when journal files change
     */
    private setupFileWatcher(): void {
        const pattern = new vscode.RelativePattern(
            this.config.directory,
            '**/*.{md,org}'
        );
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const invalidateCache = () => {
            this.invalidateCache();
            this._onDidChangeEntries.fire();
        };

        this.fileWatcher.onDidCreate(invalidateCache);
        this.fileWatcher.onDidDelete(invalidateCache);
        this.fileWatcher.onDidChange(invalidateCache);

        this.context.subscriptions.push(this.fileWatcher);
    }

    /**
     * Invalidate the entries cache
     */
    public invalidateCache(): void {
        this.entriesCache = null;
        this.cachePromise = null;
        this.statsCache = null;
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.fileWatcher?.dispose();
        this._onDidChangeEntries.dispose();
    }

    private loadConfig(): JournalConfig {
        const vsConfig = vscode.workspace.getConfiguration('scimax.journal');
        const directory = resolveScimaxPath('scimax.journal.directory', 'journal');

        return {
            directory,
            format: vsConfig.get<'markdown' | 'org'>('format') || 'org',
            template: vsConfig.get<string>('template') || 'default',
            dateFormat: vsConfig.get<string>('dateFormat') || 'YYYY-MM-DD',
            autoTimestamp: vsConfig.get<boolean>('autoTimestamp') ?? true,
            weekStartsOn: vsConfig.get<'sunday' | 'monday'>('weekStartsOn') || 'monday'
        };
    }

    public reloadConfig(): void {
        const oldDirectory = this.config.directory;
        this.config = this.loadConfig();
        this.ensureDirectoryExists();
        this.templateCache.clear();
        this.invalidateCache();

        // Recreate file watcher if directory changed
        if (oldDirectory !== this.config.directory) {
            this.fileWatcher?.dispose();
            this.setupFileWatcher();
        }
    }

    private ensureDirectoryExists(): void {
        // recursive: true handles non-existent directories, no need for existsSync check
        fs.mkdirSync(this.config.directory, { recursive: true });
    }

    public getConfig(): JournalConfig {
        return { ...this.config };
    }

    public getJournalDirectory(): string {
        return this.config.directory;
    }

    /**
     * Get the file extension based on format
     */
    public getExtension(): string {
        return this.config.format === 'org' ? '.org' : '.md';
    }

    /**
     * Get the path for a journal entry on a specific date
     */
    public getEntryPath(date: Date): string {
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const filename = `${year}-${month}-${day}${this.getExtension()}`;

        return path.join(
            this.config.directory,
            year,
            month,
            day,
            filename
        );
    }

    /**
     * Check if a file path is a journal file
     */
    public isJournalFile(filePath: string): boolean {
        const normalized = path.normalize(filePath);
        const journalDir = path.normalize(this.config.directory);
        return normalized.startsWith(journalDir);
    }

    /**
     * Extract date from a journal file path
     */
    public getDateFromPath(filePath: string): Date | null {
        const filename = path.basename(filePath, path.extname(filePath));
        const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (match) {
            const [, year, month, day] = match;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
        return null;
    }

    /**
     * Get the journal entry for today
     */
    public getTodayEntry(): JournalEntry {
        return this.getEntry(new Date());
    }

    /**
     * Get a journal entry for a specific date
     */
    public getEntry(date: Date): JournalEntry {
        const entryPath = this.getEntryPath(date);
        return {
            date,
            path: entryPath,
            exists: fs.existsSync(entryPath)
        };
    }

    /**
     * Open or create a journal entry
     */
    public async openEntry(date: Date): Promise<vscode.TextEditor> {
        const entry = this.getEntry(date);

        if (!entry.exists) {
            await this.createEntry(date);
        }

        const document = await vscode.workspace.openTextDocument(entry.path);
        return vscode.window.showTextDocument(document);
    }

    /**
     * Create a new journal entry from template
     */
    public async createEntry(date: Date): Promise<void> {
        const entryPath = this.getEntryPath(date);
        const entryDir = path.dirname(entryPath);

        // Ensure directory exists (recursive: true handles non-existent parents)
        await fsp.mkdir(entryDir, { recursive: true });

        // Get template content
        const content = this.renderTemplate(date);

        // Write file
        await fsp.writeFile(entryPath, content, 'utf8');
    }

    /**
     * Get template content
     */
    private getTemplate(): string {
        const templateName = this.config.template;

        // Check cache
        if (this.templateCache.has(templateName)) {
            return this.templateCache.get(templateName)!;
        }

        // Check for custom template in journal directory
        const customTemplatePath = path.join(
            this.config.directory,
            '.scimax',
            'templates',
            `${templateName}${this.getExtension()}`
        );

        if (fs.existsSync(customTemplatePath)) {
            const content = fs.readFileSync(customTemplatePath, 'utf8');
            this.templateCache.set(templateName, content);
            return content;
        }

        // Return default template
        const defaultTemplate = this.getDefaultTemplate();
        this.templateCache.set(templateName, defaultTemplate);
        return defaultTemplate;
    }

    /**
     * Get the default template based on format and template name
     */
    private getDefaultTemplate(): string {
        const templateName = this.config.template;

        // Built-in templates
        const templates = this.getBuiltInTemplates();
        if (templates[templateName]) {
            return templates[templateName];
        }

        // Fall back to 'default'
        return templates['default'];
    }

    /**
     * Get all built-in templates
     */
    public getBuiltInTemplates(): Record<string, string> {
        if (this.config.format === 'org') {
            return {
                'default': `#+TITLE: {{date}} - {{weekday}}
#+DATE: {{date}}

* Tasks
- [ ]

* Notes

* Log
`,
                'minimal': `#+TITLE: {{date}}
#+DATE: {{date}}

* Notes
`,
                'research': `#+TITLE: Research Log - {{date}}
#+DATE: {{date}}
#+AUTHOR: {{author}}

* Goals for Today
- [ ]

* Experiments

* Results

* Next Steps

* References
`,
                'meeting': `#+TITLE: Meeting Notes - {{date}}
#+DATE: {{date}}

* Attendees
-

* Agenda
1.

* Discussion

* Action Items
- [ ]

* Next Meeting
`,
                'standup': `#+TITLE: Standup - {{date}}
#+DATE: {{date}}

* Yesterday
-

* Today
-

* Blockers
-
`
            };
        }

        // Markdown templates
        return {
            'default': `# {{date}} - {{weekday}}

## Tasks
- [ ]

## Notes

## Log
`,
            'minimal': `# {{date}}

## Notes
`,
            'research': `# Research Log - {{date}}

## Goals for Today
- [ ]

## Experiments

## Results

## Next Steps

## References
`,
            'meeting': `# Meeting Notes - {{date}}

## Attendees
-

## Agenda
1.

## Discussion

## Action Items
- [ ]

## Next Meeting
`,
            'standup': `# Standup - {{date}}

## Yesterday
-

## Today
-

## Blockers
-
`
        };
    }

    /**
     * Get list of available template names
     */
    public getAvailableTemplates(): string[] {
        const builtIn = Object.keys(this.getBuiltInTemplates());

        // Check for custom templates
        const customDir = path.join(this.config.directory, '.scimax', 'templates');
        const custom: string[] = [];

        if (fs.existsSync(customDir)) {
            const files = fs.readdirSync(customDir);
            for (const file of files) {
                const ext = path.extname(file);
                if (ext === this.getExtension()) {
                    custom.push(path.basename(file, ext));
                }
            }
        }

        return [...new Set([...builtIn, ...custom])];
    }

    /**
     * Create entry with specific template
     */
    public async createEntryWithTemplate(date: Date, templateName: string): Promise<void> {
        const originalTemplate = this.config.template;
        this.config.template = templateName;
        this.templateCache.delete(templateName);

        try {
            await this.createEntry(date);
        } finally {
            this.config.template = originalTemplate;
        }
    }

    /**
     * Render template with date substitutions
     */
    private renderTemplate(date: Date): string {
        const template = this.getTemplate();

        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];

        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekday = weekdays[date.getDay()];
        const monthName = months[date.getMonth()];

        const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

        return template
            .replace(/\{\{date\}\}/g, dateStr)
            .replace(/\{\{year\}\}/g, year.toString())
            .replace(/\{\{month\}\}/g, month.toString().padStart(2, '0'))
            .replace(/\{\{day\}\}/g, day.toString().padStart(2, '0'))
            .replace(/\{\{weekday\}\}/g, weekday)
            .replace(/\{\{monthName\}\}/g, monthName)
            .replace(/\{\{timestamp\}\}/g, new Date().toISOString());
    }

    /**
     * Navigate to previous or next journal entry
     */
    public async navigateEntry(currentPath: string, direction: 'prev' | 'next'): Promise<void> {
        const currentDate = this.getDateFromPath(currentPath);
        if (!currentDate) {
            vscode.window.showWarningMessage('Current file is not a journal entry');
            return;
        }

        const entries = this.getAllEntries();
        const currentIndex = entries.findIndex(e =>
            e.date.getTime() === currentDate.getTime()
        );

        if (currentIndex === -1) {
            vscode.window.showWarningMessage('Could not find current entry in journal');
            return;
        }

        let targetIndex: number;
        if (direction === 'prev') {
            targetIndex = currentIndex - 1;
            if (targetIndex < 0) {
                vscode.window.showInformationMessage('No previous journal entry');
                return;
            }
        } else {
            targetIndex = currentIndex + 1;
            if (targetIndex >= entries.length) {
                vscode.window.showInformationMessage('No next journal entry');
                return;
            }
        }

        await this.openEntry(entries[targetIndex].date);
    }

    /**
     * Get all existing journal entries sorted by date (uses cache)
     */
    public getAllEntries(): JournalEntry[] {
        const now = Date.now();

        // Return cached entries if still valid
        if (this.entriesCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
            return this.entriesCache;
        }

        // Synchronous fallback - populate cache
        const entries: JournalEntry[] = [];

        if (!fs.existsSync(this.config.directory)) {
            this.entriesCache = entries;
            this.cacheTimestamp = now;
            return entries;
        }

        this.scanDirectory(this.config.directory, entries);

        // Sort by date (oldest first)
        entries.sort((a, b) => a.date.getTime() - b.date.getTime());

        this.entriesCache = entries;
        this.cacheTimestamp = now;
        return entries;
    }

    /**
     * Get all existing journal entries asynchronously (recommended for UI)
     * Uses cache and async scanning to avoid blocking
     */
    public async getAllEntriesAsync(): Promise<JournalEntry[]> {
        const now = Date.now();

        // Return cached entries if still valid
        if (this.entriesCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
            return this.entriesCache;
        }

        // If already scanning, wait for that promise
        if (this.cachePromise) {
            return this.cachePromise;
        }

        // Start async scan
        this.cachePromise = this.scanEntriesAsync();
        try {
            const entries = await this.cachePromise;
            this.entriesCache = entries;
            this.cacheTimestamp = Date.now();
            return entries;
        } finally {
            this.cachePromise = null;
        }
    }

    /**
     * Async directory scanning - yields to event loop periodically
     */
    private async scanEntriesAsync(): Promise<JournalEntry[]> {
        const entries: JournalEntry[] = [];

        if (!fs.existsSync(this.config.directory)) {
            return entries;
        }

        await this.scanDirectoryAsync(this.config.directory, entries);

        // Sort by date (oldest first)
        entries.sort((a, b) => a.date.getTime() - b.date.getTime());

        return entries;
    }

    /**
     * Async recursive directory scan with yielding
     */
    private async scanDirectoryAsync(dir: string, entries: JournalEntry[]): Promise<void> {
        let items: fs.Dirent[];
        try {
            items = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        // Yield to event loop every 50 items
        let count = 0;
        for (const item of items) {
            const fullPath = path.join(dir, item.name);

            if (item.isDirectory()) {
                // Skip hidden directories
                if (!item.name.startsWith('.')) {
                    await this.scanDirectoryAsync(fullPath, entries);
                }
            } else if (item.isFile()) {
                const ext = path.extname(item.name);
                if (ext === '.md' || ext === '.org') {
                    const date = this.getDateFromPath(fullPath);
                    if (date) {
                        entries.push({
                            date,
                            path: fullPath,
                            exists: true
                        });
                    }
                }
            }

            count++;
            if (count % 50 === 0) {
                // Yield to event loop
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    }

    /**
     * Recursively scan directory for journal entries
     */
    private scanDirectory(dir: string, entries: JournalEntry[]): void {
        const items = fs.readdirSync(dir, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(dir, item.name);

            if (item.isDirectory()) {
                // Skip hidden directories
                if (!item.name.startsWith('.')) {
                    this.scanDirectory(fullPath, entries);
                }
            } else if (item.isFile()) {
                const ext = path.extname(item.name);
                if (ext === '.md' || ext === '.org') {
                    const date = this.getDateFromPath(fullPath);
                    if (date) {
                        entries.push({
                            date,
                            path: fullPath,
                            exists: true
                        });
                    }
                }
            }
        }
    }

    /**
     * Get entries for a specific month
     */
    public getEntriesForMonth(year: number, month: number): JournalEntry[] {
        return this.getAllEntries().filter(entry =>
            entry.date.getFullYear() === year &&
            entry.date.getMonth() === month
        );
    }

    /**
     * Get entries for a specific year
     */
    public getEntriesForYear(year: number): JournalEntry[] {
        return this.getAllEntries().filter(entry =>
            entry.date.getFullYear() === year
        );
    }

    /**
     * Search journal entries for text
     */
    public async searchEntries(
        query: string,
        options?: {
            startDate?: Date;
            endDate?: Date;
            limit?: number;
        }
    ): Promise<{entry: JournalEntry, matches: string[], lineNumbers: number[]}[]> {
        let entries = await this.getAllEntriesAsync();

        // Apply date range filter
        if (options?.startDate) {
            const start = options.startDate.getTime();
            entries = entries.filter(e => e.date.getTime() >= start);
        }
        if (options?.endDate) {
            const end = options.endDate.getTime();
            entries = entries.filter(e => e.date.getTime() <= end);
        }

        const results: {entry: JournalEntry, matches: string[], lineNumbers: number[]}[] = [];

        for (const entry of entries) {
            try {
                const content = await fsp.readFile(entry.path, 'utf8');
                const lines = content.split('\n');
                const matches: string[] = [];
                const lineNumbers: number[] = [];

                const queryLower = query.toLowerCase();
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(queryLower)) {
                        matches.push(lines[i].trim());
                        lineNumbers.push(i + 1);
                    }
                }

                if (matches.length > 0) {
                    results.push({ entry, matches, lineNumbers });
                }

                if (options?.limit && results.length >= options.limit) {
                    break;
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }

        return results;
    }

    /**
     * Get entries for the current week
     */
    public getEntriesForWeek(date: Date = new Date()): JournalEntry[] {
        const startOfWeek = new Date(date);
        const dayOfWeek = startOfWeek.getDay();
        const mondayOffset = this.config.weekStartsOn === 'monday'
            ? (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)
            : -dayOfWeek;
        startOfWeek.setDate(startOfWeek.getDate() + mondayOffset);
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return this.getAllEntries().filter(entry =>
            entry.date >= startOfWeek && entry.date <= endOfWeek
        );
    }

    /**
     * Search entries within a date range
     */
    public async searchInDateRange(
        query: string,
        range: 'today' | 'week' | 'month' | 'year' | 'all'
    ): Promise<{entry: JournalEntry, matches: string[], lineNumbers: number[]}[]> {
        const now = new Date();
        let startDate: Date | undefined;
        let endDate: Date | undefined;

        switch (range) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                break;
            case 'week':
                const dayOfWeek = now.getDay();
                const mondayOffset = this.config.weekStartsOn === 'monday'
                    ? (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)
                    : -dayOfWeek;
                startDate = new Date(now);
                startDate.setDate(now.getDate() + mondayOffset);
                startDate.setHours(0, 0, 0, 0);
                endDate = now;
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = now;
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = now;
                break;
            case 'all':
                // No date filtering
                break;
        }

        return this.searchEntries(query, { startDate, endDate });
    }

    /**
     * Get entry statistics (async version - recommended for UI)
     */
    public async getEntryStatsAsync(entry: JournalEntry): Promise<{ wordCount: number; lineCount: number; taskCount: number; doneCount: number }> {
        try {
            const content = await fsp.readFile(entry.path, 'utf8');
            return this.computeContentStats(content);
        } catch {
            return { wordCount: 0, lineCount: 0, taskCount: 0, doneCount: 0 };
        }
    }

    /**
     * Get entry statistics (sync version)
     * @deprecated Use getEntryStatsAsync for better performance in async contexts
     */
    public getEntryStats(entry: JournalEntry): { wordCount: number; lineCount: number; taskCount: number; doneCount: number } {
        try {
            const content = fs.readFileSync(entry.path, 'utf8');
            return this.computeContentStats(content);
        } catch {
            return { wordCount: 0, lineCount: 0, taskCount: 0, doneCount: 0 };
        }
    }

    /**
     * Compute statistics from content string
     */
    private computeContentStats(content: string): { wordCount: number; lineCount: number; taskCount: number; doneCount: number } {
        const lines = content.split('\n');
        const words = content.split(/\s+/).filter(w => w.length > 0);

        // Count tasks
        const taskPattern = this.config.format === 'org'
            ? /^\s*-\s*\[\s*\]/
            : /^\s*-\s*\[\s*\]/;
        const donePattern = this.config.format === 'org'
            ? /^\s*-\s*\[X\]/i
            : /^\s*-\s*\[x\]/i;

        let taskCount = 0;
        let doneCount = 0;
        for (const line of lines) {
            if (taskPattern.test(line)) taskCount++;
            if (donePattern.test(line)) doneCount++;
        }

        return {
            wordCount: words.length,
            lineCount: lines.length,
            taskCount: taskCount + doneCount,
            doneCount
        };
    }

    /**
     * Get total journal statistics (async with caching - recommended for UI)
     */
    public async getTotalStatsAsync(): Promise<{ entryCount: number; totalWords: number; streak: number; longestStreak: number }> {
        const now = Date.now();

        // Return cached stats if still valid
        if (this.statsCache && (now - this.statsCacheTimestamp) < this.STATS_CACHE_TTL) {
            return this.statsCache;
        }

        const entries = await this.getAllEntriesAsync();
        const stats = this.computeStats(entries);
        this.statsCache = stats;
        this.statsCacheTimestamp = now;
        return stats;
    }

    /**
     * Get total journal statistics (synchronous, uses cache if available)
     */
    public getTotalStats(): { entryCount: number; totalWords: number; streak: number; longestStreak: number } {
        const now = Date.now();

        // Return cached stats if still valid
        if (this.statsCache && (now - this.statsCacheTimestamp) < this.STATS_CACHE_TTL) {
            return this.statsCache;
        }

        const entries = this.getAllEntries();
        const stats = this.computeStats(entries);
        this.statsCache = stats;
        this.statsCacheTimestamp = now;
        return stats;
    }

    /**
     * Get basic stats (entry count and streaks) without reading file contents.
     * This is much faster than getTotalStats() as it only uses entry dates.
     */
    public getBasicStats(entries?: JournalEntry[]): { entryCount: number; streak: number; longestStreak: number } {
        const allEntries = entries ?? this.getAllEntries();
        return this.computeStreaks(allEntries);
    }

    /**
     * Get basic stats asynchronously
     */
    public async getBasicStatsAsync(): Promise<{ entryCount: number; streak: number; longestStreak: number }> {
        const entries = await this.getAllEntriesAsync();
        return this.computeStreaks(entries);
    }

    /**
     * Compute streaks from entries without reading file contents
     */
    private computeStreaks(entries: JournalEntry[]): { entryCount: number; streak: number; longestStreak: number } {
        if (entries.length === 0) {
            return { entryCount: 0, streak: 0, longestStreak: 0 };
        }

        let currentStreak = 0;
        let longestStreak = 0;
        let tempStreak = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if there's an entry today or yesterday to start current streak
        const sortedEntries = [...entries].sort((a, b) => b.date.getTime() - a.date.getTime());

        const latestEntry = new Date(sortedEntries[0].date);
        latestEntry.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((today.getTime() - latestEntry.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays <= 1) {
            // Count consecutive days backwards
            let expectedDate = diffDays === 0 ? today : new Date(today.getTime() - 24 * 60 * 60 * 1000);

            for (const entry of sortedEntries) {
                const entryDate = new Date(entry.date);
                entryDate.setHours(0, 0, 0, 0);

                if (entryDate.getTime() === expectedDate.getTime()) {
                    currentStreak++;
                    expectedDate = new Date(expectedDate.getTime() - 24 * 60 * 60 * 1000);
                } else if (entryDate.getTime() < expectedDate.getTime()) {
                    break;
                }
            }
        }

        // Calculate longest streak
        const ascEntries = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
        for (let i = 0; i < ascEntries.length; i++) {
            if (i === 0) {
                tempStreak = 1;
            } else {
                const prevDate = new Date(ascEntries[i - 1].date);
                const currDate = new Date(ascEntries[i].date);
                prevDate.setHours(0, 0, 0, 0);
                currDate.setHours(0, 0, 0, 0);

                const diff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
                if (diff === 1) {
                    tempStreak++;
                } else {
                    longestStreak = Math.max(longestStreak, tempStreak);
                    tempStreak = 1;
                }
            }
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        return {
            entryCount: entries.length,
            streak: currentStreak,
            longestStreak
        };
    }

    /**
     * Compute statistics from entries
     */
    private computeStats(entries: JournalEntry[]): { entryCount: number; totalWords: number; streak: number; longestStreak: number } {
        let totalWords = 0;

        for (const entry of entries) {
            const stats = this.getEntryStats(entry);
            totalWords += stats.wordCount;
        }

        // Calculate streaks
        let currentStreak = 0;
        let longestStreak = 0;
        let tempStreak = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if there's an entry today or yesterday to start current streak
        const sortedEntries = [...entries].sort((a, b) => b.date.getTime() - a.date.getTime());

        if (sortedEntries.length > 0) {
            const latestEntry = sortedEntries[0].date;
            latestEntry.setHours(0, 0, 0, 0);
            const diffDays = Math.floor((today.getTime() - latestEntry.getTime()) / (1000 * 60 * 60 * 24));

            if (diffDays <= 1) {
                // Count consecutive days backwards
                let expectedDate = diffDays === 0 ? today : new Date(today.getTime() - 24 * 60 * 60 * 1000);

                for (const entry of sortedEntries) {
                    const entryDate = new Date(entry.date);
                    entryDate.setHours(0, 0, 0, 0);

                    if (entryDate.getTime() === expectedDate.getTime()) {
                        currentStreak++;
                        expectedDate = new Date(expectedDate.getTime() - 24 * 60 * 60 * 1000);
                    } else if (entryDate.getTime() < expectedDate.getTime()) {
                        break;
                    }
                }
            }
        }

        // Calculate longest streak
        const ascEntries = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
        for (let i = 0; i < ascEntries.length; i++) {
            if (i === 0) {
                tempStreak = 1;
            } else {
                const prevDate = new Date(ascEntries[i - 1].date);
                const currDate = new Date(ascEntries[i].date);
                prevDate.setHours(0, 0, 0, 0);
                currDate.setHours(0, 0, 0, 0);

                const diff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
                if (diff === 1) {
                    tempStreak++;
                } else {
                    longestStreak = Math.max(longestStreak, tempStreak);
                    tempStreak = 1;
                }
            }
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        return {
            entryCount: entries.length,
            totalWords,
            streak: currentStreak,
            longestStreak
        };
    }

    /**
     * Add a timestamped log entry to today's journal
     */
    public async addLogEntry(text: string): Promise<void> {
        const editor = await this.openEntry(new Date());
        const document = editor.document;
        const content = document.getText();

        // Find the Log section
        const logPattern = this.config.format === 'org'
            ? /^\* Log$/m
            : /^## Log$/m;

        const match = content.match(logPattern);

        if (match && match.index !== undefined) {
            // Find the end of the Log heading line
            const insertPosition = document.positionAt(match.index + match[0].length);

            // Create timestamp
            const now = new Date();
            const timestamp = now.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit'
            });

            const logLine = this.config.format === 'org'
                ? `\n- [${timestamp}] ${text}`
                : `\n- **${timestamp}** ${text}`;

            await editor.edit(editBuilder => {
                editBuilder.insert(insertPosition, logLine);
            });
        }
    }

    /**
     * Insert current timestamp at cursor
     */
    public insertTimestamp(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const now = new Date();
        const timestamp = this.config.format === 'org'
            ? `[${now.toISOString().slice(0, 16).replace('T', ' ')}]`
            : now.toISOString().slice(0, 16).replace('T', ' ');

        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, timestamp);
        });
    }
}
