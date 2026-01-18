import * as vscode from 'vscode';
import { JournalManager } from './journalManager';
import { DAY_NAMES_SHORT } from '../utils/dateConstants';

export function registerJournalCommands(
    context: vscode.ExtensionContext,
    manager: JournalManager
): void {
    // Open today's journal
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.today', async () => {
            await manager.openEntry(new Date());
        })
    );

    // Create new journal entry for a specific date
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.new', async () => {
            // Ask for template first
            const templates = manager.getAvailableTemplates();
            const templateItems = templates.map(t => ({
                label: t === 'default' ? `$(file) ${t} (default)` : `$(file) ${t}`,
                value: t
            }));

            const templateSelection = await vscode.window.showQuickPick(templateItems, {
                placeHolder: 'Select a template'
            });

            if (!templateSelection) return;

            const dateStr = await vscode.window.showInputBox({
                prompt: 'Enter date (YYYY-MM-DD) or leave empty for today',
                placeHolder: 'YYYY-MM-DD',
                validateInput: (value) => {
                    if (!value) return null; // Empty is valid (means today)
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                        return 'Please enter date in YYYY-MM-DD format';
                    }
                    const date = new Date(value);
                    if (isNaN(date.getTime())) {
                        return 'Invalid date';
                    }
                    return null;
                }
            });

            if (dateStr === undefined) return; // Cancelled

            const date = dateStr ? new Date(dateStr) : new Date();

            // Check if entry already exists
            const existingEntry = manager.getEntry(date);
            if (existingEntry.exists) {
                const overwrite = await vscode.window.showWarningMessage(
                    `An entry for ${dateStr || 'today'} already exists. Open it instead?`,
                    'Open Existing', 'Cancel'
                );
                if (overwrite === 'Open Existing') {
                    await manager.openEntry(date);
                }
                return;
            }

            await manager.createEntryWithTemplate(date, templateSelection.value);
            await manager.openEntry(date);
        })
    );

    // Navigate to previous journal entry
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.prev', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await manager.navigateEntry(editor.document.uri.fsPath, 'prev');
            }
        })
    );

    // Navigate to next journal entry
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.next', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await manager.navigateEntry(editor.document.uri.fsPath, 'next');
            }
        })
    );

    // Go to a specific date
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.goto', async () => {
            const entries = manager.getAllEntries();

            if (entries.length === 0) {
                vscode.window.showInformationMessage('No journal entries found');
                return;
            }

            // Create quick pick items from entries
            const items = entries.reverse().map(entry => {
                const date = entry.date;
                const weekday = DAY_NAMES_SHORT[date.getDay()];
                const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;

                return {
                    label: `$(calendar) ${dateStr}`,
                    description: weekday,
                    date: entry.date
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a journal entry',
                matchOnDescription: true
            });

            if (selected) {
                await manager.openEntry(selected.date);
            }
        })
    );

    // Search journal entries
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.search', async () => {
            // First ask for date range
            const rangeOptions = [
                { label: '$(calendar) All entries', value: 'all' as const },
                { label: '$(clock) This week', value: 'week' as const },
                { label: '$(calendar) This month', value: 'month' as const },
                { label: '$(calendar) This year', value: 'year' as const }
            ];

            const rangeSelection = await vscode.window.showQuickPick(rangeOptions, {
                placeHolder: 'Select date range to search'
            });

            if (!rangeSelection) return;

            const query = await vscode.window.showInputBox({
                prompt: `Search journal entries (${rangeSelection.label.replace(/\$\([^)]+\)\s*/, '')})`,
                placeHolder: 'Enter search term...'
            });

            if (!query) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Searching journal...',
                cancellable: false
            }, async () => {
                const results = await manager.searchInDateRange(query, rangeSelection.value);

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${query}"`);
                    return;
                }

                // Create quick pick items from results
                const items = results.flatMap(result => {
                    const date = result.entry.date;
                    const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;

                    return result.matches.slice(0, 3).map((match, i) => ({
                        label: `$(file) ${dateStr}`,
                        description: match.length > 80 ? match.substring(0, 80) + '...' : match,
                        detail: `Line ${result.lineNumbers[i]}`,
                        entry: result.entry,
                        lineNumber: result.lineNumbers[i]
                    }));
                });

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `${results.length} entries found for "${query}"`,
                    matchOnDescription: true
                });

                if (selected) {
                    await manager.openEntry(selected.entry.date);

                    // Jump to the specific line
                    const editor = vscode.window.activeTextEditor;
                    if (editor && selected.lineNumber) {
                        const line = selected.lineNumber - 1;
                        const position = new vscode.Position(line, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                    }
                }
            });
        })
    );

    // Show calendar view (opens the calendar webview in the sidebar)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.calendar', async () => {
            // Focus the journal calendar webview
            await vscode.commands.executeCommand('scimax.journal.calendar.focus');
        })
    );

    // Open journal directory in explorer
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.openDirectory', async () => {
            const dir = manager.getJournalDirectory();
            const uri = vscode.Uri.file(dir);
            await vscode.commands.executeCommand('revealFileInOS', uri);
        })
    );

    // Insert timestamp at cursor
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.insertTimestamp', () => {
            manager.insertTimestamp();
        })
    );

    // Add quick log entry
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.quickLog', async () => {
            const text = await vscode.window.showInputBox({
                prompt: 'Quick log entry',
                placeHolder: 'Enter log text...'
            });

            if (text) {
                await manager.addLogEntry(text);
            }
        })
    );

    // Show journal statistics
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.stats', async () => {
            const stats = manager.getTotalStats();

            const message = [
                `Total entries: ${stats.entryCount}`,
                `Total words: ${stats.totalWords.toLocaleString()}`,
                `Current streak: ${stats.streak} day${stats.streak !== 1 ? 's' : ''}`,
                `Longest streak: ${stats.longestStreak} day${stats.longestStreak !== 1 ? 's' : ''}`
            ].join(' | ');

            vscode.window.showInformationMessage(message);
        })
    );

    // Week view - show entries for current week
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.weekView', async () => {
            const entries = manager.getEntriesForWeek();

            if (entries.length === 0) {
                vscode.window.showInformationMessage('No journal entries this week');
                return;
            }

            const items = entries.map(entry => {
                const date = entry.date;
                const weekday = DAY_NAMES_SHORT[date.getDay()];
                const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
                const stats = manager.getEntryStats(entry);

                return {
                    label: `$(calendar) ${weekday} ${dateStr}`,
                    description: `${stats.wordCount} words`,
                    detail: stats.taskCount > 0 ? `${stats.doneCount}/${stats.taskCount} tasks completed` : undefined,
                    date: entry.date
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `This week: ${entries.length} entries`
            });

            if (selected) {
                await manager.openEntry(selected.date);
            }
        })
    );
}
