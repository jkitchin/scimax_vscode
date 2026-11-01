import { describe, it, expect } from 'vitest';
import { exportToMarkdown, pandocCitation } from '../orgExportMarkdown';

describe('exportToMarkdown citations', () => {
    it('writes org-ref citations as Pandoc citations and the bibliography as front matter', () => {
        const md = exportToMarkdown(`#+TITLE: Test

Citations: cite:&kitchin-2015-examp-effec cite:&kitchin-2025-beyon-fourt

bibliography:docs/references.bib
`);
        expect(md.startsWith('---\nbibliography: docs/references.bib\nlink-citations: true\n---\n\n# Test')).toBe(true);
        expect(md).toContain('Citations: [@kitchin-2015-examp-effec] [@kitchin-2025-beyon-fourt]');
        expect(md).not.toContain('&kitchin');
        expect(md).not.toContain('](docs/references.bib)');
    });

    it('handles multi-key, textual, year, v2 and org-cite citations', () => {
        const md = exportToMarkdown(
            'A cite:&a;&b, B citet:&a, C citeyear:&a, D cite:a,b, E [cite:@a; @b], F [cite/t:@a].\n'
        );
        expect(md).toContain('A [@a; @b], B @a, C [-@a], D [@a; @b], E [@a; @b], F @a.');
    });

    it('keeps prefixes and page suffixes', () => {
        expect(exportToMarkdown('[[cite:See &a p. 5;&b]]\n')).toContain('[See @a, p. 5; @b]');
        expect(exportToMarkdown('[cite:see @x p. 3; @y]\n')).toContain('[see @x, p. 3; @y]');
        expect(exportToMarkdown('[cite/t:@x p. 3]\n')).toContain('@x [p. 3]');
    });

    it('reads #+BIBLIOGRAPHY, several files and #+CSL_STYLE', () => {
        const md = exportToMarkdown('#+BIBLIOGRAPHY: refs\n#+CSL_STYLE: ieee.csl\n\nbibliography:a.bib,b.bib\n\ncite:&x\n');
        expect(md).toContain('bibliography:\n  - refs.bib\n  - a.bib\n  - b.bib\ncsl: ieee.csl\n');
    });

    it('adds no front matter without a bibliography', () => {
        expect(exportToMarkdown('cite:&x\n').startsWith('---')).toBe(false);
    });
});

describe('pandocCitation', () => {
    it('joins a common prefix and suffix', () => {
        expect(pandocCitation([{ key: 'a' }, { key: 'b' }], 'parenthetical', 'see', 'and others'))
            .toBe('[see @a; @b, and others]');
    });
});
