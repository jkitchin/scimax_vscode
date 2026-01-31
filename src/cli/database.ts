/**
 * CLI Database - A minimal database interface for CLI operations
 *
 * This wraps the SQLite database without VS Code dependencies.
 * It's read-mostly, with limited write support for rebuilding.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { createClient, Client } from '@libsql/client';
import type { EmbeddingSettings } from './settings';

/**
 * CLI Embedding service interface (no VS Code dependencies)
 */
export interface CliEmbeddingService {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    dimensions: number;
}

/**
 * Ollama embedding service for CLI
 * Uses local Ollama server with models like nomic-embed-text
 */
export class CliOllamaEmbeddingService implements CliEmbeddingService {
    private baseUrl: string;
    private model: string;
    public dimensions: number;

    constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text') {
        this.baseUrl = baseUrl;
        this.model = model;
        this.dimensions = this.getDimensions(model);
    }

    private getDimensions(model: string): number {
        const dims: Record<string, number> = {
            'nomic-embed-text': 768,
            'all-minilm': 384,
            'mxbai-embed-large': 1024,
            'snowflake-arctic-embed': 1024
        };
        return dims[model] || 768;
    }

    async embed(text: string): Promise<number[]> {
        // Truncate text if it exceeds a safe limit for the model's context
        const maxChars = 6000;
        let prompt = text;
        if (prompt.length > maxChars) {
            prompt = prompt.substring(0, maxChars);
        }

        try {
            const response = await this.request('/api/embeddings', {
                model: this.model,
                prompt
            });
            return response.embedding;
        } catch (error: any) {
            // If we still hit context length error, try more aggressive truncation
            if (error.message?.includes('exceeds the context length') && prompt.length > 2000) {
                const shorterPrompt = prompt.substring(0, 2000);
                const response = await this.request('/api/embeddings', {
                    model: this.model,
                    prompt: shorterPrompt
                });
                return response.embedding;
            }
            throw error;
        }
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        // Ollama doesn't support batch API, so we parallelize with concurrency limit
        const concurrencyLimit = 5;
        const results: number[][] = new Array(texts.length);

        for (let i = 0; i < texts.length; i += concurrencyLimit) {
            const chunk = texts.slice(i, i + concurrencyLimit);
            const promises = chunk.map((text, idx) =>
                this.embed(text).then(embedding => {
                    results[i + idx] = embedding;
                })
            );
            await Promise.all(promises);
        }

        return results;
    }

    private async request(endpoint: string, body: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.baseUrl);
            const isHttps = url.protocol === 'https:';
            const lib = isHttps ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Ollama API error (${res.statusCode}): ${data}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Ollama embedding request timeout (30s)'));
            });

            req.on('error', reject);
            req.write(JSON.stringify(body));
            req.end();
        });
    }
}

/**
 * Create embedding service from settings
 */
export function createCliEmbeddingService(settings: EmbeddingSettings): CliEmbeddingService | null {
    if (settings.provider === 'ollama') {
        return new CliOllamaEmbeddingService(settings.ollamaUrl, settings.ollamaModel);
    }
    return null;
}

/**
 * Test embedding service connection
 */
export async function testCliEmbeddingService(service: CliEmbeddingService): Promise<boolean> {
    try {
        const embedding = await service.embed('test');
        return embedding.length === service.dimensions;
    } catch {
        return false;
    }
}

// Document structure expected by indexFile (matches LegacyDocument from orgParserAdapter)
export interface CliDocument {
    headings: Array<{
        level: number;
        title: string;
        lineNumber: number;
        todoState?: string;
        priority?: string;
        tags: string[];
        properties: Record<string, string>;
        scheduled?: string;
        deadline?: string;
        closed?: string;
    }>;
    sourceBlocks: Array<{
        language: string;
        content: string;
        lineNumber: number;
        headers: Record<string, string>;
    }>;
    links: Array<{
        type: string;
        target: string;
        description?: string;
        lineNumber: number;
    }>;
}

// CLI-specific types (simpler than VS Code extension types)
export interface CliSearchResult {
    id: number;
    file_path: string;
    line_number: number;
    level: number;
    title: string;
    todo_state?: string;
    tags?: string;
    snippet?: string;
    score?: number;
}

export interface CliAgendaItem {
    id: number;
    file_path: string;
    line_number: number;
    title: string;
    todo_state?: string;
    scheduled?: string;
    deadline?: string;
    days_until?: number;
}

export interface CliHeadingRecord {
    id: number;
    file_path: string;
    line_number: number;
    level: number;
    title: string;
    todo_state?: string | null;
    priority?: string;
    tags?: string;
    scheduled?: string;
    deadline?: string;
    properties?: string;
}

export interface CliDbStats {
    fileCount: number;
    headingCount: number;
    todoCount: number;
    hasEmbeddings: boolean;
}

export interface CliDatabase {
    close(): Promise<void>;

    // Read operations
    search(query: string, options?: { limit?: number }): Promise<CliSearchResult[]>;
    getAgendaItems(days: number): Promise<CliAgendaItem[]>;
    searchHeadings(query: string, options?: { limit?: number }): Promise<CliHeadingRecord[]>;
    getStats(): Promise<CliDbStats>;
    getIndexedFiles(): Promise<Array<{ path: string; lastModified?: number }>>;
    hasEmbeddings(): Promise<boolean>;

    // Write operations (for rebuild)
    indexFile(filePath: string, doc: CliDocument): Promise<void>;
    clearFile(filePath: string): Promise<void>;

    // Embedding operations
    setEmbeddingService(service: CliEmbeddingService): void;
    createEmbeddingsForFile(filePath: string, content: string): Promise<void>;
    clearEmbeddingsForFile(filePath: string): Promise<void>;
}

class CliDatabaseImpl implements CliDatabase {
    private client: Client;
    private embeddingService: CliEmbeddingService | null = null;

    constructor(client: Client) {
        this.client = client;
    }

    setEmbeddingService(service: CliEmbeddingService): void {
        this.embeddingService = service;
    }

    async close(): Promise<void> {
        this.client.close();
    }

    async search(query: string, options: { limit?: number } = {}): Promise<CliSearchResult[]> {
        const limit = options.limit || 20;

        // FTS5 search
        const result = await this.client.execute({
            sql: `
                SELECT
                    h.id, h.file_path, h.line_number, h.level, h.title,
                    h.todo_state, h.tags,
                    snippet(fts_content, 2, '<mark>', '</mark>', '...', 32) as snippet,
                    bm25(fts_content) as score
                FROM fts_content
                JOIN headings h ON fts_content.heading_id = h.id
                WHERE fts_content MATCH ?
                ORDER BY score
                LIMIT ?
            `,
            args: [query, limit],
        });

        return result.rows.map((row) => ({
            id: row.id as number,
            file_path: row.file_path as string,
            line_number: row.line_number as number,
            level: row.level as number,
            title: row.title as string,
            todo_state: row.todo_state as string | undefined,
            tags: row.tags as string | undefined,
            snippet: row.snippet as string | undefined,
            score: row.score as number | undefined,
        }));
    }

    async getAgendaItems(days: number): Promise<CliAgendaItem[]> {
        const result = await this.client.execute({
            sql: `
                SELECT
                    h.id, h.file_path, h.line_number, h.title, h.todo_state,
                    h.scheduled, h.deadline,
                    CASE
                        WHEN h.scheduled IS NOT NULL THEN
                            julianday(date(h.scheduled)) - julianday('now', 'localtime')
                        WHEN h.deadline IS NOT NULL THEN
                            julianday(date(h.deadline)) - julianday('now', 'localtime')
                    END as days_until
                FROM headings h
                WHERE (h.scheduled IS NOT NULL OR h.deadline IS NOT NULL)
                  AND (h.todo_state IS NULL OR h.todo_state NOT IN ('DONE', 'CANCELLED'))
                  AND days_until <= ?
                ORDER BY days_until ASC
            `,
            args: [days],
        });

        return result.rows.map((row) => ({
            id: row.id as number,
            file_path: row.file_path as string,
            line_number: row.line_number as number,
            title: row.title as string,
            todo_state: row.todo_state as string | undefined,
            scheduled: row.scheduled as string | undefined,
            deadline: row.deadline as string | undefined,
            days_until: row.days_until as number | undefined,
        }));
    }

    async searchHeadings(query: string, options: { limit?: number } = {}): Promise<CliHeadingRecord[]> {
        const limit = options.limit || 100;

        let result;

        if (query) {
            result = await this.client.execute({
                sql: `
                    SELECT * FROM headings
                    WHERE title LIKE ?
                    ORDER BY file_path, line_number
                    LIMIT ?
                `,
                args: [`%${query}%`, limit],
            });
        } else {
            result = await this.client.execute({
                sql: `
                    SELECT * FROM headings
                    ORDER BY file_path, line_number
                    LIMIT ?
                `,
                args: [limit],
            });
        }

        return result.rows.map((row) => ({
            id: row.id as number,
            file_path: row.file_path as string,
            line_number: row.line_number as number,
            level: row.level as number,
            title: row.title as string,
            todo_state: row.todo_state as string | undefined,
            priority: row.priority as string | undefined,
            tags: row.tags as string | undefined,
            scheduled: row.scheduled as string | undefined,
            deadline: row.deadline as string | undefined,
            properties: row.properties as string | undefined,
        }));
    }

    async getStats(): Promise<CliDbStats> {
        // Count from files table (source of truth for indexed files)
        const fileCount = await this.client.execute('SELECT COUNT(*) as count FROM files');
        const headingCount = await this.client.execute('SELECT COUNT(*) as count FROM headings');
        const todoCount = await this.client.execute('SELECT COUNT(*) as count FROM headings WHERE todo_state IS NOT NULL');

        // Check for embeddings in chunks table
        let hasEmbeddings = false;
        try {
            const embResult = await this.client.execute('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL');
            hasEmbeddings = (embResult.rows[0].count as number) > 0;
        } catch {
            // Table might not exist
        }

        return {
            fileCount: fileCount.rows[0].count as number,
            headingCount: headingCount.rows[0].count as number,
            todoCount: todoCount.rows[0].count as number,
            hasEmbeddings,
        };
    }

    async getIndexedFiles(): Promise<Array<{ path: string; lastModified?: number }>> {
        // Query from files table (primary source of indexed files)
        const result = await this.client.execute(`
            SELECT path, mtime FROM files ORDER BY path
        `);

        return result.rows.map((row) => ({
            path: row.path as string,
            lastModified: row.mtime as number | undefined,
        }));
    }

    async hasEmbeddings(): Promise<boolean> {
        try {
            const result = await this.client.execute(
                'SELECT COUNT(*) as count FROM content_chunks WHERE embedding IS NOT NULL'
            );
            return (result.rows[0].count as number) > 0;
        } catch {
            return false;
        }
    }

    async clearFile(filePath: string): Promise<void> {
        // Get file ID
        const fileResult = await this.client.execute({
            sql: 'SELECT id FROM files WHERE path = ?',
            args: [filePath],
        });

        if (fileResult.rows.length === 0) {
            return; // File not in database
        }

        const fileId = fileResult.rows[0].id as number;

        // Delete associated data
        await this.client.execute({ sql: 'DELETE FROM headings WHERE file_id = ?', args: [fileId] });
        await this.client.execute({ sql: 'DELETE FROM source_blocks WHERE file_id = ?', args: [fileId] });
        await this.client.execute({ sql: 'DELETE FROM links WHERE file_id = ?', args: [fileId] });
        await this.client.execute({ sql: 'DELETE FROM files WHERE id = ?', args: [fileId] });
    }

    async indexFile(filePath: string, doc: CliDocument): Promise<void> {
        // Get file stats
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const hash = crypto.createHash('md5').update(content).digest('hex');

        // Clear existing data for this file
        await this.clearFile(filePath);

        // Insert file record
        await this.client.execute({
            sql: `INSERT INTO files (path, file_type, mtime, hash, size, indexed_at, keywords)
                  VALUES (?, 'org', ?, ?, ?, ?, '{}')`,
            args: [filePath, stats.mtimeMs, hash, stats.size, Date.now()],
        });

        // Get the new file ID
        const fileResult = await this.client.execute({
            sql: 'SELECT id FROM files WHERE path = ?',
            args: [filePath],
        });
        const fileId = fileResult.rows[0].id as number;

        // Build line position map for begin_pos
        const lines = content.split('\n');
        const linePositions: number[] = [0];
        let pos = 0;
        for (const line of lines) {
            pos += line.length + 1; // +1 for newline
            linePositions.push(pos);
        }

        // Index headings
        for (const heading of doc.headings) {
            const beginPos = linePositions[heading.lineNumber - 1] || 0;

            await this.client.execute({
                sql: `INSERT INTO headings
                      (file_id, file_path, level, title, line_number, begin_pos,
                       todo_state, priority, tags, inherited_tags, properties,
                       scheduled, deadline, closed, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, NULL)`,
                args: [
                    fileId,
                    filePath,
                    heading.level,
                    heading.title,
                    heading.lineNumber,
                    beginPos,
                    heading.todoState || null,
                    heading.priority || null,
                    JSON.stringify(heading.tags),
                    JSON.stringify(heading.properties),
                    heading.scheduled || null,
                    heading.deadline || null,
                    heading.closed || null,
                ],
            });
        }

        // Index source blocks
        for (const block of doc.sourceBlocks) {
            await this.client.execute({
                sql: `INSERT INTO source_blocks
                      (file_id, file_path, language, content, line_number, headers, cell_index)
                      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                args: [
                    fileId,
                    filePath,
                    block.language,
                    block.content,
                    block.lineNumber,
                    JSON.stringify(block.headers),
                ],
            });
        }
    }

    async clearEmbeddingsForFile(filePath: string): Promise<void> {
        // Get file ID
        const fileResult = await this.client.execute({
            sql: 'SELECT id FROM files WHERE path = ?',
            args: [filePath],
        });

        if (fileResult.rows.length === 0) {
            return; // File not in database
        }

        const fileId = fileResult.rows[0].id as number;

        // Delete chunks for this file (chunks table stores embeddings)
        try {
            await this.client.execute({
                sql: 'DELETE FROM chunks WHERE file_id = ?',
                args: [fileId],
            });
        } catch {
            // chunks table might not exist in older databases
        }
    }

    async createEmbeddingsForFile(filePath: string, content: string): Promise<void> {
        if (!this.embeddingService) return;

        // Get file ID
        const fileResult = await this.client.execute({
            sql: 'SELECT id FROM files WHERE path = ?',
            args: [filePath],
        });

        if (fileResult.rows.length === 0) {
            return; // File not in database
        }

        const fileId = fileResult.rows[0].id as number;

        // Clear existing chunks for this file
        await this.clearEmbeddingsForFile(filePath);

        // Check if chunks table exists with embedding column
        try {
            await this.client.execute('SELECT embedding FROM chunks LIMIT 0');
        } catch {
            // Table doesn't exist or doesn't have embedding column, skip
            return;
        }

        // Create chunks from content
        const lines = content.split('\n');
        const chunkSize = 1000; // chars
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

                // Overlap with last 3 lines
                const overlapLines = currentChunk.split('\n').slice(-3);
                currentChunk = overlapLines.join('\n');
                currentLineStart = Math.max(1, i - 2);
                charCount = currentChunk.length;
            }
        }

        // Add final chunk
        if (currentChunk.trim()) {
            chunks.push({
                text: currentChunk.trim(),
                lineStart: currentLineStart,
                lineEnd: lines.length
            });
        }

        if (chunks.length === 0) return;

        // Generate embeddings
        const texts = chunks.map(c => c.text);
        const embeddings = await this.embeddingService.embedBatch(texts);

        // Insert chunks with embeddings
        for (let i = 0; i < chunks.length; i++) {
            const vectorStr = `[${embeddings[i].join(',')}]`;
            await this.client.execute({
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
    }
}

/**
 * Create a CLI database connection
 */
export async function createCliDatabase(dbPath: string): Promise<CliDatabase> {
    const client = createClient({
        url: `file:${dbPath}`,
    });

    return new CliDatabaseImpl(client);
}
