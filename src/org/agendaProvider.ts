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
} from '../parser/orgAgenda';
import type { HeadlineElement, OrgDocumentNode } from '../parser/orgElementTypes';

// =============================================================================
// Types
// =============================================================================

export interface AgendaFile {
    path: string;
    document: OrgDocumentNode;
    headlines: HeadlineElement[];
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
            maxFiles: config.get<number>('maxFiles', 500),
            batchSize: config.get<number>('batchSize', 10),
            batchDelayMs: config.get<number>('batchDelayMs', 5),
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

        // Apply max files limit
        const maxFiles = this.config.maxFiles;
        const filesToProcess = maxFiles > 0 ? uniqueFiles.slice(0, maxFiles) : uniqueFiles;

        if (filesToProcess.length < uniqueFiles.length) {
            this.outputChannel.appendLine(
                `Agenda: Limited scan to ${maxFiles} files (${uniqueFiles.length} total found). ` +
                `Configure 'scimax.agenda.files' to specify directories or increase 'scimax.agenda.maxFiles'.`
            );
        }

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
     * Parse an org file and cache the result
     */
    async parseFile(filePath: string): Promise<AgendaFile | null> {
        try {
            const stat = fs.statSync(filePath);
            const cached = this.fileCache.get(filePath);

            // Return cached if not modified
            if (cached && cached.mtime === stat.mtimeMs) {
                return cached;
            }

            // Parse file with fast mode (skip inline object parsing for agenda)
            const content = fs.readFileSync(filePath, 'utf-8');
            const document = parseOrg(content, {
                parseInlineObjects: false,
                addPositions: false,
            });

            // Extract headlines
            const headlines = this.extractHeadlines(document);

            const agendaFile: AgendaFile = {
                path: filePath,
                document,
                headlines,
                mtime: stat.mtimeMs,
            };

            this.fileCache.set(filePath, agendaFile);
            return agendaFile;
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing ${filePath}: ${error}`);
            return null;
        }
    }

    private extractHeadlines(doc: OrgDocumentNode): HeadlineElement[] {
        const headlines: HeadlineElement[] = [];

        for (const child of doc.children) {
            if (child.type === 'headline') {
                headlines.push(child as HeadlineElement);
            }
        }

        return headlines;
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

                // Log progress for large scans
                if (filesProcessed % 50 === 0) {
                    this.outputChannel.appendLine(`Agenda: Processed ${filesProcessed} files...`);
                }
            }

            this.outputChannel.appendLine(`Agenda: Scan complete. Processed ${filesProcessed} files, found ${allHeadlines.length} headlines.`);
        } finally {
            this.scanInProgress = false;
        }

        return generateAgendaView(allHeadlines, fileMap, {
            showDone: this.config.showDone,
            showHabits: this.config.showHabits,
            days: this.config.defaultSpan,
            ...config,
        });
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
        if (item.daysUntil !== undefined) {
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
            // Root level - return groups
            if (this.viewMode === 'agenda') {
                if (!this.agendaView) {
                    this.agendaView = await this.manager.getAgendaView({ groupBy: this.groupBy });
                }
                return this.agendaView.groups
                    .filter(g => g.items.length > 0)
                    .map(g => new AgendaGroupItem(g, 'agenda'));
            } else {
                if (!this.todoList) {
                    this.todoList = await this.manager.getTodoList({ excludeDone: true });
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

    if (item.daysUntil !== undefined) {
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
