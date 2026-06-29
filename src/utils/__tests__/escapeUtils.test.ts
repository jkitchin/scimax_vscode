import { describe, it, expect } from 'vitest';
import {
    escapeLatex,
    sanitizeLatexLabel,
    escapeLatexUrl,
    findUnmappedNonAscii,
} from '../escapeUtils';

describe('sanitizeLatexLabel', () => {
    it('leaves clean keys unchanged', () => {
        expect(sanitizeLatexLabel('tab:correspondence')).toBe('tab:correspondence');
        expect(sanitizeLatexLabel('fig:a_b-1.2+x')).toBe('fig:a_b-1.2+x');
    });

    it('maps unsafe characters to dashes so the key is comment/catcode safe', () => {
        // % would otherwise comment out the rest of a \ref line.
        expect(sanitizeLatexLabel('fig:a_b%c')).toBe('fig:a_b-c');
        expect(sanitizeLatexLabel('tab:weird name (v2)')).toBe('tab:weird-name--v2-');
        // # { } ~ ^ \ each become a dash.
        expect(sanitizeLatexLabel('x#y{z}~^\\w')).toBe('x-y-z----w');
    });

    it('is idempotent and identical for the matching ref/label pair', () => {
        const name = 'tab:weird name (v2)';
        const a = sanitizeLatexLabel(name);
        expect(sanitizeLatexLabel(a)).toBe(a); // re-sanitizing is stable
    });
});

describe('escapeLatexUrl', () => {
    it('escapes only %, # and backslash, leaving _, &, ~ literal', () => {
        expect(escapeLatexUrl('https://x.com/a_b?c=1&d=2'))
            .toBe('https://x.com/a_b?c=1&d=2');
        expect(escapeLatexUrl('https://x.com/p%20q#frag'))
            .toBe('https://x.com/p\\%20q\\#frag');
    });

    it('does NOT over-escape the way general LaTeX escaping would', () => {
        // Contrast with escapeLatex, which would mangle the URL.
        expect(escapeLatex('a_b&c')).toContain('\\_');
        expect(escapeLatexUrl('a_b&c')).toBe('a_b&c');
    });
});

describe('findUnmappedNonAscii', () => {
    it('returns nothing for ASCII or mapped characters', () => {
        expect(findUnmappedNonAscii('plain ascii')).toEqual([]);
        // α, →, ℝ, ⊗ are all in the maps.
        expect(findUnmappedNonAscii('α → ℝ ⊗')).toEqual([]);
    });

    it('flags characters with no LaTeX mapping (emoji, CJK)', () => {
        const unmapped = findUnmappedNonAscii('hi 🎉 中 done');
        expect(unmapped).toContain('🎉');
        expect(unmapped).toContain('中');
    });

    it('deduplicates', () => {
        expect(findUnmappedNonAscii('中中中')).toEqual(['中']);
    });
});
