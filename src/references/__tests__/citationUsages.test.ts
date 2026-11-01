import { describe, it, expect } from 'vitest';
import { findKeyInLine, findKeyUsages, bibtexKeyAtLine } from '../citationUsages';

const KEY = 'kitchin-2025-beyon-fourt';
const cols = (line: string, key = KEY, pandoc = false) =>
    findKeyInLine(line, key, 0, pandoc).map(u => line.slice(u.start, u.end));

describe('findKeyInLine', () => {
    it('finds org-ref v3 citations, in any position', () => {
        expect(cols(`see cite:&${KEY}.`)).toEqual([KEY]);
        expect(cols(`see cite:&other-2020;&${KEY} too`)).toEqual([KEY]);
        expect(cols(`see citep:&a-2001;&${KEY};&b-2002`)).toEqual([KEY]);
    });

    it('finds org-ref v2 citations with comma-separated keys', () => {
        expect(cols(`see cite:other2020,${KEY}`)).toEqual([KEY]);
    });

    it('finds bracketed link citations', () => {
        expect(cols(`see [[cite:&${KEY}]]`)).toEqual([KEY]);
    });

    it('finds org-cite citations', () => {
        expect(cols(`see [cite:@a2001;@${KEY}]`)).toEqual([KEY]);
    });

    it('finds LaTeX citations with several keys', () => {
        expect(cols(`see \\citep[p. 5]{a2001,${KEY}}`)).toEqual([KEY]);
    });

    it('compares keys ignoring case', () => {
        expect(cols(`cite:&${KEY.toUpperCase()}`)).toEqual([KEY.toUpperCase()]);
    });

    it('does not count a key that is only in prose or a longer key', () => {
        expect(cols(`the key ${KEY} in text`)).toEqual([]);
        expect(cols(`cite:&${KEY}-2`)).toEqual([]);
    });

    it('counts Pandoc citations only when asked', () => {
        expect(cols(`see [@${KEY}] and @${KEY}`, KEY, true)).toEqual([KEY, KEY]);
        expect(cols(`mail me@${KEY}`, KEY, true)).toEqual([]);
    });
});

describe('findKeyUsages', () => {
    it('reports line numbers and Pandoc only in Markdown', () => {
        const lines = ['intro', `cite:&${KEY}`, `[@${KEY}]`];
        expect(findKeyUsages(lines, KEY, 'a.org').map(u => u.line)).toEqual([1]);
        expect(findKeyUsages(lines, KEY, 'a.md').map(u => u.line)).toEqual([1, 2]);
    });
});

describe('bibtexKeyAtLine', () => {
    const lines = [
        '@string{jcp = "J. Chem. Phys."}',
        `@article{${KEY},`,
        '  title = {Beyond},',
        '}',
        '@comment{x,',
        '  y}',
    ];

    it('returns the key of the enclosing entry', () => {
        expect(bibtexKeyAtLine(lines, 1)).toBe(KEY);
        expect(bibtexKeyAtLine(lines, 2)).toBe(KEY);
    });

    it('returns nothing before any entry or in a comment', () => {
        expect(bibtexKeyAtLine(lines, 0)).toBeUndefined();
        expect(bibtexKeyAtLine(lines, 5)).toBeUndefined();
    });
});
