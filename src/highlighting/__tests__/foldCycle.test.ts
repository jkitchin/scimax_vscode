import { describe, it, expect } from 'vitest';
import { visibleLineFor } from '../foldCycle';

// * A          0-9
// ** B         2-6
// *** C        4-6   (body 5-6)
// ** D         7-9
// * E          10-12
const ranges = [
    { start: 0, end: 9 },
    { start: 2, end: 6 },
    { start: 4, end: 6 },
    { start: 7, end: 9 },
    { start: 10, end: 12 },
];

describe('visibleLineFor', () => {
    it('moves a hidden heading to the top-level heading when everything is folded', () => {
        expect(visibleLineFor(ranges, 4, 1)).toBe(0);
        expect(visibleLineFor(ranges, 8, 1)).toBe(0);
    });

    it('moves it to the level-2 heading when the outermost ranges stay open', () => {
        expect(visibleLineFor(ranges, 4, 2)).toBe(2);
        expect(visibleLineFor(ranges, 5, 2)).toBe(2);
    });

    it('keeps lines that stay visible', () => {
        expect(visibleLineFor(ranges, 0, 1)).toBe(0);
        expect(visibleLineFor(ranges, 10, 1)).toBe(10);
        expect(visibleLineFor(ranges, 2, 2)).toBe(2);
        expect(visibleLineFor(ranges, 4, Infinity)).toBe(4);
    });

    it('does not depend on the order of the ranges', () => {
        expect(visibleLineFor([...ranges].reverse(), 5, 2)).toBe(2);
    });
});
