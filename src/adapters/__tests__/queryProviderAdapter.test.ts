/**
 * Tests for QueryProviderAdapter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    queryProviderRegistry,
    QueryProvider,
    QueryParams,
    QueryResponse
} from '../queryProviderAdapter';

// Mock vscode
vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() { this.callback(); }
    }
}));

describe('QueryProviderRegistry', () => {
    beforeEach(() => {
        queryProviderRegistry.clear();
    });

    describe('register', () => {
        it('should register a provider', () => {
            const provider: QueryProvider = {
                queryType: 'test-query',
                name: 'Test Query',
                execute: async () => ({ results: [] })
            };

            const disposable = queryProviderRegistry.register(provider);

            expect(queryProviderRegistry.hasProvider('test-query')).toBe(true);
            expect(queryProviderRegistry.getQueryTypes()).toContain('test-query');

            disposable.dispose();
            expect(queryProviderRegistry.hasProvider('test-query')).toBe(false);
        });

        it('should throw on duplicate queryType', () => {
            const provider: QueryProvider = {
                queryType: 'test-query',
                name: 'Test Query',
                execute: async () => ({ results: [] })
            };

            queryProviderRegistry.register(provider);

            expect(() => queryProviderRegistry.register(provider)).toThrow(/already registered/);
        });

        it('should throw on missing queryType', () => {
            const provider = {
                name: 'Test Query',
                execute: async () => ({ results: [] })
            } as any;

            expect(() => queryProviderRegistry.register(provider)).toThrow(/must have a queryType/);
        });
    });

    describe('getAllProviders', () => {
        it('should return all registered providers', () => {
            queryProviderRegistry.register({
                queryType: 'query-1',
                name: 'Query 1',
                execute: async () => ({ results: [] })
            });

            queryProviderRegistry.register({
                queryType: 'query-2',
                name: 'Query 2',
                execute: async () => ({ results: [] })
            });

            const providers = queryProviderRegistry.getAllProviders();
            expect(providers).toHaveLength(2);
            expect(providers.map(p => p.queryType)).toContain('query-1');
            expect(providers.map(p => p.queryType)).toContain('query-2');
        });
    });

    describe('executeQuery', () => {
        it('should execute a registered query', async () => {
            queryProviderRegistry.register({
                queryType: 'test-query',
                name: 'Test Query',
                execute: async (params) => ({
                    results: [
                        { type: 'test', id: '1', label: `Result for ${params.search}` }
                    ]
                })
            });

            const response = await queryProviderRegistry.executeQuery(
                'test-query',
                { search: 'hello' },
                {}
            );

            expect(response.results).toHaveLength(1);
            expect(response.results[0].label).toBe('Result for hello');
            expect(response.executionTimeMs).toBeDefined();
        });

        it('should throw for unknown query type', async () => {
            await expect(
                queryProviderRegistry.executeQuery('unknown-query', {}, {})
            ).rejects.toThrow(/Unknown query type/);
        });

        it('should validate parameters if validator exists', async () => {
            queryProviderRegistry.register({
                queryType: 'validated-query',
                name: 'Validated Query',
                validate: (params) => {
                    if (!params.required) {
                        return 'Missing required parameter';
                    }
                    return true;
                },
                execute: async () => ({ results: [] })
            });

            await expect(
                queryProviderRegistry.executeQuery('validated-query', {}, {})
            ).rejects.toThrow(/Missing required parameter/);

            const response = await queryProviderRegistry.executeQuery(
                'validated-query',
                { required: true },
                {}
            );
            expect(response.results).toEqual([]);
        });

        it('should add execution time if not provided', async () => {
            queryProviderRegistry.register({
                queryType: 'slow-query',
                name: 'Slow Query',
                execute: async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return { results: [] };
                }
            });

            const response = await queryProviderRegistry.executeQuery('slow-query', {}, {});
            expect(response.executionTimeMs).toBeGreaterThanOrEqual(10);
        });

        it('should preserve execution time if provided', async () => {
            queryProviderRegistry.register({
                queryType: 'timed-query',
                name: 'Timed Query',
                execute: async () => ({
                    results: [],
                    executionTimeMs: 42
                })
            });

            const response = await queryProviderRegistry.executeQuery('timed-query', {}, {});
            expect(response.executionTimeMs).toBe(42);
        });
    });

    describe('built-in providers', () => {
        // These tests would require a mock database
        // For now, just test that the providers are importable
        it('should export graphPathProvider', async () => {
            const { graphPathProvider } = await import('../queryProviderAdapter');
            expect(graphPathProvider.queryType).toBe('graph-path');
            expect(graphPathProvider.validate).toBeDefined();
        });

        it('should export relatedFilesProvider', async () => {
            const { relatedFilesProvider } = await import('../queryProviderAdapter');
            expect(relatedFilesProvider.queryType).toBe('related-files');
            expect(relatedFilesProvider.validate).toBeDefined();
        });

        it('should validate graphPathProvider params', async () => {
            const { graphPathProvider } = await import('../queryProviderAdapter');

            expect(graphPathProvider.validate!({})).toMatch(/from/);
            expect(graphPathProvider.validate!({ from: '/a.org' })).toMatch(/to/);
            expect(graphPathProvider.validate!({ from: '/a.org', to: '/b.org' })).toBe(true);
            expect(graphPathProvider.validate!({ from: '/a.org', to: '/b.org', maxHops: 3 })).toBe(true);
            expect(graphPathProvider.validate!({ from: '/a.org', to: '/b.org', maxHops: -1 })).toMatch(/maxHops/);
        });

        it('should validate relatedFilesProvider params', async () => {
            const { relatedFilesProvider } = await import('../queryProviderAdapter');

            expect(relatedFilesProvider.validate!({})).toMatch(/filePath/);
            expect(relatedFilesProvider.validate!({ filePath: '/test.org' })).toBe(true);
        });
    });
});
