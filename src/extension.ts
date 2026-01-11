import * as vscode from 'vscode';
import { JournalManager } from './journal/journalManager';
import { JournalTreeProvider } from './journal/journalTreeProvider';
import { JournalCalendarProvider } from './journal/calendarView';
import { JournalStatusBar } from './journal/statusBar';
import { registerJournalCommands } from './journal/commands';
import { OrgDbSqlite } from './database/orgDbSqlite';
import { registerDbCommands } from './database/commands';
import { createEmbeddingService } from './database/embeddingService';
import { ReferenceManager } from './references/referenceManager';
import { registerReferenceCommands } from './references/commands';
import {
    CitationHoverProvider,
    CitationCompletionProvider,
    CitationDefinitionProvider,
    CitationLinkProvider,
    ReferenceTreeProvider,
    BibliographyCodeLensProvider
} from './references/providers';
import { NotebookManager } from './notebook/notebookManager';
import { registerNotebookCommands } from './notebook/commands';
import { NotebookTreeProvider } from './notebook/notebookTreeProvider';

let journalManager: JournalManager;
let journalStatusBar: JournalStatusBar;
let orgDb: OrgDbSqlite;
let referenceManager: ReferenceManager;
let notebookManager: NotebookManager;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Scimax VS Code extension is now active');

    // Initialize Journal Manager
    journalManager = new JournalManager(context);

    // Initialize Org Database (SQLite with FTS5 and vector search)
    orgDb = new OrgDbSqlite(context);
    await orgDb.initialize();

    // Setup embedding service for semantic search (if configured)
    const embeddingService = createEmbeddingService();
    if (embeddingService) {
        orgDb.setEmbeddingService(embeddingService);
        console.log('Scimax: Semantic search enabled');
    }

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
            const stats = await orgDb.getStats();
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

    // Create status bar with journal info (word count, streak, etc.)
    journalStatusBar = new JournalStatusBar(journalManager);
    context.subscriptions.push({ dispose: () => journalStatusBar.dispose() });

    // Initialize Reference Manager
    referenceManager = new ReferenceManager(context);
    await referenceManager.initialize();
    context.subscriptions.push({ dispose: () => referenceManager.dispose() });

    // Register Reference Commands
    registerReferenceCommands(context, referenceManager);

    // Register Reference Tree View
    const referenceTreeProvider = new ReferenceTreeProvider(referenceManager);
    vscode.window.registerTreeDataProvider('scimax.references', referenceTreeProvider);

    // Register Citation Hover Provider (for org and markdown)
    const documentSelector = [
        { language: 'org', scheme: 'file' },
        { language: 'markdown', scheme: 'file' },
        { language: 'latex', scheme: 'file' }
    ];

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            documentSelector,
            new CitationHoverProvider(referenceManager)
        )
    );

    // Register Citation Completion Provider
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            documentSelector,
            new CitationCompletionProvider(referenceManager),
            ':', '@', '{' // Trigger characters
        )
    );

    // Register Citation Definition Provider (go to definition)
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            documentSelector,
            new CitationDefinitionProvider(referenceManager)
        )
    );

    // Register Citation Link Provider
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            documentSelector,
            new CitationLinkProvider(referenceManager)
        )
    );

    // Register Bibliography Code Lens Provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'bibtex', scheme: 'file' },
            new BibliographyCodeLensProvider(referenceManager)
        )
    );

    // Additional reference commands for code lens
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.findCitationsForKey', async (key: string) => {
            const locations = await referenceManager.findCitations(key);
            if (locations.length === 0) {
                vscode.window.showInformationMessage(`No citations found for ${key}`);
            } else {
                vscode.window.showInformationMessage(`Found ${locations.length} citations of ${key}`);
                // Could also show in peek view if editor is available
            }
        }),
        vscode.commands.registerCommand('scimax.ref.copyKey', async (key: string) => {
            await vscode.env.clipboard.writeText(key);
            vscode.window.showInformationMessage(`Copied: ${key}`);
        })
    );

    // Initialize Notebook Manager
    notebookManager = new NotebookManager(context);
    await notebookManager.initialize();
    context.subscriptions.push({ dispose: () => notebookManager.dispose() });

    // Register Notebook Commands
    registerNotebookCommands(context, notebookManager, orgDb);

    // Register Notebook Tree View
    const notebookTreeProvider = new NotebookTreeProvider(notebookManager);
    vscode.window.registerTreeDataProvider('scimax.notebooks', notebookTreeProvider);

    // Refresh notebook tree when notebooks change
    context.subscriptions.push(
        notebookManager.onNotebookChanged(() => notebookTreeProvider.refresh())
    );
}

export async function deactivate() {
    // Close database connection
    if (orgDb) {
        await orgDb.close();
    }
}
