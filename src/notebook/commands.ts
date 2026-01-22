import * as vscode from 'vscode';
import * as path from 'path';
import { NotebookManager, Notebook, Collaborator } from './notebookManager';
import { getDatabase } from '../database/lazyDb';

export function registerNotebookCommands(
    context: vscode.ExtensionContext,
    notebookManager: NotebookManager
): void {
    // Create new notebook
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.new', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Notebook name',
                placeHolder: 'my-research-project'
            });

            if (!name) return;

            const description = await vscode.window.showInputBox({
                prompt: 'Description (optional)',
                placeHolder: 'Brief description of the project'
            });

            // Select directory
            const defaultDir = vscode.workspace.getConfiguration('scimax.notebook')
                .get<string>('directory') ||
                path.join(require('os').homedir(), 'notebooks');

            const directory = await vscode.window.showInputBox({
                prompt: 'Parent directory',
                value: defaultDir,
                placeHolder: 'Parent directory for the notebook'
            });

            if (!directory) return;

            // Select template
            const templates = [
                { label: '$(file) Empty', description: 'Basic project structure', value: 'empty' },
                { label: '$(beaker) Research', description: 'Scientific research project', value: 'research' },
                { label: '$(code) Software', description: 'Software development project', value: 'software' },
                { label: '$(note) Notes', description: 'Note-taking with journal', value: 'notes' }
            ];

            const template = await vscode.window.showQuickPick(templates, {
                placeHolder: 'Select project template'
            });

            if (!template) return;

            // Initialize git?
            const initGit = await vscode.window.showQuickPick(
                [
                    { label: 'Yes', value: true },
                    { label: 'No', value: false }
                ],
                { placeHolder: 'Initialize git repository?' }
            );

            try {
                const notebook = await notebookManager.createNotebook({
                    name,
                    directory,
                    description,
                    initGit: initGit?.value ?? true,
                    template: template.value as any
                });

                vscode.window.showInformationMessage(`Created notebook: ${notebook.name}`);
                await notebookManager.openNotebook(notebook);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create notebook: ${error}`);
            }
        })
    );

    // Open notebook
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.open', async () => {
            const notebooks = notebookManager.getNotebooks();

            if (notebooks.length === 0) {
                vscode.window.showInformationMessage('No notebooks found. Create one with "Scimax: New Notebook"');
                return;
            }

            const items = notebooks.map(nb => ({
                label: `$(folder) ${nb.name}`,
                description: nb.description || '',
                detail: nb.path,
                notebook: nb
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select notebook to open',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await notebookManager.openNotebook(selected.notebook);
            }
        })
    );

    // Open master file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.openMasterFile', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            if (notebook.masterFile) {
                const doc = await vscode.workspace.openTextDocument(notebook.masterFile);
                await vscode.window.showTextDocument(doc);
            } else {
                vscode.window.showWarningMessage('No master file found for this notebook');
            }
        })
    );

    // Recent files in notebook
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.recentFiles', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            const files = await notebookManager.getRecentFiles(notebook);

            if (files.length === 0) {
                vscode.window.showInformationMessage('No files found in notebook');
                return;
            }

            const items = files.map(f => ({
                label: `$(file) ${path.basename(f)}`,
                description: path.relative(notebook.path, path.dirname(f)),
                detail: f,
                filePath: f
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Recent files in ${notebook.name}`
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Search in notebook
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.search', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            const query = await vscode.window.showInputBox({
                prompt: `Search in ${notebook.name}`,
                placeHolder: 'Enter search term'
            });

            if (!query) return;

            // Get database lazily
            const scimaxDb = await getDatabase();
            if (!scimaxDb) {
                vscode.window.showWarningMessage('Database is not available');
                return;
            }

            // Set org-db scope to this notebook
            scimaxDb.setSearchScope({ type: 'directory', path: notebook.path });

            // Perform search
            const results = await scimaxDb.searchFullText(query, { limit: 100 });

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No results found in ${notebook.name}`);
                scimaxDb.setSearchScope({ type: 'all' }); // Reset scope
                return;
            }

            const items = results.map((r: any) => ({
                label: `$(file) ${path.basename(r.file_path)}:${r.line_number}`,
                description: r.preview,
                detail: path.relative(notebook.path, r.file_path),
                result: r
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} results in ${notebook.name}`,
                matchOnDescription: true
            });

            scimaxDb.setSearchScope({ type: 'all' }); // Reset scope

            if (selected) {
                const result = (selected as any).result;
                const doc = await vscode.workspace.openTextDocument(result.file_path);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(result.line_number - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }
        })
    );

    // Notebook agenda
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.agenda', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            // Get database lazily
            const scimaxDb = await getDatabase();
            if (!scimaxDb) {
                vscode.window.showWarningMessage('Database is not available');
                return;
            }

            // Set scope
            scimaxDb.setSearchScope({ type: 'directory', path: notebook.path });

            const agendaItems = await scimaxDb.getAgenda({ before: '+2w', includeUnscheduled: true });

            if (agendaItems.length === 0) {
                vscode.window.showInformationMessage(`No agenda items in ${notebook.name}`);
                scimaxDb.setSearchScope({ type: 'all' });
                return;
            }

            const items = agendaItems.map((item: any) => ({
                label: `${getAgendaIcon(item)} ${item.heading.title}`,
                description: formatAgendaDescription(item),
                detail: path.relative(notebook.path, item.heading.file_path),
                item
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${agendaItems.length} items in ${notebook.name}`
            });

            scimaxDb.setSearchScope({ type: 'all' });

            if (selected) {
                const item = (selected as any).item;
                const doc = await vscode.workspace.openTextDocument(item.heading.file_path);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(item.heading.line_number - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }
        })
    );

    // Add collaborator
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.addCollaborator', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            const name = await vscode.window.showInputBox({
                prompt: 'Collaborator name',
                placeHolder: 'John Doe'
            });

            if (!name) return;

            const email = await vscode.window.showInputBox({
                prompt: 'Email address',
                placeHolder: 'john@example.com'
            });

            if (!email) return;

            const role = await vscode.window.showInputBox({
                prompt: 'Role (optional)',
                placeHolder: 'e.g., Lead researcher, Developer'
            });

            const collaborator: Collaborator = { name, email, role };
            await notebookManager.addCollaborator(notebook, collaborator);

            vscode.window.showInformationMessage(`Added collaborator: ${name}`);
        })
    );

    // Archive notebook
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.archive', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            if (!notebook.hasGit) {
                vscode.window.showWarningMessage('Notebook must be a git repository to create an archive');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Create archive of ${notebook.name}? Only committed files will be included.`,
                'Create Archive',
                'Cancel'
            );

            if (confirm === 'Create Archive') {
                await notebookManager.archiveNotebook(notebook);
            }
        })
    );

    // Notebook settings
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.settings', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            const configPath = path.join(notebook.path, '.scimax', 'config.json');

            if (!require('fs').existsSync(configPath)) {
                // Create default config
                await notebookManager.saveConfig(notebook.path, {
                    name: notebook.name,
                    description: notebook.description
                });
            }

            const doc = await vscode.workspace.openTextDocument(configPath);
            await vscode.window.showTextDocument(doc);
        })
    );

    // Index notebook
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.index', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            // Get database lazily
            const scimaxDb = await getDatabase();
            if (!scimaxDb) {
                vscode.window.showWarningMessage('Database is not available');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Indexing ${notebook.name}...`,
                cancellable: false
            }, async (progress) => {
                const indexed = await scimaxDb.indexDirectory(notebook.path, progress);
                vscode.window.showInformationMessage(`Indexed ${indexed} files in ${notebook.name}`);
            });
        })
    );

    // Show notebook info
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.info', async () => {
            const notebook = await getCurrentOrSelectNotebook(notebookManager);
            if (!notebook) return;

            const files = await notebookManager.listNotebookFiles(notebook);
            const collaborators = notebook.config?.collaborators?.length || 0;

            const info = [
                `**${notebook.name}**`,
                notebook.description || '',
                '',
                `Path: ${notebook.path}`,
                `Files: ${files.length}`,
                `Collaborators: ${collaborators}`,
                `Git: ${notebook.hasGit ? 'Yes' : 'No'}`,
                `Created: ${new Date(notebook.created).toLocaleDateString()}`,
                `Last accessed: ${new Date(notebook.lastAccessed).toLocaleDateString()}`
            ].join('\n');

            vscode.window.showInformationMessage(info, { modal: true });
        })
    );

    // Remove notebook from tracking
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.remove', async () => {
            const notebooks = notebookManager.getNotebooks();

            if (notebooks.length === 0) {
                vscode.window.showInformationMessage('No notebooks to remove');
                return;
            }

            const items = notebooks.map(nb => ({
                label: `$(folder) ${nb.name}`,
                description: nb.path,
                notebook: nb
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select notebook to remove from tracking'
            });

            if (!selected) return;

            const confirm = await vscode.window.showWarningMessage(
                `Remove "${selected.notebook.name}" from tracking? Files will not be deleted.`,
                'Remove',
                'Cancel'
            );

            if (confirm === 'Remove') {
                notebookManager.removeNotebook(selected.notebook);
                await notebookManager.save();
                vscode.window.showInformationMessage(`Removed ${selected.notebook.name} from tracking`);
            }
        })
    );

    // Open notebook link (nb:project::file::target)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.openLink', async (arg: string | { path: string }) => {
            // Handle both string and object argument formats
            const linkPath = typeof arg === 'string' ? arg : arg.path;
            await openNotebookLink(linkPath, notebookManager);
        })
    );

    // Insert notebook link
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.notebook.insertLink', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // Select project
            const notebooks = notebookManager.getNotebooks();
            if (notebooks.length === 0) {
                vscode.window.showWarningMessage('No notebooks found. Create one first.');
                return;
            }

            const projectItems = notebooks.map(nb => ({
                label: nb.name,
                description: nb.description || '',
                detail: nb.path,
                notebook: nb
            }));

            const selectedProject = await vscode.window.showQuickPick(projectItems, {
                placeHolder: 'Select project for notebook link'
            });

            if (!selectedProject) return;

            // Select file in project
            const files = await notebookManager.listNotebookFiles(selectedProject.notebook);
            if (files.length === 0) {
                vscode.window.showWarningMessage('No org/md files found in project');
                return;
            }

            const fileItems = files.map(f => ({
                label: path.basename(f),
                description: path.relative(selectedProject.notebook.path, path.dirname(f)),
                detail: f,
                relativePath: path.relative(selectedProject.notebook.path, f).replace(/\\/g, '/')
            }));

            const selectedFile = await vscode.window.showQuickPick(fileItems, {
                placeHolder: 'Select file to link'
            });

            if (!selectedFile) return;

            // Optional: add target
            const target = await vscode.window.showInputBox({
                prompt: 'Target (optional): line number, c<offset>, *Heading, or #custom-id',
                placeHolder: 'e.g., 10, c453, *Methods, #intro'
            });

            // Build and insert the link
            let link = `nb:${selectedProject.notebook.name}::${selectedFile.relativePath}`;
            if (target) {
                link += `::${target}`;
            }

            const linkText = `[[${link}]]`;
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, linkText);
            });
        })
    );
}

async function getCurrentOrSelectNotebook(
    notebookManager: NotebookManager
): Promise<Notebook | undefined> {
    // Check if we're in a notebook
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const notebook = notebookManager.getNotebookForFile(activeEditor.document.uri.fsPath);
        if (notebook) return notebook;
    }

    // Check current notebook
    const current = notebookManager.getCurrentNotebook();
    if (current) return current;

    // Ask user to select
    const notebooks = notebookManager.getNotebooks();
    if (notebooks.length === 0) {
        vscode.window.showInformationMessage('No notebooks found');
        return undefined;
    }

    const items = notebooks.map(nb => ({
        label: `$(folder) ${nb.name}`,
        description: nb.description || '',
        detail: nb.path,
        notebook: nb
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a notebook'
    });

    return selected?.notebook;
}

function getAgendaIcon(item: { type: string; overdue?: boolean }): string {
    if (item.overdue) return '$(warning)';
    switch (item.type) {
        case 'deadline': return '$(bell)';
        case 'scheduled': return '$(calendar)';
        case 'todo': return '$(circle-outline)';
        default: return '$(list-tree)';
    }
}

function formatAgendaDescription(item: {
    type: string;
    date?: string;
    days_until?: number;
    heading: { priority?: string | null };
}): string {
    const parts: string[] = [];

    if (item.type === 'deadline') parts.push('DEADLINE');
    else if (item.type === 'scheduled') parts.push('SCHEDULED');

    if (item.date) parts.push(item.date.split(' ')[0]);

    if (item.days_until !== undefined) {
        if (item.days_until === 0) parts.push('(TODAY)');
        else if (item.days_until === 1) parts.push('(tomorrow)');
        else if (item.days_until < 0) parts.push(`(${Math.abs(item.days_until)} days ago)`);
        else parts.push(`(in ${item.days_until} days)`);
    }

    if (item.heading.priority) parts.push(`[#${item.heading.priority}]`);

    return parts.join(' ');
}

/**
 * Parse notebook link path into components
 * Format: project-name::file-path::target
 */
function parseNotebookLinkPath(linkPath: string): {
    projectName: string;
    filePath: string;
    target?: string;
} | null {
    const firstSep = linkPath.indexOf('::');
    if (firstSep === -1) {
        return null;
    }

    const projectName = linkPath.slice(0, firstSep);
    const rest = linkPath.slice(firstSep + 2);

    if (!projectName || !rest) {
        return null;
    }

    const secondSep = rest.indexOf('::');
    if (secondSep === -1) {
        return { projectName, filePath: rest };
    }

    const filePath = rest.slice(0, secondSep);
    const target = rest.slice(secondSep + 2);

    if (!filePath) {
        return null;
    }

    return { projectName, filePath, target: target || undefined };
}

/**
 * Open a notebook link
 * Format: project-name::file-path::target
 *
 * Examples:
 *   my-project::README.org
 *   my-project::data/notes.org::10
 *   my-project::paper.org::*Methods
 */
async function openNotebookLink(
    linkPath: string,
    notebookManager: NotebookManager
): Promise<void> {
    const parsed = parseNotebookLinkPath(linkPath);
    if (!parsed) {
        vscode.window.showErrorMessage(`Invalid notebook link format: ${linkPath}`);
        return;
    }

    const { projectName, filePath, target } = parsed;

    // Find matching notebooks
    const notebooks = notebookManager.getNotebooks();
    const matchingNotebooks = notebooks.filter(nb =>
        nb.name === projectName ||
        nb.name.toLowerCase() === projectName.toLowerCase() ||
        nb.path.endsWith(`/${projectName}`) ||
        nb.path.endsWith(`\\${projectName}`)
    );

    if (matchingNotebooks.length === 0) {
        vscode.window.showErrorMessage(`Project not found: ${projectName}`);
        return;
    }

    let notebook: Notebook;
    if (matchingNotebooks.length > 1) {
        // Show picker for ambiguous matches
        const items = matchingNotebooks.map(nb => ({
            label: nb.name,
            description: nb.path,
            notebook: nb
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Multiple projects match "${projectName}". Select one:`
        });

        if (!selected) return;
        notebook = selected.notebook;
    } else {
        notebook = matchingNotebooks[0];
    }

    // Build full path
    const fullPath = path.join(notebook.path, filePath);

    // Check if file exists
    const fs = require('fs');
    if (!fs.existsSync(fullPath)) {
        vscode.window.showErrorMessage(`File not found: ${fullPath}`);
        return;
    }

    // Open the file
    const doc = await vscode.workspace.openTextDocument(fullPath);
    const editor = await vscode.window.showTextDocument(doc);

    // Navigate to target if specified
    if (target) {
        await navigateToTarget(editor, doc, target);
    }
}

/**
 * Navigate to a target within a document
 * Supports: line numbers, character offsets (c123), headings (*Heading), custom IDs (#id)
 */
async function navigateToTarget(
    editor: vscode.TextEditor,
    doc: vscode.TextDocument,
    target: string
): Promise<void> {
    let position: vscode.Position | undefined;

    if (/^c\d+$/.test(target)) {
        // Character offset: c1234
        const charOffset = parseInt(target.slice(1), 10);
        position = doc.positionAt(charOffset);
    } else if (/^\d+$/.test(target)) {
        // Line number: 123
        const lineNum = parseInt(target, 10) - 1; // 1-indexed to 0-indexed
        if (lineNum >= 0 && lineNum < doc.lineCount) {
            position = new vscode.Position(lineNum, 0);
        }
    } else if (target.startsWith('*')) {
        // Heading search: *Heading Title
        const headingTitle = target.slice(1).toLowerCase();
        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i).text;
            const match = line.match(/^(\*+|#{1,6})\s+(.+?)(?:\s+:[\w:]+:\s*)?$/);
            if (match) {
                let title = match[2].trim();
                // Strip TODO keyword and priority
                title = title.replace(/^[A-Z]+\s+/, '').replace(/^\[#[A-Z]\]\s*/, '').trim().toLowerCase();
                if (title === headingTitle || title.includes(headingTitle)) {
                    position = new vscode.Position(i, 0);
                    break;
                }
            }
        }
    } else if (target.startsWith('#')) {
        // Custom ID: #custom-id
        const customId = target.slice(1);
        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i).text;
            if (line.match(new RegExp(`^\\s*:CUSTOM_ID:\\s*${customId}\\s*$`, 'i'))) {
                // Find the heading above this property
                for (let j = i - 1; j >= 0; j--) {
                    if (/^(\*+|#{1,6})\s/.test(doc.lineAt(j).text)) {
                        position = new vscode.Position(j, 0);
                        break;
                    }
                }
                if (!position) {
                    position = new vscode.Position(i, 0);
                }
                break;
            }
        }
    }

    if (position) {
        editor.selection = new vscode.Selection(position, position);
        // Unfold at target so content is visible
        await vscode.commands.executeCommand('editor.unfold', { selectionLines: [position.line] });
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } else {
        vscode.window.showWarningMessage(`Target not found: ${target}`);
    }
}
