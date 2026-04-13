/**
 * ScimaxDbCore - Pure SQLite database logic with zero VS Code dependencies.
 *
 * This module contains all database read/write logic that can be used by both
 * the VS Code extension (via ScimaxDb wrapper) and the CLI directly.
 *
 * Constraints:
 * - ZERO imports from 'vscode'
 * - ZERO transitive imports that import 'vscode'
 * - Uses console.* for logging (not the vscode-coupled Logger)
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { createClient, Client } from '@libsql/client';
import { parse as parseDate } from 'date-fns';
import { minimatch } from 'minimatch';
import {
    parseMarkdownCodeBlocks,
    extractHashtags,
} from '../parser/orgParser';
import {
    UnifiedParserAdapter,
    LegacyDocument,
} from '../parser/orgParserAdapter';
// Migration data - inlined here to avoid importing migrations.ts which pulls in vscode via logger.
// Keep in sync with src/database/migrations.ts.

interface CoreMigration {
    version: number;
    description: string;
    up: string[];
}

const coreMigrations: CoreMigration[] = [
    {
        version: 1,
        description: 'Initial schema with FTS5 and vector support',
        up: [
            `CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                file_type TEXT NOT NULL DEFAULT 'org',
                mtime REAL NOT NULL,
                hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                keywords TEXT DEFAULT '{}'
            )`,
            `CREATE TABLE IF NOT EXISTS headings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                level INTEGER NOT NULL,
                title TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                begin_pos INTEGER NOT NULL,
                todo_state TEXT,
                priority TEXT,
                tags TEXT DEFAULT '[]',
                inherited_tags TEXT DEFAULT '[]',
                properties TEXT DEFAULT '{}',
                scheduled TEXT,
                deadline TEXT,
                closed TEXT,
                cell_index INTEGER,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS source_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                language TEXT NOT NULL,
                content TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                headers TEXT DEFAULT '{}',
                cell_index INTEGER,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                link_type TEXT NOT NULL,
                target TEXT NOT NULL,
                description TEXT,
                line_number INTEGER NOT NULL,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS hashtags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag TEXT NOT NULL,
                file_path TEXT NOT NULL,
                UNIQUE(tag, file_path)
            )`,
            `CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
                file_path,
                title,
                content,
                tokenize='porter unicode61'
            )`,
            `CREATE INDEX IF NOT EXISTS idx_headings_file ON headings(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_todo ON headings(todo_state)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_deadline ON headings(deadline)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_scheduled ON headings(scheduled)`,
            `CREATE INDEX IF NOT EXISTS idx_blocks_file ON source_blocks(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_blocks_language ON source_blocks(language)`,
            `CREATE INDEX IF NOT EXISTS idx_links_file ON links(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_hashtags_tag ON hashtags(tag)`,
            `CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type)`
        ]
    },
    {
        version: 2,
        description: 'Add projects table and project_id foreign key',
        up: [
            `CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'manual',
                last_opened INTEGER,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            )`,
            `ALTER TABLE files ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`,
            `CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path)`,
            `CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id)`
        ]
    },
    {
        version: 3,
        description: 'Add db_metadata table for storing configuration like embedding dimensions',
        up: [
            `CREATE TABLE IF NOT EXISTS db_metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            )`
        ]
    },
    {
        version: 4,
        description: 'Add heading_id to links table for contextual filtering and graph queries',
        up: [
            `ALTER TABLE links ADD COLUMN heading_id INTEGER REFERENCES headings(id) ON DELETE SET NULL`,
            `CREATE INDEX IF NOT EXISTS idx_links_heading ON links(heading_id)`,
            `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target)`,
            `CREATE INDEX IF NOT EXISTS idx_links_file_type ON links(file_path, link_type)`
        ]
    }
];

function coreGetLatestVersion(): number {
    return coreMigrations.length > 0 ? coreMigrations[coreMigrations.length - 1].version : 0;
}

// ============================================================
// Type definitions (all exported for external use)
// ============================================================

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
    cell_index: number | null;
}

export interface SourceBlockRecord {
    id: number;
    file_id: number;
    file_path: string;
    language: string;
    content: string;
    line_number: number;
    headers: string;
    cell_index: number | null;
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
    chunks: number;
    has_embeddings: boolean;
    vector_search_supported: boolean;
    vector_search_error: string | null;
    last_indexed?: number;
    by_type: { org: number; md: number };
    database_size?: number;
}

export interface ProjectRecord {
    id: number;
    path: string;
    name: string;
    type: 'git' | 'projectile' | 'manual';
    last_opened: number | null;
    created_at: number;
}

// ============================================================
// Core configuration
// ============================================================

export interface ScimaxDbCoreOptions {
    dbPath: string;
    ignorePatterns?: string[];
    maxFileSizeMB?: number;       // default 10
    maxParseSizeKB?: number;      // default 500
    maxFileLines?: number;        // default 5000
    queryTimeoutMs?: number;      // default 30000
    maxRetryAttempts?: number;    // default 3
    embeddingDimensions?: number; // default 384
    /** Called after a file is indexed (for VS Code adapter hooks) */
    onFileIndexed?: (filePath: string, fileId: number, fileType: string, mtime: number, db: Client) => Promise<void>;
}

// ============================================================
// Embedding service interface (no vscode)
// ============================================================

export interface CoreEmbeddingService {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    dimensions: number;
}

// ============================================================
// Inline resilience helpers (no logger/vscode dependency)
// ============================================================

function coreIsTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes('database is locked') ||
        message.includes('database is busy') ||
        message.includes('sqlite_busy') ||
        message.includes('cannot commit transaction') ||
        message.includes('disk i/o error') ||
        message.includes('unable to open database') ||
        message.includes('econnreset') ||
        message.includes('ebusy') ||
        message.includes('eagain')
    );
}

async function coreWithRetry<T>(
    fn: () => Promise<T>,
    options: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        operationName?: string;
        isRetryable?: (e: unknown) => boolean;
    } = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        baseDelayMs = 100,
        maxDelayMs = 5000,
        operationName = 'operation',
        isRetryable = coreIsTransientError
    } = options;

    let lastError: Error = new Error('No attempts made');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxAttempts && isRetryable(error)) {
                const exp = baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = Math.random() * exp * 0.5;
                const delay = Math.min(exp + jitter, maxDelayMs);
                console.warn(`[ScimaxDbCore] ${operationName} failed (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(delay)}ms: ${lastError.message}`);
                await new Promise(r => setTimeout(r, delay));
            } else if (attempt < maxAttempts) {
                throw lastError;
            }
        }
    }

    throw lastError;
}

async function coreWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    operationName: string
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const id = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`Operation '${operationName}' timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);
        fn().then(r => {
            if (!settled) { settled = true; clearTimeout(id); resolve(r); }
        }).catch(e => {
            if (!settled) { settled = true; clearTimeout(id); reject(e); }
        });
    });
}

// ============================================================
// Inline migration runner (same logic as MigrationRunner but
// uses console.* instead of logger which would pull in vscode)
// ============================================================

async function runCoreMigrations(db: Client): Promise<{ applied: number; currentVersion: number }> {
    // Initialize version table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
        )
    `);

    // Get current version
    let currentVersion = 0;
    try {
        const r = await db.execute('SELECT MAX(version) as version FROM schema_version');
        currentVersion = (r.rows[0]?.version as number) || 0;
    } catch {
        currentVersion = 0;
    }

    // Detect legacy schema if no version recorded
    if (currentVersion === 0) {
        let hasTables = false;
        try {
            const r = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
            hasTables = r.rows.length > 0;
        } catch { /* empty */ }

        if (hasTables) {
            // Check for projects table (v2), files (v1)
            let legacy = 0;
            try { await db.execute('SELECT 1 FROM projects LIMIT 1'); legacy = 2; } catch { /* empty */ }
            if (legacy === 0) {
                try { await db.execute('SELECT 1 FROM files LIMIT 1'); legacy = 1; } catch { /* empty */ }
            }
            if (legacy > 0) {
                console.log(`[ScimaxDbCore] Detected legacy schema version ${legacy}`);
                currentVersion = legacy;
                for (const m of coreMigrations.filter(m2 => m2.version <= legacy)) {
                    try {
                        await db.execute({
                            sql: 'INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)',
                            args: [m.version, Date.now(), m.description]
                        });
                    } catch { /* empty */ }
                }
            }
        }
    }

    const pending = coreMigrations.filter(m => m.version > currentVersion);
    if (pending.length === 0) {
        return { applied: 0, currentVersion };
    }

    console.log(`[ScimaxDbCore] Applying ${pending.length} migration(s) from v${currentVersion}`);

    for (const migration of pending) {
        console.log(`[ScimaxDbCore] Applying migration v${migration.version}: ${migration.description}`);
        try {
            for (const sql of migration.up) {
                try {
                    await db.execute(sql);
                } catch (e: any) {
                    if (e.message?.includes('duplicate column name') || e.message?.includes('already exists')) {
                        continue;
                    }
                    throw e;
                }
            }
            await db.execute({
                sql: 'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)',
                args: [migration.version, Date.now(), migration.description]
            });
            currentVersion = migration.version;
            console.log(`[ScimaxDbCore] Migration v${migration.version} complete`);
        } catch (e) {
            console.error(`[ScimaxDbCore] Migration v${migration.version} failed:`, e);
            throw new Error(`Migration v${migration.version} failed: ${e}`);
        }
    }

    return { applied: pending.length, currentVersion };
}

// ============================================================
// ScimaxDbCore class
// ============================================================

export class ScimaxDbCore {
    protected db: Client | null = null;
    private parser: UnifiedParserAdapter;
    protected options: ScimaxDbCoreOptions;

    private searchScope: SearchScope = { type: 'all' };
    private embeddingService: CoreEmbeddingService | null = null;

    // Vector search support
    private vectorSearchSupported: boolean = false;
    private vectorSearchError: string | null = null;

    // Embedding dimensions
    private embeddingDimensions: number;

    // Async embedding queue
    private embeddingQueue: string[] = [];
    private isProcessingEmbeddings: boolean = false;
    private embeddingCancelled: boolean = false;

    // Resilience config
    private queryTimeoutMs: number;
    private maxRetryAttempts: number;

    // Write mutex
    private writeLock: Promise<void> = Promise.resolve();

    constructor(options: ScimaxDbCoreOptions) {
        this.options = options;
        this.parser = new UnifiedParserAdapter();
        this.embeddingDimensions = options.embeddingDimensions ?? 384;
        this.queryTimeoutMs = options.queryTimeoutMs ?? 30000;
        this.maxRetryAttempts = options.maxRetryAttempts ?? 3;
    }

    // ----------------------------------------------------------
    // Initialization
    // ----------------------------------------------------------

    public async initialize(): Promise<void> {
        const dir = path.dirname(this.options.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = createClient({ url: `file:${this.options.dbPath}` });

        await this.db.execute('PRAGMA journal_mode = WAL');
        await this.db.execute('PRAGMA busy_timeout = 30000');

        await this.createSchema();

        console.log('[ScimaxDbCore] Initialized');
    }

    private async createSchema(): Promise<void> {
        if (!this.db) return;

        const result = await runCoreMigrations(this.db);
        if (result.applied > 0) {
            console.log(`[ScimaxDbCore] Applied ${result.applied} migration(s), now at v${result.currentVersion}`);
        }

        // Create chunks table with dynamic embedding dimensions
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

        await this.testVectorSupport();
    }

    private async testVectorSupport(): Promise<void> {
        if (!this.db) return;
        try {
            await this.db.execute(`
                CREATE INDEX IF NOT EXISTS idx_chunks_embedding
                ON chunks(libsql_vector_idx(embedding, 'metric=cosine'))
            `);
            this.vectorSearchSupported = true;
            console.log('[ScimaxDbCore] Vector search is supported');
        } catch (e: any) {
            this.vectorSearchSupported = false;
            this.vectorSearchError = e?.message || 'Vector search not available';
            console.log('[ScimaxDbCore] Vector search not available - using FTS5 only');
        }
    }

    public async close(): Promise<void> {
        this.cancelEmbeddingQueue();
        this.embeddingQueue = [];
        this.isProcessingEmbeddings = false;
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    // ----------------------------------------------------------
    // Embedding service
    // ----------------------------------------------------------

    public setEmbeddingService(service: CoreEmbeddingService): void {
        this.embeddingService = service;
        this.embeddingDimensions = service.dimensions;
    }

    public isVectorSearchAvailable(): boolean {
        return this.vectorSearchSupported && this.embeddingService !== null;
    }

    public getVectorSearchStatus(): { supported: boolean; error: string | null; hasEmbeddings: boolean } {
        return {
            supported: this.vectorSearchSupported,
            error: this.vectorSearchError,
            hasEmbeddings: this.embeddingService !== null
        };
    }

    public setSearchScope(scope: SearchScope): void {
        this.searchScope = scope;
    }

    public getSearchScope(): SearchScope {
        return this.searchScope;
    }

    public setIgnorePatterns(patterns: string[]): void {
        this.options.ignorePatterns = patterns;
    }

    public setResilienceConfig(config: { queryTimeoutMs?: number; maxRetryAttempts?: number }): void {
        if (config.queryTimeoutMs !== undefined) this.queryTimeoutMs = config.queryTimeoutMs;
        if (config.maxRetryAttempts !== undefined) this.maxRetryAttempts = config.maxRetryAttempts;
    }

    /**
     * Get the underlying database client
     */
    public getClient(): Client | null {
        return this.db;
    }

    // ----------------------------------------------------------
    // Write lock
    // ----------------------------------------------------------

    protected async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
        const previousLock = this.writeLock;
        let releaseLock!: () => void;
        this.writeLock = new Promise<void>(resolve => { releaseLock = resolve; });
        try {
            await previousLock;
            return await fn();
        } finally {
            releaseLock();
        }
    }

    // ----------------------------------------------------------
    // Resilience helpers
    // ----------------------------------------------------------

    protected async executeResilient<T>(
        queryFn: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        if (!this.db) throw new Error('Database not initialized');
        return coreWithRetry(
            () => coreWithTimeout(queryFn, this.queryTimeoutMs, operationName),
            { maxAttempts: this.maxRetryAttempts, operationName, isRetryable: coreIsTransientError }
        );
    }

    protected async queryResilient(sql: string, args: any[] = [], operationName?: string): Promise<any> {
        return this.executeResilient(
            () => this.db!.execute({ sql, args }),
            operationName || sql.slice(0, 50)
        );
    }

    // ----------------------------------------------------------
    // Ignore patterns / file filtering
    // ----------------------------------------------------------

    private shouldIgnore(filePath: string): boolean {
        const patterns = this.options.ignorePatterns ?? [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.ipynb_checkpoints/**'
        ];
        for (const pattern of patterns) {
            let expandedPattern = pattern;
            if (pattern.startsWith('~')) {
                expandedPattern = pattern.replace(/^~/, process.env.HOME || '');
            }
            if (pattern.includes('*')) {
                if (minimatch(filePath, expandedPattern, { matchBase: true })) return true;
            } else {
                if (filePath === expandedPattern) return true;
            }
        }
        return false;
    }

    // ----------------------------------------------------------
    // File discovery
    // ----------------------------------------------------------

    public async *findFilesGenerator(directory: string): AsyncGenerator<string, void, undefined> {
        const stack: string[] = [directory];
        let directoriesProcessed = 0;
        let itemsProcessed = 0;

        while (stack.length > 0) {
            const dir = stack.pop()!;
            try {
                const items = await fs.promises.readdir(dir, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path.join(dir, item.name);
                    itemsProcessed++;
                    if (itemsProcessed % 50 === 0) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                    if (this.shouldIgnore(fullPath)) continue;
                    if (item.isDirectory() && !item.name.startsWith('.')) {
                        stack.push(fullPath);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        if (ext === '.org' || ext === '.md') yield fullPath;
                    }
                }
                directoriesProcessed++;
                if (directoriesProcessed % 5 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            } catch (error: any) {
                if (error?.code !== 'EACCES' && error?.code !== 'ENOENT') {
                    console.error(`[ScimaxDbCore] Error walking directory ${dir}:`, error?.message);
                }
            }
        }
    }

    public async collectFilePaths(
        directory: string,
        onProgress?: (count: number) => void
    ): Promise<string[]> {
        const filePaths: string[] = [];
        let count = 0;
        for await (const filePath of this.findFilesGenerator(directory)) {
            filePaths.push(filePath);
            count++;
            if (count % 100 === 0) {
                onProgress?.(count);
                await new Promise(r => setTimeout(r, 0));
            }
        }
        return filePaths;
    }

    // ----------------------------------------------------------
    // Reindex checks
    // ----------------------------------------------------------

    public async needsReindex(filePath: string): Promise<boolean> {
        if (!this.db) return true;
        const result = await this.db.execute({
            sql: 'SELECT mtime FROM files WHERE path = ?',
            args: [filePath]
        });
        if (result.rows.length === 0) return true;
        try {
            const stats = await fs.promises.stat(filePath);
            return stats.mtimeMs > (result.rows[0].mtime as number);
        } catch {
            return true;
        }
    }

    // ----------------------------------------------------------
    // Content detection
    // ----------------------------------------------------------

    private isBinaryContent(content: string): boolean {
        const sample = content.slice(0, 8192);
        if (sample.includes('\0')) return true;
        let nonPrintable = 0;
        for (let i = 0; i < sample.length; i++) {
            const code = sample.charCodeAt(i);
            if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
                nonPrintable++;
            }
        }
        return nonPrintable / sample.length > 0.1;
    }

    private getFileType(filePath: string): 'org' | 'md' {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.md') return 'md';
        return 'org';
    }

    // ----------------------------------------------------------
    // Index file
    // ----------------------------------------------------------

    public async indexFile(filePath: string, options?: { queueEmbeddings?: boolean }): Promise<void> {
        if (!this.db) return;

        try {
            console.debug(`[ScimaxDbCore] INDEX_START ${filePath}`);

            const stats = await fs.promises.stat(filePath);

            const maxSizeBytes = (this.options.maxFileSizeMB ?? 10) * 1024 * 1024;
            if (stats.size > maxSizeBytes) {
                console.warn(`[ScimaxDbCore] Skipping large file: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
                return;
            }

            const maxParseSizeKB = this.options.maxParseSizeKB ?? 500;
            if (stats.size > maxParseSizeKB * 1024) {
                console.warn(`[ScimaxDbCore] Skipping file too large for parsing: ${filePath}`);
                return;
            }

            const maxLines = this.options.maxFileLines ?? 5000;
            const estimatedLines = Math.ceil(stats.size / 80);
            if (estimatedLines > maxLines * 1.1) {
                console.warn(`[ScimaxDbCore] Skipping file with estimated too many lines: ${filePath}`);
                return;
            }

            const content = await fs.promises.readFile(filePath, 'utf8');
            const lineCount = content.split('\n').length;
            if (lineCount > maxLines) {
                console.warn(`[ScimaxDbCore] Skipping file with too many lines: ${filePath} (${lineCount})`);
                return;
            }

            const knownTextExt = ['.org', '.md', '.txt'];
            const ext = path.extname(filePath).toLowerCase();
            if (!knownTextExt.includes(ext) && this.isBinaryContent(content)) {
                console.warn(`[ScimaxDbCore] Skipping binary file: ${filePath}`);
                return;
            }

            const fileType = this.getFileType(filePath);
            const hash = crypto.createHash('md5').update(content).digest('hex');

            let parsedDoc: LegacyDocument | null = null;
            if (fileType === 'org') {
                parsedDoc = this.parser.parse(content);
            }

            const hashtags = extractHashtags(content);
            let contentForDb: string | null = content;

            await this.withWriteLock(async () => {
                // Remove old data
                await coreWithRetry(
                    () => this.db!.batch([
                        { sql: 'DELETE FROM headings WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM source_blocks WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM links WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM hashtags WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM chunks WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM fts_content WHERE file_path = ?', args: [filePath] },
                        { sql: 'DELETE FROM files WHERE path = ?', args: [filePath] }
                    ]),
                    { maxAttempts: 5, baseDelayMs: 100, operationName: 'indexFile-removeOld', isRetryable: coreIsTransientError }
                );

                // Insert file record
                const fileResult = await this.db!.execute({
                    sql: `INSERT INTO files (path, file_type, mtime, hash, size, indexed_at, keywords)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    args: [filePath, fileType, stats.mtimeMs, hash, stats.size, Date.now(), '{}']
                });

                const fileId = Number(fileResult.lastInsertRowid);

                if (fileType === 'org' && parsedDoc) {
                    await this.indexOrgDocument(fileId, filePath, parsedDoc, contentForDb!);
                    parsedDoc = null;
                } else if (fileType === 'md') {
                    await this.indexMarkdownDocument(fileId, filePath, contentForDb!);
                }

                // Index hashtags and FTS5
                const finalStatements: { sql: string; args: (string | number | null)[] }[] = [];
                for (const tag of hashtags) {
                    finalStatements.push({
                        sql: 'INSERT OR IGNORE INTO hashtags (tag, file_path) VALUES (?, ?)',
                        args: [tag.toLowerCase(), filePath]
                    });
                }
                const ftsContent = contentForDb!.length > 100000
                    ? contentForDb!.slice(0, 100000) + '\n[content truncated for FTS]'
                    : contentForDb!;
                finalStatements.push({
                    sql: 'INSERT INTO fts_content (file_path, title, content) VALUES (?, ?, ?)',
                    args: [filePath, path.basename(filePath), ftsContent]
                });
                if (finalStatements.length > 0) {
                    await this.db!.batch(finalStatements);
                }

                // Handle embeddings
                if (this.embeddingService) {
                    if (options?.queueEmbeddings) {
                        this.queueEmbeddings(filePath);
                    } else {
                        await this.createChunks(fileId, filePath, contentForDb!);
                    }
                }

                // Call optional adapter hook (VS Code extension uses this for indexerRegistry)
                if (this.options.onFileIndexed) {
                    try {
                        await this.options.onFileIndexed(filePath, fileId, fileType, stats.mtimeMs, this.db!);
                    } catch (adapterError) {
                        console.warn(`[ScimaxDbCore] onFileIndexed hook failed for ${filePath}:`, (adapterError as Error).message);
                    }
                }
            });

            contentForDb = null;
            console.debug(`[ScimaxDbCore] INDEX_COMPLETE ${filePath}`);

        } catch (error) {
            console.error(`[ScimaxDbCore] Failed to index file: ${filePath}`, error);
        }
    }

    // ----------------------------------------------------------
    // Internal indexing helpers
    // ----------------------------------------------------------

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

        const statements: { sql: string; args: (string | number | null)[] }[] = [];

        const flatHeadings = this.parser.flattenHeadings(doc);
        const tagStack: string[][] = [];

        for (const heading of flatHeadings) {
            while (tagStack.length >= heading.level) tagStack.pop();
            const inheritedTags = tagStack.flat();
            tagStack.push(heading.tags);

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

        for (const block of doc.sourceBlocks) {
            statements.push({
                sql: `INSERT INTO source_blocks
                      (file_id, file_path, language, content, line_number, headers, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                args: [fileId, filePath, block.language, block.content, block.lineNumber, JSON.stringify(block.headers)]
            });
        }

        const BATCH_SIZE = 50;
        for (let i = 0; i < statements.length; i += BATCH_SIZE) {
            await this.db.batch(statements.slice(i, i + BATCH_SIZE));
        }
        statements.length = 0;

        if (doc.links.length > 0) {
            await this.indexLinks(fileId, filePath, doc.links);
        }
    }

    private async indexLinks(
        fileId: number,
        filePath: string,
        links: { type: string; target: string; description?: string; lineNumber: number }[]
    ): Promise<void> {
        if (!this.db || links.length === 0) return;

        const headingsResult = await this.db.execute({
            sql: 'SELECT id, line_number FROM headings WHERE file_path = ? ORDER BY line_number',
            args: [filePath]
        });
        const headings = headingsResult.rows.map(row => ({
            id: row.id as number,
            lineNumber: row.line_number as number
        }));

        const linkStatements: { sql: string; args: (string | number | null)[] }[] = [];
        const fileDir = path.dirname(filePath);

        for (const link of links) {
            const headingId = this.findContainingHeadingId(link.lineNumber, headings);
            let resolvedTarget = link.target;
            if (link.type === 'internal' || link.type === 'file') {
                let targetPath = link.target;
                if (targetPath.startsWith('file:')) targetPath = targetPath.slice(5);
                const searchIdx = targetPath.indexOf('::');
                const searchSuffix = searchIdx >= 0 ? targetPath.slice(searchIdx) : '';
                if (searchIdx >= 0) targetPath = targetPath.slice(0, searchIdx);
                if (!path.isAbsolute(targetPath)) {
                    resolvedTarget = path.resolve(fileDir, targetPath) + searchSuffix;
                } else {
                    resolvedTarget = targetPath + searchSuffix;
                }
            }

            linkStatements.push({
                sql: `INSERT INTO links
                      (file_id, file_path, link_type, target, description, line_number, heading_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [fileId, filePath, link.type, resolvedTarget, link.description || null, link.lineNumber, headingId]
            });
        }

        const BATCH_SIZE = 50;
        for (let i = 0; i < linkStatements.length; i += BATCH_SIZE) {
            await this.db.batch(linkStatements.slice(i, i + BATCH_SIZE));
        }
    }

    private findContainingHeadingId(
        targetLine: number,
        headings: { id: number; lineNumber: number }[]
    ): number | null {
        if (headings.length === 0) return null;
        let left = 0, right = headings.length - 1, result: number | null = null;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (headings[mid].lineNumber <= targetLine) {
                result = headings[mid].id;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        return result;
    }

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
                    args: [fileId, filePath, level, title.trim(), lineNumber, charPos, todoState, JSON.stringify(tags)]
                });
            }
            charPos += line.length + 1;
        }

        const blocks = parseMarkdownCodeBlocks(content);
        for (const block of blocks) {
            statements.push({
                sql: `INSERT INTO source_blocks
                      (file_id, file_path, language, content, line_number, headers, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                args: [fileId, filePath, block.language, block.content, block.lineNumber, JSON.stringify(block.headers)]
            });
        }

        if (statements.length > 0) {
            await this.db.batch(statements);
        }
    }

    // ----------------------------------------------------------
    // Embeddings / chunks
    // ----------------------------------------------------------

    private async createChunks(fileId: number, filePath: string, content: string): Promise<void> {
        if (!this.db || !this.embeddingService || !this.vectorSearchSupported) return;

        const lines = content.split('\n');
        const chunkSize = 1000;
        const chunks: { text: string; lineStart: number; lineEnd: number }[] = [];
        let currentChunk = '';
        let currentLineStart = 1;
        let charCount = 0;

        for (let i = 0; i < lines.length; i++) {
            currentChunk += lines[i] + '\n';
            charCount += lines[i].length + 1;
            if (charCount >= chunkSize) {
                chunks.push({ text: currentChunk.trim(), lineStart: currentLineStart, lineEnd: i + 1 });
                const overlapLines = currentChunk.split('\n').slice(-3);
                currentChunk = overlapLines.join('\n');
                currentLineStart = Math.max(1, i - 2);
                charCount = currentChunk.length;
            }
        }
        if (currentChunk.trim()) {
            chunks.push({ text: currentChunk.trim(), lineStart: currentLineStart, lineEnd: lines.length });
        }

        try {
            const embeddings = await this.embeddingService.embedBatch(chunks.map(c => c.text));
            for (let i = 0; i < chunks.length; i++) {
                const vectorStr = `[${embeddings[i].join(',')}]`;
                await this.db.execute({
                    sql: `INSERT INTO chunks
                          (file_id, file_path, content, line_start, line_end, embedding)
                          VALUES (?, ?, ?, ?, ?, vector32(?))`,
                    args: [fileId, filePath, chunks[i].text, chunks[i].lineStart, chunks[i].lineEnd, vectorStr]
                });
            }
        } catch (error: any) {
            console.error(`[ScimaxDbCore] Failed to create embeddings for ${filePath}:`, error);
        }
    }

    public queueEmbeddings(filePath: string): void {
        if (!this.embeddingService || !this.vectorSearchSupported) return;
        if (!this.embeddingQueue.includes(filePath)) {
            this.embeddingQueue.push(filePath);
        }
        if (!this.isProcessingEmbeddings) {
            this.processEmbeddingQueueCore().catch(error => {
                console.error('[ScimaxDbCore] Embedding queue processing failed:', error);
            });
        }
    }

    /** Core embedding queue processor - no status bar (VS Code wrapper overrides for UI) */
    protected async processEmbeddingQueueCore(): Promise<void> {
        if (this.isProcessingEmbeddings || !this.embeddingService || !this.db) return;
        if (this.embeddingQueue.length === 0) return;

        this.isProcessingEmbeddings = true;
        this.embeddingCancelled = false;

        try {
            while (this.embeddingQueue.length > 0 && !this.embeddingCancelled) {
                const filePath = this.embeddingQueue.shift()!;
                try {
                    if (!fs.existsSync(filePath)) continue;
                    const fileRecord = await this.getFileByPath(filePath);
                    if (!fileRecord) continue;
                    const content = fs.readFileSync(filePath, 'utf8');
                    await this.db.execute({ sql: 'DELETE FROM chunks WHERE file_path = ?', args: [filePath] });
                    await this.createChunks(fileRecord.id, filePath, content);
                } catch (error) {
                    console.error(`[ScimaxDbCore] Failed to generate embeddings for ${filePath}:`, error);
                }
                const delayMs = this.embeddingQueue.length > 100 ? 500 : 200;
                await new Promise(r => setTimeout(r, delayMs));
            }
        } finally {
            this.isProcessingEmbeddings = false;
        }
    }

    public getEmbeddingQueueLength(): number {
        return this.embeddingQueue.length;
    }

    public cancelEmbeddingQueue(): void {
        this.embeddingCancelled = true;
        this.embeddingQueue = [];
    }

    private async getFileByPath(filePath: string): Promise<FileRecord | null> {
        if (!this.db) return null;
        const result = await this.db.execute({ sql: 'SELECT * FROM files WHERE path = ?', args: [filePath] });
        return result.rows[0] as unknown as FileRecord | null;
    }

    // ----------------------------------------------------------
    // Remove / cleanup
    // ----------------------------------------------------------

    public async removeFile(filePath: string): Promise<void> {
        await this.removeFileData(filePath);
    }

    public async removeFilesByPattern(pattern: string): Promise<number> {
        if (!this.db) return 0;
        const result = await this.db.execute({
            sql: 'SELECT COUNT(*) as cnt FROM files WHERE path LIKE ?',
            args: [pattern]
        });
        const count = Number(result.rows[0]?.cnt ?? 0);
        if (count === 0) return 0;
        await this.withWriteLock(async () => {
            await coreWithRetry(
                () => this.db!.batch([
                    { sql: 'DELETE FROM headings WHERE file_path LIKE ?', args: [pattern] },
                    { sql: 'DELETE FROM source_blocks WHERE file_path LIKE ?', args: [pattern] },
                    { sql: 'DELETE FROM links WHERE file_path LIKE ?', args: [pattern] },
                    { sql: 'DELETE FROM hashtags WHERE file_path LIKE ?', args: [pattern] },
                    { sql: 'DELETE FROM chunks WHERE file_path LIKE ?', args: [pattern] },
                    { sql: 'DELETE FROM fts_content WHERE file_path LIKE ?', args: [pattern] },
                    { sql: 'DELETE FROM files WHERE path LIKE ?', args: [pattern] }
                ]),
                { maxAttempts: 5, baseDelayMs: 100, operationName: 'removeFilesByPattern', isRetryable: coreIsTransientError }
            );
        });
        return count;
    }

    protected async removeFileData(filePath: string): Promise<void> {
        if (!this.db) return;
        await this.withWriteLock(async () => {
            await coreWithRetry(
                () => this.db!.batch([
                    { sql: 'DELETE FROM headings WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM source_blocks WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM links WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM hashtags WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM chunks WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM fts_content WHERE file_path = ?', args: [filePath] },
                    { sql: 'DELETE FROM files WHERE path = ?', args: [filePath] }
                ]),
                { maxAttempts: 5, baseDelayMs: 100, operationName: 'removeFileData', isRetryable: coreIsTransientError }
            );
        });
    }

    public async removeDeletedFiles(
        onProgress?: (status: { checked: number; total: number; deleted: number }) => void
    ): Promise<{ checked: number; deleted: number }> {
        const result = { checked: 0, deleted: 0 };
        if (!this.db) return result;

        const countResult = await this.db.execute('SELECT COUNT(*) as count FROM files');
        const total = Number((countResult.rows[0] as any).count);
        if (total === 0) return result;

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
            await new Promise(r => setTimeout(r, 10));
        }
        return result;
    }

    // ----------------------------------------------------------
    // Freshness checks
    // ----------------------------------------------------------

    public async validateFreshness(filePaths: string[]): Promise<string[]> {
        if (!this.db || filePaths.length === 0) return [];
        const stale: string[] = [];
        const placeholders = filePaths.map(() => '?').join(',');
        const result = await this.db.execute({
            sql: `SELECT path, mtime FROM files WHERE path IN (${placeholders})`,
            args: filePaths
        });
        const dbMtimes = new Map<string, number>();
        for (const row of result.rows) {
            dbMtimes.set(row.path as string, row.mtime as number);
        }
        for (const filePath of filePaths) {
            try {
                if (!fs.existsSync(filePath)) { stale.push(filePath); continue; }
                const stat = fs.statSync(filePath);
                const dbMtime = dbMtimes.get(filePath);
                if (dbMtime === undefined || stat.mtimeMs > dbMtime) stale.push(filePath);
            } catch {
                stale.push(filePath);
            }
        }
        return stale;
    }

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
                    await this.removeFileData(filePath);
                }
            } catch (error) {
                console.error(`[ScimaxDbCore] Error reindexing file ${filePath}:`, error);
            }
            options?.onProgress?.(i + 1, filePaths.length);
        }
        return indexed;
    }

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
            maxReindex = 0,
            onProgress,
            cancellationToken
        } = options;
        const result = { checked: 0, stale: 0, deleted: 0, reindexed: 0 };
        if (!this.db) return result;

        const countResult = await this.db.execute('SELECT COUNT(*) as count FROM files');
        const total = Number((countResult.rows[0] as any).count);
        if (total === 0) return result;

        const pageSize = 100;
        let offset = 0;
        while (offset < total) {
            if (cancellationToken?.cancelled) break;
            if (maxReindex > 0 && result.reindexed >= maxReindex) break;

            const pageResult = await this.db.execute({
                sql: 'SELECT * FROM files ORDER BY path LIMIT ? OFFSET ?',
                args: [pageSize, offset]
            });
            const files = pageResult.rows as unknown as FileRecord[];
            if (files.length === 0) break;

            for (let i = 0; i < files.length; i++) {
                if (cancellationToken?.cancelled) break;
                if (maxReindex > 0 && result.reindexed >= maxReindex) break;
                const file = files[i];
                result.checked++;
                try {
                    if (!fs.existsSync(file.path)) {
                        await this.removeFileData(file.path);
                        result.deleted++;
                        continue;
                    }
                    const stats = fs.statSync(file.path);
                    if (stats.mtimeMs > file.mtime) {
                        result.stale++;
                        await this.indexFile(file.path, { queueEmbeddings: true });
                        result.reindexed++;
                        await new Promise(r => setTimeout(r, 100));
                    }
                } catch (error) {
                    console.error(`[ScimaxDbCore] Error checking file staleness: ${file.path}`, error);
                }
                if (i > 0 && i % batchSize === 0) {
                    await new Promise(r => setTimeout(r, yieldMs));
                }
            }
            onProgress?.({ checked: result.checked, total, reindexed: result.reindexed });
            offset += pageSize;
            await new Promise(r => setTimeout(r, yieldMs));
        }
        return result;
    }

    // ----------------------------------------------------------
    // Scope clause
    // ----------------------------------------------------------

    private getScopeClause(pathColumn: string = 'file_path'): { sql: string; args: any[] } {
        if (this.searchScope.type === 'directory' && this.searchScope.path) {
            return { sql: ` AND ${pathColumn} LIKE ?`, args: [`${this.searchScope.path}%`] };
        }
        return { sql: '', args: [] };
    }

    // ----------------------------------------------------------
    // Search / query methods
    // ----------------------------------------------------------

    public async searchFullText(query: string, options?: { limit?: number }): Promise<SearchResult[]> {
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

    public async searchSemantic(query: string, options?: { limit?: number }): Promise<SearchResult[]> {
        if (!this.db || !this.embeddingService || !this.vectorSearchSupported) return [];
        try {
            const limit = options?.limit || 20;
            const queryEmbedding = await this.embeddingService.embed(query);
            const scope = this.getScopeClause('c.file_path');
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
            console.error('[ScimaxDbCore] Semantic search failed:', error);
            return [];
        }
    }

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
            scoreMap.set(key, { result, rrf: ftsWeight / (idx + 1) });
        });
        vectorResults.forEach((result, idx) => {
            const key = `${result.file_path}:${result.line_number}`;
            const rrf = vectorWeight / (idx + 1);
            const existing = scoreMap.get(key);
            if (existing) { existing.rrf += rrf; } else { scoreMap.set(key, { result, rrf }); }
        });
        return Array.from(scoreMap.values())
            .sort((a, b) => b.rrf - a.rrf)
            .slice(0, limit)
            .map(item => ({ ...item.result, score: item.rrf }));
    }

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
        if (query) { sql += ' AND title LIKE ?'; args.push(`%${query}%`); }
        if (options?.todoState) { sql += ' AND todo_state = ?'; args.push(options.todoState); }
        if (options?.tag) { sql += ' AND (tags LIKE ? OR inherited_tags LIKE ?)'; args.push(`%"${options.tag}"%`, `%"${options.tag}"%`); }
        sql += ' ORDER BY file_path, line_number LIMIT ?';
        args.push(limit);
        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as HeadingRecord[];
    }

    public async searchByProperty(propertyName: string, value?: string): Promise<HeadingRecord[]> {
        if (!this.db) return [];
        const scope = this.getScopeClause();
        const sql = `SELECT * FROM headings WHERE properties LIKE ?${scope.sql}`;
        const args: any[] = value
            ? [`%"${propertyName}":"${value}%`, ...scope.args]
            : [`%"${propertyName}"%`, ...scope.args];
        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as HeadingRecord[];
    }

    public async searchSourceBlocks(language?: string, query?: string): Promise<SourceBlockRecord[]> {
        if (!this.db) return [];
        const scope = this.getScopeClause();
        let sql = `SELECT * FROM source_blocks WHERE 1=1${scope.sql}`;
        const args: any[] = [...scope.args];
        if (language) { sql += ' AND language = ?'; args.push(language.toLowerCase()); }
        if (query) { sql += ' AND content LIKE ?'; args.push(`%${query}%`); }
        sql += ' LIMIT 100';
        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as SourceBlockRecord[];
    }

    public async getAgenda(options?: {
        before?: string;
        includeUnscheduled?: boolean;
        requireTodoState?: boolean;
        doneStates?: string[];
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
        const requireTodo = options?.requireTodoState ?? true;
        const doneStates = options?.doneStates ?? ['DONE', 'CANCELLED'];
        const doneList = doneStates.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
        const todoStateCondition = requireTodo
            ? `AND todo_state IS NOT NULL AND todo_state NOT IN (${doneList})`
            : `AND (todo_state IS NULL OR todo_state NOT IN (${doneList}))`;

        const deadlines = await this.db.execute({
            sql: `SELECT * FROM headings WHERE deadline IS NOT NULL ${todoStateCondition} ${scope.sql}`,
            args: scope.args
        });
        for (const row of deadlines.rows) {
            const heading = row as unknown as HeadingRecord;
            const deadlineDate = parseDate(heading.deadline!.split(' ')[0], 'yyyy-MM-dd', new Date());
            const daysUntil = Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (!beforeDate || deadlineDate <= beforeDate) {
                items.push({ type: 'deadline', heading, date: heading.deadline!, days_until: daysUntil, overdue: daysUntil < 0 });
            }
        }

        const scheduled = await this.db.execute({
            sql: `SELECT * FROM headings WHERE scheduled IS NOT NULL ${todoStateCondition} ${scope.sql}`,
            args: scope.args
        });
        for (const row of scheduled.rows) {
            const heading = row as unknown as HeadingRecord;
            const scheduledDate = parseDate(heading.scheduled!.split(' ')[0], 'yyyy-MM-dd', new Date());
            const daysUntil = Math.floor((scheduledDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (!beforeDate || scheduledDate <= beforeDate) {
                items.push({ type: 'scheduled', heading, date: heading.scheduled!, days_until: daysUntil, overdue: daysUntil < 0 });
            }
        }

        if (options?.includeUnscheduled) {
            const todos = await this.db.execute({
                sql: `SELECT * FROM headings WHERE todo_state IS NOT NULL AND todo_state NOT IN ('DONE', 'CANCELLED') AND deadline IS NULL AND scheduled IS NULL ${scope.sql}`,
                args: scope.args
            });
            for (const row of todos.rows) {
                items.push({ type: 'todo', heading: row as unknown as HeadingRecord });
            }
        }

        items.sort((a, b) => {
            if (a.overdue && !b.overdue) return -1;
            if (!a.overdue && b.overdue) return 1;
            if (a.days_until !== undefined && b.days_until !== undefined) return a.days_until - b.days_until;
            return 0;
        });

        return items;
    }

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

    public async getTodos(state?: string): Promise<HeadingRecord[]> {
        if (!this.db) return [];
        const scope = this.getScopeClause();
        let sql = `SELECT * FROM headings WHERE todo_state IS NOT NULL${scope.sql}`;
        const args: any[] = [...scope.args];
        if (state) { sql += ' AND todo_state = ?'; args.push(state); }
        const result = await this.db.execute({ sql, args });
        return result.rows as unknown as HeadingRecord[];
    }

    public async getAllTags(): Promise<string[]> {
        if (!this.db) return [];
        const result = await this.db.execute('SELECT DISTINCT tag FROM hashtags ORDER BY tag');
        return result.rows.map(r => r.tag as string);
    }

    public async getAllTodoStates(): Promise<string[]> {
        if (!this.db) return [];
        const result = await this.db.execute('SELECT DISTINCT todo_state FROM headings WHERE todo_state IS NOT NULL ORDER BY todo_state');
        return result.rows.map(r => r.todo_state as string);
    }

    public async getAllLanguages(): Promise<string[]> {
        if (!this.db) return [];
        const result = await this.db.execute('SELECT DISTINCT language FROM source_blocks ORDER BY language');
        return result.rows.map(r => r.language as string);
    }

    public async getAllHashtags(): Promise<string[]> {
        if (!this.db) return [];
        const result = await this.db.execute('SELECT DISTINCT tag FROM hashtags ORDER BY tag');
        return result.rows.map(r => r.tag as string);
    }

    public async findByHashtag(tag: string): Promise<string[]> {
        if (!this.db) return [];
        const result = await this.db.execute({
            sql: 'SELECT DISTINCT file_path FROM hashtags WHERE tag = ?',
            args: [tag.toLowerCase()]
        });
        return result.rows.map(r => r.file_path as string);
    }

    public async getFiles(): Promise<FileRecord[]> {
        if (!this.db) return [];
        const result = await this.db.execute('SELECT * FROM files ORDER BY indexed_at DESC');
        return result.rows as unknown as FileRecord[];
    }

    /**
     * Return files sorted by mtime (most recently modified first).
     */
    public async getRecentFiles(limit = 50): Promise<FileRecord[]> {
        if (!this.db) return [];
        const result = await this.db.execute({
            sql: `SELECT * FROM files
                  ORDER BY mtime DESC
                  LIMIT ?`,
            args: [limit]
        });
        return result.rows as unknown as FileRecord[];
    }

    public async getStats(): Promise<DbStats> {
        if (!this.db) return {
            files: 0, headings: 0, blocks: 0, chunks: 0,
            has_embeddings: false, vector_search_supported: false,
            vector_search_error: null, by_type: { org: 0, md: 0 }
        };

        const [files, headings, blocks, chunks, embeddings, orgFiles, mdFiles] = await this.executeResilient(
            () => Promise.all([
                this.db!.execute('SELECT COUNT(*) as count FROM files'),
                this.db!.execute('SELECT COUNT(*) as count FROM headings'),
                this.db!.execute('SELECT COUNT(*) as count FROM source_blocks'),
                this.db!.execute('SELECT COUNT(*) as count FROM chunks'),
                this.db!.execute('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL'),
                this.db!.execute("SELECT COUNT(*) as count FROM files WHERE file_type = 'org'"),
                this.db!.execute("SELECT COUNT(*) as count FROM files WHERE file_type = 'md'")
            ]),
            'getStats'
        );

        const lastFile = await this.queryResilient('SELECT MAX(indexed_at) as last FROM files', [], 'getStats:lastFile');

        let databaseSize: number | undefined;
        try {
            const stat = await fs.promises.stat(this.options.dbPath);
            databaseSize = stat.size;
        } catch {
            databaseSize = undefined;
        }

        return {
            files: files.rows[0].count as number,
            headings: headings.rows[0].count as number,
            blocks: blocks.rows[0].count as number,
            chunks: chunks.rows[0].count as number,
            has_embeddings: (embeddings.rows[0].count as number) > 0,
            vector_search_supported: this.vectorSearchSupported,
            vector_search_error: this.vectorSearchError,
            last_indexed: lastFile.rows[0].last as number | undefined,
            by_type: {
                org: orgFiles.rows[0].count as number,
                md: mdFiles.rows[0].count as number
            },
            database_size: databaseSize
        };
    }

    public async getSchemaInfo(): Promise<{
        currentVersion: number;
        latestVersion: number;
        history: Array<{ version: number; applied_at: number; description: string }>;
    }> {
        if (!this.db) {
            return { currentVersion: 0, latestVersion: coreGetLatestVersion(), history: [] };
        }
        // Use inline migration runner for reading
        let currentVersion = 0;
        let history: Array<{ version: number; applied_at: number; description: string }> = [];
        try {
            const r = await this.db.execute('SELECT MAX(version) as version FROM schema_version');
            currentVersion = (r.rows[0]?.version as number) || 0;
        } catch { /* empty */ }
        try {
            const r = await this.db.execute('SELECT version, applied_at, description FROM schema_version ORDER BY version');
            history = r.rows.map(row => ({
                version: row.version as number,
                applied_at: row.applied_at as number,
                description: row.description as string
            }));
        } catch { /* empty */ }
        return { currentVersion, latestVersion: coreGetLatestVersion(), history };
    }

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

    public async optimize(): Promise<void> {
        if (!this.db) return;
        const files = await this.getFiles();
        for (const file of files) {
            if (!fs.existsSync(file.path)) await this.removeFileData(file.path);
        }
        await this.db.execute('VACUUM');
    }

    public async verify(): Promise<{
        ok: boolean;
        issues: string[];
        stats: { files: number; missingFiles: number; staleFiles: number; orphanedHeadings: number; orphanedBlocks: number };
    }> {
        if (!this.db) throw new Error('Database not initialized');
        const issues: string[] = [];
        const stats = { files: 0, missingFiles: 0, staleFiles: 0, orphanedHeadings: 0, orphanedBlocks: 0 };

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
                    if (stat.mtimeMs > mtime) { stats.staleFiles++; issues.push(`Stale file (needs reindex): ${filePath}`); }
                } catch (e) {
                    issues.push(`Cannot stat file: ${filePath}`);
                }
            }
        }

        const orphanedHeadingsResult = await this.db.execute(`SELECT COUNT(*) as count FROM headings h LEFT JOIN files f ON h.file_id = f.id WHERE f.id IS NULL`);
        stats.orphanedHeadings = orphanedHeadingsResult.rows[0].count as number;
        if (stats.orphanedHeadings > 0) issues.push(`${stats.orphanedHeadings} orphaned heading records`);

        const orphanedBlocksResult = await this.db.execute(`SELECT COUNT(*) as count FROM source_blocks sb LEFT JOIN files f ON sb.file_id = f.id WHERE f.id IS NULL`);
        stats.orphanedBlocks = orphanedBlocksResult.rows[0].count as number;
        if (stats.orphanedBlocks > 0) issues.push(`${stats.orphanedBlocks} orphaned source block records`);

        return { ok: issues.length === 0, issues, stats };
    }

    // ----------------------------------------------------------
    // Project management
    // ----------------------------------------------------------

    public async addProject(
        projectPath: string,
        name?: string,
        type: 'git' | 'projectile' | 'manual' = 'manual'
    ): Promise<ProjectRecord | null> {
        if (!this.db) return null;
        const normalizedPath = path.resolve(projectPath);
        const projectName = name || path.basename(normalizedPath);
        let projectType = type;
        if (type === 'manual') {
            if (fs.existsSync(path.join(normalizedPath, '.git'))) projectType = 'git';
            else if (fs.existsSync(path.join(normalizedPath, '.projectile'))) projectType = 'projectile';
        }
        try {
            await this.db.execute({
                sql: `INSERT OR REPLACE INTO projects (path, name, type, last_opened, created_at)
                      VALUES (?, ?, ?, ?, COALESCE(
                          (SELECT created_at FROM projects WHERE path = ?),
                          strftime('%s', 'now') * 1000
                      ))`,
                args: [normalizedPath, projectName, projectType, Date.now(), normalizedPath]
            });
            return await this.getProjectByPath(normalizedPath);
        } catch (error) {
            console.error(`[ScimaxDbCore] Failed to add project: ${projectPath}`, error);
            return null;
        }
    }

    public async getProjects(): Promise<ProjectRecord[]> {
        if (!this.db) return [];
        const result = await this.db.execute('SELECT * FROM projects ORDER BY last_opened DESC NULLS LAST, created_at DESC');
        return result.rows as unknown as ProjectRecord[];
    }

    public async getProjectByPath(projectPath: string): Promise<ProjectRecord | null> {
        if (!this.db) return null;
        const normalizedPath = path.resolve(projectPath);
        const result = await this.db.execute({ sql: 'SELECT * FROM projects WHERE path = ?', args: [normalizedPath] });
        return result.rows[0] as unknown as ProjectRecord | null;
    }

    public async removeProject(projectPath: string): Promise<void> {
        if (!this.db) return;
        const normalizedPath = path.resolve(projectPath);
        await this.withWriteLock(async () => {
            await this.db!.batch([
                { sql: 'UPDATE files SET project_id = NULL WHERE project_id = (SELECT id FROM projects WHERE path = ?)', args: [normalizedPath] },
                { sql: 'DELETE FROM projects WHERE path = ?', args: [normalizedPath] }
            ]);
        });
    }

    public async touchProject(projectPath: string): Promise<void> {
        if (!this.db) return;
        const normalizedPath = path.resolve(projectPath);
        await this.db.execute({ sql: 'UPDATE projects SET last_opened = ? WHERE path = ?', args: [Date.now(), normalizedPath] });
    }

    public async getProjectForFile(filePath: string): Promise<ProjectRecord | null> {
        if (!this.db) return null;
        const normalizedFilePath = path.resolve(filePath);
        const projects = await this.getProjects();
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

    public async getFilesInProject(projectId: number): Promise<FileRecord[]> {
        if (!this.db) return [];
        const result = await this.db.execute({ sql: 'SELECT * FROM files WHERE project_id = ? ORDER BY path', args: [projectId] });
        return result.rows as unknown as FileRecord[];
    }

    public async setFileProject(filePath: string, projectId: number | null): Promise<void> {
        if (!this.db) return;
        await this.db.execute({ sql: 'UPDATE files SET project_id = ? WHERE path = ?', args: [projectId, filePath] });
    }

    public async autoAssociateFilesWithProjects(): Promise<number> {
        if (!this.db) return 0;
        const files = await this.getFiles();
        const projects = await this.getProjects();
        let updated = 0;
        for (const file of files) {
            let bestMatch: ProjectRecord | null = null;
            let bestMatchLength = 0;
            for (const project of projects) {
                if (file.path.startsWith(project.path + path.sep) && project.path.length > bestMatchLength) {
                    bestMatch = project;
                    bestMatchLength = project.path.length;
                }
            }
            if (bestMatch) {
                await this.setFileProject(file.path, bestMatch.id);
                updated++;
            }
        }
        return updated;
    }

    public async scanForProjects(directory: string, maxDepth: number = 2): Promise<number> {
        if (!this.db) return 0;
        let found = 0;
        const scannedDirs = new Set<string>();
        const scan = async (dir: string, depth: number): Promise<void> => {
            if (depth > maxDepth || scannedDirs.has(dir)) return;
            scannedDirs.add(dir);
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                const hasGit = entries.some(e => e.isDirectory() && e.name === '.git');
                const hasProjectile = entries.some(e => e.isFile() && e.name === '.projectile');
                if (hasGit || hasProjectile) {
                    const t = hasGit ? 'git' : 'projectile';
                    const project = await this.addProject(dir, undefined, t);
                    if (project) { found++; return; }
                }
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    if (entry.name.startsWith('.')) continue;
                    if (['node_modules', 'dist', 'build', 'out', '__pycache__'].includes(entry.name)) continue;
                    await scan(path.join(dir, entry.name), depth + 1);
                }
            } catch { /* permission errors */ }
        };
        await scan(directory, 0);
        return found;
    }

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
}
