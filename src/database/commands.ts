import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    ScimaxDb,
    HeadingRecord,
    SearchResult,
    AgendaItem,
    SearchScope,
    AdvancedSearchResult
} from './scimaxDb';
import {
    testEmbeddingService,
    OllamaEmbeddingService
} from './embeddingService';
import { getDatabase, getExtensionContext, cancelStaleFileCheck } from './lazyDb';
import { resolveScimaxPath } from '../utils/pathResolver';
import { databaseLogger as log } from '../utils/logger';

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
    const basePlaceholder = options.placeholder;
    quickPick.placeholder = basePlaceholder;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    const debounceMs = options.debounceMs ?? 150;
    const minQueryLength = options.minQueryLength ?? 1;

    const updateResults = debounce(async (query: string) => {
        if (query.length < minQueryLength) {
            quickPick.items = [];
            quickPick.placeholder = basePlaceholder;
            return;
        }

        quickPick.busy = true;
        quickPick.placeholder = 'Searching...';
        try {
            const results = await options.searchFn(query);
            if (results.length === 0) {
                quickPick.items = [{
                    label: '$(info) No results found',
                    description: `for "${query}"`,
                    data: null as any,
                    alwaysShow: true
                }];
            } else {
                quickPick.items = results.map(options.formatItem);
            }
            quickPick.placeholder = `${results.length} result${results.length !== 1 ? 's' : ''}`;
        } catch (err) {
            console.error('Search error:', err);
            quickPick.items = [{
                label: '$(error) Search failed',
                description: String(err),
                data: null as any,
                alwaysShow: true
            }];
            quickPick.placeholder = 'Error';
        } finally {
            quickPick.busy = false;
        }
    }, debounceMs);

    quickPick.onDidChangeValue(updateResults);

    quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected && selected.data) {
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

    // Reindex all files (two-phase: scan paths first, then batch index)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.reindex', async () => {
            log.info('=== REINDEX COMMAND STARTED ===');
            const db = await requireDatabase();
            if (!db) {
                log.error('Reindex failed: database not available');
                return;
            }

            const cancellationToken = { cancelled: false };

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Reindexing files',
                cancellable: true
            }, async (progress, token) => {
                // Set up cancellation
                token.onCancellationRequested(() => {
                    log.info('Reindex cancellation requested by user');
                    cancellationToken.cancelled = true;
                });

                let totalIndexed = 0;
                let totalDeleted = 0;
                const config = vscode.workspace.getConfiguration('scimax.db');
                const directoriesToIndex: string[] = [];

                // Batch size for memory-safe processing (files per batch before GC pause)
                // Increased defaults for faster reindexing while still allowing GC
                const batchSize = config.get<number>('reindexBatchSize', 50);
                const pauseMs = config.get<number>('reindexPauseMs', 100);
                const maxFilesPerReindex = config.get<number>('maxFilesPerReindex', 0);
                log.info('Reindex config', { batchSize, pauseMs, maxFilesPerReindex });

                // ========== PHASE 1: Remove deleted files ==========
                log.info('--- PHASE 1: Checking for deleted files ---');
                progress.report({ message: 'Checking for deleted files...' });
                try {
                    const deleteResult = await db.removeDeletedFiles((status) => {
                        if (cancellationToken.cancelled) return;
                        progress.report({
                            message: `Checking files (${status.checked}/${status.total})...`
                        });
                        // Log every 500 files
                        if (status.checked % 500 === 0) {
                            log.debug('Phase 1 progress', { checked: status.checked, total: status.total });
                        }
                    });
                    totalDeleted = deleteResult.deleted;
                    log.info('Phase 1 complete', { deleted: totalDeleted, checked: deleteResult.checked });
                } catch (error) {
                    log.error('Phase 1 failed', error as Error);
                    throw error;
                }

                if (cancellationToken.cancelled) {
                    log.info('Reindex cancelled after Phase 1');
                    vscode.window.showInformationMessage('Reindex cancelled');
                    return;
                }

                // ========== Collect directories to scan ==========
                log.info('--- Collecting directories to scan ---');

                // Include journal directory if enabled
                if (config.get<boolean>('includeJournal', true)) {
                    const journalDir = resolveScimaxPath('scimax.journal.directory', 'journal');
                    if (journalDir && fs.existsSync(journalDir)) {
                        directoriesToIndex.push(journalDir);
                        log.debug('Added journal directory', { path: journalDir });
                    }
                }

                // Include workspace folders if enabled
                if (config.get<boolean>('includeWorkspace', true)) {
                    const workspaceFolders = vscode.workspace.workspaceFolders || [];
                    for (const folder of workspaceFolders) {
                        directoriesToIndex.push(folder.uri.fsPath);
                    }
                    log.debug('Added workspace folders', { count: workspaceFolders.length });
                }

                // Include scimax projects if enabled
                if (config.get<boolean>('includeProjects', true)) {
                    const ctx = getExtensionContext();
                    if (ctx) {
                        interface Project { path: string; }
                        const projects = ctx.globalState.get<Project[]>('scimax.projects', []);
                        let addedProjects = 0;
                        for (const project of projects) {
                            if (fs.existsSync(project.path)) {
                                directoriesToIndex.push(project.path);
                                addedProjects++;
                            }
                        }
                        log.debug('Added scimax projects', { total: projects.length, existing: addedProjects });
                    }
                }

                // Include additional directories from config
                const additionalDirs = config.get<string[]>('include') || [];
                let addedAdditional = 0;
                for (let dir of additionalDirs) {
                    // Expand ~ for home directory
                    if (dir.startsWith('~')) {
                        dir = dir.replace(/^~/, process.env.HOME || '');
                    }
                    if (fs.existsSync(dir)) {
                        directoriesToIndex.push(dir);
                        addedAdditional++;
                    }
                }
                if (additionalDirs.length > 0) {
                    log.debug('Added additional directories', { configured: additionalDirs.length, existing: addedAdditional });
                }

                // Deduplicate directories
                const uniqueDirs = [...new Set(directoriesToIndex)];
                log.info('Directories to scan', { total: uniqueDirs.length });

                if (uniqueDirs.length === 0) {
                    log.warn('No directories to index');
                    vscode.window.showWarningMessage('No directories to index. Check scimax.db settings.');
                    return;
                }

                // ========== PHASE 2: Collect file paths ==========
                log.debug('--- PHASE 2: Scanning directories for file paths ---');
                progress.report({ message: 'Scanning for files...' });

                // Use a Set directly to avoid duplicate array
                const filePathSet = new Set<string>();

                for (let dirIndex = 0; dirIndex < uniqueDirs.length; dirIndex++) {
                    const dir = uniqueDirs[dirIndex];
                    if (cancellationToken.cancelled) break;

                    log.debug('Scanning directory', { index: dirIndex + 1, total: uniqueDirs.length, dir: path.basename(dir) });
                    progress.report({ message: `Scanning ${path.basename(dir)}... (${filePathSet.size} files found)` });

                    try {
                        const filePaths = await db.collectFilePaths(dir, (count) => {
                            progress.report({ message: `Scanning ${path.basename(dir)}... (${filePathSet.size + count} files found)` });
                        });
                        // Add to set (automatic dedup)
                        for (const fp of filePaths) {
                            filePathSet.add(fp);
                        }
                        log.debug('Directory scanned', { dir: path.basename(dir), found: filePaths.length, total: filePathSet.size });
                    } catch (error) {
                        log.error('Error scanning directory', error as Error, { path: dir });
                    }
                }

                if (cancellationToken.cancelled) {
                    log.info('Reindex cancelled during Phase 2');
                    vscode.window.showInformationMessage('Reindex cancelled');
                    return;
                }

                const totalUniqueFiles = filePathSet.size;
                log.info('Phase 2 complete', { uniqueFiles: totalUniqueFiles });
                progress.report({ message: `Found ${totalUniqueFiles} files. Checking which need indexing...` });

                // ========== PHASE 3: Filter files needing reindex ==========
                // Process directly from set to array of files needing reindex
                log.info('--- PHASE 3: Filtering files that need reindexing ---');
                const filesToIndex: string[] = [];
                let checked = 0;

                for (const filePath of filePathSet) {
                    if (cancellationToken.cancelled) break;

                    try {
                        if (await db.needsReindex(filePath)) {
                            filesToIndex.push(filePath);
                        }
                    } catch (error) {
                        log.error('Error checking file', error as Error, { path: filePath });
                    }

                    checked++;
                    // Progress update every 100 files
                    if (checked % 100 === 0) {
                        progress.report({
                            message: `Checking ${checked}/${totalUniqueFiles} files (${filesToIndex.length} need indexing)`
                        });
                    }
                    // Log every 1000 files
                    if (checked % 1000 === 0) {
                        log.info('Phase 3 progress', { checked, total: totalUniqueFiles, needIndex: filesToIndex.length });
                    }
                }

                // Clear the set to free memory before Phase 4
                filePathSet.clear();

                if (cancellationToken.cancelled) {
                    log.info('Reindex cancelled during Phase 3');
                    vscode.window.showInformationMessage('Reindex cancelled');
                    return;
                }

                log.info('Phase 3 complete', { checked: totalUniqueFiles, needIndex: filesToIndex.length });

                if (filesToIndex.length === 0) {
                    const stats = await db.getStats();
                    const deletedMsg = totalDeleted > 0 ? `Removed ${totalDeleted} deleted. ` : '';
                    log.info('All files up to date', { totalFiles: totalUniqueFiles, deleted: totalDeleted });
                    vscode.window.showInformationMessage(
                        `${deletedMsg}All ${totalUniqueFiles} files are up to date. Total: ${stats.files} files, ${stats.headings} headings`
                    );
                    return;
                }

                // Apply max files limit if configured (0 = unlimited)
                let filesSkipped = 0;
                const originalCount = filesToIndex.length;
                if (maxFilesPerReindex > 0 && filesToIndex.length > maxFilesPerReindex) {
                    filesSkipped = filesToIndex.length - maxFilesPerReindex;
                    // Truncate to max - remaining files will be indexed on next run
                    filesToIndex.length = maxFilesPerReindex;
                    log.info('Applied max files limit', {
                        maxFilesPerReindex,
                        processing: maxFilesPerReindex,
                        skipped: filesSkipped
                    });
                    vscode.window.showInformationMessage(
                        `Processing ${maxFilesPerReindex} of ${originalCount} files. ` +
                        `Run reindex again to continue (${filesSkipped} remaining). ` +
                        `Increase scimax.db.maxFilesPerReindex to process more files per session.`
                    );
                }

                // ========== PHASE 4: Index files in batches ==========
                const totalFilesToIndex = filesToIndex.length;
                const totalBatches = Math.ceil(totalFilesToIndex / batchSize);
                log.info('--- PHASE 4: Indexing files in batches ---', {
                    filesToIndex: totalFilesToIndex,
                    batchSize,
                    pauseMs,
                    totalBatches
                });
                progress.report({ message: `Indexing ${totalFilesToIndex} files in batches of ${batchSize}...` });

                // Process in batches, using shift() to release memory as we go
                // This allows GC to reclaim processed file paths
                let batchNum = 0;

                while (filesToIndex.length > 0 && !cancellationToken.cancelled) {
                    batchNum++;
                    // Take files from front of array (shift releases memory)
                    const batchFiles: string[] = [];
                    for (let i = 0; i < batchSize && filesToIndex.length > 0; i++) {
                        batchFiles.push(filesToIndex.shift()!);
                    }

                    log.debug('Starting batch', { batch: batchNum, total: totalBatches, files: batchFiles.length });
                    progress.report({
                        message: `Batch ${batchNum}/${totalBatches}: Indexing ${totalIndexed}/${totalFilesToIndex} files...`
                    });

                    // Index this batch - one file at a time with yields
                    let batchIndexed = 0;
                    let batchErrors = 0;

                    for (let fileIndex = 0; fileIndex < batchFiles.length; fileIndex++) {
                        if (cancellationToken.cancelled) break;

                        const filePath = batchFiles[fileIndex];
                        const fileName = path.basename(filePath);
                        const globalFileNum = totalIndexed + 1;

                        // Log every 10th file to avoid excessive output
                        if (globalFileNum % 10 === 0 || globalFileNum === 1) {
                            log.debug('Indexing', { file: fileName, num: globalFileNum, total: totalFilesToIndex });
                        }

                        try {
                            await db.indexFile(filePath, { queueEmbeddings: true });
                            totalIndexed++;
                            batchIndexed++;
                        } catch (error) {
                            batchErrors++;
                            log.error('Error indexing file', error as Error, { path: filePath });
                        }

                        // Yield after EVERY file to keep UI responsive
                        // Yield to allow event loop to process
                        await new Promise(resolve => setTimeout(resolve, 1));
                    }

                    // Clear batch array to release references
                    batchFiles.length = 0;

                    log.debug('Batch complete', {
                        batch: batchNum,
                        indexed: batchIndexed,
                        errors: batchErrors,
                        totalIndexed,
                        remaining: filesToIndex.length
                    });

                    // Brief pause between batches to allow GC and prevent blocking
                    if (filesToIndex.length > 0) {
                        log.debug('Batch pause', { pauseMs, nextBatch: batchNum + 1, remaining: filesToIndex.length });
                        progress.report({ message: `Indexed ${totalIndexed}/${totalFilesToIndex}...` });
                        await new Promise(resolve => setTimeout(resolve, pauseMs));
                    }
                }

                if (cancellationToken.cancelled) {
                    log.info('Reindex cancelled during Phase 4', { indexed: totalIndexed });
                    vscode.window.showInformationMessage(
                        `Reindex cancelled. Indexed ${totalIndexed} files before stopping.`
                    );
                    return;
                }

                const stats = await db.getStats();
                const deletedMsg = totalDeleted > 0 ? `, removed ${totalDeleted} deleted` : '';
                const skippedMsg = filesSkipped > 0 ? `. Run again to continue (${filesSkipped} remaining)` : '';

                log.info('=== REINDEX COMPLETE ===', {
                    indexed: totalIndexed,
                    deleted: totalDeleted,
                    skipped: filesSkipped,
                    totalFiles: stats.files,
                    totalHeadings: stats.headings
                });

                vscode.window.showInformationMessage(
                    `Reindex complete: ${totalIndexed} files indexed${deletedMsg}. Total: ${stats.files} files, ${stats.headings} headings${skippedMsg}`
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

    // Advanced search (full pipeline with expansion + reranking)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchAdvanced', async () => {
            const db = await requireDatabase();
            if (!db) return;

            // Show progress for advanced search
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Advanced Search',
                    cancellable: false
                },
                async (progress) => {
                    await createDynamicQuickPick<SearchResult>({
                        placeholder: 'Type to search (advanced: expansion + reranking)...',
                        debounceMs: 300,  // Slightly longer debounce for advanced search
                        minQueryLength: 2,
                        searchFn: async (query) => {
                            return db.searchAdvanced(query, { mode: 'advanced' }, (stage, current, total) => {
                                progress.report({
                                    message: stage,
                                    increment: (current / total) * 25
                                });
                            });
                        },
                        formatItem: (result) => {
                            const advResult = result as any;
                            let icon = '$(search)';
                            if (advResult.rerankerScore !== undefined) {
                                icon = '$(sparkle)';
                            } else if (advResult.retrievalMethod === 'vector') {
                                icon = '$(symbol-field)';
                            }
                            return {
                                label: `${icon} ${path.basename(result.file_path)}:${result.line_number}`,
                                description: advResult.querySource ? `via ${advResult.querySource}` : '',
                                detail: result.preview,
                                data: result
                            };
                        },
                        onSelect: async (result) => {
                            await openFileAtLine(result.file_path, result.line_number);
                        }
                    });
                }
            );
        })
    );

    // Show search capabilities
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchCapabilities', async () => {
            const db = await requireDatabase();
            if (!db) return;

            const caps = await db.getSearchCapabilities();

            const items = [
                {
                    label: caps.fts ? '$(check) Full-Text Search (FTS5/BM25)' : '$(x) Full-Text Search',
                    description: caps.fts ? 'Available' : 'Unavailable'
                },
                {
                    label: caps.semantic ? '$(check) Semantic/Vector Search' : '$(x) Semantic/Vector Search',
                    description: caps.semantic ? 'Available (Ollama)' : 'Unavailable - configure embeddings'
                },
                {
                    label: caps.queryExpansionPRF ? '$(check) Query Expansion (PRF)' : '$(x) Query Expansion (PRF)',
                    description: caps.queryExpansionPRF ? 'Available (no LLM required)' : 'Unavailable'
                },
                {
                    label: caps.queryExpansionLLM ? '$(check) Query Expansion (LLM)' : '$(x) Query Expansion (LLM)',
                    description: caps.queryExpansionLLM ? 'Available (Ollama)' : 'Unavailable - check Ollama'
                },
                {
                    label: caps.reranking ? '$(check) LLM Reranking' : '$(x) LLM Reranking',
                    description: caps.reranking ? 'Available (Ollama)' : 'Unavailable - pull qwen3:0.6b'
                }
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Search Capabilities - select to configure',
                title: 'Scimax Search Capabilities'
            });

            if (selected && selected.description?.includes('configure')) {
                await vscode.commands.executeCommand('scimax.db.configureEmbeddings');
            }
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
                    label: '$(server) Ollama (Recommended)',
                    description: 'Free, private, requires Ollama running locally',
                    provider: 'ollama'
                }
            ];

            const selected = await vscode.window.showQuickPick(providerItems, {
                placeHolder: 'Select embedding provider for semantic search'
            });

            if (!selected) return;

            const config = vscode.workspace.getConfiguration('scimax.db');

            if (selected.provider === 'ollama') {
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

            } else {
                // Disable semantic search
                await config.update('embeddingProvider', 'none', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('Semantic search disabled');
            }
        })
    );

    // Search headings (ivy-style: load all, filter locally with fuzzy matching)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHeadings', async () => {
            const db = await requireDatabase();
            if (!db) return;

            // Load all headings upfront for ivy-style filtering
            const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { heading: HeadingRecord }>();
            quickPick.placeholder = 'Type to filter headings (space-separated terms)...';
            // Disable VS Code's built-in filtering - we'll do our own fuzzy matching
            quickPick.matchOnDescription = false;
            quickPick.matchOnDetail = false;
            quickPick.busy = true;

            type HeadingItem = vscode.QuickPickItem & { heading: HeadingRecord; searchText: string };
            let allItems: HeadingItem[] = [];

            // Fuzzy filter function: split query by spaces, all parts must match
            const fuzzyFilter = (items: HeadingItem[], query: string): HeadingItem[] => {
                if (!query.trim()) return items;
                const parts = query.toLowerCase().split(/\s+/).filter(p => p.length > 0);
                return items
                    .filter(item => parts.every(part => item.searchText.includes(part)))
                    .map(item => ({ ...item, alwaysShow: true })); // Bypass VS Code's filtering
            };

            // Load headings in background
            db.searchHeadings('', { limit: 5000 }).then(headings => {
                allItems = headings.map(heading => {
                    const label = `${'  '.repeat(heading.level - 1)}${getHeadingIcon(heading)} ${heading.title}`;
                    const description = formatHeadingDescription(heading);
                    const detail = `${path.basename(heading.file_path)}:${heading.line_number}`;
                    return {
                        label,
                        description,
                        detail,
                        heading,
                        // Pre-compute lowercase search text for faster filtering
                        searchText: `${label} ${description} ${detail}`.toLowerCase()
                    };
                });
                quickPick.items = allItems;
                quickPick.busy = false;
            });

            // Custom filtering on value change
            quickPick.onDidChangeValue(value => {
                quickPick.items = fuzzyFilter(allItems, value);
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

    // Browse files with action buttons
    const removeButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('trash'),
        tooltip: 'Remove from database'
    };
    const ignoreButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('exclude'),
        tooltip: 'Add to ignore patterns'
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.browseFiles', async () => {
            const db = await requireDatabase();
            if (!db) return;

            const files = await db.getFiles();

            if (files.length === 0) {
                vscode.window.showInformationMessage('No files indexed. Run "Scimax: Reindex Files" first.');
                return;
            }

            const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { file: { path: string; indexed_at: number } }>();
            quickPick.placeholder = `${files.length} indexed files (use buttons for actions)`;
            quickPick.matchOnDetail = true;

            quickPick.items = files
                .sort((a, b) => b.indexed_at - a.indexed_at)
                .map(file => ({
                    label: `$(file) ${path.basename(file.path)}`,
                    description: new Date(file.indexed_at).toLocaleDateString(),
                    detail: file.path,
                    buttons: [removeButton, ignoreButton],
                    file
                }));

            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];
                if (selected) {
                    quickPick.hide();
                    const doc = await vscode.workspace.openTextDocument(selected.file.path);
                    await vscode.window.showTextDocument(doc);
                }
            });

            quickPick.onDidTriggerItemButton(async (e) => {
                const filePath = (e.item as any).file.path;
                if (e.button === removeButton) {
                    quickPick.hide();
                    await vscode.commands.executeCommand('scimax.db.removeFile', filePath);
                } else if (e.button === ignoreButton) {
                    quickPick.hide();
                    await vscode.commands.executeCommand('scimax.db.ignoreFile', filePath);
                }
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        })
    );

    // Remove file from database (by path argument)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.removeFile', async (filePath?: string) => {
            const db = await requireDatabase();
            if (!db) return;

            // If no path provided, use current file
            if (!filePath) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No file selected');
                    return;
                }
                filePath = editor.document.uri.fsPath;
            }

            const fileName = path.basename(filePath);
            const confirm = await vscode.window.showWarningMessage(
                `Remove "${fileName}" from the database?`,
                { modal: false },
                'Remove'
            );

            if (confirm === 'Remove') {
                await db.removeFile(filePath);
                vscode.window.showInformationMessage(`Removed "${fileName}" from database`);
            }
        })
    );

    // Remove current file from database
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.removeCurrentFile', async () => {
            await vscode.commands.executeCommand('scimax.db.removeFile');
        })
    );

    // Add file to ignore patterns (by path argument)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.ignoreFile', async (filePath?: string) => {
            const db = await requireDatabase();
            if (!db) return;

            // If no path provided, use current file
            if (!filePath) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No file selected');
                    return;
                }
                filePath = editor.document.uri.fsPath;
            }

            const fileName = path.basename(filePath);

            // Ask what kind of pattern to add
            const patternChoice = await vscode.window.showQuickPick([
                {
                    label: `$(file) This file only`,
                    description: filePath,
                    pattern: filePath
                },
                {
                    label: `$(folder) This directory`,
                    description: path.dirname(filePath) + '/**',
                    pattern: path.dirname(filePath) + '/**'
                },
                {
                    label: `$(symbol-file) All *${path.extname(filePath)} files`,
                    description: `**/*${path.extname(filePath)}`,
                    pattern: `**/*${path.extname(filePath)}`
                }
            ], {
                placeHolder: `Add ignore pattern for "${fileName}"`
            });

            if (!patternChoice) return;

            // Get current exclude patterns
            const config = vscode.workspace.getConfiguration('scimax.db');
            const currentPatterns = config.get<string[]>('exclude') || [];

            // Check if pattern already exists
            if (currentPatterns.includes(patternChoice.pattern)) {
                vscode.window.showInformationMessage(`Pattern already in exclude list: ${patternChoice.pattern}`);
                return;
            }

            // Add the new pattern
            const newPatterns = [...currentPatterns, patternChoice.pattern];
            await config.update('exclude', newPatterns, vscode.ConfigurationTarget.Global);

            // Also remove from database
            await db.removeFile(filePath);

            vscode.window.showInformationMessage(
                `Added "${patternChoice.pattern}" to ignore patterns and removed "${fileName}" from database`
            );
        })
    );

    // Add current file to ignore patterns
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.ignoreCurrentFile', async () => {
            await vscode.commands.executeCommand('scimax.db.ignoreFile');
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
                `${stats.blocks} code blocks. ` +
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
