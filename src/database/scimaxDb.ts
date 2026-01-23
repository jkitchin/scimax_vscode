import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { createClient, Client } from '@libsql/client';
import { parse as parseDate } from 'date-fns';
import { minimatch } from 'minimatch';
import {
    parseMarkdownCodeBlocks,
    extractHashtags,
    extractMentions
} from '../parser/orgParser';
import {
    UnifiedParserAdapter,
    LegacyDocument,
} from '../parser/orgParserAdapter';
// ipynb indexing removed - notebooks are typically large and cause performance issues
import type { EmbeddingService } from './embeddingService';
import { MigrationRunner, getLatestVersion } from './migrations';
import { databaseLogger as log } from '../utils/logger';
import { withRetry, withTimeout, isTransientError } from '../utils/resilience';

/**
 * Database record types
 */
export interface FileRecord {
    id: number;
    path: string;
    file_type: string;  // 'org' | 'md'
    mtime: number;
    hash: string;
    size: number;
    indexed_at: number;
}

export interface HeadingRecord {
    id: number;
    file_id: number;
    file_path: string;
    level: number;
    title: string;
    line_number: number;
    begin_pos: number;
    todo_state: string | null;
    priority: string | null;
    tags: string;
    inherited_tags: string;
    properties: string;
    scheduled: string | null;
    deadline: string | null;
    closed: string | null;
    cell_index: number | null;  // For notebook cells
}

export interface SourceBlockRecord {
    id: number;
    file_id: number;
    file_path: string;
    language: string;
    content: string;
    line_number: number;
    headers: string;
    cell_index: number | null;  // For notebook cells
}

export interface LinkRecord {
    id: number;
    file_id: number;
    file_path: string;
    link_type: string;
    target: string;
    description: string | null;
    line_number: number;
}

export interface SearchResult {
    type: 'heading' | 'block' | 'link' | 'content' | 'semantic';
    file_path: string;
    line_number: number;
    title?: string;
    preview: string;
    score: number;
    distance?: number;
}

export interface AgendaItem {
    type: 'deadline' | 'scheduled' | 'todo';
    heading: HeadingRecord;
    date?: string;
    days_until?: number;
    overdue?: boolean;
}

export interface SearchScope {
    type: 'all' | 'directory' | 'project';
    path?: string;
    keyword?: string;
}

export interface DbStats {
    files: number;
    headings: number;
    blocks: number;
    links: number;
    chunks: number;
    has_embeddings: boolean;
    vector_search_supported: boolean;
    vector_search_error: string | null;
    last_indexed?: number;
    by_type: { org: number; md: number };
}

/**
 * Project record from database
 */
export interface ProjectRecord {
    id: number;
    path: string;
    name: string;
    type: 'git' | 'projectile' | 'manual';
    last_opened: number | null;
    created_at: number;
}

/**
 * ScimaxDb - SQLite database with FTS5 and Vector Search
 * Indexes org, markdown, and Jupyter notebook files
 */
export class ScimaxDb {
    private db: Client | null = null;
    private parser: UnifiedParserAdapter;
    private dbPath: string;
    private context: vscode.ExtensionContext;
    private searchScope: SearchScope = { type: 'all' };
    private embeddingService: EmbeddingService | null = null;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private indexQueue: Set<string> = new Set();
    private isIndexing: boolean = false;
    private indexingScheduled: boolean = false;  // Prevents multiple setTimeout calls
    private ignorePatterns: string[] = [];

    // Vector search support tracking
    private vectorSearchSupported: boolean = false;
    private vectorSearchError: string | null = null;

    // Embedding dimensions (384 for all-MiniLM-L6-v2, 1536 for OpenAI)
    private embeddingDimensions: number = 384;

    // Async embedding queue for rate-limited processing
    private embeddingQueue: string[] = [];
    private isProcessingEmbeddings: boolean = false;
    private embeddingStatusBar: vscode.StatusBarItem | null = null;
    private embeddingCancelled: boolean = false;

    // Resilience configuration
    private queryTimeoutMs: number = 30000;  // 30 seconds default
    private maxRetryAttempts: number = 3;

    // Write mutex to prevent concurrent database writes
    private writeLock: Promise<void> = Promise.resolve();

    // Event emitter for file index completion
    private _onDidIndexFile = new vscode.EventEmitter<string>();
    readonly onDidIndexFile = this._onDidIndexFile.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.parser = new UnifiedParserAdapter();
        this.dbPath = path.join(context.globalStorageUri.fsPath, 'scimax-db.sqlite');
    }

    /**
     * Execute a function with write lock to prevent concurrent database writes.
     * This serializes all write operations to avoid SQLITE_BUSY errors.
     */
    private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
        // Chain onto the existing lock
        const previousLock = this.writeLock;
        let releaseLock: () => void;
        this.writeLock = new Promise<void>(resolve => {
            releaseLock = resolve;
        });

        try {
            // Wait for previous operation to complete
            await previousLock;
            // Execute our operation
            return await fn();
        } finally {
            // Release the lock for the next operation
            releaseLock!();
        }
    }

    /**
     * Execute a query with retry and timeout protection
     * Use this for critical queries that should be resilient to transient failures
     */
    private async executeResilient<T>(
        queryFn: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        return withRetry(
            () => withTimeout(queryFn, {
                timeoutMs: this.queryTimeoutMs,
                operationName
            }),
            {
                maxAttempts: this.maxRetryAttempts,
                operationName,
                isRetryable: isTransientError
            }
        );
    }

    /**
     * Execute a simple SQL query with resilience
     */
    private async queryResilient(
        sql: string,
        args: any[] = [],
        operationName?: string
    ): Promise<any> {
        return this.executeResilient(
            () => this.db!.execute({ sql, args }),
            operationName || sql.slice(0, 50)
        );
    }

    /**
     * Initialize the database
     */
    public async initialize(): Promise<void> {
        const storageDir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        // Create libsql client
        this.db = createClient({
            url: `file:${this.dbPath}`
        });

        // Configure SQLite for better multi-process access:
        // - WAL mode allows concurrent readers while writing
        // - busy_timeout waits up to 30s instead of returning SQLITE_BUSY immediately
        // This helps when multiple VS Code windows access the same database
        await this.db.execute('PRAGMA journal_mode = WAL');
        await this.db.execute('PRAGMA busy_timeout = 30000');

        await this.createSchema();
        this.loadIgnorePatterns();
        this.loadResilienceConfig();
        this.setupFileWatcher();

        log.info('Initialized');
    }

    /**
     * Create database schema with FTS5 and vector support
     * Uses the migration system to apply schema changes
     */
    private async createSchema(): Promise<void> {
        if (!this.db) return;

        // Run versioned migrations
        const runner = new MigrationRunner(this.db);
        const result = await runner.runMigrations();

        if (result.applied > 0) {
            log.info('Migrations applied', { applied: result.applied, version: result.currentVersion });
        }

        // Create chunks table with dynamic embedding dimensions
        // This is separate from migrations because dimensions are runtime-configurable
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                content TEXT NOT NULL,
                line_start INTEGER NOT NULL,
                line_end INTEGER NOT NULL,
                embedding F32_BLOB(${this.embeddingDimensions}),
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )
        `);
        await this.db.execute('CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)');

        // Migrate projects from globalState (one-time migration)
        await this.migrateProjectsFromGlobalState();

        // Test and create vector index if libsql supports it
        await this.testVectorSupport();
    }

    /**
     * Migrate projects from VS Code globalState to the database
     */
    private async migrateProjectsFromGlobalState(): Promise<void> {
        if (!this.db) return;

        // Check if we've already migrated
        const migrated = this.context.globalState.get<boolean>('scimax.projects.migratedToDb', false);
        if (migrated) return;

        // Get projects from globalState
        const projects = this.context.globalState.get<any[]>('scimax.projects', []);
        if (projects.length === 0) {
            await this.context.globalState.update('scimax.projects.migratedToDb', true);
            return;
        }

        log.info('Migrating projects from globalState', { count: projects.length });

        for (const project of projects) {
            try {
                await this.db.execute({
                    sql: `INSERT OR IGNORE INTO projects (path, name, type, last_opened) VALUES (?, ?, ?, ?)`,
                    args: [project.path, project.name, project.type || 'manual', project.lastOpened || Date.now()]
                });
            } catch (e) {
                log.error('Error migrating project', e as Error, { path: project.path });
            }
        }

        // Mark migration as complete (but keep globalState for backward compatibility during transition)
        await this.context.globalState.update('scimax.projects.migratedToDb', true);
        log.info('Project migration complete');
    }

    /**
     * Test if libsql vector search is supported
     */
    private async testVectorSupport(): Promise<void> {
        if (!this.db) return;

        try {
            // Test vector support by creating the index
            await this.db.execute(`
                CREATE INDEX IF NOT EXISTS idx_chunks_embedding
                ON chunks(libsql_vector_idx(embedding, 'metric=cosine'))
            `);
            this.vectorSearchSupported = true;
            log.info('Vector search is supported');
        } catch (e: any) {
            this.vectorSearchSupported = false;
            this.vectorSearchError = e?.message || 'Vector search not available';
            log.info('Vector search not available - using FTS5 only');
            log.debug('Vector search error', { error: this.vectorSearchError });
        }
    }

    /**
     * Check if vector/semantic search is available
     */
    public isVectorSearchAvailable(): boolean {
        return this.vectorSearchSupported && this.embeddingService !== null;
    }

    /**
     * Get vector search status for diagnostics
     */
    public getVectorSearchStatus(): { supported: boolean; error: string | null; hasEmbeddings: boolean } {
        return {
            supported: this.vectorSearchSupported,
            error: this.vectorSearchError,
            hasEmbeddings: this.embeddingService !== null
        };
    }

    /**
     * Set embedding service for semantic search
     */
    public setEmbeddingService(service: EmbeddingService): void {
        this.embeddingService = service;
        this.embeddingDimensions = service.dimensions;
    }

    /**
     * Setup file watcher for auto-indexing
     */
    private setupFileWatcher(): void {
        // Watch org and md files in workspace
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{org,md}',
            false, false, false
        );

        this.fileWatcher.onDidCreate(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidChange(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidDelete(uri => this.removeFile(uri.fsPath));

        this.context.subscriptions.push(this.fileWatcher);

        // Also watch for document saves - this catches files outside workspace
        // FileSystemWatcher only watches workspace folders, but onDidSaveTextDocument
        // fires for ANY file saved in VS Code
        const saveHandler = vscode.workspace.onDidSaveTextDocument(doc => {
            const filePath = doc.uri.fsPath;
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.org' || ext === '.md') {
                this.queueIndex(filePath);
            }
        });
        this.context.subscriptions.push(saveHandler);
    }

    /**
     * Load exclude patterns from config
     */
    private loadIgnorePatterns(): void {
        const config = vscode.workspace.getConfiguration('scimax.db');
        this.ignorePatterns = config.get<string[]>('exclude') || [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.ipynb_checkpoints/**'
        ];
    }

    /**
     * Load resilience configuration (timeouts, retries)
     */
    private loadResilienceConfig(): void {
        const config = vscode.workspace.getConfiguration('scimax.db');
        this.queryTimeoutMs = config.get<number>('queryTimeoutMs', 30000);
        this.maxRetryAttempts = config.get<number>('maxRetryAttempts', 3);
    }

    /**
     * Check if file should be excluded (by absolute path or glob pattern)
     */
    private shouldIgnore(filePath: string): boolean {
        for (const pattern of this.ignorePatterns) {
            // Expand ~ in pattern
            let expandedPattern = pattern;
            if (pattern.startsWith('~')) {
                expandedPattern = pattern.replace(/^~/, process.env.HOME || '');
            }

            if (pattern.includes('*')) {
                // It's a glob pattern
                if (minimatch(filePath, expandedPattern, { matchBase: true })) {
                    return true;
                }
            } else {
                // It's an absolute path
                if (filePath === expandedPattern) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Queue file for indexing (debounced)
     * Uses indexingScheduled flag to prevent race conditions from multiple setTimeout calls
     */
    private queueIndex(filePath: string): void {
        if (this.shouldIgnore(filePath)) return;
        this.indexQueue.add(filePath);

        // Only schedule processing if not already indexing AND not already scheduled
        if (!this.isIndexing && !this.indexingScheduled) {
            this.indexingScheduled = true;
            setTimeout(() => {
                this.indexingScheduled = false;
                this.processIndexQueue();
            }, 500);
        }
    }

    /**
     * Process index queue
     * Ensures only one processing loop runs at a time via isIndexing flag
     */
    private async processIndexQueue(): Promise<void> {
        // Double-check to prevent concurrent processing
        if (this.isIndexing || this.indexQueue.size === 0 || !this.db) return;

        this.isIndexing = true;

        try {
            // Process all queued files
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

    /**
     * Index a directory recursively
     * Two-pass approach: first collect files, then index with n/total progress
     */
    public async indexDirectory(
        directory: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<number> {
        // Phase 1: Collect all files to index (for accurate progress)
        progress?.report({ message: 'Scanning...' });
        const filesToIndex: string[] = [];

        for await (const filePath of this.findFilesGenerator(directory)) {
            if (await this.needsReindex(filePath)) {
                filesToIndex.push(filePath);
            }
        }

        const total = filesToIndex.length;
        if (total === 0) {
            return 0;
        }

        // Phase 2: Index files with n/total progress
        let indexed = 0;
        for (const filePath of filesToIndex) {
            await this.indexFile(filePath);
            indexed++;

            // Update progress with n/total format
            if (progress) {
                progress.report({
                    message: `${indexed}/${total}`
                });
            }

            // Yield after each file indexed to stay responsive
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        return indexed;
    }

    /**
     * Find all indexable files in directory
     * Uses async operations with yielding to avoid blocking the event loop
     */
    private async findFiles(directory: string): Promise<string[]> {
        const files: string[] = [];
        let directoriesProcessed = 0;

        log.debug('findFiles starting', { directory });

        const walk = async (dir: string, depth: number = 0): Promise<void> => {
            try {
                // Use async readdir to not block event loop
                const items = await fs.promises.readdir(dir, { withFileTypes: true });

                for (const item of items) {
                    const fullPath = path.join(dir, item.name);
                    if (this.shouldIgnore(fullPath)) {
                        continue;
                    }

                    if (item.isDirectory() && !item.name.startsWith('.')) {
                        await walk(fullPath, depth + 1);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        if (ext === '.org' || ext === '.md') {
                            files.push(fullPath);
                        }
                    }
                }

                // Yield every 20 directories to keep UI responsive
                directoriesProcessed++;
                if (directoriesProcessed % 20 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            } catch (error: any) {
                // Silently ignore permission errors
                if (error?.code !== 'EACCES' && error?.code !== 'ENOENT') {
                    log.error('Error walking directory', error as Error, {
                        dir,
                        depth,
                        message: error?.message,
                        code: error?.code
                    });
                }
            }
        };

        await walk(directory, 0);
        log.debug('findFiles complete', { directory, fileCount: files.length });
        return files;
    }

    /**
     * Find files as an async generator to avoid accumulating all paths in memory.
     * Uses iterative traversal with a stack instead of recursion.
     * This is critical for large directories to prevent OOM during startup scans.
     */
    private async *findFilesGenerator(directory: string): AsyncGenerator<string, void, undefined> {
        const stack: string[] = [directory];
        let directoriesProcessed = 0;
        let itemsProcessed = 0;

        log.debug('findFilesGenerator starting', { directory });

        while (stack.length > 0) {
            const dir = stack.pop()!;

            try {
                const items = await fs.promises.readdir(dir, { withFileTypes: true });

                for (const item of items) {
                    const fullPath = path.join(dir, item.name);

                    // Yield every 50 items within a directory to stay responsive
                    // This handles directories with thousands of files
                    itemsProcessed++;
                    if (itemsProcessed % 50 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }

                    if (this.shouldIgnore(fullPath)) {
                        continue;
                    }

                    if (item.isDirectory() && !item.name.startsWith('.')) {
                        stack.push(fullPath);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        if (ext === '.org' || ext === '.md') {
                            yield fullPath;
                        }
                    }
                }

                // Also yield between directories
                directoriesProcessed++;
                if (directoriesProcessed % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            } catch (error: any) {
                // Silently ignore permission errors
                if (error?.code !== 'EACCES' && error?.code !== 'ENOENT') {
                    log.error('Error walking directory', error as Error, { dir });
                }
            }
        }

        log.debug('findFilesGenerator complete', { directory, directoriesProcessed });
    }

    /**
     * Check if file needs reindexing
     */
    private async needsReindex(filePath: string): Promise<boolean> {
        if (!this.db) return true;

        const result = await this.db.execute({
            sql: 'SELECT mtime FROM files WHERE path = ?',
            args: [filePath]
        });

        if (result.rows.length === 0) return true;

        try {
            // Use async stat to not block event loop
            const stats = await fs.promises.stat(filePath);
            return stats.mtimeMs > (result.rows[0].mtime as number);
        } catch {
            return true;
        }
    }

    /**
     * Detect if content is likely binary (not text)
     * Checks for null bytes and high ratio of non-printable characters
     */
    private isBinaryContent(content: string): boolean {
        // Check first 8KB for efficiency
        const sample = content.slice(0, 8192);

        // Null bytes are a strong indicator of binary content
        if (sample.includes('\0')) {
            return true;
        }

        // Count non-printable characters (excluding common whitespace)
        let nonPrintable = 0;
        for (let i = 0; i < sample.length; i++) {
            const code = sample.charCodeAt(i);
            // Non-printable: < 32 (except tab, newline, carriage return) or DEL (127)
            if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
                nonPrintable++;
            }
        }

        // If more than 10% non-printable, likely binary
        const ratio = nonPrintable / sample.length;
        return ratio > 0.1;
    }

    /**
     * Get file type from extension
     */
    private getFileType(filePath: string): 'org' | 'md' {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.md') return 'md';
        return 'org';  // default
    }

    /**
     * Index a single file
     * @param filePath Path to the file to index
     * @param options.queueEmbeddings If true, queue embedding generation for async processing (for background sync)
     */
    public async indexFile(filePath: string, options?: { queueEmbeddings?: boolean }): Promise<void> {
        if (!this.db) return;

        try {
            // Validate file before reading (use async to not block event loop)
            const stats = await fs.promises.stat(filePath);

            // Check file size limit (default 10MB)
            const maxSizeBytes = vscode.workspace.getConfiguration('scimax.db')
                .get<number>('maxFileSizeMB', 10) * 1024 * 1024;
            if (stats.size > maxSizeBytes) {
                log.warn('Skipping large file', {
                    path: filePath,
                    sizeMB: (stats.size / 1024 / 1024).toFixed(2),
                    limitMB: maxSizeBytes / 1024 / 1024
                });
                return;
            }

            // Estimate line count from file size before reading (avg ~80 bytes/line for org files)
            // This prevents loading huge files just to count lines
            const maxLines = vscode.workspace.getConfiguration('scimax.db')
                .get<number>('maxFileLines', 10000);
            const estimatedLines = Math.ceil(stats.size / 80);
            if (estimatedLines > maxLines * 1.5) {
                log.warn('Skipping file with estimated too many lines', {
                    path: filePath,
                    estimatedLines,
                    limit: maxLines
                });
                return;
            }

            // Read file content (use async to not block event loop)
            const content = await fs.promises.readFile(filePath, 'utf8');

            // Verify actual line count (only for files that passed size estimate)
            const lineCount = content.split('\n').length;
            if (lineCount > maxLines) {
                log.warn('Skipping file with too many lines', {
                    path: filePath,
                    lines: lineCount,
                    limit: maxLines
                });
                return;
            }

            // Detect binary content (null bytes or high non-printable ratio)
            // Skip check for known text extensions - they may contain embedded binary-like content
            // (e.g., org files with Emacs Lisp results containing control characters)
            const knownTextExt = ['.org', '.md', '.txt'];
            const ext = path.extname(filePath).toLowerCase();
            if (!knownTextExt.includes(ext) && this.isBinaryContent(content)) {
                log.warn('Skipping binary file', { path: filePath });
                return;
            }
            const fileType = this.getFileType(filePath);
            const hash = crypto.createHash('md5').update(content).digest('hex');

            // Parse content outside the lock (CPU-intensive, not DB-related)
            let parsedDoc: LegacyDocument | null = null;

            if (fileType === 'org') {
                parsedDoc = this.parser.parse(content);
                // Yield after parsing to prevent blocking event loop
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const hashtags = extractHashtags(content);

            // All database writes happen inside the write lock to prevent SQLITE_BUSY
            await this.withWriteLock(async () => {
                // Remove old data for this file (already has internal retry logic)
                await withRetry(
                    () => this.db!.batch([
                        { sql: 'DELETE FROM headings WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM source_blocks WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM links WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM hashtags WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM chunks WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM fts_content WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM files WHERE path = ?', args: [filePath] }
                    ]),
                    {
                        maxAttempts: 5,
                        baseDelayMs: 100,
                        operationName: 'indexFile-removeOld',
                        isRetryable: isTransientError
                    }
                );

                // Insert file record
                const fileResult = await this.db!.execute({
                    sql: `INSERT INTO files (path, file_type, mtime, hash, size, indexed_at, keywords)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    args: [filePath, fileType, stats.mtimeMs, hash, stats.size, Date.now(), '{}']
                });

                const fileId = Number(fileResult.lastInsertRowid);

                // Index content based on type
                if (fileType === 'org' && parsedDoc) {
                    await this.indexOrgDocument(fileId, filePath, parsedDoc, content);
                } else if (fileType === 'md') {
                    await this.indexMarkdownDocument(fileId, filePath, content);
                }

                // Index hashtags and FTS5 in a batch for efficiency
                const finalStatements: { sql: string; args: (string | number | null)[] }[] = [];

                for (const tag of hashtags) {
                    finalStatements.push({
                        sql: 'INSERT OR IGNORE INTO hashtags (tag, file_path) VALUES (?, ?)',
                        args: [tag.toLowerCase(), filePath]
                    });
                }

                // Index for FTS5
                finalStatements.push({
                    sql: 'INSERT INTO fts_content (file_path, title, content) VALUES (?, ?, ?)',
                    args: [filePath, path.basename(filePath), content]
                });

                if (finalStatements.length > 0) {
                    await this.db!.batch(finalStatements);
                }

                // Handle embeddings for semantic search
                if (this.embeddingService) {
                    if (options?.queueEmbeddings) {
                        // Queue for async processing to avoid OOM during background sync
                        this.queueEmbeddings(filePath);
                    } else {
                        // Generate immediately (manual reindex)
                        await this.createChunks(fileId, filePath, content);
                    }
                }
            });

        } catch (error) {
            log.error('Failed to index file', error as Error, { path: filePath });
        }
    }

    /**
     * Index org document
     * Uses batched inserts for performance and yields to event loop to prevent blocking
     */
    private async indexOrgDocument(
        fileId: number,
        filePath: string,
        doc: LegacyDocument,
        content: string
    ): Promise<void> {
        if (!this.db) return;

        const lines = content.split('\n');
        let charPos = 0;
        const linePositions: number[] = [];
        for (const line of lines) {
            linePositions.push(charPos);
            charPos += line.length + 1;
        }

        // Collect all statements for batched execution
        const statements: { sql: string; args: (string | number | null)[] }[] = [];

        // Index headings with tag inheritance
        const flatHeadings = this.parser.flattenHeadings(doc);
        const tagStack: string[][] = [];

        for (const heading of flatHeadings) {
            while (tagStack.length >= heading.level) {
                tagStack.pop();
            }
            const inheritedTags = tagStack.flat();
            tagStack.push(heading.tags);

            // Find scheduling info
            const headingLine = heading.lineNumber - 1;
            let scheduled: string | null = null;
            let deadline: string | null = null;
            let closed: string | null = null;

            for (let i = headingLine + 1; i < Math.min(headingLine + 5, lines.length); i++) {
                const line = lines[i];
                if (line.match(/^\*+\s/)) break;

                const schedMatch = line.match(/SCHEDULED:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/);
                if (schedMatch) scheduled = schedMatch[1];

                const deadMatch = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/);
                if (deadMatch) deadline = deadMatch[1];

                const closedMatch = line.match(/CLOSED:\s*\[(\d{4}-\d{2}-\d{2}[^\]]*)\]/);
                if (closedMatch) closed = closedMatch[1];
            }

            statements.push({
                sql: `INSERT INTO headings
                      (file_id, file_path, level, title, line_number, begin_pos,
                       todo_state, priority, tags, inherited_tags, properties,
                       scheduled, deadline, closed, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                args: [
                    fileId, filePath, heading.level, heading.title,
                    heading.lineNumber, linePositions[headingLine] || 0,
                    heading.todoState || null, heading.priority || null,
                    JSON.stringify(heading.tags), JSON.stringify(inheritedTags),
                    JSON.stringify(heading.properties),
                    scheduled, deadline, closed
                ]
            });
        }

        // Index source blocks
        for (const block of doc.sourceBlocks) {
            statements.push({
                sql: `INSERT INTO source_blocks
                      (file_id, file_path, language, content, line_number, headers, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                args: [
                    fileId, filePath, block.language, block.content,
                    block.lineNumber, JSON.stringify(block.headers)
                ]
            });
        }

        // Index links
        for (const link of doc.links) {
            statements.push({
                sql: `INSERT INTO links
                      (file_id, file_path, link_type, target, description, line_number)
                      VALUES (?, ?, ?, ?, ?, ?)`,
                args: [
                    fileId, filePath, link.type, link.target,
                    link.description || null, link.lineNumber
                ]
            });
        }

        // Execute in batches of 50 to avoid overwhelming the database
        // and yield between batches to keep extension responsive
        const BATCH_SIZE = 50;
        for (let i = 0; i < statements.length; i += BATCH_SIZE) {
            const batch = statements.slice(i, i + BATCH_SIZE);
            await this.db.batch(batch);

            // Yield to event loop between batches to prevent extension host from being killed
            // Always yield after each batch, not just between batches
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /**
     * Index markdown document
     * Uses batched inserts for performance
     */
    private async indexMarkdownDocument(
        fileId: number,
        filePath: string,
        content: string
    ): Promise<void> {
        if (!this.db) return;

        const statements: { sql: string; args: (string | number | null)[] }[] = [];
        const lines = content.split('\n');
        let charPos = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;

            const match = line.match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                const level = match[1].length;
                let title = match[2];
                const tags: string[] = [];

                const tagMatch = title.match(/\s+#(\w+(?:\s+#\w+)*)$/);
                if (tagMatch) {
                    tags.push(...tagMatch[1].split(/\s+#/));
                    title = title.slice(0, -tagMatch[0].length);
                }

                let todoState: string | null = null;
                const todoMatch = title.match(/^\[([A-Z]+)\]\s+/);
                if (todoMatch) {
                    todoState = todoMatch[1];
                    title = title.slice(todoMatch[0].length);
                }

                statements.push({
                    sql: `INSERT INTO headings
                          (file_id, file_path, level, title, line_number, begin_pos,
                           todo_state, tags, inherited_tags, properties, cell_index)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', NULL)`,
                    args: [fileId, filePath, level, title.trim(), lineNumber, charPos,
                           todoState, JSON.stringify(tags)]
                });
            }

            charPos += line.length + 1;
        }

        // Index code blocks
        const blocks = parseMarkdownCodeBlocks(content);
        for (const block of blocks) {
            statements.push({
                sql: `INSERT INTO source_blocks
                      (file_id, file_path, language, content, line_number, headers, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                args: [fileId, filePath, block.language, block.content,
                       block.lineNumber, JSON.stringify(block.headers)]
            });
        }

        // Execute all statements in a single batch
        if (statements.length > 0) {
            await this.db.batch(statements);
        }
    }

    /**
     * Create text chunks for semantic search
     */
    private async createChunks(
        fileId: number,
        filePath: string,
        content: string
    ): Promise<void> {
        if (!this.db || !this.embeddingService) return;

        // Skip if vector search is not supported
        if (!this.vectorSearchSupported) {
            return;
        }

        const lines = content.split('\n');
        const chunkSize = 2000;
        const chunks: { text: string; lineStart: number; lineEnd: number }[] = [];
        let currentChunk = '';
        let currentLineStart = 1;
        let charCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            currentChunk += line + '\n';
            charCount += line.length + 1;

            if (charCount >= chunkSize) {
                chunks.push({
                    text: currentChunk.trim(),
                    lineStart: currentLineStart,
                    lineEnd: i + 1
                });

                const overlapLines = currentChunk.split('\n').slice(-3);
                currentChunk = overlapLines.join('\n');
                currentLineStart = Math.max(1, i - 2);
                charCount = currentChunk.length;
            }
        }

        if (currentChunk.trim()) {
            chunks.push({
                text: currentChunk.trim(),
                lineStart: currentLineStart,
                lineEnd: lines.length
            });
        }

        try {
            const texts = chunks.map(c => c.text);
            const embeddings = await this.embeddingService.embedBatch(texts);

            for (let i = 0; i < chunks.length; i++) {
                // Convert embedding array to vector format for libsql
                const vectorStr = `[${embeddings[i].join(',')}]`;
                await this.db.execute({
                    sql: `INSERT INTO chunks
                          (file_id, file_path, content, line_start, line_end, embedding)
                          VALUES (?, ?, ?, ?, ?, vector32(?))`,
                    args: [
                        fileId, filePath, chunks[i].text,
                        chunks[i].lineStart, chunks[i].lineEnd,
                        vectorStr
                    ]
                });
            }
        } catch (error: any) {
            log.error('Failed to create embeddings', error as Error, { path: filePath });
            // Don't fail the whole indexing, just skip embeddings
        }
    }

    /**
     * Queue a file for async embedding generation.
     * Embeddings are processed in the background with rate limiting to avoid OOM.
     */
    public queueEmbeddings(filePath: string): void {
        if (!this.embeddingService || !this.vectorSearchSupported) return;

        // Avoid duplicates
        if (!this.embeddingQueue.includes(filePath)) {
            this.embeddingQueue.push(filePath);
        }

        // Start processing if not already running
        if (!this.isProcessingEmbeddings) {
            this.processEmbeddingQueue().catch(error => {
                log.error('Embedding queue processing failed', error as Error);
            });
        }
    }

    /**
     * Process the embedding queue with rate limiting.
     * Processes one file at a time with delays between files.
     */
    private async processEmbeddingQueue(): Promise<void> {
        if (this.isProcessingEmbeddings || !this.embeddingService || !this.db) return;
        if (this.embeddingQueue.length === 0) return;

        this.isProcessingEmbeddings = true;
        this.embeddingCancelled = false;  // Reset cancellation flag
        const total = this.embeddingQueue.length;
        let processed = 0;

        // Create status bar item with click-to-cancel
        this.embeddingStatusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            -10  // Lower priority than stale check
        );
        this.embeddingStatusBar.text = `$(sparkle) Embeddings: 0/${total}`;
        this.embeddingStatusBar.tooltip = 'Scimax: Generating embeddings for semantic search (click to cancel)';
        this.embeddingStatusBar.command = 'scimax.db.cancelEmbeddings';
        this.embeddingStatusBar.show();

        try {
            while (this.embeddingQueue.length > 0 && !this.embeddingCancelled) {
                const filePath = this.embeddingQueue.shift()!;
                processed++;

                try {
                    // Check if file still exists and is indexed
                    if (!fs.existsSync(filePath)) continue;

                    const fileRecord = await this.getFileByPath(filePath);
                    if (!fileRecord) continue;

                    // Read content and generate embeddings
                    const content = fs.readFileSync(filePath, 'utf8');

                    // Remove old chunks for this file
                    await this.db.execute({
                        sql: 'DELETE FROM chunks WHERE file_path = ?',
                        args: [filePath]
                    });

                    // Create new chunks with embeddings
                    await this.createChunks(fileRecord.id, filePath, content);

                    // Update status
                    if (this.embeddingStatusBar) {
                        const remaining = this.embeddingQueue.length;
                        this.embeddingStatusBar.text = `$(sparkle) Embeddings: ${processed}/${total}`;
                        if (remaining > 0) {
                            this.embeddingStatusBar.tooltip = `Scimax: ${remaining} files remaining`;
                        }
                    }

                } catch (error) {
                    log.error('Failed to generate embeddings', error as Error, { path: filePath });
                }

                // Rate limit: wait between files to allow GC and reduce memory pressure
                // Longer delay for more remaining files
                const delayMs = this.embeddingQueue.length > 100 ? 500 : 200;
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            // Show completion briefly
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
        } finally {
            this.isProcessingEmbeddings = false;
        }
    }

    /**
     * Get file record by path
     */
    private async getFileByPath(filePath: string): Promise<FileRecord | null> {
        if (!this.db) return null;
        const result = await this.db.execute({
            sql: 'SELECT * FROM files WHERE path = ?',
            args: [filePath]
        });
        return result.rows[0] as unknown as FileRecord | null;
    }

    /**
     * Get the embedding queue length (for status display)
     */
    public getEmbeddingQueueLength(): number {
        return this.embeddingQueue.length;
    }

    /**
     * Cancel the embedding queue processing
     */
    public cancelEmbeddingQueue(): void {
        this.embeddingCancelled = true;
        this.embeddingQueue = [];
        if (this.embeddingStatusBar) {
            this.embeddingStatusBar.dispose();
            this.embeddingStatusBar = null;
        }
        log.info('Embedding queue cancelled');
    }

    /**
     * Remove file from database
     */
    public async removeFile(filePath: string): Promise<void> {
        await this.removeFileData(filePath);
    }

    /**
     * Remove all data for a file
     */
    private async removeFileData(filePath: string): Promise<void> {
        if (!this.db) return;

        await this.withWriteLock(async () => {
            await withRetry(
                () => this.db!.batch([
                    { sql: 'DELETE FROM headings WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM source_blocks WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM links WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM hashtags WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM chunks WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM fts_content WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM files WHERE path = ?', args: [filePath] }
                ]),
                {
                    maxAttempts: 5,
                    baseDelayMs: 100,
                    operationName: 'removeFileData',
                    isRetryable: isTransientError
                }
            );
        });
    }

    /**
     * Remove entries for files that no longer exist on disk.
     * Called during manual reindex to clean up the database.
     */
    public async removeDeletedFiles(
        onProgress?: (status: { checked: number; total: number; deleted: number }) => void
    ): Promise<{ checked: number; deleted: number }> {
        const result = { checked: 0, deleted: 0 };

        if (!this.db) return result;

        // Get total count
        const countResult = await this.db.execute('SELECT COUNT(*) as count FROM files');
        const total = Number((countResult.rows[0] as any).count);

        if (total === 0) return result;

        log.info('Checking for deleted files', { total });

        // Process in pages to avoid loading all into memory
        const pageSize = 100;
        let offset = 0;

        while (offset < total) {
            const pageResult = await this.db.execute({
                sql: 'SELECT path FROM files ORDER BY path LIMIT ? OFFSET ?',
                args: [pageSize, offset]
            });
            const files = pageResult.rows as unknown as { path: string }[];

            if (files.length === 0) break;

            for (const file of files) {
                result.checked++;

                if (!fs.existsSync(file.path)) {
                    await this.removeFileData(file.path);
                    result.deleted++;
                }
            }

            onProgress?.({ checked: result.checked, total, deleted: result.deleted });
            offset += pageSize;

            // Yield between pages
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (result.deleted > 0) {
            log.info('Removed deleted files', { deleted: result.deleted });
        }

        return result;
    }

    /**
     * Set search scope
     */
    public setSearchScope(scope: SearchScope): void {
        this.searchScope = scope;
    }

    /**
     * Get search scope
     */
    public getSearchScope(): SearchScope {
        return this.searchScope;
    }

    /**
     * Build scope WHERE clause
     */
    private getScopeClause(pathColumn: string = 'file_path'): { sql: string; args: any[] } {
        if (this.searchScope.type === 'directory' && this.searchScope.path) {
            return {
                sql: ` AND ${pathColumn} LIKE ?`,
                args: [`${this.searchScope.path}%`]
            };
        }
        return { sql: '', args: [] };
    }

    /**
     * Full-text search using FTS5 with BM25 ranking
     */
    public async searchFullText(query: string, options?: {
        limit?: number;
    }): Promise<SearchResult[]> {
        if (!this.db) return [];

        const limit = options?.limit || 100;
        const scope = this.getScopeClause('file_path');

        const result = await this.db.execute({
            sql: `SELECT file_path, title,
                         snippet(fts_content, 2, '<mark>', '</mark>', '...', 32) as snippet,
                         bm25(fts_content) as score
                  FROM fts_content
                  WHERE fts_content MATCH ?${scope.sql}
                  ORDER BY score
                  LIMIT ?`,
            args: [query, ...scope.args, limit]
        });

        return result.rows.map(row => ({
            type: 'content' as const,
            file_path: row.file_path as string,
            line_number: 1,
            preview: row.snippet as string,
            score: Math.abs(row.score as number)
        }));
    }

    /**
     * Semantic search using vector similarity
     */
    public async searchSemantic(query: string, options?: {
        limit?: number;
    }): Promise<SearchResult[]> {
        if (!this.db || !this.embeddingService) return [];

        // Check if vector search is available
        if (!this.vectorSearchSupported) {
            log.debug('Semantic search unavailable - vector search not supported');
            return [];
        }

        try {
            const limit = options?.limit || 20;
            const queryEmbedding = await this.embeddingService.embed(query);
            const scope = this.getScopeClause('c.file_path');

            // Convert embedding to vector format
            const vectorStr = `[${queryEmbedding.join(',')}]`;

            const result = await this.db.execute({
                sql: `SELECT c.file_path, c.content, c.line_start, c.line_end,
                             vector_distance_cos(c.embedding, vector32(?)) as distance
                      FROM chunks c
                      WHERE c.embedding IS NOT NULL${scope.sql}
                      ORDER BY distance ASC
                      LIMIT ?`,
                args: [vectorStr, ...scope.args, limit]
            });

            return result.rows.map(row => ({
                type: 'semantic' as const,
                file_path: row.file_path as string,
                line_number: row.line_start as number,
                preview: (row.content as string).slice(0, 200),
                score: 1 - (row.distance as number),
                distance: row.distance as number
            }));
        } catch (error: any) {
            log.error('Semantic search failed', error as Error);
            return [];
        }
    }

    /**
     * Hybrid search: combine FTS5 and vector search with reciprocal rank fusion
     */
    public async searchHybrid(query: string, options?: {
        limit?: number;
        ftsWeight?: number;
        vectorWeight?: number;
    }): Promise<SearchResult[]> {
        const limit = options?.limit || 20;
        const ftsWeight = options?.ftsWeight || 0.5;
        const vectorWeight = options?.vectorWeight || 0.5;

        const [ftsResults, vectorResults] = await Promise.all([
            this.searchFullText(query, { limit: limit * 2 }),
            this.embeddingService ? this.searchSemantic(query, { limit: limit * 2 }) : []
        ]);

        const scoreMap = new Map<string, { result: SearchResult; rrf: number }>();

        ftsResults.forEach((result, idx) => {
            const key = `${result.file_path}:${result.line_number}`;
            const rrf = ftsWeight / (idx + 1);
            scoreMap.set(key, { result, rrf });
        });

        vectorResults.forEach((result, idx) => {
            const key = `${result.file_path}:${result.line_number}`;
            const rrf = vectorWeight / (idx + 1);
            const existing = scoreMap.get(key);
            if (existing) {
                existing.rrf += rrf;
            } else {
                scoreMap.set(key, { result, rrf });
            }
        });

        return Array.from(scoreMap.values())
            .sort((a, b) => b.rrf - a.rrf)
            .slice(0, limit)
            .map(item => ({ ...item.result, score: item.rrf }));
    }

    /**
     * Search headings
     */
    public async searchHeadings(query: string, options?: {
        todoState?: string;
        tag?: string;
        limit?: number;
    }): Promise<HeadingRecord[]> {
        if (!this.db) return [];

        const limit = options?.limit || 100;
        const scope = this.getScopeClause();

        let sql = `SELECT * FROM headings WHERE 1=1${scope.sql}`;
        const args: any[] = [...scope.args];

        if (query) {
            sql += ' AND title LIKE ?';
            args.push(`%${query}%`);
        }

        if (options?.todoState) {
            sql += ' AND todo_state = ?';
            args.push(options.todoState);
        }

        if (options?.tag) {
            sql += ' AND (tags LIKE ? OR inherited_tags LIKE ?)';
            args.push(`%"${options.tag}"%`, `%"${options.tag}"%`);
        }

        sql += ' ORDER BY file_path, line_number LIMIT ?';
        args.push(limit);

        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as HeadingRecord[];
    }

    /**
     * Search by property
     */
    public async searchByProperty(propertyName: string, value?: string): Promise<HeadingRecord[]> {
        if (!this.db) return [];

        const scope = this.getScopeClause();

        let sql = `SELECT * FROM headings WHERE properties LIKE ?${scope.sql}`;
        const args: any[] = value
            ? [`%"${propertyName}":"${value}%`, ...scope.args]
            : [`%"${propertyName}"%`, ...scope.args];

        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as HeadingRecord[];
    }

    /**
     * Get agenda items
     */
    public async getAgenda(options?: {
        before?: string;
        includeUnscheduled?: boolean;
        requireTodoState?: boolean;
    }): Promise<AgendaItem[]> {
        if (!this.db) return [];

        const items: AgendaItem[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let beforeDate: Date | undefined;
        if (options?.before) {
            beforeDate = this.parseRelativeDate(options.before);
        }

        const scope = this.getScopeClause();

        // Build TODO state condition based on requireTodoState option
        const requireTodo = options?.requireTodoState ?? true;
        const todoStateCondition = requireTodo
            ? `AND todo_state IS NOT NULL AND todo_state NOT IN ('DONE', 'CANCELLED')`
            : `AND (todo_state IS NULL OR todo_state NOT IN ('DONE', 'CANCELLED'))`;

        // Get items with deadlines
        const deadlines = await this.db.execute({
            sql: `SELECT * FROM headings
                  WHERE deadline IS NOT NULL
                  ${todoStateCondition}
                  ${scope.sql}`,
            args: scope.args
        });

        for (const row of deadlines.rows) {
            const heading = row as unknown as HeadingRecord;
            // Use parseDate to create a LOCAL date (new Date('2024-01-27') creates UTC midnight)
            const deadlineDate = parseDate(heading.deadline!.split(' ')[0], 'yyyy-MM-dd', new Date());
            const daysUntil = Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (!beforeDate || deadlineDate <= beforeDate) {
                items.push({
                    type: 'deadline',
                    heading,
                    date: heading.deadline!,
                    days_until: daysUntil,
                    overdue: daysUntil < 0
                });
            }
        }

        // Get scheduled items
        const scheduled = await this.db.execute({
            sql: `SELECT * FROM headings
                  WHERE scheduled IS NOT NULL
                  ${todoStateCondition}
                  ${scope.sql}`,
            args: scope.args
        });

        for (const row of scheduled.rows) {
            const heading = row as unknown as HeadingRecord;
            // Use parseDate to create a LOCAL date
            const scheduledDate = parseDate(heading.scheduled!.split(' ')[0], 'yyyy-MM-dd', new Date());
            const daysUntil = Math.floor((scheduledDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (!beforeDate || scheduledDate <= beforeDate) {
                items.push({
                    type: 'scheduled',
                    heading,
                    date: heading.scheduled!,
                    days_until: daysUntil,
                    overdue: daysUntil < 0
                });
            }
        }

        // Get unscheduled TODOs
        if (options?.includeUnscheduled) {
            const todos = await this.db.execute({
                sql: `SELECT * FROM headings
                      WHERE todo_state IS NOT NULL
                      AND todo_state NOT IN ('DONE', 'CANCELLED')
                      AND deadline IS NULL AND scheduled IS NULL
                      ${scope.sql}`,
                args: scope.args
            });

            for (const row of todos.rows) {
                items.push({
                    type: 'todo',
                    heading: row as unknown as HeadingRecord
                });
            }
        }

        items.sort((a, b) => {
            if (a.overdue && !b.overdue) return -1;
            if (!a.overdue && b.overdue) return 1;
            if (a.days_until !== undefined && b.days_until !== undefined) {
                return a.days_until - b.days_until;
            }
            return 0;
        });

        return items;
    }

    /**
     * Parse relative date
     */
    private parseRelativeDate(dateStr: string): Date {
        const date = new Date();
        if (dateStr.startsWith('+')) {
            const match = dateStr.match(/\+(\d+)([dwmy])/);
            if (match) {
                const amount = parseInt(match[1]);
                const unit = match[2];
                switch (unit) {
                    case 'd': date.setDate(date.getDate() + amount); break;
                    case 'w': date.setDate(date.getDate() + amount * 7); break;
                    case 'm': date.setMonth(date.getMonth() + amount); break;
                    case 'y': date.setFullYear(date.getFullYear() + amount); break;
                }
            }
        } else {
            return new Date(dateStr);
        }
        return date;
    }

    /**
     * Search source blocks
     */
    public async searchSourceBlocks(language?: string, query?: string): Promise<SourceBlockRecord[]> {
        if (!this.db) return [];

        const scope = this.getScopeClause();
        let sql = `SELECT * FROM source_blocks WHERE 1=1${scope.sql}`;
        const args: any[] = [...scope.args];

        if (language) {
            sql += ' AND language = ?';
            args.push(language.toLowerCase());
        }

        if (query) {
            sql += ' AND content LIKE ?';
            args.push(`%${query}%`);
        }

        sql += ' LIMIT 100';

        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as SourceBlockRecord[];
    }

    /**
     * Get all unique tags
     */
    public async getAllTags(): Promise<string[]> {
        if (!this.db) return [];

        const result = await this.db.execute(
            'SELECT DISTINCT tag FROM hashtags ORDER BY tag'
        );
        return result.rows.map(r => r.tag as string);
    }

    /**
     * Get all TODO states
     */
    public async getAllTodoStates(): Promise<string[]> {
        if (!this.db) return [];

        const result = await this.db.execute(
            'SELECT DISTINCT todo_state FROM headings WHERE todo_state IS NOT NULL ORDER BY todo_state'
        );
        return result.rows.map(r => r.todo_state as string);
    }

    /**
     * Get all languages
     */
    public async getAllLanguages(): Promise<string[]> {
        if (!this.db) return [];

        const result = await this.db.execute(
            'SELECT DISTINCT language FROM source_blocks ORDER BY language'
        );
        return result.rows.map(r => r.language as string);
    }

    /**
     * Get all files
     */
    public async getFiles(): Promise<FileRecord[]> {
        if (!this.db) return [];

        const result = await this.db.execute('SELECT * FROM files ORDER BY indexed_at DESC');
        return result.rows as unknown as FileRecord[];
    }

    /**
     * Get TODOs
     */
    public async getTodos(state?: string): Promise<HeadingRecord[]> {
        if (!this.db) return [];

        const scope = this.getScopeClause();
        let sql = `SELECT * FROM headings WHERE todo_state IS NOT NULL${scope.sql}`;
        const args: any[] = [...scope.args];

        if (state) {
            sql += ' AND todo_state = ?';
            args.push(state);
        }

        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as HeadingRecord[];
    }

    /**
     * Find files by hashtag
     */
    public async findByHashtag(tag: string): Promise<string[]> {
        if (!this.db) return [];

        const result = await this.db.execute({
            sql: 'SELECT DISTINCT file_path FROM hashtags WHERE tag = ?',
            args: [tag.toLowerCase()]
        });
        return result.rows.map(r => r.file_path as string);
    }

    /**
     * Get all hashtags
     */
    public async getAllHashtags(): Promise<string[]> {
        if (!this.db) return [];

        const result = await this.db.execute(
            'SELECT DISTINCT tag FROM hashtags ORDER BY tag'
        );
        return result.rows.map(r => r.tag as string);
    }

    /**
     * Get database stats
     */
    public async getStats(): Promise<DbStats> {
        if (!this.db) return {
            files: 0, headings: 0, blocks: 0, links: 0, chunks: 0,
            has_embeddings: false, vector_search_supported: false,
            vector_search_error: null, by_type: { org: 0, md: 0 }
        };

        const [files, headings, blocks, links, chunks, embeddings, orgFiles, mdFiles] = await this.executeResilient(
            () => Promise.all([
                this.db!.execute('SELECT COUNT(*) as count FROM files'),
                this.db!.execute('SELECT COUNT(*) as count FROM headings'),
                this.db!.execute('SELECT COUNT(*) as count FROM source_blocks'),
                this.db!.execute('SELECT COUNT(*) as count FROM links'),
                this.db!.execute('SELECT COUNT(*) as count FROM chunks'),
                this.db!.execute('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL'),
                this.db!.execute("SELECT COUNT(*) as count FROM files WHERE file_type = 'org'"),
                this.db!.execute("SELECT COUNT(*) as count FROM files WHERE file_type = 'md'")
            ]),
            'getStats'
        );

        const lastFile = await this.queryResilient(
            'SELECT MAX(indexed_at) as last FROM files',
            [],
            'getStats:lastFile'
        );

        return {
            files: files.rows[0].count as number,
            headings: headings.rows[0].count as number,
            blocks: blocks.rows[0].count as number,
            links: links.rows[0].count as number,
            chunks: chunks.rows[0].count as number,
            has_embeddings: (embeddings.rows[0].count as number) > 0,
            vector_search_supported: this.vectorSearchSupported,
            vector_search_error: this.vectorSearchError,
            last_indexed: lastFile.rows[0].last as number | undefined,
            by_type: {
                org: orgFiles.rows[0].count as number,
                md: mdFiles.rows[0].count as number
            }
        };
    }

    /**
     * Get schema version and migration history
     */
    public async getSchemaInfo(): Promise<{
        currentVersion: number;
        latestVersion: number;
        history: Array<{ version: number; applied_at: number; description: string }>;
    }> {
        if (!this.db) {
            return { currentVersion: 0, latestVersion: getLatestVersion(), history: [] };
        }

        const runner = new MigrationRunner(this.db);
        const [currentVersion, history] = await Promise.all([
            runner.getCurrentVersion(),
            runner.getMigrationHistory()
        ]);

        return {
            currentVersion,
            latestVersion: getLatestVersion(),
            history
        };
    }

    /**
     * Clear database
     */
    public async clear(): Promise<void> {
        if (!this.db) return;

        await this.withWriteLock(async () => {
            await this.db!.batch([
                'DELETE FROM chunks',
                'DELETE FROM fts_content',
                'DELETE FROM hashtags',
                'DELETE FROM links',
                'DELETE FROM source_blocks',
                'DELETE FROM headings',
                'DELETE FROM files'
            ]);
        });
    }

    /**
     * Optimize database
     */
    public async optimize(): Promise<void> {
        if (!this.db) return;

        const files = await this.getFiles();
        for (const file of files) {
            if (!fs.existsSync(file.path)) {
                await this.removeFileData(file.path);
            }
        }

        await this.db.execute('VACUUM');
    }

    /**
     * Check for stale files and reindex them in the background.
     * Designed to run at startup without blocking user interaction.
     * Uses pagination to avoid loading all files into memory at once.
     *
     * @param options Configuration options
     * @param options.batchSize Number of files to check before yielding (default: 50)
     * @param options.yieldMs Milliseconds to yield between batches (default: 50)
     * @param options.maxReindex Maximum files to reindex per session (default: 50)
     * @param options.onProgress Optional callback for progress updates
     * @returns Object with counts of checked, stale, deleted, and reindexed files
     */
    public async checkStaleFiles(options: {
        batchSize?: number;
        yieldMs?: number;
        maxReindex?: number;
        onProgress?: (status: { checked: number; total: number; reindexed: number }) => void;
        cancellationToken?: { cancelled: boolean };
    } = {}): Promise<{ checked: number; stale: number; deleted: number; reindexed: number }> {
        const {
            batchSize = 50,
            yieldMs = 50,
            maxReindex = 0,  // 0 = unlimited (no limit on reindexing)
            onProgress,
            cancellationToken
        } = options;

        const result = { checked: 0, stale: 0, deleted: 0, reindexed: 0 };

        if (!this.db) return result;

        // Get total count first (lightweight query)
        const countResult = await this.db.execute('SELECT COUNT(*) as count FROM files');
        const total = Number((countResult.rows[0] as any).count);

        if (total === 0) return result;

        log.info('Checking files for staleness', { total, maxReindex: maxReindex || 'unlimited' });

        // Process files in pages to avoid loading all into memory
        const pageSize = 100;
        let offset = 0;

        while (offset < total) {
            // Check for cancellation
            if (cancellationToken?.cancelled) {
                log.info('Stale check cancelled');
                break;
            }

            // Check if we've hit the reindex limit (0 = unlimited)
            if (maxReindex > 0 && result.reindexed >= maxReindex) {
                log.info('Reached max reindex limit', { maxReindex });
                break;
            }

            // Fetch a page of files
            const pageResult = await this.db.execute({
                sql: 'SELECT * FROM files ORDER BY path LIMIT ? OFFSET ?',
                args: [pageSize, offset]
            });
            const files = pageResult.rows as unknown as FileRecord[];

            if (files.length === 0) break;

            for (let i = 0; i < files.length; i++) {
                // Check for cancellation
                if (cancellationToken?.cancelled) break;

                // Check reindex limit (0 = unlimited)
                if (maxReindex > 0 && result.reindexed >= maxReindex) break;

                const file = files[i];
                result.checked++;

                try {
                    // Check if file still exists
                    if (!fs.existsSync(file.path)) {
                        await this.removeFileData(file.path);
                        result.deleted++;
                        continue;
                    }

                    // Check if file has been modified
                    const stats = fs.statSync(file.path);
                    if (stats.mtimeMs > file.mtime) {
                        result.stale++;
                        // Queue embeddings for async processing to avoid OOM
                        await this.indexFile(file.path, { queueEmbeddings: true });
                        result.reindexed++;

                        // Longer pause after reindexing to allow GC
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (error) {
                    log.error('Error checking file staleness', error as Error, { path: file.path });
                }

                // Yield every batchSize files
                if (i > 0 && i % batchSize === 0) {
                    await new Promise(resolve => setTimeout(resolve, yieldMs));
                }
            }

            // Report progress after each page
            if (onProgress) {
                onProgress({ checked: result.checked, total, reindexed: result.reindexed });
            }

            // Move to next page
            offset += pageSize;

            // Yield between pages
            await new Promise(resolve => setTimeout(resolve, yieldMs));
        }

        log.info('Stale check complete', { stale: result.stale, deleted: result.deleted, reindexed: result.reindexed });
        return result;
    }

    /**
     * Scan directories for new/changed files in the background.
     * Designed to run at startup without blocking user interaction.
     * Limits indexing to avoid OOM.
     *
     * @param directories List of directory paths to scan
     * @param options Configuration options
     * @returns Object with counts of found, new, changed, and indexed files
     */
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
            maxIndex = 0,  // 0 = unlimited (no limit on files indexed)
            onProgress,
            cancellationToken
        } = options;

        const result = { scanned: 0, newFiles: 0, changed: 0, indexed: 0 };

        if (!this.db || directories.length === 0) return result;

        log.info('Scanning directories', { directories: directories.length, maxIndex: maxIndex || 'unlimited' });

        // Process directories one at a time to avoid loading all files into memory
        for (const dir of directories) {
            if (cancellationToken?.cancelled) break;
            if (maxIndex > 0 && result.indexed >= maxIndex) {
                log.info('Reached max index limit', { maxIndex });
                break;
            }

            try {
                if (!fs.existsSync(dir)) {
                    log.warn('Directory does not exist', { dir });
                    continue;
                }

                onProgress?.({ scanned: result.scanned, total: 0, indexed: result.indexed, currentDir: dir });

                // Use generator to stream files without accumulating all paths in memory
                // This prevents OOM when scanning directories with thousands of files
                let filesInDir = 0;
                for await (const filePath of this.findFilesGenerator(dir)) {
                    if (cancellationToken?.cancelled) break;
                    if (maxIndex > 0 && result.indexed >= maxIndex) break;

                    result.scanned++;
                    filesInDir++;

                    try {
                        const needsIndex = await this.needsReindex(filePath);

                        if (needsIndex) {
                            // Check if it's a new file
                            const existing = await this.getFileByPath(filePath);
                            if (!existing) {
                                result.newFiles++;
                            } else {
                                result.changed++;
                            }

                            // Queue embeddings for async processing to avoid OOM
                            await this.indexFile(filePath, { queueEmbeddings: true });
                            result.indexed++;

                            // Longer pause after indexing to allow GC
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    } catch (error) {
                        log.error('Error processing file', error as Error, { path: filePath });
                    }

                    // Yield every batchSize files
                    if (filesInDir % batchSize === 0) {
                        onProgress?.({ scanned: result.scanned, total: 0, indexed: result.indexed, currentDir: dir });
                        await new Promise(resolve => setTimeout(resolve, yieldMs));
                    }
                }
            } catch (error) {
                log.error('Error scanning directory', error as Error, { dir });
            }

            // Yield between directories
            await new Promise(resolve => setTimeout(resolve, yieldMs));
        }

        log.info('Directory scan complete', { newFiles: result.newFiles, changed: result.changed, indexed: result.indexed });
        return result;
    }

    // =========================================================================
    // Backup / Restore / Rebuild / Verify
    // =========================================================================

    /**
     * Backup format version
     */
    private static readonly BACKUP_VERSION = 1;

    /**
     * Export database metadata to JSON backup file.
     * Note: File content is NOT backed up - it can be re-indexed from source files.
     * What IS backed up: projects list, config that would be lost on rebuild.
     */
    public async exportBackup(outputPath: string): Promise<{ projects: number; files: number }> {
        if (!this.db) throw new Error('Database not initialized');

        // Get projects from globalState (we'll migrate this later)
        const projects = this.context.globalState.get<any[]>('scimax.projects', []);

        // Get agenda config (exclude list, include list)
        const agendaConfig = vscode.workspace.getConfiguration('scimax.agenda');
        const agendaExclude = agendaConfig.get<string[]>('exclude', []);
        const agendaInclude = agendaConfig.get<string[]>('include', []);

        // Get list of indexed files (for reference, not for restore)
        const filesResult = await this.db.execute('SELECT path, file_type, mtime FROM files ORDER BY path');
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
            agendaConfig: {
                exclude: agendaExclude,
                include: agendaInclude
            },
            // Include indexed files list for reference (helps user know what will be re-indexed)
            indexedFilesCount: indexedFiles.length,
            indexedFiles
        };

        await fs.promises.writeFile(outputPath, JSON.stringify(backup, null, 2), 'utf-8');

        return { projects: projects.length, files: indexedFiles.length };
    }

    /**
     * Import database metadata from JSON backup file.
     * Restores projects list and triggers re-indexing.
     */
    public async importBackup(inputPath: string): Promise<{ projects: number; filesToIndex: number }> {
        const content = await fs.promises.readFile(inputPath, 'utf-8');
        const backup = JSON.parse(content);

        if (!backup.version || backup.version > ScimaxDb.BACKUP_VERSION) {
            throw new Error(`Unsupported backup version: ${backup.version}`);
        }

        // Restore projects to globalState
        if (backup.projects && Array.isArray(backup.projects)) {
            await this.context.globalState.update('scimax.projects', backup.projects);
        }

        // Restore agenda config
        if (backup.agendaConfig) {
            const agendaConfig = vscode.workspace.getConfiguration('scimax.agenda');
            if (backup.agendaConfig.exclude) {
                await agendaConfig.update('exclude', backup.agendaConfig.exclude, vscode.ConfigurationTarget.Global);
            }
            if (backup.agendaConfig.include) {
                await agendaConfig.update('include', backup.agendaConfig.include, vscode.ConfigurationTarget.Global);
            }
        }

        // Count files that need re-indexing (files in backup that exist on disk)
        let filesToIndex = 0;
        if (backup.indexedFiles && Array.isArray(backup.indexedFiles)) {
            for (const file of backup.indexedFiles) {
                if (fs.existsSync(file.path)) {
                    filesToIndex++;
                }
            }
        }

        return { projects: backup.projects?.length || 0, filesToIndex };
    }

    /**
     * Rebuild database from scratch.
     * Clears all indexed data and re-indexes from projects and configured directories.
     */
    public async rebuild(options: {
        onProgress?: (status: { phase: string; current: number; total: number }) => void;
        cancellationToken?: { cancelled: boolean };
    } = {}): Promise<{ filesIndexed: number; errors: number }> {
        const { onProgress, cancellationToken } = options;

        if (!this.db) throw new Error('Database not initialized');

        const result = { filesIndexed: 0, errors: 0 };

        // Phase 1: Clear all data
        onProgress?.({ phase: 'Clearing database', current: 0, total: 1 });
        await this.clear();

        if (cancellationToken?.cancelled) return result;

        // Phase 2: Collect directories to index
        onProgress?.({ phase: 'Collecting directories', current: 0, total: 1 });
        const directories: string[] = [];

        // Get projects from globalState
        const projects = this.context.globalState.get<any[]>('scimax.projects', []);
        for (const project of projects) {
            if (project.path && fs.existsSync(project.path)) {
                directories.push(project.path);
            }
        }

        // Get workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        for (const folder of workspaceFolders) {
            if (!directories.includes(folder.uri.fsPath)) {
                directories.push(folder.uri.fsPath);
            }
        }

        // Get journal directory
        const journalDir = this.resolveScimaxPath('scimax.journal.directory', 'journal');
        if (journalDir && fs.existsSync(journalDir) && !directories.includes(journalDir)) {
            directories.push(journalDir);
        }

        // Get agenda include directories
        const agendaConfig = vscode.workspace.getConfiguration('scimax.agenda');
        const agendaInclude = agendaConfig.get<string[]>('include', []);
        for (const dir of agendaInclude) {
            const expanded = dir.startsWith('~') ? dir.replace(/^~/, process.env.HOME || '') : dir;
            if (fs.existsSync(expanded) && !directories.includes(expanded)) {
                directories.push(expanded);
            }
        }

        if (cancellationToken?.cancelled) return result;

        // Phase 3: Index all directories using streaming to avoid OOM
        // Use a Set for deduplication without accumulating all file paths first
        const indexedPaths = new Set<string>();

        onProgress?.({ phase: 'Indexing files', current: 0, total: 0 });

        for (const dir of directories) {
            if (cancellationToken?.cancelled) break;

            // Stream files from each directory
            for await (const filePath of this.findFilesGenerator(dir)) {
                if (cancellationToken?.cancelled) break;

                // Skip already-indexed files (deduplication)
                if (indexedPaths.has(filePath)) continue;
                indexedPaths.add(filePath);

                try {
                    await this.indexFile(filePath, { queueEmbeddings: true });
                    result.filesIndexed++;
                } catch (error) {
                    log.error('Error indexing file', error as Error, { path: filePath });
                    result.errors++;
                }

                // Report progress every 10 files
                if (result.filesIndexed % 10 === 0) {
                    onProgress?.({ phase: 'Indexing files', current: result.filesIndexed, total: 0 });
                    // Yield to prevent blocking
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }

        onProgress?.({ phase: 'Complete', current: result.filesIndexed, total: result.filesIndexed });

        return result;
    }

    /**
     * Helper to resolve scimax paths (duplicated from pathResolver to avoid circular deps)
     */
    private resolveScimaxPath(configKey: string, defaultSubdir: string): string | null {
        const config = vscode.workspace.getConfiguration();
        const configuredPath = config.get<string>(configKey);

        if (configuredPath) {
            if (configuredPath.startsWith('~')) {
                return configuredPath.replace(/^~/, process.env.HOME || '');
            }
            return configuredPath;
        }

        // Default to ~/scimax/{defaultSubdir}
        const home = process.env.HOME;
        if (home) {
            return path.join(home, 'scimax', defaultSubdir);
        }

        return null;
    }

    /**
     * Verify database integrity and return a report.
     */
    public async verify(): Promise<{
        ok: boolean;
        issues: string[];
        stats: {
            files: number;
            missingFiles: number;
            staleFiles: number;
            orphanedHeadings: number;
            orphanedBlocks: number;
        };
    }> {
        if (!this.db) throw new Error('Database not initialized');

        const issues: string[] = [];
        const stats = {
            files: 0,
            missingFiles: 0,
            staleFiles: 0,
            orphanedHeadings: 0,
            orphanedBlocks: 0
        };

        // Check files table
        const filesResult = await this.db.execute('SELECT * FROM files');
        stats.files = filesResult.rows.length;

        for (const row of filesResult.rows) {
            const filePath = row.path as string;
            const mtime = row.mtime as number;

            if (!fs.existsSync(filePath)) {
                stats.missingFiles++;
                issues.push(`Missing file: ${filePath}`);
            } else {
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.mtimeMs > mtime) {
                        stats.staleFiles++;
                        issues.push(`Stale file (needs reindex): ${filePath}`);
                    }
                } catch (e) {
                    issues.push(`Cannot stat file: ${filePath}`);
                }
            }
        }

        // Check for orphaned headings (headings without valid file_id)
        const orphanedHeadingsResult = await this.db.execute(`
            SELECT COUNT(*) as count FROM headings h
            LEFT JOIN files f ON h.file_id = f.id
            WHERE f.id IS NULL
        `);
        stats.orphanedHeadings = orphanedHeadingsResult.rows[0].count as number;
        if (stats.orphanedHeadings > 0) {
            issues.push(`${stats.orphanedHeadings} orphaned heading records`);
        }

        // Check for orphaned source blocks
        const orphanedBlocksResult = await this.db.execute(`
            SELECT COUNT(*) as count FROM source_blocks sb
            LEFT JOIN files f ON sb.file_id = f.id
            WHERE f.id IS NULL
        `);
        stats.orphanedBlocks = orphanedBlocksResult.rows[0].count as number;
        if (stats.orphanedBlocks > 0) {
            issues.push(`${stats.orphanedBlocks} orphaned source block records`);
        }

        return {
            ok: issues.length === 0,
            issues,
            stats
        };
    }

    /**
     * Validate freshness of specified files and return list of stale paths.
     * This is a fast operation - only checks mtimes, doesn't parse files.
     */
    public async validateFreshness(filePaths: string[]): Promise<string[]> {
        if (!this.db || filePaths.length === 0) return [];

        const stale: string[] = [];

        // Get mtimes from database in one query
        const placeholders = filePaths.map(() => '?').join(',');
        const result = await this.db.execute({
            sql: `SELECT path, mtime FROM files WHERE path IN (${placeholders})`,
            args: filePaths
        });

        const dbMtimes = new Map<string, number>();
        for (const row of result.rows) {
            dbMtimes.set(row.path as string, row.mtime as number);
        }

        // Check each file
        for (const filePath of filePaths) {
            try {
                if (!fs.existsSync(filePath)) {
                    // File deleted
                    stale.push(filePath);
                    continue;
                }

                const stat = fs.statSync(filePath);
                const dbMtime = dbMtimes.get(filePath);

                if (dbMtime === undefined) {
                    // File not in database
                    stale.push(filePath);
                } else if (stat.mtimeMs > dbMtime) {
                    // File modified since last index
                    stale.push(filePath);
                }
            } catch (error) {
                // Error checking file - consider it stale
                stale.push(filePath);
            }
        }

        return stale;
    }

    /**
     * Re-index a list of files (used after validateFreshness)
     */
    public async reindexFiles(filePaths: string[], options?: {
        onProgress?: (current: number, total: number) => void;
    }): Promise<number> {
        let indexed = 0;

        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            try {
                if (fs.existsSync(filePath)) {
                    await this.indexFile(filePath, { queueEmbeddings: true });
                    indexed++;
                } else {
                    // File was deleted - remove from database
                    await this.removeFileData(filePath);
                }
            } catch (error) {
                log.error('Error reindexing file', error as Error, { path: filePath });
            }

            options?.onProgress?.(i + 1, filePaths.length);
        }

        return indexed;
    }

    // =========================================================================
    // Project Management
    // =========================================================================

    /**
     * Add a project to the database
     */
    public async addProject(
        projectPath: string,
        name?: string,
        type: 'git' | 'projectile' | 'manual' = 'manual'
    ): Promise<ProjectRecord | null> {
        if (!this.db) return null;

        // Normalize path
        const normalizedPath = path.resolve(projectPath);

        // Auto-detect name if not provided
        const projectName = name || path.basename(normalizedPath);

        // Auto-detect type if not specified
        let projectType = type;
        if (type === 'manual') {
            if (fs.existsSync(path.join(normalizedPath, '.git'))) {
                projectType = 'git';
            } else if (fs.existsSync(path.join(normalizedPath, '.projectile'))) {
                projectType = 'projectile';
            }
        }

        try {
            const result = await this.db.execute({
                sql: `INSERT OR REPLACE INTO projects (path, name, type, last_opened, created_at)
                      VALUES (?, ?, ?, ?, COALESCE(
                          (SELECT created_at FROM projects WHERE path = ?),
                          strftime('%s', 'now') * 1000
                      ))`,
                args: [normalizedPath, projectName, projectType, Date.now(), normalizedPath]
            });

            // Return the inserted/updated project
            return await this.getProjectByPath(normalizedPath);
        } catch (error) {
            log.error('Failed to add project', error as Error, { path: projectPath });
            return null;
        }
    }

    /**
     * Get all projects, sorted by last opened
     */
    public async getProjects(): Promise<ProjectRecord[]> {
        if (!this.db) return [];

        const result = await this.db.execute(
            'SELECT * FROM projects ORDER BY last_opened DESC NULLS LAST, created_at DESC'
        );

        return result.rows as unknown as ProjectRecord[];
    }

    /**
     * Get a project by path
     */
    public async getProjectByPath(projectPath: string): Promise<ProjectRecord | null> {
        if (!this.db) return null;

        const normalizedPath = path.resolve(projectPath);
        const result = await this.db.execute({
            sql: 'SELECT * FROM projects WHERE path = ?',
            args: [normalizedPath]
        });

        return result.rows[0] as unknown as ProjectRecord | null;
    }

    /**
     * Remove a project from the database
     */
    public async removeProject(projectPath: string): Promise<void> {
        if (!this.db) return;

        const normalizedPath = path.resolve(projectPath);

        // Also clear project_id from any files in this project
        await this.withWriteLock(async () => {
            await this.db!.batch([
                {
                    sql: 'UPDATE files SET project_id = NULL WHERE project_id = (SELECT id FROM projects WHERE path = ?)',
                    args: [normalizedPath]
                },
                {
                    sql: 'DELETE FROM projects WHERE path = ?',
                    args: [normalizedPath]
                }
            ]);
        });
    }

    /**
     * Update project's last_opened timestamp
     */
    public async touchProject(projectPath: string): Promise<void> {
        if (!this.db) return;

        const normalizedPath = path.resolve(projectPath);
        await this.db.execute({
            sql: 'UPDATE projects SET last_opened = ? WHERE path = ?',
            args: [Date.now(), normalizedPath]
        });
    }

    /**
     * Find which project a file belongs to (by path containment)
     */
    public async getProjectForFile(filePath: string): Promise<ProjectRecord | null> {
        if (!this.db) return null;

        const normalizedFilePath = path.resolve(filePath);
        const projects = await this.getProjects();

        // Find the project with the longest matching path prefix
        let bestMatch: ProjectRecord | null = null;
        let bestMatchLength = 0;

        for (const project of projects) {
            if (normalizedFilePath.startsWith(project.path + path.sep)) {
                if (project.path.length > bestMatchLength) {
                    bestMatch = project;
                    bestMatchLength = project.path.length;
                }
            }
        }

        return bestMatch;
    }

    /**
     * Scan a directory for projects (git repos, .projectile markers)
     */
    public async scanForProjects(
        directory: string,
        maxDepth: number = 2
    ): Promise<number> {
        if (!this.db) return 0;

        let found = 0;
        const scannedDirs = new Set<string>();

        const scan = async (dir: string, depth: number): Promise<void> => {
            if (depth > maxDepth || scannedDirs.has(dir)) return;
            scannedDirs.add(dir);

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                // Check if this directory is a project
                const hasGit = entries.some(e => e.isDirectory() && e.name === '.git');
                const hasProjectile = entries.some(e => e.isFile() && e.name === '.projectile');

                if (hasGit || hasProjectile) {
                    const type = hasGit ? 'git' : 'projectile';
                    const project = await this.addProject(dir, undefined, type);
                    if (project) {
                        found++;
                        // Don't scan subdirectories of a project
                        return;
                    }
                }

                // Scan subdirectories
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    if (entry.name.startsWith('.')) continue;
                    if (['node_modules', 'dist', 'build', 'out', '__pycache__'].includes(entry.name)) continue;

                    await scan(path.join(dir, entry.name), depth + 1);
                }
            } catch (error) {
                // Ignore permission errors
            }
        };

        await scan(directory, 0);
        return found;
    }

    /**
     * Cleanup projects that no longer exist on disk
     */
    public async cleanupProjects(): Promise<number> {
        if (!this.db) return 0;

        const projects = await this.getProjects();
        let removed = 0;

        for (const project of projects) {
            if (!fs.existsSync(project.path)) {
                await this.removeProject(project.path);
                removed++;
            }
        }

        return removed;
    }

    /**
     * Associate a file with a project
     */
    public async setFileProject(filePath: string, projectId: number | null): Promise<void> {
        if (!this.db) return;

        await this.db.execute({
            sql: 'UPDATE files SET project_id = ? WHERE path = ?',
            args: [projectId, filePath]
        });
    }

    /**
     * Associate files with their containing projects automatically
     */
    public async autoAssociateFilesWithProjects(): Promise<number> {
        if (!this.db) return 0;

        const files = await this.getFiles();
        const projects = await this.getProjects();
        let updated = 0;

        for (const file of files) {
            // Find the project for this file
            let bestMatch: ProjectRecord | null = null;
            let bestMatchLength = 0;

            for (const project of projects) {
                if (file.path.startsWith(project.path + path.sep)) {
                    if (project.path.length > bestMatchLength) {
                        bestMatch = project;
                        bestMatchLength = project.path.length;
                    }
                }
            }

            if (bestMatch) {
                await this.setFileProject(file.path, bestMatch.id);
                updated++;
            }
        }

        return updated;
    }

    /**
     * Get files in a specific project
     */
    public async getFilesInProject(projectId: number): Promise<FileRecord[]> {
        if (!this.db) return [];

        const result = await this.db.execute({
            sql: 'SELECT * FROM files WHERE project_id = ? ORDER BY path',
            args: [projectId]
        });

        return result.rows as unknown as FileRecord[];
    }

    /**
     * Close database
     */
    public async close(): Promise<void> {
        // Cancel any in-progress embedding processing
        this.cancelEmbeddingQueue();

        // Clean up status bar
        if (this.embeddingStatusBar) {
            this.embeddingStatusBar.dispose();
            this.embeddingStatusBar = null;
        }

        // Clear the queue
        this.embeddingQueue = [];
        this.isProcessingEmbeddings = false;

        // Dispose event emitter
        this._onDidIndexFile.dispose();

        // Close database
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
