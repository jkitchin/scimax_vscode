/**
 * Reranker service for SOTA search
 *
 * Uses LLM to score relevance of search results after initial retrieval.
 * Provides position-aware blending to preserve high-confidence retrieval matches.
 *
 * Gracefully falls back to retrieval-only ranking when Ollama is unavailable.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { databaseLogger as log } from '../utils/logger';
import type { SearchResult } from './scimaxDb';
import { blendScores } from './scoreNormalization';

export interface RerankerOptions {
    ollamaUrl?: string;         // Ollama server URL (default: 'http://localhost:11434')
    model?: string;             // Model for reranking (default: 'qwen3:0.6b')
    topK?: number;              // Number of candidates to rerank (default: 30)
    batchSize?: number;         // Batch size for parallel scoring (default: 5)
    usePositionBlending?: boolean;  // Use position-aware blending (default: true)
    timeout?: number;           // Request timeout in ms (default: 30000)
}

export interface RerankedResult extends SearchResult {
    rerankerScore?: number;     // Raw score from reranker (0-1)
    retrievalRank?: number;     // Original rank from retrieval
    blendedScore?: number;      // Final blended score
}

/**
 * Reranker service using Ollama LLM
 */
export class RerankerService {
    private ollamaUrl: string;
    private model: string;
    private batchSize: number;
    private timeout: number;
    private available: boolean | null = null;

    constructor(options?: RerankerOptions) {
        this.ollamaUrl = options?.ollamaUrl || 'http://localhost:11434';
        this.model = options?.model || 'qwen3:0.6b';
        this.batchSize = options?.batchSize || 5;
        this.timeout = options?.timeout || 30000;
    }

    /**
     * Check if reranker is available
     */
    async isAvailable(): Promise<boolean> {
        if (this.available !== null) {
            return this.available;
        }

        try {
            const response = await this.ollamaRequest('/api/tags', 'GET');
            if (!response?.models) {
                this.available = false;
                return false;
            }

            // Check if model is available
            const modelAvailable = response.models.some((m: any) =>
                m.name === this.model || m.name.startsWith(this.model + ':')
            );

            this.available = modelAvailable;
            if (!modelAvailable) {
                log.debug(`Reranker model '${this.model}' not found in Ollama`);
            }
            return modelAvailable;
        } catch (error) {
            this.available = false;
            log.debug('Reranker unavailable - Ollama not running');
            return false;
        }
    }

    /**
     * Reset availability check (useful after configuration changes)
     */
    resetAvailability(): void {
        this.available = null;
    }

    /**
     * Score a single document's relevance to the query
     * Returns a score from 0-1
     */
    async scoreDocument(query: string, document: string): Promise<number> {
        const prompt = `Rate the relevance of this document to the search query on a scale of 0-10.
0 = completely irrelevant
5 = somewhat relevant
10 = highly relevant

Query: "${query}"

Document:
${document.slice(0, 1000)}

Return ONLY a single number from 0 to 10, nothing else.`;

        try {
            const response = await this.ollamaGenerate(prompt);
            const score = parseFloat(response.trim());

            if (isNaN(score)) {
                log.debug('Reranker returned non-numeric score', { response });
                return 0.5; // Default to neutral score
            }

            // Normalize to 0-1 range
            return Math.max(0, Math.min(1, score / 10));
        } catch (error) {
            log.debug('Reranker scoring failed', { error });
            return 0.5; // Default to neutral score on error
        }
    }

    /**
     * Score multiple documents in parallel with batching
     */
    async scoreDocuments(
        query: string,
        documents: string[]
    ): Promise<number[]> {
        const scores: number[] = new Array(documents.length).fill(0.5);

        // Process in batches
        for (let i = 0; i < documents.length; i += this.batchSize) {
            const batch = documents.slice(i, i + this.batchSize);
            const batchPromises = batch.map((doc, idx) =>
                this.scoreDocument(query, doc)
                    .then(score => { scores[i + idx] = score; })
                    .catch(() => { scores[i + idx] = 0.5; })
            );
            await Promise.all(batchPromises);
        }

        return scores;
    }

    /**
     * Rerank search results using LLM scoring
     *
     * @param query Search query
     * @param results Initial retrieval results
     * @param options Reranking options
     * @returns Reranked results with scores
     */
    async rerank(
        query: string,
        results: SearchResult[],
        options?: RerankerOptions
    ): Promise<RerankedResult[]> {
        const topK = options?.topK ?? 30;
        const usePositionBlending = options?.usePositionBlending ?? true;

        // Take top K for reranking
        const candidates = results.slice(0, topK);

        // Check availability
        const available = await this.isAvailable();
        if (!available) {
            log.debug('Reranker unavailable, returning original ranking');
            return results.map((r, idx) => ({
                ...r,
                retrievalRank: idx,
                blendedScore: r.score
            }));
        }

        // Extract document content for scoring
        const documents = candidates.map(r => r.preview || r.title || '');

        // Score all candidates
        log.debug(`Reranking ${candidates.length} candidates`);
        const rerankerScores = await this.scoreDocuments(query, documents);

        // Create reranked results with blended scores
        const rerankedCandidates: RerankedResult[] = candidates.map((result, idx) => {
            const rerankerScore = rerankerScores[idx];
            const retrievalScore = result.score;

            // Calculate blended score
            let blendedScore: number;
            if (usePositionBlending) {
                blendedScore = blendScores(retrievalScore, rerankerScore, idx);
            } else {
                // Simple average
                blendedScore = (retrievalScore + rerankerScore) / 2;
            }

            return {
                ...result,
                rerankerScore,
                retrievalRank: idx,
                blendedScore,
                score: blendedScore
            };
        });

        // Sort by blended score
        rerankedCandidates.sort((a, b) => (b.blendedScore || 0) - (a.blendedScore || 0));

        // Append remaining results (not reranked) at the end
        const remaining = results.slice(topK).map((r, idx) => ({
            ...r,
            retrievalRank: topK + idx,
            blendedScore: r.score
        }));

        return [...rerankedCandidates, ...remaining];
    }

    /**
     * Batch rerank with progress callback
     */
    async rerankWithProgress(
        query: string,
        results: SearchResult[],
        options?: RerankerOptions & {
            onProgress?: (completed: number, total: number) => void;
        }
    ): Promise<RerankedResult[]> {
        const topK = options?.topK ?? 30;
        const candidates = results.slice(0, topK);

        const available = await this.isAvailable();
        if (!available) {
            return results.map((r, idx) => ({
                ...r,
                retrievalRank: idx,
                blendedScore: r.score
            }));
        }

        const documents = candidates.map(r => r.preview || r.title || '');
        const scores: number[] = new Array(documents.length).fill(0.5);
        let completed = 0;

        // Process with progress updates
        for (let i = 0; i < documents.length; i += this.batchSize) {
            const batch = documents.slice(i, i + this.batchSize);
            const batchPromises = batch.map((doc, idx) =>
                this.scoreDocument(query, doc)
                    .then(score => {
                        scores[i + idx] = score;
                        completed++;
                        options?.onProgress?.(completed, documents.length);
                    })
                    .catch(() => {
                        scores[i + idx] = 0.5;
                        completed++;
                        options?.onProgress?.(completed, documents.length);
                    })
            );
            await Promise.all(batchPromises);
        }

        // Build final results (same logic as rerank)
        const usePositionBlending = options?.usePositionBlending ?? true;
        const rerankedCandidates: RerankedResult[] = candidates.map((result, idx) => {
            const rerankerScore = scores[idx];
            const blendedScore = usePositionBlending
                ? blendScores(result.score, rerankerScore, idx)
                : (result.score + rerankerScore) / 2;

            return {
                ...result,
                rerankerScore,
                retrievalRank: idx,
                blendedScore,
                score: blendedScore
            };
        });

        rerankedCandidates.sort((a, b) => (b.blendedScore || 0) - (a.blendedScore || 0));

        const remaining = results.slice(topK).map((r, idx) => ({
            ...r,
            retrievalRank: topK + idx,
            blendedScore: r.score
        }));

        return [...rerankedCandidates, ...remaining];
    }

    /**
     * Make request to Ollama generate endpoint
     */
    private async ollamaGenerate(prompt: string): Promise<string> {
        const response = await this.ollamaRequest('/api/generate', 'POST', {
            model: this.model,
            prompt,
            stream: false,
            options: {
                temperature: 0.1,  // Low temperature for consistent scoring
                num_predict: 16    // Only need a short response
            }
        });

        return response?.response || '';
    }

    /**
     * Make HTTP request to Ollama
     */
    private async ollamaRequest(
        endpoint: string,
        method: 'GET' | 'POST',
        body?: any
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.ollamaUrl);
            const isHttps = url.protocol === 'https:';
            const lib = isHttps ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = lib.request(options, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: Buffer) => data += chunk);
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

            req.setTimeout(this.timeout, () => {
                req.destroy();
                reject(new Error(`Ollama request timeout (${this.timeout}ms)`));
            });

            req.on('error', reject);

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }
}

/**
 * Create reranker service from VS Code configuration
 */
export function createRerankerService(options?: RerankerOptions): RerankerService {
    return new RerankerService(options);
}
