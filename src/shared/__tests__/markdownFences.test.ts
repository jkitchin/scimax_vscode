import { describe, it, expect } from 'vitest';
import { findFencedDivs, findMarkdownFencedBlocks, markdownFencedLineMask, matchCodeFenceOpen } from '../markdownFences';

describe('markdown fenced blocks', () => {
    it('marks # comment lines inside a code block as fenced', () => {
        const lines = ['# Heading', '```python', '# a comment', 'x = 1', '```', '## Sub'];
        expect(findMarkdownFencedBlocks(lines)).toEqual([{ start: 1, end: 4 }]);
        expect(markdownFencedLineMask(lines)).toEqual([false, true, true, true, true, false]);
    });

    it('requires a closing fence of the same character and enough length', () => {
        const lines = ['~~~~', '```', '# not a heading', '~~~', '~~~~', '# heading'];
        expect(findMarkdownFencedBlocks(lines)).toEqual([{ start: 0, end: 4 }]);
    });

    it('runs an unclosed fence to the end of the document', () => {
        const lines = ['text', '```sh', '# comment', '# another'];
        expect(findMarkdownFencedBlocks(lines)).toEqual([{ start: 1, end: 3 }]);
    });

    it('allows up to three spaces of fence indentation', () => {
        const lines = ['   ```', '# code', '   ```', '    ```', '# heading'];
        expect(markdownFencedLineMask(lines)).toEqual([true, true, true, false, false]);
    });

    it('ignores backtick fences whose info string contains a backtick', () => {
        expect(findMarkdownFencedBlocks(['``` a`b', '# heading'])).toEqual([]);
    });
});

describe('code fence openers', () => {
    it('reads a bare language and the Quarto chunk forms', () => {
        expect(matchCodeFenceOpen('```python')).toEqual({ fence: '```', language: 'python', braced: false });
        expect(matchCodeFenceOpen('```')).toEqual({ fence: '```', language: '', braced: false });
        expect(matchCodeFenceOpen('```{python}')).toEqual({ fence: '```', language: 'python', braced: true });
        expect(matchCodeFenceOpen('````{r, echo=FALSE}')).toEqual({ fence: '````', language: 'r', braced: true });
        expect(matchCodeFenceOpen('```{.python}')?.language).toBe('python');
        expect(matchCodeFenceOpen('```{=html}')?.language).toBe('html');
    });

    it('rejects lines that are not fence openers', () => {
        expect(matchCodeFenceOpen('``inline``')).toBeNull();
        expect(matchCodeFenceOpen('text ```{python}')).toBeNull();
    });
});

describe('fenced divs', () => {
    it('pairs nested divs and ignores colons inside code blocks', () => {
        const lines = [
            '::: {.callout-note}',      // 0
            'Note',                     // 1
            ':::: {.columns}',          // 2
            '::: column',               // 3
            '```{python}',              // 4
            ':::',                      // 5 code, not a div fence
            '```',                      // 6
            ':::',                      // 7 closes column
            '::::',                     // 8 closes columns
            ':::',                      // 9 closes callout
        ];
        expect(findFencedDivs(lines)).toEqual([
            { start: 0, end: 9 },
            { start: 2, end: 8 },
            { start: 3, end: 7 },
        ]);
    });

    it('drops an unclosed div', () => {
        expect(findFencedDivs(['::: warning', 'text'])).toEqual([]);
    });
});
