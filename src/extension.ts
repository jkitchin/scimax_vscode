import * as vscode from 'vscode';
import { JournalManager } from './journal/journalManager';
import { JournalCalendarProvider } from './journal/calendarView';
import { JournalStatusBar } from './journal/statusBar';
import { registerJournalCommands } from './journal/commands';
// Database uses lazy loading to avoid blocking extension activation
import { setExtensionContext, closeDatabase } from './database/lazyDb';
import { registerDbCommands } from './database/commands';
import { registerDatabaseView } from './database/databaseViewProvider';
import { registerContextHelp } from './help/contextHelp';
import { ReferenceManager } from './references/referenceManager';
import { registerReferenceCommands } from './references/commands';
import { registerZoteroCommands } from './zotero/commands';
import {
    CitationHoverProvider,
    CitationCompletionProvider,
    CitationDefinitionProvider,
    CitationLinkProvider,
    BibliographyCodeLensProvider,
    BibliographyHoverProvider,
    BibliographyDiagnosticProvider,
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
import { initLatexPreviewCache, clearLatexCache, checkLatexAvailable, getCacheStats } from './org/latexPreviewProvider';
import { registerLatexLivePreviewCommands } from './org/latexLivePreview';
import { registerBabelCommands, registerBabelCodeLens } from './org/babelProvider';
import { registerBabelAdvancedCommands } from './parser/orgBabelAdvanced';
import { registerExportCommands } from './org/exportProvider';
import { registerScimaxOrgCommands } from './org/scimaxOrg';
import { registerScimaxObCommands } from './org/scimaxOb';
import { registerSpeedCommands } from './org/speedCommands';
import { parseStartupOptions, applyStartupVisibility } from './org/speedCommands/visibility';
import { registerImageOverlayCommands } from './org/imageOverlayProvider';
import { registerAgendaCommands } from './org/agendaProvider';
import { registerTableFormulaCommands } from './org/tableFormula';
import { registerCaptureCommands } from './org/captureProvider';
import { OrgLintProvider, registerOrgLintCommands } from './org/orgLintProvider';
// Jupyter commands imported dynamically to handle zeromq errors gracefully
// import { registerJupyterCommands } from './jupyter/commands';
import { ProjectileManager, Project } from './projectile/projectileManager';
import { registerProjectileCommands } from './projectile/commands';
import { ProjectTreeProvider } from './projectile/projectTreeProvider';
import { registerFuzzySearchCommands } from './fuzzySearch/commands';
import { registerJumpCommands } from './jump/commands';
import { registerMarkCommands } from './mark/markRing';
import { registerCitationManipulationCommands, checkCitationContext } from './references/citationManipulation';
import { registerBibtexSpeedCommands } from './references/bibtexSpeedCommands';
import { registerEditmarkCommands } from './editmarks/editmarks';
import { HydraManager, registerHydraCommands, scimaxMenus } from './hydra';
import { registerPublishCommands } from './publishing';
import { registerHelpCommands } from './help';
import { activateLatexFeatures } from './latex/commands';
import { registerDiagnosticCommands } from './diagnostic';
import { TemplateManager, registerTemplateCommands } from './templates';
import { registerManuscriptCommands } from './manuscript';

let journalManager: JournalManager;
let hydraManager: HydraManager;
let journalStatusBar: JournalStatusBar;
let referenceManager: ReferenceManager;
let notebookManager: NotebookManager;
let projectileManager: ProjectileManager;
let templateManager: TemplateManager;

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

    // Set up lazy database loading - database initializes on first use
    setExtensionContext(context);

    // Register Journal Calendar WebView
    const calendarProvider = new JournalCalendarProvider(journalManager, context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            JournalCalendarProvider.viewType,
            calendarProvider
        )
    );

    // Register Journal Commands
    registerJournalCommands(context, journalManager);

    // Register Database Commands (uses lazy loading - db initializes on first command use)
    registerDbCommands(context);

    // Register Database View
    registerDatabaseView(context);

    // Register Context Help
    registerContextHelp(context);

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            // Reload journal manager when journal or root directory changes
            if (e.affectsConfiguration('scimax.journal') || e.affectsConfiguration('scimax.directory')) {
                journalManager.reloadConfig();
            }
            // Reload template manager when templates or root directory changes
            if (e.affectsConfiguration('scimax.templates') || e.affectsConfiguration('scimax.directory')) {
                templateManager?.reloadConfig();
            }
        })
    );

    // Journal status bar (uses async caching for performance)
    journalStatusBar = new JournalStatusBar(journalManager);
    context.subscriptions.push({ dispose: () => journalStatusBar.dispose() });

    // Initialize Reference Manager (deferred to avoid blocking extension host)
    try {
        referenceManager = new ReferenceManager(context);
        context.subscriptions.push({ dispose: () => referenceManager.dispose() });
        // Defer bibliography loading to avoid blocking extension activation
        // Use setImmediate to yield to the event loop
        setImmediate(async () => {
            try {
                await referenceManager.initialize();
            } catch (error: any) {
                console.error('Scimax: Failed to load bibliographies:', error?.message || error);
            }
        });

        // Register Reference Commands (commands work even before bib files are loaded)
        registerReferenceCommands(context, referenceManager);

        // Register Zotero Commands (for inserting citations from Zotero)
        registerZoteroCommands(context, referenceManager);

        // Register cite action command (for clickable cite links)
        registerCiteActionCommand(context, referenceManager);

        // Register citation manipulation commands (transpose, sort)
        registerCitationManipulationCommands(context, (key) => referenceManager.getEntry(key));
        checkCitationContext(context);
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

    // Register Bibliography Diagnostic Provider (shows errors for missing bib files)
    const bibDiagnosticProvider = new BibliographyDiagnosticProvider(referenceManager);
    bibDiagnosticProvider.initialize();
    context.subscriptions.push({ dispose: () => bibDiagnosticProvider.dispose() });

    // Register Org Link navigation commands
    registerOrgLinkCommands(context);

    // Register Semantic Token Provider for org-mode
    registerSemanticTokenProvider(context);

    // Register Folding Provider for org-mode
    registerFoldingProvider(context);

    // Track documents that have had #+STARTUP: folding applied
    const startupAppliedDocs = new Set<string>();

    // Apply #+STARTUP: visibility options when opening org files
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (!editor) return;

            const document = editor.document;
            // Only process org files
            if (document.languageId !== 'org') return;

            const docKey = document.uri.toString();
            // Only apply once per document (per session)
            if (startupAppliedDocs.has(docKey)) return;
            startupAppliedDocs.add(docKey);

            // Parse and apply startup options
            const options = parseStartupOptions(document);
            if (options.length > 0) {
                // Small delay to ensure folding provider is ready
                setTimeout(async () => {
                    await applyStartupVisibility(options);
                }, 100);
            }
        })
    );

    // Clean up tracking when documents are closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            startupAppliedDocs.delete(document.uri.toString());
        })
    );

    // Register Block Decorations (background colors for src blocks, etc.)
    registerBlockDecorations(context);

    // Register Markdown Checkbox Features
    registerCheckboxFeatures(context);

    // Register Markdown Task Commands
    registerTaskCommands(context);

    // Register Timestamp Commands (shift-arrow to adjust dates)
    registerTimestampCommands(context);

    // Register Table Commands (row/column manipulation)
    registerTableCommands(context);

    // Register Heading Commands (promote/demote/move)
    registerHeadingCommands(context);

    // Register Document Symbol Provider (for outline view)
    registerDocumentSymbolProvider(context);

    // Register Org Completion Provider (for intelligent completions)
    registerOrgCompletionProvider(context);

    // Register Org Hover Provider (for entities, timestamps, blocks, etc.)
    registerOrgHoverProvider(context);

    // Initialize LaTeX preview cache for equation rendering
    initLatexPreviewCache(context);

    // Register LaTeX preview commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.clearLatexCache', async () => {
            clearLatexCache();
            vscode.window.showInformationMessage('LaTeX preview cache cleared');
        }),
        vscode.commands.registerCommand('scimax.checkLatexTools', async () => {
            const result = await checkLatexAvailable();
            if (result.available) {
                vscode.window.showInformationMessage(`LaTeX tools: ${result.message}`);
            } else {
                vscode.window.showWarningMessage(`LaTeX tools: ${result.message}`);
            }
        }),
        vscode.commands.registerCommand('scimax.latexCacheStats', () => {
            const stats = getCacheStats();
            const sizeKB = (stats.totalSize / 1024).toFixed(1);
            vscode.window.showInformationMessage(
                `LaTeX cache: ${stats.entryCount} entries, ${sizeKB} KB total`
            );
        })
    );

    // Register LaTeX Live Preview commands (PDF preview with SyncTeX)
    registerLatexLivePreviewCommands(context);

    // Register Babel commands and Code Lens (for source block execution)
    registerBabelCommands(context);
    registerBabelCodeLens(context);

    // Register advanced Babel features (tangling, noweb, caching, async queue)
    registerBabelAdvancedCommands(context);

    // Register Export commands (for exporting to HTML, LaTeX, PDF, Markdown)
    registerExportCommands(context);

    // Register Manuscript commands (flatten LaTeX for journal submission)
    registerManuscriptCommands(context);

    // Register Publishing commands (for multi-file project publishing)
    registerPublishCommands(context);

    // Jupyter kernel support - uses dynamic import for lazy loading
    // Only loads zeromq when first jupyter block is executed
    try {
        const { registerJupyterCommands } = await import('./jupyter/commands');
        registerJupyterCommands(context);
    } catch (error) {
        console.warn('Scimax: Jupyter kernel support unavailable (zeromq not loaded)');
    }

    // Register Scimax-org commands (text markup, DWIM return, navigation)
    registerScimaxOrgCommands(context);

    // Register Scimax-ob commands (source block manipulation)
    registerScimaxObCommands(context);

    // Register Speed Commands (single-key shortcuts at heading start)
    registerSpeedCommands(context);

    // Register Help Commands (C-h k describe-key, C-h b list keybindings, C-h f describe command)
    registerHelpCommands(context);

    // Register Diagnostic Commands (show debug/system info)
    registerDiagnosticCommands(context);

    // Register Open Folder command (C-x d, like Emacs dired)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.openFolder', async () => {
            const result = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Open Folder'
            });

            if (result && result[0]) {
                const uri = result[0];

                // Check if already open
                const currentFolders = vscode.workspace.workspaceFolders || [];
                if (currentFolders.some(f => f.uri.fsPath === uri.fsPath)) {
                    vscode.window.showInformationMessage(`Folder ${uri.fsPath} is already open`);
                    return;
                }

                // Ask how to open
                const openIn = await vscode.window.showQuickPick([
                    { label: '$(folder-opened) Current Window (Recommended)', value: 'current' },
                    { label: '$(window) New Window', value: 'new' },
                    { label: '$(add) Add to Workspace', value: 'add' }
                ], {
                    placeHolder: 'How to open folder?'
                });

                if (!openIn) return;

                switch (openIn.value) {
                    case 'new':
                        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
                        break;
                    case 'current':
                        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
                        break;
                    case 'add':
                        vscode.workspace.updateWorkspaceFolders(
                            vscode.workspace.workspaceFolders?.length || 0, 0, { uri }
                        );
                        break;
                }
            }
        })
    );

    // Register Image Overlay Commands (inline image thumbnails)
    registerImageOverlayCommands(context);

    // Register Native Agenda Commands (file-scanning based agenda)
    registerAgendaCommands(context);

    // Register Table Formula Commands (spreadsheet-like calculations)
    registerTableFormulaCommands(context);

    // Register Capture Commands (org-capture quick note system)
    registerCaptureCommands(context);

    // Register Org-Lint Commands (syntax checking for org files)
    const orgLintProvider = new OrgLintProvider();
    registerOrgLintCommands(context, orgLintProvider);
    context.subscriptions.push(orgLintProvider);

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

                // Check if on a #+TBLFM line
                const lineText = document.lineAt(position.line).text;
                const onTblfmLine = /^\s*#\+TBLFM:/i.test(lineText);
                vscode.commands.executeCommand('setContext', 'scimax.onTblfmLine', onTblfmLine);
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

    // Register BibTeX Speed Commands (single-key shortcuts at entry start)
    registerBibtexSpeedCommands(context);

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

    // Register Notebook Commands (uses lazy database loading internally)
    registerNotebookCommands(context, notebookManager);

    // Initialize Template Manager
    templateManager = new TemplateManager(context);
    context.subscriptions.push({ dispose: () => templateManager.dispose() });

    // Register Template Commands
    registerTemplateCommands(context, templateManager);

    // Initialize Projectile Manager (deferred to avoid blocking activation)
    projectileManager = new ProjectileManager(context);
    context.subscriptions.push({ dispose: () => projectileManager.dispose() });

    // Register Projectile Commands
    registerProjectileCommands(context, projectileManager);

    // Register Project Tree View with createTreeView for better control
    const projectTreeProvider = new ProjectTreeProvider(projectileManager);
    const projectTreeView = vscode.window.createTreeView('scimax.projects', {
        treeDataProvider: projectTreeProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(projectTreeView);

    // Command to open project from tree view
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.projectile.openProject', async (project) => {
            const uri = vscode.Uri.file(project.path);
            await projectileManager.touchProject(project.path);

            const currentFolders = vscode.workspace.workspaceFolders || [];
            if (currentFolders.some(f => f.uri.fsPath === project.path)) {
                vscode.window.showInformationMessage(`Project ${project.name} is already open`);
                return;
            }

            const openIn = await vscode.window.showQuickPick([
                { label: '$(window) New Window', value: 'new' },
                { label: '$(folder-opened) Current Window', value: 'current' },
                { label: '$(add) Add to Workspace', value: 'add' }
            ], { placeHolder: `Open ${project.name}` });

            if (!openIn) return;

            switch (openIn.value) {
                case 'new':
                    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
                    break;
                case 'current':
                    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
                    break;
                case 'add':
                    vscode.workspace.updateWorkspaceFolders(
                        vscode.workspace.workspaceFolders?.length || 0, 0, { uri }
                    );
                    break;
            }
        }),
        vscode.commands.registerCommand('scimax.projectile.refreshTree', () => projectTreeProvider.refresh()),
        // Filter and sort commands for Projects view
        vscode.commands.registerCommand('scimax.projectile.filterProjects', async () => {
            const projects = projectileManager.getProjects();
            const currentFolders = vscode.workspace.workspaceFolders || [];
            const currentPaths = new Set(currentFolders.map(f => f.uri.fsPath));

            interface ProjectQuickPickItem extends vscode.QuickPickItem {
                project?: Project;
                action?: 'filter' | 'clear';
            }

            const quickPick = vscode.window.createQuickPick<ProjectQuickPickItem>();
            quickPick.placeholder = 'Search projects (Enter to open, Esc to filter tree)';
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;

            const updateItems = () => {
                const filterText = quickPick.value.toLowerCase();
                let filteredProjects = projects;

                if (filterText) {
                    filteredProjects = projects.filter(p =>
                        p.name.toLowerCase().includes(filterText) ||
                        p.path.toLowerCase().includes(filterText)
                    );
                }

                // Sort by recent first
                filteredProjects = [...filteredProjects].sort((a, b) =>
                    (b.lastOpened || 0) - (a.lastOpened || 0)
                );

                const items: ProjectQuickPickItem[] = filteredProjects.map(p => {
                    const isCurrent = currentPaths.has(p.path);
                    const typeIcon = p.type === 'git' ? '$(git-branch)' :
                                     p.type === 'projectile' ? '$(file)' : '$(folder)';
                    return {
                        label: `${isCurrent ? '$(folder-opened) ' : ''}${p.name}`,
                        description: p.path,
                        detail: `${typeIcon} ${p.type}${p.lastOpened ? ' - ' + formatProjectTime(p.lastOpened) : ''}`,
                        project: p
                    };
                });

                // Add action items at the end
                if (quickPick.value) {
                    items.push({
                        label: '$(filter) Apply filter to tree view',
                        description: `Filter: "${quickPick.value}"`,
                        action: 'filter'
                    });
                }
                if (projectTreeProvider.getFilter()) {
                    items.push({
                        label: '$(close) Clear current filter',
                        description: `Current: "${projectTreeProvider.getFilter()}"`,
                        action: 'clear'
                    });
                }

                quickPick.items = items;
            };

            const formatProjectTime = (timestamp: number): string => {
                const diff = Date.now() - timestamp;
                const minutes = Math.floor(diff / 60000);
                const hours = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);
                if (minutes < 1) return 'just now';
                if (minutes < 60) return `${minutes}m ago`;
                if (hours < 24) return `${hours}h ago`;
                if (days < 30) return `${days}d ago`;
                return new Date(timestamp).toLocaleDateString();
            };

            updateItems();
            quickPick.onDidChangeValue(() => updateItems());

            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];
                if (!selected) {
                    quickPick.hide();
                    return;
                }

                if (selected.action === 'filter') {
                    projectTreeProvider.setFilter(quickPick.value);
                    projectTreeView.message = `Filter: "${quickPick.value}"`;
                    quickPick.hide();
                } else if (selected.action === 'clear') {
                    projectTreeProvider.setFilter('');
                    projectTreeView.message = undefined;
                    quickPick.hide();
                } else if (selected.project) {
                    quickPick.hide();
                    // Open the project
                    await projectileManager.touchProject(selected.project.path);
                    const openIn = await vscode.window.showQuickPick([
                        { label: '$(window) New Window', value: 'new' },
                        { label: '$(folder-opened) Current Window', value: 'current' },
                        { label: '$(add) Add to Workspace', value: 'add' }
                    ], {
                        placeHolder: `Open ${selected.project.name}`
                    });

                    if (openIn) {
                        const uri = vscode.Uri.file(selected.project.path);
                        switch (openIn.value) {
                            case 'new':
                                await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
                                break;
                            case 'current':
                                await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
                                break;
                            case 'add':
                                vscode.workspace.updateWorkspaceFolders(
                                    vscode.workspace.workspaceFolders?.length || 0,
                                    0,
                                    { uri }
                                );
                                break;
                        }
                    }
                }
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        }),
        vscode.commands.registerCommand('scimax.projectile.clearFilter', () => {
            projectTreeProvider.setFilter('');
            projectTreeView.message = undefined;
        }),
        vscode.commands.registerCommand('scimax.projectile.sortByRecent', () => {
            projectTreeProvider.setSortBy('recent');
            vscode.window.showInformationMessage('Projects sorted by recent');
        }),
        vscode.commands.registerCommand('scimax.projectile.sortByName', () => {
            projectTreeProvider.setSortBy('name');
            vscode.window.showInformationMessage('Projects sorted A-Z');
        }),
        vscode.commands.registerCommand('scimax.projectile.sortByNameDesc', () => {
            projectTreeProvider.setSortBy('name-desc');
            vscode.window.showInformationMessage('Projects sorted Z-A');
        })
    );

    // Defer projectile initialization to avoid blocking
    setImmediate(async () => {
        try {
            await projectileManager.initialize();
        } catch (error) {
            console.error('Scimax: Failed to initialize Projectile manager:', error);
        }
    });

    // Register Fuzzy Search Commands (search current/all open files)
    registerFuzzySearchCommands(context);

    // Register Jump Commands (avy-style jump to visible locations)
    registerJumpCommands(context);

    // Register Mark Ring Commands (Emacs-style mark ring)
    registerMarkCommands(context);

    // Register Editmark Commands (track changes)
    registerEditmarkCommands(context);

    // Activate LaTeX navigation and structure features
    activateLatexFeatures(context);

    // Initialize Hydra Menu Framework
    hydraManager = new HydraManager(context);
    hydraManager.registerMenus(scimaxMenus);
    registerHydraCommands(context, hydraManager);
    context.subscriptions.push({ dispose: () => hydraManager.dispose() });

    console.log('Scimax: Extension activated');
}

export async function deactivate() {
    // Dispose journal manager
    if (journalManager) {
        journalManager.dispose();
    }

    // Close database connection if it was initialized
    await closeDatabase();
}
