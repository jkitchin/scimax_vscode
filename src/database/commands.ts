import * as vscode from 'vscode';
import * as path from 'path';
import {
    OrgDbSqlite,
    HeadingRecord,
    SourceBlockRecord,
    SearchResult,
    AgendaItem,
    SearchScope
} from './orgDbSqlite';
import {
    createEmbeddingService,
    testEmbeddingService,
    OllamaEmbeddingService,
    OpenAIEmbeddingService
} from './embeddingService';

export function registerDbCommands(
    context: vscode.ExtensionContext,
    db: OrgDbSqlite
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

                const stats = await db.getStats();
                vscode.window.showInformationMessage(
                    `Indexed ${totalIndexed} files. Total: ${stats.files} files, ${stats.headings} headings, ${stats.blocks} code blocks`
                );
            });
        })
    );

    // Full-text search (FTS5)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.search', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search all org/markdown files (FTS5)',
                placeHolder: 'Enter search term...'
            });

            if (!query) return;

            const results = await db.searchFullText(query, { limit: 100 });

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No results found for "${query}"`);
                return;
            }

            const items = results.map(result => ({
                label: `$(file) ${path.basename(result.file_path)}`,
                description: result.preview.replace(/<\/?mark>/g, ''),
                detail: result.file_path,
                result
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} results for "${query}"`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await openFileAtLine(selected.result.file_path, selected.result.line_number);
            }
        })
    );

    // Semantic search (vector)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchSemantic', async () => {
            const config = vscode.workspace.getConfiguration('scimax.db');
            const provider = config.get<string>('embeddingProvider') || 'none';

            if (provider === 'none') {
                const configure = await vscode.window.showWarningMessage(
                    'Semantic search requires an embedding provider. Configure one?',
                    'Configure'
                );
                if (configure === 'Configure') {
                    vscode.commands.executeCommand('scimax.db.configureEmbeddings');
                }
                return;
            }

            const query = await vscode.window.showInputBox({
                prompt: 'Semantic search (find by meaning)',
                placeHolder: 'Describe what you\'re looking for...'
            });

            if (!query) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Searching...',
                cancellable: false
            }, async () => {
                const results = await db.searchSemantic(query, { limit: 20 });

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No semantic matches for "${query}"`);
                    return;
                }

                const items = results.map(result => ({
                    label: `$(file) ${path.basename(result.file_path)}:${result.line_number}`,
                    description: `Score: ${(result.score * 100).toFixed(1)}%`,
                    detail: result.preview,
                    result
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `${results.length} semantic matches for "${query}"`,
                    matchOnDetail: true
                });

                if (selected) {
                    await openFileAtLine(selected.result.file_path, selected.result.line_number);
                }
            });
        })
    );

    // Hybrid search (FTS5 + vector)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHybrid', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Hybrid search (keywords + semantic)',
                placeHolder: 'Enter search query...'
            });

            if (!query) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Searching...',
                cancellable: false
            }, async () => {
                const results = await db.searchHybrid(query, { limit: 20 });

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results for "${query}"`);
                    return;
                }

                const items = results.map(result => ({
                    label: `$(file) ${path.basename(result.file_path)}:${result.line_number}`,
                    description: result.type === 'semantic' ? '$(sparkle) AI' : '$(search) Keywords',
                    detail: result.preview,
                    result
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `${results.length} hybrid results for "${query}"`,
                    matchOnDetail: true
                });

                if (selected) {
                    await openFileAtLine(selected.result.file_path, selected.result.line_number);
                }
            });
        })
    );

    // Configure embedding service
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.configureEmbeddings', async () => {
            const providerItems = [
                {
                    label: '$(x) None',
                    description: 'Disable semantic search',
                    provider: 'none'
                },
                {
                    label: '$(server) Ollama (Local)',
                    description: 'Free, private, requires Ollama running locally',
                    provider: 'ollama'
                },
                {
                    label: '$(cloud) OpenAI',
                    description: 'Cloud-based, requires API key',
                    provider: 'openai'
                }
            ];

            const selected = await vscode.window.showQuickPick(providerItems, {
                placeHolder: 'Select embedding provider for semantic search'
            });

            if (!selected) return;

            const config = vscode.workspace.getConfiguration('scimax.db');

            if (selected.provider === 'ollama') {
                // Test Ollama connection
                const url = config.get<string>('ollamaUrl') || 'http://localhost:11434';
                const modelItems = [
                    { label: 'nomic-embed-text', description: '768 dimensions (recommended)' },
                    { label: 'all-minilm', description: '384 dimensions (smaller)' },
                    { label: 'mxbai-embed-large', description: '1024 dimensions (larger)' }
                ];

                const modelChoice = await vscode.window.showQuickPick(modelItems, {
                    placeHolder: 'Select Ollama embedding model'
                });

                if (!modelChoice) return;

                // Test connection
                const testService = new OllamaEmbeddingService(url, modelChoice.label);
                const works = await testEmbeddingService(testService);

                if (!works) {
                    vscode.window.showErrorMessage(
                        `Could not connect to Ollama at ${url}. Make sure Ollama is running and the model is pulled: ollama pull ${modelChoice.label}`
                    );
                    return;
                }

                await config.update('embeddingProvider', 'ollama', vscode.ConfigurationTarget.Global);
                await config.update('ollamaModel', modelChoice.label, vscode.ConfigurationTarget.Global);

                db.setEmbeddingService(testService);
                vscode.window.showInformationMessage(
                    `Configured Ollama with ${modelChoice.label}. Run "Reindex Files" to enable semantic search.`
                );

            } else if (selected.provider === 'openai') {
                const apiKey = await vscode.window.showInputBox({
                    prompt: 'Enter your OpenAI API key',
                    password: true,
                    placeHolder: 'sk-...'
                });

                if (!apiKey) return;

                // Test connection
                const testService = new OpenAIEmbeddingService(apiKey);
                const works = await testEmbeddingService(testService);

                if (!works) {
                    vscode.window.showErrorMessage('Invalid OpenAI API key or connection error');
                    return;
                }

                await config.update('embeddingProvider', 'openai', vscode.ConfigurationTarget.Global);
                await config.update('openaiApiKey', apiKey, vscode.ConfigurationTarget.Global);

                db.setEmbeddingService(testService);
                vscode.window.showInformationMessage(
                    'Configured OpenAI embeddings. Run "Reindex Files" to enable semantic search.'
                );

            } else {
                await config.update('embeddingProvider', 'none', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('Semantic search disabled');
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

            const results = await db.searchHeadings(query);

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No headings found matching "${query}"`);
                return;
            }

            const items = results.slice(0, 100).map(heading => ({
                label: `${'  '.repeat(heading.level - 1)}${getHeadingIcon(heading)} ${heading.title}`,
                description: formatHeadingDescription(heading),
                detail: `${path.basename(heading.file_path)}:${heading.line_number}`,
                heading
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} headings matching "${query}"`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await openFileAtLine(selected.heading.file_path, selected.heading.line_number);
            }
        })
    );

    // Search by tag
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchByTag', async () => {
            const tags = await db.getAllTags();

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

            const results = await db.searchHeadings('', { tag: selected.tag });

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No headings with tag :${selected.tag}:`);
                return;
            }

            const items = results.map(heading => ({
                label: `${getHeadingIcon(heading)} ${heading.title}`,
                description: formatHeadingDescription(heading),
                detail: `${path.basename(heading.file_path)}:${heading.line_number}`,
                heading
            }));

            const headingSelected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} headings with :${selected.tag}:`
            });

            if (headingSelected) {
                await openFileAtLine(headingSelected.heading.file_path, headingSelected.heading.line_number);
            }
        })
    );

    // Search by property
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchByProperty', async () => {
            const propName = await vscode.window.showInputBox({
                prompt: 'Enter property name',
                placeHolder: 'e.g., ID, CATEGORY, CUSTOM_ID...'
            });

            if (!propName) return;

            const value = await vscode.window.showInputBox({
                prompt: `Search for value in :${propName}:`,
                placeHolder: 'Enter value (leave empty for any value)'
            });

            const results = await db.searchByProperty(propName, value || undefined);

            if (results.length === 0) {
                vscode.window.showInformationMessage(
                    `No headings with :${propName}:${value ? ` = "${value}"` : ''}`
                );
                return;
            }

            const items = results.map(heading => {
                const props = JSON.parse(heading.properties);
                return {
                    label: `${getHeadingIcon(heading)} ${heading.title}`,
                    description: `:${propName}: ${props[propName] || ''}`,
                    detail: `${path.basename(heading.file_path)}:${heading.line_number}`,
                    heading
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} headings with :${propName}:`
            });

            if (selected) {
                await openFileAtLine(selected.heading.file_path, selected.heading.line_number);
            }
        })
    );

    // Search source blocks
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchBlocks', async () => {
            const languages = await db.getAllLanguages();

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

            const results = await db.searchSourceBlocks(langChoice.language, query || undefined);

            if (results.length === 0) {
                vscode.window.showInformationMessage('No code blocks found');
                return;
            }

            const items = results.slice(0, 100).map(block => ({
                label: `$(code) ${block.language}`,
                description: block.content.split('\n')[0].slice(0, 60),
                detail: `${path.basename(block.file_path)}:${block.line_number}`,
                block
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} code blocks found`,
                matchOnDescription: true
            });

            if (selected) {
                await openFileAtLine(selected.block.file_path, selected.block.line_number);
            }
        })
    );

    // Search by hashtag
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHashtags', async () => {
            const hashtags = await db.getAllHashtags();

            if (hashtags.length === 0) {
                vscode.window.showInformationMessage('No hashtags found in indexed files');
                return;
            }

            const items = await Promise.all(hashtags.map(async tag => {
                const files = await db.findByHashtag(tag);
                return {
                    label: `#${tag}`,
                    description: `${files.length} files`,
                    tag
                };
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a hashtag'
            });

            if (!selected) return;

            const files = await db.findByHashtag(selected.tag);
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
            const todos = await db.getTodos();

            if (todos.length === 0) {
                vscode.window.showInformationMessage('No TODO items found');
                return;
            }

            const states = await db.getAllTodoStates();
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
                ? todos.filter(t => t.todo_state === stateChoice.state)
                : todos;

            const items = filtered.map(todo => ({
                label: `$(${getTodoIcon(todo.todo_state!)}) ${todo.title}`,
                description: formatHeadingDescription(todo),
                detail: `${path.basename(todo.file_path)}:${todo.line_number}`,
                todo
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${filtered.length} TODO items`
            });

            if (selected) {
                await openFileAtLine(selected.todo.file_path, selected.todo.line_number);
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

            const agendaItems = await db.getAgenda({
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
                detail: `${path.basename(item.heading.file_path)}:${item.heading.line_number}`,
                item
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${agendaItems.length} agenda items`
            });

            if (selected) {
                await openFileAtLine(selected.item.heading.file_path, selected.item.heading.line_number);
            }
        })
    );

    // Show Deadlines
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.deadlines', async () => {
            const agendaItems = (await db.getAgenda({ before: '+2w' }))
                .filter(item => item.type === 'deadline');

            if (agendaItems.length === 0) {
                vscode.window.showInformationMessage('No upcoming deadlines');
                return;
            }

            const items = agendaItems.map(item => ({
                label: `${getAgendaIcon(item)} ${item.heading.title}`,
                description: formatAgendaDescription(item),
                detail: `${path.basename(item.heading.file_path)}:${item.heading.line_number}`,
                item
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${agendaItems.length} upcoming deadlines`
            });

            if (selected) {
                await openFileAtLine(selected.item.heading.file_path, selected.item.heading.line_number);
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
            const files = await db.getFiles();

            if (files.length === 0) {
                vscode.window.showInformationMessage('No files indexed. Run "Scimax: Reindex Files" first.');
                return;
            }

            const items = files
                .sort((a, b) => b.indexed_at - a.indexed_at)
                .map(file => ({
                    label: `$(file) ${path.basename(file.path)}`,
                    description: new Date(file.indexed_at).toLocaleDateString(),
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
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Optimizing database...',
                cancellable: false
            }, async () => {
                await db.optimize();
            });
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
                await db.clear();
                vscode.window.showInformationMessage('Database cleared');
            }
        })
    );

    // Show database stats
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.stats', async () => {
            const stats = await db.getStats();
            const lastIndexed = stats.last_indexed
                ? new Date(stats.last_indexed).toLocaleString()
                : 'Never';

            const embeddingStatus = stats.has_embeddings
                ? `Semantic search: Enabled (${stats.chunks} chunks)`
                : 'Semantic search: Disabled';

            vscode.window.showInformationMessage(
                `Scimax DB: ${stats.files} files, ${stats.headings} headings, ` +
                `${stats.blocks} code blocks, ${stats.links} links. ` +
                `${embeddingStatus}. Last indexed: ${lastIndexed}`
            );
        })
    );
}

function getHeadingIcon(heading: HeadingRecord): string {
    if (heading.todo_state) {
        return `$(${getTodoIcon(heading.todo_state)})`;
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

    if (heading.todo_state) {
        parts.push(heading.todo_state);
    }

    if (heading.priority) {
        parts.push(`[#${heading.priority}]`);
    }

    // Parse tags from JSON string
    try {
        const tags = JSON.parse(heading.tags);
        if (Array.isArray(tags) && tags.length > 0) {
            parts.push(`:${tags.join(':')}:`);
        }
    } catch { }

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

    if (item.days_until !== undefined) {
        if (item.days_until === 0) {
            parts.push('(TODAY)');
        } else if (item.days_until === 1) {
            parts.push('(tomorrow)');
        } else if (item.days_until === -1) {
            parts.push('(yesterday)');
        } else if (item.days_until < 0) {
            parts.push(`(${Math.abs(item.days_until)} days ago)`);
        } else {
            parts.push(`(in ${item.days_until} days)`);
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
