import * as vscode from 'vscode';
import { JournalManager } from './journal/journalManager';
import { JournalTreeProvider } from './journal/journalTreeProvider';
import { JournalCalendarProvider } from './journal/calendarView';
import { registerJournalCommands } from './journal/commands';
import { OrgDb } from './database/orgDb';
import { registerDbCommands } from './database/commands';

let journalManager: JournalManager;
let orgDb: OrgDb;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Scimax VS Code extension is now active');

    // Initialize Journal Manager
    journalManager = new JournalManager(context);

    // Initialize Org Database
    orgDb = new OrgDb(context);
    await orgDb.initialize();

    // Register Journal Tree View
    const journalTreeProvider = new JournalTreeProvider(journalManager);
    vscode.window.registerTreeDataProvider('scimax.journal', journalTreeProvider);

    // Register Journal Calendar WebView
    const calendarProvider = new JournalCalendarProvider(journalManager, context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            JournalCalendarProvider.viewType,
            calendarProvider
        )
    );

    // Register Journal Commands
    registerJournalCommands(context, journalManager, journalTreeProvider);

    // Register Database Commands
    registerDbCommands(context, orgDb);

    // Auto-index on activation if workspace is open
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        // Index in background without blocking
        setTimeout(async () => {
            for (const folder of workspaceFolders) {
                await orgDb.indexDirectory(folder.uri.fsPath);
            }
            const stats = orgDb.getStats();
            console.log(`Scimax: Indexed ${stats.files} files`);
        }, 1000);
    }

    // Watch for file changes to update index
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{org,md}');
    context.subscriptions.push(
        watcher.onDidChange(async (uri) => {
            await orgDb.indexFile(uri.fsPath);
        }),
        watcher.onDidCreate(async (uri) => {
            await orgDb.indexFile(uri.fsPath);
        }),
        watcher.onDidDelete(async (uri) => {
            // Re-index to remove deleted file
            await orgDb.indexFile(uri.fsPath);
        }),
        watcher
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.journal')) {
                journalManager.reloadConfig();
                journalTreeProvider.refresh();
            }
        })
    );

    // Status bar item showing current journal entry date
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'scimax.journal.today';
    statusBarItem.tooltip = 'Open today\'s journal';
    context.subscriptions.push(statusBarItem);

    // Update status bar on active editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            updateStatusBar(editor, statusBarItem);
        })
    );

    // Initial status bar update
    updateStatusBar(vscode.window.activeTextEditor, statusBarItem);
}

function updateStatusBar(
    editor: vscode.TextEditor | undefined,
    statusBarItem: vscode.StatusBarItem
): void {
    if (editor && journalManager.isJournalFile(editor.document.uri.fsPath)) {
        const date = journalManager.getDateFromPath(editor.document.uri.fsPath);
        if (date) {
            statusBarItem.text = `$(calendar) ${formatDate(date)}`;
            statusBarItem.show();
            return;
        }
    }
    // Show icon only when not in a journal file
    statusBarItem.text = '$(calendar)';
    statusBarItem.show();
}

function formatDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    };
    return date.toLocaleDateString(undefined, options);
}

export function deactivate() {
    // Cleanup if needed
}
