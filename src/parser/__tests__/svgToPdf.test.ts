/**
 * Tests for SVG -> PDF conversion in the PDF export pipeline (issue #49).
 *
 * The conversion tests require an SVG converter (rsvg-convert / cairosvg /
 * inkscape). They are skipped automatically when none is installed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { convertSvgIncludesToPdf, findSvgConverter, derivedPdfPath } from '../svgToPdf';

const hasConverter = findSvgConverter() !== undefined;

const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <rect x="10" y="10" width="80" height="80" fill="red"/>
</svg>`;

let tmpDirs: string[] = [];

function mkTmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'svg2pdf-'));
    tmpDirs.push(d);
    return d;
}

afterEach(() => {
    for (const d of tmpDirs) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDirs = [];
});

describe('convertSvgIncludesToPdf', () => {
    it('returns input unchanged when there are no SVG includes', () => {
        const latex = '\\includegraphics{fig.png}\n\\includegraphics[width=2cm]{plot.pdf}';
        const result = convertSvgIncludesToPdf(latex, '/nonexistent');
        expect(result.latex).toBe(latex);
        expect(result.converted).toHaveLength(0);
        expect(result.failed).toHaveLength(0);
    });

    it('reports a missing SVG file without throwing', () => {
        const dir = mkTmp();
        const latex = '\\includegraphics{missing.svg}';
        const result = convertSvgIncludesToPdf(latex, dir);
        // Unchanged include, one failure recorded.
        expect(result.latex).toBe(latex);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].svg).toBe('missing.svg');
    });

    it.runIf(hasConverter)('converts a referenced SVG and rewrites the include path', () => {
        const dir = mkTmp();
        fs.writeFileSync(path.join(dir, 'fig.svg'), SAMPLE_SVG);
        const latex = '\\includegraphics[width=0.8\\textwidth]{fig.svg}';

        const result = convertSvgIncludesToPdf(latex, dir);

        expect(result.failed).toHaveLength(0);
        expect(result.converted).toHaveLength(1);
        expect(result.latex).toBe('\\includegraphics[width=0.8\\textwidth]{fig.svg.pdf}');
        // The derived PDF exists and is a real PDF.
        const pdf = path.join(dir, 'fig.svg.pdf');
        expect(fs.existsSync(pdf)).toBe(true);
        expect(fs.readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it.runIf(hasConverter)('converts SVGs in a subdirectory, preserving the relative path', () => {
        const dir = mkTmp();
        fs.mkdirSync(path.join(dir, 'docs'));
        fs.writeFileSync(path.join(dir, 'docs', 'flowsheet.svg'), SAMPLE_SVG);
        const latex = '\\includegraphics{docs/flowsheet.svg}';

        const result = convertSvgIncludesToPdf(latex, dir);

        expect(result.latex).toBe('\\includegraphics{docs/flowsheet.svg.pdf}');
        expect(fs.existsSync(derivedPdfPath(path.join(dir, 'docs', 'flowsheet.svg')))).toBe(true);
    });

    it.runIf(hasConverter)('leaves non-SVG includes untouched', () => {
        const dir = mkTmp();
        fs.writeFileSync(path.join(dir, 'a.svg'), SAMPLE_SVG);
        const latex = [
            '\\includegraphics{a.svg}',
            '\\includegraphics{b.png}',
            '\\includegraphics[scale=1]{c.pdf}',
        ].join('\n');

        const result = convertSvgIncludesToPdf(latex, dir);

        expect(result.latex).toContain('{a.svg.pdf}');
        expect(result.latex).toContain('{b.png}');
        expect(result.latex).toContain('{c.pdf}');
    });
});
