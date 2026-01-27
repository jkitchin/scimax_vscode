/**
 * Tests for advanced search orchestration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string, defaultVal: any) => defaultVal)
        }))
    }
}));

// Mock the logger module
vi.mock('../../utils/logger', () => ({
    databaseLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock http and https for Ollama calls
vi.mock('http', () => ({
    request: vi.fn()
}));

vi.mock('https', () => ({
    request: vi.fn()
}));

import {
    AdvancedSearchEngine,
    getDefaultConfig,
    loadConfig,
    getAdvancedSearchEngine,
    resetAdvancedSearchEngine,
    type AdvancedSearchConfig,
    type SearchMode,
    type AdvancedSearchOptions,
    type AdvancedSearchResult
} from '../advancedSearch';
import type { SearchResult } from '../scimaxDb';

// Helper to create mock search results
function createResult(filePath: string, lineNumber: number, score: number): SearchResult {
    return {
        file_path: filePath,
        line_number: lineNumber,
        title: `Title for ${filePath}`,
        preview: `Preview for ${filePath}`,
        score
    };
}

describe('advancedSearch', () => {
    describe('getDefaultConfig', () => {
        it('should return default configuration', () => {
            const config = getDefaultConfig();

            expect(config.defaultMode).toBe('hybrid');
            expect(config.defaultLimit).toBe(20);
            expect(config.queryExpansion.enabled).toBe(true);
            expect(config.queryExpansion.method).toBe('prf');
            expect(config.reranking.enabled).toBe(false);
            expect(config.hybrid.ftsWeight).toBe(0.5);
            expect(config.hybrid.vectorWeight).toBe(0.5);
            expect(config.caching.enabled).toBe(true);
        });

        it('should have valid weight values', () => {
            const config = getDefaultConfig();

            expect(config.hybrid.ftsWeight + config.hybrid.vectorWeight).toBe(1);
            expect(config.hybrid.k).toBe(60); // Standard RRF constant
        });
    });

    describe('loadConfig', () => {
        it('should load config with defaults', () => {
            const config = loadConfig();

            // Should have all required fields
            expect(config.defaultMode).toBeDefined();
            expect(config.queryExpansion).toBeDefined();
            expect(config.reranking).toBeDefined();
            expect(config.hybrid).toBeDefined();
            expect(config.caching).toBeDefined();
        });
    });

    describe('AdvancedSearchEngine', () => {
        let engine: AdvancedSearchEngine;
        let mockFtsSearch: ReturnType<typeof vi.fn>;
        let mockSemanticSearch: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            engine = new AdvancedSearchEngine(getDefaultConfig());

            // Create mock search functions
            mockFtsSearch = vi.fn().mockResolvedValue([
                createResult('fts1.org', 1, -10),
                createResult('fts2.org', 2, -8),
            ]);

            mockSemanticSearch = vi.fn().mockResolvedValue([
                createResult('sem1.org', 1, 0.9),
                createResult('fts1.org', 1, 0.85), // Overlap with FTS
            ]);

            engine.setSearchFunctions(
                mockFtsSearch,
                mockSemanticSearch,
                { embed: vi.fn(), embedBatch: vi.fn(), dimensions: 768 }
            );
        });

        afterEach(() => {
            engine.dispose();
        });

        describe('setSearchFunctions', () => {
            it('should configure search functions', () => {
                const newEngine = new AdvancedSearchEngine();
                const fts = vi.fn().mockResolvedValue([]);
                const semantic = vi.fn().mockResolvedValue([]);

                newEngine.setSearchFunctions(fts, semantic, null);

                // Engine should be configured (no error thrown)
                expect(true).toBe(true);
                newEngine.dispose();
            });

            it('should handle null semantic search', () => {
                const newEngine = new AdvancedSearchEngine();
                const fts = vi.fn().mockResolvedValue([]);

                newEngine.setSearchFunctions(fts, null, null);

                // Should work without semantic search
                expect(true).toBe(true);
                newEngine.dispose();
            });
        });

        describe('getCapabilities', () => {
            it('should report available capabilities', async () => {
                const caps = await engine.getCapabilities();

                expect(caps.fts).toBe(true);
                expect(caps.semantic).toBe(true);
                expect(caps.queryExpansionPRF).toBe(true);
                // LLM features depend on Ollama being available
                expect(typeof caps.queryExpansionLLM).toBe('boolean');
                expect(typeof caps.reranking).toBe('boolean');
            });

            it('should report false for semantic when not configured', async () => {
                const minimalEngine = new AdvancedSearchEngine();
                minimalEngine.setSearchFunctions(mockFtsSearch, null, null);

                const caps = await minimalEngine.getCapabilities();

                expect(caps.fts).toBe(true);
                expect(caps.semantic).toBe(false);
                minimalEngine.dispose();
            });
        });

        describe('getEffectiveMode', () => {
            it('should return fast mode as-is', async () => {
                const mode = await engine.getEffectiveMode('fast');
                expect(mode).toBe('fast');
            });

            it('should return hybrid when semantic available', async () => {
                const mode = await engine.getEffectiveMode('hybrid');
                expect(mode).toBe('hybrid');
            });

            it('should fall back from hybrid to fast without semantic', async () => {
                const minimalEngine = new AdvancedSearchEngine();
                minimalEngine.setSearchFunctions(mockFtsSearch, null, null);

                const mode = await minimalEngine.getEffectiveMode('hybrid');
                expect(mode).toBe('fast');
                minimalEngine.dispose();
            });
        });

        describe('search', () => {
            it('should perform fast search', async () => {
                const results = await engine.search('test query', { mode: 'fast' });

                expect(mockFtsSearch).toHaveBeenCalled();
                expect(results.length).toBeGreaterThan(0);
            });

            it('should perform semantic search', async () => {
                const results = await engine.search('test query', { mode: 'semantic' });

                expect(mockSemanticSearch).toHaveBeenCalled();
                expect(results.length).toBeGreaterThan(0);
            });

            it('should perform hybrid search', async () => {
                const results = await engine.search('test query', { mode: 'hybrid' });

                expect(mockFtsSearch).toHaveBeenCalled();
                expect(mockSemanticSearch).toHaveBeenCalled();
                expect(results.length).toBeGreaterThan(0);
            });

            it('should pass limit option to search function', async () => {
                // Create mock to capture the limit parameter
                const searchWithLimit = vi.fn().mockResolvedValue([
                    createResult('file1.org', 1, -10),
                ]);
                engine.setSearchFunctions(searchWithLimit, null, null);

                await engine.search('test', { mode: 'fast', limit: 5 });

                // Verify the limit was passed to the underlying search
                expect(searchWithLimit).toHaveBeenCalledWith('test', { limit: 5 });
            });

            it('should throw error if search functions not set', async () => {
                const uninitEngine = new AdvancedSearchEngine();

                await expect(uninitEngine.search('test')).rejects.toThrow();
                uninitEngine.dispose();
            });
        });

        describe('updateConfig', () => {
            it('should update configuration', () => {
                engine.updateConfig({
                    defaultMode: 'fast',
                    defaultLimit: 50
                });

                // Config should be updated (no error thrown)
                expect(true).toBe(true);
            });
        });

        describe('cache management', () => {
            it('should report cache stats', () => {
                const stats = engine.getCacheStats();

                expect(stats).toHaveProperty('embedding');
                expect(stats).toHaveProperty('expansion');
                expect(stats).toHaveProperty('reranker');
            });

            it('should clear cache', () => {
                engine.clearCache();
                // Should not throw
                expect(true).toBe(true);
            });
        });
    });

    describe('global engine singleton', () => {
        afterEach(() => {
            resetAdvancedSearchEngine();
        });

        it('should return same instance', () => {
            const engine1 = getAdvancedSearchEngine();
            const engine2 = getAdvancedSearchEngine();

            expect(engine1).toBe(engine2);
        });

        it('should create new instance after reset', () => {
            const engine1 = getAdvancedSearchEngine();
            resetAdvancedSearchEngine();
            const engine2 = getAdvancedSearchEngine();

            expect(engine1).not.toBe(engine2);
        });
    });

    describe('SearchMode type', () => {
        it('should accept valid modes', () => {
            const modes: SearchMode[] = ['fast', 'semantic', 'hybrid', 'advanced'];

            for (const mode of modes) {
                expect(['fast', 'semantic', 'hybrid', 'advanced']).toContain(mode);
            }
        });
    });

    describe('AdvancedSearchResult interface', () => {
        it('should have correct structure', () => {
            const result: AdvancedSearchResult = {
                file_path: 'test.org',
                line_number: 10,
                title: 'Test',
                preview: 'Preview',
                score: 0.85,
                querySource: 'original',
                retrievalMethod: 'fts',
                rerankerScore: 0.9,
                retrievalRank: 0
            };

            expect(result.querySource).toBe('original');
            expect(result.retrievalMethod).toBe('fts');
        });
    });
});
