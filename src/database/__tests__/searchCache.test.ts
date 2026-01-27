/**
 * Tests for search cache module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger module
vi.mock('../../utils/logger', () => ({
    databaseLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import {
    LRUCache,
    SearchCache,
    getSearchCache,
    resetSearchCache
} from '../searchCache';

describe('searchCache', () => {
    describe('LRUCache', () => {
        let cache: LRUCache<string>;

        beforeEach(() => {
            cache = new LRUCache({ maxEntries: 3, ttlSeconds: 60 });
        });

        it('should store and retrieve values', () => {
            cache.set('key1', 'value1');
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return undefined for missing keys', () => {
            expect(cache.get('nonexistent')).toBeUndefined();
        });

        it('should evict oldest entries when at capacity', () => {
            cache.set('a', '1');
            cache.set('b', '2');
            cache.set('c', '3');
            cache.set('d', '4'); // Should evict 'a'

            expect(cache.get('a')).toBeUndefined();
            expect(cache.get('b')).toBe('2');
            expect(cache.get('c')).toBe('3');
            expect(cache.get('d')).toBe('4');
        });

        it('should update LRU order on access', () => {
            cache.set('a', '1');
            cache.set('b', '2');
            cache.set('c', '3');

            // Access 'a' to make it most recently used
            cache.get('a');

            // Add new item - should evict 'b' (oldest non-accessed)
            cache.set('d', '4');

            expect(cache.get('a')).toBe('1'); // Still present
            expect(cache.get('b')).toBeUndefined(); // Evicted
        });

        it('should expire entries after TTL', async () => {
            const shortCache = new LRUCache<string>({ ttlSeconds: 0.1 });
            shortCache.set('key', 'value');

            expect(shortCache.get('key')).toBe('value');

            // Wait for TTL to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            expect(shortCache.get('key')).toBeUndefined();
        });

        it('should report has() correctly', () => {
            cache.set('key', 'value');
            expect(cache.has('key')).toBe(true);
            expect(cache.has('missing')).toBe(false);
        });

        it('should delete entries', () => {
            cache.set('key', 'value');
            expect(cache.delete('key')).toBe(true);
            expect(cache.get('key')).toBeUndefined();
        });

        it('should clear all entries', () => {
            cache.set('a', '1');
            cache.set('b', '2');
            cache.clear();

            expect(cache.get('a')).toBeUndefined();
            expect(cache.get('b')).toBeUndefined();
        });

        it('should track statistics', () => {
            cache.set('key', 'value');
            cache.get('key'); // Hit
            cache.get('key'); // Hit
            cache.get('missing'); // Miss

            const stats = cache.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.size).toBe(1);
            expect(stats.hitRate).toBeCloseTo(2/3);
        });

        it('should disable caching when setEnabled(false)', () => {
            cache.set('key', 'value');
            cache.setEnabled(false);

            expect(cache.get('key')).toBeUndefined();
            cache.set('new', 'value');
            expect(cache.get('new')).toBeUndefined();
        });

        it('should cleanup expired entries', async () => {
            const shortCache = new LRUCache<string>({ ttlSeconds: 0.1 });
            shortCache.set('key1', 'value1');
            shortCache.set('key2', 'value2');

            // Wait for TTL
            await new Promise(resolve => setTimeout(resolve, 150));

            const cleaned = shortCache.cleanup();
            expect(cleaned).toBe(2);
        });
    });

    describe('SearchCache', () => {
        let searchCache: SearchCache;

        beforeEach(() => {
            searchCache = new SearchCache({ ttlSeconds: 60, maxEntries: 100 });
        });

        afterEach(() => {
            searchCache.dispose();
        });

        describe('embedding cache', () => {
            it('should cache embeddings', () => {
                const embedding = [0.1, 0.2, 0.3];
                searchCache.setEmbedding('query', 'model', embedding);

                const cached = searchCache.getEmbedding('query', 'model');
                expect(cached).toEqual(embedding);
            });

            it('should differentiate by model', () => {
                searchCache.setEmbedding('query', 'model1', [1]);
                searchCache.setEmbedding('query', 'model2', [2]);

                expect(searchCache.getEmbedding('query', 'model1')).toEqual([1]);
                expect(searchCache.getEmbedding('query', 'model2')).toEqual([2]);
            });
        });

        describe('expansion cache', () => {
            it('should cache query expansions', () => {
                const expansions = ['query1', 'query2'];
                searchCache.setExpansion('original', 'prf', expansions);

                const cached = searchCache.getExpansion('original', 'prf');
                expect(cached).toEqual(expansions);
            });

            it('should differentiate by method', () => {
                searchCache.setExpansion('query', 'prf', ['prf1']);
                searchCache.setExpansion('query', 'llm', ['llm1']);

                expect(searchCache.getExpansion('query', 'prf')).toEqual(['prf1']);
                expect(searchCache.getExpansion('query', 'llm')).toEqual(['llm1']);
            });
        });

        describe('reranker cache', () => {
            it('should cache reranker scores', () => {
                searchCache.setRerankerScore('query', 'doc123', 0.85);

                const cached = searchCache.getRerankerScore('query', 'doc123');
                expect(cached).toBe(0.85);
            });

            it('should generate consistent document hashes', () => {
                const hash1 = searchCache.hashDocument('test content');
                const hash2 = searchCache.hashDocument('test content');
                const hash3 = searchCache.hashDocument('different content');

                expect(hash1).toBe(hash2);
                expect(hash1).not.toBe(hash3);
            });
        });

        describe('management', () => {
            it('should report combined stats', () => {
                searchCache.setEmbedding('q', 'm', [1]);
                searchCache.setExpansion('q', 'prf', ['e']);
                searchCache.setRerankerScore('q', 'd', 0.5);

                const stats = searchCache.getStats();

                expect(stats.embedding.size).toBe(1);
                expect(stats.expansion.size).toBe(1);
                expect(stats.reranker.size).toBe(1);
            });

            it('should clear all caches', () => {
                searchCache.setEmbedding('q', 'm', [1]);
                searchCache.setExpansion('q', 'prf', ['e']);
                searchCache.setRerankerScore('q', 'd', 0.5);

                searchCache.clear();

                expect(searchCache.getEmbedding('q', 'm')).toBeUndefined();
                expect(searchCache.getExpansion('q', 'prf')).toBeUndefined();
                expect(searchCache.getRerankerScore('q', 'd')).toBeUndefined();
            });

            it('should enable/disable all caches', () => {
                searchCache.setEmbedding('q', 'm', [1]);
                searchCache.setEnabled(false);

                expect(searchCache.getEmbedding('q', 'm')).toBeUndefined();
            });
        });
    });

    describe('global cache singleton', () => {
        beforeEach(() => {
            resetSearchCache();
        });

        afterEach(() => {
            resetSearchCache();
        });

        it('should return same instance', () => {
            const cache1 = getSearchCache();
            const cache2 = getSearchCache();

            expect(cache1).toBe(cache2);
        });

        it('should create new instance after reset', () => {
            const cache1 = getSearchCache();
            resetSearchCache();
            const cache2 = getSearchCache();

            expect(cache1).not.toBe(cache2);
        });
    });
});
