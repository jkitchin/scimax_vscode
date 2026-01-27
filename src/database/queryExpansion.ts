/**
 * Query expansion module for SOTA search
 *
 * Implements two strategies:
 * 1. Pseudo-Relevance Feedback (PRF) - No LLM required
 * 2. LLM-based query expansion - Requires Ollama
 *
 * Both fail gracefully when dependencies are unavailable.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { databaseLogger as log } from '../utils/logger';

export type ExpansionMethod = 'prf' | 'llm' | 'both';

export interface QueryExpansionOptions {
    method: ExpansionMethod;
    prfTopK?: number;           // Top results to analyze for PRF (default: 5)
    prfTermCount?: number;      // Number of terms to extract (default: 5)
    llmModel?: string;          // Ollama model for LLM expansion (default: 'qwen3:1.7b')
    ollamaUrl?: string;         // Ollama server URL (default: 'http://localhost:11434')
    maxVariants?: number;       // Max query variants to generate (default: 3)
}

export interface ExpandedQuery {
    query: string;
    weight: number;             // Weight multiplier (original query = 2.0)
    source: 'original' | 'prf' | 'llm';
}

/**
 * Extract key terms from text using simple TF analysis
 * Used for pseudo-relevance feedback
 */
export function extractKeyTerms(
    texts: string[],
    originalQuery: string,
    maxTerms: number = 5
): string[] {
    // Tokenize and count term frequencies
    const termFreq = new Map<string, number>();
    const queryTerms = new Set(
        originalQuery.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    );

    // Common stopwords to filter out
    const stopwords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
        'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
        'their', 'we', 'our', 'you', 'your', 'he', 'she', 'him', 'her',
        'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
        'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
        'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
        'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there'
    ]);

    for (const text of texts) {
        // Simple tokenization: split on non-word chars, filter short terms
        const tokens = text.toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(t => t.length > 2 && !stopwords.has(t) && !queryTerms.has(t));

        for (const token of tokens) {
            termFreq.set(token, (termFreq.get(token) || 0) + 1);
        }
    }

    // Sort by frequency and return top terms
    return Array.from(termFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxTerms)
        .map(([term]) => term);
}

/**
 * Query expansion service
 * Manages both PRF and LLM-based expansion
 */
export class QueryExpansionService {
    private ollamaUrl: string;
    private llmModel: string;
    private ollamaAvailable: boolean | null = null;

    constructor(options?: { ollamaUrl?: string; llmModel?: string }) {
        this.ollamaUrl = options?.ollamaUrl || 'http://localhost:11434';
        this.llmModel = options?.llmModel || 'qwen3:1.7b';
    }

    /**
     * Check if Ollama is available for LLM expansion
     */
    async checkOllamaAvailable(): Promise<boolean> {
        if (this.ollamaAvailable !== null) {
            return this.ollamaAvailable;
        }

        try {
            const response = await this.ollamaRequest('/api/tags', 'GET');
            this.ollamaAvailable = !!(response && Array.isArray(response.models));
            return this.ollamaAvailable;
        } catch {
            this.ollamaAvailable = false;
            return false;
        }
    }

    /**
     * Check if the configured LLM model is available
     */
    async isLLMModelAvailable(): Promise<boolean> {
        try {
            const response = await this.ollamaRequest('/api/tags', 'GET');
            if (!response?.models) return false;
            return response.models.some((m: any) =>
                m.name === this.llmModel || m.name.startsWith(this.llmModel + ':')
            );
        } catch {
            return false;
        }
    }

    /**
     * Expand query using pseudo-relevance feedback
     * Analyzes top search results to find related terms
     *
     * @param query Original query
     * @param topResultContents Content from top search results
     * @param options Expansion options
     */
    expandQueryPRF(
        query: string,
        topResultContents: string[],
        options?: { termCount?: number }
    ): ExpandedQuery[] {
        const termCount = options?.termCount ?? 5;

        if (topResultContents.length === 0) {
            return [{ query, weight: 2.0, source: 'original' }];
        }

        // Extract key terms from top results
        const expandedTerms = extractKeyTerms(topResultContents, query, termCount);

        if (expandedTerms.length === 0) {
            return [{ query, weight: 2.0, source: 'original' }];
        }

        // Create expanded query by adding terms
        const expandedQuery = `${query} ${expandedTerms.join(' ')}`;

        return [
            { query, weight: 2.0, source: 'original' },
            { query: expandedQuery, weight: 1.0, source: 'prf' }
        ];
    }

    /**
     * Expand query using LLM (Ollama)
     * Generates alternative query formulations
     *
     * @param query Original query
     * @param options Expansion options
     */
    async expandQueryLLM(
        query: string,
        options?: { maxVariants?: number }
    ): Promise<ExpandedQuery[]> {
        const maxVariants = options?.maxVariants ?? 3;

        // Start with original query
        const results: ExpandedQuery[] = [
            { query, weight: 2.0, source: 'original' }
        ];

        // Check Ollama availability
        const available = await this.checkOllamaAvailable();
        if (!available) {
            log.debug('LLM query expansion unavailable - Ollama not running');
            return results;
        }

        try {
            const prompt = `Generate ${maxVariants} alternative search queries for the following query. Each alternative should capture the same intent but use different words or phrasings. Consider synonyms, related concepts, and different perspectives.

Original query: "${query}"

Return ONLY a JSON array of strings, no explanation. Example format:
["alternative query 1", "alternative query 2", "alternative query 3"]`;

            const response = await this.ollamaGenerate(prompt);

            // Parse JSON array from response
            const jsonMatch = response.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                const variants = JSON.parse(jsonMatch[0]) as string[];
                for (const variant of variants.slice(0, maxVariants)) {
                    if (variant && typeof variant === 'string' && variant !== query) {
                        results.push({ query: variant, weight: 1.0, source: 'llm' });
                    }
                }
            }
        } catch (error) {
            log.debug('LLM query expansion failed', { error });
            // Fall back to original query only
        }

        return results;
    }

    /**
     * Expand query using both PRF and LLM methods
     */
    async expandQueryBoth(
        query: string,
        topResultContents: string[],
        options?: QueryExpansionOptions
    ): Promise<ExpandedQuery[]> {
        const results: ExpandedQuery[] = [
            { query, weight: 2.0, source: 'original' }
        ];

        // PRF expansion (always available)
        const prfExpanded = this.expandQueryPRF(query, topResultContents, {
            termCount: options?.prfTermCount
        });
        // Add PRF results (skip original which is already added)
        for (const exp of prfExpanded) {
            if (exp.source !== 'original') {
                results.push(exp);
            }
        }

        // LLM expansion (if available)
        const llmExpanded = await this.expandQueryLLM(query, {
            maxVariants: options?.maxVariants
        });
        // Add LLM results (skip original which is already added)
        for (const exp of llmExpanded) {
            if (exp.source !== 'original') {
                results.push(exp);
            }
        }

        return results;
    }

    /**
     * Main expansion method - routes to appropriate strategy
     */
    async expandQuery(
        query: string,
        topResultContents: string[],
        options: QueryExpansionOptions
    ): Promise<ExpandedQuery[]> {
        switch (options.method) {
            case 'prf':
                return this.expandQueryPRF(query, topResultContents, {
                    termCount: options.prfTermCount
                });

            case 'llm':
                return this.expandQueryLLM(query, {
                    maxVariants: options.maxVariants
                });

            case 'both':
                return this.expandQueryBoth(query, topResultContents, options);

            default:
                return [{ query, weight: 2.0, source: 'original' }];
        }
    }

    /**
     * Make a request to Ollama generate endpoint
     */
    private async ollamaGenerate(prompt: string): Promise<string> {
        const response = await this.ollamaRequest('/api/generate', 'POST', {
            model: this.llmModel,
            prompt,
            stream: false,
            options: {
                temperature: 0.7,
                num_predict: 256
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

            req.setTimeout(60000, () => {
                req.destroy();
                reject(new Error('Ollama request timeout (60s)'));
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
 * Create query expansion service from VS Code configuration
 */
export function createQueryExpansionService(): QueryExpansionService {
    // Note: In full integration, this would read from vscode.workspace.getConfiguration
    // For now, use defaults
    return new QueryExpansionService();
}
