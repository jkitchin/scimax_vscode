import { describe, it, expect } from 'vitest';
import {
    editorLineHeight,
    overlaySize,
    previewStripSvg,
    readSvgBox,
    sectionLines,
    shiftRanges,
} from '../latexOverlayLayout';

const SVG = "<?xml version='1.0'?>\n<svg version='1.1' xmlns='http://www.w3.org/2000/svg' width='26.9pt' height='11.75pt' viewBox='1.2 -8.4 26.9 11.75'>\n<path d='M0 0'/></svg>";

describe('shiftRanges', () => {
    const ranges = () => [{ start: 10, end: 20 }, { start: 30, end: 40 }];

    it('moves ranges after an insertion', () => {
        const kept = shiftRanges(ranges(), [{ offset: 0, length: 0, textLength: 3 }]);
        expect(kept).toEqual([{ start: 13, end: 23 }, { start: 33, end: 43 }]);
    });

    it('keeps a range when typing right before or after it', () => {
        expect(shiftRanges(ranges(), [{ offset: 10, length: 0, textLength: 1 }])[0]).toEqual({ start: 11, end: 21 });
        expect(shiftRanges(ranges(), [{ offset: 20, length: 0, textLength: 1 }])[0]).toEqual({ start: 10, end: 20 });
    });

    it('drops a range edited inside', () => {
        expect(shiftRanges(ranges(), [{ offset: 15, length: 0, textLength: 1 }])).toEqual([{ start: 31, end: 41 }]);
        expect(shiftRanges(ranges(), [{ offset: 18, length: 5, textLength: 0 }])).toEqual([{ start: 25, end: 35 }]);
    });

    it('stretches a range being edited and marks it', () => {
        const editing = (r: { start: number }) => r.start === 10;
        expect(shiftRanges(ranges(), [{ offset: 15, length: 0, textLength: 3 }], editing))
            .toEqual([{ start: 10, end: 23, edited: true }, { start: 33, end: 43 }]);
        expect(shiftRanges(ranges(), [{ offset: 12, length: 4, textLength: 1 }], editing)[0])
            .toEqual({ start: 10, end: 17, edited: true });
        // An edit across its edge still drops it
        expect(shiftRanges(ranges(), [{ offset: 18, length: 5, textLength: 0 }], editing)).toEqual([{ start: 25, end: 35 }]);
    });

    it('applies several edits given in old-document coordinates', () => {
        const kept = shiftRanges(ranges(), [
            { offset: 5, length: 0, textLength: 2 },
            { offset: 25, length: 2, textLength: 0 },
        ]);
        expect(kept).toEqual([{ start: 12, end: 22 }, { start: 30, end: 40 }]);
    });
});

describe('readSvgBox', () => {
    it('reads the viewBox and the depth below the baseline', () => {
        const box = readSvgBox(SVG)!;
        expect(box).toMatchObject({ x: 1.2, y: -8.4, width: 26.9, height: 11.75 });
        expect(box.depth).toBeCloseTo(3.35);
    });

    it('returns undefined without a viewBox', () => {
        expect(readSvgBox("<svg width='3pt'></svg>")).toBeUndefined();
    });
});

describe('overlaySize', () => {
    const box = { x: 0, y: -8, width: 20, height: 10, depth: 2 };

    it('scales 10pt to the editor font', () => {
        expect(overlaySize(box, 15, 30, 1)).toMatchObject({ width: 30, height: 15, depth: 3, top: 7.5 });
    });

    it('shrinks a preview taller than its lines', () => {
        const size = overlaySize(box, 30, 20, 1);
        expect(size.height).toBe(20);
        expect(size.width).toBe(40);
    });

    it('has room for a tall equation over several lines', () => {
        expect(overlaySize(box, 30, 20, 2).height).toBe(30);
    });
});

describe('editorLineHeight', () => {
    it('follows VS Code rules', () => {
        expect(editorLineHeight(14, 0, 'darwin')).toBe(21);
        expect(editorLineHeight(20, 0, 'linux')).toBe(27);
        expect(editorLineHeight(14, 2, 'linux')).toBe(28);
        expect(editorLineHeight(14, 24, 'linux')).toBe(24);
    });
});

describe('previewStripSvg', () => {
    const box = readSvgBox(SVG)!;

    it('sizes and colours a one-line preview', () => {
        const size = overlaySize(box, 10, 30, 1);
        const out = previewStripSvg(SVG, box, size, 0, '#abc');
        expect(out).toContain("width='26.9px' height='11.75px' viewBox='1.2 -8.4 26.9 11.75'");
        expect(out).toContain("fill='#abc'");
        expect(out).not.toContain("width='26.9pt'");
        expect(out).toContain("<path d='M0 0'/>");
    });

    it('cuts a block preview into line-high strips', () => {
        const size = overlaySize(box, 10, 10, 3); // 11.75px tall, centred in 30px
        const strips = [0, 1, 2].map(i => previewStripSvg(SVG, box, size, i, '#000'));
        const viewBoxes = strips.map(s => s.match(/viewBox='([^']+)'/)![1].split(' ').map(Number));
        // Each strip is one line (10px = 10 units) high and they follow on
        expect(viewBoxes.map(v => v[3])).toEqual([10, 10, 10]);
        expect(viewBoxes[1][1] - viewBoxes[0][1]).toBeCloseTo(10);
        // The equation top (y = -8.4) is 9.125px into the block
        expect(viewBoxes[0][1]).toBeCloseTo(-8.4 - 9.125);
        expect(strips[0]).toContain("height='10px'");
    });
});

describe('sectionLines', () => {
    const lines = ['#+TITLE: x', '$a$', '* One', 'text $b$', '** Two', '$c$', '* Three'];

    it('runs from the heading to the next heading', () => {
        expect(sectionLines(lines, 3)).toEqual({ start: 2, end: 4 });
        expect(sectionLines(lines, 4)).toEqual({ start: 4, end: 6 });
    });

    it('covers the text before the first heading', () => {
        expect(sectionLines(lines, 1)).toEqual({ start: 0, end: 2 });
    });
});
