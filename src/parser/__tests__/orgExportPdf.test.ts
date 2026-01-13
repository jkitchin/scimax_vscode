/**
 * Tests for PDF export (LaTeX compilation)
 * Requires pdflatex to be installed on the system
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { parseOrgFast } from '../orgExportParser';
import { exportToLatex } from '../orgExportLatex';

const execAsync = promisify(exec);

const TEST_FILE = path.join(__dirname, '../../../test-features.org');
const OUTPUT_DIR = path.join(__dirname, '../../../test-output');

// Check if test file exists (it's a local file not in the repo)
const hasTestFile = fs.existsSync(TEST_FILE);

// Check if pdflatex is available
function isPdflatexAvailable(): boolean {
    try {
        execSync('which pdflatex', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

describe('PDF Export', () => {
    const hasPdflatex = isPdflatexAvailable();

    beforeAll(() => {
        // Create output directory if it doesn't exist
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }
    });

    it.skipIf(!hasTestFile)('should have test file available', () => {
        expect(fs.existsSync(TEST_FILE)).toBe(true);
        const content = fs.readFileSync(TEST_FILE, 'utf-8');
        console.log(`Test file: ${content.length} characters, ${content.split('\n').length} lines`);
    });

    it.skipIf(!hasTestFile)('parses test-features.org successfully', () => {
        const content = fs.readFileSync(TEST_FILE, 'utf-8');

        const start = performance.now();
        const doc = parseOrgFast(content);
        const parseTime = performance.now() - start;

        expect(doc.type).toBe('org-data');
        expect(doc.children.length).toBeGreaterThan(0);

        console.log(`\nParsing: ${parseTime.toFixed(2)}ms`);
        console.log(`Headlines: ${doc.children.length}`);
        console.log(`Keywords: ${Object.keys(doc.keywords).join(', ')}`);
    });

    it.skipIf(!hasTestFile)('exports to LaTeX successfully', () => {
        const content = fs.readFileSync(TEST_FILE, 'utf-8');
        const doc = parseOrgFast(content);

        const start = performance.now();
        const latex = exportToLatex(doc, {
            toc: true,
            hyperref: true,
        });
        const exportTime = performance.now() - start;

        expect(latex.length).toBeGreaterThan(0);
        expect(latex).toContain('\\documentclass');
        expect(latex).toContain('\\begin{document}');
        expect(latex).toContain('\\end{document}');

        console.log(`\nLaTeX export: ${exportTime.toFixed(2)}ms`);
        console.log(`LaTeX length: ${latex.length} characters`);

        // Save LaTeX file for inspection
        const texPath = path.join(OUTPUT_DIR, 'test-features.tex');
        fs.writeFileSync(texPath, latex);
        console.log(`Saved: ${texPath}`);
    });

    it.skipIf(!hasTestFile || !hasPdflatex)('compiles to PDF with pdflatex', async () => {
        const content = fs.readFileSync(TEST_FILE, 'utf-8');
        const doc = parseOrgFast(content);

        // Export to LaTeX
        const latex = exportToLatex(doc, {
            toc: true,
            hyperref: true,
        });

        // Write .tex file
        const texPath = path.join(OUTPUT_DIR, 'test-features.tex');
        fs.writeFileSync(texPath, latex);

        // Run pdflatex twice (for references)
        console.log('\nRunning pdflatex (pass 1)...');
        const start1 = performance.now();
        try {
            await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${OUTPUT_DIR}" "${texPath}"`, {
                cwd: OUTPUT_DIR,
                timeout: 60000,
            });
        } catch (e: any) {
            // pdflatex may return non-zero even on success with warnings
            console.log('Pass 1 completed (with warnings)');
        }
        const time1 = performance.now() - start1;

        console.log(`Pass 1: ${time1.toFixed(0)}ms`);

        console.log('Running pdflatex (pass 2)...');
        const start2 = performance.now();
        try {
            await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${OUTPUT_DIR}" "${texPath}"`, {
                cwd: OUTPUT_DIR,
                timeout: 60000,
            });
        } catch (e: any) {
            console.log('Pass 2 completed (with warnings)');
        }
        const time2 = performance.now() - start2;

        console.log(`Pass 2: ${time2.toFixed(0)}ms`);

        // Check if PDF was created
        const pdfPath = path.join(OUTPUT_DIR, 'test-features.pdf');
        const pdfExists = fs.existsSync(pdfPath);

        if (pdfExists) {
            const pdfStats = fs.statSync(pdfPath);
            console.log(`\nPDF created: ${pdfPath}`);
            console.log(`PDF size: ${(pdfStats.size / 1024).toFixed(1)} KB`);
        } else {
            // Check for log file to see what went wrong
            const logPath = path.join(OUTPUT_DIR, 'test-features.log');
            if (fs.existsSync(logPath)) {
                const log = fs.readFileSync(logPath, 'utf-8');
                const errorLines = log.split('\n').filter(l => l.includes('!') || l.includes('Error'));
                if (errorLines.length > 0) {
                    console.log('\nLaTeX errors:');
                    errorLines.slice(0, 10).forEach(l => console.log(`  ${l}`));
                }
            }
        }

        expect(pdfExists).toBe(true);
    }, 120000); // 2 minute timeout

    it.skipIf(!hasTestFile)('measures full export pipeline timing', () => {
        const content = fs.readFileSync(TEST_FILE, 'utf-8');

        // Parse
        const parseStart = performance.now();
        const doc = parseOrgFast(content);
        const parseTime = performance.now() - parseStart;

        // Export to LaTeX
        const exportStart = performance.now();
        const latex = exportToLatex(doc, {});
        const exportTime = performance.now() - exportStart;

        console.log('\n--- Export Pipeline Timing ---');
        console.log(`Parse:       ${parseTime.toFixed(2)}ms`);
        console.log(`LaTeX:       ${exportTime.toFixed(2)}ms`);
        console.log(`Total:       ${(parseTime + exportTime).toFixed(2)}ms`);
        console.log(`Output size: ${latex.length} chars`);

        // Both should be fast
        expect(parseTime).toBeLessThan(50);
        expect(exportTime).toBeLessThan(50);
    });
});
