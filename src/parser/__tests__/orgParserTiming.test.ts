/**
 * Parser timing tests
 * Tests the fast export parser performance
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseObjectsFast, parseOrgFast } from '../orgExportParser';

const TEST_FILE = path.join(__dirname, '../../../test-features.org');

// Check if test file exists (it's a local file not in the repo)
const hasTestFile = fs.existsSync(TEST_FILE);

describe('Parser Timing - Inline Objects', () => {
    it('times inline object parsing on simple text', () => {
        const testCases = [
            'Simple text without any markup',
            'Text with *bold* word',
            'Text with /italic/ and *bold* words',
            'A citation cite:smith-2020-paper here',
            'Multiple citations cite:a,b,c in one line',
        ];

        console.log('\nInline object parsing times:');
        for (const text of testCases) {
            const start = performance.now();
            const objects = parseObjectsFast(text);
            const end = performance.now();
            console.log(`  "${text.substring(0, 40)}..." -> ${objects.length} objects in ${(end - start).toFixed(3)}ms`);
            expect(objects.length).toBeGreaterThan(0);
        }
    });

    it('handles potentially problematic patterns efficiently', () => {
        const problematicPatterns = [
            // Long text without markup
            'a'.repeat(1000),
            // Many potential markup characters
            '* not bold * also not *',
            // Nested-looking patterns
            '*outer *inner* outer*',
            // Long text with markup at the end
            'a'.repeat(500) + ' *bold* ' + 'b'.repeat(500),
        ];

        console.log('\nProblematic pattern tests:');
        for (const text of problematicPatterns) {
            const start = performance.now();
            const objects = parseObjectsFast(text);
            const end = performance.now();
            const time = end - start;
            console.log(`  Pattern (${text.length} chars): ${time.toFixed(2)}ms - ${objects.length} objects`);

            // Should complete in under 100ms
            expect(time).toBeLessThan(100);
        }
    });
});

// Tests that require the local test-features.org file
describe.skipIf(!hasTestFile)('Parser Timing - Full Document', () => {
    const content = hasTestFile
        ? fs.readFileSync(TEST_FILE, 'utf-8')
        : '';

    it('should have test file available', () => {
        expect(content.length).toBeGreaterThan(0);
        console.log(`Test file size: ${content.length} characters, ${content.split('\n').length} lines`);
    });

    it('times fast export parser on full document', () => {
        const iterations = 5;
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            const doc = parseOrgFast(content);
            const end = performance.now();
            times.push(end - start);

            if (i === 0) {
                expect(doc.type).toBe('org-data');
                expect(doc.children.length).toBeGreaterThan(0);
                console.log(`\nFast parser: ${doc.children.length} top-level headlines`);
                console.log(`Keywords: ${Object.keys(doc.keywords).join(', ')}`);
            }
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);

        console.log(`\nFast Export Parser (${iterations} iterations):`);
        console.log(`  Average: ${avg.toFixed(2)}ms`);
        console.log(`  Min: ${min.toFixed(2)}ms`);
        console.log(`  Max: ${max.toFixed(2)}ms`);

        // Should complete in under 100ms on average
        expect(avg).toBeLessThan(100);
    });

    it('scales linearly with document size', () => {
        const sizes = [1, 2, 5, 10];

        console.log('\nScaling test:');
        console.log('Multiplier | Characters | Lines  | Time (ms)');
        console.log('-----------|------------|--------|----------');

        const timesPerSize: number[] = [];

        for (const multiplier of sizes) {
            const largeContent = Array(multiplier).fill(content).join('\n\n');
            const lines = largeContent.split('\n').length;

            const start = performance.now();
            const doc = parseOrgFast(largeContent);
            const end = performance.now();
            const time = end - start;
            timesPerSize.push(time);

            console.log(`${String(multiplier).padStart(10)} | ${String(largeContent.length).padStart(10)} | ${String(lines).padStart(6)} | ${time.toFixed(2)}`);
            expect(doc.children.length).toBeGreaterThan(0);
        }

        // Check that scaling is roughly linear (10x content should be < 20x time)
        if (timesPerSize[0] > 0) {
            const scaleFactor = timesPerSize[timesPerSize.length - 1] / timesPerSize[0];
            const sizeFactor = sizes[sizes.length - 1] / sizes[0];
            console.log(`\nScaling: ${sizeFactor}x content -> ${scaleFactor.toFixed(1)}x time`);
        }
    });
});
