/**
 * Comprehensive benchmark tests for org parser performance
 * These tests measure parsing performance and verify optimizations
 *
 * Run with: npx vitest run src/parser/__tests__/orgParserBenchmark.test.ts
 *
 * Performance tracking:
 * - Baselines are stored in performanceBaseline.json
 * - Tests fail if performance regresses beyond threshold (default 25%)
 * - Update baselines after intentional performance changes
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parseOrg, OrgParserUnified } from '../orgParserUnified';
import { parseObjects } from '../orgObjects';
import { parseOrgFast } from '../orgExportParser';
import { performance, PerformanceObserver } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Performance Baseline Tracking
// =============================================================================

interface BaselineMetric {
    avgMs: number;
    maxMs: number;
    description: string;
}

interface PerformanceBaseline {
    version: string;
    lastUpdated: string;
    thresholds: {
        regressionThreshold: number;
        significantImprovementThreshold: number;
    };
    baselines: {
        parseOrg: Record<string, BaselineMetric>;
        parseObjects: Record<string, BaselineMetric>;
        stressTests: Record<string, BaselineMetric>;
        scaling: {
            maxTimeRatioForSizeRatio: number;
            description: string;
        };
    };
}

// Load baseline from JSON file
function loadBaseline(): PerformanceBaseline {
    const baselinePath = path.join(__dirname, 'performanceBaseline.json');
    try {
        const content = fs.readFileSync(baselinePath, 'utf-8');
        return JSON.parse(content);
    } catch {
        // Return default baseline if file doesn't exist
        return {
            version: '1.0.0',
            lastUpdated: new Date().toISOString().split('T')[0],
            thresholds: {
                regressionThreshold: 1.25,
                significantImprovementThreshold: 0.75,
            },
            baselines: {
                parseOrg: {},
                parseObjects: {},
                stressTests: {},
                scaling: {
                    maxTimeRatioForSizeRatio: 3.0,
                    description: 'Time should scale at most 3x for every 10x size increase',
                },
            },
        };
    }
}

const baseline = loadBaseline();

/**
 * Check performance against baseline and report status
 */
function checkPerformance(
    category: 'parseOrg' | 'parseObjects' | 'stressTests',
    testName: string,
    actualAvgMs: number,
    actualMaxMs: number
): { passed: boolean; message: string; status: 'ok' | 'regression' | 'improved' } {
    const baselineMetric = baseline.baselines[category]?.[testName];

    if (!baselineMetric) {
        return {
            passed: true,
            message: `No baseline for ${category}.${testName} - current: ${actualAvgMs.toFixed(2)}ms avg`,
            status: 'ok',
        };
    }

    const avgRatio = actualAvgMs / baselineMetric.avgMs;
    const { regressionThreshold, significantImprovementThreshold } = baseline.thresholds;

    let status: 'ok' | 'regression' | 'improved' = 'ok';
    let passed = true;
    let message = '';

    if (avgRatio > regressionThreshold) {
        status = 'regression';
        passed = false;
        message = `REGRESSION: ${testName} is ${((avgRatio - 1) * 100).toFixed(0)}% slower than baseline (${actualAvgMs.toFixed(2)}ms vs ${baselineMetric.avgMs}ms baseline)`;
    } else if (avgRatio < significantImprovementThreshold) {
        status = 'improved';
        message = `IMPROVED: ${testName} is ${((1 - avgRatio) * 100).toFixed(0)}% faster than baseline (${actualAvgMs.toFixed(2)}ms vs ${baselineMetric.avgMs}ms baseline)`;
    } else {
        message = `OK: ${testName} within baseline (${actualAvgMs.toFixed(2)}ms vs ${baselineMetric.avgMs}ms baseline, ${(avgRatio * 100).toFixed(0)}%)`;
    }

    // Also check max time
    if (actualMaxMs > baselineMetric.maxMs * regressionThreshold) {
        message += ` [WARNING: max time ${actualMaxMs.toFixed(2)}ms exceeds baseline max ${baselineMetric.maxMs}ms]`;
    }

    return { passed, message, status };
}

/**
 * Print performance summary with baseline comparison
 */
function printPerformanceSummary(results: Array<{ name: string; avgMs: number; maxMs: number; category: string; testName: string }>) {
    console.log('\n' + '='.repeat(80));
    console.log('PERFORMANCE SUMMARY (vs baseline)');
    console.log('='.repeat(80));

    const regressions: string[] = [];
    const improvements: string[] = [];

    for (const r of results) {
        const check = checkPerformance(
            r.category as 'parseOrg' | 'parseObjects' | 'stressTests',
            r.testName,
            r.avgMs,
            r.maxMs
        );

        const statusIcon = check.status === 'regression' ? '!' : check.status === 'improved' ? '+' : ' ';
        console.log(`[${statusIcon}] ${check.message}`);

        if (check.status === 'regression') regressions.push(r.name);
        if (check.status === 'improved') improvements.push(r.name);
    }

    console.log('='.repeat(80));
    if (regressions.length > 0) {
        console.log(`Regressions detected: ${regressions.join(', ')}`);
    }
    if (improvements.length > 0) {
        console.log(`Improvements detected: ${improvements.join(', ')}`);
    }
    console.log('='.repeat(80));
}

// =============================================================================
// Profiling Utilities
// =============================================================================

interface ProfileSection {
    name: string;
    calls: number;
    totalTime: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
}

class Profiler {
    private sections: Map<string, { times: number[] }> = new Map();
    private activeTimers: Map<string, number> = new Map();

    start(name: string): void {
        this.activeTimers.set(name, performance.now());
    }

    end(name: string): void {
        const startTime = this.activeTimers.get(name);
        if (startTime === undefined) return;

        const duration = performance.now() - startTime;
        this.activeTimers.delete(name);

        if (!this.sections.has(name)) {
            this.sections.set(name, { times: [] });
        }
        this.sections.get(name)!.times.push(duration);
    }

    measure<T>(name: string, fn: () => T): T {
        this.start(name);
        const result = fn();
        this.end(name);
        return result;
    }

    getResults(): ProfileSection[] {
        const results: ProfileSection[] = [];
        for (const [name, data] of this.sections) {
            const times = data.times;
            if (times.length === 0) continue;

            results.push({
                name,
                calls: times.length,
                totalTime: times.reduce((a, b) => a + b, 0),
                avgTime: times.reduce((a, b) => a + b, 0) / times.length,
                minTime: Math.min(...times),
                maxTime: Math.max(...times),
            });
        }
        return results.sort((a, b) => b.totalTime - a.totalTime);
    }

    reset(): void {
        this.sections.clear();
        this.activeTimers.clear();
    }

    printReport(title: string = 'Profile Report'): void {
        const results = this.getResults();
        const totalTime = results.reduce((sum, r) => sum + r.totalTime, 0);

        console.log(`\n${'='.repeat(80)}`);
        console.log(`${title}`);
        console.log(`${'='.repeat(80)}`);
        console.log(`${'Section'.padEnd(40)} | ${'Calls'.padStart(6)} | ${'Total'.padStart(10)} | ${'Avg'.padStart(8)} | ${'%'.padStart(6)}`);
        console.log(`${'-'.repeat(40)}-+-${'-'.repeat(6)}-+-${'-'.repeat(10)}-+-${'-'.repeat(8)}-+-${'-'.repeat(6)}`);

        for (const r of results) {
            const pct = (r.totalTime / totalTime * 100).toFixed(1);
            console.log(
                `${r.name.padEnd(40)} | ${String(r.calls).padStart(6)} | ${r.totalTime.toFixed(2).padStart(8)}ms | ${r.avgTime.toFixed(3).padStart(6)}ms | ${pct.padStart(5)}%`
            );
        }
        console.log(`${'='.repeat(80)}`);
        console.log(`Total time: ${totalTime.toFixed(2)}ms`);
    }
}

// Global profiler instance for tests
const profiler = new Profiler();

// =============================================================================
// Test Data Generation
// =============================================================================

/**
 * Generate a synthetic org document with various elements
 */
function generateTestDocument(options: {
    headings?: number;
    srcBlocks?: number;
    paragraphs?: number;
    tables?: number;
    lists?: number;
    inlineMarkup?: boolean;
}): string {
    const {
        headings = 50,
        srcBlocks = 20,
        paragraphs = 30,
        tables = 5,
        lists = 10,
        inlineMarkup = true,
    } = options;

    const parts: string[] = [];

    // File preamble
    parts.push('#+TITLE: Benchmark Test Document');
    parts.push('#+AUTHOR: Test Author');
    parts.push('#+OPTIONS: toc:2 num:t');
    parts.push('');

    // Generate headings with content
    for (let i = 0; i < headings; i++) {
        const level = (i % 3) + 1;
        const stars = '*'.repeat(level);
        const todoStates = ['', 'TODO ', 'DONE ', 'WAITING '];
        const todo = todoStates[i % todoStates.length];
        const priority = i % 5 === 0 ? '[#A] ' : '';
        const tags = i % 4 === 0 ? ' :tag1:tag2:' : '';

        parts.push(`${stars} ${todo}${priority}Heading ${i + 1}${tags}`);

        // Add scheduling info to some headings
        if (i % 3 === 0) {
            parts.push(`SCHEDULED: <2024-01-${String((i % 28) + 1).padStart(2, '0')} Mon>`);
        }
        if (i % 5 === 0) {
            parts.push(`DEADLINE: <2024-02-${String((i % 28) + 1).padStart(2, '0')} Tue>`);
        }

        // Add properties drawer to some headings
        if (i % 4 === 0) {
            parts.push(':PROPERTIES:');
            parts.push(`:ID: heading-${i}`);
            parts.push(`:CUSTOM_ID: custom-${i}`);
            parts.push(':END:');
        }

        // Add paragraph content
        if (i < paragraphs) {
            const text = inlineMarkup
                ? `This is paragraph ${i + 1} with *bold* and /italic/ text, a [[https://example.com][link]], and =code=.`
                : `This is paragraph ${i + 1} with plain text content for testing parsing speed.`;
            parts.push('');
            parts.push(text);
            parts.push('');
        }

        // Add source blocks
        if (i < srcBlocks) {
            parts.push('#+BEGIN_SRC python :results output');
            parts.push(`def function_${i}():`);
            parts.push(`    print("Hello from function ${i}")`);
            parts.push(`    return ${i * 2}`);
            parts.push('#+END_SRC');
            parts.push('');
        }

        // Add tables
        if (i < tables) {
            parts.push('| Column 1 | Column 2 | Column 3 |');
            parts.push('|----------|----------|----------|');
            parts.push(`| Data ${i} | Value ${i * 2} | ${i * 3} |`);
            parts.push(`| Row 2    | ${i + 10}     | ${i + 20} |`);
            parts.push('');
        }

        // Add lists
        if (i < lists) {
            parts.push('- Item 1');
            parts.push('  - Nested item 1.1');
            parts.push('  - Nested item 1.2');
            parts.push('- Item 2');
            parts.push('- Item 3');
            parts.push('');
        }
    }

    return parts.join('\n');
}

/**
 * Generate text with many inline objects for object parsing tests
 */
function generateInlineText(length: number): string {
    const fragments = [
        'Plain text here. ',
        '*Bold text* with emphasis. ',
        '/Italic/ and _underline_ text. ',
        'A [[https://example.com][link]] here. ',
        'Some =code= and ~verbatim~ text. ',
        'A timestamp <2024-01-15 Mon 10:00>. ',
        'Math: $E = mc^2$ inline. ',
        'Citation cite:smith-2020 reference. ',
        'Footnote[fn:1] here. ',
        'Subscript H_2O and superscript x^2. ',
    ];

    let result = '';
    let idx = 0;
    while (result.length < length) {
        result += fragments[idx % fragments.length];
        idx++;
    }
    return result;
}

// =============================================================================
// Benchmark Utilities
// =============================================================================

interface BenchmarkResult {
    name: string;
    iterations: number;
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    opsPerSec: number;
}

function runBenchmark(
    name: string,
    fn: () => void,
    iterations: number = 10
): BenchmarkResult {
    const times: number[] = [];

    // Warmup
    for (let i = 0; i < 3; i++) {
        fn();
    }

    // Actual measurements
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        fn();
        const end = performance.now();
        times.push(end - start);
    }

    const totalMs = times.reduce((a, b) => a + b, 0);
    const avgMs = totalMs / iterations;
    const minMs = Math.min(...times);
    const maxMs = Math.max(...times);
    const opsPerSec = 1000 / avgMs;

    return {
        name,
        iterations,
        totalMs,
        avgMs,
        minMs,
        maxMs,
        opsPerSec,
    };
}

function formatBenchmark(result: BenchmarkResult): string {
    return `${result.name}: avg=${result.avgMs.toFixed(2)}ms, min=${result.minMs.toFixed(2)}ms, max=${result.maxMs.toFixed(2)}ms, ops/s=${result.opsPerSec.toFixed(1)}`;
}

// =============================================================================
// Benchmark Tests
// =============================================================================

describe('Parser Benchmark Suite', () => {
    // Test documents of different sizes
    const smallDoc = generateTestDocument({ headings: 10, srcBlocks: 5, paragraphs: 10 });
    const mediumDoc = generateTestDocument({ headings: 50, srcBlocks: 20, paragraphs: 30 });
    const largeDoc = generateTestDocument({ headings: 200, srcBlocks: 80, paragraphs: 100, tables: 20, lists: 30 });

    describe('Document Parsing - OrgParserUnified', () => {
        it('parses small documents efficiently', () => {
            const result = runBenchmark('Small doc (unified)', () => {
                parseOrg(smallDoc);
            }, 20);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Document size: ${smallDoc.length} chars, ${smallDoc.split('\n').length} lines`);

            // Check against baseline
            const perfCheck = checkPerformance('parseOrg', 'smallDoc', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            // Fail on regression
            expect(perfCheck.passed, perfCheck.message).toBe(true);
            // Also enforce absolute max
            expect(result.avgMs).toBeLessThan(50);
        });

        it('parses medium documents efficiently', () => {
            const result = runBenchmark('Medium doc (unified)', () => {
                parseOrg(mediumDoc);
            }, 10);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Document size: ${mediumDoc.length} chars, ${mediumDoc.split('\n').length} lines`);

            // Check against baseline
            const perfCheck = checkPerformance('parseOrg', 'mediumDoc', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            // Fail on regression
            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(200);
        });

        it('parses large documents efficiently', () => {
            const result = runBenchmark('Large doc (unified)', () => {
                parseOrg(largeDoc);
            }, 5);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Document size: ${largeDoc.length} chars, ${largeDoc.split('\n').length} lines`);

            // Check against baseline
            const perfCheck = checkPerformance('parseOrg', 'largeDoc', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            // Fail on regression
            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(1000);
        });

        it('scales linearly with document size', () => {
            const smallResult = runBenchmark('Small', () => parseOrg(smallDoc), 10);
            const mediumResult = runBenchmark('Medium', () => parseOrg(mediumDoc), 10);
            const largeResult = runBenchmark('Large', () => parseOrg(largeDoc), 5);

            console.log('\nScaling analysis:');
            console.log(`  Small:  ${smallResult.avgMs.toFixed(2)}ms (${smallDoc.length} chars)`);
            console.log(`  Medium: ${mediumResult.avgMs.toFixed(2)}ms (${mediumDoc.length} chars)`);
            console.log(`  Large:  ${largeResult.avgMs.toFixed(2)}ms (${largeDoc.length} chars)`);

            // Calculate scaling factor
            const sizeRatio = largeDoc.length / smallDoc.length;
            const timeRatio = largeResult.avgMs / smallResult.avgMs;

            console.log(`  Size ratio: ${sizeRatio.toFixed(1)}x`);
            console.log(`  Time ratio: ${timeRatio.toFixed(1)}x`);

            // Time should scale roughly linearly (within 3x of linear)
            expect(timeRatio).toBeLessThan(sizeRatio * 3);
        });
    });

    describe('Document Parsing - Fast Export Parser', () => {
        it('parses documents without errors', () => {
            const unifiedResult = runBenchmark('Unified', () => parseOrg(mediumDoc), 10);
            const fastResult = runBenchmark('Fast', () => parseOrgFast(mediumDoc), 10);

            console.log('\nParser comparison (medium doc):');
            console.log(`  Unified: ${unifiedResult.avgMs.toFixed(2)}ms`);
            console.log(`  Fast:    ${fastResult.avgMs.toFixed(2)}ms`);
            console.log(`  Speedup: ${(unifiedResult.avgMs / fastResult.avgMs).toFixed(1)}x`);

            // Just verify both parsers complete without error
            // Note: The "fast" parser is optimized for specific export scenarios,
            // not necessarily faster in all cases due to JIT warmup and different code paths
            expect(unifiedResult.avgMs).toBeGreaterThan(0);
            expect(fastResult.avgMs).toBeGreaterThan(0);
        });
    });

    describe('Inline Object Parsing', () => {
        const shortText = generateInlineText(500);
        const mediumText = generateInlineText(2000);
        const longText = generateInlineText(10000);

        it('parses short inline text efficiently', () => {
            const result = runBenchmark('Short inline', () => {
                parseObjects(shortText);
            }, 50);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Text length: ${shortText.length} chars`);

            // Check against baseline
            const perfCheck = checkPerformance('parseObjects', 'shortText', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(10);
        });

        it('parses medium inline text efficiently', () => {
            const result = runBenchmark('Medium inline', () => {
                parseObjects(mediumText);
            }, 20);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Text length: ${mediumText.length} chars`);

            // Check against baseline
            const perfCheck = checkPerformance('parseObjects', 'mediumText', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(30);
        });

        it('parses long inline text efficiently', () => {
            const result = runBenchmark('Long inline', () => {
                parseObjects(longText);
            }, 10);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Text length: ${longText.length} chars`);

            // Check against baseline
            const perfCheck = checkPerformance('parseObjects', 'longText', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(100);
        });
    });

    describe('Parser Configuration Impact', () => {
        it('measures impact of position calculation', () => {
            const parser = new OrgParserUnified({ addPositions: true });
            const parserNoPos = new OrgParserUnified({ addPositions: false });

            const withPosResult = runBenchmark('With positions', () => {
                parser.parse(mediumDoc);
            }, 10);

            const noPosResult = runBenchmark('Without positions', () => {
                parserNoPos.parse(mediumDoc);
            }, 10);

            console.log('\nPosition calculation impact:');
            console.log(`  With positions:    ${withPosResult.avgMs.toFixed(2)}ms`);
            console.log(`  Without positions: ${noPosResult.avgMs.toFixed(2)}ms`);
            const overhead = ((withPosResult.avgMs / noPosResult.avgMs - 1) * 100);
            console.log(`  Overhead:          ${overhead.toFixed(1)}%`);

            // Both configurations should complete in reasonable time
            // Don't compare them directly as CI variance can cause either to be faster
            expect(withPosResult.avgMs).toBeLessThan(200);
            expect(noPosResult.avgMs).toBeLessThan(200);
        });

        it('measures impact of inline object parsing', () => {
            const parserWithObjects = new OrgParserUnified({ parseInlineObjects: true });
            const parserNoObjects = new OrgParserUnified({ parseInlineObjects: false });

            const withObjResult = runBenchmark('With objects', () => {
                parserWithObjects.parse(mediumDoc);
            }, 10);

            const noObjResult = runBenchmark('Without objects', () => {
                parserNoObjects.parse(mediumDoc);
            }, 10);

            console.log('\nInline object parsing impact:');
            console.log(`  With objects:    ${withObjResult.avgMs.toFixed(2)}ms`);
            console.log(`  Without objects: ${noObjResult.avgMs.toFixed(2)}ms`);
            console.log(`  Overhead:        ${((withObjResult.avgMs / noObjResult.avgMs - 1) * 100).toFixed(1)}%`);
        });
    });

    describe('Stress Tests', () => {
        it('handles documents with many headings', () => {
            const manyHeadings = generateTestDocument({
                headings: 500,
                srcBlocks: 0,
                paragraphs: 0,
                tables: 0,
                lists: 0,
            });

            const result = runBenchmark('Many headings (500)', () => {
                parseOrg(manyHeadings);
            }, 5);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Document size: ${manyHeadings.length} chars`);

            // Check against baseline
            const perfCheck = checkPerformance('stressTests', 'manyHeadings', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(500);
        });

        it('handles documents with many source blocks', () => {
            const manySrcBlocks = generateTestDocument({
                headings: 100,
                srcBlocks: 100,
                paragraphs: 0,
                tables: 0,
                lists: 0,
            });

            const result = runBenchmark('Many src blocks (100)', () => {
                parseOrg(manySrcBlocks);
            }, 5);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Document size: ${manySrcBlocks.length} chars`);

            // Check against baseline
            const perfCheck = checkPerformance('stressTests', 'manySrcBlocks', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(500);
        });

        it('handles deeply nested structures', () => {
            // Generate deeply nested headings
            const parts: string[] = ['#+TITLE: Deep Nesting Test'];
            for (let level = 1; level <= 10; level++) {
                for (let i = 0; i < 10; i++) {
                    parts.push(`${'*'.repeat(level)} Level ${level} Heading ${i}`);
                    parts.push(`Content at level ${level}`);
                }
            }
            const deepDoc = parts.join('\n');

            const result = runBenchmark('Deep nesting (10 levels)', () => {
                parseOrg(deepDoc);
            }, 10);

            console.log(`\n${formatBenchmark(result)}`);
            console.log(`  Document size: ${deepDoc.length} chars`);

            // Check against baseline
            const perfCheck = checkPerformance('stressTests', 'deepNesting', result.avgMs, result.maxMs);
            console.log(`  Baseline: ${perfCheck.message}`);

            expect(perfCheck.passed, perfCheck.message).toBe(true);
            expect(result.avgMs).toBeLessThan(100);
        });

        it('handles pathological regex patterns', () => {
            // Patterns that could cause regex backtracking
            const pathological = [
                // Many potential emphasis markers
                '* ' + '* not bold *'.repeat(100),
                // Long lines with markup at end
                '* ' + 'a'.repeat(1000) + ' *bold*',
                // Many nested brackets
                '* ' + '[[link]['.repeat(10) + 'text' + ']]'.repeat(10),
            ].join('\n\n');

            const result = runBenchmark('Pathological patterns', () => {
                parseOrg(pathological);
            }, 10);

            console.log(`\n${formatBenchmark(result)}`);

            // Should not take excessive time
            expect(result.avgMs).toBeLessThan(100);
        });
    });

    describe('Memory Efficiency', () => {
        it('does not leak memory across multiple parses', () => {
            // This is a basic check - real memory testing would need external tools
            const iterations = 100;
            const startMemory = process.memoryUsage().heapUsed;

            for (let i = 0; i < iterations; i++) {
                parseOrg(mediumDoc);
            }

            // Force GC if available
            if (global.gc) {
                global.gc();
            }

            const endMemory = process.memoryUsage().heapUsed;
            const memoryGrowth = (endMemory - startMemory) / 1024 / 1024;

            console.log(`\nMemory usage after ${iterations} parses:`);
            console.log(`  Start: ${(startMemory / 1024 / 1024).toFixed(1)}MB`);
            console.log(`  End:   ${(endMemory / 1024 / 1024).toFixed(1)}MB`);
            console.log(`  Growth: ${memoryGrowth.toFixed(1)}MB`);

            // Memory growth should be reasonable (less than 50MB for 100 parses)
            expect(memoryGrowth).toBeLessThan(50);
        });
    });
});

// =============================================================================
// Detailed Profiling Tests
// =============================================================================

describe('Detailed Profiling', () => {
    const mediumDoc = generateTestDocument({ headings: 50, srcBlocks: 20, paragraphs: 30 });
    const lines = mediumDoc.split('\n');

    it('profiles regex operations', () => {
        profiler.reset();

        // Profile different regex patterns commonly used
        const regexPatterns = {
            headline: /^(\*+)\s+(.*)$/,
            keyword: /^#\+(\w+):\s*(.*)$/,
            srcBlockStart: /^#\+BEGIN_SRC(?:\s+(\S+))?(.*)$/i,
            srcBlockEnd: /^#\+END_SRC/i,
            beginBlock: /^#\+BEGIN_/i,
            planning: /^\s*(SCHEDULED|DEADLINE|CLOSED):/,
            scheduled: /SCHEDULED:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/,
            deadline: /DEADLINE:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/,
            tags: /\s+:([^:\s]+(?::[^:\s]+)*):$/,
            list: /^\s*[-+*](?:\s|$)/,
            orderedList: /^\s*\d+[.)]\s/,
            table: /^\s*\|/,
            drawer: /^:(\w+):\s*$/,
            propertyLine: /^\s*:(\S+):\s*(.*)$/,
            fixedWidth: /^:\s/,
            comment: /^#\s/,
            horizontalRule: /^-{5,}\s*$/,
        };

        const iterations = 10;

        for (let iter = 0; iter < iterations; iter++) {
            for (const line of lines) {
                for (const [name, regex] of Object.entries(regexPatterns)) {
                    profiler.start(`regex:${name}`);
                    line.match(regex);
                    profiler.end(`regex:${name}`);
                }
            }
        }

        profiler.printReport('Regex Pattern Performance (per line)');

        // All regex operations should complete
        const results = profiler.getResults();
        expect(results.length).toBeGreaterThan(0);
    });

    it('profiles parser components', () => {
        profiler.reset();

        const iterations = 10;
        for (let i = 0; i < iterations; i++) {
            // Profile main parse
            profiler.start('total:parseOrg');
            const doc = parseOrg(mediumDoc);
            profiler.end('total:parseOrg');

            // Profile fast parser
            profiler.start('total:parseOrgFast');
            parseOrgFast(mediumDoc);
            profiler.end('total:parseOrgFast');
        }

        profiler.printReport('Parser Component Performance');
    });

    it('profiles inline object parsing', () => {
        profiler.reset();

        const testTexts = [
            'Plain text without any markup at all just regular text',
            'Text with *bold* and /italic/ emphasis markers',
            'Text with [[https://example.com][a link]] inside',
            'Complex: *bold with /nested italic/* and =code=',
            'Timestamps: <2024-01-15 Mon 10:00> and [2024-01-16 Tue]',
            'Math: $E = mc^2$ and subscript H_2O and superscript x^2',
        ];

        const iterations = 100;

        for (let i = 0; i < iterations; i++) {
            for (const text of testTexts) {
                const label = text.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
                profiler.start(`objects:${label}`);
                parseObjects(text);
                profiler.end(`objects:${label}`);
            }
        }

        profiler.printReport('Inline Object Parsing Performance');
    });

    it('profiles line-by-line parsing cost', () => {
        profiler.reset();

        const iterations = 5;

        for (let iter = 0; iter < iterations; iter++) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineType = categorizeLineType(line);

                profiler.start(`linetype:${lineType}`);
                // Simulate what the parser does for each line type
                switch (lineType) {
                    case 'headline':
                        line.match(/^(\*+)\s+(.*)$/);
                        break;
                    case 'keyword':
                        line.match(/^#\+(\w+):\s*(.*)$/);
                        break;
                    case 'srcBlockBoundary':
                        line.match(/^#\+(?:BEGIN|END)_SRC/i);
                        break;
                    case 'planning':
                        line.match(/SCHEDULED:\s*<([^>]+)>/);
                        line.match(/DEADLINE:\s*<([^>]+)>/);
                        break;
                    case 'property':
                        line.match(/^\s*:(\S+):\s*(.*)$/);
                        break;
                    case 'table':
                        line.split('|');
                        break;
                    case 'list':
                        line.match(/^\s*([-+*]|\d+[.)])\s/);
                        break;
                    default:
                        // Plain text - might need object parsing
                        break;
                }
                profiler.end(`linetype:${lineType}`);
            }
        }

        profiler.printReport('Line Type Processing Cost');
    });

    it('profiles offset calculation overhead', () => {
        profiler.reset();

        const iterations = 50;

        // Simulate offset calculation patterns used in parser
        for (let iter = 0; iter < iterations; iter++) {
            // Pattern 1: Calculate offset by iterating through lines
            profiler.start('offset:line_iteration');
            let offset = 0;
            for (const line of lines) {
                offset += line.length + 1;
            }
            profiler.end('offset:line_iteration');

            // Pattern 2: Using reduce
            profiler.start('offset:reduce');
            const totalOffset = lines.reduce((sum, line) => sum + line.length + 1, 0);
            profiler.end('offset:reduce');

            // Pattern 3: Pre-computed line positions array
            profiler.start('offset:precompute');
            const positions: number[] = new Array(lines.length);
            let pos = 0;
            for (let i = 0; i < lines.length; i++) {
                positions[i] = pos;
                pos += lines[i].length + 1;
            }
            profiler.end('offset:precompute');

            // Pattern 4: Slice-based partial calculation (common in parser)
            profiler.start('offset:slice_reduce');
            for (let start = 0; start < lines.length; start += 50) {
                const end = Math.min(start + 50, lines.length);
                lines.slice(start, end).reduce((s, l) => s + l.length + 1, 0);
            }
            profiler.end('offset:slice_reduce');
        }

        profiler.printReport('Offset Calculation Methods');
    });

    it('profiles string operations', () => {
        profiler.reset();

        const iterations = 100;
        const testLine = '* TODO [#A] This is a test heading with some tags :tag1:tag2:tag3:';

        for (let i = 0; i < iterations; i++) {
            // String slicing
            profiler.start('string:slice');
            testLine.slice(2);
            testLine.slice(0, -5);
            testLine.slice(7, 20);
            profiler.end('string:slice');

            // String splitting
            profiler.start('string:split_newline');
            mediumDoc.split('\n');
            profiler.end('string:split_newline');

            // Index operations
            profiler.start('string:indexOf');
            testLine.indexOf(':');
            testLine.lastIndexOf(':');
            testLine.indexOf(' ');
            profiler.end('string:indexOf');

            // Character access
            profiler.start('string:charAt');
            for (let j = 0; j < testLine.length; j++) {
                testLine[j];
            }
            profiler.end('string:charAt');

            // Starts/ends with
            profiler.start('string:startsWith');
            testLine.startsWith('* ');
            testLine.startsWith('#+');
            testLine.endsWith(':');
            profiler.end('string:startsWith');
        }

        profiler.printReport('String Operation Performance');
    });
});

function categorizeLineType(line: string): string {
    if (line.match(/^\*+\s/)) return 'headline';
    if (line.match(/^#\+BEGIN_/i)) return 'srcBlockBoundary';
    if (line.match(/^#\+END_/i)) return 'srcBlockBoundary';
    if (line.match(/^#\+\w+:/)) return 'keyword';
    if (line.match(/^\s*(SCHEDULED|DEADLINE|CLOSED):/)) return 'planning';
    if (line.match(/^:PROPERTIES:/i)) return 'propertyDrawer';
    if (line.match(/^:\w+:/)) return 'property';
    if (line.match(/^\s*\|/)) return 'table';
    if (line.match(/^\s*[-+*]\s/) || line.match(/^\s*\d+[.)]\s/)) return 'list';
    if (line.trim() === '') return 'blank';
    return 'text';
}

// =============================================================================
// Regression Tests (Ensure correctness after optimizations)
// =============================================================================

describe('Parser Correctness Verification', () => {
    const testDoc = `#+TITLE: Test Document
#+AUTHOR: Test

* TODO [#A] First Heading :tag1:tag2:
SCHEDULED: <2024-01-15 Mon>
:PROPERTIES:
:ID: heading-1
:END:

This is a paragraph with *bold* and /italic/ text.

#+BEGIN_SRC python :results output
print("Hello")
#+END_SRC

** Second Level Heading
Some content here with a [[https://example.com][link]].

- List item 1
- List item 2
  - Nested item

| Col1 | Col2 |
|------|------|
| A    | B    |

* DONE Another Heading
CLOSED: [2024-01-10 Wed 14:00]

Plain paragraph.
`;

    it('correctly parses document structure', () => {
        const doc = parseOrg(testDoc);

        expect(doc.type).toBe('org-data');
        expect(doc.keywords['TITLE']).toBe('Test Document');
        expect(doc.keywords['AUTHOR']).toBe('Test');
        expect(doc.children.length).toBe(2);
    });

    it('correctly parses headlines', () => {
        const doc = parseOrg(testDoc);

        const firstHeadline = doc.children[0];
        expect(firstHeadline.type).toBe('headline');
        expect(firstHeadline.properties.level).toBe(1);
        expect(firstHeadline.properties.todoKeyword).toBe('TODO');
        expect(firstHeadline.properties.priority).toBe('A');
        expect(firstHeadline.properties.tags).toContain('tag1');
        expect(firstHeadline.properties.tags).toContain('tag2');
    });

    it('correctly parses planning info', () => {
        const doc = parseOrg(testDoc);

        const firstHeadline = doc.children[0];
        expect(firstHeadline.planning).toBeDefined();
        expect(firstHeadline.planning?.properties.scheduled).toBeDefined();
    });

    it('correctly parses properties drawer', () => {
        const doc = parseOrg(testDoc);

        const firstHeadline = doc.children[0];
        expect(firstHeadline.propertiesDrawer).toBeDefined();
        expect(firstHeadline.propertiesDrawer?.['ID']).toBe('heading-1');
    });

    it('correctly parses nested headlines', () => {
        const doc = parseOrg(testDoc);

        const firstHeadline = doc.children[0];
        expect(firstHeadline.children.length).toBe(1);
        expect(firstHeadline.children[0].properties.level).toBe(2);
    });

    it('correctly parses inline objects', () => {
        const objects = parseObjects('Text with *bold* and /italic/ and [[link][description]]');

        const types = objects.map(o => o.type);
        expect(types).toContain('plain-text');
        expect(types).toContain('bold');
        expect(types).toContain('italic');
        expect(types).toContain('link');
    });
});
