/**
 * Score normalization utilities for SOTA search
 *
 * Normalizes scores from different retrieval backends (BM25, vector similarity)
 * to comparable 0-1 ranges for proper fusion.
 */

import type { SearchResult } from './scimaxDb';

/**
 * Normalize BM25 scores to 0-1 range using min-max normalization
 * BM25 scores from SQLite FTS5 are negative (higher = better)
 */
export function normalizeBM25Scores(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) return [];

    // BM25 scores are negative, so we use absolute values
    const scores = results.map(r => Math.abs(r.score));
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    if (range === 0) {
        // All scores are the same - assign uniform score
        return results.map(r => ({ ...r, score: 1.0 }));
    }

    return results.map(r => ({
        ...r,
        score: (Math.abs(r.score) - minScore) / range
    }));
}

/**
 * Normalize vector similarity scores to 0-1 range
 * Cosine distance is 0-2, where 0 = identical
 * Convert to similarity: 1 - (distance / 2)
 */
export function normalizeVectorScores(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) return [];

    return results.map(r => {
        // If distance is provided, convert to similarity
        if (r.distance !== undefined) {
            // Cosine distance range is 0-2, normalize to 0-1 similarity
            const similarity = 1 - (r.distance / 2);
            return { ...r, score: Math.max(0, Math.min(1, similarity)) };
        }
        // If score is already provided (from semantic search), it's 1 - distance
        // Clamp to 0-1 range
        return { ...r, score: Math.max(0, Math.min(1, r.score)) };
    });
}

/**
 * Position-aware blending weights (following qmd's approach)
 * Higher ranks rely more on retrieval confidence, lower ranks allow more reranker influence
 */
export function getPositionWeight(rank: number): { retrievalWeight: number; rerankerWeight: number } {
    if (rank <= 3) {
        // Top 3: 75% retrieval, 25% reranker
        return { retrievalWeight: 0.75, rerankerWeight: 0.25 };
    } else if (rank <= 10) {
        // Ranks 4-10: 60% retrieval, 40% reranker
        return { retrievalWeight: 0.60, rerankerWeight: 0.40 };
    } else {
        // Ranks 11+: 40% retrieval, 60% reranker
        return { retrievalWeight: 0.40, rerankerWeight: 0.60 };
    }
}

/**
 * Blend retrieval score with reranker score using position-aware weights
 */
export function blendScores(
    retrievalScore: number,
    rerankerScore: number,
    rank: number
): number {
    const weights = getPositionWeight(rank);
    return (weights.retrievalWeight * retrievalScore) + (weights.rerankerWeight * rerankerScore);
}

/**
 * Apply top-rank bonus to reward consistently top-ranked results
 * Results that appear in top 3 of multiple retrieval methods get a bonus
 */
export function applyTopRankBonus(score: number, rank: number): number {
    if (rank === 0) return score * 1.15;  // 15% bonus for #1
    if (rank === 1) return score * 1.10;  // 10% bonus for #2
    if (rank === 2) return score * 1.05;  // 5% bonus for #3
    return score;
}

/**
 * Weighted Reciprocal Rank Fusion (RRF) with enhancements
 *
 * Standard RRF: score = sum(weight / (k + rank)) where k=60 (constant)
 * Enhanced:
 *   - Original query gets 2x weight
 *   - Top rank bonuses applied
 *   - Score normalization before fusion
 */
export interface RRFSource {
    results: SearchResult[];
    weight: number;
    type: 'fts' | 'vector';
    isOriginalQuery?: boolean;
}

export interface RRFOptions {
    k?: number;                    // RRF constant (default: 60)
    applyTopBonus?: boolean;       // Apply top-3 rank bonuses (default: true)
    normalizeFirst?: boolean;      // Normalize scores before fusion (default: true)
    originalQueryMultiplier?: number;  // Extra weight for original query (default: 2.0)
}

/**
 * Perform weighted reciprocal rank fusion across multiple result sources
 */
export function weightedRRF(
    sources: RRFSource[],
    options: RRFOptions = {}
): SearchResult[] {
    const k = options.k ?? 60;
    const applyTopBonus = options.applyTopBonus ?? true;
    const normalizeFirst = options.normalizeFirst ?? true;
    const originalQueryMultiplier = options.originalQueryMultiplier ?? 2.0;

    // Normalize scores if requested
    const normalizedSources = sources.map(source => {
        if (!normalizeFirst) return source;

        const normalized = source.type === 'fts'
            ? normalizeBM25Scores(source.results)
            : normalizeVectorScores(source.results);

        return { ...source, results: normalized };
    });

    // Build score map: key -> { result, totalRRF, appearances }
    const scoreMap = new Map<string, {
        result: SearchResult;
        totalRRF: number;
        bestRank: number;
        appearances: number;
    }>();

    for (const source of normalizedSources) {
        // Apply original query multiplier
        const effectiveWeight = source.isOriginalQuery
            ? source.weight * originalQueryMultiplier
            : source.weight;

        source.results.forEach((result, rank) => {
            const key = `${result.file_path}:${result.line_number}`;

            // Calculate RRF score for this position
            let rrfScore = effectiveWeight / (k + rank + 1);

            // Apply top-rank bonus
            if (applyTopBonus) {
                rrfScore = applyTopRankBonus(rrfScore, rank);
            }

            const existing = scoreMap.get(key);
            if (existing) {
                existing.totalRRF += rrfScore;
                existing.appearances++;
                existing.bestRank = Math.min(existing.bestRank, rank);
            } else {
                scoreMap.set(key, {
                    result,
                    totalRRF: rrfScore,
                    bestRank: rank,
                    appearances: 1
                });
            }
        });
    }

    // Sort by total RRF score
    return Array.from(scoreMap.values())
        .sort((a, b) => b.totalRRF - a.totalRRF)
        .map(item => ({
            ...item.result,
            score: item.totalRRF
        }));
}

/**
 * Simple deduplication by file path + line number
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
        const key = `${r.file_path}:${r.line_number}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
