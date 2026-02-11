import { describe, it, expect } from 'vitest';
import {
    computeRectangle,
    extractRectangle,
    computeDeleteEdits,
    computeClearEdits,
    computeOpenEdits,
    computeNumberLineEdits,
    computeStringEdits,
    computeYankEdits,
} from '../rectangleCore';

/** Helper: create a getLineText function from an array of strings */
function makeGetLine(lines: string[]) {
    return (n: number) => lines[n];
}

describe('computeRectangle', () => {
    it('normalizes top-left to bottom-right', () => {
        const r = computeRectangle(0, 2, 3, 8);
        expect(r).toEqual({ startLine: 0, endLine: 3, startCol: 2, endCol: 8 });
    });

    it('normalizes bottom-right to top-left', () => {
        const r = computeRectangle(3, 8, 0, 2);
        expect(r).toEqual({ startLine: 0, endLine: 3, startCol: 2, endCol: 8 });
    });

    it('normalizes top-right to bottom-left', () => {
        const r = computeRectangle(0, 8, 3, 2);
        expect(r).toEqual({ startLine: 0, endLine: 3, startCol: 2, endCol: 8 });
    });

    it('normalizes bottom-left to top-right', () => {
        const r = computeRectangle(3, 2, 0, 8);
        expect(r).toEqual({ startLine: 0, endLine: 3, startCol: 2, endCol: 8 });
    });

    it('handles single-line selection', () => {
        const r = computeRectangle(5, 3, 5, 10);
        expect(r).toEqual({ startLine: 5, endLine: 5, startCol: 3, endCol: 10 });
    });

    it('handles zero-width selection', () => {
        const r = computeRectangle(1, 4, 3, 4);
        expect(r).toEqual({ startLine: 1, endLine: 3, startCol: 4, endCol: 4 });
    });
});

describe('extractRectangle', () => {
    const lines = [
        'ABCDEFGHIJ',   // 10 chars
        '0123456789',   // 10 chars
        'abcdefghij',   // 10 chars
        'KLMNOPQRST',   // 10 chars
    ];
    const getLine = makeGetLine(lines);

    it('extracts from uniform-length lines', () => {
        const region = { startLine: 0, endLine: 3, startCol: 2, endCol: 5 };
        expect(extractRectangle(getLine, region)).toEqual(['CDE', '234', 'cde', 'MNO']);
    });

    it('handles lines shorter than startCol', () => {
        const shortLines = ['ABCDEFGHIJ', 'AB', 'abcdefghij'];
        const get = makeGetLine(shortLines);
        const region = { startLine: 0, endLine: 2, startCol: 5, endCol: 8 };
        expect(extractRectangle(get, region)).toEqual(['FGH', '', 'fgh']);
    });

    it('handles lines shorter than endCol', () => {
        const shortLines = ['ABCDEFGHIJ', 'ABCDEF', 'abcdefghij'];
        const get = makeGetLine(shortLines);
        const region = { startLine: 0, endLine: 2, startCol: 3, endCol: 8 };
        expect(extractRectangle(get, region)).toEqual(['DEFGH', 'DEF', 'defgh']);
    });

    it('extracts single line', () => {
        const region = { startLine: 1, endLine: 1, startCol: 0, endCol: 4 };
        expect(extractRectangle(getLine, region)).toEqual(['0123']);
    });
});

describe('computeDeleteEdits', () => {
    const lines = ['ABCDEFGHIJ', 'AB', 'abcdefghij'];
    const getLine = makeGetLine(lines);

    it('produces correct delete ranges', () => {
        const region = { startLine: 0, endLine: 2, startCol: 2, endCol: 5 };
        const edits = computeDeleteEdits(getLine, region);
        expect(edits).toEqual([
            { line: 0, startCol: 2, endCol: 5 },
            // line 1 is skipped — too short (length 2 <= startCol 2)
            { line: 2, startCol: 2, endCol: 5 },
        ]);
    });

    it('clamps endCol to line length', () => {
        const shortLines = ['ABCDEF'];
        const get = makeGetLine(shortLines);
        const region = { startLine: 0, endLine: 0, startCol: 3, endCol: 10 };
        const edits = computeDeleteEdits(get, region);
        expect(edits).toEqual([{ line: 0, startCol: 3, endCol: 6 }]);
    });

    it('skips lines shorter than startCol', () => {
        const shortLines = ['AB'];
        const get = makeGetLine(shortLines);
        const region = { startLine: 0, endLine: 0, startCol: 5, endCol: 8 };
        expect(computeDeleteEdits(get, region)).toEqual([]);
    });
});

describe('computeClearEdits', () => {
    it('replaces with correct-width spaces', () => {
        const lines = ['ABCDEFGHIJ', '0123456789'];
        const getLine = makeGetLine(lines);
        const region = { startLine: 0, endLine: 1, startCol: 2, endCol: 5 };
        const edits = computeClearEdits(getLine, region);
        expect(edits).toEqual([
            { line: 0, startCol: 2, endCol: 5, text: '   ' },
            { line: 1, startCol: 2, endCol: 5, text: '   ' },
        ]);
    });

    it('pads short lines', () => {
        const lines = ['AB'];
        const getLine = makeGetLine(lines);
        const region = { startLine: 0, endLine: 0, startCol: 5, endCol: 8 };
        const edits = computeClearEdits(getLine, region);
        // Line is length 2, need to pad from 2 to 8 (6 spaces)
        expect(edits).toEqual([
            { line: 0, startCol: 2, endCol: 2, text: '      ' },
        ]);
    });
});

describe('computeOpenEdits', () => {
    it('inserts correct space count', () => {
        const lines = ['ABCDEFGHIJ', '0123456789'];
        const getLine = makeGetLine(lines);
        const region = { startLine: 0, endLine: 1, startCol: 3, endCol: 6 };
        const edits = computeOpenEdits(getLine, region);
        expect(edits).toEqual([
            { line: 0, startCol: 3, endCol: 3, text: '   ' },
            { line: 1, startCol: 3, endCol: 3, text: '   ' },
        ]);
    });

    it('pads short lines', () => {
        const lines = ['AB'];
        const getLine = makeGetLine(lines);
        const region = { startLine: 0, endLine: 0, startCol: 5, endCol: 8 };
        const edits = computeOpenEdits(getLine, region);
        // Line is length 2, needs padding of 3 (to col 5) + 3 (width) = 6 spaces
        expect(edits).toEqual([
            { line: 0, startCol: 2, endCol: 2, text: '      ' },
        ]);
    });
});

describe('computeNumberLineEdits', () => {
    const lines = ['ABCDEFGHIJ', '0123456789', 'abcdefghij'];
    const getLine = makeGetLine(lines);

    it('inserts correct numbers starting from 1', () => {
        const region = { startLine: 0, endLine: 2, startCol: 0, endCol: 3 };
        const edits = computeNumberLineEdits(getLine, region);
        expect(edits).toHaveLength(3);
        expect(edits[0].text).toBe('1 ');
        expect(edits[1].text).toBe('2 ');
        expect(edits[2].text).toBe('3 ');
    });

    it('uses custom start number', () => {
        const region = { startLine: 0, endLine: 2, startCol: 0, endCol: 3 };
        const edits = computeNumberLineEdits(getLine, region, 5);
        expect(edits[0].text).toBe('5 ');
        expect(edits[1].text).toBe('6 ');
        expect(edits[2].text).toBe('7 ');
    });

    it('pads numbers to consistent width', () => {
        const manyLines = Array.from({ length: 12 }, () => 'ABCDEFGHIJ');
        const get = makeGetLine(manyLines);
        const region = { startLine: 0, endLine: 11, startCol: 0, endCol: 5 };
        const edits = computeNumberLineEdits(get, region);
        // Max number is 12, width 2
        expect(edits[0].text).toBe(' 1 ');
        expect(edits[8].text).toBe(' 9 ');
        expect(edits[9].text).toBe('10 ');
        expect(edits[11].text).toBe('12 ');
    });

    it('uses format string when provided', () => {
        const region = { startLine: 0, endLine: 2, startCol: 0, endCol: 5 };
        const edits = computeNumberLineEdits(getLine, region, 1, '%d. ');
        expect(edits[0].text).toBe('1. ');
        expect(edits[1].text).toBe('2. ');
        expect(edits[2].text).toBe('3. ');
    });
});

describe('computeStringEdits', () => {
    const lines = ['ABCDEFGHIJ', '0123456789', 'abcdefghij'];
    const getLine = makeGetLine(lines);

    it('replaces rectangle content with string', () => {
        const region = { startLine: 0, endLine: 2, startCol: 2, endCol: 5 };
        const edits = computeStringEdits(getLine, region, '||');
        expect(edits).toEqual([
            { line: 0, startCol: 2, endCol: 5, text: '||' },
            { line: 1, startCol: 2, endCol: 5, text: '||' },
            { line: 2, startCol: 2, endCol: 5, text: '||' },
        ]);
    });

    it('pads short lines', () => {
        const shortLines = ['AB'];
        const get = makeGetLine(shortLines);
        const region = { startLine: 0, endLine: 0, startCol: 5, endCol: 8 };
        const edits = computeStringEdits(get, region, 'XX');
        expect(edits).toEqual([
            { line: 0, startCol: 2, endCol: 2, text: '   XX' },
        ]);
    });
});

describe('computeYankEdits', () => {
    const lines = ['ABCDEFGHIJ', '0123456789', 'abcdefghij'];
    const getLine = makeGetLine(lines);

    it('inserts rectangle text at position', () => {
        const rectText = ['XX', 'YY', 'ZZ'];
        const edits = computeYankEdits(getLine, 3, 0, 3, rectText);
        expect(edits).toEqual([
            { line: 0, startCol: 3, endCol: 3, text: 'XX' },
            { line: 1, startCol: 3, endCol: 3, text: 'YY' },
            { line: 2, startCol: 3, endCol: 3, text: 'ZZ' },
        ]);
    });

    it('pads short lines', () => {
        const shortLines = ['AB', 'CDEF'];
        const get = makeGetLine(shortLines);
        const rectText = ['XX', 'YY'];
        const edits = computeYankEdits(get, 2, 0, 5, rectText);
        expect(edits).toEqual([
            { line: 0, startCol: 2, endCol: 2, text: '   XX' },
            { line: 1, startCol: 4, endCol: 4, text: ' YY' },
        ]);
    });

    it('creates new lines past document end', () => {
        const shortDoc = ['ABCD'];
        const get = makeGetLine(shortDoc);
        const rectText = ['XX', 'YY', 'ZZ'];
        const edits = computeYankEdits(get, 1, 0, 2, rectText);
        // Line 0: existing line, insert at col 2
        expect(edits[0]).toEqual({ line: 0, startCol: 2, endCol: 2, text: 'XX' });
        // Lines 1 and 2: beyond document end, append as new lines
        expect(edits[1]).toEqual({ line: 0, startCol: 4, endCol: 4, text: '\n  YY' });
        expect(edits[2]).toEqual({ line: 0, startCol: 4, endCol: 4, text: '\n\n  ZZ' });
    });
});
