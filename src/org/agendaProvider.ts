/**
 * Org-mode Agenda Provider
 * The agenda is a view over the Scimax database. File parsing happens at
 * index time; the agenda itself only queries the db.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseOrg } from '../parser/orgParserUnified';
import {
    generateAgendaView,
    formatAgendaItem,
    AgendaItem,
    AgendaView,
    AgendaGroup,
    AgendaViewConfig,
    TodoListView,
} from '../parser/orgAgenda';
import type { HeadlineElement } from '../parser/orgElementTypes';
import {
    collectAllClockEntries,
    generateTimeReport,
    formatTimeReport,
    formatDuration,
} from '../parser/orgClocking';
import { minimatch } from 'minimatch';
import { getDatabase } from '../database/lazyDb';
import type { ScimaxDb, AgendaItem as DbAgendaItem } from '../database/scimaxDb';
import { format, addDays, startOfDay, isSameDay, differenceInDays, parse } from 'date-fns';

// =============================================================================
// Types
// =============================================================================

export interface AgendaConfig {
    /** Patterns or absolute paths to exclude from the agenda view (globs and paths) */
    exclude: string[];
    /** Default view span in days */
    defaultSpan: number;
    /** Show done items */
    showDone: boolean;
    /** Show habits */
    showHabits: boolean;
    /** Require TODO state for scheduled/deadline items to appear */
    requireTodoState: boolean;
    /** TODO states to include */
    todoStates: string[];
    /** Done states */
    doneStates: string[];
}

// =============================================================================
// Agenda Manager
// =============================================================================

/**
 * Manages agenda file scanning and caching
 */
export class AgendaManager {
    private context: vscode.ExtensionContext;
    private config: AgendaConfig;
    private outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];
    private refreshEmitter = new vscode.EventEmitter<void>();
    readonly onDidRefresh = this.refreshEmitter.event;
    private verbose: boolean = false;
    private db: ScimaxDb | null = null;

    private refreshDebounceTimer: NodeJS.Timeout | null = null;
    private static readonly REFRESH_DEBOUNCE_MS = 500;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
        this.outputChannel = vscode.window.createOutputChannel('Org Agenda');

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('scimax.agenda')) {
                    this.config = this.loadConfig();
                    this.refresh();
                }
            })
        );

        this.setupDatabaseSubscription();
    }

    /**
     * Subscribe to database mutation events. The agenda must reflect the db
     * after any of: a file is (re)indexed, the db is cleared, or a full rebuild
     * finishes. Without these the TreeView shows stale snapshots.
     *
     * The db client is created lazily, so retry until it's available rather
     * than silently no-op.
     */
    private subscriptionInstalled = false;
    private async setupDatabaseSubscription(): Promise<void> {
        if (this.subscriptionInstalled) return;
        const db = await getDatabase();
        if (db) {
            this.installDbListeners(db);
            return;
        }
        // Retry: poll once a second up to a minute. Most cold starts resolve in
        // a few hundred ms; the upper bound guards against a permanently broken
        // db without leaking a forever-running timer.
        let attempts = 0;
        const interval = setInterval(async () => {
            attempts++;
            const ready = await getDatabase();
            if (ready) {
                clearInterval(interval);
                this.installDbListeners(ready);
            } else if (attempts >= 60) {
                clearInterval(interval);
            }
        }, 1000);
        this.disposables.push({ dispose: () => clearInterval(interval) });
    }

    private installDbListeners(db: ScimaxDb): void {
        if (this.subscriptionInstalled) return;
        this.subscriptionInstalled = true;
        this.db = db;
        this.disposables.push(
            db.onDidIndexFile(() => this.debouncedRefresh()),
            db.onDidClear(() => this.debouncedRefresh()),
            db.onDidRebuild(() => this.debouncedRefresh()),
        );
    }

    /**
     * Set database reference for retrieving project paths
     * If set, uses database for project list instead of globalState
     */
    setDatabase(db: ScimaxDb): void {
        this.installDbListeners(db);
    }

    private loadConfig(): AgendaConfig {
        const config = vscode.workspace.getConfiguration('scimax.agenda');
        return {
            exclude: config.get<string[]>('exclude', ['**/node_modules/**', '**/.git/**', '**/archive/**']),
            defaultSpan: config.get<number>('defaultSpan', 7),
            showDone: config.get<boolean>('showDone', false),
            showHabits: config.get<boolean>('showHabits', true),
            requireTodoState: config.get<boolean>('requireTodoState', true),
            todoStates: config.get<string[]>('todoStates', ['TODO', 'NEXT', 'WAITING']),
            doneStates: config.get<string[]>('doneStates', ['DONE', 'CANCELLED']),
        };
    }

    /**
     * Path substrings that should always be excluded from agenda scanning.
     * These are system/application directories that may contain .org files
     * as backups or caches but are never valid agenda sources.
     */
    private static readonly BUILTIN_EXCLUDE_PATHS: string[] = [
        '/Library/Application Support/',
        '/Library/Caches/',
        '/.Trash/',
        '/.local/share/',
        '/AppData/',
        '/.cache/',
        '/tmp/',
        '/temp/',
        '/.emacs.d/elpa/',
        '/.emacs.d/straight/',
    ];

    /**
     * Check if a file should be excluded (by absolute path or glob pattern)
     */
    private isFileExcluded(filePath: string): boolean {
        // Always exclude system/application directories
        for (const segment of AgendaManager.BUILTIN_EXCLUDE_PATHS) {
            if (filePath.includes(segment)) {
                return true;
            }
        }

        for (const pattern of this.config.exclude) {
            // Expand ~ in pattern
            let expandedPattern = pattern;
            if (pattern.startsWith('~')) {
                expandedPattern = pattern.replace(/^~/, process.env.HOME || '');
            }

            if (pattern.includes('*')) {
                // It's a glob pattern
                if (minimatch(filePath, expandedPattern, { matchBase: true })) {
                    return true;
                }
            } else {
                // It's an absolute path
                if (filePath === expandedPattern) {
                    return true;
                }
            }
        }
        return false;
    }

    async excludeFile(filePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('scimax.agenda');
        const current = config.get<string[]>('exclude', []);

        if (!current.includes(filePath)) {
            await config.update('exclude', [...current, filePath], vscode.ConfigurationTarget.Global);
            this.config = this.loadConfig();
            this.refreshEmitter.fire();
            this.log(`Agenda: Added ${filePath} to exclude list`);
        }
    }

    async unexcludeFile(filePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('scimax.agenda');
        const current = config.get<string[]>('exclude', []);

        const index = current.indexOf(filePath);
        if (index !== -1) {
            const updated = [...current];
            updated.splice(index, 1);
            await config.update('exclude', updated, vscode.ConfigurationTarget.Global);
            this.config = this.loadConfig();
            this.refreshEmitter.fire();
            this.log(`Agenda: Removed ${filePath} from exclude list`);
        }
    }

    private log(message: string): void {
        if (this.verbose) {
            this.outputChannel.appendLine(message);
        }
    }

    /**
     * Toggle verbose logging mode
     */
    public toggleVerbose(): void {
        this.verbose = !this.verbose;
        if (this.verbose) {
            this.outputChannel.show(true);
            this.outputChannel.appendLine('Agenda: Verbose logging enabled');
        } else {
            this.outputChannel.appendLine('Agenda: Verbose logging disabled');
        }
        vscode.window.showInformationMessage(`Agenda verbose logging ${this.verbose ? 'enabled' : 'disabled'}`);
    }

    /**
     * Check if verbose mode is enabled
     */
    public isVerbose(): boolean {
        return this.verbose;
    }

    private debouncedRefresh(): void {
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
        }
        this.refreshDebounceTimer = setTimeout(() => {
            this.refreshDebounceTimer = null;
            this.refreshEmitter.fire();
        }, AgendaManager.REFRESH_DEBOUNCE_MS);
    }

    /**
     * Generate agenda view with lazy loading and rate limiting
     */
    async getAgendaView(config?: Partial<AgendaViewConfig>): Promise<AgendaView> {
        // The agenda is now a view over the database. If the db isn't ready,
        // return an empty view rather than re-scanning files — the TreeView
        // will surface the "Database not ready" message and the stale-check
        // prompt will tell the user to refresh.
        const view = await this.getAgendaViewFromDb(config);
        if (view) return view;

        const startDate = startOfDay(new Date());
        const days = config?.days ?? this.config.defaultSpan;
        return {
            config: {
                type: 'week',
                startDate,
                days,
                showDone: this.config.showDone,
                showHabits: this.config.showHabits,
                sortBy: 'time',
                groupBy: 'date',
                ...config,
            },
            groups: [],
            totalItems: 0,
            totalFiles: 0,
            dateRange: { start: startDate, end: addDays(startDate, days) },
        };
    }

    /**
     * Generate agenda view from database (faster than file scanning)
     * Returns null if database is not available
     */
    async getAgendaViewFromDb(config?: Partial<AgendaViewConfig>): Promise<AgendaView | null> {
        const db = this.db || await getDatabase();
        if (!db) {
            return null;
        }

        try {
            const fullConfig: AgendaViewConfig = {
                type: 'week',
                startDate: startOfDay(new Date()),
                days: this.config.defaultSpan,
                showDone: this.config.showDone,
                showHabits: this.config.showHabits,
                sortBy: 'time',
                groupBy: 'date',
                ...config,
            };

            const startDate = startOfDay(fullConfig.startDate);
            const endDate = addDays(startDate, fullConfig.days);

            // Get agenda items from database
            const dbItems = await db.getAgenda({
                before: format(endDate, 'yyyy-MM-dd'),
                includeUnscheduled: false,
                requireTodoState: this.config.requireTodoState,
            });

            // Convert database items to AgendaItem format, filtering excluded files
            const items: AgendaItem[] = [];
            for (const dbItem of dbItems) {
                // Check if file is excluded
                if (this.isFileExcluded(dbItem.heading.file_path)) {
                    continue;
                }
                const agendaItem = this.convertDbItemToAgendaItem(dbItem, startDate);
                if (agendaItem) {
                    items.push(agendaItem);
                }
            }

            // Group items by date
            const groups = this.groupItemsByDate(items, startDate, fullConfig.days);

            return {
                config: fullConfig,
                groups,
                totalItems: items.length,
                totalFiles: 0, // Not applicable for database view
                dateRange: { start: startDate, end: endDate },
            };
        } catch (error) {
            this.log(`Error getting agenda from database: ${error}`);
            return null;
        }
    }

    /**
     * Convert a database AgendaItem to the parser's AgendaItem format
     */
    private convertDbItemToAgendaItem(dbItem: DbAgendaItem, startDate: Date): AgendaItem | null {
        const heading = dbItem.heading;

        // Parse the date string to a Date object
        // Use date-fns parse() to create a LOCAL date, not UTC
        // new Date('2024-01-27') creates UTC midnight which is the previous evening in local time!
        let itemDate: Date | undefined;
        if (dbItem.date) {
            // Date format from DB: "2024-01-15" or "2024-01-15 Mon 10:00"
            const dateMatch = dbItem.date.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                // parse() creates a date in local timezone
                itemDate = parse(dateMatch[1], 'yyyy-MM-dd', new Date());
            }
        }

        // Extract time if present
        let time: string | undefined;
        if (dbItem.date) {
            const timeMatch = dbItem.date.match(/(\d{1,2}:\d{2})/);
            if (timeMatch) {
                time = timeMatch[1];
            }
        }

        // Parse tags from comma-separated string
        const tags = heading.tags ? heading.tags.split(',').map(t => t.trim()).filter(t => t) : [];

        // Determine agenda type
        const agendaType: AgendaItem['agendaType'] = dbItem.type === 'deadline' ? 'deadline' :
            dbItem.type === 'scheduled' ? 'scheduled' : 'todo';

        // Create a minimal HeadlineElement for compatibility
        const minimalHeadline: HeadlineElement = {
            type: 'headline',
            range: { start: heading.begin_pos, end: heading.begin_pos + heading.title.length },
            postBlank: 0,
            properties: {
                level: heading.level,
                rawValue: heading.title,
                todoKeyword: heading.todo_state || undefined,
                priority: heading.priority || undefined,
                tags,
                archivedp: false,
                commentedp: false,
                footnoteSection: false,
                lineNumber: heading.line_number,
            },
            children: [],
        };

        return {
            title: heading.title,
            todoState: heading.todo_state || undefined,
            priority: heading.priority || undefined,
            tags,
            file: heading.file_path,
            line: heading.line_number,
            scheduled: agendaType === 'scheduled' ? itemDate : undefined,
            deadline: agendaType === 'deadline' ? itemDate : undefined,
            daysUntil: dbItem.days_until,
            overdue: dbItem.overdue,
            category: heading.file_path.split('/').pop()?.replace('.org', ''),
            headline: minimalHeadline,
            agendaType,
            time,
        };
    }

    /**
     * Group agenda items by date
     */
    private groupItemsByDate(items: AgendaItem[], startDate: Date, days: number): AgendaGroup[] {
        const groups: AgendaGroup[] = [];

        for (let i = 0; i < days; i++) {
            const date = addDays(startDate, i);
            const dateKey = format(date, 'yyyy-MM-dd');
            const dateLabel = this.formatDateLabel(date);

            const dayItems = items.filter(item => {
                const itemDate = item.scheduled || item.deadline || item.timestamp;
                return itemDate && isSameDay(itemDate, date);
            });

            groups.push({
                label: dateLabel,
                key: dateKey,
                items: dayItems,
            });
        }

        // Add overdue items to today's group
        const overdueItems = items.filter(item => item.overdue);
        if (overdueItems.length > 0) {
            const todayKey = format(new Date(), 'yyyy-MM-dd');
            const todayGroup = groups.find(g => g.key === todayKey);
            if (todayGroup) {
                for (const item of overdueItems) {
                    if (!todayGroup.items.includes(item)) {
                        todayGroup.items.unshift(item);
                    }
                }
            }
        }

        return groups;
    }

    /**
     * Format a date for display in agenda groups
     */
    private formatDateLabel(date: Date): string {
        const today = startOfDay(new Date());
        const diff = differenceInDays(date, today);

        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        if (diff === -1) return 'Yesterday';

        const dayName = format(date, 'EEEE');
        const dateStr = format(date, 'MMM d');
        return `${dayName} ${dateStr}`;
    }

    /**
     * Check if database is available for agenda queries
     */
    async isDatabaseAvailable(): Promise<boolean> {
        const db = this.db || await getDatabase();
        return db !== null;
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
        const view = await this.getTodoListFromDb();
        if (view) return view;
        return {
            byState: new Map(),
            byPriority: new Map(),
            counts: { total: 0, byState: {}, byPriority: {} },
        };
    }

    /**
     * Build a TodoListView from the database
     */
    async getTodoListFromDb(): Promise<TodoListView | null> {
        const db = this.db || await getDatabase();
        if (!db) {
            return null;
        }

        try {
            const headings = await db.getTodos();
            const doneStates = new Set(this.config.doneStates);

            const byState = new Map<string, AgendaItem[]>();
            const byPriority = new Map<string, AgendaItem[]>();
            const countsState: Record<string, number> = {};
            const countsPriority: Record<string, number> = {};

            for (const heading of headings) {
                const state = heading.todo_state;
                if (!state) continue;
                if (!this.config.showDone && doneStates.has(state)) continue;
                if (this.isFileExcluded(heading.file_path)) continue;

                const tags = heading.tags ? heading.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t) : [];
                const priority = heading.priority || 'none';

                const minimalHeadline: HeadlineElement = {
                    type: 'headline',
                    range: { start: heading.begin_pos, end: heading.begin_pos + heading.title.length },
                    postBlank: 0,
                    properties: {
                        level: heading.level,
                        rawValue: heading.title,
                        todoKeyword: state,
                        priority: heading.priority || undefined,
                        tags,
                        archivedp: false,
                        commentedp: false,
                        footnoteSection: false,
                        lineNumber: heading.line_number,
                    },
                    children: [],
                };

                const item: AgendaItem = {
                    title: heading.title,
                    todoState: state,
                    priority: heading.priority || undefined,
                    tags,
                    file: heading.file_path,
                    line: heading.line_number,
                    agendaType: 'todo',
                    headline: minimalHeadline,
                    category: heading.file_path.split('/').pop()?.replace('.org', ''),
                };

                if (!byState.has(state)) byState.set(state, []);
                byState.get(state)!.push(item);
                countsState[state] = (countsState[state] || 0) + 1;

                if (!byPriority.has(priority)) byPriority.set(priority, []);
                byPriority.get(priority)!.push(item);
                countsPriority[priority] = (countsPriority[priority] || 0) + 1;
            }

            const total = headings.filter(h => h.todo_state && (this.config.showDone || !doneStates.has(h.todo_state))).length;

            return {
                byState,
                byPriority,
                counts: { total, byState: countsState, byPriority: countsPriority },
            };
        } catch (error) {
            this.log(`Error getting todos from database: ${error}`);
            return null;
        }
    }

    /**
     * Refresh agenda (re-read config, fire refresh event).
     *
     * The agenda is purely a view over the db now, so refreshing the agenda
     * means re-reading config and re-querying. To pick up disk changes the
     * user runs `Scimax: Refresh Database`, which fires onDidRebuild and
     * gets us back here through the subscription.
     */
    async refresh(): Promise<void> {
        this.config = this.loadConfig();
        this.refreshEmitter.fire();
    }

    /**
     * Describe the agenda's display-time filters for tooltips.
     * The agenda is now a view over the database, so the only thing it
     * controls is what to hide from that view.
     */
    getSourcesDescription(): string {
        const parts: string[] = ['Source: Scimax database'];
        if (this.config.exclude.length > 0) {
            parts.push(`Exclude: ${this.config.exclude.length} patterns`);
        }
        return parts.join('\n');
    }

    /**
     * Build an agenda view for a single file by parsing it once. No caching,
     * no scanning — used for the "agenda for current file" command.
     */
    async getAgendaViewForFile(filePath: string, config?: Partial<AgendaViewConfig>): Promise<AgendaView> {
        const allHeadlines: HeadlineElement[] = [];
        const fileMap = new Map<string, string>();

        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const document = parseOrg(content, { parseInlineObjects: false, addPositions: false });
            for (const child of document.children) {
                if (child.type === 'headline') {
                    this.collectHeadlinesWithFile(child as HeadlineElement, filePath, allHeadlines, fileMap);
                }
            }
        } catch (error) {
            this.log(`getAgendaViewForFile: failed to read/parse ${filePath}: ${error}`);
        }

        return generateAgendaView(allHeadlines, fileMap, {
            showDone: this.config.showDone,
            showHabits: this.config.showHabits,
            days: this.config.defaultSpan,
            files: [filePath],
            ...config,
        }, [], 1);
    }

    dispose(): void {
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
            this.refreshDebounceTimer = null;
        }
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

type AgendaTreeItem = AgendaInfoItem | AgendaGroupItem | AgendaItemNode;

/**
 * Info item showing agenda sources (displayed at top of tree)
 */
class AgendaInfoItem extends vscode.TreeItem {
    constructor(
        public readonly itemCount: number,
        public readonly sourcesDescription: string,
        public readonly isFromDatabase: boolean = false
    ) {
        const label = isFromDatabase
            ? `${itemCount} items`
            : `Scanning ${itemCount} files`;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = isFromDatabase ? 'from database' : '';
        this.tooltip = new vscode.MarkdownString(
            isFromDatabase
                ? `**Agenda from Database**\n\n${itemCount} items indexed\n\n*Click to configure*`
                : `**Agenda Sources**\n\n${sourcesDescription.split('\n').map(line => `- ${line}`).join('\n')}\n\n*Click to configure*`
        );
        this.iconPath = new vscode.ThemeIcon(isFromDatabase ? 'database' : 'info');
        this.contextValue = 'agendaInfo';
        this.command = {
            command: 'scimax.agenda.configure',
            title: 'Configure Agenda',
        };
    }
}

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
    private refreshDebounceTimer: NodeJS.Timeout | null = null;
    private static readonly REFRESH_DEBOUNCE_MS = 300;
    private treeView: vscode.TreeView<AgendaTreeItem> | null = null;

    constructor(private manager: AgendaManager) {
        // Debounce refresh requests from manager to avoid cascading updates
        manager.onDidRefresh(() => this.debouncedRefresh());
    }

    /**
     * Set the tree view reference for updating description/tooltip
     */
    setTreeView(treeView: vscode.TreeView<AgendaTreeItem>): void {
        this.treeView = treeView;
    }

    private debouncedRefresh(): void {
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
        }
        this.refreshDebounceTimer = setTimeout(() => {
            this.refreshDebounceTimer = null;
            this.refresh();
        }, AgendaTreeProvider.REFRESH_DEBOUNCE_MS);
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

    private isFromDatabase: boolean = false;

    private async doRefresh(): Promise<void> {
        if (this.viewMode === 'agenda') {
            const dbView = await this.manager.getAgendaViewFromDb({ groupBy: this.groupBy });
            if (dbView) {
                this.agendaView = dbView;
                if (this.treeView) {
                    this.treeView.description = `${dbView.totalItems} items`;
                    this.treeView.message = dbView.totalItems === 0
                        ? 'No agenda items. Run "Scimax: Refresh Database" if files have changed.'
                        : undefined;
                }
            } else {
                if (this.treeView) {
                    this.treeView.description = '';
                    this.treeView.message = 'Database not ready. Run "Scimax: Rebuild Database" to index your org files.';
                }
            }
        } else {
            const dbTodos = await this.manager.getTodoListFromDb();
            if (dbTodos) {
                this.todoList = dbTodos;
                if (this.treeView) {
                    this.treeView.description = `${dbTodos.counts.total} items`;
                    this.treeView.message = dbTodos.counts.total === 0
                        ? 'No TODO items. Run "Scimax: Refresh Database" if files have changed.'
                        : undefined;
                }
            } else {
                if (this.treeView) {
                    this.treeView.description = '';
                    this.treeView.message = 'Database not ready. Run "Scimax: Rebuild Database" to index your org files.';
                }
            }
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

            // Root level - return info item + groups
            const result: AgendaTreeItem[] = [];

            // Add info item showing count and sources
            const sourcesDescription = this.manager.getSourcesDescription();
            if (this.isFromDatabase) {
                const itemCount = this.agendaView?.totalItems || 0;
                result.push(new AgendaInfoItem(itemCount, sourcesDescription, true));
            } else {
                const fileCount = this.agendaView?.totalFiles || 0;
                if (fileCount > 0 || sourcesDescription) {
                    result.push(new AgendaInfoItem(fileCount, sourcesDescription, false));
                }
            }

            if (this.viewMode === 'agenda') {
                if (!this.agendaView) {
                    // No data yet - trigger a refresh and wait for it
                    await this.refresh();
                }
                if (!this.agendaView) {
                    return result; // Still no data after refresh (scan may have been cancelled)
                }
                const groups = this.agendaView.groups
                    .filter(g => g.items.length > 0)
                    .map(g => new AgendaGroupItem(g, 'agenda'));
                result.push(...groups);
            } else {
                if (!this.todoList) {
                    // No data yet - trigger a refresh and wait for it
                    await this.refresh();
                }
                if (!this.todoList) {
                    return result; // Still no data after refresh
                }
                // Convert TODO list to groups
                const groups: AgendaGroup[] = [];
                for (const [state, items] of this.todoList.byState) {
                    if (items.length > 0) {
                        groups.push({ label: state, key: state, items });
                    }
                }
                result.push(...groups.map(g => new AgendaGroupItem(g, 'todo')));
            }

            return result;
        }

        if (element instanceof AgendaGroupItem) {
            return element.group.items.map(item => new AgendaItemNode(item));
        }

        // AgendaInfoItem has no children
        return [];
    }
}

// =============================================================================
// Commands
// =============================================================================

/**
 * Show a one-shot toast on activation if the user has set any of the now-
 * deprecated scimax.agenda.* indexing settings to a non-default value. The
 * agenda is purely a view over the db now, so those settings have no effect.
 */
function warnDeprecatedAgendaSettings(): void {
    const cfg = vscode.workspace.getConfiguration('scimax.agenda');
    const deprecated: string[] = [];

    const inspect = (key: string, defaultValue: unknown): boolean => {
        const info = cfg.inspect(key);
        const explicit = info?.globalValue ?? info?.workspaceValue ?? info?.workspaceFolderValue;
        if (explicit === undefined) return false;
        return JSON.stringify(explicit) !== JSON.stringify(defaultValue);
    };

    if (inspect('includeJournal', true)) deprecated.push('scimax.agenda.includeJournal');
    if (inspect('includeWorkspace', true)) deprecated.push('scimax.agenda.includeWorkspace');
    if (inspect('includeProjects', true)) deprecated.push('scimax.agenda.includeProjects');
    if (inspect('include', [])) deprecated.push('scimax.agenda.include');
    if (inspect('maxFiles', 0)) deprecated.push('scimax.agenda.maxFiles');

    if (deprecated.length === 0) return;

    vscode.window.showInformationMessage(
        `Scimax: ${deprecated.length} agenda indexing setting(s) are deprecated. ` +
        `The agenda is now a view over the database — use scimax.db.* to control indexing. ` +
        `(${deprecated.join(', ')})`,
        'Open Settings'
    ).then((choice) => {
        if (choice === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'scimax.db');
        }
    });
}

export function registerAgendaCommands(context: vscode.ExtensionContext): void {
    warnDeprecatedAgendaSettings();
    const manager = new AgendaManager(context);
    const treeProvider = new AgendaTreeProvider(manager);

    // Register tree view
    const treeView = vscode.window.createTreeView('scimax.agenda', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    // Connect tree view to provider for description/tooltip updates
    treeProvider.setTreeView(treeView);

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
        vscode.commands.registerCommand('scimax.agenda.refresh', async () => {
            await manager.refresh();
            vscode.window.setStatusBarMessage('$(check) Agenda refreshed', 2000);
        }),

        // Toggle verbose logging
        vscode.commands.registerCommand('scimax.agenda.toggleVerbose', () => {
            manager.toggleVerbose();
        }),

        // Exclude/unexclude file commands
        vscode.commands.registerCommand('scimax.agenda.ignoreFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file to exclude');
                return;
            }
            const filePath = editor.document.uri.fsPath;
            await manager.excludeFile(filePath);
            vscode.window.showInformationMessage(`Added to agenda exclude list: ${path.basename(filePath)}`);
            treeProvider.refresh();
        }),

        // Exclude file from agenda (right-click on tree item)
        vscode.commands.registerCommand('scimax.agenda.ignoreFileFromItem', async (node: AgendaItemNode) => {
            if (!node || !node.item) {
                vscode.window.showWarningMessage('No agenda item selected');
                return;
            }
            const filePath = node.item.file;
            await manager.excludeFile(filePath);
            vscode.window.showInformationMessage(`Added to agenda exclude list: ${path.basename(filePath)}`);
            treeProvider.refresh();
        }),

        // Exclude file from agenda (right-click on tab)
        vscode.commands.registerCommand('scimax.agenda.ignoreFileFromTab', async (uri?: vscode.Uri) => {
            const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
            if (!filePath) {
                vscode.window.showWarningMessage('No file selected');
                return;
            }

            const pattern = await vscode.window.showInputBox({
                prompt: 'Enter a glob pattern to exclude from the agenda (e.g. **/dir/** or exact path)',
                value: filePath,
                valueSelection: [0, filePath.length],
            });

            if (pattern) {
                await manager.excludeFile(pattern);
                vscode.window.showInformationMessage(`Added to agenda exclude list: ${pattern}`);
                treeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('scimax.agenda.unignoreFile', async () => {
            const config = vscode.workspace.getConfiguration('scimax.agenda');
            const excludeList = config.get<string[]>('exclude', []);

            // Filter to show only absolute paths (not glob patterns)
            const absolutePaths = excludeList.filter(f => !f.includes('*'));

            if (absolutePaths.length === 0) {
                vscode.window.showInformationMessage('No files in exclude list');
                return;
            }

            const items = absolutePaths.map(f => ({
                label: path.basename(f),
                description: f,
                filePath: f,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select file to remove from exclude list',
            });

            if (selected) {
                await manager.unexcludeFile(selected.filePath);
                vscode.window.showInformationMessage(`Removed from agenda exclude list: ${selected.label}`);
                treeProvider.refresh();
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

        // Current file agenda
        vscode.commands.registerCommand('scimax.agenda.currentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            const filePath = editor.document.uri.fsPath;
            if (!filePath.endsWith('.org')) {
                vscode.window.showWarningMessage('Current file is not an org file');
                return;
            }
            const items = await showAgendaQuickPickForFile(manager, filePath, { type: 'month', days: 30 });
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
                        // @ts-expect-error - storing extra data on QuickPickItem
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

        // Search agenda items
        vscode.commands.registerCommand('scimax.agenda.search', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search agenda items',
                placeHolder: 'Enter search term...',
            });

            if (!query) return;

            const queryLower = query.toLowerCase();

            // Get both agenda view and todo list for comprehensive search
            const [agendaView, todoList] = await Promise.all([
                manager.getAgendaView({ days: 365 }), // Search up to a year ahead
                manager.getTodoList(),
            ]);

            // Collect all unique items (avoid duplicates)
            const seenItems = new Set<string>();
            const matchingItems: AgendaItem[] = [];

            // Search agenda items
            for (const group of agendaView.groups) {
                for (const item of group.items) {
                    const key = `${item.file}:${item.line}:${item.title}`;
                    if (seenItems.has(key)) continue;

                    // Search in title, category, tags, and file name
                    const searchText = [
                        item.title,
                        item.category,
                        item.tags.join(' '),
                        path.basename(item.file),
                        item.todoState || '',
                    ].join(' ').toLowerCase();

                    if (searchText.includes(queryLower)) {
                        matchingItems.push(item);
                        seenItems.add(key);
                    }
                }
            }

            // Search TODO list items that might not be in agenda view
            for (const items of todoList.byState.values()) {
                for (const item of items) {
                    const key = `${item.file}:${item.line}:${item.title}`;
                    if (seenItems.has(key)) continue;

                    const searchText = [
                        item.title,
                        item.category,
                        item.tags.join(' '),
                        path.basename(item.file),
                        item.todoState || '',
                    ].join(' ').toLowerCase();

                    if (searchText.includes(queryLower)) {
                        matchingItems.push(item);
                        seenItems.add(key);
                    }
                }
            }

            if (matchingItems.length === 0) {
                vscode.window.showInformationMessage(`No agenda items found matching "${query}"`);
                return;
            }

            // Sort by relevance (title matches first) then by date
            matchingItems.sort((a, b) => {
                const aTitle = a.title.toLowerCase().includes(queryLower);
                const bTitle = b.title.toLowerCase().includes(queryLower);
                if (aTitle && !bTitle) return -1;
                if (!aTitle && bTitle) return 1;

                // Then by date
                const dateA = a.scheduled || a.deadline || a.timestamp || new Date(0);
                const dateB = b.scheduled || b.deadline || b.timestamp || new Date(0);
                return dateA.getTime() - dateB.getTime();
            });

            // Create quick pick items
            const items: vscode.QuickPickItem[] = matchingItems.map(item => ({
                label: `${item.todoState ? `[${item.todoState}] ` : ''}${item.title}`,
                description: formatItemDescription(item),
                detail: `${path.basename(item.file)}:${item.line}${item.tags.length > 0 ? ` :${item.tags.join(':')}:` : ''}`,
                agendaItem: item,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Found ${items.length} items matching "${query}"`,
                matchOnDescription: true,
                matchOnDetail: true,
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

                const db = await getDatabase();
                const indexedFiles = db ? (await db.getFiles()).map(f => f.path) : [];
                for (const filePath of indexedFiles) {
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
                // @ts-expect-error - storing extra data on QuickPickItem
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

async function showAgendaQuickPickForFile(
    manager: AgendaManager,
    filePath: string,
    config: Partial<AgendaViewConfig>
): Promise<AgendaItem | undefined> {
    const view = await manager.getAgendaViewForFile(filePath, config);
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
                detail: `Line ${item.line}`,
                // @ts-expect-error - storing extra data on QuickPickItem
                agendaItem: item,
            });
        }
    }

    if (items.length === 0) {
        vscode.window.showInformationMessage('No agenda items found in current file');
        return undefined;
    }

    const fileName = path.basename(filePath);
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Agenda for ${fileName}: ${view.totalItems} items`,
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
