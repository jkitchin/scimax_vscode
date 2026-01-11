import * as vscode from 'vscode';
import { JournalManager } from './journalManager';

/**
 * Status bar item showing journal information
 */
export class JournalStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private manager: JournalManager;

    constructor(manager: JournalManager) {
        this.manager = manager;

        // Create status bar item (right side, lower priority = more to the right)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        this.statusBarItem.command = 'scimax.journal.today';
        this.statusBarItem.tooltip = 'Click to open today\'s journal';

        // Update on editor change
        vscode.window.onDidChangeActiveTextEditor(() => this.update());
        vscode.workspace.onDidSaveTextDocument(() => this.update());

        // Initial update
        this.update();
        this.statusBarItem.show();
    }

    public update(): void {
        const editor = vscode.window.activeTextEditor;

        if (editor && this.manager.isJournalFile(editor.document.uri.fsPath)) {
            // Show detailed info for journal file
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
            // Show streak and quick access
            const totalStats = this.manager.getTotalStats();

            let text = '$(notebook) Journal';

            if (totalStats.streak > 0) {
                text += ` | ${totalStats.streak} day streak`;
            }

            this.statusBarItem.text = text;
            this.statusBarItem.tooltip = `${totalStats.entryCount} entries | ${totalStats.totalWords} total words | Click to open today's journal`;
        }
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
}
