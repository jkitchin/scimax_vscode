/**
 * Tests for table row parsing — focused on pipe handling inside markup,
 * escapes, and LaTeX math fragments.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    window: {
        createTextEditorDecorationType: vi.fn(() => ({})),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    },
    workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
    languages: { registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })) },
    Range: class {},
    Position: class {},
    Selection: class {},
    EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
}));

import { parseRow, swapCell, CellMoveRow, computeShrinkRanges, ShrinkRange,
    parseTableText, formatTableLines, looksLikeTable } from '../tableProvider';

describe('parseRow', () => {
    it('splits a simple row on pipes', () => {
        expect(parseRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
    });

    it('treats escaped pipes as literal', () => {
        expect(parseRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
    });

    it('keeps pipes inside \\(...\\) inline math', () => {
        expect(parseRow('| Max \\(|P_{seq} - P_{sim}|\\) (bar) | 0.014 |'))
            .toEqual(['Max \\(|P_{seq} - P_{sim}|\\) (bar)', '0.014']);
    });

    it('keeps pipes inside \\[...\\] display math', () => {
        expect(parseRow('| label | \\[a | b\\] | end |'))
            .toEqual(['label', '\\[a | b\\]', 'end']);
    });

    it('falls back to splitting when math is not closed', () => {
        // Unclosed \( should not swallow the rest of the row
        expect(parseRow('| \\(x | y | z |'))
            .toEqual(['\\(x', 'y', 'z']);
    });

    it('keeps pipes inside $...$ inline math', () => {
        expect(parseRow('| label | $|a|b|$ | end |'))
            .toEqual(['label', '$|a|b|$', 'end']);
    });

    it('keeps pipes inside $$...$$ display math', () => {
        expect(parseRow('| x | $$a|b$$ | y |'))
            .toEqual(['x', '$$a|b$$', 'y']);
    });

    it('does not treat a lone $ (like "Profit ($)") as math', () => {
        // Single $ with no closing partner stays literal so the column
        // header "Profit ($)" still splits normally.
        expect(parseRow('| Profit ($) | 10462901 |'))
            .toEqual(['Profit ($)', '10462901']);
    });

    it('does not treat $5 and $6$ as math (border rules)', () => {
        // "$5 and $6" — first $ followed by '5' is fine, but closing-$
        // candidate is preceded by space → fails FORBIDDEN_LAST. Should split.
        expect(parseRow('| $5 and $6 | next |'))
            .toEqual(['$5 and $6', 'next']);
    });
});

describe('swapCell', () => {
    // | a | b | c |
    // |---+---+---|
    // | d | e | f |
    // | g | h | i |
    const table = (): CellMoveRow[] => [
        ['a', 'b', 'c'],
        null,
        ['d', 'e', 'f'],
        ['g', 'h', 'i'],
    ];

    it('swaps with the cell to the right', () => {
        const result = swapCell(table(), 2, 0, 0, 1);
        expect(result?.rows[2]).toEqual(['e', 'd', 'f']);
        expect(result).toMatchObject({ targetRow: 2, targetCol: 1 });
    });

    it('swaps with the cell to the left', () => {
        const result = swapCell(table(), 2, 2, 0, -1);
        expect(result?.rows[2]).toEqual(['d', 'f', 'e']);
        expect(result).toMatchObject({ targetRow: 2, targetCol: 2 - 1 });
    });

    it('swaps with the cell below', () => {
        const result = swapCell(table(), 2, 1, 1, 0);
        expect(result?.rows[2]).toEqual(['d', 'h', 'f']);
        expect(result?.rows[3]).toEqual(['g', 'e', 'i']);
        expect(result).toMatchObject({ targetRow: 3, targetCol: 1 });
    });

    it('steps over a separator when moving up', () => {
        const result = swapCell(table(), 2, 1, -1, 0);
        expect(result?.rows[0]).toEqual(['a', 'e', 'c']);
        expect(result?.rows[1]).toBeNull();
        expect(result?.rows[2]).toEqual(['d', 'b', 'f']);
        expect(result).toMatchObject({ targetRow: 0, targetCol: 1 });
    });

    it('does not mutate the input rows', () => {
        const rows = table();
        swapCell(rows, 2, 0, 0, 1);
        expect(rows[2]).toEqual(['d', 'e', 'f']);
    });

    it('refuses to move past the first row', () => {
        expect(swapCell(table(), 0, 0, -1, 0)).toBeNull();
    });

    it('refuses to move past the last row', () => {
        expect(swapCell(table(), 3, 0, 1, 0)).toBeNull();
    });

    it('refuses to move past the first column', () => {
        expect(swapCell(table(), 2, 0, 0, -1)).toBeNull();
    });

    it('refuses to move past the last column', () => {
        expect(swapCell(table(), 2, 2, 0, 1)).toBeNull();
    });

    it('refuses to move from a separator row', () => {
        expect(swapCell(table(), 1, 0, 1, 0)).toBeNull();
    });

    it('pads a ragged target row so the swap lands in the right column', () => {
        const rows: CellMoveRow[] = [
            ['a', 'b', 'c'],
            ['d'],
        ];
        const result = swapCell(rows, 0, 2, 1, 0);
        expect(result?.rows[0]).toEqual(['a', 'b', '']);
        expect(result?.rows[1]).toEqual(['d', '', 'c']);
    });

    it('pads a ragged source row when moving into it', () => {
        const rows: CellMoveRow[] = [
            ['a', 'b', 'c'],
            ['d'],
        ];
        const result = swapCell(rows, 1, 0, 0, 1);
        // Padded only as far as the swap needs; formatting fills the rest
        expect(result?.rows[1]).toEqual(['', 'd']);
        expect(result).toMatchObject({ targetRow: 1, targetCol: 1 });
    });

    it('allows a column that only exists in another row', () => {
        // Row 1 is short, but column 2 exists in the table
        const rows: CellMoveRow[] = [
            ['a', 'b', 'c'],
            ['d', 'e'],
        ];
        const result = swapCell(rows, 1, 1, 0, 1);
        expect(result?.rows[1]).toEqual(['d', '', 'e']);
    });

    it('refuses a cursor column past the end of the table', () => {
        expect(swapCell(table(), 2, 3, 0, 1)).toBeNull();
    });
});

/** Render lines the way the editor shows them with the shrink decorations applied */
function renderShrunk(lines: string[], ranges: ShrinkRange[]): string[] {
    return lines.map((line, i) => {
        const mine = ranges.filter(r => r.line === i).sort((a, b) => b.start - a.start);
        let out = line;
        for (const r of mine) {
            out = out.slice(0, r.start) + (r.ellipsis ? '>' : '') + out.slice(r.end);
        }
        return out;
    });
}

describe('computeShrinkRanges', () => {
    // Aligned buffer text keeps the full cell content; widths [3, 40]
    const table = [
        '| <l> |                   <15>                   |',
        '|-----+------------------------------------------|',
        '| 0   | A very long sentence that takes up space |',
        '| 1   | a short one                              |',
    ];

    it('narrows a <N> column in display only, keeping columns aligned', () => {
        const ranges = computeShrinkRanges(table, [3, 40], [undefined, 15], 0);
        expect(renderShrunk(table, ranges)).toEqual([
            '| <l> |      <15>       |',
            '|-----+-----------------|',
            '| 0   | A very long se> |',
            '| 1   | a short one     |',
        ]);
    });

    it('keeps later columns aligned when the narrowed column is not last', () => {
        const lines = [
            '|                <5>                 | <l> |',
            '|------------------------------------+-----|',
            '| Long text you do not want shown in | x   |',
            '| More long                          | y   |',
        ];
        const ranges = computeShrinkRanges(lines, [34, 3], [5, undefined], 0);
        expect(renderShrunk(lines, ranges)).toEqual([
            '|  <5>  | <l> |',
            '|-------+-----|',
            '| Long> | x   |',
            '| More> | y   |',
        ]);
    });

    it('leaves skipped lines and unaligned lines in full', () => {
        const lines = [...table];
        lines[3] = '| 1 | a short one |';
        const ranges = computeShrinkRanges(lines, [3, 40], [undefined, 15], 0, new Set([2]));
        expect(ranges.some(r => r.line === 2 || r.line === 3)).toBe(false);
    });
});

describe('parseTableText', () => {
    it('parses CSV with quoting, embedded newlines and CRLF', () => {
        expect(parseTableText('name,note\r\n"Smith, J","said ""hi""\nthen left"\r\n'))
            .toEqual([['name', 'note'], ['Smith, J', 'said "hi" then left']]);
    });

    it('parses TSV even when cells contain commas', () => {
        expect(parseTableText('a\tb, c\n1\t2, 3')).toEqual([['a', 'b, c'], ['1', '2, 3']]);
    });

    it('prefers semicolons for European CSV with decimal commas', () => {
        expect(parseTableText('x;y\n1,5;2,25')).toEqual([['x', 'y'], ['1,5', '2,25']]);
    });

    it('splits space-aligned columns on runs of spaces', () => {
        expect(parseTableText('   name      value\n0  long name   1.5'))
            .toEqual([['name', 'value', ''], ['0', 'long name', '1.5']]);
    });

    it('reads Markdown tables and drops the rule', () => {
        expect(parseTableText('| a | b |\n| --- | :-: |\n| 1 | 2 |')).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('pads short rows', () => {
        expect(parseTableText('a,b,c\n1,2\n')).toEqual([['a', 'b', 'c'], ['1', '2', '']]);
    });
});

describe('formatTableLines', () => {
    it('aligns, adds a header rule and escapes pipes', () => {
        expect(formatTableLines([['op', 'meaning'], ['a|b', 'or']], true)).toEqual([
            '| op        | meaning |',
            '|-----------+---------|',
            '| a\\vert{}b | or      |',
        ]);
        expect(formatTableLines([['a|b']], false)).toEqual(['| a\\|b |']);
    });
});

describe('looksLikeTable', () => {
    it('accepts consistent delimited data and existing tables', () => {
        expect(looksLikeTable('a,b\n1,2')).toBe(true);
        expect(looksLikeTable('a\tb\n1\t2')).toBe(true);
        expect(looksLikeTable('| a |\n| 1 |')).toBe(true);
    });

    it('rejects prose and single lines', () => {
        expect(looksLikeTable('Hello, world')).toBe(false);
        expect(looksLikeTable('First, a thing.\nThen two, three, four.')).toBe(false);
    });
});
