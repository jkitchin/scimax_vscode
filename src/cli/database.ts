/**
 * CLI Database - A minimal database interface for CLI operations
 *
 * This wraps the SQLite database without VS Code dependencies.
 * It's read-mostly, with limited write support for rebuilding.
 */

import { createClient, Client } from '@libsql/client';

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
    indexFile(filePath: string, doc: unknown): Promise<void>;
}

class CliDatabaseImpl implements CliDatabase {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
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
        const fileCount = await this.client.execute('SELECT COUNT(DISTINCT file_path) as count FROM headings');
        const headingCount = await this.client.execute('SELECT COUNT(*) as count FROM headings');
        const todoCount = await this.client.execute('SELECT COUNT(*) as count FROM headings WHERE todo_state IS NOT NULL');

        // Check for embeddings table
        let hasEmbeddings = false;
        try {
            const embResult = await this.client.execute('SELECT COUNT(*) as count FROM content_chunks WHERE embedding IS NOT NULL');
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
        const result = await this.client.execute(`
            SELECT DISTINCT file_path, MAX(id) as last_id
            FROM headings
            GROUP BY file_path
        `);

        return result.rows.map((row) => ({
            path: row.file_path as string,
            lastModified: undefined, // Would need a files table to track this
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

    async indexFile(_filePath: string, _doc: unknown): Promise<void> {
        // TODO: Implement file indexing for CLI rebuild
        // This would extract headings, links, etc. from the parsed doc
        // and insert them into the database
        console.warn('indexFile not yet implemented for CLI');
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
