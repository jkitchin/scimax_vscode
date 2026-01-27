/**
 * Search cache module for SOTA search
 *
 * Caches expensive operations:
 * - Query embeddings
 * - LLM query expansion results
 * - Reranker scores
 *
 * Uses in-memory LRU cache with configurable TTL.
 */

import * as crypto from 'crypto';
import { databaseLogger as log } from '../utils/logger';

export interface CacheOptions {
    maxEntries?: number;        // Max cache entries (default: 1000)
    ttlSeconds?: number;        // Time-to-live in seconds (default: 900 = 15 min)
    enabled?: boolean;          // Enable/disable cache (default: true)
}

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    hits: number;
}

/**
 * Generic LRU cache with TTL
 */
export class LRUCache<T> {
    private cache: Map<string, CacheEntry<T>>;
    private maxEntries: number;
    private ttlMs: number;
    private enabled: boolean;
    private stats = { hits: 0, misses: 0, evictions: 0 };

    constructor(options?: CacheOptions) {
        this.cache = new Map();
        this.maxEntries = options?.maxEntries ?? 1000;
        this.ttlMs = (options?.ttlSeconds ?? 900) * 1000;
        this.enabled = options?.enabled ?? true;
    }

    /**
     * Get cached value
     */
    get(key: string): T | undefined {
        if (!this.enabled) {
            this.stats.misses++;
            return undefined;
        }

        const entry = this.cache.get(key);
        if (!entry) {
            this.stats.misses++;
            return undefined;
        }

        // Check TTL
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            this.stats.misses++;
            return undefined;
        }

        // Update access (LRU behavior)
        entry.hits++;
        this.cache.delete(key);
        this.cache.set(key, entry);

        this.stats.hits++;
        return entry.value;
    }

    /**
     * Set cached value
     */
    set(key: string, value: T): void {
        if (!this.enabled) return;

        // Evict if at capacity
        if (this.cache.size >= this.maxEntries) {
            // Remove oldest entry (first in map iteration order)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
                this.stats.evictions++;
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            hits: 0
        });
    }

    /**
     * Check if key exists and is valid
     */
    has(key: string): boolean {
        if (!this.enabled) return false;

        const entry = this.cache.get(key);
        if (!entry) return false;

        // Check TTL
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete entry
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0 };
    }

    /**
     * Get cache statistics
     */
    getStats(): { hits: number; misses: number; evictions: number; size: number; hitRate: number } {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? this.stats.hits / total : 0;
        return {
            ...this.stats,
            size: this.cache.size,
            hitRate
        };
    }

    /**
     * Enable or disable cache
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.clear();
        }
    }

    /**
     * Cleanup expired entries
     */
    cleanup(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > this.ttlMs) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        return cleaned;
    }
}

/**
 * Search-specific cache manager
 */
export class SearchCache {
    private embeddingCache: LRUCache<number[]>;
    private expansionCache: LRUCache<string[]>;
    private rerankerCache: LRUCache<number>;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(options?: CacheOptions) {
        const cacheOptions = {
            maxEntries: options?.maxEntries ?? 500,
            ttlSeconds: options?.ttlSeconds ?? 900,
            enabled: options?.enabled ?? true
        };

        this.embeddingCache = new LRUCache(cacheOptions);
        this.expansionCache = new LRUCache(cacheOptions);
        this.rerankerCache = new LRUCache({
            ...cacheOptions,
            maxEntries: (cacheOptions.maxEntries || 500) * 2  // More reranker entries
        });

        // Start periodic cleanup
        if (cacheOptions.enabled) {
            this.startCleanup();
        }
    }

    /**
     * Generate cache key from inputs
     */
    private hash(...inputs: string[]): string {
        return crypto
            .createHash('sha256')
            .update(inputs.join('|'))
            .digest('hex')
            .slice(0, 16);
    }

    // ==================== Embedding Cache ====================

    /**
     * Get cached query embedding
     */
    getEmbedding(query: string, model: string): number[] | undefined {
        const key = this.hash('emb', model, query);
        return this.embeddingCache.get(key);
    }

    /**
     * Cache query embedding
     */
    setEmbedding(query: string, model: string, embedding: number[]): void {
        const key = this.hash('emb', model, query);
        this.embeddingCache.set(key, embedding);
    }

    // ==================== Query Expansion Cache ====================

    /**
     * Get cached query expansions
     */
    getExpansion(query: string, method: string): string[] | undefined {
        const key = this.hash('exp', method, query);
        return this.expansionCache.get(key);
    }

    /**
     * Cache query expansions
     */
    setExpansion(query: string, method: string, expansions: string[]): void {
        const key = this.hash('exp', method, query);
        this.expansionCache.set(key, expansions);
    }

    // ==================== Reranker Cache ====================

    /**
     * Get cached reranker score
     */
    getRerankerScore(query: string, documentHash: string): number | undefined {
        const key = this.hash('rer', query, documentHash);
        return this.rerankerCache.get(key);
    }

    /**
     * Cache reranker score
     */
    setRerankerScore(query: string, documentHash: string, score: number): void {
        const key = this.hash('rer', query, documentHash);
        this.rerankerCache.set(key, score);
    }

    /**
     * Generate document hash for reranker cache
     */
    hashDocument(content: string): string {
        return crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .slice(0, 16);
    }

    // ==================== Management ====================

    /**
     * Get combined cache statistics
     */
    getStats(): {
        embedding: ReturnType<LRUCache<any>['getStats']>;
        expansion: ReturnType<LRUCache<any>['getStats']>;
        reranker: ReturnType<LRUCache<any>['getStats']>;
    } {
        return {
            embedding: this.embeddingCache.getStats(),
            expansion: this.expansionCache.getStats(),
            reranker: this.rerankerCache.getStats()
        };
    }

    /**
     * Clear all caches
     */
    clear(): void {
        this.embeddingCache.clear();
        this.expansionCache.clear();
        this.rerankerCache.clear();
        log.debug('Search cache cleared');
    }

    /**
     * Enable or disable all caches
     */
    setEnabled(enabled: boolean): void {
        this.embeddingCache.setEnabled(enabled);
        this.expansionCache.setEnabled(enabled);
        this.rerankerCache.setEnabled(enabled);

        if (enabled) {
            this.startCleanup();
        } else {
            this.stopCleanup();
        }
    }

    /**
     * Start periodic cleanup of expired entries
     */
    private startCleanup(): void {
        if (this.cleanupInterval) return;

        // Cleanup every 5 minutes
        this.cleanupInterval = setInterval(() => {
            const embCleaned = this.embeddingCache.cleanup();
            const expCleaned = this.expansionCache.cleanup();
            const rerCleaned = this.rerankerCache.cleanup();

            if (embCleaned + expCleaned + rerCleaned > 0) {
                log.debug('Search cache cleanup', {
                    embedding: embCleaned,
                    expansion: expCleaned,
                    reranker: rerCleaned
                });
            }
        }, 5 * 60 * 1000);
    }

    /**
     * Stop periodic cleanup
     */
    private stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Dispose cache manager
     */
    dispose(): void {
        this.stopCleanup();
        this.clear();
    }
}

/**
 * Singleton search cache instance
 */
let globalSearchCache: SearchCache | null = null;

/**
 * Get or create the global search cache
 */
export function getSearchCache(options?: CacheOptions): SearchCache {
    if (!globalSearchCache) {
        globalSearchCache = new SearchCache(options);
    }
    return globalSearchCache;
}

/**
 * Reset global search cache (for testing)
 */
export function resetSearchCache(): void {
    globalSearchCache?.dispose();
    globalSearchCache = null;
}
