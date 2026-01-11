import * as vscode from 'vscode';
import { JournalManager } from './journal/journalManager';
import { JournalTreeProvider } from './journal/journalTreeProvider';
import { JournalCalendarProvider } from './journal/calendarView';
import { JournalStatusBar } from './journal/statusBar';
import { registerJournalCommands } from './journal/commands';
import { ScimaxDb } from './database/scimaxDb';
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
    BibliographyCodeLensProvider,
    BibliographyHoverProvider,
    RefHoverProvider,
    registerCiteActionCommand
} from './references/providers';
import { NotebookManager } from './notebook/notebookManager';
import { registerNotebookCommands } from './notebook/commands';
import { NotebookTreeProvider } from './notebook/notebookTreeProvider';
import { OrgLinkProvider, registerOrgLinkCommands } from './parser/orgLinkProvider';
import { registerSemanticTokenProvider } from './highlighting/semanticTokenProvider';
import { registerFoldingProvider } from './highlighting/foldingProvider';
import { registerCheckboxFeatures } from './markdown/checkboxProvider';
import { registerTaskCommands } from './markdown/taskCommands';
import { registerTimestampCommands } from './org/timestampProvider';
import { registerTableCommands, isInTable } from './org/tableProvider';
import { registerHeadingCommands } from './org/headingProvider';
import { ProjectileManager } from './projectile/projectileManager';
import { registerProjectileCommands } from './projectile/commands';
import { registerSwiperCommands } from './swiper/commands';

let journalManager: JournalManager;
let journalStatusBar: JournalStatusBar;
let scimaxDb: ScimaxDb;
let referenceManager: ReferenceManager;
let notebookManager: NotebookManager;
let projectileManager: ProjectileManager;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Scimax VS Code extension activating...');

    // Initialize Journal Manager
    journalManager = new JournalManager(context);

    // Initialize Scimax Database (SQLite with FTS5 and vector search)
    scimaxDb = new ScimaxDb(context);
    await scimaxDb.initialize();

    // Setup embedding service for semantic search (if configured)
    const embeddingService = createEmbeddingService();
    if (embeddingService) {
        scimaxDb.setEmbeddingService(embeddingService);
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
    registerDbCommands(context, scimaxDb);

    // Auto-index on activation if workspace is open
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        // Index in background without blocking
        setTimeout(async () => {
            for (const folder of workspaceFolders) {
                await scimaxDb.indexDirectory(folder.uri.fsPath);
            }
            const stats = await scimaxDb.getStats();
            console.log(`Scimax: Indexed ${stats.files} files`);
        }, 1000);
    }

    // Watch for file changes to update index (org, md, ipynb)
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{org,md,ipynb}');
    context.subscriptions.push(
        watcher.onDidChange(async (uri) => {
            await scimaxDb.indexFile(uri.fsPath);
        }),
        watcher.onDidCreate(async (uri) => {
            await scimaxDb.indexFile(uri.fsPath);
        }),
        watcher.onDidDelete(async (uri) => {
            // Remove deleted file from index
            await scimaxDb.removeFile(uri.fsPath);
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
    try {
        console.log('Scimax: Initializing ReferenceManager...');
        referenceManager = new ReferenceManager(context);
        await referenceManager.initialize();
        context.subscriptions.push({ dispose: () => referenceManager.dispose() });
        console.log('Scimax: ReferenceManager initialized successfully');

        // Register Reference Commands
        console.log('Scimax: Registering reference commands...');
        registerReferenceCommands(context, referenceManager);
        console.log('Scimax: Reference commands registered');

        // Register cite action command (for clickable cite links)
        registerCiteActionCommand(context, referenceManager);
        console.log('Scimax: Cite action command registered');
    } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error('Scimax: Failed to initialize ReferenceManager:', errorMsg, error?.stack);
        vscode.window.showErrorMessage(`Scimax reference initialization failed: ${errorMsg}`);
    }

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

    // Register Bibliography Hover Provider (for #+BIBLIOGRAPHY: links)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            documentSelector,
            new BibliographyHoverProvider(referenceManager)
        )
    );

    // Register Ref Hover Provider (for ref:, eqref:, etc. links)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            documentSelector,
            new RefHoverProvider()
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

    // Register Org Link Provider (for [[link]] syntax)
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            { language: 'org', scheme: 'file' },
            new OrgLinkProvider()
        )
    );

    // Register Org Link navigation commands
    registerOrgLinkCommands(context);

    // Register Semantic Token Provider for org-mode
    registerSemanticTokenProvider(context);
    console.log('Scimax: Semantic token provider registered');

    // Register Folding Provider for org-mode
    registerFoldingProvider(context);
    console.log('Scimax: Folding provider registered');

    // Register Markdown Checkbox Features
    registerCheckboxFeatures(context);
    console.log('Scimax: Checkbox features registered');

    // Register Markdown Task Commands
    registerTaskCommands(context);
    console.log('Scimax: Task commands registered');

    // Register Timestamp Commands (shift-arrow to adjust dates)
    registerTimestampCommands(context);
    console.log('Scimax: Timestamp commands registered');

    // Register Table Commands (row/column manipulation)
    registerTableCommands(context);
    console.log('Scimax: Table commands registered');

    // Register Heading Commands (promote/demote/move)
    registerHeadingCommands(context);
    console.log('Scimax: Heading commands registered');

    // Track cursor position to set context for keybinding differentiation
    // This enables different keybindings when cursor is in a table vs on a heading
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;
            const position = editor.selection.active;

            // Only check for org/markdown files
            if (document.languageId === 'org' || document.languageId === 'markdown') {
                const inTable = isInTable(document, position);
                vscode.commands.executeCommand('setContext', 'scimax.inTable', inTable);
            }
        })
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

    // Register Database Menu Command (Hyper-V)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.showDbMenu', async () => {
            const items: (vscode.QuickPickItem & { command: string })[] = [
                { label: '$(search) Search All Files', description: 'Full-text search across indexed files', command: 'scimax.db.search' },
                { label: '$(symbol-class) Search Headings', description: 'Search by heading text', command: 'scimax.db.searchHeadings' },
                { label: '$(code) Search Code Blocks', description: 'Search source code blocks', command: 'scimax.db.searchBlocks' },
                { label: '$(calendar) Show Agenda', description: 'View tasks by date', command: 'scimax.markdown.showAgenda' },
                { label: '$(checklist) Today\'s Tasks', description: 'Tasks due or scheduled today', command: 'scimax.markdown.showTodaysTasks' },
                { label: '$(tag) Search by Tag', description: 'Filter tasks by #tag', command: 'scimax.markdown.showTasksByTag' },
                { label: '$(project) Search by Project', description: 'Filter tasks by @project', command: 'scimax.markdown.showTasksByProject' },
                { label: '$(check) Show TODOs', description: 'All TODO items from org files', command: 'scimax.db.showTodos' },
                { label: '$(clock) Deadlines', description: 'Upcoming deadlines', command: 'scimax.db.deadlines' },
                { label: '$(book) Search References', description: 'Search bibliography entries', command: 'scimax.ref.searchReferences' },
                { label: '$(notebook) Open Notebook', description: 'Open a scimax notebook', command: 'scimax.notebook.open' },
                { label: '$(sync) Reindex Files', description: 'Rebuild the search index', command: 'scimax.db.reindex' },
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Scimax Database (Ctrl+Cmd+V)',
                matchOnDescription: true
            });

            if (selected) {
                await vscode.commands.executeCommand(selected.command);
            }
        })
    );

    // Initialize Notebook Manager
    notebookManager = new NotebookManager(context);
    await notebookManager.initialize();
    context.subscriptions.push({ dispose: () => notebookManager.dispose() });

    // Register Notebook Commands
    registerNotebookCommands(context, notebookManager, scimaxDb);

    // Register Notebook Tree View
    const notebookTreeProvider = new NotebookTreeProvider(notebookManager);
    vscode.window.registerTreeDataProvider('scimax.notebooks', notebookTreeProvider);

    // Refresh notebook tree when notebooks change
    context.subscriptions.push(
        notebookManager.onNotebookChanged(() => notebookTreeProvider.refresh())
    );

    // Initialize Projectile Manager (project switching)
    projectileManager = new ProjectileManager(context);
    await projectileManager.initialize();
    context.subscriptions.push({ dispose: () => projectileManager.dispose() });

    // Register Projectile Commands
    registerProjectileCommands(context, projectileManager);
    console.log('Scimax: Projectile manager initialized');

    // Register Swiper Commands (search current/all open files)
    registerSwiperCommands(context);
}

export async function deactivate() {
    // Close database connection
    if (scimaxDb) {
        await scimaxDb.close();
    }
}
