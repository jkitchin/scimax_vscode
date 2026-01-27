/**
 * Advanced Search Orchestration for SOTA search
 *
 * Implements the full search pipeline:
 * 1. Query Expansion (PRF + LLM)
 * 2. Parallel Retrieval (FTS5 + Vector)
 * 3. Weighted Reciprocal Rank Fusion
 * 4. LLM Reranking
 *
 * All features fail gracefully when dependencies are unavailable.
 */

import * as vscode from 'vscode';
import { databaseLogger as log } from '../utils/logger';
import type { SearchResult } from './scimaxDb';
import type { EmbeddingService } from './embeddingService';
import {
    weightedRRF,
    RRFSource,
    deduplicateResults,
    normalizeBM25Scores,
    normalizeVectorScores
} from './scoreNormalization';
import {
    QueryExpansionService,
    ExpansionMethod,
    ExpandedQuery
} from './queryExpansion';
import { RerankerService, RerankedResult } from './rerankerService';
import { SearchCache, getSearchCache } from './searchCache';

/**
 * Search mode determines which features are used
 */
export type SearchMode = 'fast' | 'semantic' | 'hybrid' | 'advanced';

/**
 * Advanced search configuration
 */
export interface AdvancedSearchConfig {
    // Mode selection
    defaultMode: SearchMode;
    defaultLimit: number;

    // Query expansion
    queryExpansion: {
        enabled: boolean;
        method: ExpansionMethod;
        prfTopK: number;
        prfTermCount: number;
        llmModel: string;
    };

    // Reranking
    reranking: {
        enabled: boolean;
        model: string;
        topK: number;
        usePositionBlending: boolean;
    };

    // Hybrid search
    hybrid: {
        ftsWeight: number;
        vectorWeight: number;
        usePositionBonus: boolean;
        k: number;  // RRF constant
    };

    // Caching
    caching: {
        enabled: boolean;
        ttlSeconds: number;
        maxEntries: number;
    };

    // Ollama
    ollamaUrl: string;
}

/**
 * Default configuration
 */
export function getDefaultConfig(): AdvancedSearchConfig {
    return {
        defaultMode: 'hybrid',
        defaultLimit: 20,
        queryExpansion: {
            enabled: true,
            method: 'prf',
            prfTopK: 5,
            prfTermCount: 5,
            llmModel: 'qwen3:1.7b'
        },
        reranking: {
            enabled: false,  // Disabled by default (requires Ollama model)
            model: 'qwen3:0.6b',
            topK: 30,
            usePositionBlending: true
        },
        hybrid: {
            ftsWeight: 0.5,
            vectorWeight: 0.5,
            usePositionBonus: true,
            k: 60
        },
        caching: {
            enabled: true,
            ttlSeconds: 900,
            maxEntries: 500
        },
        ollamaUrl: 'http://localhost:11434'
    };
}

/**
 * Load configuration from VS Code settings
 */
export function loadConfig(): AdvancedSearchConfig {
    const vsConfig = vscode.workspace.getConfiguration('scimax.search');
    const defaults = getDefaultConfig();

    return {
        defaultMode: vsConfig.get('defaultMode', defaults.defaultMode),
        defaultLimit: vsConfig.get('defaultLimit', defaults.defaultLimit),
        queryExpansion: {
            enabled: vsConfig.get('queryExpansion.enabled', defaults.queryExpansion.enabled),
            method: vsConfig.get('queryExpansion.method', defaults.queryExpansion.method),
            prfTopK: vsConfig.get('queryExpansion.prfTopK', defaults.queryExpansion.prfTopK),
            prfTermCount: vsConfig.get('queryExpansion.prfTermCount', defaults.queryExpansion.prfTermCount),
            llmModel: vsConfig.get('queryExpansion.llmModel', defaults.queryExpansion.llmModel)
        },
        reranking: {
            enabled: vsConfig.get('reranking.enabled', defaults.reranking.enabled),
            model: vsConfig.get('reranking.model', defaults.reranking.model),
            topK: vsConfig.get('reranking.topK', defaults.reranking.topK),
            usePositionBlending: vsConfig.get('reranking.usePositionBlending', defaults.reranking.usePositionBlending)
        },
        hybrid: {
            ftsWeight: vsConfig.get('hybrid.ftsWeight', defaults.hybrid.ftsWeight),
            vectorWeight: vsConfig.get('hybrid.vectorWeight', defaults.hybrid.vectorWeight),
            usePositionBonus: vsConfig.get('hybrid.usePositionBonus', defaults.hybrid.usePositionBonus),
            k: vsConfig.get('hybrid.k', defaults.hybrid.k)
        },
        caching: {
            enabled: vsConfig.get('caching.enabled', defaults.caching.enabled),
            ttlSeconds: vsConfig.get('caching.ttlSeconds', defaults.caching.ttlSeconds),
            maxEntries: vsConfig.get('caching.maxEntries', defaults.caching.maxEntries)
        },
        ollamaUrl: vscode.workspace.getConfiguration('scimax.db').get('ollamaUrl', defaults.ollamaUrl)
    };
}

/**
 * Search options for a single query
 */
export interface AdvancedSearchOptions {
    mode?: SearchMode;
    limit?: number;
    expandQuery?: boolean;
    expansionMethod?: ExpansionMethod;
    rerank?: boolean;
    ftsWeight?: number;
    vectorWeight?: number;
}

/**
 * Search result with metadata
 */
export interface AdvancedSearchResult extends SearchResult {
    querySource?: 'original' | 'prf' | 'llm';
    retrievalMethod?: 'fts' | 'vector';
    rerankerScore?: number;
    retrievalRank?: number;
}

/**
 * Progress callback for long-running searches
 */
export type SearchProgressCallback = (stage: string, progress: number, total: number) => void;

/**
 * Advanced Search Engine
 *
 * Orchestrates the full SOTA search pipeline with graceful degradation.
 */
export class AdvancedSearchEngine {
    private config: AdvancedSearchConfig;
    private expansionService: QueryExpansionService;
    private rerankerService: RerankerService;
    private cache: SearchCache;

    // Function references for FTS and semantic search (injected from ScimaxDb)
    private ftsSearch: ((query: string, options?: { limit?: number }) => Promise<SearchResult[]>) | null = null;
    private semanticSearch: ((query: string, options?: { limit?: number }) => Promise<SearchResult[]>) | null = null;
    private embeddingService: EmbeddingService | null = null;

    constructor(config?: Partial<AdvancedSearchConfig>) {
        this.config = { ...getDefaultConfig(), ...config };

        this.expansionService = new QueryExpansionService({
            ollamaUrl: this.config.ollamaUrl,
            llmModel: this.config.queryExpansion.llmModel
        });

        this.rerankerService = new RerankerService({
            ollamaUrl: this.config.ollamaUrl,
            model: this.config.reranking.model,
            topK: this.config.reranking.topK
        });

        this.cache = getSearchCache(this.config.caching);
    }

    /**
     * Set search functions from ScimaxDb
     */
    setSearchFunctions(
        ftsSearch: (query: string, options?: { limit?: number }) => Promise<SearchResult[]>,
        semanticSearch: ((query: string, options?: { limit?: number }) => Promise<SearchResult[]>) | null,
        embeddingService: EmbeddingService | null
    ): void {
        this.ftsSearch = ftsSearch;
        this.semanticSearch = semanticSearch;
        this.embeddingService = embeddingService;
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<AdvancedSearchConfig>): void {
        this.config = { ...this.config, ...config };

        // Update services with new config
        this.expansionService = new QueryExpansionService({
            ollamaUrl: this.config.ollamaUrl,
            llmModel: this.config.queryExpansion.llmModel
        });

        this.rerankerService = new RerankerService({
            ollamaUrl: this.config.ollamaUrl,
            model: this.config.reranking.model,
            topK: this.config.reranking.topK
        });
    }

    /**
     * Get current search capabilities
     */
    async getCapabilities(): Promise<{
        fts: boolean;
        semantic: boolean;
        queryExpansionPRF: boolean;
        queryExpansionLLM: boolean;
        reranking: boolean;
    }> {
        const llmAvailable = await this.expansionService.checkOllamaAvailable();
        const rerankerAvailable = await this.rerankerService.isAvailable();

        return {
            fts: this.ftsSearch !== null,
            semantic: this.semanticSearch !== null && this.embeddingService !== null,
            queryExpansionPRF: true,  // Always available
            queryExpansionLLM: llmAvailable,
            reranking: rerankerAvailable
        };
    }

    /**
     * Determine effective search mode based on capabilities
     */
    async getEffectiveMode(requestedMode: SearchMode): Promise<SearchMode> {
        const caps = await this.getCapabilities();

        switch (requestedMode) {
            case 'advanced':
                // Fall back to hybrid if reranking unavailable
                if (!caps.reranking) return caps.semantic ? 'hybrid' : 'fast';
                return 'advanced';

            case 'hybrid':
                // Fall back to fast if semantic unavailable
                if (!caps.semantic) return 'fast';
                return 'hybrid';

            case 'semantic':
                // Fall back to fast if semantic unavailable
                if (!caps.semantic) return 'fast';
                return 'semantic';

            case 'fast':
            default:
                return 'fast';
        }
    }

    /**
     * Main search method
     */
    async search(
        query: string,
        options?: AdvancedSearchOptions,
        onProgress?: SearchProgressCallback
    ): Promise<AdvancedSearchResult[]> {
        if (!this.ftsSearch) {
            throw new Error('Search functions not initialized');
        }

        const mode = options?.mode ?? this.config.defaultMode;
        const effectiveMode = await this.getEffectiveMode(mode);
        const limit = options?.limit ?? this.config.defaultLimit;

        log.debug(`Advanced search: mode=${mode}, effective=${effectiveMode}, query="${query}"`);

        switch (effectiveMode) {
            case 'fast':
                return this.searchFast(query, limit);

            case 'semantic':
                return this.searchSemantic(query, limit);

            case 'hybrid':
                return this.searchHybrid(query, { ...options, limit });

            case 'advanced':
                return this.searchAdvanced(query, { ...options, limit }, onProgress);

            default:
                return this.searchFast(query, limit);
        }
    }

    /**
     * Fast search - FTS5 only
     */
    private async searchFast(query: string, limit: number): Promise<AdvancedSearchResult[]> {
        if (!this.ftsSearch) return [];

        const results = await this.ftsSearch(query, { limit });
        return results.map(r => ({
            ...r,
            retrievalMethod: 'fts' as const
        }));
    }

    /**
     * Semantic search - Vector only
     */
    private async searchSemantic(query: string, limit: number): Promise<AdvancedSearchResult[]> {
        if (!this.semanticSearch) return this.searchFast(query, limit);

        const results = await this.semanticSearch(query, { limit });
        return results.map(r => ({
            ...r,
            retrievalMethod: 'vector' as const
        }));
    }

    /**
     * Hybrid search - FTS + Vector with weighted RRF
     */
    private async searchHybrid(
        query: string,
        options?: AdvancedSearchOptions
    ): Promise<AdvancedSearchResult[]> {
        if (!this.ftsSearch) return [];

        const limit = options?.limit ?? this.config.defaultLimit;
        const ftsWeight = options?.ftsWeight ?? this.config.hybrid.ftsWeight;
        const vectorWeight = options?.vectorWeight ?? this.config.hybrid.vectorWeight;

        // Parallel retrieval
        const [ftsResults, vectorResults] = await Promise.all([
            this.ftsSearch(query, { limit: limit * 2 }),
            this.semanticSearch ? this.semanticSearch(query, { limit: limit * 2 }) : Promise.resolve([])
        ]);

        // If no vector results, just return FTS
        if (vectorResults.length === 0) {
            return ftsResults.slice(0, limit).map(r => ({
                ...r,
                retrievalMethod: 'fts' as const
            }));
        }

        // Weighted RRF fusion
        const sources: RRFSource[] = [
            { results: ftsResults, weight: ftsWeight, type: 'fts', isOriginalQuery: true },
            { results: vectorResults, weight: vectorWeight, type: 'vector', isOriginalQuery: true }
        ];

        const fused = weightedRRF(sources, {
            k: this.config.hybrid.k,
            applyTopBonus: this.config.hybrid.usePositionBonus,
            normalizeFirst: true
        });

        return deduplicateResults(fused).slice(0, limit).map(r => ({
            ...r,
            querySource: 'original' as const
        }));
    }

    /**
     * Advanced search - Full pipeline with expansion and reranking
     */
    private async searchAdvanced(
        query: string,
        options?: AdvancedSearchOptions,
        onProgress?: SearchProgressCallback
    ): Promise<AdvancedSearchResult[]> {
        if (!this.ftsSearch) return [];

        const limit = options?.limit ?? this.config.defaultLimit;
        const doExpand = options?.expandQuery ?? this.config.queryExpansion.enabled;
        const doRerank = options?.rerank ?? this.config.reranking.enabled;
        const expansionMethod = options?.expansionMethod ?? this.config.queryExpansion.method;

        onProgress?.('Initializing', 0, 4);

        // Step 1: Query Expansion
        let expandedQueries: ExpandedQuery[] = [{ query, weight: 2.0, source: 'original' }];

        if (doExpand) {
            onProgress?.('Expanding query', 1, 4);

            // For PRF, we need initial results first
            if (expansionMethod === 'prf' || expansionMethod === 'both') {
                const initialResults = await this.ftsSearch(query, { limit: this.config.queryExpansion.prfTopK });
                const topContents = initialResults.map(r => r.preview || '');

                expandedQueries = await this.expansionService.expandQuery(query, topContents, {
                    method: expansionMethod,
                    prfTermCount: this.config.queryExpansion.prfTermCount,
                    maxVariants: 3
                });
            } else {
                // LLM-only expansion
                expandedQueries = await this.expansionService.expandQuery(query, [], {
                    method: 'llm',
                    maxVariants: 3
                });
            }

            log.debug(`Query expansion: ${expandedQueries.length} variants`);
        }

        // Step 2: Parallel retrieval for all query variants
        onProgress?.('Retrieving results', 2, 4);

        const allSources: RRFSource[] = [];

        for (const eq of expandedQueries) {
            const [ftsResults, vectorResults] = await Promise.all([
                this.ftsSearch(eq.query, { limit: limit * 2 }),
                this.semanticSearch ? this.semanticSearch(eq.query, { limit: limit * 2 }) : Promise.resolve([])
            ]);

            // Tag results with query source
            const taggedFts = ftsResults.map(r => ({ ...r, querySource: eq.source }));
            const taggedVector = vectorResults.map(r => ({ ...r, querySource: eq.source }));

            allSources.push({
                results: taggedFts as SearchResult[],
                weight: this.config.hybrid.ftsWeight * eq.weight,
                type: 'fts',
                isOriginalQuery: eq.source === 'original'
            });

            if (vectorResults.length > 0) {
                allSources.push({
                    results: taggedVector as SearchResult[],
                    weight: this.config.hybrid.vectorWeight * eq.weight,
                    type: 'vector',
                    isOriginalQuery: eq.source === 'original'
                });
            }
        }

        // Step 3: Weighted RRF fusion
        onProgress?.('Fusing results', 3, 4);

        const fused = weightedRRF(allSources, {
            k: this.config.hybrid.k,
            applyTopBonus: this.config.hybrid.usePositionBonus,
            normalizeFirst: true,
            originalQueryMultiplier: 2.0
        });

        const deduplicated = deduplicateResults(fused);

        // Step 4: Reranking (optional)
        if (doRerank) {
            onProgress?.('Reranking', 4, 4);

            const reranked = await this.rerankerService.rerank(query, deduplicated, {
                topK: this.config.reranking.topK,
                usePositionBlending: this.config.reranking.usePositionBlending
            });

            return reranked.slice(0, limit).map(r => ({
                ...r,
                rerankerScore: (r as RerankedResult).rerankerScore,
                retrievalRank: (r as RerankedResult).retrievalRank
            })) as AdvancedSearchResult[];
        }

        return deduplicated.slice(0, limit) as AdvancedSearchResult[];
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): ReturnType<SearchCache['getStats']> {
        return this.cache.getStats();
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.cache.dispose();
    }
}

/**
 * Singleton instance
 */
let globalEngine: AdvancedSearchEngine | null = null;

/**
 * Get or create the global search engine
 */
export function getAdvancedSearchEngine(): AdvancedSearchEngine {
    if (!globalEngine) {
        globalEngine = new AdvancedSearchEngine(loadConfig());
    }
    return globalEngine;
}

/**
 * Reset the global search engine (for testing or config changes)
 */
export function resetAdvancedSearchEngine(): void {
    globalEngine?.dispose();
    globalEngine = null;
}
