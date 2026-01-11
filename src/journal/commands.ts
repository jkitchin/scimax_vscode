import * as vscode from 'vscode';
import { JournalManager } from './journalManager';
import { JournalTreeProvider } from './journalTreeProvider';

export function registerJournalCommands(
    context: vscode.ExtensionContext,
    manager: JournalManager,
    treeProvider: JournalTreeProvider
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
            await manager.openEntry(date);
            treeProvider.refresh();
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
                const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const weekday = weekdays[date.getDay()];
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
            const query = await vscode.window.showInputBox({
                prompt: 'Search journal entries',
                placeHolder: 'Enter search term...'
            });

            if (!query) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Searching journal...',
                cancellable: false
            }, async () => {
                const results = await manager.searchEntries(query);

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${query}"`);
                    return;
                }

                // Create quick pick items from results
                const items = results.flatMap(result => {
                    const date = result.entry.date;
                    const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;

                    return result.matches.slice(0, 3).map(match => ({
                        label: `$(file) ${dateStr}`,
                        description: match.length > 80 ? match.substring(0, 80) + '...' : match,
                        entry: result.entry
                    }));
                });

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `${results.length} entries found for "${query}"`,
                    matchOnDescription: true
                });

                if (selected) {
                    await manager.openEntry(selected.entry.date);

                    // Highlight the search term
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const document = editor.document;
                        const text = document.getText();
                        const index = text.toLowerCase().indexOf(query.toLowerCase());
                        if (index !== -1) {
                            const position = document.positionAt(index);
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(
                                new vscode.Range(position, position),
                                vscode.TextEditorRevealType.InCenter
                            );
                        }
                    }
                }
            });
        })
    );

    // Show calendar view (opens the tree view panel)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.calendar', async () => {
            // Focus the journal tree view
            await vscode.commands.executeCommand('scimax.journal.focus');
        })
    );

    // Refresh tree view
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.journal.refresh', () => {
            treeProvider.refresh();
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
}
