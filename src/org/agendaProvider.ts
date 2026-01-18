/**
 * Native Org-mode Agenda Provider
 * Provides agenda views by scanning org files directly (no database required)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseOrg } from '../parser/orgParserUnified';
import {
    generateAgendaView,
    generateTodoList,
    formatAgendaItem,
    AgendaItem,
    AgendaView,
    AgendaGroup,
    AgendaViewConfig,
    TodoListView,
    DiarySexpEntry,
} from '../parser/orgAgenda';
import type { HeadlineElement, OrgDocumentNode, DiarySexpElement, OrgElement } from '../parser/orgElementTypes';
import {
    collectAllClockEntries,
    generateTimeReport,
    formatTimeReport,
    formatDuration,
} from '../parser/orgClocking';

// =============================================================================
// Types
// =============================================================================

export interface AgendaFile {
    path: string;
    // Note: document is NOT cached to avoid memory issues with large file sets
    // For operations needing the full AST (like clock reports), re-parse on demand
    headlines: HeadlineElement[];
    diarySexps: DiarySexpEntry[];
    mtime: number;
}

export interface AgendaConfig {
    /** Directories to scan for org files */
    agendaFiles: string[];
    /** Patterns to exclude */
    excludePatterns: string[];
    /** Default view span in days */
    defaultSpan: number;
    /** Show done items */
    showDone: boolean;
    /** Show habits */
    showHabits: boolean;
    /** TODO states to include */
    todoStates: string[];
    /** Done states */
    doneStates: string[];
    /** Maximum number of files to scan (0 = unlimited) */
    maxFiles: number;
    /** Batch size for lazy loading */
    batchSize: number;
    /** Delay between batches in ms (for rate limiting) */
    batchDelayMs: number;
}

// =============================================================================
// Agenda Manager
// =============================================================================

/**
 * Manages agenda file scanning and caching
 */
export class AgendaManager {
    private context: vscode.ExtensionContext;
    private fileCache: Map<string, AgendaFile> = new Map();
    private config: AgendaConfig;
    private outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];
    private refreshEmitter = new vscode.EventEmitter<void>();
    readonly onDidRefresh = this.refreshEmitter.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
        this.outputChannel = vscode.window.createOutputChannel('Org Agenda');

        // Watch for file changes
        this.setupFileWatcher();

        // Watch for config changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('scimax.agenda')) {
                    this.config = this.loadConfig();
                    this.refresh();
                }
            })
        );
    }

    private loadConfig(): AgendaConfig {
        const config = vscode.workspace.getConfiguration('scimax.agenda');
        return {
            agendaFiles: config.get<string[]>('files', []),
            excludePatterns: config.get<string[]>('excludePatterns', ['**/node_modules/**', '**/.git/**']),
            defaultSpan: config.get<number>('defaultSpan', 7),
            showDone: config.get<boolean>('showDone', false),
            showHabits: config.get<boolean>('showHabits', true),
            todoStates: config.get<string[]>('todoStates', ['TODO', 'NEXT', 'WAITING']),
            doneStates: config.get<string[]>('doneStates', ['DONE', 'CANCELLED']),
            maxFiles: config.get<number>('maxFiles', 50), // Reduced default to prevent OOM
            batchSize: config.get<number>('batchSize', 5),
            batchDelayMs: config.get<number>('batchDelayMs', 10),
        };
    }

    private setupFileWatcher(): void {
        // Watch for org file changes
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.org');

        watcher.onDidChange((uri) => {
            this.invalidateFile(uri.fsPath);
            this.refreshEmitter.fire();
        });

        watcher.onDidCreate((uri) => {
            this.refreshEmitter.fire();
        });

        watcher.onDidDelete((uri) => {
            this.fileCache.delete(uri.fsPath);
            this.refreshEmitter.fire();
        });

        this.disposables.push(watcher);
    }

    private invalidateFile(filePath: string): void {
        this.fileCache.delete(filePath);
    }

    // Cancellation support for long-running scans
    private currentScanCts: vscode.CancellationTokenSource | null = null;
    private scanInProgress: boolean = false;

    /**
     * Cancel any ongoing file scan
     */
    public cancelScan(): void {
        if (this.currentScanCts) {
            this.currentScanCts.cancel();
            this.currentScanCts.dispose();
            this.currentScanCts = null;
        }
        this.scanInProgress = false;
    }

    /**
     * Check if a scan is currently in progress
     */
    public isScanInProgress(): boolean {
        return this.scanInProgress;
    }

    /**
     * Delay helper for rate limiting
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Yield to event loop to prevent blocking
     */
    private yieldToEventLoop(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    /**
     * Async generator that lazily yields agenda files in batches
     * Supports cancellation and rate limiting
     */
    async *getAgendaFilesLazy(
        token?: vscode.CancellationToken
    ): AsyncGenerator<string[], void, unknown> {
        const allFiles: string[] = [];

        // Collect file paths first (this is fast - just file listing)
        for (const pattern of this.config.agendaFiles) {
            if (token?.isCancellationRequested) return;
            const expanded = await this.expandPattern(pattern);
            allFiles.push(...expanded);
        }

        // If no specific files configured, scan workspace
        if (allFiles.length === 0) {
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            for (const folder of workspaceFolders) {
                if (token?.isCancellationRequested) return;
                const orgFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*.org'),
                    `{${this.config.excludePatterns.join(',')}}`
                );
                allFiles.push(...orgFiles.map(uri => uri.fsPath));
            }
        }

        // Deduplicate
        const uniqueFiles = [...new Set(allFiles)];

        // Log what we're about to scan
        this.outputChannel.appendLine(`Agenda: Found ${uniqueFiles.length} org files to scan`);
        this.outputChannel.appendLine(`Agenda: Config: agendaFiles=${JSON.stringify(this.config.agendaFiles)}`);
        this.outputChannel.appendLine(`Agenda: Workspace folders: ${vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ') || 'none'}`);
        this.outputChannel.show(true); // Show output channel

        // Apply max files limit
        const maxFiles = this.config.maxFiles;
        const filesToProcess = maxFiles > 0 ? uniqueFiles.slice(0, maxFiles) : uniqueFiles;

        if (filesToProcess.length < uniqueFiles.length) {
            this.outputChannel.appendLine(
                `Agenda: Limited scan to ${maxFiles} files (${uniqueFiles.length} total found). ` +
                `Configure 'scimax.agenda.files' to specify directories or increase 'scimax.agenda.maxFiles'.`
            );
        }

        this.outputChannel.appendLine(`Agenda: Will process ${filesToProcess.length} files`);

        // Yield files in batches
        const batchSize = this.config.batchSize;
        for (let i = 0; i < filesToProcess.length; i += batchSize) {
            if (token?.isCancellationRequested) return;

            const batch = filesToProcess.slice(i, i + batchSize);
            yield batch;

            // Rate limiting: delay between batches and yield to event loop
            if (i + batchSize < filesToProcess.length) {
                if (this.config.batchDelayMs > 0) {
                    await this.delay(this.config.batchDelayMs);
                }
                await this.yieldToEventLoop();
            }
        }
    }

    /**
     * Get all org files to scan
     */
    async getAgendaFiles(): Promise<string[]> {
        const files: string[] = [];

        // Add configured agenda files
        for (const pattern of this.config.agendaFiles) {
            const expanded = await this.expandPattern(pattern);
            files.push(...expanded);
        }

        // If no specific files configured, scan workspace
        if (files.length === 0) {
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            for (const folder of workspaceFolders) {
                const orgFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*.org'),
                    `{${this.config.excludePatterns.join(',')}}`
                );
                files.push(...orgFiles.map(uri => uri.fsPath));
            }
        }

        return [...new Set(files)]; // Deduplicate
    }

    private async expandPattern(pattern: string): Promise<string[]> {
        // Handle ~ for home directory
        if (pattern.startsWith('~')) {
            pattern = pattern.replace(/^~/, process.env.HOME || '');
        }

        // If it's a directory, find all org files in it
        try {
            const stat = fs.statSync(pattern);
            if (stat.isDirectory()) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(pattern, '**/*.org'),
                    `{${this.config.excludePatterns.join(',')}}`
                );
                return files.map(uri => uri.fsPath);
            } else if (stat.isFile() && pattern.endsWith('.org')) {
                return [pattern];
            }
        } catch {
            // Pattern might be a glob
            const files = await vscode.workspace.findFiles(pattern);
            return files.filter(uri => uri.fsPath.endsWith('.org')).map(uri => uri.fsPath);
        }

        return [];
    }

    /**
     * Parse an org file and cache the result (async for better responsiveness)
     */
    async parseFile(filePath: string): Promise<AgendaFile | null> {
        const basename = path.basename(filePath);
        const startTime = Date.now();
        try {
            const stat = await fs.promises.stat(filePath);
            const sizeKB = Math.round(stat.size / 1024);

            const cached = this.fileCache.get(filePath);

            // Return cached if not modified
            if (cached && cached.mtime === stat.mtimeMs) {
                this.outputChannel.appendLine(`  ${basename} (${sizeKB}KB): cached`);
                return cached;
            }

            // Skip very large files (> 100KB) to prevent OOM
            if (stat.size > 100 * 1024) {
                this.outputChannel.appendLine(`  ${basename}: skipping (${sizeKB}KB > 100KB)`);
                return null;
            }

            this.outputChannel.appendLine(`  ${basename} (${sizeKB}KB): reading...`);
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const readTime = Date.now();
            this.outputChannel.appendLine(`  ${basename}: read ${readTime - startTime}ms, parsing...`);

            const document = parseOrg(content, {
                parseInlineObjects: false,
                addPositions: false,
            });
            const parseTime = Date.now();
            this.outputChannel.appendLine(`  ${basename}: parsed ${parseTime - readTime}ms, extracting...`);

            const headlines = this.extractHeadlines(document);
            const diarySexps = this.extractDiarySexps(document, filePath, content);
            const extractTime = Date.now();

            const agendaFile: AgendaFile = {
                path: filePath,
                headlines,
                diarySexps,
                mtime: stat.mtimeMs,
            };

            this.fileCache.set(filePath, agendaFile);

            this.outputChannel.appendLine(
                `  ${basename}: done (read=${readTime - startTime}ms, parse=${parseTime - readTime}ms, extract=${extractTime - parseTime}ms, headlines=${headlines.length})`
            );

            return agendaFile;
        } catch (error) {
            this.outputChannel.appendLine(`  ${basename}: ERROR ${error}`);
            return null;
        }
    }

    private extractHeadlines(doc: OrgDocumentNode): HeadlineElement[] {
        const headlines: HeadlineElement[] = [];

        for (const child of doc.children) {
            if (child.type === 'headline') {
                // Strip section content to save memory - agenda only needs metadata
                const stripped = this.stripHeadlineSection(child as HeadlineElement);
                headlines.push(stripped);
            }
        }

        return headlines;
    }

    /**
     * Create a lightweight copy of headline with only agenda-relevant fields
     * This avoids copying the entire AST structure which can be very large
     * IMPORTANT: We must deep-copy nested objects to avoid keeping AST references alive
     */
    private stripHeadlineSection(headline: HeadlineElement): HeadlineElement {
        // Deep copy planning to avoid AST references
        let planning: any = undefined;
        if (headline.planning) {
            planning = {
                type: 'planning',
                range: headline.planning.range,
                postBlank: headline.planning.postBlank,
                properties: {
                    scheduled: headline.planning.properties.scheduled ? { ...headline.planning.properties.scheduled } : undefined,
                    deadline: headline.planning.properties.deadline ? { ...headline.planning.properties.deadline } : undefined,
                    closed: headline.planning.properties.closed ? { ...headline.planning.properties.closed } : undefined,
                }
            };
        }

        // Deep copy properties drawer (it's just key-value pairs)
        const propertiesDrawer = headline.propertiesDrawer ? { ...headline.propertiesDrawer } : undefined;

        return {
            type: 'headline',
            range: headline.range,
            postBlank: headline.postBlank,
            properties: {
                level: headline.properties.level,
                rawValue: headline.properties.rawValue,
                todoKeyword: headline.properties.todoKeyword,
                todoType: headline.properties.todoType,
                priority: headline.properties.priority,
                tags: [...headline.properties.tags], // Copy array
                archivedp: headline.properties.archivedp,
                commentedp: headline.properties.commentedp,
                footnoteSection: headline.properties.footnoteSection,
                customId: headline.properties.customId,
                id: headline.properties.id,
                category: headline.properties.category,
                effort: headline.properties.effort,
                lineNumber: headline.properties.lineNumber,
            },
            planning,
            propertiesDrawer,
            // No section - that's the heavy part we want to exclude
            children: headline.children.map(child => this.stripHeadlineSection(child)),
        };
    }

    /**
     * Extract diary sexp entries from a document
     * @param doc The parsed org document
     * @param filePath Path to the file (for metadata)
     * @param content File content (passed to avoid re-reading)
     */
    private extractDiarySexps(doc: OrgDocumentNode, filePath: string, content: string): DiarySexpEntry[] {
        const entries: DiarySexpEntry[] = [];
        const lines = content.split('\n');

        // Helper to extract diary sexps from an element's children
        const extractFromElements = (elements: OrgElement[], category?: string) => {
            for (const element of elements) {
                if (element.type === 'diary-sexp') {
                    const diarySexp = element as DiarySexpElement;
                    // Find line number from the element's range
                    let lineNumber = 1;
                    let charCount = 0;
                    for (let i = 0; i < lines.length; i++) {
                        if (charCount >= element.range.start) {
                            lineNumber = i + 1;
                            break;
                        }
                        charCount += lines[i].length + 1; // +1 for newline
                    }

                    // Get the title from the next line or use sexp as title
                    const title = this.getDiarySexpTitle(lines, lineNumber - 1);

                    entries.push({
                        sexp: diarySexp.properties.value,
                        title: title,
                        file: filePath,
                        line: lineNumber,
                        category: category || path.basename(filePath, '.org'),
                    });
                }
            }
        };

        // Check the document's top-level section
        if (doc.section) {
            extractFromElements(doc.section.children);
        }

        // Check headlines recursively
        const processHeadline = (headline: HeadlineElement) => {
            const category = headline.propertiesDrawer?.CATEGORY ||
                           path.basename(filePath, '.org');

            // Check headline's section
            if (headline.section) {
                extractFromElements(headline.section.children, category);
            }

            // Process children headlines
            for (const child of headline.children) {
                processHeadline(child);
            }
        };

        for (const child of doc.children) {
            if (child.type === 'headline') {
                processHeadline(child as HeadlineElement);
            }
        }

        return entries;
    }

    /**
     * Get a title for a diary sexp entry from surrounding context
     */
    private getDiarySexpTitle(lines: string[], lineIndex: number): string {
        // Try to find a meaningful title from surrounding lines
        // Check current line for any text after the sexp
        const currentLine = lines[lineIndex] || '';
        const afterSexp = currentLine.replace(/^%%\([^)]+\)\s*/, '').trim();
        if (afterSexp) {
            return afterSexp;
        }

        // Check previous line for a headline or descriptive text
        if (lineIndex > 0) {
            const prevLine = lines[lineIndex - 1].trim();
            if (prevLine.startsWith('*')) {
                // It's a headline, extract the text
                return prevLine.replace(/^\*+\s*(?:TODO|DONE|NEXT|WAITING)?\s*(?:\[#[ABC]\])?\s*/, '')
                    .replace(/\s*:[^:]+:\s*$/, '') // Remove tags
                    .trim();
            }
        }

        // Default to a generic title based on the sexp type
        const match = currentLine.match(/%%\((\w+-\w+)/);
        if (match) {
            return `Diary: ${match[1]}`;
        }

        return 'Diary entry';
    }

    /**
     * Generate agenda view with lazy loading and rate limiting
     */
    async getAgendaView(config?: Partial<AgendaViewConfig>): Promise<AgendaView> {
        // Cancel any previous scan
        this.cancelScan();

        // Create new cancellation token
        this.currentScanCts = new vscode.CancellationTokenSource();
        const token = this.currentScanCts.token;
        this.scanInProgress = true;

        const allHeadlines: HeadlineElement[] = [];
        const allDiarySexps: DiarySexpEntry[] = [];
        const fileMap = new Map<string, string>();
        let filesProcessed = 0;

        try {
            // Use lazy generator for rate-limited file processing
            for await (const batch of this.getAgendaFilesLazy(token)) {
                if (token.isCancellationRequested) {
                    this.outputChannel.appendLine('Agenda scan cancelled');
                    break;
                }

                // Process each file in the batch
                this.outputChannel.appendLine(`Processing batch of ${batch.length} files...`);
                for (let i = 0; i < batch.length; i++) {
                    const filePath = batch[i];
                    if (token.isCancellationRequested) break;

                    this.outputChannel.appendLine(`Starting file ${i + 1}/${batch.length}: ${filePath}`);
                    const agendaFile = await this.parseFile(filePath);
                    if (agendaFile) {
                        this.outputChannel.appendLine(`  - Collecting ${agendaFile.headlines.length} headlines...`);
                        for (const headline of agendaFile.headlines) {
                            this.collectHeadlinesWithFile(headline, filePath, allHeadlines, fileMap);
                        }
                        this.outputChannel.appendLine(`  - Total headlines so far: ${allHeadlines.length}`);
                        // Collect diary sexps
                        allDiarySexps.push(...agendaFile.diarySexps);
                    }
                    filesProcessed++;
                    this.outputChannel.appendLine(`  - File ${filesProcessed} complete`);
                }
                this.outputChannel.appendLine(`Batch complete. Total: ${filesProcessed} files, ${allHeadlines.length} headlines`);

                // Log progress for large scans
                if (filesProcessed % 50 === 0) {
                    this.outputChannel.appendLine(`Agenda: Processed ${filesProcessed} files...`);
                }
            }

            this.outputChannel.appendLine(`Agenda: Scan complete. Processed ${filesProcessed} files, found ${allHeadlines.length} headlines, ${allDiarySexps.length} diary sexps.`);
        } finally {
            this.scanInProgress = false;
        }

        return generateAgendaView(allHeadlines, fileMap, {
            showDone: this.config.showDone,
            showHabits: this.config.showHabits,
            days: this.config.defaultSpan,
            ...config,
        }, allDiarySexps);
    }

    private collectHeadlinesWithFile(
        headline: HeadlineElement,
        filePath: string,
        headlines: HeadlineElement[],
        fileMap: Map<string, string>
    ): void {
        headlines.push(headline);
        fileMap.set(`${headline.properties.lineNumber}:${headline.properties.rawValue}`, filePath);

        for (const child of headline.children) {
            this.collectHeadlinesWithFile(child, filePath, headlines, fileMap);
        }
    }

    /**
     * Generate TODO list with lazy loading and rate limiting
     */
    async getTodoList(options?: {
        states?: string[];
        excludeDone?: boolean;
        tags?: string[];
    }): Promise<TodoListView> {
        // Cancel any previous scan
        this.cancelScan();

        // Create new cancellation token
        this.currentScanCts = new vscode.CancellationTokenSource();
        const token = this.currentScanCts.token;
        this.scanInProgress = true;

        const allHeadlines: HeadlineElement[] = [];
        const fileMap = new Map<string, string>();
        let filesProcessed = 0;

        try {
            // Use lazy generator for rate-limited file processing
            for await (const batch of this.getAgendaFilesLazy(token)) {
                if (token.isCancellationRequested) {
                    this.outputChannel.appendLine('TODO list scan cancelled');
                    break;
                }

                // Process each file in the batch
                for (const filePath of batch) {
                    if (token.isCancellationRequested) break;

                    const agendaFile = await this.parseFile(filePath);
                    if (agendaFile) {
                        for (const headline of agendaFile.headlines) {
                            this.collectHeadlinesWithFile(headline, filePath, allHeadlines, fileMap);
                        }
                    }
                    filesProcessed++;
                }
            }

            this.outputChannel.appendLine(`TODO list: Scan complete. Processed ${filesProcessed} files.`);
        } finally {
            this.scanInProgress = false;
        }

        return generateTodoList(allHeadlines, fileMap, {
            excludeDone: options?.excludeDone ?? true,
            ...options,
        });
    }

    /**
     * Refresh agenda (clear cache and re-scan)
     */
    async refresh(): Promise<void> {
        this.fileCache.clear();
        this.refreshEmitter.fire();
    }

    /**
     * Get the file cache for external access (e.g., clock reports)
     */
    getFileCache(): Map<string, AgendaFile> {
        return this.fileCache;
    }

    dispose(): void {
        // Cancel any ongoing scan
        this.cancelScan();

        for (const d of this.disposables) {
            d.dispose();
        }
        this.outputChannel.dispose();
        this.refreshEmitter.dispose();
    }
}

// =============================================================================
// Tree View Provider
// =============================================================================

type AgendaTreeItem = AgendaGroupItem | AgendaItemNode;

class AgendaGroupItem extends vscode.TreeItem {
    constructor(
        public readonly group: AgendaGroup,
        public readonly viewType: 'agenda' | 'todo'
    ) {
        super(group.label, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${group.items.length} items`;
        this.contextValue = 'agendaGroup';
        this.iconPath = new vscode.ThemeIcon(
            viewType === 'agenda' ? 'calendar' : 'tasklist'
        );
    }
}

class AgendaItemNode extends vscode.TreeItem {
    constructor(public readonly item: AgendaItem) {
        super(item.title, vscode.TreeItemCollapsibleState.None);

        // Build description
        const descParts: string[] = [];
        if (item.todoState) {
            descParts.push(item.todoState);
        }
        if (item.priority) {
            descParts.push(`[#${item.priority}]`);
        }
        if (item.time) {
            descParts.push(item.time);
        }
        if (item.agendaType === 'diary' && item.daysUntil !== undefined) {
            // For diary entries, daysUntil represents years for anniversaries
            if (item.daysUntil > 0) {
                descParts.push(`(${item.daysUntil} years)`);
            }
        } else if (item.daysUntil !== undefined) {
            if (item.daysUntil < 0) {
                descParts.push(`${Math.abs(item.daysUntil)}d overdue`);
            } else if (item.daysUntil === 0) {
                descParts.push('Today');
            } else {
                descParts.push(`in ${item.daysUntil}d`);
            }
        }
        this.description = descParts.join(' ');

        // Tooltip
        const tooltipParts = [item.title];
        if (item.category) tooltipParts.push(`Category: ${item.category}`);
        if (item.tags.length) tooltipParts.push(`Tags: ${item.tags.join(', ')}`);
        tooltipParts.push(`File: ${path.basename(item.file)}:${item.line}`);
        this.tooltip = tooltipParts.join('\n');

        // Icon based on type/state
        if (item.overdue) {
            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
        } else if (item.agendaType === 'deadline') {
            this.iconPath = new vscode.ThemeIcon('clock');
        } else if (item.agendaType === 'scheduled') {
            this.iconPath = new vscode.ThemeIcon('calendar');
        } else if (item.agendaType === 'diary') {
            this.iconPath = new vscode.ThemeIcon('star');
        } else if (item.todoState === 'DONE') {
            this.iconPath = new vscode.ThemeIcon('check');
        } else if (item.todoState === 'TODO') {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        } else if (item.todoState === 'NEXT') {
            this.iconPath = new vscode.ThemeIcon('arrow-right');
        } else if (item.todoState === 'WAITING') {
            this.iconPath = new vscode.ThemeIcon('watch');
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-filled');
        }

        // Command to jump to item
        this.command = {
            command: 'scimax.agenda.gotoItem',
            title: 'Go to Item',
            arguments: [item],
        };

        this.contextValue = 'agendaItem';
    }
}

export class AgendaTreeProvider implements vscode.TreeDataProvider<AgendaTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgendaTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private agendaView: AgendaView | null = null;
    private todoList: TodoListView | null = null;
    private viewMode: 'agenda' | 'todo' = 'agenda';
    private groupBy: 'date' | 'category' | 'priority' | 'todo' = 'date';
    private refreshInProgress: Promise<void> | null = null;

    constructor(private manager: AgendaManager) {
        manager.onDidRefresh(() => this.refresh());
    }

    setViewMode(mode: 'agenda' | 'todo'): void {
        this.viewMode = mode;
        this.refresh();
    }

    setGroupBy(groupBy: 'date' | 'category' | 'priority' | 'todo'): void {
        this.groupBy = groupBy;
        this.refresh();
    }

    async refresh(): Promise<void> {
        // Prevent duplicate concurrent refreshes - return existing promise if in progress
        if (this.refreshInProgress) {
            return this.refreshInProgress;
        }

        this.refreshInProgress = this.doRefresh();
        try {
            await this.refreshInProgress;
        } finally {
            this.refreshInProgress = null;
        }
    }

    private async doRefresh(): Promise<void> {
        if (this.viewMode === 'agenda') {
            this.agendaView = await this.manager.getAgendaView({ groupBy: this.groupBy });
        } else {
            this.todoList = await this.manager.getTodoList({ excludeDone: true });
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: AgendaTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AgendaTreeItem): Promise<AgendaTreeItem[]> {
        if (!element) {
            // If a refresh is in progress, wait for it to complete
            if (this.refreshInProgress) {
                await this.refreshInProgress;
            }

            // Root level - return groups
            if (this.viewMode === 'agenda') {
                if (!this.agendaView) {
                    // No data yet - trigger a refresh and wait for it
                    await this.refresh();
                }
                if (!this.agendaView) {
                    return []; // Still no data after refresh (scan may have been cancelled)
                }
                return this.agendaView.groups
                    .filter(g => g.items.length > 0)
                    .map(g => new AgendaGroupItem(g, 'agenda'));
            } else {
                if (!this.todoList) {
                    // No data yet - trigger a refresh and wait for it
                    await this.refresh();
                }
                if (!this.todoList) {
                    return []; // Still no data after refresh
                }
                // Convert TODO list to groups
                const groups: AgendaGroup[] = [];
                for (const [state, items] of this.todoList.byState) {
                    if (items.length > 0) {
                        groups.push({ label: state, key: state, items });
                    }
                }
                return groups.map(g => new AgendaGroupItem(g, 'todo'));
            }
        }

        if (element instanceof AgendaGroupItem) {
            return element.group.items.map(item => new AgendaItemNode(item));
        }

        return [];
    }
}

// =============================================================================
// Commands
// =============================================================================

export function registerAgendaCommands(context: vscode.ExtensionContext): void {
    const manager = new AgendaManager(context);
    const treeProvider = new AgendaTreeProvider(manager);

    // Register tree view
    const treeView = vscode.window.createTreeView('scimax.agenda', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    context.subscriptions.push(treeView);
    context.subscriptions.push({ dispose: () => manager.dispose() });

    // Lazy load: only parse agenda files when the view becomes visible
    // This prevents blocking extension activation
    let initialized = false;
    context.subscriptions.push(
        treeView.onDidChangeVisibility(e => {
            if (e.visible && !initialized) {
                initialized = true;
                treeProvider.refresh();
            }
        })
    );

    // Commands
    context.subscriptions.push(
        // Refresh
        vscode.commands.registerCommand('scimax.agenda.refresh', () => {
            manager.refresh();
        }),

        // Cancel ongoing scan
        vscode.commands.registerCommand('scimax.agenda.cancelScan', () => {
            if (manager.isScanInProgress()) {
                manager.cancelScan();
                vscode.window.showInformationMessage('Agenda scan cancelled');
            } else {
                vscode.window.showInformationMessage('No agenda scan in progress');
            }
        }),

        // View modes
        vscode.commands.registerCommand('scimax.agenda.showAgenda', () => {
            treeProvider.setViewMode('agenda');
        }),

        vscode.commands.registerCommand('scimax.agenda.showTodos', () => {
            treeProvider.setViewMode('todo');
        }),

        // Group by
        vscode.commands.registerCommand('scimax.agenda.groupByDate', () => {
            treeProvider.setGroupBy('date');
        }),

        vscode.commands.registerCommand('scimax.agenda.groupByCategory', () => {
            treeProvider.setGroupBy('category');
        }),

        vscode.commands.registerCommand('scimax.agenda.groupByPriority', () => {
            treeProvider.setGroupBy('priority');
        }),

        // Go to item
        vscode.commands.registerCommand('scimax.agenda.gotoItem', async (item: AgendaItem) => {
            try {
                const doc = await vscode.workspace.openTextDocument(item.file);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(item.line - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Could not open file: ${item.file}`);
            }
        }),

        // Day agenda
        vscode.commands.registerCommand('scimax.agenda.day', async () => {
            const items = await showAgendaQuickPick(manager, { type: 'day', days: 1 });
            if (items) await jumpToAgendaItem(items);
        }),

        // Week agenda
        vscode.commands.registerCommand('scimax.agenda.week', async () => {
            const items = await showAgendaQuickPick(manager, { type: 'week', days: 7 });
            if (items) await jumpToAgendaItem(items);
        }),

        // Fortnight agenda
        vscode.commands.registerCommand('scimax.agenda.fortnight', async () => {
            const items = await showAgendaQuickPick(manager, { type: 'fortnight', days: 14 });
            if (items) await jumpToAgendaItem(items);
        }),

        // Month agenda
        vscode.commands.registerCommand('scimax.agenda.month', async () => {
            const items = await showAgendaQuickPick(manager, { type: 'month', days: 30 });
            if (items) await jumpToAgendaItem(items);
        }),

        // TODO list
        vscode.commands.registerCommand('scimax.agenda.todoList', async () => {
            const todoList = await manager.getTodoList({ excludeDone: true });
            const items: vscode.QuickPickItem[] = [];

            for (const [state, stateItems] of todoList.byState) {
                items.push({
                    label: `$(tasklist) ${state}`,
                    kind: vscode.QuickPickItemKind.Separator,
                });

                for (const item of stateItems) {
                    items.push({
                        label: item.title,
                        description: formatItemDescription(item),
                        detail: `${path.basename(item.file)}:${item.line}`,
                        // @ts-ignore - storing extra data
                        agendaItem: item,
                    });
                }
            }

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `TODO items (${todoList.counts.total} total)`,
                matchOnDescription: true,
                matchOnDetail: true,
            });

            if (selected && (selected as any).agendaItem) {
                await jumpToAgendaItem((selected as any).agendaItem);
            }
        }),

        // Deadlines
        vscode.commands.registerCommand('scimax.agenda.deadlines', async () => {
            const view = await manager.getAgendaView({ days: 14 });
            const deadlines = view.groups
                .flatMap(g => g.items)
                .filter(item => item.agendaType === 'deadline')
                .sort((a, b) => (a.daysUntil || 0) - (b.daysUntil || 0));

            const items: vscode.QuickPickItem[] = deadlines.map(item => ({
                label: `${item.overdue ? '$(warning)' : '$(clock)'} ${item.title}`,
                description: formatItemDescription(item),
                detail: `${path.basename(item.file)}:${item.line}`,
                // @ts-ignore
                agendaItem: item,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Upcoming deadlines (${deadlines.length})`,
                matchOnDescription: true,
            });

            if (selected && (selected as any).agendaItem) {
                await jumpToAgendaItem((selected as any).agendaItem);
            }
        }),

        // Scheduled items
        vscode.commands.registerCommand('scimax.agenda.scheduled', async () => {
            const view = await manager.getAgendaView({ days: 14 });
            const scheduled = view.groups
                .flatMap(g => g.items)
                .filter(item => item.agendaType === 'scheduled')
                .sort((a, b) => (a.daysUntil || 0) - (b.daysUntil || 0));

            const items: vscode.QuickPickItem[] = scheduled.map(item => ({
                label: `$(calendar) ${item.title}`,
                description: formatItemDescription(item),
                detail: `${path.basename(item.file)}:${item.line}`,
                // @ts-ignore
                agendaItem: item,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Scheduled items (${scheduled.length})`,
                matchOnDescription: true,
            });

            if (selected && (selected as any).agendaItem) {
                await jumpToAgendaItem((selected as any).agendaItem);
            }
        }),

        // Filter by tag
        vscode.commands.registerCommand('scimax.agenda.filterByTag', async () => {
            // First, collect all tags
            const todoList = await manager.getTodoList();
            const allTags = new Set<string>();
            for (const items of todoList.byState.values()) {
                for (const item of items) {
                    item.tags.forEach(tag => allTags.add(tag));
                }
            }

            if (allTags.size === 0) {
                vscode.window.showInformationMessage('No tags found in agenda items');
                return;
            }

            const selectedTag = await vscode.window.showQuickPick(
                Array.from(allTags).sort(),
                { placeHolder: 'Select a tag to filter by' }
            );

            if (!selectedTag) return;

            const view = await manager.getAgendaView({
                includeTags: [selectedTag],
                days: 30,
            });

            const items: vscode.QuickPickItem[] = view.groups
                .flatMap(g => g.items)
                .map(item => ({
                    label: item.title,
                    description: formatItemDescription(item),
                    detail: `${path.basename(item.file)}:${item.line}`,
                    // @ts-ignore
                    agendaItem: item,
                }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Items with tag :${selectedTag}: (${items.length})`,
                matchOnDescription: true,
            });

            if (selected && (selected as any).agendaItem) {
                await jumpToAgendaItem((selected as any).agendaItem);
            }
        }),

        // Agenda clock report - generates time report across all agenda files
        vscode.commands.registerCommand('scimax.agenda.clockReport', async () => {
            // Ask for report type
            const reportType = await vscode.window.showQuickPick([
                { label: 'All time', value: 'all' },
                { label: 'Today', value: 'today' },
                { label: 'This week', value: 'thisweek' },
                { label: 'This month', value: 'thismonth' },
            ], {
                placeHolder: 'Select time range for clock report'
            });

            if (!reportType) return;

            try {
                // Generate the report config
                const config = {
                    type: reportType.value === 'today' ? 'daily' as const :
                          reportType.value === 'thisweek' ? 'weekly' as const :
                          reportType.value === 'thismonth' ? 'monthly' as const : 'custom' as const,
                    hierarchical: true,
                    showPercentages: true,
                    includeEmpty: false,
                };

                // Generate reports per file - re-parse each file for clock entries
                // (documents are not cached to save memory)
                const reportLines: string[] = [];
                let totalMinutes = 0;
                let totalEntries = 0;

                for (const [filePath] of manager.getFileCache()) {
                    try {
                        // Re-parse file to get clock entries
                        const content = fs.readFileSync(filePath, 'utf-8');
                        const document = parseOrg(content, {
                            parseInlineObjects: false,
                            addPositions: false,
                        });

                        const entries = collectAllClockEntries(document);
                        totalEntries += entries.length;

                        const report = generateTimeReport(document.children, config);
                        if (report.length > 0) {
                            const fileTotal = report.reduce((sum, e) => sum + e.totalMinutes, 0);
                            totalMinutes += fileTotal;

                            reportLines.push(`** ${path.basename(filePath)}`);
                            reportLines.push(`   Total: ${formatDuration(fileTotal)}`);
                            reportLines.push('');
                            reportLines.push(formatTimeReport(report, 1));
                            reportLines.push('');
                        }
                    } catch (err) {
                        console.warn(`Failed to parse ${filePath} for clock report:`, err);
                    }
                }

                if (totalEntries === 0) {
                    vscode.window.showInformationMessage('No clock entries found in agenda files');
                    return;
                }

                if (reportLines.length === 0) {
                    vscode.window.showInformationMessage('No clock entries found for the selected time range');
                    return;
                }

                // Create report document
                const reportContent = `#+TITLE: Agenda Clock Report - ${reportType.label}
#+DATE: ${new Date().toISOString().split('T')[0]}

* Clock Report (Agenda Files)

Total time across all files: ${formatDuration(totalMinutes)}

${reportLines.join('\n')}
`;

                const reportDoc = await vscode.workspace.openTextDocument({
                    content: reportContent,
                    language: 'org'
                });

                await vscode.window.showTextDocument(reportDoc, { preview: true });

            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate clock report: ${error}`);
            }
        }),

        // Agenda menu
        vscode.commands.registerCommand('scimax.agenda.menu', async () => {
            const options = [
                { label: '$(calendar) Day Agenda', description: 'Today\'s agenda', command: 'scimax.agenda.day' },
                { label: '$(calendar) Week Agenda', description: '7-day view', command: 'scimax.agenda.week' },
                { label: '$(calendar) Fortnight', description: '14-day view', command: 'scimax.agenda.fortnight' },
                { label: '$(calendar) Month Agenda', description: '30-day view', command: 'scimax.agenda.month' },
                { label: '$(tasklist) TODO List', description: 'All TODO items', command: 'scimax.agenda.todoList' },
                { label: '$(clock) Deadlines', description: 'Upcoming deadlines', command: 'scimax.agenda.deadlines' },
                { label: '$(milestone) Scheduled', description: 'Scheduled items', command: 'scimax.agenda.scheduled' },
                { label: '$(history) Clock Report', description: 'Time tracking report', command: 'scimax.agenda.clockReport' },
                { label: '$(tag) Filter by Tag', description: 'Show items with tag', command: 'scimax.agenda.filterByTag' },
                { label: '$(refresh) Refresh', description: 'Re-scan agenda files', command: 'scimax.agenda.refresh' },
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Org Agenda',
            });

            if (selected) {
                vscode.commands.executeCommand(selected.command);
            }
        }),

        // Configure agenda files
        vscode.commands.registerCommand('scimax.agenda.configure', async () => {
            const options = [
                { label: '$(folder) Add directory to agenda', value: 'addDir' },
                { label: '$(file) Add file to agenda', value: 'addFile' },
                { label: '$(settings) Open settings', value: 'settings' },
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Configure Agenda',
            });

            if (!selected) return;

            switch (selected.value) {
                case 'addDir': {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: true,
                        title: 'Select directories to add to agenda',
                    });

                    if (uris && uris.length > 0) {
                        const config = vscode.workspace.getConfiguration('scimax.agenda');
                        const current = config.get<string[]>('files', []);
                        const newPaths = uris.map(uri => uri.fsPath);
                        await config.update('files', [...current, ...newPaths], vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage(`Added ${uris.length} directories to agenda`);
                    }
                    break;
                }
                case 'addFile': {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: true,
                        filters: { 'Org files': ['org'] },
                        title: 'Select org files to add to agenda',
                    });

                    if (uris && uris.length > 0) {
                        const config = vscode.workspace.getConfiguration('scimax.agenda');
                        const current = config.get<string[]>('files', []);
                        const newPaths = uris.map(uri => uri.fsPath);
                        await config.update('files', [...current, ...newPaths], vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage(`Added ${uris.length} files to agenda`);
                    }
                    break;
                }
                case 'settings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'scimax.agenda');
                    break;
            }
        })
    );
}

// =============================================================================
// Helper Functions
// =============================================================================

async function showAgendaQuickPick(
    manager: AgendaManager,
    config: Partial<AgendaViewConfig>
): Promise<AgendaItem | undefined> {
    const view = await manager.getAgendaView(config);
    const items: vscode.QuickPickItem[] = [];

    for (const group of view.groups) {
        if (group.items.length === 0) continue;

        items.push({
            label: group.label,
            kind: vscode.QuickPickItemKind.Separator,
        });

        for (const item of group.items) {
            items.push({
                label: `${getItemIcon(item)} ${item.title}`,
                description: formatItemDescription(item),
                detail: `${item.category || path.basename(item.file)}:${item.line}`,
                // @ts-ignore
                agendaItem: item,
            });
        }
    }

    if (items.length === 0) {
        vscode.window.showInformationMessage('No agenda items found');
        return undefined;
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Agenda: ${view.totalItems} items`,
        matchOnDescription: true,
        matchOnDetail: true,
    });

    return selected ? (selected as any).agendaItem : undefined;
}

function getItemIcon(item: AgendaItem): string {
    if (item.overdue) return '$(warning)';
    if (item.agendaType === 'deadline') return '$(clock)';
    if (item.agendaType === 'scheduled') return '$(calendar)';
    if (item.agendaType === 'diary') return '$(star)';
    if (item.todoState === 'DONE') return '$(check)';
    if (item.todoState === 'TODO') return '$(circle-outline)';
    if (item.todoState === 'NEXT') return '$(arrow-right)';
    if (item.todoState === 'WAITING') return '$(watch)';
    return '$(circle-filled)';
}

function formatItemDescription(item: AgendaItem): string {
    const parts: string[] = [];

    if (item.todoState) parts.push(item.todoState);
    if (item.priority) parts.push(`[#${item.priority}]`);
    if (item.time) parts.push(item.time);

    if (item.agendaType === 'diary' && item.daysUntil !== undefined) {
        // For diary entries, daysUntil represents years for anniversaries
        if (item.daysUntil > 0) {
            parts.push(`(${item.daysUntil} years)`);
        }
    } else if (item.daysUntil !== undefined) {
        if (item.daysUntil < 0) {
            parts.push(`${Math.abs(item.daysUntil)}d overdue`);
        } else if (item.daysUntil === 0) {
            parts.push('Today');
        } else {
            parts.push(`in ${item.daysUntil}d`);
        }
    }

    if (item.tags.length > 0) {
        parts.push(`:${item.tags.join(':')}:`);
    }

    return parts.join(' ');
}

async function jumpToAgendaItem(item: AgendaItem): Promise<void> {
    try {
        const doc = await vscode.workspace.openTextDocument(item.file);
        const editor = await vscode.window.showTextDocument(doc);
        const position = new vscode.Position(item.line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Could not open file: ${item.file}`);
    }
}
