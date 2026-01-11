import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';

/**
 * Embedding service interface
 */
export interface EmbeddingService {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    dimensions: number;
}

/**
 * Local embedding service using Transformers.js
 * Runs ONNX models directly in Node.js - no external services needed
 */
export class TransformersJsEmbeddingService implements EmbeddingService {
    private modelName: string;
    private pipeline: any = null;
    private isLoading: boolean = false;
    private loadPromise: Promise<void> | null = null;
    public dimensions: number;

    constructor(modelName: string = 'Xenova/all-MiniLM-L6-v2') {
        this.modelName = modelName;
        this.dimensions = this.getDimensions(modelName);
    }

    private getDimensions(model: string): number {
        const dims: Record<string, number> = {
            'Xenova/all-MiniLM-L6-v2': 384,
            'Xenova/bge-small-en-v1.5': 384,
            'Xenova/gte-small': 384,
            'Xenova/all-mpnet-base-v2': 768,
            'Xenova/bge-base-en-v1.5': 768
        };
        return dims[model] || 384;
    }

    private async loadPipeline(): Promise<void> {
        if (this.pipeline) return;
        if (this.loadPromise) return this.loadPromise;

        this.isLoading = true;
        this.loadPromise = (async () => {
            try {
                // Dynamic import to avoid issues if package not installed
                const { pipeline, env } = await import('@xenova/transformers');

                // Configure cache directory
                const config = vscode.workspace.getConfiguration('scimax.db');
                const cacheDir = path.join(
                    vscode.extensions.getExtension('jkitchin.scimax-vscode')?.extensionPath || '',
                    '.transformers-cache'
                );
                env.cacheDir = cacheDir;

                // Load the feature-extraction pipeline
                console.log(`TransformersJs: Loading model ${this.modelName}...`);
                this.pipeline = await pipeline('feature-extraction', this.modelName, {
                    quantized: true  // Use quantized model for faster inference
                });
                console.log(`TransformersJs: Model ${this.modelName} loaded`);
            } catch (error) {
                console.error('TransformersJs: Failed to load pipeline', error);
                throw error;
            } finally {
                this.isLoading = false;
            }
        })();

        return this.loadPromise;
    }

    async embed(text: string): Promise<number[]> {
        await this.loadPipeline();

        const output = await this.pipeline(text, {
            pooling: 'mean',
            normalize: true
        });

        // Convert to regular array
        return Array.from(output.data);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        await this.loadPipeline();

        const embeddings: number[][] = [];
        for (const text of texts) {
            const embedding = await this.embed(text);
            embeddings.push(embedding);
        }
        return embeddings;
    }
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
        const response = await this.request('/api/embeddings', {
            model: this.model,
            prompt: text
        });
        return response.embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        // Ollama doesn't support batch, so we do sequential
        const embeddings: number[][] = [];
        for (const text of texts) {
            const embedding = await this.embed(text);
            embeddings.push(embedding);
        }
        return embeddings;
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
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(JSON.stringify(body));
            req.end();
        });
    }
}

/**
 * OpenAI embedding service
 * Uses OpenAI's text-embedding-3-small or text-embedding-ada-002
 */
export class OpenAIEmbeddingService implements EmbeddingService {
    private apiKey: string;
    private model: string;
    public dimensions: number;

    constructor(apiKey: string, model: string = 'text-embedding-3-small') {
        this.apiKey = apiKey;
        this.model = model;
        // text-embedding-3-small: 1536, text-embedding-3-large: 3072, ada-002: 1536
        this.dimensions = this.getDimensions(model);
    }

    private getDimensions(model: string): number {
        const dims: Record<string, number> = {
            'text-embedding-3-small': 1536,
            'text-embedding-3-large': 3072,
            'text-embedding-ada-002': 1536
        };
        return dims[model] || 1536;
    }

    async embed(text: string): Promise<number[]> {
        const response = await this.request({
            model: this.model,
            input: text
        });
        return response.data[0].embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        // OpenAI supports batch embeddings
        const response = await this.request({
            model: this.model,
            input: texts
        });
        return response.data.map((d: any) => d.embedding);
    }

    private async request(body: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.openai.com',
                port: 443,
                path: '/v1/embeddings',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) {
                            reject(new Error(parsed.error.message));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(JSON.stringify(body));
            req.end();
        });
    }
}

/**
 * Create embedding service from VS Code configuration
 */
export function createEmbeddingService(): EmbeddingService | null {
    const config = vscode.workspace.getConfiguration('scimax.db');
    const provider = config.get<string>('embeddingProvider') || 'none';

    switch (provider) {
        case 'local': {
            const model = config.get<string>('localModel') || 'Xenova/all-MiniLM-L6-v2';
            return new TransformersJsEmbeddingService(model);
        }

        case 'ollama': {
            const url = config.get<string>('ollamaUrl') || 'http://localhost:11434';
            const model = config.get<string>('ollamaModel') || 'nomic-embed-text';
            return new OllamaEmbeddingService(url, model);
        }

        case 'openai': {
            const apiKey = config.get<string>('openaiApiKey');
            if (!apiKey) {
                vscode.window.showWarningMessage('OpenAI API key not configured for semantic search');
                return null;
            }
            return new OpenAIEmbeddingService(apiKey);
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
