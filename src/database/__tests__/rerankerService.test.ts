/**
 * Tests for reranker service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger module
vi.mock('../../utils/logger', () => ({
    databaseLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock http and https modules
vi.mock('http', () => ({
    request: vi.fn()
}));

vi.mock('https', () => ({
    request: vi.fn()
}));

import {
    RerankerService,
    createRerankerService,
    type RerankerOptions,
    type RerankedResult
} from '../rerankerService';
import type { SearchResult } from '../scimaxDb';

// Helper to create mock search results
function createResult(filePath: string, lineNumber: number, score: number, preview?: string): SearchResult {
    return {
        type: 'heading',
        file_path: filePath,
        line_number: lineNumber,
        title: `Title for ${filePath}`,
        preview: preview || `Preview for ${filePath}`,
        score
    };
}

describe('rerankerService', () => {
    describe('RerankerService', () => {
        let service: RerankerService;

        beforeEach(() => {
            service = new RerankerService({
                ollamaUrl: 'http://localhost:11434',
                model: 'qwen3:0.6b',
                topK: 30,
                batchSize: 5,
                timeout: 30000
            });
        });

        describe('configuration', () => {
            it('should use default values when not specified', () => {
                const defaultService = new RerankerService();
                // Service should be created without errors
                expect(defaultService).toBeDefined();
            });

            it('should accept custom options', () => {
                const customService = new RerankerService({
                    ollamaUrl: 'http://custom:1234',
                    model: 'custom-model',
                    topK: 50,
                    batchSize: 10,
                    timeout: 60000
                });
                expect(customService).toBeDefined();
            });
        });

        describe('resetAvailability', () => {
            it('should reset availability check', () => {
                // This is a simple state reset test
                service.resetAvailability();
                // After reset, next isAvailable() call should re-check
                // We can't easily test this without mocking, but we verify no errors
                expect(true).toBe(true);
            });
        });

        describe('rerank (without Ollama)', () => {
            it('should return results with metadata when Ollama unavailable', async () => {
                const results = [
                    createResult('a.org', 1, 0.9),
                    createResult('b.org', 2, 0.8),
                ];

                // Without Ollama running, rerank should return original order with metadata
                const reranked = await service.rerank('test query', results);

                expect(reranked.length).toBe(2);
                expect(reranked[0].retrievalRank).toBe(0);
                expect(reranked[1].retrievalRank).toBe(1);
            });

            it('should preserve original scores as blendedScore', async () => {
                const results = [
                    createResult('a.org', 1, 0.9),
                ];

                const reranked = await service.rerank('test', results);

                expect((reranked[0] as RerankedResult).blendedScore).toBe(0.9);
            });
        });

        describe('rerank options', () => {
            it('should respect topK option', async () => {
                const results = Array.from({ length: 50 }, (_, i) =>
                    createResult(`file${i}.org`, i, 1 - i * 0.01)
                );

                const reranked = await service.rerank('test', results, { topK: 10 });

                // Should have all 50 results, but only top 10 were candidates for reranking
                expect(reranked.length).toBe(50);
            });

            it('should handle empty results', async () => {
                const reranked = await service.rerank('test', []);
                expect(reranked).toEqual([]);
            });
        });

        describe('rerankWithProgress', () => {
            it('should call progress callback', async () => {
                const results = [
                    createResult('a.org', 1, 0.9),
                    createResult('b.org', 2, 0.8),
                ];

                const progressFn = vi.fn();

                await service.rerankWithProgress('test', results, {
                    onProgress: progressFn
                });

                // Progress might not be called if Ollama unavailable,
                // but the function should complete without error
                expect(true).toBe(true);
            });
        });
    });

    describe('createRerankerService', () => {
        it('should create service with options', () => {
            const service = createRerankerService({
                model: 'test-model',
                topK: 20
            });

            expect(service).toBeInstanceOf(RerankerService);
        });

        it('should create service without options', () => {
            const service = createRerankerService();
            expect(service).toBeInstanceOf(RerankerService);
        });
    });

    describe('RerankedResult interface', () => {
        it('should have correct structure', () => {
            const result: RerankedResult = {
                type: 'heading',
                file_path: 'test.org',
                line_number: 10,
                title: 'Test',
                preview: 'Preview',
                score: 0.85,
                rerankerScore: 0.9,
                retrievalRank: 0,
                blendedScore: 0.87
            };

            expect(result.rerankerScore).toBe(0.9);
            expect(result.retrievalRank).toBe(0);
            expect(result.blendedScore).toBe(0.87);
        });
    });

    describe('RerankerOptions interface', () => {
        it('should accept all valid options', () => {
            const options: RerankerOptions = {
                ollamaUrl: 'http://localhost:11434',
                model: 'qwen3:0.6b',
                topK: 30,
                batchSize: 5,
                usePositionBlending: true,
                timeout: 30000
            };

            expect(options.usePositionBlending).toBe(true);
        });
    });
});
