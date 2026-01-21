import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { createClient, Client } from '@libsql/client';
import {
    parseMarkdownCodeBlocks,
    extractHashtags,
    extractMentions
} from '../parser/orgParser';
import {
    UnifiedParserAdapter,
    LegacyDocument,
} from '../parser/orgParserAdapter';
import {
    parseNotebook,
    getNotebookFullText,
    NotebookDocument
} from '../parser/ipynbParser';
import type { EmbeddingService } from './embeddingService';

/**
 * Database record types
 */
export interface FileRecord {
    id: number;
    path: string;
    file_type: string;  // 'org' | 'md' | 'ipynb'
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
    by_type: { org: number; md: number; ipynb: number };
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

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.parser = new UnifiedParserAdapter();
        this.dbPath = path.join(context.globalStorageUri.fsPath, 'scimax-db.sqlite');
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

        await this.createSchema();
        this.loadIgnorePatterns();
        this.setupFileWatcher();

        console.log('ScimaxDb: Initialized');
    }

    /**
     * Create database schema with FTS5 and vector support
     */
    private async createSchema(): Promise<void> {
        if (!this.db) return;

        await this.db.batch([
            // Files table - now with file_type
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

            // Headings table - now with cell_index for notebooks
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

            // Source blocks table - now with cell_index for notebooks
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

            // Links table
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

            // Hashtags table
            `CREATE TABLE IF NOT EXISTS hashtags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag TEXT NOT NULL,
                file_path TEXT NOT NULL,
                UNIQUE(tag, file_path)
            )`,

            // Text chunks for semantic search (with vector column)
            `CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                content TEXT NOT NULL,
                line_start INTEGER NOT NULL,
                line_end INTEGER NOT NULL,
                embedding F32_BLOB(${this.embeddingDimensions}),
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )`,

            // FTS5 virtual table for full-text search
            `CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
                file_path,
                title,
                content,
                tokenize='porter unicode61'
            )`,

            // Indexes for performance
            `CREATE INDEX IF NOT EXISTS idx_headings_file ON headings(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_todo ON headings(todo_state)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_deadline ON headings(deadline)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_scheduled ON headings(scheduled)`,
            `CREATE INDEX IF NOT EXISTS idx_blocks_file ON source_blocks(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_blocks_language ON source_blocks(language)`,
            `CREATE INDEX IF NOT EXISTS idx_links_file ON links(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_hashtags_tag ON hashtags(tag)`,
            `CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type)`
        ]);

        // Test and create vector index if libsql supports it
        await this.testVectorSupport();
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
            console.log('ScimaxDb: Vector search is supported');
        } catch (e: any) {
            this.vectorSearchSupported = false;
            this.vectorSearchError = e?.message || 'Vector search not available';
            console.log('ScimaxDb: Vector search not available - using FTS5 only');
            console.log('ScimaxDb: Vector error:', this.vectorSearchError);
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
        // Watch org, md, and ipynb files
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{org,md,ipynb}',
            false, false, false
        );

        this.fileWatcher.onDidCreate(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidChange(uri => this.queueIndex(uri.fsPath));
        this.fileWatcher.onDidDelete(uri => this.removeFile(uri.fsPath));

        this.context.subscriptions.push(this.fileWatcher);
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
     * Check if file should be excluded (by absolute path or glob pattern)
     */
    private shouldIgnore(filePath: string): boolean {
        const { minimatch } = require('minimatch');
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
                    } catch (error) {
                        console.error(`ScimaxDb: Failed to index ${filePath}`, error);
                    }
                }
            }
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Index a directory recursively
     */
    public async indexDirectory(
        directory: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<number> {
        const files = await this.findFiles(directory);
        let indexed = 0;

        for (const filePath of files) {
            if (await this.needsReindex(filePath)) {
                await this.indexFile(filePath);
                indexed++;
            }

            if (progress) {
                progress.report({
                    message: `Indexing: ${path.basename(filePath)}`,
                    increment: 100 / files.length
                });
            }
        }

        return indexed;
    }

    /**
     * Find all indexable files in directory
     */
    private async findFiles(directory: string): Promise<string[]> {
        const files: string[] = [];

        const walk = (dir: string) => {
            try {
                const items = fs.readdirSync(dir, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path.join(dir, item.name);
                    if (this.shouldIgnore(fullPath)) continue;

                    if (item.isDirectory() && !item.name.startsWith('.')) {
                        walk(fullPath);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        if (ext === '.org' || ext === '.md' || ext === '.ipynb') {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                console.error(`ScimaxDb: Error walking ${dir}`, error);
            }
        };

        walk(directory);
        return files;
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
            const stats = fs.statSync(filePath);
            return stats.mtimeMs > (result.rows[0].mtime as number);
        } catch {
            return true;
        }
    }

    /**
     * Get file type from extension
     */
    private getFileType(filePath: string): 'org' | 'md' | 'ipynb' {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.org') return 'org';
        if (ext === '.md') return 'md';
        if (ext === '.ipynb') return 'ipynb';
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
            const content = fs.readFileSync(filePath, 'utf8');
            const stats = fs.statSync(filePath);
            const fileType = this.getFileType(filePath);
            const hash = crypto.createHash('md5').update(content).digest('hex');

            // Remove old data for this file
            await this.removeFileData(filePath);

            // Insert file record
            const fileResult = await this.db.execute({
                sql: `INSERT INTO files (path, file_type, mtime, hash, size, indexed_at, keywords)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [filePath, fileType, stats.mtimeMs, hash, stats.size, Date.now(), '{}']
            });

            const fileId = Number(fileResult.lastInsertRowid);

            // Parse and index content based on type
            let fullText = content;
            if (fileType === 'org') {
                const doc = this.parser.parse(content);
                await this.indexOrgDocument(fileId, filePath, doc, content);
            } else if (fileType === 'md') {
                await this.indexMarkdownDocument(fileId, filePath, content);
            } else if (fileType === 'ipynb') {
                const doc = parseNotebook(content);
                await this.indexNotebookDocument(fileId, filePath, doc);
                fullText = getNotebookFullText(doc);
            }

            // Extract and index hashtags
            const hashtags = extractHashtags(fullText);
            for (const tag of hashtags) {
                await this.db.execute({
                    sql: 'INSERT OR IGNORE INTO hashtags (tag, file_path) VALUES (?, ?)',
                    args: [tag.toLowerCase(), filePath]
                });
            }

            // Index for FTS5
            await this.db.execute({
                sql: 'INSERT INTO fts_content (file_path, title, content) VALUES (?, ?, ?)',
                args: [filePath, path.basename(filePath), fullText]
            });

            // Handle embeddings for semantic search
            if (this.embeddingService) {
                if (options?.queueEmbeddings) {
                    // Queue for async processing to avoid OOM during background sync
                    this.queueEmbeddings(filePath);
                } else {
                    // Generate immediately (manual reindex)
                    await this.createChunks(fileId, filePath, fullText);
                }
            }

        } catch (error) {
            console.error(`ScimaxDb: Failed to index ${filePath}`, error);
        }
    }

    /**
     * Index org document
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

            await this.db.execute({
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
            await this.db.execute({
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
            await this.db.execute({
                sql: `INSERT INTO links
                      (file_id, file_path, link_type, target, description, line_number)
                      VALUES (?, ?, ?, ?, ?, ?)`,
                args: [
                    fileId, filePath, link.type, link.target,
                    link.description || null, link.lineNumber
                ]
            });
        }
    }

    /**
     * Index markdown document
     */
    private async indexMarkdownDocument(
        fileId: number,
        filePath: string,
        content: string
    ): Promise<void> {
        if (!this.db) return;

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

                await this.db.execute({
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
            await this.db.execute({
                sql: `INSERT INTO source_blocks
                      (file_id, file_path, language, content, line_number, headers, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                args: [fileId, filePath, block.language, block.content,
                       block.lineNumber, JSON.stringify(block.headers)]
            });
        }
    }

    /**
     * Index Jupyter notebook document
     */
    private async indexNotebookDocument(
        fileId: number,
        filePath: string,
        doc: NotebookDocument
    ): Promise<void> {
        if (!this.db) return;

        // Index headings from markdown cells
        for (const heading of doc.headings) {
            await this.db.execute({
                sql: `INSERT INTO headings
                      (file_id, file_path, level, title, line_number, begin_pos,
                       todo_state, tags, inherited_tags, properties, cell_index)
                      VALUES (?, ?, ?, ?, ?, 0, NULL, '[]', '[]', '{}', ?)`,
                args: [fileId, filePath, heading.level, heading.title,
                       heading.lineNumber, heading.cellIndex]
            });
        }

        // Index code cells as source blocks
        for (const block of doc.codeBlocks) {
            await this.db.execute({
                sql: `INSERT INTO source_blocks
                      (file_id, file_path, language, content, line_number, headers, cell_index)
                      VALUES (?, ?, ?, ?, ?, '{}', ?)`,
                args: [fileId, filePath, block.language, block.content,
                       block.lineNumber, block.cellIndex]
            });
        }

        // Index links
        for (const link of doc.links) {
            await this.db.execute({
                sql: `INSERT INTO links
                      (file_id, file_path, link_type, target, description, line_number)
                      VALUES (?, ?, ?, ?, ?, ?)`,
                args: [fileId, filePath, link.type, link.target,
                       link.description || null, link.lineNumber]
            });
        }

        // Index hashtags
        for (const tag of doc.hashtags) {
            await this.db.execute({
                sql: 'INSERT OR IGNORE INTO hashtags (tag, file_path) VALUES (?, ?)',
                args: [tag.toLowerCase(), filePath]
            });
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
            console.error('ScimaxDb: Failed to create embeddings for', filePath, error);
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
            this.processEmbeddingQueue();
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
                    console.error(`ScimaxDb: Failed to generate embeddings for ${filePath}:`, error);
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
            console.error('ScimaxDb: Embedding queue processing failed:', error);
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
        console.log('ScimaxDb: Embedding queue cancelled');
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

        await this.db.batch([
            { sql: 'DELETE FROM headings WHERE file_path = ?', args: [filePath] },
            { sql: 'DELETE FROM source_blocks WHERE file_path = ?', args: [filePath] },
            { sql: 'DELETE FROM links WHERE file_path = ?', args: [filePath] },
            { sql: 'DELETE FROM hashtags WHERE file_path = ?', args: [filePath] },
            { sql: 'DELETE FROM chunks WHERE file_path = ?', args: [filePath] },
            { sql: 'DELETE FROM fts_content WHERE file_path = ?', args: [filePath] },
            { sql: 'DELETE FROM files WHERE path = ?', args: [filePath] }
        ]);
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
            console.log('ScimaxDb: Semantic search unavailable - vector search not supported');
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
            console.error('ScimaxDb: Semantic search failed', error);
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

        // Get items with deadlines
        const deadlines = await this.db.execute({
            sql: `SELECT * FROM headings
                  WHERE deadline IS NOT NULL
                  AND (todo_state IS NULL OR todo_state NOT IN ('DONE', 'CANCELLED'))
                  ${scope.sql}`,
            args: scope.args
        });

        for (const row of deadlines.rows) {
            const heading = row as unknown as HeadingRecord;
            const deadlineDate = new Date(heading.deadline!.split(' ')[0]);
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
                  AND (todo_state IS NULL OR todo_state NOT IN ('DONE', 'CANCELLED'))
                  ${scope.sql}`,
            args: scope.args
        });

        for (const row of scheduled.rows) {
            const heading = row as unknown as HeadingRecord;
            const scheduledDate = new Date(heading.scheduled!.split(' ')[0]);
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
            vector_search_error: null, by_type: { org: 0, md: 0, ipynb: 0 }
        };

        const [files, headings, blocks, links, chunks, embeddings, orgFiles, mdFiles, ipynbFiles] = await Promise.all([
            this.db.execute('SELECT COUNT(*) as count FROM files'),
            this.db.execute('SELECT COUNT(*) as count FROM headings'),
            this.db.execute('SELECT COUNT(*) as count FROM source_blocks'),
            this.db.execute('SELECT COUNT(*) as count FROM links'),
            this.db.execute('SELECT COUNT(*) as count FROM chunks'),
            this.db.execute('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL'),
            this.db.execute("SELECT COUNT(*) as count FROM files WHERE file_type = 'org'"),
            this.db.execute("SELECT COUNT(*) as count FROM files WHERE file_type = 'md'"),
            this.db.execute("SELECT COUNT(*) as count FROM files WHERE file_type = 'ipynb'")
        ]);

        const lastFile = await this.db.execute(
            'SELECT MAX(indexed_at) as last FROM files'
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
                md: mdFiles.rows[0].count as number,
                ipynb: ipynbFiles.rows[0].count as number
            }
        };
    }

    /**
     * Clear database
     */
    public async clear(): Promise<void> {
        if (!this.db) return;

        await this.db.batch([
            'DELETE FROM chunks',
            'DELETE FROM fts_content',
            'DELETE FROM hashtags',
            'DELETE FROM links',
            'DELETE FROM source_blocks',
            'DELETE FROM headings',
            'DELETE FROM files'
        ]);
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
            maxReindex = 50,  // Limit reindexing to avoid OOM
            onProgress,
            cancellationToken
        } = options;

        const result = { checked: 0, stale: 0, deleted: 0, reindexed: 0 };

        if (!this.db) return result;

        // Get total count first (lightweight query)
        const countResult = await this.db.execute('SELECT COUNT(*) as count FROM files');
        const total = Number((countResult.rows[0] as any).count);

        if (total === 0) return result;

        console.log(`ScimaxDb: Checking ${total} files for staleness (max ${maxReindex} reindex)...`);

        // Process files in pages to avoid loading all into memory
        const pageSize = 100;
        let offset = 0;

        while (offset < total) {
            // Check for cancellation
            if (cancellationToken?.cancelled) {
                console.log('ScimaxDb: Stale check cancelled');
                break;
            }

            // Check if we've hit the reindex limit
            if (result.reindexed >= maxReindex) {
                console.log(`ScimaxDb: Reached max reindex limit (${maxReindex}), stopping`);
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

                // Check reindex limit
                if (result.reindexed >= maxReindex) break;

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
                    console.error(`ScimaxDb: Error checking ${file.path}:`, error);
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

        console.log(`ScimaxDb: Stale check complete - ${result.stale} stale, ${result.deleted} deleted, ${result.reindexed} reindexed`);
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
            maxIndex = 50,  // Limit new files indexed to avoid OOM
            onProgress,
            cancellationToken
        } = options;

        const result = { scanned: 0, newFiles: 0, changed: 0, indexed: 0 };

        if (!this.db || directories.length === 0) return result;

        console.log(`ScimaxDb: Scanning ${directories.length} directories (max ${maxIndex} new files)...`);

        // Process directories one at a time to avoid loading all files into memory
        for (const dir of directories) {
            if (cancellationToken?.cancelled) break;
            if (result.indexed >= maxIndex) {
                console.log(`ScimaxDb: Reached max index limit (${maxIndex}), stopping`);
                break;
            }

            try {
                if (!fs.existsSync(dir)) {
                    console.warn(`ScimaxDb: Directory does not exist: ${dir}`);
                    continue;
                }

                onProgress?.({ scanned: result.scanned, total: 0, indexed: result.indexed, currentDir: dir });
                const files = await this.findFiles(dir);

                for (let i = 0; i < files.length; i++) {
                    if (cancellationToken?.cancelled) break;
                    if (result.indexed >= maxIndex) break;

                    const filePath = files[i];
                    result.scanned++;

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
                        console.error(`ScimaxDb: Error processing ${filePath}:`, error);
                    }

                    // Yield every batchSize files
                    if (i > 0 && i % batchSize === 0) {
                        onProgress?.({ scanned: result.scanned, total: files.length, indexed: result.indexed, currentDir: dir });
                        await new Promise(resolve => setTimeout(resolve, yieldMs));
                    }
                }
            } catch (error) {
                console.error(`ScimaxDb: Error scanning directory ${dir}:`, error);
            }

            // Yield between directories
            await new Promise(resolve => setTimeout(resolve, yieldMs));
        }

        console.log(`ScimaxDb: Directory scan complete - ${result.newFiles} new, ${result.changed} changed, ${result.indexed} indexed`);
        return result;
    }

    /**
     * Close database
     */
    public async close(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
