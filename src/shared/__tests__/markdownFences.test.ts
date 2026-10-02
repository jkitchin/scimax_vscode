import { describe, it, expect } from 'vitest';
import { findMarkdownFencedBlocks, markdownFencedLineMask } from '../markdownFences';

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
