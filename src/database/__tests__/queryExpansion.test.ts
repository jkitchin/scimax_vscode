/**
 * Tests for query expansion module
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
    extractKeyTerms,
    QueryExpansionService,
    type ExpandedQuery
} from '../queryExpansion';

describe('queryExpansion', () => {
    describe('extractKeyTerms', () => {
        it('should extract frequent terms from texts', () => {
            const texts = [
                'Machine learning is a subset of artificial intelligence',
                'Neural networks are used in machine learning',
                'Deep learning uses neural networks'
            ];

            const terms = extractKeyTerms(texts, 'test query', 5);

            expect(terms.length).toBeGreaterThan(0);
            expect(terms.length).toBeLessThanOrEqual(5);
            // 'neural' and 'networks' should appear due to frequency
            expect(terms.some(t => t === 'neural' || t === 'networks' || t === 'learning')).toBe(true);
        });

        it('should exclude query terms from expansion', () => {
            const texts = ['Python programming is fun', 'Python code is clean'];
            const terms = extractKeyTerms(texts, 'python', 5);

            // 'python' should not be in the expanded terms
            expect(terms).not.toContain('python');
        });

        it('should exclude stopwords', () => {
            const texts = ['The quick brown fox', 'A fast red fox'];
            const terms = extractKeyTerms(texts, 'test', 10);

            // Common stopwords should not appear
            expect(terms).not.toContain('the');
            expect(terms).not.toContain('a');
        });

        it('should return empty array for empty texts', () => {
            const terms = extractKeyTerms([], 'query', 5);
            expect(terms).toEqual([]);
        });

        it('should limit number of terms', () => {
            const texts = [
                'alpha beta gamma delta epsilon zeta eta theta iota kappa'
            ];
            const terms = extractKeyTerms(texts, 'query', 3);
            expect(terms.length).toBeLessThanOrEqual(3);
        });
    });

    describe('QueryExpansionService', () => {
        let service: QueryExpansionService;

        beforeEach(() => {
            service = new QueryExpansionService({
                ollamaUrl: 'http://localhost:11434',
                llmModel: 'qwen3:1.7b'
            });
        });

        describe('expandQueryPRF', () => {
            it('should return original query when no results provided', () => {
                const expanded = service.expandQueryPRF('test query', []);

                expect(expanded.length).toBe(1);
                expect(expanded[0].query).toBe('test query');
                expect(expanded[0].weight).toBe(2.0);
                expect(expanded[0].source).toBe('original');
            });

            it('should create expanded query from top results', () => {
                const topContents = [
                    'Machine learning algorithms for classification',
                    'Neural network training techniques',
                    'Deep learning model optimization'
                ];

                const expanded = service.expandQueryPRF('AI', topContents);

                expect(expanded.length).toBe(2);
                expect(expanded[0].source).toBe('original');
                expect(expanded[1].source).toBe('prf');
                expect(expanded[1].query).toContain('AI'); // Original query included
                expect(expanded[1].weight).toBe(1.0);
            });

            it('should respect termCount option', () => {
                const topContents = [
                    'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'
                ];

                const expanded = service.expandQueryPRF('test', topContents, { termCount: 2 });

                // The expanded query should have limited additional terms
                const expandedQuery = expanded.find(e => e.source === 'prf');
                if (expandedQuery) {
                    const words = expandedQuery.query.split(' ');
                    // Original 'test' + up to 2 expansion terms
                    expect(words.length).toBeLessThanOrEqual(4);
                }
            });
        });

        describe('expandQuery', () => {
            it('should route to PRF method', async () => {
                const topContents = ['Content about testing'];

                const expanded = await service.expandQuery('test', topContents, {
                    method: 'prf',
                    prfTermCount: 3
                });

                expect(expanded.length).toBeGreaterThanOrEqual(1);
                expect(expanded[0].source).toBe('original');
            });

            it('should always include original query with 2x weight', async () => {
                const expanded = await service.expandQuery('test', [], {
                    method: 'prf'
                });

                const original = expanded.find(e => e.source === 'original');
                expect(original).toBeDefined();
                expect(original!.weight).toBe(2.0);
            });
        });
    });

    describe('ExpandedQuery interface', () => {
        it('should have correct structure', () => {
            const query: ExpandedQuery = {
                query: 'test query',
                weight: 2.0,
                source: 'original'
            };

            expect(query.query).toBe('test query');
            expect(query.weight).toBe(2.0);
            expect(query.source).toBe('original');
        });

        it('should accept all valid sources', () => {
            const sources: ExpandedQuery['source'][] = ['original', 'prf', 'llm'];

            for (const source of sources) {
                const query: ExpandedQuery = {
                    query: 'test',
                    weight: 1.0,
                    source
                };
                expect(query.source).toBe(source);
            }
        });
    });
});
