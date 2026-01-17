/**
 * Tests for recurring/repeating task functionality
 * Tests the repeater handling when TODO state transitions to DONE
 */

import { describe, it, expect } from 'vitest';
import {
    REPEATER_TIMESTAMP_PATTERN,
    advanceDateByRepeater,
    getDayOfWeek,
    parseRepeaterString,
    findRepeaterInLines,
} from '../../parser/orgRepeater';

describe('Repeating Tasks', () => {
    describe('REPEATER_TIMESTAMP_PATTERN', () => {
        it('matches DEADLINE with weekly repeater', () => {
            const line = 'DEADLINE: <2026-01-19 Mon +1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![2]).toBe('DEADLINE');
            expect(match![3]).toBe('2026');
            expect(match![4]).toBe('01');
            expect(match![5]).toBe('19');
            expect(match![8]).toBe('+1w');
        });

        it('matches SCHEDULED with daily repeater', () => {
            const line = 'SCHEDULED: <2026-01-15 Wed +1d>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![2]).toBe('SCHEDULED');
            expect(match![8]).toBe('+1d');
        });

        it('matches repeater with time component', () => {
            const line = 'DEADLINE: <2026-01-19 Mon 14:30 +1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![6]).toBe('14');
            expect(match![7]).toBe('30');
            expect(match![8]).toBe('+1w');
        });

        it('matches .+ repeater (shift from today)', () => {
            const line = 'DEADLINE: <2026-01-19 Mon .+1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![8]).toBe('.+1w');
        });

        it('matches ++ repeater (next future occurrence)', () => {
            const line = 'DEADLINE: <2026-01-19 Mon ++1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![8]).toBe('++1w');
        });

        it('matches monthly repeater', () => {
            const line = 'DEADLINE: <2026-01-19 Mon +1m>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![8]).toBe('+1m');
        });

        it('matches yearly repeater', () => {
            const line = 'DEADLINE: <2026-01-19 Mon +1y>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![8]).toBe('+1y');
        });

        it('matches with indentation', () => {
            const line = '   DEADLINE: <2026-01-19 Mon +1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('   ');
            expect(match![2]).toBe('DEADLINE');
        });

        it('does NOT match timestamp without repeater', () => {
            const line = 'DEADLINE: <2026-01-19 Mon>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).toBeNull();
        });

        it('does NOT match plain text', () => {
            const line = 'This is just some text';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);

            expect(match).toBeNull();
        });
    });

    describe('parseRepeaterString', () => {
        it('parses +1w correctly', () => {
            const result = parseRepeaterString('+1w');
            expect(result).toEqual({ type: '+', value: 1, unit: 'w' });
        });

        it('parses +2d correctly', () => {
            const result = parseRepeaterString('+2d');
            expect(result).toEqual({ type: '+', value: 2, unit: 'd' });
        });

        it('parses .+1w correctly', () => {
            const result = parseRepeaterString('.+1w');
            expect(result).toEqual({ type: '.+', value: 1, unit: 'w' });
        });

        it('parses ++1m correctly', () => {
            const result = parseRepeaterString('++1m');
            expect(result).toEqual({ type: '++', value: 1, unit: 'm' });
        });

        it('parses +1y correctly', () => {
            const result = parseRepeaterString('+1y');
            expect(result).toEqual({ type: '+', value: 1, unit: 'y' });
        });

        it('parses +1h correctly', () => {
            const result = parseRepeaterString('+1h');
            expect(result).toEqual({ type: '+', value: 1, unit: 'h' });
        });

        it('returns null for invalid repeater', () => {
            expect(parseRepeaterString('invalid')).toBeNull();
            expect(parseRepeaterString('')).toBeNull();
            expect(parseRepeaterString('+x')).toBeNull();
        });
    });

    describe('getDayOfWeek', () => {
        it('returns correct day abbreviation', () => {
            // Monday Jan 19, 2026
            const monday = new Date(2026, 0, 19);
            expect(getDayOfWeek(monday)).toBe('Mon');

            // Sunday Jan 18, 2026
            const sunday = new Date(2026, 0, 18);
            expect(getDayOfWeek(sunday)).toBe('Sun');

            // Saturday Jan 17, 2026
            const saturday = new Date(2026, 0, 17);
            expect(getDayOfWeek(saturday)).toBe('Sat');
        });
    });

    describe('advanceDateByRepeater', () => {
        describe('+ repeater (shift from original date)', () => {
            it('advances by 1 week', () => {
                // Start: Jan 19, 2026
                const result = advanceDateByRepeater(2026, 1, 19, '+1w');

                expect(result.getFullYear()).toBe(2026);
                expect(result.getMonth()).toBe(0); // January (0-indexed)
                expect(result.getDate()).toBe(26); // 19 + 7 = 26
            });

            it('advances by 2 weeks', () => {
                const result = advanceDateByRepeater(2026, 1, 19, '+2w');

                expect(result.getFullYear()).toBe(2026);
                expect(result.getMonth()).toBe(1); // February
                expect(result.getDate()).toBe(2); // 19 + 14 = 33, wraps to Feb 2
            });

            it('advances by 1 day', () => {
                const result = advanceDateByRepeater(2026, 1, 19, '+1d');

                expect(result.getDate()).toBe(20);
            });

            it('advances by 1 month', () => {
                const result = advanceDateByRepeater(2026, 1, 19, '+1m');

                expect(result.getFullYear()).toBe(2026);
                expect(result.getMonth()).toBe(1); // February
                expect(result.getDate()).toBe(19);
            });

            it('advances by 1 year', () => {
                const result = advanceDateByRepeater(2026, 1, 19, '+1y');

                expect(result.getFullYear()).toBe(2027);
                expect(result.getMonth()).toBe(0);
                expect(result.getDate()).toBe(19);
            });

            it('handles month wraparound correctly', () => {
                // Dec 15 + 1 month = Jan 15
                const result = advanceDateByRepeater(2026, 12, 15, '+1m');

                expect(result.getFullYear()).toBe(2027);
                expect(result.getMonth()).toBe(0); // January
                expect(result.getDate()).toBe(15);
            });
        });

        describe('.+ repeater (shift from today)', () => {
            it('shifts from today, not from original date', () => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                // Use a past date as the original
                const result = advanceDateByRepeater(2020, 1, 1, '.+1w');

                // Result should be today + 1 week, not 2020-01-08
                const expectedDate = new Date(today);
                expectedDate.setDate(expectedDate.getDate() + 7);

                expect(result.getFullYear()).toBe(expectedDate.getFullYear());
                expect(result.getMonth()).toBe(expectedDate.getMonth());
                expect(result.getDate()).toBe(expectedDate.getDate());
            });

            it('shifts by 1 day from today', () => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const result = advanceDateByRepeater(2020, 1, 1, '.+1d');

                const expectedDate = new Date(today);
                expectedDate.setDate(expectedDate.getDate() + 1);

                expect(result.getDate()).toBe(expectedDate.getDate());
            });
        });

        describe('++ repeater (next future occurrence)', () => {
            it('shifts past date to future', () => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                // Use a date far in the past
                const result = advanceDateByRepeater(2020, 1, 1, '++1w');

                // Result should be in the future
                expect(result.getTime()).toBeGreaterThan(today.getTime());
            });

            it('keeps shifting until future', () => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                // Use yesterday's date
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);

                const result = advanceDateByRepeater(
                    yesterday.getFullYear(),
                    yesterday.getMonth() + 1,
                    yesterday.getDate(),
                    '++1d'
                );

                // Should be tomorrow (yesterday + 2 days to get past today)
                expect(result.getTime()).toBeGreaterThan(today.getTime());
            });
        });

        it('returns original date for invalid repeater', () => {
            const result = advanceDateByRepeater(2026, 1, 19, 'invalid');

            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(0);
            expect(result.getDate()).toBe(19);
        });
    });

    describe('findRepeaterInLines', () => {
        it('finds DEADLINE with repeater on line after heading', () => {
            const lines = [
                '* TODO Recurring task test',
                'DEADLINE: <2026-01-19 Mon +1w>',
                'Some body text'
            ];

            const result = findRepeaterInLines(lines, 0);

            expect(result).not.toBeNull();
            expect(result!.lineIndex).toBe(1);
            expect(result!.type).toBe('DEADLINE');
            expect(result!.match[8]).toBe('+1w');
        });

        it('finds SCHEDULED with repeater', () => {
            const lines = [
                '* TODO Weekly meeting',
                'SCHEDULED: <2026-01-20 Tue +1w>',
            ];

            const result = findRepeaterInLines(lines, 0);

            expect(result).not.toBeNull();
            expect(result!.type).toBe('SCHEDULED');
        });

        it('finds repeater with indentation', () => {
            const lines = [
                '** TODO Subtask',
                '   DEADLINE: <2026-01-19 Mon +1w>',
            ];

            const result = findRepeaterInLines(lines, 0);

            expect(result).not.toBeNull();
            expect(result!.match[1]).toBe('   '); // indentation preserved
        });

        it('returns null when no repeater present', () => {
            const lines = [
                '* TODO Regular task',
                'DEADLINE: <2026-01-19 Mon>',
            ];

            const result = findRepeaterInLines(lines, 0);

            expect(result).toBeNull();
        });

        it('returns null when no DEADLINE/SCHEDULED present', () => {
            const lines = [
                '* TODO Task without deadline',
                'Some body text',
            ];

            const result = findRepeaterInLines(lines, 0);

            expect(result).toBeNull();
        });

        it('stops at next heading', () => {
            const lines = [
                '* TODO First task',
                'Some text',
                '* TODO Second task',
                'DEADLINE: <2026-01-19 Mon +1w>',
            ];

            // Looking from heading at index 0, should NOT find the deadline at index 3
            const result = findRepeaterInLines(lines, 0);

            expect(result).toBeNull();
        });

        it('only finds repeater on immediate next line after heading', () => {
            // Implementation only checks the line immediately after the heading
            const lines = [
                '* TODO Task with properties',
                ':PROPERTIES:',  // Line 1 - not a DEADLINE/SCHEDULED
                ':ID: abc123',
                ':END:',
            ];

            const result = findRepeaterInLines(lines, 0);

            // Should be null because DEADLINE is not on line 1
            expect(result).toBeNull();
        });

        it('does not search beyond immediate next line', () => {
            const lines = [
                '* TODO Task with lots of content',
                'Some description',  // Line 1 - not a DEADLINE/SCHEDULED
                'DEADLINE: <2026-01-19 Mon +1w>', // Line 2 - too far
            ];

            const result = findRepeaterInLines(lines, 0);

            // Only checks line 1, so DEADLINE on line 2 is not found
            expect(result).toBeNull();
        });
    });

    describe('End-to-end repeating task behavior', () => {
        it('demonstrates complete workflow: find repeater and advance date', () => {
            // Simulate the org document
            const lines = [
                '* TODO Recurring task test',
                'DEADLINE: <2026-01-19 Mon +1w>',
            ];

            // Step 1: Find the repeater
            const repeaterInfo = findRepeaterInLines(lines, 0);
            expect(repeaterInfo).not.toBeNull();

            // Step 2: Extract date components from match
            const match = repeaterInfo!.match;
            const year = parseInt(match[3]);
            const month = parseInt(match[4]);
            const day = parseInt(match[5]);
            const repeater = match[8];

            expect(year).toBe(2026);
            expect(month).toBe(1);
            expect(day).toBe(19);
            expect(repeater).toBe('+1w');

            // Step 3: Advance the date
            const newDate = advanceDateByRepeater(year, month, day, repeater);

            // Step 4: Verify the new date is one week later
            expect(newDate.getFullYear()).toBe(2026);
            expect(newDate.getMonth()).toBe(0); // January (0-indexed)
            expect(newDate.getDate()).toBe(26); // 19 + 7 = 26
            expect(getDayOfWeek(newDate)).toBe('Mon'); // Still Monday
        });

        it('handles bi-weekly repeater', () => {
            const lines = [
                '* TODO Bi-weekly review',
                'DEADLINE: <2026-01-19 Mon +2w>',
            ];

            const repeaterInfo = findRepeaterInLines(lines, 0);
            const match = repeaterInfo!.match;
            const newDate = advanceDateByRepeater(
                parseInt(match[3]),
                parseInt(match[4]),
                parseInt(match[5]),
                match[8]
            );

            // 19 + 14 = 33, wraps to Feb 2
            expect(newDate.getMonth()).toBe(1); // February
            expect(newDate.getDate()).toBe(2);
        });

        it('handles monthly bill payment scenario', () => {
            const lines = [
                '* TODO Pay rent',
                'DEADLINE: <2026-01-01 Wed +1m>',
            ];

            const repeaterInfo = findRepeaterInLines(lines, 0);
            const match = repeaterInfo!.match;
            const newDate = advanceDateByRepeater(
                parseInt(match[3]),
                parseInt(match[4]),
                parseInt(match[5]),
                match[8]
            );

            expect(newDate.getFullYear()).toBe(2026);
            expect(newDate.getMonth()).toBe(1); // February
            expect(newDate.getDate()).toBe(1);
        });

        it('handles yearly birthday reminder scenario', () => {
            const lines = [
                "* TODO Mom's birthday",
                'DEADLINE: <2026-03-15 Sun +1y>',
            ];

            const repeaterInfo = findRepeaterInLines(lines, 0);
            const match = repeaterInfo!.match;
            const newDate = advanceDateByRepeater(
                parseInt(match[3]),
                parseInt(match[4]),
                parseInt(match[5]),
                match[8]
            );

            expect(newDate.getFullYear()).toBe(2027);
            expect(newDate.getMonth()).toBe(2); // March
            expect(newDate.getDate()).toBe(15);
        });
    });
});
