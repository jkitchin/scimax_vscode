/**
 * Tests for Diary Sexp evaluation
 */

import { describe, it, expect } from 'vitest';
import {
    parseDiarySexp,
    diaryAnniversary,
    diaryFloat,
    diaryCyclic,
    diaryBlock,
    diaryDate,
    orgClass,
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

describe('diaryCyclic', () => {
    it('matches on the start date', () => {
        const checkDate = new Date(2025, 0, 1);
        const result = diaryCyclic(7, 1, 1, 2025, checkDate);
        expect(result.matches).toBe(true);
        expect(result.description).toBe('Start date');
    });

    it('matches on subsequent occurrences', () => {
        const checkDate = new Date(2025, 0, 8); // 7 days later
        const result = diaryCyclic(7, 1, 1, 2025, checkDate);
        expect(result.matches).toBe(true);
    });

    it('does not match dates before start', () => {
        const checkDate = new Date(2024, 11, 31);
        const result = diaryCyclic(7, 1, 1, 2025, checkDate);
        expect(result.matches).toBe(false);
    });

    it('does not match non-cycle dates', () => {
        const checkDate = new Date(2025, 0, 5); // 4 days (not multiple of 7)
        const result = diaryCyclic(7, 1, 1, 2025, checkDate);
        expect(result.matches).toBe(false);
    });

    it('handles daily cycles', () => {
        const day1 = new Date(2025, 0, 1);
        const day2 = new Date(2025, 0, 2);
        const day3 = new Date(2025, 0, 3);
        expect(diaryCyclic(1, 1, 1, 2025, day1).matches).toBe(true);
        expect(diaryCyclic(1, 1, 1, 2025, day2).matches).toBe(true);
        expect(diaryCyclic(1, 1, 1, 2025, day3).matches).toBe(true);
    });
});

describe('diaryBlock', () => {
    it('matches dates within the block', () => {
        const result = diaryBlock(1, 10, 2025, 1, 20, 2025, new Date(2025, 0, 15));
        expect(result.matches).toBe(true);
    });

    it('matches the start date of the block', () => {
        const result = diaryBlock(1, 10, 2025, 1, 20, 2025, new Date(2025, 0, 10));
        expect(result.matches).toBe(true);
    });

    it('matches the end date of the block', () => {
        const result = diaryBlock(1, 10, 2025, 1, 20, 2025, new Date(2025, 0, 20));
        expect(result.matches).toBe(true);
    });

    it('does not match dates before the block', () => {
        const result = diaryBlock(1, 10, 2025, 1, 20, 2025, new Date(2025, 0, 9));
        expect(result.matches).toBe(false);
    });

    it('does not match dates after the block', () => {
        const result = diaryBlock(1, 10, 2025, 1, 20, 2025, new Date(2025, 0, 21));
        expect(result.matches).toBe(false);
    });

    it('handles multi-month blocks', () => {
        const result = diaryBlock(12, 15, 2024, 1, 15, 2025, new Date(2025, 0, 1));
        expect(result.matches).toBe(true);
    });
});

describe('diaryDate', () => {
    it('matches exact date', () => {
        const result = diaryDate(1, 15, 2025, new Date(2025, 0, 15));
        expect(result.matches).toBe(true);
    });

    it('does not match different date', () => {
        const result = diaryDate(1, 15, 2025, new Date(2025, 0, 16));
        expect(result.matches).toBe(false);
    });

    it('matches any month when month is null', () => {
        const jan = diaryDate(null, 15, 2025, new Date(2025, 0, 15));
        const feb = diaryDate(null, 15, 2025, new Date(2025, 1, 15));
        expect(jan.matches).toBe(true);
        expect(feb.matches).toBe(true);
    });

    it('matches any day when day is null', () => {
        const day1 = diaryDate(1, null, 2025, new Date(2025, 0, 1));
        const day31 = diaryDate(1, null, 2025, new Date(2025, 0, 31));
        expect(day1.matches).toBe(true);
        expect(day31.matches).toBe(true);
    });

    it('matches any year when year is null', () => {
        const y2024 = diaryDate(1, 15, null, new Date(2024, 0, 15));
        const y2025 = diaryDate(1, 15, null, new Date(2025, 0, 15));
        expect(y2024.matches).toBe(true);
        expect(y2025.matches).toBe(true);
    });

    it('matches any date when all are null', () => {
        const random = diaryDate(null, null, null, new Date(2030, 5, 23));
        expect(random.matches).toBe(true);
    });
});

describe('orgClass', () => {
    // Class: Mondays from Jan 15, 2026 to May 15, 2026
    const y1 = 2026, m1 = 1, d1 = 15;
    const y2 = 2026, m2 = 5, d2 = 15;
    const monday = 1;

    it('matches on the correct day of week within range', () => {
        // Jan 19, 2026 is a Monday
        const result = orgClass(y1, m1, d1, y2, m2, d2, monday, new Date(2026, 0, 19));
        expect(result.matches).toBe(true);
    });

    it('does not match on wrong day of week', () => {
        // Jan 20, 2026 is a Tuesday
        const result = orgClass(y1, m1, d1, y2, m2, d2, monday, new Date(2026, 0, 20));
        expect(result.matches).toBe(false);
    });

    it('does not match before start date', () => {
        // Jan 13, 2026 is a Monday but before start
        const result = orgClass(y1, m1, d1, y2, m2, d2, monday, new Date(2026, 0, 13));
        expect(result.matches).toBe(false);
    });

    it('does not match after end date', () => {
        // May 18, 2026 is a Monday but after end
        const result = orgClass(y1, m1, d1, y2, m2, d2, monday, new Date(2026, 4, 18));
        expect(result.matches).toBe(false);
    });

    it('matches on the start date if it is the right day', () => {
        // Start on a Wednesday (Jan 15, 2026 is Thursday, so use a Wed start)
        const result = orgClass(2026, 1, 14, 2026, 5, 15, 3, new Date(2026, 0, 14)); // Wed=3
        expect(result.matches).toBe(true);
    });

    it('matches on the end date if it is the right day', () => {
        // May 15, 2026 is a Friday
        const result = orgClass(y1, m1, d1, y2, m2, d2, 5, new Date(2026, 4, 15)); // Fri=5
        expect(result.matches).toBe(true);
    });

    it('skips specified weeks', () => {
        // First Monday after start is Jan 19, 2026 (week 1)
        // Second Monday is Jan 26, 2026 (week 2)
        const week1Monday = new Date(2026, 0, 19);
        const week2Monday = new Date(2026, 0, 26);

        // Skip week 2
        const result1 = orgClass(y1, m1, d1, y2, m2, d2, monday, week1Monday, [2]);
        const result2 = orgClass(y1, m1, d1, y2, m2, d2, monday, week2Monday, [2]);

        expect(result1.matches).toBe(true);
        expect(result2.matches).toBe(false);
    });

    it('handles multiple skip weeks', () => {
        const week1Monday = new Date(2026, 0, 19);
        const week2Monday = new Date(2026, 0, 26);
        const week3Monday = new Date(2026, 1, 2);

        // Skip weeks 1 and 3
        expect(orgClass(y1, m1, d1, y2, m2, d2, monday, week1Monday, [1, 3]).matches).toBe(false);
        expect(orgClass(y1, m1, d1, y2, m2, d2, monday, week2Monday, [1, 3]).matches).toBe(true);
        expect(orgClass(y1, m1, d1, y2, m2, d2, monday, week3Monday, [1, 3]).matches).toBe(false);
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
        const result = evaluateDiarySexp('diary-unknown 7', checkDate);
        expect(result.matches).toBe(false);
        expect(result.description).toContain('Unsupported');
    });

    it('evaluates diary-cyclic string', () => {
        // Every 7 days starting January 1, 2025
        const startDate = new Date(2025, 0, 1); // Start date
        const checkDate1 = new Date(2025, 0, 8); // 7 days later
        const checkDate2 = new Date(2025, 0, 15); // 14 days later
        const checkDate3 = new Date(2025, 0, 9); // 8 days later (shouldn't match)

        expect(evaluateDiarySexp('diary-cyclic 7 1 1 2025', startDate).matches).toBe(true);
        expect(evaluateDiarySexp('diary-cyclic 7 1 1 2025', checkDate1).matches).toBe(true);
        expect(evaluateDiarySexp('diary-cyclic 7 1 1 2025', checkDate2).matches).toBe(true);
        expect(evaluateDiarySexp('diary-cyclic 7 1 1 2025', checkDate3).matches).toBe(false);
    });

    it('evaluates diary-block string', () => {
        // Block from Jan 10 to Jan 20, 2025
        const inRange = new Date(2025, 0, 15);
        const beforeRange = new Date(2025, 0, 9);
        const afterRange = new Date(2025, 0, 21);

        expect(evaluateDiarySexp('diary-block 1 10 2025 1 20 2025', inRange).matches).toBe(true);
        expect(evaluateDiarySexp('diary-block 1 10 2025 1 20 2025', beforeRange).matches).toBe(false);
        expect(evaluateDiarySexp('diary-block 1 10 2025 1 20 2025', afterRange).matches).toBe(false);
    });

    it('evaluates diary-date string', () => {
        const checkDate = new Date(2025, 0, 15);

        // Exact date match
        expect(evaluateDiarySexp('diary-date 1 15 2025', checkDate).matches).toBe(true);
        expect(evaluateDiarySexp('diary-date 1 16 2025', checkDate).matches).toBe(false);

        // With wildcards (t)
        expect(evaluateDiarySexp('diary-date t 15 2025', checkDate).matches).toBe(true); // any month, day 15
        expect(evaluateDiarySexp('diary-date 1 t 2025', checkDate).matches).toBe(true); // any day in Jan
        expect(evaluateDiarySexp('diary-date t t 2025', checkDate).matches).toBe(true); // any date in 2025
    });

    it('evaluates org-class string', () => {
        // Class on Mondays from Jan 15, 2026 to May 15, 2026
        // Jan 19, 2026 is a Monday
        const monday = new Date(2026, 0, 19);
        const tuesday = new Date(2026, 0, 20);
        const beforeStart = new Date(2026, 0, 12); // Monday before start

        expect(evaluateDiarySexp('org-class 2026 1 15 2026 5 15 1', monday).matches).toBe(true);
        expect(evaluateDiarySexp('org-class 2026 1 15 2026 5 15 1', tuesday).matches).toBe(false);
        expect(evaluateDiarySexp('org-class 2026 1 15 2026 5 15 1', beforeStart).matches).toBe(false);
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

// Tests for agenda integration
import { generateAgendaView, DiarySexpEntry } from '../orgAgenda';

describe('agenda integration with diary sexps', () => {
    it('includes diary sexp items in agenda view', () => {
        const diarySexps: DiarySexpEntry[] = [
            {
                sexp: 'diary-anniversary 1 15 1990',
                title: "John's Birthday",
                file: 'test.org',
                line: 10,
                category: 'Birthdays',
            },
            {
                sexp: 'diary-float 11 4 4',
                title: 'Thanksgiving',
                file: 'test.org',
                line: 20,
                category: 'Holidays',
            },
        ];

        // Check for birthday in January 2024
        const view = generateAgendaView(
            [], // no headlines
            new Map(),
            {
                startDate: new Date(2024, 0, 14), // Jan 14
                days: 3, // Jan 14-16
            },
            diarySexps
        );

        expect(view.totalItems).toBe(1);
        expect(view.groups.some(g => g.items.some(i => i.title === "John's Birthday"))).toBe(true);
    });

    it('shows years for anniversary entries', () => {
        const diarySexps: DiarySexpEntry[] = [
            {
                sexp: 'diary-anniversary 1 15 1990',
                title: "30th Birthday",
                file: 'test.org',
                line: 10,
            },
        ];

        const view = generateAgendaView(
            [],
            new Map(),
            {
                startDate: new Date(2024, 0, 14),
                days: 3,
            },
            diarySexps
        );

        const birthdayItem = view.groups
            .flatMap(g => g.items)
            .find(i => i.title === '30th Birthday');

        expect(birthdayItem).toBeDefined();
        expect(birthdayItem?.agendaType).toBe('diary');
        expect(birthdayItem?.daysUntil).toBe(34); // 2024 - 1990
    });

    it('finds floating holidays', () => {
        const diarySexps: DiarySexpEntry[] = [
            {
                sexp: 'diary-float 11 4 4', // 4th Thursday of November
                title: 'Thanksgiving',
                file: 'test.org',
                line: 20,
            },
        ];

        // November 2025 - Thanksgiving is Nov 27
        const view = generateAgendaView(
            [],
            new Map(),
            {
                startDate: new Date(2025, 10, 1), // Nov 1
                days: 30, // Full November
            },
            diarySexps
        );

        const thanksgiving = view.groups
            .flatMap(g => g.items)
            .find(i => i.title === 'Thanksgiving');

        expect(thanksgiving).toBeDefined();
        expect(thanksgiving?.timestamp?.getDate()).toBe(27);
    });

    it('handles first Monday of every month', () => {
        const diarySexps: DiarySexpEntry[] = [
            {
                sexp: 'diary-float t 1 1', // First Monday of every month
                title: 'Monthly Meeting',
                file: 'test.org',
                line: 30,
            },
        ];

        // Check first half of 2025
        const view = generateAgendaView(
            [],
            new Map(),
            {
                startDate: new Date(2025, 0, 1),
                days: 180,
            },
            diarySexps
        );

        // Should have 6 monthly meetings
        const meetings = view.groups
            .flatMap(g => g.items)
            .filter(i => i.title === 'Monthly Meeting');

        expect(meetings.length).toBe(6);
    });
});
