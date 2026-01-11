import * as vscode from 'vscode';
import { ReferenceManager } from './referenceManager';
import { BibEntry, formatCitation, formatCitationLink, formatAuthors } from './bibtexParser';

/**
 * Register all reference-related commands
 */
export function registerReferenceCommands(
    context: vscode.ExtensionContext,
    manager: ReferenceManager
): void {
    // Insert citation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.insertCitation', async () => {
            const entries = manager.getAllEntries();

            if (entries.length === 0) {
                const action = await vscode.window.showWarningMessage(
                    'No bibliography entries found. Add a .bib file or fetch from DOI.',
                    'Fetch from DOI', 'Cancel'
                );
                if (action === 'Fetch from DOI') {
                    await vscode.commands.executeCommand('scimax.ref.fetchFromDOI');
                }
                return;
            }

            // Build quick pick items
            const items = entries.map(entry => manager.formatForQuickPick(entry));

            // Show quick pick with search
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Search and select a reference to cite',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selected) return;

            // Ask for citation style
            const config = manager.getConfig();
            const styleItems = [
                { label: 'cite', description: 'Basic citation', value: 'cite' as const },
                { label: 'citet', description: 'Textual: Author (Year)', value: 'citet' as const },
                { label: 'citep', description: 'Parenthetical: (Author, Year)', value: 'citep' as const },
                { label: 'citeauthor', description: 'Author only', value: 'citeauthor' as const },
                { label: 'citeyear', description: 'Year only', value: 'citeyear' as const }
            ];

            // Pre-select default style
            const defaultIndex = styleItems.findIndex(s => s.value === config.defaultCiteStyle);
            if (defaultIndex > 0) {
                const defaultItem = styleItems.splice(defaultIndex, 1)[0];
                styleItems.unshift(defaultItem);
            }

            const styleSelection = await vscode.window.showQuickPick(styleItems, {
                placeHolder: 'Select citation style'
            });

            if (!styleSelection) return;

            // Determine format based on current file
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const format = editor.document.languageId === 'org' ? 'org' : 'markdown';

            // Insert citation
            const citation = formatCitationLink(selected.entry.key, styleSelection.value, format);
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, citation);
            });
        })
    );

    // Fetch from DOI
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.fetchFromDOI', async () => {
            const doi = await vscode.window.showInputBox({
                prompt: 'Enter DOI',
                placeHolder: '10.1000/example or https://doi.org/10.1000/example',
                validateInput: (value) => {
                    if (!value) return 'DOI is required';
                    // Basic DOI validation
                    const cleaned = value.replace(/^https?:\/\/doi\.org\//, '');
                    if (!cleaned.startsWith('10.')) {
                        return 'DOI should start with 10.';
                    }
                    return null;
                }
            });

            if (!doi) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching from CrossRef...',
                cancellable: false
            }, async () => {
                try {
                    const entry = await manager.fetchFromDOI(doi);

                    if (!entry) {
                        vscode.window.showErrorMessage(`No entry found for DOI: ${doi}`);
                        return;
                    }

                    // Show preview
                    const preview = formatCitation(entry, 'full');
                    const action = await vscode.window.showInformationMessage(
                        `Found: ${preview.substring(0, 100)}...`,
                        'Add to Bibliography', 'Copy BibTeX', 'Cancel'
                    );

                    if (action === 'Add to Bibliography') {
                        await manager.addEntry(entry);
                    } else if (action === 'Copy BibTeX') {
                        const { entryToBibTeX } = await import('./bibtexParser');
                        await vscode.env.clipboard.writeText(entryToBibTeX(entry));
                        vscode.window.showInformationMessage('BibTeX copied to clipboard');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to fetch DOI: ${error}`);
                }
            });
        })
    );

    // Search references
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.searchReferences', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search references',
                placeHolder: 'Enter author, title, year, or keyword...'
            });

            if (!query) return;

            const results = manager.search(query);

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No references found for "${query}"`);
                return;
            }

            const items = results.map(entry => manager.formatForQuickPick(entry));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} references found`
            });

            if (selected) {
                await showEntryActions(manager, selected.entry);
            }
        })
    );

    // Open bibliography
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.openBibliography', async () => {
            const config = manager.getConfig();
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';

            if (config.bibliographyFiles.length === 0) {
                // Look for .bib files in workspace
                const bibFiles = await vscode.workspace.findFiles('**/*.bib', '**/node_modules/**');

                if (bibFiles.length === 0) {
                    const action = await vscode.window.showInformationMessage(
                        'No bibliography files found.',
                        'Create New', 'Cancel'
                    );
                    if (action === 'Create New') {
                        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                        if (workspaceFolder) {
                            const newBibPath = vscode.Uri.joinPath(workspaceFolder.uri, 'references.bib');
                            await vscode.workspace.fs.writeFile(newBibPath, Buffer.from('% Bibliography\n\n'));
                            const doc = await vscode.workspace.openTextDocument(newBibPath);
                            await vscode.window.showTextDocument(doc);
                        }
                    }
                    return;
                }

                if (bibFiles.length === 1) {
                    const doc = await vscode.workspace.openTextDocument(bibFiles[0]);
                    await vscode.window.showTextDocument(doc);
                } else {
                    const items = bibFiles.map(uri => ({
                        label: vscode.workspace.asRelativePath(uri),
                        uri
                    }));
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select bibliography file'
                    });
                    if (selected) {
                        const doc = await vscode.workspace.openTextDocument(selected.uri);
                        await vscode.window.showTextDocument(doc);
                    }
                }
            } else {
                // Open configured files
                if (config.bibliographyFiles.length === 1) {
                    const bibPath = config.bibliographyFiles[0].replace('~', homeDir);
                    const doc = await vscode.workspace.openTextDocument(bibPath);
                    await vscode.window.showTextDocument(doc);
                } else {
                    const items = config.bibliographyFiles.map(p => ({
                        label: p,
                        path: p.replace('~', homeDir)
                    }));
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select bibliography file'
                    });
                    if (selected) {
                        const doc = await vscode.workspace.openTextDocument(selected.path);
                        await vscode.window.showTextDocument(doc);
                    }
                }
            }
        })
    );

    // Show reference details (internal command)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.showDetails', async (key: string) => {
            const entry = manager.getEntry(key);
            if (!entry) {
                vscode.window.showErrorMessage(`Reference not found: ${key}`);
                return;
            }
            await showEntryActions(manager, entry);
        })
    );

    // Find citations of a reference
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.findCitations', async () => {
            const entries = manager.getAllEntries();
            const items = entries.map(entry => manager.formatForQuickPick(entry));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select reference to find citations'
            });

            if (!selected) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Finding citations of ${selected.entry.key}...`,
                cancellable: false
            }, async () => {
                const locations = await manager.findCitations(selected.entry.key);

                if (locations.length === 0) {
                    vscode.window.showInformationMessage(`No citations found for ${selected.entry.key}`);
                    return;
                }

                // Show in peek view
                await vscode.commands.executeCommand(
                    'editor.action.peekLocations',
                    vscode.window.activeTextEditor?.document.uri,
                    vscode.window.activeTextEditor?.selection.active,
                    locations,
                    'peek'
                );
            });
        })
    );

    // Copy BibTeX for entry
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.copyBibTeX', async () => {
            const entries = manager.getAllEntries();
            const items = entries.map(entry => manager.formatForQuickPick(entry));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select reference to copy'
            });

            if (!selected) return;

            const { entryToBibTeX } = await import('./bibtexParser');
            await vscode.env.clipboard.writeText(entryToBibTeX(selected.entry));
            vscode.window.showInformationMessage(`Copied BibTeX for ${selected.entry.key}`);
        })
    );

    // Refresh references
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.refresh', async () => {
            await manager.loadBibliographies();
            const stats = manager.getStats();
            vscode.window.showInformationMessage(`Loaded ${stats.totalEntries} references`);
        })
    );
}

/**
 * Show action menu for an entry
 */
async function showEntryActions(manager: ReferenceManager, entry: BibEntry): Promise<void> {
    const actions = [
        { label: '$(quote) Insert Citation', action: 'cite' },
        { label: '$(link-external) Open URL/DOI', action: 'url' },
        { label: '$(file-pdf) Open PDF', action: 'pdf' },
        { label: '$(note) Open Notes', action: 'notes' },
        { label: '$(search) Find Citations', action: 'find' },
        { label: '$(clippy) Copy BibTeX', action: 'copy' },
        { label: '$(info) Show Details', action: 'details' }
    ];

    const selected = await vscode.window.showQuickPick(actions, {
        placeHolder: `${formatAuthors(entry.author)} (${entry.year}): ${entry.title}`
    });

    if (!selected) return;

    const { entryToBibTeX } = await import('./bibtexParser');

    switch (selected.action) {
        case 'cite':
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const format = editor.document.languageId === 'org' ? 'org' : 'markdown';
                const citation = formatCitationLink(entry.key, manager.getConfig().defaultCiteStyle, format);
                await editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, citation);
                });
            }
            break;

        case 'url':
            await manager.openUrl(entry);
            break;

        case 'pdf':
            const opened = await manager.openPdf(entry);
            if (!opened) {
                vscode.window.showInformationMessage('PDF not found');
            }
            break;

        case 'notes':
            await manager.openNotes(entry);
            break;

        case 'find':
            const locations = await manager.findCitations(entry.key);
            if (locations.length === 0) {
                vscode.window.showInformationMessage(`No citations found for ${entry.key}`);
            } else {
                vscode.window.showInformationMessage(`Found ${locations.length} citations`);
            }
            break;

        case 'copy':
            await vscode.env.clipboard.writeText(entryToBibTeX(entry));
            vscode.window.showInformationMessage('BibTeX copied');
            break;

        case 'details':
            const detail = formatCitation(entry, 'full');
            vscode.window.showInformationMessage(detail);
            break;
    }
}
