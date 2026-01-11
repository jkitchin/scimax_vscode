import * as vscode from 'vscode';
import * as path from 'path';
import { NotebookManager, Notebook, Collaborator } from './notebookManager';
import { ScimaxDb } from '../database/scimaxDb';

export function registerNotebookCommands(
    context: vscode.ExtensionContext,
    notebookManager: NotebookManager,
    scimaxDb: ScimaxDb
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

            // Set org-db scope to this notebook
            scimaxDb.setSearchScope({ type: 'directory', path: notebook.path });

            // Perform search
            const results = await scimaxDb.searchFullText(query, { limit: 100 });

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No results found in ${notebook.name}`);
                scimaxDb.setSearchScope({ type: 'all' }); // Reset scope
                return;
            }

            const items = results.map(r => ({
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
                const doc = await vscode.workspace.openTextDocument(selected.result.file_path);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(selected.result.line_number - 1, 0);
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

            // Set scope
            scimaxDb.setSearchScope({ type: 'directory', path: notebook.path });

            const agendaItems = await scimaxDb.getAgenda({ before: '+2w', includeUnscheduled: true });

            if (agendaItems.length === 0) {
                vscode.window.showInformationMessage(`No agenda items in ${notebook.name}`);
                scimaxDb.setSearchScope({ type: 'all' });
                return;
            }

            const items = agendaItems.map(item => ({
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
                const doc = await vscode.workspace.openTextDocument(selected.item.heading.file_path);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(selected.item.heading.line_number - 1, 0);
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
