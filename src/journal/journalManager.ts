import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
        this.ensureDirectoryExists();
    }

    private loadConfig(): JournalConfig {
        const vsConfig = vscode.workspace.getConfiguration('scimax.journal');
        let directory = vsConfig.get<string>('directory') || '';

        if (!directory) {
            directory = path.join(os.homedir(), 'scimax-journal');
        } else if (directory.startsWith('~')) {
            directory = path.join(os.homedir(), directory.slice(1));
        }

        return {
            directory,
            format: vsConfig.get<'markdown' | 'org'>('format') || 'markdown',
            template: vsConfig.get<string>('template') || 'default',
            dateFormat: vsConfig.get<string>('dateFormat') || 'YYYY-MM-DD',
            autoTimestamp: vsConfig.get<boolean>('autoTimestamp') ?? true,
            weekStartsOn: vsConfig.get<'sunday' | 'monday'>('weekStartsOn') || 'monday'
        };
    }

    public reloadConfig(): void {
        this.config = this.loadConfig();
        this.ensureDirectoryExists();
        this.templateCache.clear();
    }

    private ensureDirectoryExists(): void {
        if (!fs.existsSync(this.config.directory)) {
            fs.mkdirSync(this.config.directory, { recursive: true });
        }
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

        // Ensure directory exists
        if (!fs.existsSync(entryDir)) {
            fs.mkdirSync(entryDir, { recursive: true });
        }

        // Get template content
        const content = this.renderTemplate(date);

        // Write file
        fs.writeFileSync(entryPath, content, 'utf8');
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
     * Get the default template based on format
     */
    private getDefaultTemplate(): string {
        if (this.config.format === 'org') {
            return `#+TITLE: {{date}} - {{weekday}}
#+DATE: {{date}}

* Tasks
- [ ]

* Notes

* Log
`;
        }

        return `# {{date}} - {{weekday}}

## Tasks
- [ ]

## Notes

## Log
`;
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
     * Get all existing journal entries sorted by date
     */
    public getAllEntries(): JournalEntry[] {
        const entries: JournalEntry[] = [];

        if (!fs.existsSync(this.config.directory)) {
            return entries;
        }

        this.scanDirectory(this.config.directory, entries);

        // Sort by date (oldest first)
        entries.sort((a, b) => a.date.getTime() - b.date.getTime());

        return entries;
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
    public async searchEntries(query: string): Promise<{entry: JournalEntry, matches: string[]}[]> {
        const entries = this.getAllEntries();
        const results: {entry: JournalEntry, matches: string[]}[] = [];

        for (const entry of entries) {
            try {
                const content = fs.readFileSync(entry.path, 'utf8');
                const lines = content.split('\n');
                const matches: string[] = [];

                const queryLower = query.toLowerCase();
                for (const line of lines) {
                    if (line.toLowerCase().includes(queryLower)) {
                        matches.push(line.trim());
                    }
                }

                if (matches.length > 0) {
                    results.push({ entry, matches });
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }

        return results;
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
