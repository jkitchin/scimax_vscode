import { describe, it, expect } from 'vitest';
import { findMarkdownSourceBlocks, markdownDefaultHeaders, markdownSourceBlockAt, runsInMarpPanel } from '../markdownBabel';

const lines = [
    '# Notes',                              // 0
    '```python',                            // 1
    'x = 1',                                // 2
    '```',                                  // 3
    '',                                     // 4
    '<!-- results -->',                     // 5
    '```',                                  // 6
    '1',                                    // 7
    '```',                                  // 8
    '<!-- /results -->',                    // 9
    '```bash :results output :dir /tmp',    // 10
    'ls',                                   // 11
    '```',                                  // 12
    '```python run',                        // 13 a Marp run cell
    'print(1)',                             // 14
    '```',                                  // 15
];

describe('markdown source blocks', () => {
    it('finds blocks with their header arguments and earlier results', () => {
        const blocks = findMarkdownSourceBlocks(lines);
        expect(blocks.map(b => [b.language, b.parameters, b.startLine, b.endLine])).toEqual([
            ['python', '', 1, 3],
            ['text', '', 6, 8],
            ['bash', ':results output :dir /tmp', 10, 12],
        ]);
        expect(blocks[0]).toMatchObject({ code: 'x = 1', resultsLine: 5, resultsEndLine: 9 });
        expect(blocks[2].resultsLine).toBeUndefined();
    });

    it('finds the block under a line, fences included', () => {
        expect(markdownSourceBlockAt(lines, 3)?.startLine).toBe(1);
        expect(markdownSourceBlockAt(lines, 11)?.language).toBe('bash');
        expect(markdownSourceBlockAt(lines, 4)).toBeUndefined();
        expect(markdownSourceBlockAt(lines, 14)).toBeUndefined();
    });

    it('skips an unclosed fence', () => {
        expect(findMarkdownSourceBlocks(['```python', 'x = 1'])).toEqual([]);
    });

    it('gives each file its own default session', () => {
        expect(markdownDefaultHeaders('/a/notes.md')).toEqual({ session: 'markdown:/a/notes.md' });
        expect(markdownDefaultHeaders('/b/notes.md').session).not.toBe(markdownDefaultHeaders('/a/notes.md').session);
    });

    it('runs only plain Python blocks in the Marp panel', () => {
        expect(runsInMarpPanel({ language: 'python', parameters: '' })).toBe(true);
        expect(runsInMarpPanel({ language: 'Py', parameters: '  ' })).toBe(true);
        expect(runsInMarpPanel({ language: 'python', parameters: ':results output' })).toBe(false);
        expect(runsInMarpPanel({ language: 'bash', parameters: '' })).toBe(false);
    });
});
