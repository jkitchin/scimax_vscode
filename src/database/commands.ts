import * as vscode from 'vscode';
import * as path from 'path';
import {
    OrgDb,
    HeadingRecord,
    SourceBlockRecord,
    SearchResult,
    AgendaItem,
    SearchScope
} from './orgDb';

export function registerDbCommands(
    context: vscode.ExtensionContext,
    db: OrgDb
): void {
    // Reindex all files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.reindex', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing files...',
                cancellable: false
            }, async (progress) => {
                let totalIndexed = 0;

                for (const folder of workspaceFolders) {
                    const indexed = await db.indexDirectory(folder.uri.fsPath, progress);
                    totalIndexed += indexed;
                }

                // Also index additional directories from config
                const config = vscode.workspace.getConfiguration('scimax.db');
                const additionalDirs = config.get<string[]>('directories') || [];

                for (const dir of additionalDirs) {
                    const indexed = await db.indexDirectory(dir, progress);
                    totalIndexed += indexed;
                }

                const stats = db.getStats();
                vscode.window.showInformationMessage(
                    `Indexed ${totalIndexed} files. Total: ${stats.files} files, ${stats.headings} headings, ${stats.blocks} code blocks`
                );
            });
        })
    );

    // Full-text search
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.search', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search all org/markdown files',
                placeHolder: 'Enter search term (use spaces for AND, prefix with OR: for OR search)...'
            });

            if (!query) return;

            const isOrSearch = query.startsWith('OR:');
            const searchQuery = isOrSearch ? query.slice(3).trim() : query;
            const results = db.searchFullText(searchQuery, {
                operator: isOrSearch ? 'OR' : 'AND',
                limit: 100
            });

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No results found for "${searchQuery}"`);
                return;
            }

            const items = results.map(result => ({
                label: `$(file) ${path.basename(result.filePath)}:${result.lineNumber}`,
                description: result.preview,
                detail: result.filePath,
                result
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} results for "${searchQuery}"`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await openFileAtLine(selected.result.filePath, selected.result.lineNumber);
            }
        })
    );

    // Search headings
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHeadings', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search headings',
                placeHolder: 'Enter heading text...'
            });

            if (!query) return;

            const results = db.searchHeadings(query);

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No headings found matching "${query}"`);
                return;
            }

            const items = results.slice(0, 100).map(heading => ({
                label: `${'  '.repeat(heading.level - 1)}${getHeadingIcon(heading)} ${heading.title}`,
                description: formatHeadingDescription(heading),
                detail: `${path.basename(heading.filePath)}:${heading.lineNumber}`,
                heading
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} headings matching "${query}"`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await openFileAtLine(selected.heading.filePath, selected.heading.lineNumber);
            }
        })
    );

    // Search by tag
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchByTag', async () => {
            const tags = db.getAllTags();

            if (tags.length === 0) {
                vscode.window.showInformationMessage('No tags found in indexed files');
                return;
            }

            const tagItems = tags.map(tag => ({
                label: `:${tag}:`,
                tag
            }));

            const selected = await vscode.window.showQuickPick(tagItems, {
                placeHolder: 'Select a tag to filter headings'
            });

            if (!selected) return;

            const results = db.searchHeadings('', { tag: selected.tag });

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No headings with tag :${selected.tag}:`);
                return;
            }

            const items = results.map(heading => ({
                label: `${getHeadingIcon(heading)} ${heading.title}`,
                description: formatHeadingDescription(heading),
                detail: `${path.basename(heading.filePath)}:${heading.lineNumber}`,
                heading
            }));

            const headingSelected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} headings with :${selected.tag}:`
            });

            if (headingSelected) {
                await openFileAtLine(headingSelected.heading.filePath, headingSelected.heading.lineNumber);
            }
        })
    );

    // Search by property
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchByProperty', async () => {
            const properties = db.getAllPropertyNames();

            if (properties.length === 0) {
                vscode.window.showInformationMessage('No properties found in indexed files');
                return;
            }

            const propItems = properties.map(prop => ({
                label: `:${prop}:`,
                property: prop
            }));

            const selectedProp = await vscode.window.showQuickPick(propItems, {
                placeHolder: 'Select a property name'
            });

            if (!selectedProp) return;

            const value = await vscode.window.showInputBox({
                prompt: `Search for value in :${selectedProp.property}:`,
                placeHolder: 'Enter value (leave empty for any value)'
            });

            const results = db.searchByProperty(selectedProp.property, value || undefined);

            if (results.length === 0) {
                vscode.window.showInformationMessage(
                    `No headings with :${selectedProp.property}:${value ? ` = "${value}"` : ''}`
                );
                return;
            }

            const items = results.map(heading => ({
                label: `${getHeadingIcon(heading)} ${heading.title}`,
                description: `:${selectedProp.property}: ${heading.properties[selectedProp.property]}`,
                detail: `${path.basename(heading.filePath)}:${heading.lineNumber}`,
                heading
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} headings with :${selectedProp.property}:`
            });

            if (selected) {
                await openFileAtLine(selected.heading.filePath, selected.heading.lineNumber);
            }
        })
    );

    // Search source blocks
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchBlocks', async () => {
            const languages = db.getAllLanguages();

            const languageItems = [
                { label: '$(list-flat) All languages', language: undefined },
                ...languages.map(lang => ({
                    label: `$(code) ${lang}`,
                    language: lang
                }))
            ];

            const langChoice = await vscode.window.showQuickPick(languageItems, {
                placeHolder: 'Select language to filter'
            });

            if (!langChoice) return;

            const query = await vscode.window.showInputBox({
                prompt: 'Search code blocks (optional)',
                placeHolder: 'Enter code to search for...'
            });

            const results = db.searchSourceBlocks(langChoice.language, query || undefined);

            if (results.length === 0) {
                vscode.window.showInformationMessage('No code blocks found');
                return;
            }

            const items = results.slice(0, 100).map(block => ({
                label: `$(code) ${block.language}`,
                description: block.content.split('\n')[0].slice(0, 60),
                detail: `${path.basename(block.filePath)}:${block.lineNumber}`,
                block
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} code blocks found`,
                matchOnDescription: true
            });

            if (selected) {
                await openFileAtLine(selected.block.filePath, selected.block.lineNumber);
            }
        })
    );

    // Search by hashtag
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHashtags', async () => {
            const hashtags = db.getAllHashtags();

            if (hashtags.length === 0) {
                vscode.window.showInformationMessage('No hashtags found in indexed files');
                return;
            }

            const items = hashtags.map(tag => ({
                label: `#${tag}`,
                description: `${db.findByHashtag(tag).length} files`,
                tag
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a hashtag'
            });

            if (!selected) return;

            const files = db.findByHashtag(selected.tag);
            const fileItems = files.map(filePath => ({
                label: `$(file) ${path.basename(filePath)}`,
                detail: filePath,
                filePath
            }));

            const fileSelected = await vscode.window.showQuickPick(fileItems, {
                placeHolder: `Files with #${selected.tag}`
            });

            if (fileSelected) {
                const doc = await vscode.workspace.openTextDocument(fileSelected.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Show TODOs
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.showTodos', async () => {
            const todos = db.getTodos();

            if (todos.length === 0) {
                vscode.window.showInformationMessage('No TODO items found');
                return;
            }

            const states = db.getAllTodoStates();
            const stateItems = [
                { label: '$(list-flat) All TODOs', state: undefined },
                ...states.map(state => ({
                    label: `$(${getTodoIcon(state)}) ${state}`,
                    state
                }))
            ];

            const stateChoice = await vscode.window.showQuickPick(stateItems, {
                placeHolder: 'Filter by state'
            });

            if (!stateChoice) return;

            const filtered = stateChoice.state
                ? todos.filter(t => t.todoState === stateChoice.state)
                : todos;

            const items = filtered.map(todo => ({
                label: `$(${getTodoIcon(todo.todoState!)}) ${todo.title}`,
                description: formatHeadingDescription(todo),
                detail: `${path.basename(todo.filePath)}:${todo.lineNumber}`,
                todo
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${filtered.length} TODO items`
            });

            if (selected) {
                await openFileAtLine(selected.todo.filePath, selected.todo.lineNumber);
            }
        })
    );

    // Show Agenda
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.agenda', async () => {
            const periodItems = [
                { label: '$(calendar) Next 2 weeks', period: '+2w' },
                { label: '$(calendar) Next month', period: '+1m' },
                { label: '$(calendar) Next 3 months', period: '+3m' },
                { label: '$(list-flat) All items', period: undefined }
            ];

            const periodChoice = await vscode.window.showQuickPick(periodItems, {
                placeHolder: 'Select time period for agenda'
            });

            if (!periodChoice) return;

            const agendaItems = db.getAgenda({
                before: periodChoice.period,
                includeUnscheduled: true
            });

            if (agendaItems.length === 0) {
                vscode.window.showInformationMessage('No agenda items found');
                return;
            }

            const items = agendaItems.map(item => ({
                label: `${getAgendaIcon(item)} ${item.heading.title}`,
                description: formatAgendaDescription(item),
                detail: `${path.basename(item.heading.filePath)}:${item.heading.lineNumber}`,
                item
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${agendaItems.length} agenda items`
            });

            if (selected) {
                await openFileAtLine(selected.item.heading.filePath, selected.item.heading.lineNumber);
            }
        })
    );

    // Show Deadlines
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.deadlines', async () => {
            const agendaItems = db.getAgenda({ before: '+2w' })
                .filter(item => item.type === 'deadline');

            if (agendaItems.length === 0) {
                vscode.window.showInformationMessage('No upcoming deadlines');
                return;
            }

            const items = agendaItems.map(item => ({
                label: `${getAgendaIcon(item)} ${item.heading.title}`,
                description: formatAgendaDescription(item),
                detail: `${path.basename(item.heading.filePath)}:${item.heading.lineNumber}`,
                item
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${agendaItems.length} upcoming deadlines`
            });

            if (selected) {
                await openFileAtLine(selected.item.heading.filePath, selected.item.heading.lineNumber);
            }
        })
    );

    // Set search scope
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.setScope', async () => {
            const currentScope = db.getSearchScope();

            const scopeItems = [
                {
                    label: '$(globe) All files',
                    description: currentScope.type === 'all' ? '(current)' : '',
                    scope: { type: 'all' } as SearchScope
                },
                {
                    label: '$(folder) Current directory',
                    description: currentScope.type === 'directory' ? '(current)' : '',
                    scope: { type: 'directory' } as SearchScope
                }
            ];

            const selected = await vscode.window.showQuickPick(scopeItems, {
                placeHolder: 'Select search scope'
            });

            if (!selected) return;

            if (selected.scope.type === 'directory') {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    selected.scope.path = path.dirname(activeEditor.document.uri.fsPath);
                } else {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder) {
                        selected.scope.path = workspaceFolder.uri.fsPath;
                    }
                }
            }

            db.setSearchScope(selected.scope);
            vscode.window.showInformationMessage(
                `Search scope: ${selected.scope.type}${selected.scope.path ? ` (${path.basename(selected.scope.path)})` : ''}`
            );
        })
    );

    // Browse files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.browseFiles', async () => {
            const files = db.getFiles();

            if (files.length === 0) {
                vscode.window.showInformationMessage('No files indexed. Run "Scimax: Reindex Database" first.');
                return;
            }

            const items = files
                .sort((a, b) => b.indexedAt - a.indexedAt)
                .map(file => ({
                    label: `$(file) ${path.basename(file.path)}`,
                    description: new Date(file.indexedAt).toLocaleDateString(),
                    detail: file.path,
                    file
                }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${files.length} indexed files`,
                matchOnDetail: true
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.file.path);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Optimize database
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.optimize', async () => {
            db.optimize();
            await db.save();
            vscode.window.showInformationMessage('Database optimized');
        })
    );

    // Clear database
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.clear', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to clear the database? This will remove all indexed data.',
                { modal: true },
                'Yes, clear'
            );

            if (confirm === 'Yes, clear') {
                db.clear();
                await db.save();
                vscode.window.showInformationMessage('Database cleared');
            }
        })
    );

    // Show database stats
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.stats', () => {
            const stats = db.getStats();
            const lastIndexed = stats.lastIndexed
                ? new Date(stats.lastIndexed).toLocaleString()
                : 'Never';

            vscode.window.showInformationMessage(
                `Scimax DB: ${stats.files} files, ${stats.headings} headings, ` +
                `${stats.blocks} code blocks, ${stats.links} links, ` +
                `${stats.todoItems} TODOs (${stats.deadlines} deadlines, ${stats.scheduled} scheduled). ` +
                `Last indexed: ${lastIndexed}`
            );
        })
    );
}

function getHeadingIcon(heading: HeadingRecord): string {
    if (heading.todoState) {
        return `$(${getTodoIcon(heading.todoState)})`;
    }
    if (heading.deadline) {
        return '$(bell)';
    }
    if (heading.scheduled) {
        return '$(calendar)';
    }
    return '$(list-tree)';
}

function formatHeadingDescription(heading: HeadingRecord): string {
    const parts: string[] = [];

    if (heading.todoState) {
        parts.push(heading.todoState);
    }

    if (heading.priority) {
        parts.push(`[#${heading.priority}]`);
    }

    if (heading.tags.length > 0) {
        parts.push(`:${heading.tags.join(':')}:`);
    }

    if (heading.deadline) {
        parts.push(`DL: ${heading.deadline.split(' ')[0]}`);
    }

    if (heading.scheduled) {
        parts.push(`SCH: ${heading.scheduled.split(' ')[0]}`);
    }

    return parts.join(' ');
}

function getTodoIcon(state: string): string {
    switch (state.toUpperCase()) {
        case 'TODO':
            return 'circle-outline';
        case 'DONE':
            return 'check';
        case 'IN-PROGRESS':
        case 'NEXT':
            return 'play';
        case 'WAIT':
        case 'WAITING':
            return 'watch';
        case 'CANCELLED':
            return 'x';
        default:
            return 'circle-outline';
    }
}

function getAgendaIcon(item: AgendaItem): string {
    if (item.overdue) {
        return '$(warning)';
    }

    switch (item.type) {
        case 'deadline':
            return '$(bell)';
        case 'scheduled':
            return '$(calendar)';
        case 'todo':
            return '$(circle-outline)';
        default:
            return '$(list-tree)';
    }
}

function formatAgendaDescription(item: AgendaItem): string {
    const parts: string[] = [];

    if (item.type === 'deadline') {
        parts.push('DEADLINE');
    } else if (item.type === 'scheduled') {
        parts.push('SCHEDULED');
    }

    if (item.date) {
        parts.push(item.date.split(' ')[0]);
    }

    if (item.daysUntil !== undefined) {
        if (item.daysUntil === 0) {
            parts.push('(TODAY)');
        } else if (item.daysUntil === 1) {
            parts.push('(tomorrow)');
        } else if (item.daysUntil === -1) {
            parts.push('(yesterday)');
        } else if (item.daysUntil < 0) {
            parts.push(`(${Math.abs(item.daysUntil)} days ago)`);
        } else {
            parts.push(`(in ${item.daysUntil} days)`);
        }
    }

    if (item.heading.priority) {
        parts.push(`[#${item.heading.priority}]`);
    }

    return parts.join(' ');
}

async function openFileAtLine(filePath: string, lineNumber: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc);

    const position = new vscode.Position(lineNumber - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
    );
}
