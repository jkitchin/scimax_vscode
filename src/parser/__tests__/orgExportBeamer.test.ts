/**
 * Tests for the Beamer export backend.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() { this.callback(); }
    },
}));

import { parseOrgFast } from '../orgExportParser';
import { exportToBeamer } from '../orgExportBeamer';

function be(content: string, options: any = {}): string {
    const doc = parseOrgFast(content);
    return exportToBeamer(doc, options);
}

describe('Beamer Export', () => {
    describe('Document structure', () => {
        it('emits documentclass=beamer with default class options', () => {
            const out = be(`#+TITLE: Demo\n* Slide A\nHi.\n* Slide B\nBye.\n`);
            expect(out).toMatch(/\\documentclass\[presentation\]\{beamer\}/);
            expect(out).toContain('\\title{Demo}');
            expect(out).toContain('\\frame{\\titlepage}');
            expect(out).toContain('\\end{document}');
        });

        it('produces a frame for each top-level headline at frame level 1', () => {
            const out = be(`* Slide A\nHi.\n* Slide B\nBye.\n`);
            const frames = out.match(/\\begin\{frame\}/g) || [];
            expect(frames.length).toBe(2);
        });

        it('respects #+LATEX_CLASS override', () => {
            const out = be(`#+LATEX_CLASS: book\n* hi\n`);
            expect(out).toContain('\\documentclass[presentation]{book}');
        });

        it('inserts aspectratio class option when set', () => {
            const out = be(`* hi\n`, { aspectRatio: '169' });
            expect(out).toMatch(/\\documentclass\[presentation,aspectratio=169\]\{beamer\}/);
        });
    });

    describe('Theme directives', () => {
        it('emits \\usetheme from #+BEAMER_THEME', () => {
            const out = be(`#+BEAMER_THEME: Madrid\n* hi\n`);
            expect(out).toContain('\\usetheme{Madrid}');
        });

        it('parses [opts] name in theme keyword', () => {
            const out = be(`#+BEAMER_THEME: [height=2em] Madrid\n* hi\n`);
            expect(out).toContain('\\usetheme[height=2em]{Madrid}');
        });

        it('emits \\usecolortheme, \\usefonttheme, \\useinnertheme, \\useoutertheme', () => {
            const out = be(
                `#+BEAMER_COLOR_THEME: beaver\n` +
                `#+BEAMER_FONT_THEME: serif\n` +
                `#+BEAMER_INNER_THEME: rectangles\n` +
                `#+BEAMER_OUTER_THEME: split\n` +
                `* hi\n`
            );
            expect(out).toContain('\\usecolortheme{beaver}');
            expect(out).toContain('\\usefonttheme{serif}');
            expect(out).toContain('\\useinnertheme{rectangles}');
            expect(out).toContain('\\useoutertheme{split}');
        });

        it('passes #+BEAMER_HEADER lines verbatim into the preamble', () => {
            const out = be(`#+BEAMER_HEADER: \\setbeamertemplate{navigation symbols}{}\n* hi\n`);
            expect(out).toContain('\\setbeamertemplate{navigation symbols}{}');
        });
    });

    describe('Frame level / sectioning', () => {
        it('with H:2, level-1 becomes a section and level-2 becomes a frame', () => {
            const out = be(`#+OPTIONS: H:2\n* Outer\n** Inner\nbody\n`);
            expect(out).toContain('\\section{Outer}');
            expect(out).toMatch(/\\begin\{frame\}[^\n]*\{Inner\}/);
        });

        it('with H:2, level-3 becomes a block', () => {
            const out = be(`#+OPTIONS: H:2\n* Outer\n** Frame\n*** Inner block\nbody\n`);
            expect(out).toContain('\\begin{block}{Inner block}');
            expect(out).toContain('\\end{block}');
        });
    });

    describe('BEAMER_env override', () => {
        it('forces a frame at any depth via :BEAMER_env: frame:', () => {
            const out = be(
                `* Outer\n` +
                `:PROPERTIES:\n:BEAMER_env: frame\n:END:\n` +
                `body\n`
            );
            expect(out).toMatch(/\\begin\{frame\}[^\n]*\{Outer\}/);
        });

        it('emits a frame with empty title for :BEAMER_env: fullframe:', () => {
            const out = be(
                `* The Title\n` +
                `:PROPERTIES:\n:BEAMER_env: fullframe\n:END:\n` +
                `body\n`
            );
            expect(out).toMatch(/\\begin\{frame\}[^\n]*\{\}/);
            expect(out).not.toMatch(/\\begin\{frame\}[^\n]*\{The Title\}/);
        });

        it('renders B_alertblock tag as alertblock environment', () => {
            const out = be(
                `* Frame\n** Important :B_alertblock:\nbody\n`
            );
            expect(out).toContain('\\begin{alertblock}{Important}');
            expect(out).toContain('\\end{alertblock}');
        });

        it('renders :BEAMER_env: theorem: with [title] and label', () => {
            const out = be(
                `* Frame\n` +
                `** Pythagoras\n` +
                `:PROPERTIES:\n:BEAMER_env: theorem\n:END:\n` +
                `a^2 + b^2 = c^2.\n`
            );
            expect(out).toMatch(/\\begin\{theorem\}\[Pythagoras\]\\label\{[^}]+\}/);
            expect(out).toContain('\\end{theorem}');
        });
    });

    describe('Frame options', () => {
        it('auto-adds fragile when frame contains a source block', () => {
            const out = be(
                `* Code Frame\n` +
                `#+BEGIN_SRC python\nprint("hi")\n#+END_SRC\n`
            );
            expect(out).toMatch(/\\begin\{frame\}\[[^\]]*fragile/);
        });

        it('auto-adds label= when allowframebreaks is absent', () => {
            const out = be(`* Hello\nbody\n`);
            expect(out).toMatch(/\\begin\{frame\}\[label=[^\]]+\]\{Hello\}/);
        });

        it('does not auto-add label= when allowframebreaks is present', () => {
            const out = be(
                `* Hello\n:PROPERTIES:\n:BEAMER_opt: allowframebreaks\n:END:\nbody\n`
            );
            expect(out).toMatch(/\\begin\{frame\}\[allowframebreaks\]\{Hello\}/);
            expect(out).not.toMatch(/\[allowframebreaks,label=/);
        });

        it('honors a user-provided label= without re-adding', () => {
            const out = be(
                `* Hello\n:PROPERTIES:\n:BEAMER_opt: label=foo\n:END:\nbody\n`
            );
            expect(out).toMatch(/\\begin\{frame\}\[label=foo\]\{Hello\}/);
            // No extra label= entry should appear.
            const m = out.match(/\\begin\{frame\}\[([^\]]*)\]/);
            expect(m).toBeTruthy();
            const opts = m![1].split(',').filter(o => o.startsWith('label='));
            expect(opts.length).toBe(1);
        });

        it('emits an action overlay from BEAMER_act on the frame', () => {
            const out = be(
                `* Hello\n:PROPERTIES:\n:BEAMER_act: <2->\n:END:\nbody\n`
            );
            expect(out).toMatch(/\\begin\{frame\}<2->/);
        });

        it('rewrites a literal \\begin{frame} in the body to avoid premature close', () => {
            const out = be(
                `* Outer\n#+BEGIN_EXAMPLE\n\\begin{frame}\n#+END_EXAMPLE\n`
            );
            // The verbatim contents should have been rewritten
            expect(out).toContain('\\begin {frame}');
        });
    });

    describe('Columns', () => {
        it('renders explicit columns from BEAMER_env: columns parent', () => {
            const out = be(
                `* Frame\n` +
                `** Two-up\n` +
                `:PROPERTIES:\n:BEAMER_env: columns\n:END:\n` +
                `*** Left\n` +
                `:PROPERTIES:\n:BEAMER_col: 0.4\n:END:\n` +
                `left text\n` +
                `*** Right\n` +
                `:PROPERTIES:\n:BEAMER_col: 0.6\n:END:\n` +
                `right text\n`
            );
            expect(out).toContain('\\begin{columns}');
            expect(out).toContain('\\begin{column}{0.4\\textwidth}');
            expect(out).toContain('\\begin{column}{0.6\\textwidth}');
            expect(out).toContain('\\end{columns}');
        });

        it('auto-wraps consecutive sibling headlines with BEAMER_col into a columns env', () => {
            const out = be(
                `* Frame\n` +
                `** Left\n` +
                `:PROPERTIES:\n:BEAMER_col: 0.5\n:END:\n` +
                `L\n` +
                `** Right\n` +
                `:PROPERTIES:\n:BEAMER_col: 0.5\n:END:\n` +
                `R\n`
            );
            // Inside the frame body, columns should be auto-wrapped.
            const colsOpens = out.match(/\\begin\{columns\}/g) || [];
            expect(colsOpens.length).toBe(1);
            expect(out).toContain('\\begin{column}{0.5\\textwidth}');
        });
    });

    describe('Speaker notes / again / appendix / ignoreheading', () => {
        it('renders BEAMER_env: note: as \\note{title\\nbody}', () => {
            const out = be(
                `* Frame\n` +
                `** Hidden\n` +
                `:PROPERTIES:\n:BEAMER_env: note\n:END:\n` +
                `Speak this aloud.\n`
            );
            expect(out).toMatch(/\\note\{Hidden\n.*Speak this aloud/s);
        });

        it('renders BEAMER_env: noteNH: as \\note{body} with no title', () => {
            const out = be(
                `* Frame\n` +
                `** Hidden\n` +
                `:PROPERTIES:\n:BEAMER_env: noteNH\n:END:\n` +
                `Just the body.\n`
            );
            expect(out).toMatch(/\\note\{[^}]*Just the body/);
            expect(out).not.toMatch(/\\note\{Hidden/);
        });

        it('renders BEAMER_env: againframe: with the BEAMER_ref', () => {
            const out = be(
                `* Frame\n` +
                `** Repeat\n` +
                `:PROPERTIES:\n:BEAMER_env: againframe\n:BEAMER_ref: foo\n:END:\n`
            );
            expect(out).toContain('\\againframe{foo}');
        });

        it('emits \\appendix and continues for BEAMER_env: appendix:', () => {
            const out = be(
                `* Main\nbody\n` +
                `* Backup\n` +
                `:PROPERTIES:\n:BEAMER_env: appendix\n:END:\n` +
                `extra\n`
            );
            expect(out).toContain('\\appendix');
            // The Backup heading still becomes a frame after \appendix
            expect(out).toMatch(/\\begin\{frame\}[^\n]*\{Backup\}/);
        });

        it('drops the headline when BEAMER_env: ignoreheading: is set, keeps body', () => {
            const out = be(
                `* Frame\n` +
                `** Hidden Heading\n` +
                `:PROPERTIES:\n:BEAMER_env: ignoreheading\n:END:\n` +
                `survives\n`
            );
            expect(out).not.toContain('Hidden Heading');
            expect(out).toContain('survives');
        });
    });

    describe('Inline markup', () => {
        it('renders *bold* as \\alert{...} by default', () => {
            const out = be(`* hi\nA *strong* word.\n`);
            expect(out).toContain('\\alert{strong}');
            expect(out).not.toContain('\\textbf{strong}');
        });

        it('reverts to \\textbf when boldIsAlert is false', () => {
            const out = be(`* hi\nA *strong* word.\n`, { boldIsAlert: false });
            expect(out).toContain('\\textbf{strong}');
            expect(out).not.toContain('\\alert{strong}');
        });

        it('passes through @@beamer:...@@ snippets verbatim', () => {
            const out = be(`* hi\nplain @@beamer:\\alert<2->{boom}@@ end.\n`);
            expect(out).toContain('\\alert<2->{boom}');
        });
    });

    describe('Plain list overlays', () => {
        it('applies #+ATTR_BEAMER :overlay to each \\item', () => {
            const out = be(
                `* hi\n` +
                `#+ATTR_BEAMER: :overlay <+->\n` +
                `- one\n- two\n- three\n`
            );
            const items = out.match(/\\item<\+->/g) || [];
            expect(items.length).toBe(3);
        });
    });

    describe('TOC frame', () => {
        it('wraps the table of contents in its own frame when toc:t', () => {
            const out = be(`#+OPTIONS: toc:t\n#+TITLE: T\n* one\n* two\n`);
            expect(out).toMatch(/\\begin\{frame\}[\s\S]*\\tableofcontents[\s\S]*\\end\{frame\}/);
        });
    });

    describe('Reuse from LaTeX backend', () => {
        it('citations still produce \\cite{}', () => {
            const out = be(`* hi\nSee cite:smith-2020.\n`);
            expect(out).toContain('\\cite{smith-2020}');
        });

        it('LaTeX environments and math fragments pass through', () => {
            const out = be(`* hi\nLet $x^2 + y^2 = z^2$ be Pythagoras.\n`);
            expect(out).toContain('$x^2 + y^2 = z^2$');
        });
    });
});
