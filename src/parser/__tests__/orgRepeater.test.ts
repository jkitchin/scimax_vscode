/**
 * Tests for org-mode repeating task handling
 * Tests pure date calculation functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getDayOfWeek,
    parseRepeaterString,
    advanceDateByRepeater,
    findRepeaterInLines,
    formatOrgTimestamp,
    extractDateFromMatch,
    REPEATER_TIMESTAMP_PATTERN
} from '../orgRepeater';

describe('Org Repeater', () => {
    // =============================================================================
    // getDayOfWeek Tests
    // =============================================================================

    describe('getDayOfWeek', () => {
        it('should return correct day for Sunday', () => {
            const sunday = new Date(2024, 0, 7); // Jan 7, 2024 is Sunday
            expect(getDayOfWeek(sunday)).toBe('Sun');
        });

        it('should return correct day for Monday', () => {
            const monday = new Date(2024, 0, 8); // Jan 8, 2024 is Monday
            expect(getDayOfWeek(monday)).toBe('Mon');
        });

        it('should return correct day for Tuesday', () => {
            const tuesday = new Date(2024, 0, 9);
            expect(getDayOfWeek(tuesday)).toBe('Tue');
        });

        it('should return correct day for Wednesday', () => {
            const wednesday = new Date(2024, 0, 10);
            expect(getDayOfWeek(wednesday)).toBe('Wed');
        });

        it('should return correct day for Thursday', () => {
            const thursday = new Date(2024, 0, 11);
            expect(getDayOfWeek(thursday)).toBe('Thu');
        });

        it('should return correct day for Friday', () => {
            const friday = new Date(2024, 0, 12);
            expect(getDayOfWeek(friday)).toBe('Fri');
        });

        it('should return correct day for Saturday', () => {
            const saturday = new Date(2024, 0, 13);
            expect(getDayOfWeek(saturday)).toBe('Sat');
        });
    });

    // =============================================================================
    // parseRepeaterString Tests
    // =============================================================================

    describe('parseRepeaterString', () => {
        it('should parse +1d (daily)', () => {
            const result = parseRepeaterString('+1d');
            expect(result).toEqual({ type: '+', value: 1, unit: 'd' });
        });

        it('should parse +2w (every 2 weeks)', () => {
            const result = parseRepeaterString('+2w');
            expect(result).toEqual({ type: '+', value: 2, unit: 'w' });
        });

        it('should parse +1m (monthly)', () => {
            const result = parseRepeaterString('+1m');
            expect(result).toEqual({ type: '+', value: 1, unit: 'm' });
        });

        it('should parse +1y (yearly)', () => {
            const result = parseRepeaterString('+1y');
            expect(result).toEqual({ type: '+', value: 1, unit: 'y' });
        });

        it('should parse +6h (every 6 hours)', () => {
            const result = parseRepeaterString('+6h');
            expect(result).toEqual({ type: '+', value: 6, unit: 'h' });
        });

        it('should parse .+1d (from today)', () => {
            const result = parseRepeaterString('.+1d');
            expect(result).toEqual({ type: '.+', value: 1, unit: 'd' });
        });

        it('should parse ++1w (next future occurrence)', () => {
            const result = parseRepeaterString('++1w');
            expect(result).toEqual({ type: '++', value: 1, unit: 'w' });
        });

        it('should parse large values', () => {
            const result = parseRepeaterString('+30d');
            expect(result).toEqual({ type: '+', value: 30, unit: 'd' });
        });

        it('should return null for invalid format', () => {
            expect(parseRepeaterString('invalid')).toBeNull();
            expect(parseRepeaterString('1d')).toBeNull(); // missing +
            expect(parseRepeaterString('+d')).toBeNull(); // missing number
            expect(parseRepeaterString('+1x')).toBeNull(); // invalid unit
        });
    });

    // =============================================================================
    // advanceDateByRepeater Tests
    // =============================================================================

    describe('advanceDateByRepeater', () => {
        it('should advance by 1 day with +1d', () => {
            const result = advanceDateByRepeater(2024, 1, 15, '+1d');
            expect(result.getFullYear()).toBe(2024);
            expect(result.getMonth()).toBe(0); // January
            expect(result.getDate()).toBe(16);
        });

        it('should advance by 7 days with +1w', () => {
            const result = advanceDateByRepeater(2024, 1, 15, '+1w');
            expect(result.getFullYear()).toBe(2024);
            expect(result.getMonth()).toBe(0);
            expect(result.getDate()).toBe(22);
        });

        it('should advance by 2 weeks with +2w', () => {
            const result = advanceDateByRepeater(2024, 1, 15, '+2w');
            expect(result.getFullYear()).toBe(2024);
            expect(result.getMonth()).toBe(0);
            expect(result.getDate()).toBe(29);
        });

        it('should advance by 1 month with +1m', () => {
            const result = advanceDateByRepeater(2024, 1, 15, '+1m');
            expect(result.getFullYear()).toBe(2024);
            expect(result.getMonth()).toBe(1); // February
            expect(result.getDate()).toBe(15);
        });

        it('should advance by 1 year with +1y', () => {
            const result = advanceDateByRepeater(2024, 1, 15, '+1y');
            expect(result.getFullYear()).toBe(2025);
            expect(result.getMonth()).toBe(0);
            expect(result.getDate()).toBe(15);
        });

        it('should handle month boundary (January to February)', () => {
            const result = advanceDateByRepeater(2024, 1, 31, '+1m');
            // January 31 + 1 month = March 2 (February doesn't have 31 days)
            expect(result.getMonth()).toBe(2); // March
        });

        it('should handle year boundary (December to January)', () => {
            const result = advanceDateByRepeater(2024, 12, 31, '+1d');
            expect(result.getFullYear()).toBe(2025);
            expect(result.getMonth()).toBe(0); // January
            expect(result.getDate()).toBe(1);
        });

        it('should return original date for invalid repeater', () => {
            const result = advanceDateByRepeater(2024, 1, 15, 'invalid');
            expect(result.getFullYear()).toBe(2024);
            expect(result.getMonth()).toBe(0);
            expect(result.getDate()).toBe(15);
        });
    });

    // =============================================================================
    // REPEATER_TIMESTAMP_PATTERN Tests
    // =============================================================================

    describe('REPEATER_TIMESTAMP_PATTERN', () => {
        it('should match SCHEDULED with repeater', () => {
            const line = 'SCHEDULED: <2024-01-15 Mon +1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).not.toBeNull();
            expect(match![2]).toBe('SCHEDULED');
            expect(match![8]).toBe('+1w');
        });

        it('should match DEADLINE with repeater', () => {
            const line = 'DEADLINE: <2024-01-15 Mon +1d>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).not.toBeNull();
            expect(match![2]).toBe('DEADLINE');
            expect(match![8]).toBe('+1d');
        });

        it('should match with time component', () => {
            const line = 'SCHEDULED: <2024-01-15 Mon 10:00 +1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).not.toBeNull();
            expect(match![6]).toBe('10');
            expect(match![7]).toBe('00');
        });

        it('should match with indentation', () => {
            const line = '   SCHEDULED: <2024-01-15 Mon +1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).not.toBeNull();
            expect(match![1]).toBe('   ');
        });

        it('should match .+ repeater type', () => {
            const line = 'SCHEDULED: <2024-01-15 Mon .+1d>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).not.toBeNull();
            expect(match![8]).toBe('.+1d');
        });

        it('should match ++ repeater type', () => {
            const line = 'DEADLINE: <2024-01-15 Mon ++2w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).not.toBeNull();
            expect(match![8]).toBe('++2w');
        });

        it('should not match without repeater', () => {
            const line = 'SCHEDULED: <2024-01-15 Mon>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).toBeNull();
        });

        it('should not match regular text', () => {
            const line = 'Some regular text';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN);
            expect(match).toBeNull();
        });
    });

    // =============================================================================
    // findRepeaterInLines Tests
    // =============================================================================

    describe('findRepeaterInLines', () => {
        it('should find repeater on line after heading', () => {
            const lines = [
                '* TODO Task',
                'SCHEDULED: <2024-01-15 Mon +1w>'
            ];
            const result = findRepeaterInLines(lines, 0);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('SCHEDULED');
            expect(result!.lineIndex).toBe(1);
        });

        it('should find DEADLINE repeater', () => {
            const lines = [
                '* TODO Task',
                'DEADLINE: <2024-01-15 Mon +1d>'
            ];
            const result = findRepeaterInLines(lines, 0);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('DEADLINE');
        });

        it('should return null when no repeater on next line', () => {
            const lines = [
                '* TODO Task',
                'Some body text'
            ];
            const result = findRepeaterInLines(lines, 0);
            expect(result).toBeNull();
        });

        it('should return null when no next line', () => {
            const lines = ['* TODO Task'];
            const result = findRepeaterInLines(lines, 0);
            expect(result).toBeNull();
        });

        it('should return null for non-repeater timestamp', () => {
            const lines = [
                '* TODO Task',
                'SCHEDULED: <2024-01-15 Mon>'
            ];
            const result = findRepeaterInLines(lines, 0);
            expect(result).toBeNull();
        });
    });

    // =============================================================================
    // formatOrgTimestamp Tests
    // =============================================================================

    describe('formatOrgTimestamp', () => {
        it('should format basic active timestamp', () => {
            const date = new Date(2024, 0, 15); // January 15, 2024
            const result = formatOrgTimestamp(date);
            expect(result).toBe('<2024-01-15 Mon>');
        });

        it('should format with time', () => {
            const date = new Date(2024, 0, 15);
            const result = formatOrgTimestamp(date, { hour: 10, minute: 30 });
            expect(result).toBe('<2024-01-15 Mon 10:30>');
        });

        it('should format with repeater', () => {
            const date = new Date(2024, 0, 15);
            const result = formatOrgTimestamp(date, { repeater: '+1w' });
            expect(result).toBe('<2024-01-15 Mon +1w>');
        });

        it('should format with time and repeater', () => {
            const date = new Date(2024, 0, 15);
            const result = formatOrgTimestamp(date, { hour: 9, minute: 0, repeater: '+1d' });
            expect(result).toBe('<2024-01-15 Mon 09:00 +1d>');
        });

        it('should format inactive timestamp', () => {
            const date = new Date(2024, 0, 15);
            const result = formatOrgTimestamp(date, { active: false });
            expect(result).toBe('[2024-01-15 Mon]');
        });

        it('should format inactive timestamp with time', () => {
            const date = new Date(2024, 0, 15);
            const result = formatOrgTimestamp(date, { active: false, hour: 14, minute: 30 });
            expect(result).toBe('[2024-01-15 Mon 14:30]');
        });

        it('should pad single-digit months and days', () => {
            const date = new Date(2024, 0, 5); // January 5
            const result = formatOrgTimestamp(date);
            expect(result).toBe('<2024-01-05 Fri>');
        });

        it('should pad single-digit hours and minutes', () => {
            const date = new Date(2024, 0, 15);
            const result = formatOrgTimestamp(date, { hour: 9, minute: 5 });
            expect(result).toBe('<2024-01-15 Mon 09:05>');
        });
    });

    // =============================================================================
    // extractDateFromMatch Tests
    // =============================================================================

    describe('extractDateFromMatch', () => {
        it('should extract components from SCHEDULED match', () => {
            const line = 'SCHEDULED: <2024-01-15 Mon +1w>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN)!;
            const result = extractDateFromMatch(match);

            expect(result.keyword).toBe('SCHEDULED');
            expect(result.year).toBe(2024);
            expect(result.month).toBe(1);
            expect(result.day).toBe(15);
            expect(result.repeater).toBe('+1w');
            expect(result.hour).toBeUndefined();
            expect(result.minute).toBeUndefined();
        });

        it('should extract components with time', () => {
            const line = 'DEADLINE: <2024-12-31 Tue 23:59 +1y>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN)!;
            const result = extractDateFromMatch(match);

            expect(result.keyword).toBe('DEADLINE');
            expect(result.year).toBe(2024);
            expect(result.month).toBe(12);
            expect(result.day).toBe(31);
            expect(result.hour).toBe(23);
            expect(result.minute).toBe(59);
            expect(result.repeater).toBe('+1y');
        });

        it('should extract indent', () => {
            const line = '   SCHEDULED: <2024-01-15 Mon +1d>';
            const match = line.match(REPEATER_TIMESTAMP_PATTERN)!;
            const result = extractDateFromMatch(match);

            expect(result.indent).toBe('   ');
        });
    });
});
