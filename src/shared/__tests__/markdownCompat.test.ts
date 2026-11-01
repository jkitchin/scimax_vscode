import { describe, it, expect } from 'vitest';
import { markdownNonProseMask } from '../markdownFences';
import { firstHeadingLevel, shiftHeadingLevels } from '../headingText';
import {
    findMarkdownLinkAt,
    formatMarkdownLink,
    markdownHeadingSlug,
    markdownHeadingTitle,
    orgLinkToMarkdownTarget,
} from '../markdownLinks';
import { findMarkdownResults, orgResultsToMarkdown } from '../markdownResults';

describe('markdownNonProseMask', () => {
    it('marks fenced code, front matter and HTML comments', () => {
        const lines = [
            '---',               // 0 front matter
            '# yaml comment',    // 1
            '---',               // 2
            '# Real',            // 3
            '```python',         // 4
            '# code comment',    // 5
            '```',               // 6
            '<!--',              // 7
            '# commented out',   // 8
            '-->',               // 9
            '## Also real',      // 10
        ];
        const mask = markdownNonProseMask(lines);
        expect(mask).toEqual([true, true, true, false, true, true, true, true, true, true, false]);
    });

    it('does not treat a later --- line as front matter', () => {
        expect(markdownNonProseMask(['# A', '---', '# B', '---'])).toEqual([false, false, false, false]);
    });
});

describe('shiftHeadingLevels', () => {
    it('leaves # comments in code blocks alone', () => {
        const text = '# Intro\n```bash\n# install\n```\n## Sub\n';
        expect(shiftHeadingLevels(text, 1, false)).toBe('## Intro\n```bash\n# install\n```\n### Sub\n');
    });

    it('caps markdown headings at level 6 and org at level 1', () => {
        expect(shiftHeadingLevels('##### a\n###### b', 2, false)).toBe('###### a\n###### b');
        expect(shiftHeadingLevels('* a\n** b', -3, true)).toBe('* a\n* b');
    });

    it('finds the first real heading level', () => {
        expect(firstHeadingLevel('```\n# x\n```\n### y', false)).toBe(3);
        expect(firstHeadingLevel('** a', true)).toBe(2);
    });
});

describe('markdown links', () => {
    it('finds links and images at a column', () => {
        const line = 'See [the docs](./docs/a.md#setup) and ![plot](<img dir/p.png> "t").';
        expect(findMarkdownLinkAt(line, 6)).toMatchObject({ text: 'the docs', target: './docs/a.md#setup', image: false });
        expect(findMarkdownLinkAt(line, 42)).toMatchObject({ text: 'plot', target: 'img dir/p.png', image: true });
        expect(findMarkdownLinkAt(line, 0)).toBeNull();
    });

    it('formats links, wrapping destinations with spaces', () => {
        expect(formatMarkdownLink('https://x.org', 'X')).toBe('[X](https://x.org)');
        expect(formatMarkdownLink('my file.md')).toBe('[my file.md](<my file.md>)');
    });

    it('makes GitHub-style slugs', () => {
        expect(markdownHeadingSlug('Results & Discussion')).toBe('results--discussion');
        expect(markdownHeadingSlug('  Step 2: Fit_model ')).toBe('step-2-fit_model');
    });

    it('reads heading titles, closing hashes and {#id}', () => {
        expect(markdownHeadingTitle('## Title ##')).toEqual({ title: 'Title', id: undefined });
        expect(markdownHeadingTitle('# Intro {#sec-intro .unnumbered}')).toEqual({ title: 'Intro', id: 'sec-intro' });
        expect(markdownHeadingTitle('not a heading')).toBeNull();
    });

    it('converts stored org links to markdown targets', () => {
        expect(orgLinkToMarkdownTarget('*Results & Discussion')).toBe('#results--discussion');
        expect(orgLinkToMarkdownTarget('file:notes.md::*Setup')).toBe('notes.md#setup');
        expect(orgLinkToMarkdownTarget('file:a.org::#my-id')).toBe('a.org#my-id');
        expect(orgLinkToMarkdownTarget('file:a.md::12')).toBe('a.md');
        expect(orgLinkToMarkdownTarget('https://x.org')).toBe('https://x.org');
    });
});

describe('markdown results', () => {
    it('converts verbatim output and images', () => {
        const md = orgResultsToMarkdown('#+RESULTS:\n: 1\n: 2\n[[file:.ob-jupyter/a.png]]');
        expect(md).toBe('<!-- results -->\n```\n1\n2\n```\n![](.ob-jupyter/a.png)\n<!-- /results -->');
    });

    it('uses a longer fence when output contains backticks', () => {
        const md = orgResultsToMarkdown('#+RESULTS:\n: ```x```');
        expect(md).toContain('````\n```x```\n````');
    });

    it('converts tables, lists and named results', () => {
        expect(orgResultsToMarkdown('#+RESULTS: tbl\n| a | b |\n| 1 | 2 |')).toBe(
            '<!-- results: tbl -->\n| a | b |\n|---|---|\n| 1 | 2 |\n<!-- /results -->'
        );
        expect(orgResultsToMarkdown('#+RESULTS:\n- x\n- y')).toBe('<!-- results -->\n- x\n- y\n<!-- /results -->');
    });

    it('keeps html export blocks as raw html and handles empty results', () => {
        expect(orgResultsToMarkdown('#+RESULTS:\n#+BEGIN_EXPORT html\n<b>hi</b>\n#+END_EXPORT')).toBe(
            '<!-- results -->\n<b>hi</b>\n<!-- /results -->'
        );
        expect(orgResultsToMarkdown('#+RESULTS:')).toBe('<!-- results -->\n<!-- /results -->');
    });

    it('finds existing results after a block so a re-run replaces them', () => {
        const lines = ['```python', 'print(1)', '```', '', '<!-- results -->', '```', '1', '```', '<!-- /results -->', 'text'];
        expect(findMarkdownResults(lines, 2)).toEqual({ start: 4, end: 8 });
        expect(findMarkdownResults(['```', 'x', '```', 'text'], 2)).toBeNull();
    });
});
