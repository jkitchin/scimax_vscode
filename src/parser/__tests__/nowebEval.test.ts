import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
import { buildNamedBlocksMap, executeCall, nowebExpandsOnEval, parseCallLine } from '../orgBabelAdvanced';

describe('noweb on evaluation', () => {
    it('expands for the values org expands at eval time', () => {
        for (const v of ['yes', 'eval', 'no-export', 'strip-export', 'strip-tangle', ' YES ']) {
            expect(nowebExpandsOnEval(v)).toBe(true);
        }
        for (const v of ['no', 'tangle', undefined, '']) {
            expect(nowebExpandsOnEval(v)).toBe(false);
        }
    });

    const doc = [
        '#+NAME: greet',
        '#+BEGIN_SRC sh',
        'echo hello',
        '#+END_SRC',
        '',
        '#+NAME: main',
        '#+BEGIN_SRC sh :noweb yes',
        '<<greet>>',
        'echo world',
        '#+END_SRC',
        '',
        '#+NAME: plain',
        '#+BEGIN_SRC sh',
        'echo "<<greet>>"',
        '#+END_SRC',
    ].join('\n');

    it('#+CALL: runs the expanded body when the block has :noweb yes', async () => {
        const blocks = buildNamedBlocksMap(doc);
        const result = await executeCall(parseCallLine('#+CALL: main()')!, blocks, {}, doc);
        expect(result.success).toBe(true);
        expect(result.stdout?.trim()).toBe('hello\nworld');
    });

    it('leaves references alone without :noweb', async () => {
        const blocks = buildNamedBlocksMap(doc);
        const result = await executeCall(parseCallLine('#+CALL: plain()')!, blocks, {}, doc);
        expect(result.stdout?.trim()).toBe('<<greet>>');
    });
});
