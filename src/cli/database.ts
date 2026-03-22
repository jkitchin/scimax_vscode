/**
 * CLI Database - Thin factory for CLI database access.
 *
 * Uses ScimaxDbCore directly (zero VS Code dependencies).
 * Also provides backward-compatible type aliases for existing CLI commands.
 */

import * as http from 'http';
import * as https from 'https';
import { ScimaxDbCore, ScimaxDbCoreOptions, CoreEmbeddingService } from '../database/scimaxDbCore';
import type { EmbeddingSettings } from './settings';

// Re-export core types for CLI commands
export type {
    ScimaxDbCore,
    HeadingRecord,
    AgendaItem,
    SearchResult,
    DbStats,
    FileRecord,
    SearchScope,
    CoreEmbeddingService
} from '../database/scimaxDbCore';

// ============================================================
// Backward-compatible type aliases
// ============================================================

/** @deprecated Use ScimaxDbCore directly */
export type CliDatabase = ScimaxDbCore;

/** @deprecated Use HeadingRecord */
export type CliHeadingRecord = import('../database/scimaxDbCore').HeadingRecord;

/** @deprecated Use AgendaItem.heading.* fields */
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

export interface CliDbStats {
    fileCount: number;
    headingCount: number;
    todoCount: number;
    hasEmbeddings: boolean;
}

// ============================================================
// Ollama embedding service for CLI (no vscode)
// ============================================================

/**
 * CLI embedding service interface (no VS Code dependencies)
 */
export interface CliEmbeddingService extends CoreEmbeddingService {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    dimensions: number;
}

/**
 * Ollama embedding service for CLI
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
        const maxChars = 6000;
        let prompt = text.length > maxChars ? text.substring(0, maxChars) : text;
        try {
            const response = await this.request('/api/embeddings', { model: this.model, prompt });
            return response.embedding;
        } catch (error: any) {
            if (error.message?.includes('exceeds the context length') && prompt.length > 2000) {
                const shorter = prompt.substring(0, 2000);
                const response = await this.request('/api/embeddings', { model: this.model, prompt: shorter });
                return response.embedding;
            }
            throw error;
        }
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const concurrencyLimit = 5;
        const results: number[][] = new Array(texts.length);
        for (let i = 0; i < texts.length; i += concurrencyLimit) {
            const chunk = texts.slice(i, i + concurrencyLimit);
            await Promise.all(chunk.map((text, idx) =>
                this.embed(text).then(embedding => { results[i + idx] = embedding; })
            ));
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
                headers: { 'Content-Type': 'application/json' }
            };
            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Ollama API error (${res.statusCode}): ${data}`));
                        return;
                    }
                    try { resolve(JSON.parse(data)); }
                    catch { reject(new Error(`Failed to parse response: ${data}`)); }
                });
            });
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('Ollama embedding request timeout (30s)')); });
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

/**
 * Create a CLI database connection using ScimaxDbCore directly.
 */
export async function createCliDatabase(dbPath: string): Promise<ScimaxDbCore> {
    const core = new ScimaxDbCore({ dbPath });
    await core.initialize();
    return core;
}

// Legacy document type (kept for backward compatibility with db.ts)
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
