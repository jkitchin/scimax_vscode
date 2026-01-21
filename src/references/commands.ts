import * as vscode from 'vscode';
import * as path from 'path';
import { ReferenceManager } from './referenceManager';
import { BibEntry, formatCitation, formatCitationLink, formatAuthors, entryToBibTeX, OrgCitationSyntax } from './bibtexParser';
import {
    fetchOpenAlexWork,
    fetchCitingWorks,
    fetchRelatedWorks,
    searchOpenAlexWorks,
    formatCitationCount,
    getOAStatusIcon,
    reconstructAbstract,
    OpenAlexWork
} from './openalexService';
import { storeOpenAlexApiKey, getOpenAlexApiKey, deleteOpenAlexApiKey, hasOpenAlexApiKey } from '../database/secretStorage';

/**
 * Find citation at cursor position to check if we should append
 * Supports both v2 (cite:key1,key2) and v3 (cite:&key1;&key2) syntax
 */
function findCitationAtPosition(line: string, position: number): { start: number; end: number; keys: string[]; prefix: string; separator: string; isV3: boolean } | null {
    // Try v3 pattern first: cite:&key1;&key2 or cite:prefix;&key1;&key2
    const orgRefV3Pattern = /(cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([^[\s]*&[a-zA-Z0-9_:;&\s-]+)/g;

    let match;
    while ((match = orgRefV3Pattern.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;

        if (position >= start && position <= end + 1) {
            const prefix = match[1] + ':';
            const content = match[2];
            // Extract keys from v3 format (keys start with &)
            const keyMatches = content.match(/&([a-zA-Z0-9_:-]+)/g) || [];
            const keys = keyMatches.map(k => k.slice(1)); // Remove & prefix
            return { start, end, keys, prefix, separator: ';&', isV3: true };
        }
    }

    // Fall back to v2 pattern: cite:key1,key2,key3
    const orgRefV2Pattern = /(cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:,-]+)/g;

    while ((match = orgRefV2Pattern.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;

        // Check if cursor is on or immediately after this citation
        if (position >= start && position <= end + 1) {
            const prefix = match[1] + ':';
            const keysStr = match[2];
            // Skip if this looks like v3 (has &)
            if (keysStr.includes('&')) continue;
            const keys = keysStr.split(',').map(k => k.trim());
            return { start, end, keys, prefix, separator: ',', isV3: false };
        }
    }

    return null;
}

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
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // First, try to load document-local bibliographies
            await manager.loadDocumentBibliographies(editor.document);

            const entries = manager.getAllEntries();

            if (entries.length === 0) {
                const action = await vscode.window.showWarningMessage(
                    'No bibliography entries found. Add a .bib file, bibliography: link, or fetch from DOI.',
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

            // Check if cursor is on an existing citation

            const document = editor.document;
            const position = editor.selection.active;
            const line = document.lineAt(position.line).text;

            const existingCitation = findCitationAtPosition(line, position.character);

            if (existingCitation) {
                // Check if key already exists in citation
                if (existingCitation.keys.includes(selected.entry.key)) {
                    vscode.window.showInformationMessage(`${selected.entry.key} is already in this citation`);
                    return;
                }

                // Append to existing citation
                const newKeys = [...existingCitation.keys, selected.entry.key];
                let newCitation: string;
                if (existingCitation.isV3) {
                    // v3 format: cite:&key1;&key2 - each key needs & prefix
                    newCitation = existingCitation.prefix + newKeys.map(k => `&${k}`).join(';');
                } else {
                    // v2 format: cite:key1,key2
                    newCitation = existingCitation.prefix + newKeys.join(existingCitation.separator);
                }

                const range = new vscode.Range(
                    position.line, existingCitation.start,
                    position.line, existingCitation.end
                );

                await editor.edit(editBuilder => {
                    editBuilder.replace(range, newCitation);
                });

                // Move cursor to end of citation
                const newPosition = new vscode.Position(position.line, existingCitation.start + newCitation.length);
                editor.selection = new vscode.Selection(newPosition, newPosition);

                vscode.window.showInformationMessage(`Added ${selected.entry.key} to citation`);
                return;
            }

            // Not on existing citation - ask for citation style and insert new citation
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
            const langId = document.languageId;
            const format = langId === 'org' ? 'org' : langId === 'latex' ? 'latex' : 'markdown';

            // Insert citation with configured syntax
            const citation = formatCitationLink(
                selected.entry.key,
                styleSelection.value,
                format,
                undefined, // prenote
                undefined, // postnote
                config.citationSyntax
            );
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, citation);
            });
        })
    );

    // Fetch from DOI
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.fetchFromDOI', async () => {
            // IMPORTANT: Capture target bib file NOW, before any dialogs change focus
            let targetBibFile: string | undefined;
            const activeEditor = vscode.window.activeTextEditor;

            if (activeEditor) {
                const langId = activeEditor.document.languageId;
                const docPath = activeEditor.document.uri.fsPath;
                const docDir = require('path').dirname(docPath);

                if (langId === 'bibtex') {
                    // If in a bib file, use that
                    targetBibFile = docPath;
                    console.log('Target: active bibtex file');
                } else if (langId === 'org' || langId === 'latex' || langId === 'markdown') {
                    // Look for bibliography reference in the document
                    const text = activeEditor.document.getText();

                    // Org-mode: #+bibliography: file.bib or bibliography:file.bib
                    const orgBibMatch = text.match(/^#\+bibliography:\s*(.+)$/mi) ||
                                        text.match(/bibliography:([^\s\]]+\.bib)/i);
                    // LaTeX: \bibliography{file} or \addbibresource{file.bib}
                    const latexBibMatch = text.match(/\\bibliography\{([^}]+)\}/) ||
                                          text.match(/\\addbibresource\{([^}]+)\}/);

                    let bibRef = orgBibMatch?.[1]?.trim() || latexBibMatch?.[1]?.trim();

                    if (bibRef) {
                        // Resolve relative path
                        if (!bibRef.endsWith('.bib')) bibRef += '.bib';
                        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
                        bibRef = bibRef.replace(/^~/, homeDir);
                        if (!require('path').isAbsolute(bibRef)) {
                            bibRef = require('path').join(docDir, bibRef);
                        }
                        if (require('fs').existsSync(bibRef)) {
                            targetBibFile = bibRef;
                            console.log('Target: bibliography from document:', bibRef);
                        }
                    }
                }
            }

            // Fall back to configured bibliography files
            if (!targetBibFile) {
                const config = manager.getConfig();
                if (config.bibliographyFiles.length > 0) {
                    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
                    targetBibFile = config.bibliographyFiles[0].replace(/^~/, homeDir);
                    console.log('Target: configured bibliography:', targetBibFile);
                }
            }

            // Fall back to any open bib file
            if (!targetBibFile) {
                const openBib = vscode.workspace.textDocuments.find(
                    d => d.languageId === 'bibtex'
                );
                if (openBib) {
                    targetBibFile = openBib.uri.fsPath;
                    console.log('Target: open bibtex document:', targetBibFile);
                }
            }

            console.log('Final target bib file:', targetBibFile);

            // Helper to extract DOI from various formats
            const extractDoi = (text: string): string | null => {
                const trimmed = text.trim();
                // Remove common DOI URL prefixes
                const cleaned = trimmed
                    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
                    .replace(/^doi:/, '');
                if (cleaned.startsWith('10.')) {
                    return cleaned;
                }
                return null;
            };

            // Check clipboard for DOI to prefill
            let prefillValue = '';
            try {
                const clipboardText = await vscode.env.clipboard.readText();
                if (clipboardText && extractDoi(clipboardText)) {
                    prefillValue = clipboardText.trim();
                }
            } catch {
                // Clipboard read failed, continue without prefill
            }

            const doi = await vscode.window.showInputBox({
                prompt: 'Enter DOI',
                placeHolder: '10.1000/example or https://doi.org/10.1000/example',
                value: prefillValue,
                validateInput: (value) => {
                    if (!value) return 'DOI is required';
                    if (!extractDoi(value)) {
                        return 'DOI should start with 10. (or be a doi.org/dx.doi.org URL)';
                    }
                    return null;
                }
            });

            if (!doi) return;

            // Fetch the entry with progress indicator
            let entry: any = null;
            try {
                entry = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Fetching from CrossRef...',
                    cancellable: false
                }, async () => {
                    return await manager.fetchFromDOI(doi);
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to fetch DOI: ${error}`);
                return;
            }

            if (!entry) {
                vscode.window.showErrorMessage(`No entry found for DOI: ${doi}`);
                return;
            }

            // Check if we already have this DOI in the target file only
            if (targetBibFile && entry.doi) {
                const existingEntry = manager.findByDOIInFile(entry.doi, targetBibFile);
                if (existingEntry) {
                    const action = await vscode.window.showWarningMessage(
                        `Already have entry "${existingEntry.key}" for this DOI`,
                        'Show Entry', 'Cancel'
                    );
                    if (action === 'Show Entry') {
                        await manager.showEntryInFile(existingEntry);
                    }
                    return;
                }
            }

            // Show preview before adding
            const preview = formatCitation(entry, 'full');
            const action = await vscode.window.showInformationMessage(
                `${entry.key}: ${preview.substring(0, 150)}...`,
                'Add', 'Cancel'
            );

            if (action !== 'Add') {
                return;
            }

            // Generate unique key if needed, add to the captured target file
            await manager.addEntryWithUniqueKey(entry, targetBibFile);
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

    // Go to citation definition in bib file (for link clicks)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.gotoCitation', async (args: { key: string; keys?: string[] }) => {
            // First ensure document bibliographies are loaded
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await manager.loadDocumentBibliographies(editor.document);
            }

            const entry = manager.getEntry(args.key);
            if (!entry) {
                vscode.window.showWarningMessage(`Reference not found: ${args.key}`);
                return;
            }

            // Open the bib file at the entry location
            const sourceFile = (entry as any)._sourceFile;
            if (!sourceFile) {
                // No source file - show entry details instead
                await showEntryActions(manager, entry);
                return;
            }

            try {
                const fs = await import('fs');
                const content = fs.readFileSync(sourceFile, 'utf8');
                const lines = content.split('\n');

                // Find the entry
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(`{${entry.key},`) || lines[i].includes(`{${entry.key}`)) {
                        const doc = await vscode.workspace.openTextDocument(sourceFile);
                        const ed = await vscode.window.showTextDocument(doc);
                        const position = new vscode.Position(i, 0);
                        ed.selection = new vscode.Selection(position, position);
                        ed.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        return;
                    }
                }

                // Fallback: just open the file
                const doc = await vscode.workspace.openTextDocument(sourceFile);
                await vscode.window.showTextDocument(doc);
            } catch (error) {
                // If file reading fails, show entry details
                await showEntryActions(manager, entry);
            }
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

    // Extract citations to new bib file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.extractBibliography', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const document = editor.document;
            const text = document.getText();

            // Find all citation keys in the document
            const citationKeys = extractCitationKeys(text);

            if (citationKeys.size === 0) {
                vscode.window.showInformationMessage('No citations found in this file');
                return;
            }

            // Look up entries
            const foundEntries: BibEntry[] = [];
            const missingKeys: string[] = [];

            for (const key of citationKeys) {
                const entry = manager.getEntry(key);
                if (entry) {
                    foundEntries.push(entry);
                } else {
                    missingKeys.push(key);
                }
            }

            if (foundEntries.length === 0) {
                vscode.window.showWarningMessage(`None of the ${citationKeys.size} citations were found in the bibliography`);
                return;
            }

            // Show summary and ask for confirmation
            let message = `Found ${foundEntries.length} of ${citationKeys.size} citations`;
            if (missingKeys.length > 0) {
                message += `. Missing: ${missingKeys.slice(0, 5).join(', ')}${missingKeys.length > 5 ? '...' : ''}`;
            }

            const action = await vscode.window.showInformationMessage(
                message,
                'Save to .bib File',
                'Copy to Clipboard',
                'Cancel'
            );

            if (!action || action === 'Cancel') return;

            // Generate BibTeX content
            const bibContent = foundEntries.map(entry => entryToBibTeX(entry)).join('\n\n');

            if (action === 'Copy to Clipboard') {
                await vscode.env.clipboard.writeText(bibContent);
                vscode.window.showInformationMessage(`Copied ${foundEntries.length} BibTeX entries to clipboard`);
                return;
            }

            // Save to file
            const currentFileName = path.basename(document.fileName, path.extname(document.fileName));
            const suggestedName = `${currentFileName}-references.bib`;

            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(path.dirname(document.fileName), suggestedName)),
                filters: { 'BibTeX': ['bib'] },
                title: 'Save extracted bibliography'
            });

            if (!saveUri) return;

            // Write the file
            const header = `% Bibliography extracted from ${path.basename(document.fileName)}\n` +
                          `% Generated: ${new Date().toISOString()}\n` +
                          `% Contains ${foundEntries.length} entries\n\n`;

            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(header + bibContent));
            vscode.window.showInformationMessage(`Saved ${foundEntries.length} entries to ${path.basename(saveUri.fsPath)}`);

            // Open the file
            const doc = await vscode.workspace.openTextDocument(saveUri);
            await vscode.window.showTextDocument(doc);
        })
    );

    // Show citing works for a DOI (via OpenAlex)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.showCitingWorks', async (doi?: string) => {
            // If no DOI provided, ask for one
            if (!doi) {
                doi = await vscode.window.showInputBox({
                    prompt: 'Enter DOI',
                    placeHolder: '10.1000/example'
                });
            }
            if (!doi) return;

            // Clean DOI
            doi = doi.replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching citing works from OpenAlex...',
                cancellable: false
            }, async () => {
                // First get the work to find its OpenAlex ID
                const work = await fetchOpenAlexWork(doi!);
                if (!work) {
                    vscode.window.showWarningMessage(`Work not found in OpenAlex: ${doi}`);
                    return;
                }

                // Fetch citing works
                const citingWorks = await fetchCitingWorks(work.id, 25);

                if (citingWorks.length === 0) {
                    vscode.window.showInformationMessage(`No citing works found for ${doi}`);
                    return;
                }

                // Show in QuickPick
                const items = citingWorks.map(w => formatWorkForQuickPick(w));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `${work.cited_by_count} total citations - showing top ${citingWorks.length}`,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected && selected.work) {
                    await showWorkActions(selected.work, manager);
                }
            });
        })
    );

    // Show related works for a DOI (via OpenAlex)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.showRelatedWorks', async (doi?: string) => {
            if (!doi) {
                doi = await vscode.window.showInputBox({
                    prompt: 'Enter DOI',
                    placeHolder: '10.1000/example'
                });
            }
            if (!doi) return;

            doi = doi.replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching related works from OpenAlex...',
                cancellable: false
            }, async () => {
                const work = await fetchOpenAlexWork(doi!);
                if (!work) {
                    vscode.window.showWarningMessage(`Work not found in OpenAlex: ${doi}`);
                    return;
                }

                if (!work.related_works || work.related_works.length === 0) {
                    vscode.window.showInformationMessage(`No related works found for ${doi}`);
                    return;
                }

                const relatedWorks = await fetchRelatedWorks(work.related_works, 10);

                if (relatedWorks.length === 0) {
                    vscode.window.showInformationMessage(`Could not fetch related works`);
                    return;
                }

                const items = relatedWorks.map(w => formatWorkForQuickPick(w));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Related works for "${work.title.substring(0, 50)}..."`,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected && selected.work) {
                    await showWorkActions(selected.work, manager);
                }
            });
        })
    );

    // Search OpenAlex
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.searchOpenAlex', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search OpenAlex',
                placeHolder: 'Enter search terms (title, author, keywords...)'
            });
            if (!query) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Searching OpenAlex...',
                cancellable: false
            }, async () => {
                const works = await searchOpenAlexWorks(query, 25);

                if (works.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${query}"`);
                    return;
                }

                const items = works.map(w => formatWorkForQuickPick(w));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `${works.length} results for "${query}"`,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected && selected.work) {
                    await showWorkActions(selected.work, manager);
                }
            });
        })
    );

    // Insert ref link (C-u C-c ])
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.insertRef', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // Collect all labels from current document and workspace
            const labels = await collectLabels(editor.document);

            if (labels.length === 0) {
                vscode.window.showInformationMessage('No labels found. Define labels with label:name, \\label{name}, #+NAME:, or :CUSTOM_ID:');
                return;
            }

            // Show quick pick with labels
            const items = labels.map(l => ({
                label: l.name,
                description: l.type,
                detail: l.context ? `${l.context} (${l.file})` : l.file,
                labelInfo: l
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select label to reference',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selected) return;

            // Ask for ref type
            const refTypes = [
                { label: 'ref', description: 'Basic reference' },
                { label: 'eqref', description: 'Equation reference (with parentheses)' },
                { label: 'pageref', description: 'Page reference' },
                { label: 'nameref', description: 'Name/title reference' },
                { label: 'autoref', description: 'Auto-formatted reference' }
            ];

            const refType = await vscode.window.showQuickPick(refTypes, {
                placeHolder: 'Select reference type'
            });

            if (!refType) return;

            // Insert the ref link
            const refLink = `${refType.label}:${selected.labelInfo.name}`;
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, refLink);
            });
        })
    );

    // Insert bibliography link with all bib files containing cited keys
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.insertBibliography', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const document = editor.document;
            const text = document.getText();

            // Extract all citation keys from the document
            const citedKeys = extractCitationKeys(text);

            if (citedKeys.size === 0) {
                vscode.window.showInformationMessage('No citations found in document');
                return;
            }

            // Load document-local bibliographies first
            await manager.loadDocumentBibliographies(document);

            // Get all entries and find which bib files contain the cited keys
            const bibFiles = new Set<string>();
            const allEntries = manager.getAllEntries();

            for (const key of citedKeys) {
                const entry = allEntries.find(e => e.key === key);
                if (entry && (entry as any)._sourceFile) {
                    bibFiles.add((entry as any)._sourceFile);
                }
            }

            if (bibFiles.size === 0) {
                // No matches found - try configured bib files first
                const config = manager.getConfig();
                if (config.bibliographyFiles && config.bibliographyFiles.length > 0) {
                    for (const bibFile of config.bibliographyFiles) {
                        bibFiles.add(bibFile);
                    }
                } else {
                    // No configured files - let user select a .bib file
                    const selected = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: true,
                        filters: { 'BibTeX files': ['bib'] },
                        title: 'Select bibliography file(s)'
                    });

                    if (!selected || selected.length === 0) {
                        return;
                    }

                    for (const uri of selected) {
                        bibFiles.add(uri.fsPath);
                    }
                }
            }

            // Sort and format the bibliography link
            const sortedFiles = Array.from(bibFiles).sort();
            const bibLink = `bibliography:${sortedFiles.join(',')}`;

            // Insert at cursor
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, bibLink);
            });

            vscode.window.showInformationMessage(
                `Inserted bibliography link with ${bibFiles.size} file(s) for ${citedKeys.size} citation(s)`
            );
        })
    );

    // Configure OpenAlex API key
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.configureOpenAlex', async () => {
            const hasKey = await hasOpenAlexApiKey();
            const config = vscode.workspace.getConfiguration('scimax');
            const mailto = config.get<string>('email') || '';

            const items = [
                {
                    label: hasKey ? '$(key) Update API Key' : '$(key) Set API Key',
                    description: hasKey ? 'Change your OpenAlex API key' : 'Enter your OpenAlex API key (optional)',
                    action: 'setKey'
                },
                {
                    label: mailto ? '$(mail) Update Email' : '$(mail) Set Email',
                    description: mailto ? `Currently: ${mailto}` : 'Set email for polite pool access (recommended)',
                    action: 'setEmail'
                }
            ];

            if (hasKey) {
                items.push({
                    label: '$(trash) Remove API Key',
                    description: 'Delete your stored OpenAlex API key',
                    action: 'removeKey'
                });
            }

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Configure OpenAlex API settings'
            });

            if (!selected) return;

            if (selected.action === 'setKey') {
                const apiKey = await vscode.window.showInputBox({
                    prompt: 'Enter your OpenAlex API key (get one at https://openalex.org/users)',
                    password: true,
                    placeHolder: 'openalex_...',
                    ignoreFocusOut: true
                });

                if (apiKey) {
                    await storeOpenAlexApiKey(apiKey);
                    vscode.window.showInformationMessage('OpenAlex API key stored securely');
                }
            } else if (selected.action === 'setEmail') {
                const email = await vscode.window.showInputBox({
                    prompt: 'Enter your email for Scimax API integrations (e.g., OpenAlex polite pool)',
                    value: mailto,
                    placeHolder: 'user@example.com',
                    ignoreFocusOut: true
                });

                if (email !== undefined) {
                    await config.update('email', email, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(
                        email ? `Scimax email set to ${email}` : 'Scimax email cleared'
                    );
                }
            } else if (selected.action === 'removeKey') {
                await deleteOpenAlexApiKey();
                vscode.window.showInformationMessage('OpenAlex API key removed');
            }
        })
    );
}

/**
 * Extract all citation keys from document text
 */
function extractCitationKeys(text: string): Set<string> {
    const keys = new Set<string>();

    // Patterns to match citations
    const patterns = [
        // org-ref style: cite:key1,key2,key3 etc.
        /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:,-]+)/g,
        // org-mode 9.5+ citation: [cite:@key1;@key2] or [cite/style:@key]
        /\[cite(?:\/[^\]]*)?:([^\]]+)\]/g,
        // Pandoc/markdown: [@key] or [@key1; @key2]
        /\[([^\]]*@[a-zA-Z][a-zA-Z0-9_:-]*[^\]]*)\]/g,
        // LaTeX: \cite{key1,key2}
        /\\cite[pt]?\{([a-zA-Z0-9_:,-]+)\}/g,
        // autocite, textcite, etc.
        /\\(?:auto|text|par|foot|super|full)cite\*?\{([a-zA-Z0-9_:,-]+)\}/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const keysStr = match[1];

            // Handle different key formats
            if (keysStr.includes('@')) {
                // org-mode 9.5+ or Pandoc style with @ prefix
                const keyMatches = keysStr.matchAll(/@([a-zA-Z][a-zA-Z0-9_:-]*)/g);
                for (const km of keyMatches) {
                    keys.add(km[1]);
                }
            } else {
                // Comma-separated keys
                const keyList = keysStr.split(/[,;]/).map(k => k.trim()).filter(k => k.length > 0);
                for (const key of keyList) {
                    keys.add(key);
                }
            }
        }
    }

    return keys;
}

interface LabelInfo {
    name: string;
    type: string;
    file: string;
    line: number;
    context?: string;
}

/**
 * Collect all labels from document and workspace
 */
async function collectLabels(currentDoc: vscode.TextDocument): Promise<LabelInfo[]> {
    const labels: LabelInfo[] = [];
    const seenLabels = new Set<string>();

    // Patterns to find labels
    const patterns = [
        { regex: /label:([^\s<>\[\](){}:,]+)/g, type: 'org-ref label' },
        { regex: /\\label\{([^}]+)\}/g, type: 'LaTeX label' },
        { regex: /^[ \t]*#\+NAME:\s*(.+?)\s*$/gm, type: 'Named element' },
        { regex: /^[ \t]*#\+LABEL:\s*(.+?)\s*$/gm, type: 'Figure/Table label' },
        { regex: /:CUSTOM_ID:\s*(.+?)\s*$/gm, type: 'Heading ID' }
    ];

    // Helper to extract labels from text
    const extractLabels = (text: string, filePath: string, lines: string[]) => {
        for (const { regex, type } of patterns) {
            let match;
            // Reset regex
            regex.lastIndex = 0;
            while ((match = regex.exec(text)) !== null) {
                const name = match[1].trim();
                if (name && !seenLabels.has(name)) {
                    seenLabels.add(name);

                    // Find line number and context
                    const beforeMatch = text.substring(0, match.index);
                    const lineNum = beforeMatch.split('\n').length - 1;

                    // Get context (nearby heading or caption)
                    let context = '';
                    if (type === 'Heading ID') {
                        // Look for heading above
                        for (let i = lineNum - 1; i >= 0 && i >= lineNum - 5; i--) {
                            const headingMatch = lines[i]?.match(/^(\*+)\s+(.+)/);
                            if (headingMatch) {
                                context = headingMatch[2].replace(/\s*:\w+:\s*$/, '').trim();
                                break;
                            }
                        }
                    } else {
                        // Look for caption nearby
                        const nearbyText = lines.slice(Math.max(0, lineNum - 3), lineNum + 3).join('\n');
                        const captionMatch = nearbyText.match(/#\+CAPTION:\s*(.+)/i) ||
                                           nearbyText.match(/\\caption\{([^}]+)\}/);
                        if (captionMatch) {
                            context = captionMatch[1].slice(0, 50);
                        }
                    }

                    labels.push({
                        name,
                        type,
                        file: filePath,
                        line: lineNum,
                        context
                    });
                }
            }
        }
    };

    // Search current document
    const currentText = currentDoc.getText();
    const currentLines = currentText.split('\n');
    extractLabels(currentText, currentDoc.uri.fsPath, currentLines);

    // Search workspace files
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const files = await vscode.workspace.findFiles(
            '**/*.{org,tex,md}',
            '**/node_modules/**',
            100
        );

        for (const file of files) {
            if (file.fsPath === currentDoc.uri.fsPath) continue;

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                const lines = text.split('\n');
                extractLabels(text, file.fsPath, lines);
            } catch {
                // Ignore errors reading files
            }
        }
    }

    // Sort by name
    return labels.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Format OpenAlex work for QuickPick display
 */
interface WorkQuickPickItem extends vscode.QuickPickItem {
    work: OpenAlexWork;
}

function formatWorkForQuickPick(work: OpenAlexWork): WorkQuickPickItem {
    // Authors
    let authors = 'Unknown';
    if (work.authorships && work.authorships.length > 0) {
        authors = work.authorships.length > 2
            ? work.authorships.slice(0, 2).map(a => a.author.display_name).join(', ') + ' et al.'
            : work.authorships.map(a => a.author.display_name).join(', ');
    }

    // OA status icon
    const oaIcon = work.open_access ? getOAStatusIcon(work.open_access.oa_status) : '';

    // Citation count
    const citations = formatCitationCount(work.cited_by_count);

    return {
        label: `$(book) ${work.title.substring(0, 70)}${work.title.length > 70 ? '...' : ''}`,
        description: `${authors} (${work.publication_year || 'n.d.'})`,
        detail: `${oaIcon} ${citations} citations | ${work.primary_location?.source?.display_name || 'Unknown source'}`,
        work
    };
}

/**
 * Show actions menu for an OpenAlex work
 */
async function showWorkActions(work: OpenAlexWork, manager: ReferenceManager): Promise<void> {
    const doi = work.doi?.replace('https://doi.org/', '');

    const actions: Array<{ label: string; description?: string; action: string }> = [
        { label: '$(link-external) Open DOI', description: doi, action: 'doi' },
        { label: '$(search) View Citing Works', description: `${work.cited_by_count} citations`, action: 'citing' },
        { label: '$(references) View Related Works', action: 'related' },
        { label: '$(add) Add to Bibliography', action: 'add' },
        { label: '$(clippy) Copy BibTeX', action: 'bibtex' }
    ];

    if (work.open_access?.oa_url) {
        actions.splice(1, 0, {
            label: '$(file-pdf) Open PDF',
            description: 'Open Access',
            action: 'pdf'
        });
    }

    const selected = await vscode.window.showQuickPick(actions, {
        placeHolder: work.title
    });

    if (!selected) return;

    switch (selected.action) {
        case 'doi':
            if (doi) {
                await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${doi}`));
            }
            break;

        case 'pdf':
            if (work.open_access?.oa_url) {
                await vscode.env.openExternal(vscode.Uri.parse(work.open_access.oa_url));
            }
            break;

        case 'citing':
            if (doi) {
                await vscode.commands.executeCommand('scimax.ref.showCitingWorks', doi);
            }
            break;

        case 'related':
            if (doi) {
                await vscode.commands.executeCommand('scimax.ref.showRelatedWorks', doi);
            }
            break;

        case 'add':
            if (doi) {
                await vscode.commands.executeCommand('scimax.ref.fetchFromDOI', doi);
            }
            break;

        case 'bibtex':
            // Generate simple BibTeX from OpenAlex data
            const bibtex = generateBibTeXFromOpenAlex(work);
            await vscode.env.clipboard.writeText(bibtex);
            vscode.window.showInformationMessage('BibTeX copied to clipboard');
            break;
    }
}

/**
 * Generate BibTeX entry from OpenAlex work
 */
function generateBibTeXFromOpenAlex(work: OpenAlexWork): string {
    const doi = work.doi?.replace('https://doi.org/', '');
    const firstAuthor = work.authorships?.[0]?.author.display_name.split(' ').pop() || 'unknown';
    const key = `${firstAuthor.toLowerCase()}${work.publication_year || ''}`;

    const type = work.type === 'book' ? 'book' : 'article';

    const fields: string[] = [];

    fields.push(`  title = {${work.title}}`);

    if (work.authorships && work.authorships.length > 0) {
        const authors = work.authorships.map(a => a.author.display_name).join(' and ');
        fields.push(`  author = {${authors}}`);
    }

    if (work.publication_year) {
        fields.push(`  year = {${work.publication_year}}`);
    }

    if (work.primary_location?.source?.display_name) {
        fields.push(`  journal = {${work.primary_location.source.display_name}}`);
    }

    if (work.biblio) {
        if (work.biblio.volume) fields.push(`  volume = {${work.biblio.volume}}`);
        if (work.biblio.issue) fields.push(`  number = {${work.biblio.issue}}`);
        if (work.biblio.first_page) {
            const pages = work.biblio.last_page
                ? `${work.biblio.first_page}--${work.biblio.last_page}`
                : work.biblio.first_page;
            fields.push(`  pages = {${pages}}`);
        }
    }

    if (doi) {
        fields.push(`  doi = {${doi}}`);
    }

    if (work.open_access?.oa_url) {
        fields.push(`  url = {${work.open_access.oa_url}}`);
    }

    return `@${type}{${key},\n${fields.join(',\n')}\n}`;
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
                const config = manager.getConfig();
                const format = editor.document.languageId === 'org' ? 'org' : 'markdown';
                const citation = formatCitationLink(
                    entry.key,
                    config.defaultCiteStyle,
                    format,
                    undefined,
                    undefined,
                    config.citationSyntax
                );
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
