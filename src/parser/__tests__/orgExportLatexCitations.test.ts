/**
 * Tests for LaTeX export of citations and references
 */

import { describe, it, expect, vi } from 'vitest';

// Mock VS Code API (required because export backends now use adapters that import vscode)
vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() { this.callback(); }
    },
}));

import { parseOrgFast } from '../orgExportParser';
import { exportToLatex } from '../orgExportLatex';

describe('LaTeX Export - Citations and References', () => {
    describe('Citation Links', () => {
        it('exports cite: to \\cite{}', () => {
            const content = '* Test\nSee cite:smith-2020 for details.';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\cite{smith-2020}');
        });

        it('exports cite: with multiple keys', () => {
            const content = '* Test\ncite:key1,key2,key3';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\cite{key1,key2,key3}');
        });

        it('exports citep: to \\citep{}', () => {
            const content = '* Test\nResults citep:author-2019 show...';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citep{author-2019}');
        });

        it('exports citet: to \\citet{}', () => {
            const content = '* Test\nAccording to citet:researcher-2020';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citet{researcher-2020}');
        });

        it('exports Citep: to \\citep{}', () => {
            // Note: natbib uses lowercase \citep, not \Citep
            const content = '* Test\nCitep:Author-2020 at start of sentence.';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citep{Author-2020}');
        });

        it('exports Citet: to \\citet{}', () => {
            // Note: natbib uses lowercase \citet, not \Citet
            const content = '* Test\nCitet:Author-2020 showed that...';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citet{Author-2020}');
        });

        it('exports citeauthor: to \\citeauthor{}', () => {
            const content = '* Test\nciteauthor:famous-2015 discovered...';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citeauthor{famous-2015}');
        });

        it('exports citeyear: to \\citeyear{}', () => {
            const content = '* Test\nIn citeyear:old-1990';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citeyear{old-1990}');
        });

        it('exports citealp: to \\citealp{}', () => {
            const content = '* Test\nSee citealp:paper-2020';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citealp{paper-2020}');
        });

        it('exports citealt: to \\citealt{}', () => {
            const content = '* Test\nSee citealt:paper-2020';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\citealt{paper-2020}');
        });

        it('handles multiple citations in same paragraph', () => {
            const content = '* Test\nFirst cite:one-2020 and then cite:two-2021.';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\cite{one-2020}');
            expect(latex).toContain('\\cite{two-2021}');
        });
    });

    describe('Reference Links', () => {
        it('exports ref: to \\ref{}', () => {
            const content = '* Test\nSee ref:fig-results for the figure.';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\ref{fig-results}');
        });

        it('exports eqref: to \\eqref{}', () => {
            const content = '* Test\nEquation eqref:eq-energy shows...';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\eqref{eq-energy}');
        });

        it('exports pageref: to \\pageref{}', () => {
            const content = '* Test\nSee pageref:sec-intro';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\pageref{sec-intro}');
        });

        it('exports nameref: to \\nameref{}', () => {
            const content = '* Test\nSee nameref:chap-methods';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\nameref{chap-methods}');
        });

        it('exports autoref: to \\autoref{}', () => {
            const content = '* Test\nSee autoref:tab-data';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\autoref{tab-data}');
        });

        it('exports cref: to \\cref{}', () => {
            const content = '* Test\nSee cref:fig-plot';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\cref{fig-plot}');
        });

        it('exports Cref: to \\Cref{}', () => {
            const content = '* Test\nCref:fig-plot shows...';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\Cref{fig-plot}');
        });

        it('exports label: to \\label{}', () => {
            const content = '* Test\nlabel:my-section';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\label{my-section}');
        });
    });

    describe('Bibliography Links', () => {
        it('exports bibliography: link', () => {
            const content = '* Test\nbibliography:refs.bib';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\bibliography{refs}');
        });

        it('exports bibliography with multiple files', () => {
            const content = '* Test\nbibliography:refs1.bib,refs2.bib';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\bibliography{refs1,refs2}');
        });

        it('handles bibliography without .bib extension', () => {
            const content = '* Test\nbibliography:references';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\bibliography{references}');
        });

        it('exports bibstyle: link', () => {
            const content = '* Test\nbibstyle:unsrtnat';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('\\bibliographystyle{unsrtnat}');
        });
    });

    describe('DOI Links', () => {
        it('exports doi: link with hyperref', () => {
            const content = '* Test\ndoi:10.1000/xyz123';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('doi.org/10.1000/xyz123');
        });
    });

    describe('Combined Document', () => {
        it('exports document with mixed citation types', () => {
            const content = `#+TITLE: Test Paper

* Introduction
According to citet:smith-2020, the results in citep:jones-2019,doe-2021 show improvement.

* Methods
See ref:fig-methods and eqref:eq-main for details.

* Results
The data cite:data-2022 confirms our hypothesis.

* Conclusion
Further work is needed cite:future-2023.

bibstyle:unsrtnat
bibliography:refs.bib`;

            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});

            // Check all citation types are exported
            expect(latex).toContain('\\citet{smith-2020}');
            expect(latex).toContain('\\citep{jones-2019,doe-2021}');
            expect(latex).toContain('\\ref{fig-methods}');
            expect(latex).toContain('\\eqref{eq-main}');
            expect(latex).toContain('\\cite{data-2022}');
            expect(latex).toContain('\\cite{future-2023}');
            expect(latex).toContain('\\bibliographystyle{unsrtnat}');
            expect(latex).toContain('\\bibliography{refs}');
        });

        it('preserves surrounding text around citations', () => {
            const content = '* Test\nBefore cite:key-2020 after.';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, {});
            expect(latex).toContain('Before \\cite{key-2020} after');
        });
    });

    describe('Org-cite [cite/...:@key] export (bibtex/natbib backend)', () => {
        const exp = (src: string) =>
            exportToLatex(parseOrgFast(`* T\n${src}`), { citeBackend: 'bibtex' });

        it('default style maps to \\citep', () => {
            expect(exp('[cite:@key]')).toContain('\\citep{key}');
        });

        it('multi-key default style', () => {
            expect(exp('[cite:@k1;@k2;@k3]')).toContain('\\citep{k1,k2,k3}');
        });

        it('text style: [cite/t:@key] -> \\citet', () => {
            expect(exp('[cite/t:@key]')).toContain('\\citet{key}');
        });

        it('author style: [cite/a:@key] -> \\citeauthor', () => {
            expect(exp('[cite/a:@key]')).toContain('\\citeauthor{key}');
        });

        it('author/caps: [cite/a/c:@key] -> \\Citeauthor (the issue #42 case)', () => {
            expect(exp('[cite/a/c:@key]')).toContain('\\Citeauthor{key}');
        });

        it('author/full: [cite/a/f:@key] -> \\citeauthor*', () => {
            expect(exp('[cite/a/f:@key]')).toContain('\\citeauthor*{key}');
        });

        it('text/caps: [cite/t/c:@key] -> \\Citet', () => {
            expect(exp('[cite/t/c:@key]')).toContain('\\Citet{key}');
        });

        it('text/bare: [cite/t/b:@key] -> \\citealt', () => {
            expect(exp('[cite/t/b:@key]')).toContain('\\citealt{key}');
        });

        it('text/bare-caps via combined letters: [cite/t/bc:@key] -> \\Citealt', () => {
            expect(exp('[cite/t/bc:@key]')).toContain('\\Citealt{key}');
        });

        it('default/bare: [cite//b:@key] -> \\citealp', () => {
            // Note: org-cite spells this [cite//b:@key] (empty style, bare variant)
            // -- but most users write [cite/b:@key] (which we resolve as bare style).
            // Both should resolve to bare-paren = \\citealp via our mapping when
            // the regex captures '/b' as variants of the default style. The simpler
            // form we test here uses an explicit empty first segment.
            expect(exp('[cite//b:@key]')).toContain('\\citealp{key}');
        });

        it('default/caps: [cite//c:@key] -> \\Citep', () => {
            expect(exp('[cite//c:@key]')).toContain('\\Citep{key}');
        });

        it('noauthor: [cite/na:@key] -> \\citeyearpar', () => {
            expect(exp('[cite/na:@key]')).toContain('\\citeyearpar{key}');
        });

        it('year: [cite/y:@key] -> \\citeyearpar', () => {
            expect(exp('[cite/y:@key]')).toContain('\\citeyearpar{key}');
        });

        it('year/bare: [cite/y/b:@key] -> \\citeyear', () => {
            expect(exp('[cite/y/b:@key]')).toContain('\\citeyear{key}');
        });

        it('nocite: [cite/n:@key] -> \\nocite', () => {
            expect(exp('[cite/n:@key]')).toContain('\\nocite{key}');
        });

        it('long-form style: [cite/text:@key] -> \\citet', () => {
            expect(exp('[cite/text:@key]')).toContain('\\citet{key}');
        });

        it('long-form variant: [cite/author/caps:@key] -> \\Citeauthor', () => {
            expect(exp('[cite/author/caps:@key]')).toContain('\\Citeauthor{key}');
        });

        it('per-key suffix on a single key emits [post]{key}', () => {
            expect(exp('[cite:@key p. 5]')).toContain('\\citep[p. 5]{key}');
        });

        it('per-key prefix and suffix emit [pre][post]{key}', () => {
            expect(exp('[cite:see @key p. 5]')).toContain('\\citep[see][p. 5]{key}');
        });

        it('multi-key citations drop per-key notes', () => {
            // No [pre][post] when there are multiple keys -- there is no clean
            // natbib analogue.
            const out = exp('[cite:@k1 p. 5;@k2 p. 6]');
            expect(out).toContain('\\citep{k1,k2}');
            expect(out).not.toContain('[p. 5]');
        });
    });

    describe('Org-cite export (biblatex backend)', () => {
        const exp = (src: string) =>
            exportToLatex(parseOrgFast(`* T\n${src}`), { citeBackend: 'biblatex' });

        it('default -> \\autocite', () => {
            expect(exp('[cite:@key]')).toContain('\\autocite{key}');
        });

        it('default/caps -> \\Autocite', () => {
            expect(exp('[cite//c:@key]')).toContain('\\Autocite{key}');
        });

        it('default/bare -> \\cite', () => {
            expect(exp('[cite//b:@key]')).toContain('\\cite{key}');
        });

        it('text -> \\textcite', () => {
            expect(exp('[cite/t:@key]')).toContain('\\textcite{key}');
        });

        it('text/caps -> \\Textcite', () => {
            expect(exp('[cite/t/c:@key]')).toContain('\\Textcite{key}');
        });

        it('author/caps -> \\Citeauthor (the issue #42 case)', () => {
            expect(exp('[cite/a/c:@key]')).toContain('\\Citeauthor{key}');
        });

        it('noauthor -> \\autocite*', () => {
            expect(exp('[cite/na:@key]')).toContain('\\autocite*{key}');
        });

        it('nocite -> \\nocite', () => {
            expect(exp('[cite/n:@key]')).toContain('\\nocite{key}');
        });
    });

    describe('Per-document #+cite_export override', () => {
        it('#+cite_export: biblatex switches backend', () => {
            const content = '#+cite_export: biblatex\n* T\n[cite:@key]';
            const doc = parseOrgFast(content);
            // Settings default is bibtex; document keyword overrides.
            const latex = exportToLatex(doc, { citeBackend: 'bibtex' });
            expect(latex).toContain('\\autocite{key}');
            expect(latex).not.toContain('\\citep{key}');
        });

        it('#+cite_export: bibtex switches backend', () => {
            const content = '#+cite_export: bibtex\n* T\n[cite:@key]';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, { citeBackend: 'biblatex' });
            expect(latex).toContain('\\citep{key}');
        });

        it('unknown #+cite_export: value falls back to caller setting', () => {
            const content = '#+cite_export: csl chicago.csl\n* T\n[cite:@key]';
            const doc = parseOrgFast(content);
            const latex = exportToLatex(doc, { citeBackend: 'biblatex' });
            // csl is not handled here - should fall back to biblatex
            expect(latex).toContain('\\autocite{key}');
        });
    });
});
