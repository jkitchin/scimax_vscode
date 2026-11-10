import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    window: { createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }) },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

import { extractSourceBlocks } from '../orgBabelAdvanced';

describe('extractSourceBlocks', () => {
    it('finds indented blocks (in a list) and removes their indentation', () => {
        const text = [
            '- step one',
            '  #+NAME: setup',
            '  #+BEGIN_SRC python :tangle a.py',
            '  if x:',
            '      y()',
            '  #+END_SRC',
        ].join('\n');
        const [block] = extractSourceBlocks(text);
        expect(block.name).toBe('setup');
        expect(block.tangleFile).toBe('a.py');
        expect(block.code).toBe('if x:\n    y()');
    });

    it('keeps #+key: lines inside a block as code', () => {
        const text = [
            '#+BEGIN_SRC org :tangle t.org',
            '#+TITLE: Inner',
            '#+NAME: not-a-name',
            'text',
            '#+END_SRC',
        ].join('\n');
        const blocks = extractSourceBlocks(text);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].name).toBeUndefined();
        expect(blocks[0].code).toBe('#+TITLE: Inner\n#+NAME: not-a-name\ntext');
    });
});
