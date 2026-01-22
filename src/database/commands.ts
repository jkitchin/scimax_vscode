import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    ScimaxDb,
    HeadingRecord,
    SourceBlockRecord,
    SearchResult,
    AgendaItem,
    SearchScope
} from './scimaxDb';
import {
    createEmbeddingServiceAsync,
    testEmbeddingService,
    TransformersJsEmbeddingService,
    OllamaEmbeddingService,
    OpenAIEmbeddingService
} from './embeddingService';
import { getDatabase, getExtensionContext, cancelStaleFileCheck } from './lazyDb';
import { storeOpenAIApiKey, deleteOpenAIApiKey } from './secretStorage';
import { resolveScimaxPath } from '../utils/pathResolver';

/**
 * Debounce function for dynamic QuickPick updates
 */
function debounce<T extends (...args: any[]) => void>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | undefined;
    return (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Create an ivy-like QuickPick with dynamic re-querying on each keystroke.
 * Results are fetched from the database as the user types.
 */
async function createDynamicQuickPick<T>(options: {
    placeholder: string;
    searchFn: (query: string) => Promise<T[]>;
    formatItem: (item: T) => vscode.QuickPickItem & { data: T };
    onSelect: (item: T) => Promise<void>;
    debounceMs?: number;
    minQueryLength?: number;
}): Promise<void> {
    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { data: T }>();
    quickPick.placeholder = options.placeholder;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    const debounceMs = options.debounceMs ?? 150;
    const minQueryLength = options.minQueryLength ?? 1;

    const updateResults = debounce(async (query: string) => {
        if (query.length < minQueryLength) {
            quickPick.items = [];
            return;
        }

        quickPick.busy = true;
        try {
            const results = await options.searchFn(query);
            quickPick.items = results.map(options.formatItem);
        } catch (err) {
            console.error('Search error:', err);
            quickPick.items = [];
        } finally {
            quickPick.busy = false;
        }
    }, debounceMs);

    quickPick.onDidChangeValue(updateResults);

    quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            quickPick.hide();
            await options.onSelect(selected.data);
        }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
}

/**
 * Helper to get database with user notification on failure
 */
async function requireDatabase(): Promise<ScimaxDb | null> {
    const db = await getDatabase();
    if (!db) {
        vscode.window.showWarningMessage(
            'Database is not available. Please check the extension logs for errors.'
        );
    }
    return db;
}

export function registerDbCommands(
    context: vscode.ExtensionContext
): void {
    // Cancel background sync (click on status bar)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.cancelSync', async () => {
            cancelStaleFileCheck();
            const db = await getDatabase();
            if (db) {
                db.cancelEmbeddingQueue();
            }
            vscode.window.showInformationMessage('Background sync cancelled');
        })
    );

    // Cancel embedding queue only
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.cancelEmbeddings', async () => {
            const db = await getDatabase();
            if (db) {
                db.cancelEmbeddingQueue();
                vscode.window.showInformationMessage('Embedding queue cancelled');
            }
        })
    );

    // Toggle auto-scanning on/off
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.toggleAutoScan', async () => {
            const config = vscode.workspace.getConfiguration('scimax.db');
            const currentValue = config.get<boolean>('autoCheckStale', true);
            const newValue = !currentValue;

            await config.update('autoCheckStale', newValue, vscode.ConfigurationTarget.Global);

            if (newValue) {
                vscode.window.showInformationMessage('Auto-scanning enabled. Files will be checked on startup.');
            } else {
                // Also cancel any running scan
                cancelStaleFileCheck();
                vscode.window.showInformationMessage('Auto-scanning disabled. Use "Scimax: Rebuild Database Index" to manually index files.');
            }
        })
    );

    // Reindex all files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.reindex', async () => {
            const db = await requireDatabase();
            if (!db) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: 'Indexing',
                cancellable: false
            }, async (progress) => {
                let totalIndexed = 0;
                const config = vscode.workspace.getConfiguration('scimax.db');
                const directoriesToIndex: string[] = [];

                // Include journal directory if enabled
                if (config.get<boolean>('includeJournal', true)) {
                    const journalDir = resolveScimaxPath('scimax.journal.directory', 'journal');
                    if (journalDir && fs.existsSync(journalDir)) {
                        directoriesToIndex.push(journalDir);
                    }
                }

                // Include workspace folders if enabled
                if (config.get<boolean>('includeWorkspace', true)) {
                    const workspaceFolders = vscode.workspace.workspaceFolders || [];
                    for (const folder of workspaceFolders) {
                        directoriesToIndex.push(folder.uri.fsPath);
                    }
                }

                // Include scimax projects if enabled
                if (config.get<boolean>('includeProjects', true)) {
                    const ctx = getExtensionContext();
                    if (ctx) {
                        interface Project { path: string; }
                        const projects = ctx.globalState.get<Project[]>('scimax.projects', []);
                        for (const project of projects) {
                            if (fs.existsSync(project.path)) {
                                directoriesToIndex.push(project.path);
                            }
                        }
                    }
                }

                // Include additional directories from config
                const additionalDirs = config.get<string[]>('include') || [];
                for (let dir of additionalDirs) {
                    // Expand ~ for home directory
                    if (dir.startsWith('~')) {
                        dir = dir.replace(/^~/, process.env.HOME || '');
                    }
                    if (fs.existsSync(dir)) {
                        directoriesToIndex.push(dir);
                    }
                }

                // Deduplicate directories
                const uniqueDirs = [...new Set(directoriesToIndex)];

                if (uniqueDirs.length === 0) {
                    vscode.window.showWarningMessage('No directories to index. Check scimax.db settings.');
                    return;
                }

                // Index all directories
                for (let i = 0; i < uniqueDirs.length; i++) {
                    const dir = uniqueDirs[i];
                    progress.report({
                        message: `Scanning ${path.basename(dir)} (${i + 1}/${uniqueDirs.length})...`
                    });
                    const indexed = await db.indexDirectory(dir, progress);
                    totalIndexed += indexed;

                    // Yield between directories
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                const stats = await db.getStats();
                vscode.window.showInformationMessage(
                    `Indexed ${totalIndexed} files. Total: ${stats.files} files, ${stats.headings} headings, ${stats.blocks} code blocks`
                );
            });
        })
    );

    // Full-text search (FTS5) - ivy-style dynamic collection
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.search', async () => {
            const db = await requireDatabase();
            if (!db) return;

            await createDynamicQuickPick<SearchResult>({
                placeholder: 'Type to search (FTS5)...',
                debounceMs: 150,
                minQueryLength: 2,
                searchFn: async (query) => db.searchFullText(query, { limit: 100 }),
                formatItem: (result) => ({
                    label: `$(file) ${path.basename(result.file_path)}:${result.line_number}`,
                    description: result.preview.replace(/<\/?mark>/g, ''),
                    detail: result.file_path,
                    data: result
                }),
                onSelect: async (result) => {
                    await openFileAtLine(result.file_path, result.line_number);
                }
            });
        })
    );

    // Semantic search (vector) - ivy-style dynamic collection
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchSemantic', async () => {
            const db = await requireDatabase();
            if (!db) return;

            // Check if vector search is supported by libsql
            const vectorStatus = db.getVectorSearchStatus();
            if (!vectorStatus.supported) {
                vscode.window.showWarningMessage(
                    `Semantic search unavailable: ${vectorStatus.error || 'Vector search not supported by database'}. Use full-text search (Ctrl+Shift+F) instead.`
                );
                return;
            }

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

            await createDynamicQuickPick<SearchResult>({
                placeholder: 'Type to search by meaning (semantic)...',
                debounceMs: 300,  // Slower debounce for embedding API calls
                minQueryLength: 3,
                searchFn: async (query) => db.searchSemantic(query, { limit: 20 }),
                formatItem: (result) => ({
                    label: `$(file) ${path.basename(result.file_path)}:${result.line_number}`,
                    description: `Score: ${(result.score * 100).toFixed(1)}%`,
                    detail: result.preview,
                    data: result
                }),
                onSelect: async (result) => {
                    await openFileAtLine(result.file_path, result.line_number);
                }
            });
        })
    );

    // Hybrid search (FTS5 + vector) - ivy-style dynamic collection
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHybrid', async () => {
            const db = await requireDatabase();
            if (!db) return;

            await createDynamicQuickPick<SearchResult>({
                placeholder: 'Type to search (keywords + semantic)...',
                debounceMs: 250,
                minQueryLength: 2,
                searchFn: async (query) => db.searchHybrid(query, { limit: 20 }),
                formatItem: (result) => ({
                    label: `$(file) ${path.basename(result.file_path)}:${result.line_number}`,
                    description: result.type === 'semantic' ? '$(sparkle) AI' : '$(search) Keywords',
                    detail: result.preview,
                    data: result
                }),
                onSelect: async (result) => {
                    await openFileAtLine(result.file_path, result.line_number);
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
                    label: '$(chip) Local (Transformers.js)',
                    description: 'Free, private, runs in VS Code (recommended)',
                    provider: 'local'
                },
                {
                    label: '$(server) Ollama',
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

            if (selected.provider === 'local') {
                const modelItems = [
                    { label: 'Xenova/all-MiniLM-L6-v2', description: '384 dimensions (recommended, fast)' },
                    { label: 'Xenova/bge-small-en-v1.5', description: '384 dimensions (high quality)' },
                    { label: 'Xenova/gte-small', description: '384 dimensions (alternative)' }
                ];

                const modelChoice = await vscode.window.showQuickPick(modelItems, {
                    placeHolder: 'Select local embedding model (downloads on first use, ~30MB)'
                });

                if (!modelChoice) return;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Testing local embeddings...',
                    cancellable: false
                }, async () => {
                    const testService = new TransformersJsEmbeddingService(modelChoice.label);
                    const works = await testEmbeddingService(testService);

                    if (!works) {
                        vscode.window.showErrorMessage(
                            `Failed to load model ${modelChoice.label}. Check console for errors.`
                        );
                        return;
                    }

                    await config.update('embeddingProvider', 'local', vscode.ConfigurationTarget.Global);
                    await config.update('localModel', modelChoice.label, vscode.ConfigurationTarget.Global);

                    const db = await getDatabase();
                    if (db) {
                        db.setEmbeddingService(testService);
                    }
                    vscode.window.showInformationMessage(
                        `Configured local embeddings with ${modelChoice.label}. Run "Reindex Files" to enable semantic search.`
                    );
                });

            } else if (selected.provider === 'ollama') {
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

                const db = await getDatabase();
                if (db) {
                    db.setEmbeddingService(testService);
                }
                vscode.window.showInformationMessage(
                    `Configured Ollama with ${modelChoice.label}. Run "Reindex Files" to enable semantic search.`
                );

            } else if (selected.provider === 'openai') {
                const apiKey = await vscode.window.showInputBox({
                    prompt: 'Enter your OpenAI API key',
                    password: true,
                    placeHolder: 'sk-...',
                    ignoreFocusOut: true
                });

                if (!apiKey) return;

                const testService = new OpenAIEmbeddingService(apiKey);
                const works = await testEmbeddingService(testService);

                if (!works) {
                    vscode.window.showErrorMessage('Invalid OpenAI API key or connection error');
                    return;
                }

                // Store API key securely in OS credential manager
                await storeOpenAIApiKey(apiKey);
                await config.update('embeddingProvider', 'openai', vscode.ConfigurationTarget.Global);

                const db = await getDatabase();
                if (db) {
                    db.setEmbeddingService(testService);
                }
                vscode.window.showInformationMessage(
                    'Configured OpenAI embeddings (API key stored securely). Run "Reindex Files" to enable semantic search.'
                );

            } else {
                // Disable - also clean up any stored API key
                await deleteOpenAIApiKey();
                await config.update('embeddingProvider', 'none', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('Semantic search disabled');
            }
        })
    );

    // Search headings (ivy-style: load all, filter locally)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHeadings', async () => {
            const db = await requireDatabase();
            if (!db) return;

            // Load all headings upfront for ivy-style filtering
            const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { heading: HeadingRecord }>();
            quickPick.placeholder = 'Type to filter headings...';
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;
            quickPick.busy = true;

            // Load headings in background
            db.searchHeadings('', { limit: 5000 }).then(headings => {
                quickPick.items = headings.map(heading => ({
                    label: `${'  '.repeat(heading.level - 1)}${getHeadingIcon(heading)} ${heading.title}`,
                    description: formatHeadingDescription(heading),
                    detail: `${path.basename(heading.file_path)}:${heading.line_number}`,
                    heading
                }));
                quickPick.busy = false;
            });

            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];
                if (selected) {
                    quickPick.hide();
                    await openFileAtLine(selected.heading.file_path, selected.heading.line_number);
                }
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        })
    );

    // Search by tag
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchByTag', async () => {
            const db = await requireDatabase();
            if (!db) return;

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

            const db = await requireDatabase();
            if (!db) return;

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
            const db = await requireDatabase();
            if (!db) return;

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
            const db = await requireDatabase();
            if (!db) return;

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
            const db = await requireDatabase();
            if (!db) return;

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

            const db = await requireDatabase();
            if (!db) return;

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
            const db = await requireDatabase();
            if (!db) return;

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
            const db = await requireDatabase();
            if (!db) return;

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
            const db = await requireDatabase();
            if (!db) return;

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
            const db = await requireDatabase();
            if (!db) return;

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
                const db = await requireDatabase();
                if (!db) return;

                await db.clear();
                vscode.window.showInformationMessage('Database cleared');
            }
        })
    );

    // Show database stats
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.stats', async () => {
            const db = await requireDatabase();
            if (!db) return;

            const stats = await db.getStats();
            const lastIndexed = stats.last_indexed
                ? new Date(stats.last_indexed).toLocaleString()
                : 'Never';

            // Build semantic search status message
            let semanticStatus: string;
            if (!stats.vector_search_supported) {
                semanticStatus = `Semantic search: Unavailable (${stats.vector_search_error || 'not supported'})`;
            } else if (stats.has_embeddings) {
                semanticStatus = `Semantic search: Enabled (${stats.chunks} chunks)`;
            } else {
                semanticStatus = 'Semantic search: Ready (no embeddings yet - configure provider)';
            }

            const fileTypes = stats.by_type
                ? `(${stats.by_type.org} org, ${stats.by_type.md} md)`
                : '';

            vscode.window.showInformationMessage(
                `Scimax DB: ${stats.files} files ${fileTypes}, ${stats.headings} headings, ` +
                `${stats.blocks} code blocks, ${stats.links} links. ` +
                `${semanticStatus}. Last indexed: ${lastIndexed}`
            );
        })
    );

    // Backup database
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.backup', async () => {
            const db = await requireDatabase();
            if (!db) return;

            // Ask user for backup location
            const defaultPath = path.join(
                process.env.HOME || '',
                `scimax-backup-${new Date().toISOString().split('T')[0]}.json`
            );

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultPath),
                filters: { 'JSON files': ['json'] },
                title: 'Save Database Backup'
            });

            if (!uri) return;

            try {
                const result = await db.exportBackup(uri.fsPath);
                vscode.window.showInformationMessage(
                    `Backup saved: ${result.projects} projects, ${result.files} indexed files recorded. ` +
                    `File: ${path.basename(uri.fsPath)}`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Backup failed: ${error.message}`);
            }
        })
    );

    // Restore database from backup
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.restore', async () => {
            const db = await requireDatabase();
            if (!db) return;

            // Ask user to select backup file
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'JSON files': ['json'] },
                title: 'Select Database Backup to Restore'
            });

            if (!uris || uris.length === 0) return;

            const confirm = await vscode.window.showWarningMessage(
                'Restoring from backup will overwrite current projects list and agenda settings. Continue?',
                { modal: true },
                'Yes, restore'
            );

            if (confirm !== 'Yes, restore') return;

            try {
                const result = await db.importBackup(uris[0].fsPath);

                const reindex = await vscode.window.showInformationMessage(
                    `Restored ${result.projects} projects. ${result.filesToIndex} files can be re-indexed. ` +
                    `Would you like to rebuild the database now?`,
                    'Rebuild Now',
                    'Later'
                );

                if (reindex === 'Rebuild Now') {
                    vscode.commands.executeCommand('scimax.db.rebuild');
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Restore failed: ${error.message}`);
            }
        })
    );

    // Rebuild database from scratch
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.rebuild', async () => {
            const db = await requireDatabase();
            if (!db) return;

            const confirm = await vscode.window.showWarningMessage(
                'Rebuilding will clear all indexed data and re-index from source files. ' +
                'This may take several minutes for large collections. Continue?',
                { modal: true },
                'Yes, rebuild'
            );

            if (confirm !== 'Yes, rebuild') return;

            const cancellationToken = { cancelled: false };

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Rebuilding database',
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    cancellationToken.cancelled = true;
                });

                try {
                    const result = await db.rebuild({
                        onProgress: (status) => {
                            progress.report({
                                message: `${status.phase}: ${status.current}/${status.total}`,
                                increment: status.total > 0 ? (100 / status.total) : 0
                            });
                        },
                        cancellationToken
                    });

                    if (cancellationToken.cancelled) {
                        vscode.window.showInformationMessage('Database rebuild cancelled');
                    } else {
                        vscode.window.showInformationMessage(
                            `Database rebuilt: ${result.filesIndexed} files indexed, ${result.errors} errors`
                        );
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Rebuild failed: ${error.message}`);
                }
            });
        })
    );

    // Verify database integrity
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.verify', async () => {
            const db = await requireDatabase();
            if (!db) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Verifying database integrity...',
                cancellable: false
            }, async () => {
                try {
                    const result = await db.verify();

                    if (result.ok) {
                        vscode.window.showInformationMessage(
                            `Database OK: ${result.stats.files} files, no issues found`
                        );
                    } else {
                        // Show issues in output channel
                        const outputChannel = vscode.window.createOutputChannel('Scimax DB Verify');
                        outputChannel.clear();
                        outputChannel.appendLine('Database Verification Report');
                        outputChannel.appendLine('============================');
                        outputChannel.appendLine('');
                        outputChannel.appendLine(`Files in database: ${result.stats.files}`);
                        outputChannel.appendLine(`Missing files: ${result.stats.missingFiles}`);
                        outputChannel.appendLine(`Stale files: ${result.stats.staleFiles}`);
                        outputChannel.appendLine(`Orphaned headings: ${result.stats.orphanedHeadings}`);
                        outputChannel.appendLine(`Orphaned blocks: ${result.stats.orphanedBlocks}`);
                        outputChannel.appendLine('');
                        outputChannel.appendLine('Issues:');
                        for (const issue of result.issues.slice(0, 100)) {
                            outputChannel.appendLine(`  - ${issue}`);
                        }
                        if (result.issues.length > 100) {
                            outputChannel.appendLine(`  ... and ${result.issues.length - 100} more`);
                        }
                        outputChannel.show();

                        const action = await vscode.window.showWarningMessage(
                            `Database has ${result.issues.length} issues. ` +
                            `${result.stats.missingFiles} missing files, ${result.stats.staleFiles} stale files. ` +
                            `See output for details.`,
                            'Rebuild Database',
                            'Optimize (remove missing)',
                            'Ignore'
                        );

                        if (action === 'Rebuild Database') {
                            vscode.commands.executeCommand('scimax.db.rebuild');
                        } else if (action === 'Optimize (remove missing)') {
                            vscode.commands.executeCommand('scimax.db.optimize');
                        }
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Verify failed: ${error.message}`);
                }
            });
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
