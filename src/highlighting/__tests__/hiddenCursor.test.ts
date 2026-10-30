import { describe, it, expect } from 'vitest';
import { skipHidden } from '../hiddenCursor';

// "ab [[t][desc]] cd": prefix "[[t][" is 3-8, desc 8-12, suffix "]]" 12-14
const line = 'ab [[t][desc]] cd';
const hidden = [{ start: 3, end: 8 }, { start: 12, end: 14 }];
const skip = (from: number | undefined, to: number) => skipHidden(hidden, from, to, line.length);

describe('skipHidden', () => {
    it('leaves visible positions alone', () => {
        expect(skip(1, 2)).toBe(2);
        expect(skip(9, 10)).toBe(10);
        expect(skip(undefined, 8)).toBe(8);
    });

    it('moving right into the hidden prefix passes the first visible character', () => {
        // 3 (before the link) and 8 (before "d") draw at the same place
        expect(skip(3, 4)).toBe(9);
    });

    it('moving right through the hidden suffix leaves the link', () => {
        // 12 (after "desc") and 14 (after the link) draw at the same place
        expect(skip(12, 13)).toBe(15);
    });

    it('moving left into the hidden suffix passes the last visible character', () => {
        expect(skip(14, 13)).toBe(11);
    });

    it('moving left into the hidden prefix leaves the link', () => {
        expect(skip(8, 7)).toBe(2);
    });

    it('a click inside hidden text goes to the nearer edge', () => {
        expect(skip(undefined, 4)).toBe(3);
        expect(skip(undefined, 7)).toBe(8);
        expect(skip(undefined, 13)).toBe(12);
    });

    it('crosses adjacent links', () => {
        // "[[a][b]][[c][d]]": 0-5 hidden, b 5-6, 6-8 hidden, 8-13 hidden, d 13-14, 14-16 hidden
        const h = [{ start: 0, end: 5 }, { start: 6, end: 8 }, { start: 8, end: 13 }, { start: 14, end: 16 }];
        expect(skipHidden(h, 6, 7, 16)).toBe(14);
    });
});
