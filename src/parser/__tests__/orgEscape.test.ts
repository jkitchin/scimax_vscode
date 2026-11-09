/**
 * Comma escapes in blocks (issue #88): `,* x` and `,#+x` inside src, example
 * and export blocks stand for `* x` and `#+x`.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    window: { createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }) },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

import { escapeOrgCode, unescapeOrgCode } from '../orgEscape';
import { parseOrgFast } from '../orgExportParser';
import { exportToHtml } from '../orgExportHtml';
import { exportToLatex } from '../orgExportLatex';
import { exportToMarkdown } from '../orgExportMarkdown';
import { exportToMarp } from '../orgExportMarp';
import { exportToIpynb } from '../orgExportIpynb';
import { extractSourceBlocks } from '../orgBabelAdvanced';
import { formatResult } from '../orgBabel';

const org = (...lines: string[]) => lines.join('\n') + '\n';

describe('unescapeOrgCode', () => {
    it('removes one comma before * and #+ at the start of a line', () => {
        expect(unescapeOrgCode(',* Results')).toBe('* Results');
        expect(unescapeOrgCode(',#+begin_src python')).toBe('#+begin_src python');
        expect(unescapeOrgCode('  ,** indented')).toBe('  ** indented');
        expect(unescapeOrgCode(',,* x')).toBe(',* x');
        expect(unescapeOrgCode('a\n,* b\nc')).toBe('a\n* b\nc');
    });

    it('leaves other commas alone', () => {
        for (const text of [',foo', 'x ,* y', ',#x', ', * x', 'a, b']) {
            expect(unescapeOrgCode(text)).toBe(text);
        }
    });

    it('escapes lines that would read as org, and round-trips', () => {
        expect(escapeOrgCode('* h\n#+x\n,* y\nplain\n  #+i')).toBe(',* h\n,#+x\n,,* y\nplain\n  ,#+i');
        for (const text of ['* h', ',* h', '#+begin_src', 'x,* y', '  ** z']) {
            expect(unescapeOrgCode(escapeOrgCode(text))).toBe(text);
        }
    });
});

describe('export drops the escaping comma', () => {
    const source = org(
        '#+begin_example',
        ',* Results',
        ',#+begin_src python',
        ',,* kept comma',
        '#+end_example',
        '',
        '#+begin_src org',
        ',* Heading',
        '#+end_src',
        '',
        '#+begin_export html',
        ',#+not a keyword',
        '#+end_export',
    );

    it('in the parsed blocks', () => {
        const values: string[] = [];
        const walk = (node: unknown): void => {
            const n = node as { type?: string; properties?: { value?: string }; children?: unknown[]; section?: unknown };
            if (n.type?.endsWith('-block') && n.properties?.value !== undefined) values.push(n.properties.value);
            if (n.section) walk(n.section);
            n.children?.forEach(walk);
        };
        walk(parseOrgFast(source));
        expect(values).toEqual([
            '* Results\n#+begin_src python\n,* kept comma',
            '* Heading',
            '#+not a keyword',
        ]);
    });

    it('in every backend', () => {
        const doc = () => parseOrgFast(source);
        const outputs: Record<string, string> = {
            html: exportToHtml(doc(), {}),
            latex: exportToLatex(doc(), {}),
            markdown: exportToMarkdown(source),
            marp: exportToMarp(source),
        };
        for (const [name, out] of Object.entries(outputs)) {
            expect(out, name).not.toMatch(/,\* Results|,#\+begin_src|,\* Heading/);
            expect(out, name).toContain('* Results');
            expect(out, name).toContain('kept comma');
        }
        expect(outputs.html).toContain('#+not a keyword');
        // Notebooks keep src blocks only
        const ipynb = exportToIpynb(doc(), {});
        expect(ipynb).toContain('* Heading');
        expect(ipynb).not.toContain(',* Heading');
    });
});

describe('Babel drops the escaping comma', () => {
    it('when tangling or running named blocks', () => {
        const [block] = extractSourceBlocks(org(
            '#+begin_src sh :tangle make-notes.sh',
            'cat > notes.org <<EOF',
            ',* Notes',
            ',#+TITLE: x',
            'EOF',
            '#+end_src',
        ));
        expect(block.code).toBe('cat > notes.org <<EOF\n* Notes\n#+TITLE: x\nEOF');
    });

    it('escapes output written into src, example and export blocks', () => {
        const result = { success: true, stdout: '* Heading\n#+TITLE: t\ntext' };
        expect(formatResult(result, { wrap: 'src org' })).toContain(
            '#+BEGIN_SRC org\n,* Heading\n,#+TITLE: t\ntext\n#+END_SRC');
        expect(formatResult(result, { wrap: 'example' })).toContain(',* Heading');
        expect(formatResult(result, { type: 'html' })).toContain('#+BEGIN_EXPORT html\n,* Heading');
        // Org-parsed wrappers keep the output as org
        expect(formatResult(result, { wrap: 'quote' })).toContain('#+BEGIN_QUOTE\n* Heading');
    });
});
