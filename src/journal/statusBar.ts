import * as vscode from 'vscode';
import { JournalManager } from './journalManager';

/**
 * Status bar item showing journal information
 */
export class JournalStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private manager: JournalManager;
    private disposables: vscode.Disposable[] = [];
    private updatePending = false;

    constructor(manager: JournalManager) {
        this.manager = manager;

        // Create status bar item (right side, lower priority = more to the right)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        this.statusBarItem.command = 'scimax.journal.today';
        this.statusBarItem.tooltip = 'Click to open today\'s journal';

        // Update on editor change (debounced)
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.scheduleUpdate()),
            vscode.workspace.onDidSaveTextDocument((doc) => {
                // Only update if saving a journal file
                if (this.manager.isJournalFile(doc.uri.fsPath)) {
                    this.scheduleUpdate();
                }
            }),
            // Listen for journal entry changes
            manager.onDidChangeEntries(() => this.scheduleUpdate())
        );

        // Initial update (async)
        this.updateAsync();
        this.statusBarItem.show();
    }

    /**
     * Schedule an update (debounced to avoid rapid updates)
     */
    private scheduleUpdate(): void {
        if (this.updatePending) return;
        this.updatePending = true;

        // Debounce updates by 100ms
        setTimeout(() => {
            this.updatePending = false;
            this.updateAsync();
        }, 100);
    }

    /**
     * Update status bar asynchronously
     */
    private async updateAsync(): Promise<void> {
        const editor = vscode.window.activeTextEditor;

        if (editor && this.manager.isJournalFile(editor.document.uri.fsPath)) {
            // Show detailed info for journal file (this is fast, no async needed)
            const date = this.manager.getDateFromPath(editor.document.uri.fsPath);
            if (date) {
                const entry = this.manager.getEntry(date);
                const stats = this.manager.getEntryStats(entry);

                const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const weekday = weekdays[date.getDay()];

                // Format: "📓 Mon 01/15 | 250 words | 2/5 tasks"
                const dateStr = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
                let text = `$(notebook) ${weekday} ${dateStr}`;

                if (stats.wordCount > 0) {
                    text += ` | ${stats.wordCount} words`;
                }

                if (stats.taskCount > 0) {
                    text += ` | ${stats.doneCount}/${stats.taskCount} tasks`;
                }

                this.statusBarItem.text = text;

                // Check if today
                const today = new Date();
                const isToday = date.getFullYear() === today.getFullYear() &&
                               date.getMonth() === today.getMonth() &&
                               date.getDate() === today.getDate();

                this.statusBarItem.tooltip = isToday
                    ? 'Today\'s journal entry'
                    : `Journal entry for ${date.toLocaleDateString()}`;
            }
        } else {
            // Show streak and quick access (use async to avoid blocking)
            // Start with basic text while loading
            this.statusBarItem.text = '$(notebook) Journal';

            try {
                const totalStats = await this.manager.getTotalStatsAsync();

                let text = '$(notebook) Journal';

                if (totalStats.streak > 0) {
                    text += ` | ${totalStats.streak} day streak`;
                }

                this.statusBarItem.text = text;
                this.statusBarItem.tooltip = `${totalStats.entryCount} entries | ${totalStats.totalWords} total words | Click to open today's journal`;
            } catch {
                // Keep basic text on error
                this.statusBarItem.tooltip = 'Click to open today\'s journal';
            }
        }
    }

    public dispose(): void {
        this.statusBarItem.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
