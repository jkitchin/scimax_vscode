import * as vscode from 'vscode';
import * as path from 'path';
import { JournalManager, JournalEntry } from './journalManager';

export class JournalTreeProvider implements vscode.TreeDataProvider<JournalTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<JournalTreeItem | undefined | null | void> =
        new vscode.EventEmitter<JournalTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<JournalTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    // Cache entries locally to avoid repeated async calls during tree building
    private cachedEntries: JournalEntry[] = [];
    private disposable: vscode.Disposable | null = null;

    constructor(private manager: JournalManager) {
        // Listen for entry changes and refresh
        this.disposable = manager.onDidChangeEntries(() => {
            this.refresh();
        });
    }

    dispose(): void {
        this.disposable?.dispose();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: JournalTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: JournalTreeItem): Promise<JournalTreeItem[]> {
        if (!element) {
            // Root level - show years (async to load entries)
            return this.getYearItems();
        }

        if (element.contextValue === 'year') {
            // Year level - show months (uses cached entries)
            return this.getMonthItems(element.year!);
        }

        if (element.contextValue === 'month') {
            // Month level - show entries (uses cached entries)
            return this.getEntryItems(element.year!, element.month!);
        }

        return [];
    }

    private async getYearItems(): Promise<JournalTreeItem[]> {
        // Load entries asynchronously
        this.cachedEntries = await this.manager.getAllEntriesAsync();
        const entries = this.cachedEntries;
        const years = new Set<number>();

        for (const entry of entries) {
            years.add(entry.date.getFullYear());
        }

        // Sort years in descending order (most recent first)
        const sortedYears = Array.from(years).sort((a, b) => b - a);

        return sortedYears.map(year => {
            const yearEntries = entries.filter(e => e.date.getFullYear() === year);
            return new JournalTreeItem(
                year.toString(),
                vscode.TreeItemCollapsibleState.Expanded,
                'year',
                year,
                undefined,
                undefined,
                `${yearEntries.length} entries`
            );
        });
    }

    private getMonthItems(year: number): JournalTreeItem[] {
        // Use cached entries filtered by year
        const entries = this.cachedEntries.filter(e => e.date.getFullYear() === year);
        const months = new Set<number>();

        for (const entry of entries) {
            months.add(entry.date.getMonth());
        }

        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        // Sort months in descending order (most recent first)
        const sortedMonths = Array.from(months).sort((a, b) => b - a);

        return sortedMonths.map(month => {
            const monthEntries = entries.filter(e => e.date.getMonth() === month);
            return new JournalTreeItem(
                monthNames[month],
                vscode.TreeItemCollapsibleState.Collapsed,
                'month',
                year,
                month,
                undefined,
                `${monthEntries.length} entries`
            );
        });
    }

    private getEntryItems(year: number, month: number): JournalTreeItem[] {
        // Use cached entries filtered by year and month
        const entries = this.cachedEntries.filter(e =>
            e.date.getFullYear() === year && e.date.getMonth() === month
        );

        // Sort entries in descending order (most recent first)
        entries.sort((a, b) => b.date.getTime() - a.date.getTime());

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        return entries.map(entry => {
            const day = entry.date.getDate();
            const weekday = weekdays[entry.date.getDay()];
            const dateStr = `${day.toString().padStart(2, '0')} (${weekday})`;

            const item = new JournalTreeItem(
                dateStr,
                vscode.TreeItemCollapsibleState.None,
                'entry',
                year,
                month,
                entry
            );

            // Make it clickable
            item.command = {
                command: 'vscode.open',
                title: 'Open Entry',
                arguments: [vscode.Uri.file(entry.path)]
            };

            return item;
        });
    }
}

export class JournalTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly year?: number,
        public readonly month?: number,
        public readonly entry?: JournalEntry,
        public readonly description?: string
    ) {
        super(label, collapsibleState);
        this.description = description;

        // Set icons based on type
        switch (contextValue) {
            case 'year':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'month':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'entry':
                this.iconPath = new vscode.ThemeIcon('file-text');
                // Check if this is today's entry
                if (entry) {
                    const today = new Date();
                    if (
                        entry.date.getFullYear() === today.getFullYear() &&
                        entry.date.getMonth() === today.getMonth() &&
                        entry.date.getDate() === today.getDate()
                    ) {
                        this.iconPath = new vscode.ThemeIcon('star-full');
                        this.description = 'Today';
                    }
                }
                break;
        }

        // Set tooltip
        if (entry) {
            const date = entry.date;
            const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const months = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];

            this.tooltip = `${weekdays[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
        }
    }
}
