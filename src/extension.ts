import * as vscode from 'vscode';
import { JournalManager } from './journal/journalManager';
import { JournalTreeProvider } from './journal/journalTreeProvider';
import { JournalCalendarProvider } from './journal/calendarView';
import { JournalStatusBar } from './journal/statusBar';
import { registerJournalCommands } from './journal/commands';
// Database imports disabled to prevent SQLite module loading on startup
// These will be imported dynamically when database is re-enabled
// import { ScimaxDb } from './database/scimaxDb';
// import { registerDbCommands } from './database/commands';
// import { createEmbeddingService } from './database/embeddingService';
import { ReferenceManager } from './references/referenceManager';
import { registerReferenceCommands } from './references/commands';
import {
    CitationHoverProvider,
    CitationCompletionProvider,
    CitationDefinitionProvider,
    CitationLinkProvider,
    BibliographyCodeLensProvider,
    BibliographyHoverProvider,
    RefHoverProvider,
    DoiHoverProvider,
    registerCiteActionCommand
} from './references/providers';
import { NotebookManager } from './notebook/notebookManager';
import { registerNotebookCommands } from './notebook/commands';
import { OrgLinkProvider, registerOrgLinkCommands } from './parser/orgLinkProvider';
import { registerSemanticTokenProvider } from './highlighting/semanticTokenProvider';
import { registerFoldingProvider } from './highlighting/foldingProvider';
import { registerBlockDecorations } from './highlighting/blockDecorations';
import { registerCheckboxFeatures } from './markdown/checkboxProvider';
import { registerTaskCommands } from './markdown/taskCommands';
import { registerTimestampCommands } from './org/timestampProvider';
import { registerTableCommands, isInTable } from './org/tableProvider';
import { registerHeadingCommands } from './org/headingProvider';
import { registerDocumentSymbolProvider } from './org/documentSymbolProvider';
import { registerOrgCompletionProvider } from './org/completionProvider';
import { registerOrgHoverProvider } from './org/hoverProvider';
import { registerBabelCommands, registerBabelCodeLens } from './org/babelProvider';
import { registerExportCommands } from './org/exportProvider';
import { registerScimaxOrgCommands } from './org/scimaxOrg';
import { registerScimaxObCommands } from './org/scimaxOb';
// Jupyter commands imported dynamically to handle zeromq errors gracefully
// import { registerJupyterCommands } from './jupyter/commands';
import { ProjectileManager } from './projectile/projectileManager';
import { registerProjectileCommands } from './projectile/commands';
import { ProjectTreeProvider } from './projectile/projectTreeProvider';
import { registerFuzzySearchCommands } from './fuzzySearch/commands';
import { registerJumpCommands } from './jump/commands';
import { registerCitationManipulationCommands, checkCitationContext } from './references/citationManipulation';
import { registerEditmarkCommands } from './editmarks/editmarks';
import { HydraManager, registerHydraCommands, scimaxMenus } from './hydra';

let journalManager: JournalManager;
let hydraManager: HydraManager;
let journalStatusBar: JournalStatusBar;
// let scimaxDb: ScimaxDb;  // Disabled while investigating memory issues
let referenceManager: ReferenceManager;
let notebookManager: NotebookManager;
let projectileManager: ProjectileManager;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Scimax VS Code extension activating...');

    // Set Leuven as default theme on first activation
    const hasSetDefaultTheme = context.globalState.get<boolean>('scimax.hasSetDefaultTheme');
    if (!hasSetDefaultTheme) {
        const config = vscode.workspace.getConfiguration('workbench');
        const currentTheme = config.get<string>('colorTheme');
        // Only set if user hasn't explicitly chosen another theme or is using a default
        if (!currentTheme || currentTheme === 'Default Dark+' || currentTheme === 'Default Light+' ||
            currentTheme === 'Visual Studio Dark' || currentTheme === 'Visual Studio Light') {
            await config.update('colorTheme', 'Leuven', vscode.ConfigurationTarget.Global);
            console.log('Scimax: Set Leuven as default color theme');
        }
        await context.globalState.update('scimax.hasSetDefaultTheme', true);
    }

    // Initialize Journal Manager
    journalManager = new JournalManager(context);

    // Database initialization disabled to investigate memory issues
    // TODO: Make database lazy-load on first use
    // scimaxDb = new ScimaxDb(context);
    // await scimaxDb.initialize();
    // const embeddingService = createEmbeddingService();
    // if (embeddingService) {
    //     scimaxDb.setEmbeddingService(embeddingService);
    //     console.log('Scimax: Semantic search enabled');
    // }
    console.log('Scimax: Database disabled (pending investigation)');

    // Journal Tree View disabled while investigating performance issues
    // The tree view calls getAllEntries() which does synchronous recursive directory scanning
    // const journalTreeProvider = new JournalTreeProvider(journalManager);
    // vscode.window.registerTreeDataProvider('scimax.journal', journalTreeProvider);

    // // Register Journal Calendar WebView
    // const calendarProvider = new JournalCalendarProvider(journalManager, context.extensionUri);
    // context.subscriptions.push(
    //     vscode.window.registerWebviewViewProvider(
    //         JournalCalendarProvider.viewType,
    //         calendarProvider
    //     )
    // );

    // Register Journal Commands (passing null for tree provider while disabled)
    registerJournalCommands(context, journalManager, null as any);
    console.log('Scimax: Journal tree view disabled (pending investigation)');

    // Register Database Commands (disabled while investigating memory issues)
    // registerDbCommands(context, scimaxDb);

    // Auto-indexing and file watching disabled while investigating memory issues
    // const config = vscode.workspace.getConfiguration('scimax.db');
    // const autoIndex = config.get<boolean>('autoIndex', false);
    // if (autoIndex) { ... }

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.journal')) {
                journalManager.reloadConfig();
                // journalTreeProvider.refresh(); // Tree view disabled
            }
        })
    );

    // Journal status bar disabled - getTotalStats() calls getAllEntries() which scans filesystem
    // journalStatusBar = new JournalStatusBar(journalManager);
    // context.subscriptions.push({ dispose: () => journalStatusBar.dispose() });
    console.log('Scimax: Journal status bar disabled (pending investigation)');

    // Initialize Reference Manager (deferred to avoid blocking extension host)
    try {
        console.log('Scimax: Initializing ReferenceManager...');
        referenceManager = new ReferenceManager(context);
        context.subscriptions.push({ dispose: () => referenceManager.dispose() });
        // Defer bibliography loading to avoid blocking extension activation
        // Use setImmediate to yield to the event loop
        setImmediate(async () => {
            try {
                await referenceManager.initialize();
                console.log('Scimax: ReferenceManager initialized successfully');
            } catch (error: any) {
                console.error('Scimax: Failed to load bibliographies:', error?.message || error);
            }
        });

        // Register Reference Commands (commands work even before bib files are loaded)
        registerReferenceCommands(context, referenceManager);

        // Register cite action command (for clickable cite links)
        registerCiteActionCommand(context, referenceManager);
        console.log('Scimax: Cite action command registered');

        // Register citation manipulation commands (transpose, sort)
        registerCitationManipulationCommands(context, (key) => referenceManager.getEntry(key));
        checkCitationContext(context);
        console.log('Scimax: Citation manipulation commands registered');
    } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error('Scimax: Failed to initialize ReferenceManager:', errorMsg, error?.stack);
        vscode.window.showErrorMessage(`Scimax reference initialization failed: ${errorMsg}`);
    }


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

    // Register DOI Hover Provider (fetches metadata from CrossRef)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            documentSelector,
            new DoiHoverProvider(referenceManager)
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

    // Register Block Decorations (background colors for src blocks, etc.)
    registerBlockDecorations(context);

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

    // Register Document Symbol Provider (for outline view)
    registerDocumentSymbolProvider(context);
    console.log('Scimax: Document symbol provider registered');

    // Register Org Completion Provider (for intelligent completions)
    registerOrgCompletionProvider(context);
    console.log('Scimax: Org completion provider registered');

    // Register Org Hover Provider (for entities, timestamps, blocks, etc.)
    registerOrgHoverProvider(context);
    console.log('Scimax: Org hover provider registered');

    // Register Babel commands and Code Lens (for source block execution)
    registerBabelCommands(context);
    registerBabelCodeLens(context);
    console.log('Scimax: Babel code execution registered');

    // Register Export commands (for exporting to HTML, LaTeX, PDF, Markdown)
    registerExportCommands(context);
    console.log('Scimax: Export commands registered');

    // Jupyter kernel support disabled to prevent memory issues
    // TODO: Investigate zeromq memory consumption
    // try {
    //     const { registerJupyterCommands } = await import('./jupyter/commands');
    //     registerJupyterCommands(context);
    //     console.log('Scimax: Jupyter kernel support registered');
    // } catch (error) {
    //     console.warn('Scimax: Jupyter kernel support unavailable (zeromq not loaded)');
    //     console.log('Scimax: jupyter-* blocks will not work, but regular python/shell blocks will');
    // }
    console.log('Scimax: Jupyter kernel support disabled (pending investigation)');

    // Register Scimax-org commands (text markup, DWIM return, navigation)
    registerScimaxOrgCommands(context);
    console.log('Scimax: Scimax-org commands registered');

    // Register Scimax-ob commands (source block manipulation)
    registerScimaxObCommands(context);
    console.log('Scimax: Scimax-ob commands registered');

    console.log('Scimax: [DEBUG] About to register selection handler...');
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
    console.log('Scimax: [DEBUG] Selection handler registered');

    console.log('Scimax: [DEBUG] About to register BibliographyCodeLensProvider...');
    // Register Bibliography Code Lens Provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'bibtex', scheme: 'file' },
            new BibliographyCodeLensProvider(referenceManager)
        )
    );
    console.log('Scimax: [DEBUG] BibliographyCodeLensProvider registered');

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

    console.log('Scimax: [DEBUG] About to initialize NotebookManager...');
    // Initialize Notebook Manager
    notebookManager = new NotebookManager(context);
    await notebookManager.initialize();
    context.subscriptions.push({ dispose: () => notebookManager.dispose() });
    console.log('Scimax: [DEBUG] NotebookManager initialized');

    // Register Notebook Commands (passing null for scimaxDb while investigating)
    registerNotebookCommands(context, notebookManager, null as any);
    console.log('Scimax: [DEBUG] NotebookCommands registered');


    // Projectile Manager disabled while investigating performance issues
    // console.log('Scimax: [DEBUG] About to initialize ProjectileManager...');
    // // Initialize Projectile Manager (project switching)
    // projectileManager = new ProjectileManager(context);
    // await projectileManager.initialize();
    // context.subscriptions.push({ dispose: () => projectileManager.dispose() });
    // console.log('Scimax: [DEBUG] ProjectileManager initialized');

    // // Register Projectile Commands
    // registerProjectileCommands(context, projectileManager);

    // // Register Project Tree View
    // const projectTreeProvider = new ProjectTreeProvider(projectileManager);
    // vscode.window.registerTreeDataProvider('scimax.projects', projectTreeProvider);

    // // Command to open project from tree view
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('scimax.projectile.openProject', async (project) => {
    //         const uri = vscode.Uri.file(project.path);
    //         await projectileManager.touchProject(project.path);

    //         const currentFolders = vscode.workspace.workspaceFolders || [];
    //         if (currentFolders.some(f => f.uri.fsPath === project.path)) {
    //             vscode.window.showInformationMessage(`Project ${project.name} is already open`);
    //             return;
    //         }

    //         const openIn = await vscode.window.showQuickPick([
    //             { label: '$(window) New Window', value: 'new' },
    //             { label: '$(folder-opened) Current Window', value: 'current' },
    //             { label: '$(add) Add to Workspace', value: 'add' }
    //         ], { placeHolder: `Open ${project.name}` });

    //         if (!openIn) return;

    //         switch (openIn.value) {
    //             case 'new':
    //                 await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    //                 break;
    //             case 'current':
    //                 await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
    //                 break;
    //             case 'add':
    //                 vscode.workspace.updateWorkspaceFolders(
    //                     vscode.workspace.workspaceFolders?.length || 0, 0, { uri }
    //                 );
    //                 break;
    //         }
    //     }),
    //     vscode.commands.registerCommand('scimax.projectile.refreshTree', () => projectTreeProvider.refresh())
    // );
    console.log('Scimax: Projectile manager disabled (pending investigation)');

    // Register Fuzzy Search Commands (search current/all open files)
    registerFuzzySearchCommands(context);

    // Register Jump Commands (avy-style jump to visible locations)
    registerJumpCommands(context);

    // Register Editmark Commands (track changes)
    registerEditmarkCommands(context);
    console.log('Scimax: Editmarks initialized');

    // Initialize Hydra Menu Framework
    hydraManager = new HydraManager(context);
    hydraManager.registerMenus(scimaxMenus);
    registerHydraCommands(context, hydraManager);
    context.subscriptions.push({ dispose: () => hydraManager.dispose() });
    console.log('Scimax: Hydra menu framework initialized');
}

export async function deactivate() {
    // Close database connection (disabled while investigating)
    // if (scimaxDb) {
    //     await scimaxDb.close();
    // }
}
