/**
 * Database Tree View Provider
 * Shows database statistics, search interface, and quick actions
 */

import * as vscode from 'vscode';
import { ScimaxDb, DbStats } from './scimaxDb';
import { getDatabase } from './lazyDb';

// =============================================================================
// Tree Item Types
// =============================================================================

type DatabaseTreeItem = DatabaseSectionItem | DatabaseStatItem | DatabaseActionItem;

/**
 * Section header in the tree view
 */
class DatabaseSectionItem extends vscode.TreeItem {
    constructor(
        public readonly section: 'stats' | 'search' | 'actions',
        label: string,
        public readonly stats?: DbStats
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = `databaseSection.${section}`;

        switch (section) {
            case 'stats':
                this.iconPath = new vscode.ThemeIcon('graph');
                break;
            case 'search':
                this.iconPath = new vscode.ThemeIcon('search');
                break;
            case 'actions':
                this.iconPath = new vscode.ThemeIcon('tools');
                break;
        }
    }
}

/**
 * Statistics display item
 */
class DatabaseStatItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string,
        tooltip?: string,
        icon?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.tooltip = tooltip || `${label}: ${description}`;
        this.iconPath = new vscode.ThemeIcon(icon || 'info');
        this.contextValue = 'databaseStat';
    }
}

/**
 * Action item that triggers a command
 */
class DatabaseActionItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string,
        command: string,
        icon: string,
        tooltip?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.tooltip = tooltip || description;
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = 'databaseAction';
        this.command = {
            command,
            title: label,
        };
    }
}

// =============================================================================
// Tree View Provider
// =============================================================================

export class DatabaseViewProvider implements vscode.TreeDataProvider<DatabaseTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DatabaseTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private stats: DbStats | null = null;
    private treeView: vscode.TreeView<DatabaseTreeItem> | null = null;
    private refreshInProgress: boolean = false;

    constructor() {}

    /**
     * Set the tree view reference for updating description
     */
    setTreeView(treeView: vscode.TreeView<DatabaseTreeItem>): void {
        this.treeView = treeView;
    }

    /**
     * Refresh the view with latest stats
     */
    async refresh(showMessage: boolean = false): Promise<void> {
        if (this.refreshInProgress) {
            return;
        }

        this.refreshInProgress = true;
        try {
            const db = await getDatabase();
            if (db) {
                this.stats = await db.getStats();

                // Update tree view description
                if (this.treeView) {
                    this.treeView.description = `${this.stats.files} files indexed`;
                }

                if (showMessage) {
                    // Show brief status bar message instead of popup
                    vscode.window.setStatusBarMessage(
                        `Database: ${this.stats.files} files, ${this.stats.headings} headings`,
                        3000
                    );
                }
            } else {
                this.stats = null;
                if (this.treeView) {
                    this.treeView.description = 'Not initialized';
                }
                if (showMessage) {
                    vscode.window.showWarningMessage('Database not initialized');
                }
            }
        } finally {
            this.refreshInProgress = false;
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: DatabaseTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: DatabaseTreeItem): Promise<DatabaseTreeItem[]> {
        if (!element) {
            // Root level - trigger refresh if no stats yet
            if (!this.stats) {
                await this.refresh();
            }

            // Return section headers
            return [
                new DatabaseSectionItem('search', 'Search'),
                new DatabaseSectionItem('actions', 'Actions'),
                new DatabaseSectionItem('stats', 'Statistics', this.stats || undefined),
            ];
        }

        if (element instanceof DatabaseSectionItem) {
            return this.getSectionChildren(element);
        }

        return [];
    }

    private getSectionChildren(section: DatabaseSectionItem): DatabaseTreeItem[] {
        switch (section.section) {
            case 'stats':
                return this.getStatsItems();
            case 'search':
                return this.getSearchItems();
            case 'actions':
                return this.getActionsItems();
            default:
                return [];
        }
    }

    private getStatsItems(): DatabaseTreeItem[] {
        if (!this.stats) {
            return [new DatabaseStatItem('No data', 'Database not initialized', undefined, 'warning')];
        }

        const items: DatabaseTreeItem[] = [];

        // File counts by type
        items.push(new DatabaseStatItem(
            'Files',
            `${this.stats.files} total`,
            `Org: ${this.stats.by_type.org}, Markdown: ${this.stats.by_type.md}`,
            'file'
        ));

        // Breakdown by type
        if (this.stats.by_type.org > 0) {
            items.push(new DatabaseStatItem('  Org files', `${this.stats.by_type.org}`, undefined, 'file-code'));
        }
        if (this.stats.by_type.md > 0) {
            items.push(new DatabaseStatItem('  Markdown files', `${this.stats.by_type.md}`, undefined, 'markdown'));
        }

        // Content statistics
        items.push(new DatabaseStatItem('Headings', `${this.stats.headings}`, undefined, 'list-tree'));
        items.push(new DatabaseStatItem('Source blocks', `${this.stats.blocks}`, undefined, 'code'));

        // Embedding chunks
        if (this.stats.chunks > 0) {
            items.push(new DatabaseStatItem('Text chunks', `${this.stats.chunks}`, 'Chunks indexed for semantic search', 'symbol-string'));
        }

        // Last indexed time
        if (this.stats.last_indexed) {
            const lastIndexed = new Date(this.stats.last_indexed);
            const timeAgo = this.formatTimeAgo(lastIndexed);
            items.push(new DatabaseStatItem('Last indexed', timeAgo, lastIndexed.toLocaleString(), 'history'));
        }

        return items;
    }

    private getSearchItems(): DatabaseTreeItem[] {
        const items: DatabaseTreeItem[] = [];
        const config = vscode.workspace.getConfiguration('scimax.db');
        const provider = config.get<string>('embeddingProvider', 'ollama');

        // Full-text search
        items.push(new DatabaseActionItem(
            'Full-text search',
            'FTS5 keyword search',
            'scimax.db.search',
            'search',
            'Search using keywords with BM25 ranking'
        ));

        // Semantic search status
        if (provider === 'none') {
            // Provider disabled
            items.push(new DatabaseStatItem(
                'Semantic search',
                'Disabled',
                'Set scimax.db.embeddingProvider to enable',
                'circle-slash'
            ));
        } else if (this.stats?.has_embeddings && this.stats?.vector_search_supported) {
            // Ready to use
            items.push(new DatabaseActionItem(
                'Semantic search',
                'Vector similarity',
                'scimax.db.searchSemantic',
                'sparkle',
                'Search by meaning using embeddings'
            ));

            items.push(new DatabaseActionItem(
                'Hybrid search',
                'Keywords + semantic',
                'scimax.db.searchHybrid',
                'combine',
                'Combined keyword and semantic search'
            ));
        } else if (this.stats?.chunks === 0 || !this.stats?.has_embeddings) {
            // Provider configured but no embeddings yet
            items.push(new DatabaseActionItem(
                'Semantic search',
                'Reindex required',
                'scimax.db.reindex',
                'sync',
                `Provider: ${provider}. Reindex to generate embeddings.`
            ));
        } else {
            // Vector search not supported
            items.push(new DatabaseStatItem(
                'Semantic search',
                'Not available',
                this.stats?.vector_search_error || 'Vector search not supported',
                'warning'
            ));
        }

        // Specialized searches
        items.push(new DatabaseActionItem(
            'Search headings',
            'Find by title',
            'scimax.db.searchHeadings',
            'list-tree'
        ));

        items.push(new DatabaseActionItem(
            'Search by tag',
            'Filter by org tags',
            'scimax.db.searchByTag',
            'tag'
        ));

        items.push(new DatabaseActionItem(
            'Search code blocks',
            'Find by language',
            'scimax.db.searchBlocks',
            'code'
        ));

        items.push(new DatabaseActionItem(
            'Browse hashtags',
            'Find by #hashtag',
            'scimax.db.searchHashtags',
            'symbol-keyword'
        ));

        return items;
    }

    private getActionsItems(): DatabaseTreeItem[] {
        return [
            new DatabaseActionItem(
                'Reindex files',
                'Scan and index',
                'scimax.db.reindex',
                'sync',
                'Reindex all configured directories'
            ),
            new DatabaseActionItem(
                'Show agenda',
                'Deadlines & scheduled',
                'scimax.db.agenda',
                'calendar',
                'View upcoming deadlines and scheduled items'
            ),
            new DatabaseActionItem(
                'Show TODOs',
                'Task list',
                'scimax.db.showTodos',
                'checklist',
                'View all TODO items'
            ),
            new DatabaseActionItem(
                'Browse files',
                'All indexed files',
                'scimax.db.browseFiles',
                'files',
                'Browse all files in the database'
            ),
            new DatabaseActionItem(
                'Database stats',
                'Full statistics',
                'scimax.db.stats',
                'graph',
                'Show detailed database statistics'
            ),
            new DatabaseActionItem(
                'Optimize',
                'Clean & vacuum',
                'scimax.db.optimize',
                'tools',
                'Remove stale entries and optimize database'
            ),
        ];
    }

    private formatTimeAgo(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }
}

// =============================================================================
// Registration
// =============================================================================

export function registerDatabaseView(context: vscode.ExtensionContext): DatabaseViewProvider {
    const provider = new DatabaseViewProvider();

    const treeView = vscode.window.createTreeView('scimax.database', {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    provider.setTreeView(treeView);

    context.subscriptions.push(treeView);

    // Refresh command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.database.refresh', () => {
            provider.refresh(true);
        })
    );

    // Lazy load: refresh when view becomes visible
    let initialized = false;
    context.subscriptions.push(
        treeView.onDidChangeVisibility(e => {
            if (e.visible && !initialized) {
                initialized = true;
                provider.refresh();
            }
        })
    );

    return provider;
}
