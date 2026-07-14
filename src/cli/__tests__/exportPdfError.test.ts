/**
 * Tests for LaTeX log error extraction used by `scimax export --format pdf`
 * to surface the real failure cause instead of a generic message (issue #50).
 */

import { describe, it, expect } from 'vitest';
import { extractFirstLatexError } from '../commands/latexLog';

describe('extractFirstLatexError', () => {
    it('extracts the message and .tex line for a graphics error', () => {
        const log = [
            'This is LuaHBTeX, Version 1.21.0',
            '(./report.tex',
            '! LaTeX Error: Unknown graphics extension: .svg.',
            '',
            'See the LaTeX manual or LaTeX Companion for explanation.',
            'Type  H <return>  for immediate help.',
            ' ...                                              ',
            '                                                  ',
            'l.95 ...s[width=0.8\\textwidth]{docs/flowsheet.svg}',
            '                                                  ',
        ].join('\n');

        const result = extractFirstLatexError(log);
        expect(result).toBeDefined();
        expect(result!.message).toBe('LaTeX Error: Unknown graphics extension: .svg.');
        expect(result!.texLine).toBe(95);
    });

    it('extracts a "Missing $ inserted" error', () => {
        const log = [
            '! Missing $ inserted.',
            '<inserted text> ',
            '                $',
            'l.12 Purchased equipment cost ~$50,000',
            '                                       , total capital investment',
        ].join('\n');

        const result = extractFirstLatexError(log);
        expect(result!.message).toBe('Missing $ inserted.');
        expect(result!.texLine).toBe(12);
    });

    it('returns the message even when no line number is present', () => {
        const log = '! Emergency stop.\n*** (job aborted, no legal \\end found)';
        const result = extractFirstLatexError(log);
        expect(result!.message).toBe('Emergency stop.');
        expect(result!.texLine).toBeUndefined();
    });

    it('returns undefined for a clean log', () => {
        const log = 'This is LuaHBTeX\nOutput written on report.pdf (10 pages).';
        expect(extractFirstLatexError(log)).toBeUndefined();
    });

    it('reports only the first error when several are present', () => {
        const log = [
            '! Undefined control sequence.',
            'l.3 \\badmacro',
            '! Missing $ inserted.',
            'l.9 foo',
        ].join('\n');
        const result = extractFirstLatexError(log);
        expect(result!.message).toBe('Undefined control sequence.');
        expect(result!.texLine).toBe(3);
    });
});
