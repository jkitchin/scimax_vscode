/**
 * Tests for generateDatetreePath (issue #47 audit, item D4).
 *
 * scimax.capture.datetreeFormat was registered but ignored — datetrees were
 * always year/month/day. The setting is now honored; this pins the heading
 * path produced for each granularity, including the ISO-week year boundary.
 */

import { describe, it, expect } from 'vitest';
import { generateDatetreePath } from '../orgCapture';

describe('generateDatetreePath', () => {
    // 2024-04-15 is a Monday in ISO week 16.
    const d = new Date(2024, 3, 15);

    it('day (default) -> year / year-month monthname / year-month-day dayname', () => {
        expect(generateDatetreePath(d)).toEqual(['2024', '2024-04 April', '2024-04-15 Monday']);
        expect(generateDatetreePath(d, 'day')).toEqual(['2024', '2024-04 April', '2024-04-15 Monday']);
    });

    it('month -> year / year-month monthname (2 levels)', () => {
        expect(generateDatetreePath(d, 'month')).toEqual(['2024', '2024-04 April']);
    });

    it('week -> ISO year / ISO year-week (2 levels)', () => {
        expect(generateDatetreePath(d, 'week')).toEqual(['2024', '2024-W16']);
    });

    it('week uses the ISO week-numbering year at a year boundary', () => {
        // 2023-01-01 is a Sunday, which belongs to ISO week 52 of 2022.
        const boundary = new Date(2023, 0, 1);
        expect(generateDatetreePath(boundary, 'week')).toEqual(['2022', '2022-W52']);
    });

    it('day mode at the same boundary still uses the calendar year', () => {
        const boundary = new Date(2023, 0, 1);
        expect(generateDatetreePath(boundary, 'day')).toEqual([
            '2023',
            '2023-01 January',
            '2023-01-01 Sunday',
        ]);
    });
});
