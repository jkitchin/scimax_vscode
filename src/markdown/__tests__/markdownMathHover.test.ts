import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { findMarkdownMathAt } from '../markdownMathHover';

const doc = [
    '---',            // 0
    'title: $x$',     // 1
    '---',            // 2
    'Inline $a^2$ and \\(b\\) here, `code $c$` too.', // 3
    '',               // 4
    '$$',             // 5
    'E = mc^2',       // 6
    '$$',             // 7
    '',               // 8
    '```python',      // 9
    'print("$y$")',   // 10
    '```',            // 11
    '\\begin{equation}', // 12
    'x + y',          // 13
    '\\end{equation}', // 14
    'Costs $5 and $6.', // 15
    '\\[',            // 16
    '\\int f',        // 17
    '\\]',            // 18
    'One line: \\begin{align} a &= b \\end{align}', // 19
].join('\n');

describe('findMarkdownMathAt', () => {
    it('finds inline math', () => {
        expect(findMarkdownMathAt(doc, 3, 9)?.raw).toBe('$a^2$');
        expect(findMarkdownMathAt(doc, 3, 19)?.raw).toBe('\\(b\\)');
    });
    it('skips code spans, code fences and front matter', () => {
        expect(findMarkdownMathAt(doc, 3, 34)).toBeNull();
        expect(findMarkdownMathAt(doc, 10, 9)).toBeNull();
        expect(findMarkdownMathAt(doc, 1, 8)).toBeNull();
    });
    it('finds multi-line $$ and \\[ blocks from any of their lines', () => {
        for (const line of [5, 6, 7]) {
            const f = findMarkdownMathAt(doc, line, 1);
            expect(f?.type).toBe('display');
            expect(f?.content.trim()).toBe('E = mc^2');
        }
        expect(findMarkdownMathAt(doc, 17, 2)?.content.trim()).toBe('\\int f');
    });
    it('finds math environments', () => {
        const f = findMarkdownMathAt(doc, 13, 1);
        expect(f?.type).toBe('environment');
        expect(f?.raw).toBe('\\begin{equation}\nx + y\n\\end{equation}');
        expect(findMarkdownMathAt(doc, 19, 20)?.environment).toBe('align');
    });
    it('ignores prose and currency', () => {
        expect(findMarkdownMathAt(doc, 4, 0)).toBeNull();
        expect(findMarkdownMathAt(doc, 15, 7)).toBeNull();
        expect(findMarkdownMathAt(doc, 8, 0)).toBeNull();
    });
});
