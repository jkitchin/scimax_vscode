import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@libsql/client';
import type { EmbeddingService } from './embeddingService';
import { databaseLogger as log } from '../utils/logger';
import {
    AdvancedSearchEngine,
    AdvancedSearchOptions,
    AdvancedSearchResult,
    SearchMode,
    SearchProgressCallback,
    loadConfig as loadAdvancedSearchConfig
} from './advancedSearch';

// Re-export advanced search types
export type { AdvancedSearchOptions, AdvancedSearchResult, SearchMode, SearchProgressCallback };

import { indexerRegistry, type IndexContext } from '../adapters/indexerAdapter';

// Re-export all types from core so callers don't need to change imports
export {
    FileRecord,
    HeadingRecord,
    SourceBlockRecord,
    LinkRecord,
    SearchResult,
    AgendaItem,
    SearchScope,
    DbStats,
    ProjectRecord,
    ScimaxDbCoreOptions,
    CoreEmbeddingService,
    ScimaxDbCore
} from './scimaxDbCore';

import { ScimaxDbCore, ScimaxDbCoreOptions } from './scimaxDbCore';

/**
 * ScimaxDb - VS Code wrapper around ScimaxDbCore.
 *
 * Adds VS Code-specific features:
 * - File system watcher for auto-indexing
 * - Status bar for embedding progress
 * - Extension context (globalState, subscriptions)
 * - Advanced search engine with VS Code config
 * - Backup/restore using globalState
 * - Project migration from globalState
 * - Event emitter for onDidIndexFile
 */
export class ScimaxDb extends ScimaxDbCore {
    private context: vscode.ExtensionContext;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private indexQueue: Set<string> = new Set();
    private isIndexing: boolean = false;
    private indexingScheduled: boolean = false;

    // Status bar for embedding progress
    private embeddingStatusBar: vscode.StatusBarItem | null = null;

    // Event emitter for file index completion
    private _onDidIndexFile = new vscode.EventEmitter<string>();
    readonly onDidIndexFile = this._onDidIndexFile.event;

    // Fires after clear() empties every table. Subscribers (e.g. agenda
    // TreeView) use this to drop stale views; without it the agenda keeps
    // showing the pre-clear snapshot until something else triggers a refresh.
    private _onDidClear = new vscode.EventEmitter<void>();
    readonly onDidClear = this._onDidClear.event;

    // Fires once at the end of a full rebuild. Per-file onDidIndexFile events
    // are debounced and can be eaten when files arrive faster than the timer
    // resets, so this is the guaranteed end-of-run signal.
    private _onDidRebuild = new vscode.EventEmitter<{ filesIndexed: number; errors: number }>();
    readonly onDidRebuild = this._onDidRebuild.event;

    // Advanced search engine
    private advancedSearchEngine: AdvancedSearchEngine | null = null;

    // Backup format version
    private static readonly BACKUP_VERSION = 1;

    constructor(context: vscode.ExtensionContext) {
        const dbPath = path.join(context.globalStorageUri.fsPath, 'scimax-db.sqlite');
        super({
            dbPath,
            onFileIndexed: async (filePath: string, fileId: number, fileType: string, mtime: number, db: Client) => {
                // Run indexer adapters for knowledge graph extraction
                if (indexerRegistry.getAdapters().length > 0) {
                    const indexContext: IndexContext = { filePath, fileId, fileType, mtime, db };
                    try {
                        const content = await fs.promises.readFile(filePath, 'utf8');
                        const indexerResult = await indexerRegistry.runAdapters(
                            content,
                            undefined,
                            indexContext
                        );
                        for (const err of indexerResult.errors) {
                            log.warn('Indexer adapter error', { adapterId: err.adapterId, error: err.error.message });
                        }
                    } catch (adapterError) {
                        log.warn('Indexer adapters failed', { error: (adapterError as Error).message });
                    }
                }
            }
        });
        this.context = context;
    }

    // ----------------------------------------------------------
    // Initialize - VS Code specific additions on top of core
    // ----------------------------------------------------------

    public async initialize(): Promise<void> {
        // Apply VS Code config before core init
        this.setIgnorePatterns(this.loadIgnorePatterns());
        this.setResilienceConfig(this.loadResilienceConfig());

        // Run core initialization
        await super.initialize();

        // VS Code post-init
        await this.migrateProjectsFromGlobalState();
        this.setupFileWatcher();

        log.info('Initialized');
    }

    // ----------------------------------------------------------
    // VS Code config loaders
    // ----------------------------------------------------------

    private loadIgnorePatterns(): string[] {
        const config = vscode.workspace.getConfiguration('scimax.db');
        return config.get<string[]>('exclude') || [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.ipynb_checkpoints/**'
        ];
    }

    private loadResilienceConfig(): { queryTimeoutMs: number; maxRetryAttempts: number } {
        const config = vscode.workspace.getConfiguration('scimax.db');
        return {
            queryTimeoutMs: config.get<number>('queryTimeoutMs', 30000),
            maxRetryAttempts: config.get<number>('maxRetryAttempts', 3)
        };
    }

    // ----------------------------------------------------------
    // File watcher
    // ----------------------------------------------------------

    private setupFileWatcher(): void {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{org,md}', false, false, false);
        this.fileWatcher.onDidCreate(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidChange(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidDelete(uri => this.removeFile(uri.fsPath));
        this.context.subscriptions.push(this.fileWatcher);

        const saveHandler = vscode.workspace.onDidSaveTextDocument(doc => {
            const filePath = doc.uri.fsPath;
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.org' || ext === '.md') {
                this.queueIndex(filePath);
            }
        });
        this.context.subscriptions.push(saveHandler);

    }

    private queueIndex(filePath: string): void {
        this.indexQueue.add(filePath);
        if (!this.isIndexing && !this.indexingScheduled) {
            this.indexingScheduled = true;
            setTimeout(() => {
                this.indexingScheduled = false;
                this.processIndexQueue();
            }, 500);
        }
    }

    private async processIndexQueue(): Promise<void> {
        if (this.isIndexing || this.indexQueue.size === 0 || !this.getClient()) return;
        this.isIndexing = true;
        try {
            while (this.indexQueue.size > 0) {
                const files = Array.from(this.indexQueue);
                this.indexQueue.clear();
                for (const filePath of files) {
                    try {
                        await this.indexFile(filePath);
                        this._onDidIndexFile.fire(filePath);
                    } catch (error) {
                        log.error('Failed to index file', error as Error, { path: filePath });
                    }
                }
            }
        } finally {
            this.isIndexing = false;
        }
    }

    // ----------------------------------------------------------
    // Override indexFile to also fire the VS Code event
    // ----------------------------------------------------------

    public async indexFile(filePath: string, options?: { queueEmbeddings?: boolean }): Promise<void> {
        await super.indexFile(filePath, options);
        // Note: The event is fired by queueIndex/processIndexQueue for auto-index,
        // and by rebuild() for manual reindex. We don't fire it here to avoid double-firing.
    }

    // ----------------------------------------------------------
    // VS Code embedding queue override (adds status bar)
    // ----------------------------------------------------------

    protected async processEmbeddingQueueCore(): Promise<void> {
        const db = this.getClient();
        if (!db) return;

        // Create status bar item with click-to-cancel
        this.embeddingStatusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            -10
        );
        const remaining = this.getEmbeddingQueueLength();
        this.embeddingStatusBar.text = `$(sparkle) Embeddings: ${remaining} remaining`;
        this.embeddingStatusBar.tooltip = 'Scimax: Generating embeddings for semantic search (click to cancel)';
        this.embeddingStatusBar.command = 'scimax.db.cancelEmbeddings';
        this.embeddingStatusBar.show();

        // Delegate to the core queue processor
        const originalProcessing = super.processEmbeddingQueueCore.bind(this);

        // Wrap to update status bar during processing
        try {
            // We can't easily intercept per-file progress in the base class,
            // so run the core processor and just show/hide the status bar.
            await originalProcessing();

            if (this.embeddingStatusBar) {
                this.embeddingStatusBar.text = `$(check) Embeddings complete`;
                setTimeout(() => {
                    this.embeddingStatusBar?.dispose();
                    this.embeddingStatusBar = null;
                }, 2000);
            }
        } catch (error) {
            log.error('Embedding queue processing failed', error as Error);
            this.embeddingStatusBar?.dispose();
            this.embeddingStatusBar = null;
        }
    }

    public cancelEmbeddingQueue(): void {
        super.cancelEmbeddingQueue();
        if (this.embeddingStatusBar) {
            this.embeddingStatusBar.dispose();
            this.embeddingStatusBar = null;
        }
        log.info('Embedding queue cancelled');
    }

    // ----------------------------------------------------------
    // Embedding service (wraps EmbeddingService -> CoreEmbeddingService)
    // ----------------------------------------------------------

    public setEmbeddingService(service: EmbeddingService): void {
        super.setEmbeddingService(service);
        this.initAdvancedSearch();
    }

    // ----------------------------------------------------------
    // Advanced search
    // ----------------------------------------------------------

    private initAdvancedSearch(): void {
        if (!this.advancedSearchEngine) {
            this.advancedSearchEngine = new AdvancedSearchEngine(loadAdvancedSearchConfig());
        }
        this.advancedSearchEngine.setSearchFunctions(
            (query, options) => this.searchFullText(query, options),
            this.isVectorSearchAvailable() ? (query, options) => this.searchSemantic(query, options) : null,
            this.getVectorSearchStatus().hasEmbeddings ? (this as any).embeddingService : null
        );
        log.info('Advanced search engine initialized');
    }

    public getAdvancedSearchEngine(): AdvancedSearchEngine | null {
        return this.advancedSearchEngine;
    }

    public async searchAdvanced(
        query: string,
        options?: AdvancedSearchOptions,
        onProgress?: SearchProgressCallback
    ): Promise<AdvancedSearchResult[]> {
        if (!this.advancedSearchEngine) {
            this.initAdvancedSearch();
        }
        if (!this.advancedSearchEngine) {
            log.warn('Advanced search engine not available, falling back to hybrid');
            return this.searchHybrid(query, options);
        }
        return this.advancedSearchEngine.search(query, options, onProgress);
    }

    public async getSearchCapabilities(): Promise<{
        fts: boolean;
        semantic: boolean;
        queryExpansionPRF: boolean;
        queryExpansionLLM: boolean;
        reranking: boolean;
    }> {
        if (!this.advancedSearchEngine) {
            this.initAdvancedSearch();
        }
        if (!this.advancedSearchEngine) {
            return {
                fts: true,
                semantic: this.isVectorSearchAvailable(),
                queryExpansionPRF: true,
                queryExpansionLLM: false,
                reranking: false
            };
        }
        return this.advancedSearchEngine.getCapabilities();
    }

    // ----------------------------------------------------------
    // Index directory with VS Code progress
    // ----------------------------------------------------------

    public async indexDirectory(
        directory: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<number> {
        progress?.report({ message: 'Scanning...' });
        const filesToIndex: string[] = [];
        for await (const filePath of this.findFilesGenerator(directory)) {
            if (await this.needsReindex(filePath)) {
                filesToIndex.push(filePath);
            }
        }
        const total = filesToIndex.length;
        if (total === 0) return 0;

        let indexed = 0;
        for (const filePath of filesToIndex) {
            await this.indexFile(filePath);
            indexed++;
            if (progress) {
                progress.report({ message: `${indexed}/${total}` });
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return indexed;
    }

    // ----------------------------------------------------------
    // Backup / restore
    // ----------------------------------------------------------

    public async exportBackup(outputPath: string): Promise<{ projects: number; files: number }> {
        const db = this.getClient();
        if (!db) throw new Error('Database not initialized');

        const projects = this.context.globalState.get<any[]>('scimax.projects', []);
        const agendaConfig = vscode.workspace.getConfiguration('scimax.agenda');
        const agendaExclude = agendaConfig.get<string[]>('exclude', []);
        const agendaInclude = agendaConfig.get<string[]>('include', []);
        const filesResult = await db.execute('SELECT path, file_type, mtime FROM files ORDER BY path');
        const indexedFiles = filesResult.rows.map(r => ({
            path: r.path as string,
            file_type: r.file_type as string,
            mtime: r.mtime as number
        }));
        const backup = {
            version: ScimaxDb.BACKUP_VERSION,
            exportedAt: Date.now(),
            exportedAtHuman: new Date().toISOString(),
            projects,
            agendaConfig: { exclude: agendaExclude, include: agendaInclude },
            indexedFilesCount: indexedFiles.length,
            indexedFiles
        };
        await fs.promises.writeFile(outputPath, JSON.stringify(backup, null, 2), 'utf-8');
        return { projects: projects.length, files: indexedFiles.length };
    }

    public async importBackup(inputPath: string): Promise<{ projects: number; filesToIndex: number }> {
        const content = await fs.promises.readFile(inputPath, 'utf-8');
        const backup = JSON.parse(content);
        if (!backup.version || backup.version > ScimaxDb.BACKUP_VERSION) {
            throw new Error(`Unsupported backup version: ${backup.version}`);
        }
        if (backup.projects && Array.isArray(backup.projects)) {
            await this.context.globalState.update('scimax.projects', backup.projects);
        }
        if (backup.agendaConfig) {
            const agendaConfig = vscode.workspace.getConfiguration('scimax.agenda');
            if (backup.agendaConfig.exclude) {
                await agendaConfig.update('exclude', backup.agendaConfig.exclude, vscode.ConfigurationTarget.Global);
            }
            if (backup.agendaConfig.include) {
                await agendaConfig.update('include', backup.agendaConfig.include, vscode.ConfigurationTarget.Global);
            }
        }
        let filesToIndex = 0;
        if (backup.indexedFiles && Array.isArray(backup.indexedFiles)) {
            for (const file of backup.indexedFiles) {
                if (fs.existsSync(file.path)) filesToIndex++;
            }
        }
        return { projects: backup.projects?.length || 0, filesToIndex };
    }

    // ----------------------------------------------------------
    // Rebuild (VS Code-specific, uses workspace folders + globalState)
    // ----------------------------------------------------------

    public async rebuild(options: {
        onProgress?: (status: { phase: string; current: number; total: number }) => void;
        cancellationToken?: { cancelled: boolean };
    } = {}): Promise<{ filesIndexed: number; errors: number }> {
        const { onProgress, cancellationToken } = options;
        const db = this.getClient();
        if (!db) throw new Error('Database not initialized');

        const result = { filesIndexed: 0, errors: 0 };

        onProgress?.({ phase: 'Clearing database', current: 0, total: 1 });
        await this.clear();
        if (cancellationToken?.cancelled) return result;

        onProgress?.({ phase: 'Collecting directories', current: 0, total: 1 });
        const directories: string[] = [];

        const projects = this.context.globalState.get<any[]>('scimax.projects', []);
        for (const project of projects) {
            if (project.path && fs.existsSync(project.path)) directories.push(project.path);
        }

        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        for (const folder of workspaceFolders) {
            if (!directories.includes(folder.uri.fsPath)) directories.push(folder.uri.fsPath);
        }

        const journalDir = this.resolveScimaxPath('scimax.journal.directory', 'journal');
        if (journalDir && fs.existsSync(journalDir) && !directories.includes(journalDir)) {
            directories.push(journalDir);
        }

        const agendaConfig = vscode.workspace.getConfiguration('scimax.agenda');
        const agendaInclude = agendaConfig.get<string[]>('include', []);
        for (const dir of agendaInclude) {
            const expanded = dir.startsWith('~') ? dir.replace(/^~/, process.env.HOME || '') : dir;
            if (fs.existsSync(expanded) && !directories.includes(expanded)) directories.push(expanded);
        }

        if (cancellationToken?.cancelled) return result;

        const indexedPaths = new Set<string>();
        onProgress?.({ phase: 'Indexing files', current: 0, total: 0 });

        for (const dir of directories) {
            if (cancellationToken?.cancelled) break;
            for await (const filePath of this.findFilesGenerator(dir)) {
                if (cancellationToken?.cancelled) break;
                if (indexedPaths.has(filePath)) continue;
                indexedPaths.add(filePath);
                try {
                    await this.indexFile(filePath, { queueEmbeddings: true });
                    result.filesIndexed++;
                    this._onDidIndexFile.fire(filePath);
                } catch (error) {
                    log.error('Error indexing file', error as Error, { path: filePath });
                    result.errors++;
                }
                if (result.filesIndexed % 10 === 0) {
                    onProgress?.({ phase: 'Indexing files', current: result.filesIndexed, total: 0 });
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }

        onProgress?.({ phase: 'Complete', current: result.filesIndexed, total: result.filesIndexed });
        this._onDidRebuild.fire(result);
        return result;
    }

    // Override core clear() to fire onDidClear so views can drop stale data.
    public async clear(): Promise<void> {
        await super.clear();
        this._onDidClear.fire();
    }

    // ----------------------------------------------------------
    // Scan directories in background
    // ----------------------------------------------------------

    public async scanDirectoriesInBackground(
        directories: string[],
        options: {
            batchSize?: number;
            yieldMs?: number;
            maxIndex?: number;
            onProgress?: (status: { scanned: number; total: number; indexed: number; currentDir?: string }) => void;
            cancellationToken?: { cancelled: boolean };
        } = {}
    ): Promise<{ scanned: number; newFiles: number; changed: number; indexed: number }> {
        const {
            batchSize = 50,
            yieldMs = 50,
            maxIndex = 0,
            onProgress,
            cancellationToken
        } = options;
        const result = { scanned: 0, newFiles: 0, changed: 0, indexed: 0 };
        const db = this.getClient();
        if (!db || directories.length === 0) return result;

        log.info('Scanning directories', { directories: directories.length });

        for (const dir of directories) {
            if (cancellationToken?.cancelled) break;
            if (maxIndex > 0 && result.indexed >= maxIndex) break;

            try {
                if (!fs.existsSync(dir)) {
                    log.warn('Directory does not exist', { dir });
                    continue;
                }
                onProgress?.({ scanned: result.scanned, total: 0, indexed: result.indexed, currentDir: dir });

                let filesInDir = 0;
                for await (const filePath of this.findFilesGenerator(dir)) {
                    if (cancellationToken?.cancelled) break;
                    if (maxIndex > 0 && result.indexed >= maxIndex) break;
                    result.scanned++;
                    filesInDir++;
                    try {
                        const needsIndex = await this.needsReindex(filePath);
                        if (needsIndex) {
                            const existing = await this.getClient()?.execute({ sql: 'SELECT id FROM files WHERE path = ?', args: [filePath] });
                            if (!existing || existing.rows.length === 0) result.newFiles++;
                            else result.changed++;
                            await this.indexFile(filePath, { queueEmbeddings: true });
                            this._onDidIndexFile.fire(filePath);
                            result.indexed++;
                            await new Promise(r => setTimeout(r, 100));
                        }
                    } catch (error) {
                        log.error('Error processing file', error as Error, { path: filePath });
                    }
                    if (filesInDir % batchSize === 0) {
                        onProgress?.({ scanned: result.scanned, total: 0, indexed: result.indexed, currentDir: dir });
                        await new Promise(r => setTimeout(r, yieldMs));
                    }
                }
            } catch (error) {
                log.error('Error scanning directory', error as Error, { dir });
            }
            await new Promise(r => setTimeout(r, yieldMs));
        }
        return result;
    }

    // ----------------------------------------------------------
    // Project migration from globalState
    // ----------------------------------------------------------

    private async migrateProjectsFromGlobalState(): Promise<void> {
        const db = this.getClient();
        if (!db) return;
        const migrated = this.context.globalState.get<boolean>('scimax.projects.migratedToDb', false);
        if (migrated) return;

        const projects = this.context.globalState.get<any[]>('scimax.projects', []);
        if (projects.length === 0) {
            await this.context.globalState.update('scimax.projects.migratedToDb', true);
            return;
        }

        log.info('Migrating projects from globalState', { count: projects.length });
        for (const project of projects) {
            try {
                await db.execute({
                    sql: `INSERT OR IGNORE INTO projects (path, name, type, last_opened) VALUES (?, ?, ?, ?)`,
                    args: [project.path, project.name, project.type || 'manual', project.lastOpened || Date.now()]
                });
            } catch (e) {
                log.error('Error migrating project', e as Error, { path: project.path });
            }
        }
        await this.context.globalState.update('scimax.projects.migratedToDb', true);
        log.info('Project migration complete');
    }

    // ----------------------------------------------------------
    // Path resolver
    // ----------------------------------------------------------

    private resolveScimaxPath(configKey: string, defaultSubdir: string): string | null {
        const config = vscode.workspace.getConfiguration();
        const configuredPath = config.get<string>(configKey);
        if (configuredPath) {
            if (configuredPath.startsWith('~')) {
                return configuredPath.replace(/^~/, process.env.HOME || '');
            }
            return configuredPath;
        }
        const home = process.env.HOME;
        if (home) return path.join(home, 'scimax', defaultSubdir);
        return null;
    }

    // ----------------------------------------------------------
    // Close - override to also dispose VS Code resources
    // ----------------------------------------------------------

    public async close(): Promise<void> {
        if (this.embeddingStatusBar) {
            this.embeddingStatusBar.dispose();
            this.embeddingStatusBar = null;
        }
        this._onDidIndexFile.dispose();
        this._onDidClear.dispose();
        this._onDidRebuild.dispose();
        await super.close();
    }
}
