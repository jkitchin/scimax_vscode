/**
 * Tests for Diary Sexp evaluation
 */

import { describe, it, expect } from 'vitest';
import {
    parseDiarySexp,
    diaryAnniversary,
    diaryFloat,
    evaluateDiarySexp,
    getDiarySexpDates
} from '../orgDiarySexp';

describe('parseDiarySexp', () => {
    it('parses diary-anniversary', () => {
        const result = parseDiarySexp('diary-anniversary 1 15 1990');
        expect(result).toEqual({
            fn: 'diary-anniversary',
            args: [1, 15, 1990]
        });
    });

    it('parses with parentheses', () => {
        const result = parseDiarySexp('(diary-anniversary 1 15 1990)');
        expect(result).toEqual({
            fn: 'diary-anniversary',
            args: [1, 15, 1990]
        });
    });

    it('parses diary-float', () => {
        const result = parseDiarySexp('diary-float 11 4 4');
        expect(result).toEqual({
            fn: 'diary-float',
            args: [11, 4, 4]
        });
    });

    it('parses diary-float with t for every month', () => {
        const result = parseDiarySexp('diary-float t 1 1');
        expect(result).toEqual({
            fn: 'diary-float',
            args: [null, 1, 1]
        });
    });

    it('parses negative numbers', () => {
        const result = parseDiarySexp('diary-float 5 1 -1');
        expect(result).toEqual({
            fn: 'diary-float',
            args: [5, 1, -1]
        });
    });
});

describe('diaryAnniversary', () => {
    it('matches on the anniversary date', () => {
        const checkDate = new Date(2024, 0, 15); // January 15, 2024
        const result = diaryAnniversary(1, 15, 1990, checkDate);
        expect(result.matches).toBe(true);
        expect(result.years).toBe(34);
    });

    it('does not match on different day', () => {
        const checkDate = new Date(2024, 0, 16); // January 16, 2024
        const result = diaryAnniversary(1, 15, 1990, checkDate);
        expect(result.matches).toBe(false);
    });

    it('does not match on different month', () => {
        const checkDate = new Date(2024, 1, 15); // February 15, 2024
        const result = diaryAnniversary(1, 15, 1990, checkDate);
        expect(result.matches).toBe(false);
    });

    it('calculates years correctly for same year', () => {
        const checkDate = new Date(1990, 0, 15); // January 15, 1990
        const result = diaryAnniversary(1, 15, 1990, checkDate);
        expect(result.matches).toBe(true);
        expect(result.years).toBe(0);
        expect(result.description).toBe('Today');
    });

    it('handles birthday example', () => {
        // Someone born March 20, 1985
        const checkDate = new Date(2025, 2, 20); // March 20, 2025
        const result = diaryAnniversary(3, 20, 1985, checkDate);
        expect(result.matches).toBe(true);
        expect(result.years).toBe(40);
        expect(result.description).toBe('40 years ago');
    });
});

describe('diaryFloat', () => {
    describe('positive n (count from beginning)', () => {
        it('matches first Monday of January', () => {
            // January 6, 2025 is the first Monday of January 2025
            const checkDate = new Date(2025, 0, 6);
            const result = diaryFloat(1, 1, 1, checkDate); // month=1, dayname=1 (Monday), n=1
            expect(result.matches).toBe(true);
            expect(result.description).toBe('first Monday of January');
        });

        it('matches third Thursday of November (US Thanksgiving)', () => {
            // November 27, 2025 is the 4th Thursday of November 2025
            const checkDate = new Date(2025, 10, 27);
            const result = diaryFloat(11, 4, 4, checkDate); // month=11, dayname=4 (Thursday), n=4
            expect(result.matches).toBe(true);
            expect(result.description).toBe('fourth Thursday of November');
        });

        it('does not match wrong occurrence', () => {
            // January 13, 2025 is the second Monday, not first
            const checkDate = new Date(2025, 0, 13);
            const result = diaryFloat(1, 1, 1, checkDate); // first Monday
            expect(result.matches).toBe(false);
        });

        it('does not match wrong day of week', () => {
            // January 7, 2025 is Tuesday, not Monday
            const checkDate = new Date(2025, 0, 7);
            const result = diaryFloat(1, 1, 1, checkDate);
            expect(result.matches).toBe(false);
        });

        it('does not match wrong month', () => {
            // February 3, 2025 is first Monday of February, not January
            const checkDate = new Date(2025, 1, 3);
            const result = diaryFloat(1, 1, 1, checkDate); // first Monday of January
            expect(result.matches).toBe(false);
        });
    });

    describe('negative n (count from end)', () => {
        it('matches last Friday of month', () => {
            // January 31, 2025 is the last Friday of January 2025
            const checkDate = new Date(2025, 0, 31);
            const result = diaryFloat(1, 5, -1, checkDate); // month=1, dayname=5 (Friday), n=-1
            expect(result.matches).toBe(true);
            expect(result.description).toBe('last Friday of January');
        });

        it('matches last Monday of May (Memorial Day)', () => {
            // May 26, 2025 is the last Monday of May 2025
            const checkDate = new Date(2025, 4, 26);
            const result = diaryFloat(5, 1, -1, checkDate); // month=5, dayname=1 (Monday), n=-1
            expect(result.matches).toBe(true);
            expect(result.description).toBe('last Monday of May');
        });

        it('does not match second-to-last when its last', () => {
            // January 31, 2025 is the last Friday, not second-to-last
            const checkDate = new Date(2025, 0, 31);
            const result = diaryFloat(1, 5, -2, checkDate); // second-to-last Friday
            expect(result.matches).toBe(false);
        });
    });

    describe('every month (null month)', () => {
        it('matches first Monday of any month', () => {
            // January 6, 2025 is first Monday
            const jan = new Date(2025, 0, 6);
            const resultJan = diaryFloat(null, 1, 1, jan);
            expect(resultJan.matches).toBe(true);

            // February 3, 2025 is first Monday
            const feb = new Date(2025, 1, 3);
            const resultFeb = diaryFloat(null, 1, 1, feb);
            expect(resultFeb.matches).toBe(true);
        });
    });
});

describe('evaluateDiarySexp', () => {
    it('evaluates diary-anniversary string', () => {
        const checkDate = new Date(2024, 0, 15);
        const result = evaluateDiarySexp('diary-anniversary 1 15 1990', checkDate);
        expect(result.matches).toBe(true);
        expect(result.years).toBe(34);
    });

    it('evaluates diary-float string', () => {
        const checkDate = new Date(2025, 10, 27); // 4th Thursday of November
        const result = evaluateDiarySexp('diary-float 11 4 4', checkDate);
        expect(result.matches).toBe(true);
    });

    it('evaluates with parentheses', () => {
        const checkDate = new Date(2024, 0, 15);
        const result = evaluateDiarySexp('(diary-anniversary 1 15 1990)', checkDate);
        expect(result.matches).toBe(true);
    });

    it('returns not matching for unsupported function', () => {
        const checkDate = new Date(2024, 0, 15);
        const result = evaluateDiarySexp('diary-cyclic 7', checkDate);
        expect(result.matches).toBe(false);
        expect(result.description).toContain('Unsupported');
    });
});

describe('getDiarySexpDates', () => {
    it('finds all anniversaries in a range', () => {
        // Find January 15 in 2024 and 2025
        const startDate = new Date(2024, 0, 1);
        const endDate = new Date(2025, 1, 28);

        const matches = getDiarySexpDates('diary-anniversary 1 15 1990', startDate, endDate);

        expect(matches.length).toBe(2);
        expect(matches[0].date.getFullYear()).toBe(2024);
        expect(matches[0].date.getMonth()).toBe(0);
        expect(matches[0].date.getDate()).toBe(15);
        expect(matches[1].date.getFullYear()).toBe(2025);
    });

    it('finds all Thanksgivings in a range', () => {
        // Find 4th Thursday of November in 2024 and 2025
        const startDate = new Date(2024, 0, 1);
        const endDate = new Date(2025, 11, 31);

        const matches = getDiarySexpDates('diary-float 11 4 4', startDate, endDate);

        expect(matches.length).toBe(2);
        // 2024 Thanksgiving is November 28
        expect(matches[0].date.getMonth()).toBe(10);
        expect(matches[0].date.getDate()).toBe(28);
        // 2025 Thanksgiving is November 27
        expect(matches[1].date.getMonth()).toBe(10);
        expect(matches[1].date.getDate()).toBe(27);
    });

    it('finds first Monday of every month', () => {
        // Find first Monday of each month in first half of 2025
        const startDate = new Date(2025, 0, 1);
        const endDate = new Date(2025, 5, 30);

        const matches = getDiarySexpDates('diary-float t 1 1', startDate, endDate);

        expect(matches.length).toBe(6); // One per month
    });
});

describe('real-world examples', () => {
    it('US holidays with diary-float', () => {
        const year = 2025;

        // Martin Luther King Jr. Day - 3rd Monday of January
        const mlk = new Date(year, 0, 20); // January 20, 2025
        expect(evaluateDiarySexp('diary-float 1 1 3', mlk).matches).toBe(true);

        // Presidents Day - 3rd Monday of February
        const presidents = new Date(year, 1, 17); // February 17, 2025
        expect(evaluateDiarySexp('diary-float 2 1 3', presidents).matches).toBe(true);

        // Memorial Day - Last Monday of May
        const memorial = new Date(year, 4, 26); // May 26, 2025
        expect(evaluateDiarySexp('diary-float 5 1 -1', memorial).matches).toBe(true);

        // Labor Day - 1st Monday of September
        const labor = new Date(year, 8, 1); // September 1, 2025
        expect(evaluateDiarySexp('diary-float 9 1 1', labor).matches).toBe(true);

        // Columbus Day - 2nd Monday of October
        const columbus = new Date(year, 9, 13); // October 13, 2025
        expect(evaluateDiarySexp('diary-float 10 1 2', columbus).matches).toBe(true);

        // Thanksgiving - 4th Thursday of November
        const thanksgiving = new Date(year, 10, 27); // November 27, 2025
        expect(evaluateDiarySexp('diary-float 11 4 4', thanksgiving).matches).toBe(true);
    });

    it('birthday tracking with diary-anniversary', () => {
        const today = new Date(2025, 2, 15); // March 15, 2025

        // Check various birthdays
        const march15Birthday = evaluateDiarySexp('diary-anniversary 3 15 1990', today);
        expect(march15Birthday.matches).toBe(true);
        expect(march15Birthday.years).toBe(35);

        // Different date should not match
        const march16Birthday = evaluateDiarySexp('diary-anniversary 3 16 1990', today);
        expect(march16Birthday.matches).toBe(false);
    });
});
