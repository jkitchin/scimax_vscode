/**
 * Tests for org anchor extraction (granular addressing).
 */
import { describe, it, expect } from 'vitest';
import { extractAnchors, normalizeAnchorText, slugifyAnchor } from '../orgAnchors';

describe('extractAnchors', () => {
    it('extracts a dedicated target', () => {
        const anchors = extractAnchors('Some text <<my anchor>> more text');
        expect(anchors).toEqual([
            { text: 'my anchor', kind: 'target', lineNumber: 1, column: 10 }
        ]);
    });

    it('extracts a radio target without double-counting it as a dedicated target', () => {
        const anchors = extractAnchors('A <<<my concept>>> here');
        expect(anchors).toHaveLength(1);
        expect(anchors[0]).toMatchObject({ text: 'my concept', kind: 'radio' });
    });

    it('extracts a #+NAME affiliated keyword', () => {
        const anchors = extractAnchors('#+NAME: fig-results\n#+BEGIN_SRC python\n<<not an anchor>>\n#+END_SRC');
        // The NAME is captured; the <<...>> inside the src block is skipped.
        expect(anchors).toEqual([
            { text: 'fig-results', kind: 'name', lineNumber: 1, column: 0 }
        ]);
    });

    it('handles multiple anchors on one line and tracks columns', () => {
        const anchors = extractAnchors('<<a>> and <<b>>');
        expect(anchors.map(a => [a.text, a.column])).toEqual([['a', 0], ['b', 10]]);
    });

    it('reports correct 1-indexed line numbers', () => {
        const anchors = extractAnchors('line1\nline2 <<here>>\nline3');
        expect(anchors[0]).toMatchObject({ text: 'here', lineNumber: 2 });
    });

    it('ignores empty targets', () => {
        expect(extractAnchors('<<>> <<   >>')).toEqual([]);
    });

    it('skips anchors inside example/src blocks but keeps surrounding ones', () => {
        const content = '<<before>>\n#+BEGIN_EXAMPLE\n<<inside>>\n#+END_EXAMPLE\n<<after>>';
        expect(extractAnchors(content).map(a => a.text)).toEqual(['before', 'after']);
    });
});

describe('normalizeAnchorText', () => {
    it('lowercases, trims, and collapses whitespace', () => {
        expect(normalizeAnchorText('  My   Anchor ')).toBe('my anchor');
    });
});

describe('slugifyAnchor', () => {
    it('builds a kebab-case slug from parts', () => {
        expect(slugifyAnchor('Design Notes', 'why sqlite')).toBe('design-notes-why-sqlite');
    });

    it('strips punctuation and collapses dashes', () => {
        expect(slugifyAnchor('Foo: bar!! (baz)')).toBe('foo-bar-baz');
    });

    it('falls back to "anchor" when empty', () => {
        expect(slugifyAnchor('', '!!!')).toBe('anchor');
    });
});
