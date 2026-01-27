/**
 * Tests for score normalization and weighted RRF
 */

import { describe, it, expect } from 'vitest';
import {
    normalizeBM25Scores,
    normalizeVectorScores,
    getPositionWeight,
    blendScores,
    applyTopRankBonus,
    weightedRRF,
    deduplicateResults,
    type RRFSource
} from '../scoreNormalization';
import type { SearchResult } from '../scimaxDb';

// Helper to create mock search results
function createResult(filePath: string, lineNumber: number, score: number, distance?: number): SearchResult {
    return {
        type: 'heading',
        file_path: filePath,
        line_number: lineNumber,
        title: `Title for ${filePath}`,
        preview: `Preview for ${filePath}`,
        score,
        distance
    };
}

describe('scoreNormalization', () => {
    describe('normalizeBM25Scores', () => {
        it('should return empty array for empty input', () => {
            expect(normalizeBM25Scores([])).toEqual([]);
        });

        it('should normalize BM25 scores to 0-1 range', () => {
            const results = [
                createResult('a.org', 1, -10),  // Highest (most relevant)
                createResult('b.org', 2, -5),
                createResult('c.org', 3, -1),   // Lowest
            ];

            const normalized = normalizeBM25Scores(results);

            // All scores should be between 0 and 1
            for (const r of normalized) {
                expect(r.score).toBeGreaterThanOrEqual(0);
                expect(r.score).toBeLessThanOrEqual(1);
            }

            // Highest absolute value should be 1
            expect(normalized[0].score).toBe(1);
            // Lowest should be 0
            expect(normalized[2].score).toBe(0);
        });

        it('should handle uniform scores', () => {
            const results = [
                createResult('a.org', 1, -5),
                createResult('b.org', 2, -5),
            ];

            const normalized = normalizeBM25Scores(results);

            // All should be 1.0 when scores are uniform
            for (const r of normalized) {
                expect(r.score).toBe(1.0);
            }
        });
    });

    describe('normalizeVectorScores', () => {
        it('should return empty array for empty input', () => {
            expect(normalizeVectorScores([])).toEqual([]);
        });

        it('should convert distance to similarity', () => {
            const results = [
                createResult('a.org', 1, 0, 0),    // Distance 0 = perfect match
                createResult('b.org', 2, 0, 1),    // Distance 1 = 50% similar
                createResult('c.org', 3, 0, 2),    // Distance 2 = 0% similar
            ];

            const normalized = normalizeVectorScores(results);

            expect(normalized[0].score).toBe(1);    // 1 - 0/2 = 1
            expect(normalized[1].score).toBe(0.5);  // 1 - 1/2 = 0.5
            expect(normalized[2].score).toBe(0);    // 1 - 2/2 = 0
        });

        it('should clamp scores to 0-1 range', () => {
            const results = [
                createResult('a.org', 1, 1.5),  // Already a score > 1
                createResult('b.org', 2, -0.5), // Negative score
            ];

            const normalized = normalizeVectorScores(results);

            expect(normalized[0].score).toBe(1);  // Clamped to max
            expect(normalized[1].score).toBe(0);  // Clamped to min
        });
    });

    describe('getPositionWeight', () => {
        it('should return 75/25 for top 3 ranks', () => {
            expect(getPositionWeight(0)).toEqual({ retrievalWeight: 0.75, rerankerWeight: 0.25 });
            expect(getPositionWeight(1)).toEqual({ retrievalWeight: 0.75, rerankerWeight: 0.25 });
            expect(getPositionWeight(2)).toEqual({ retrievalWeight: 0.75, rerankerWeight: 0.25 });
            expect(getPositionWeight(3)).toEqual({ retrievalWeight: 0.75, rerankerWeight: 0.25 });
        });

        it('should return 60/40 for ranks 4-10', () => {
            expect(getPositionWeight(4)).toEqual({ retrievalWeight: 0.60, rerankerWeight: 0.40 });
            expect(getPositionWeight(10)).toEqual({ retrievalWeight: 0.60, rerankerWeight: 0.40 });
        });

        it('should return 40/60 for ranks 11+', () => {
            expect(getPositionWeight(11)).toEqual({ retrievalWeight: 0.40, rerankerWeight: 0.60 });
            expect(getPositionWeight(100)).toEqual({ retrievalWeight: 0.40, rerankerWeight: 0.60 });
        });
    });

    describe('blendScores', () => {
        it('should blend scores using position-aware weights', () => {
            // For rank 0 (top 3): 75% retrieval + 25% reranker
            const score = blendScores(0.8, 0.4, 0);
            expect(score).toBeCloseTo(0.8 * 0.75 + 0.4 * 0.25);
        });

        it('should give more weight to reranker for lower ranks', () => {
            const topScore = blendScores(0.5, 0.9, 0);
            const lowScore = blendScores(0.5, 0.9, 20);

            // Lower rank should have higher score because reranker is weighted more
            expect(lowScore).toBeGreaterThan(topScore);
        });
    });

    describe('applyTopRankBonus', () => {
        it('should apply 15% bonus for rank 0', () => {
            expect(applyTopRankBonus(1.0, 0)).toBeCloseTo(1.15);
        });

        it('should apply 10% bonus for rank 1', () => {
            expect(applyTopRankBonus(1.0, 1)).toBeCloseTo(1.10);
        });

        it('should apply 5% bonus for rank 2', () => {
            expect(applyTopRankBonus(1.0, 2)).toBeCloseTo(1.05);
        });

        it('should not apply bonus for rank 3+', () => {
            expect(applyTopRankBonus(1.0, 3)).toBe(1.0);
            expect(applyTopRankBonus(1.0, 10)).toBe(1.0);
        });
    });

    describe('weightedRRF', () => {
        it('should handle empty sources', () => {
            const result = weightedRRF([]);
            expect(result).toEqual([]);
        });

        it('should combine results from multiple sources', () => {
            const ftsResults = [
                createResult('a.org', 1, -10),
                createResult('b.org', 2, -5),
            ];
            const vectorResults = [
                createResult('b.org', 2, 0.9),  // Same as FTS result
                createResult('c.org', 3, 0.8),
            ];

            const sources: RRFSource[] = [
                { results: ftsResults, weight: 0.5, type: 'fts', isOriginalQuery: true },
                { results: vectorResults, weight: 0.5, type: 'vector', isOriginalQuery: true },
            ];

            const fused = weightedRRF(sources);

            // b.org appears in both, should have highest score
            const bResult = fused.find(r => r.file_path === 'b.org');
            const aResult = fused.find(r => r.file_path === 'a.org');

            expect(bResult).toBeDefined();
            expect(aResult).toBeDefined();
            expect(bResult!.score).toBeGreaterThan(aResult!.score);
        });

        it('should give original query 2x weight by default', () => {
            const originalResults = [createResult('a.org', 1, -10)];
            const expandedResults = [createResult('b.org', 2, -10)];

            const sources: RRFSource[] = [
                { results: originalResults, weight: 0.5, type: 'fts', isOriginalQuery: true },
                { results: expandedResults, weight: 0.5, type: 'fts', isOriginalQuery: false },
            ];

            const fused = weightedRRF(sources, { originalQueryMultiplier: 2.0 });

            const aScore = fused.find(r => r.file_path === 'a.org')!.score;
            const bScore = fused.find(r => r.file_path === 'b.org')!.score;

            // Original query result should have higher score
            expect(aScore).toBeGreaterThan(bScore);
        });

        it('should apply top rank bonuses when enabled', () => {
            const results = [
                createResult('a.org', 1, -10),
                createResult('b.org', 2, -9),
                createResult('c.org', 3, -8),
                createResult('d.org', 4, -7),
            ];

            const sources: RRFSource[] = [
                { results, weight: 1.0, type: 'fts', isOriginalQuery: true },
            ];

            const withBonus = weightedRRF(sources, { applyTopBonus: true });
            const withoutBonus = weightedRRF(sources, { applyTopBonus: false });

            // First result should have higher score with bonus
            expect(withBonus[0].score).toBeGreaterThan(withoutBonus[0].score);
        });
    });

    describe('deduplicateResults', () => {
        it('should remove duplicate results by file_path:line_number', () => {
            const results = [
                createResult('a.org', 1, 10),
                createResult('a.org', 1, 5),  // Duplicate
                createResult('b.org', 2, 8),
            ];

            const deduplicated = deduplicateResults(results);

            expect(deduplicated.length).toBe(2);
            expect(deduplicated[0].file_path).toBe('a.org');
            expect(deduplicated[1].file_path).toBe('b.org');
        });

        it('should keep first occurrence', () => {
            const results = [
                createResult('a.org', 1, 10),
                createResult('a.org', 1, 5),
            ];

            const deduplicated = deduplicateResults(results);

            expect(deduplicated[0].score).toBe(10);  // First one kept
        });
    });
});
