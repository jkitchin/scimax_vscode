import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

/**
 * Embedding service interface
 */
export interface EmbeddingService {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    dimensions: number;
}

/**
 * Ollama embedding service
 * Uses local Ollama server with models like nomic-embed-text
 */
export class OllamaEmbeddingService implements EmbeddingService {
    private baseUrl: string;
    private model: string;
    public dimensions: number;

    constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text') {
        this.baseUrl = baseUrl;
        this.model = model;
        // nomic-embed-text: 768, all-minilm: 384, mxbai-embed-large: 1024
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
        // nomic-embed-text has 8192 token limit; we use ~6000 chars as safe limit
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

        // Process in chunks with concurrency limit
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
                    // Check HTTP status code
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Ollama API error (${res.statusCode}): ${data}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            // Add timeout (30 seconds)
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
 * Create embedding service from VS Code configuration (async version)
 */
export async function createEmbeddingServiceAsync(): Promise<EmbeddingService | null> {
    const config = vscode.workspace.getConfiguration('scimax.db');
    const provider = config.get<string>('embeddingProvider') || 'none';

    switch (provider) {
        case 'ollama': {
            const url = config.get<string>('ollamaUrl') || 'http://localhost:11434';
            const model = config.get<string>('ollamaModel') || 'nomic-embed-text';
            return new OllamaEmbeddingService(url, model);
        }

        case 'none':
        default:
            return null;
    }
}

/**
 * Test embedding service connection
 */
export async function testEmbeddingService(service: EmbeddingService): Promise<boolean> {
    try {
        const embedding = await service.embed('test');
        return embedding.length === service.dimensions;
    } catch (error) {
        console.error('Embedding service test failed:', error);
        return false;
    }
}
