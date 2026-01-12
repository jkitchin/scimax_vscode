/**
 * Tests for org-mode clocking and time tracking
 */

import { describe, it, expect } from 'vitest';
import {
    parseClockLine,
    formatClockTimestamp,
    formatDuration,
    formatDurationLong,
    generateClockIn,
    generateClockOut,
    clockIn,
    clockOut,
    parseEffort,
    formatEffort,
    checkClockConsistency,
    type ClockEntry,
} from '../orgClocking';

describe('orgClocking', () => {
    describe('parseClockLine', () => {
        it('parses a complete clock entry with duration', () => {
            const line = 'CLOCK: [2024-01-15 Mon 10:30]--[2024-01-15 Mon 12:00] =>  1:30';
            const entry = parseClockLine(line);

            expect(entry).not.toBeNull();
            expect(entry!.start.getFullYear()).toBe(2024);
            expect(entry!.start.getMonth()).toBe(0); // January
            expect(entry!.start.getDate()).toBe(15);
            expect(entry!.start.getHours()).toBe(10);
            expect(entry!.start.getMinutes()).toBe(30);
            expect(entry!.end).not.toBeUndefined();
            expect(entry!.end!.getHours()).toBe(12);
            expect(entry!.end!.getMinutes()).toBe(0);
            expect(entry!.duration).toBe(90); // 1:30 = 90 minutes
        });

        it('parses a running clock (no end time)', () => {
            const line = 'CLOCK: [2024-01-15 Mon 10:30]';
            const entry = parseClockLine(line);

            expect(entry).not.toBeNull();
            expect(entry!.start.getHours()).toBe(10);
            expect(entry!.start.getMinutes()).toBe(30);
            expect(entry!.end).toBeUndefined();
            expect(entry!.duration).toBeUndefined();
        });

        it('parses clock spanning multiple days', () => {
            const line = 'CLOCK: [2024-01-15 Mon 22:00]--[2024-01-16 Tue 02:00] =>  4:00';
            const entry = parseClockLine(line);

            expect(entry).not.toBeNull();
            expect(entry!.start.getDate()).toBe(15);
            expect(entry!.end!.getDate()).toBe(16);
            expect(entry!.duration).toBe(240); // 4 hours
        });

        it('returns null for non-clock lines', () => {
            expect(parseClockLine('* TODO Some headline')).toBeNull();
            expect(parseClockLine('SCHEDULED: <2024-01-15>')).toBeNull();
            expect(parseClockLine('Just some text')).toBeNull();
        });

        it('calculates duration when not provided', () => {
            const line = 'CLOCK: [2024-01-15 Mon 10:00]--[2024-01-15 Mon 11:30]';
            const entry = parseClockLine(line);

            expect(entry).not.toBeNull();
            expect(entry!.duration).toBe(90);
        });
    });

    describe('formatClockTimestamp', () => {
        it('formats a timestamp with time', () => {
            const date = new Date(2024, 0, 15, 10, 30);
            const formatted = formatClockTimestamp(date);
            expect(formatted).toBe('[2024-01-15 Mon 10:30]');
        });

        it('formats a timestamp without time', () => {
            const date = new Date(2024, 0, 15, 10, 30);
            const formatted = formatClockTimestamp(date, false);
            expect(formatted).toBe('[2024-01-15 Mon]');
        });

        it('pads single-digit months and days', () => {
            const date = new Date(2024, 0, 5, 9, 5);
            const formatted = formatClockTimestamp(date);
            expect(formatted).toBe('[2024-01-05 Fri 09:05]');
        });
    });

    describe('formatDuration', () => {
        it('formats minutes as H:MM', () => {
            expect(formatDuration(90)).toBe('1:30');
            expect(formatDuration(45)).toBe('0:45');
            expect(formatDuration(120)).toBe('2:00');
            expect(formatDuration(5)).toBe('0:05');
        });

        it('handles large durations', () => {
            expect(formatDuration(600)).toBe('10:00');
            expect(formatDuration(1440)).toBe('24:00');
        });

        it('handles zero', () => {
            expect(formatDuration(0)).toBe('0:00');
        });
    });

    describe('formatDurationLong', () => {
        it('formats with days, hours, and minutes', () => {
            expect(formatDurationLong(1500)).toBe('1d 1h 0m'); // 25 hours
            expect(formatDurationLong(90)).toBe('1h 30m');
            expect(formatDurationLong(45)).toBe('45m');
        });

        it('handles full days', () => {
            expect(formatDurationLong(1440)).toBe('1d 0h 0m'); // 24 hours
        });
    });

    describe('generateClockIn', () => {
        it('generates a clock-in line', () => {
            const date = new Date(2024, 0, 15, 10, 30);
            const line = generateClockIn(date);
            expect(line).toBe('CLOCK: [2024-01-15 Mon 10:30]');
        });
    });

    describe('generateClockOut', () => {
        it('generates a clock-out line with duration', () => {
            const start = new Date(2024, 0, 15, 10, 0);
            const end = new Date(2024, 0, 15, 11, 30);
            const line = generateClockOut(start, end);
            expect(line).toBe('CLOCK: [2024-01-15 Mon 10:00]--[2024-01-15 Mon 11:30] => 1:30');
        });
    });

    describe('clockIn/clockOut', () => {
        it('creates a clock entry on clock in', () => {
            const entry = clockIn();
            expect(entry.start).toBeInstanceOf(Date);
            expect(entry.end).toBeUndefined();
            expect(entry.duration).toBeUndefined();
        });

        it('closes clock entry on clock out', () => {
            const entry = clockIn();
            // Simulate some time passing
            entry.start = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
            const closed = clockOut(entry);
            expect(closed.end).toBeInstanceOf(Date);
            expect(closed.duration).toBeGreaterThanOrEqual(29); // ~30 minutes
        });
    });

    describe('parseEffort', () => {
        it('parses H:MM format', () => {
            expect(parseEffort('1:30')).toBe(90);
            expect(parseEffort('2:00')).toBe(120);
            expect(parseEffort('0:45')).toBe(45);
        });

        it('parses hours format', () => {
            expect(parseEffort('2h')).toBe(120);
            expect(parseEffort('1.5h')).toBe(90);
            expect(parseEffort('2 hours')).toBe(120);
        });

        it('parses minutes format', () => {
            expect(parseEffort('30m')).toBe(30);
            expect(parseEffort('90min')).toBe(90);
            expect(parseEffort('45 minutes')).toBe(45);
        });

        it('parses days format', () => {
            expect(parseEffort('1d')).toBe(480); // 8 hours
            expect(parseEffort('2days')).toBe(960);
        });

        it('parses plain numbers as minutes', () => {
            expect(parseEffort('30')).toBe(30);
            expect(parseEffort('120')).toBe(120);
        });

        it('returns 0 for invalid formats', () => {
            expect(parseEffort('invalid')).toBe(0);
            expect(parseEffort('')).toBe(0);
        });
    });

    describe('formatEffort', () => {
        it('formats effort in short format', () => {
            expect(formatEffort(90)).toBe('1:30');
            expect(formatEffort(120, 'short')).toBe('2:00');
        });

        it('formats effort in long format', () => {
            expect(formatEffort(90, 'long')).toBe('1h 30m');
            expect(formatEffort(1500, 'long')).toBe('1d 1h 0m');
        });
    });

    describe('checkClockConsistency', () => {
        it('detects running clocks', () => {
            const entries: ClockEntry[] = [
                { start: new Date(Date.now() - 60000) }, // Running clock
            ];
            const issues = checkClockConsistency(entries);
            expect(issues).toHaveLength(1);
            expect(issues[0].type).toBe('running');
        });

        it('detects future clocks', () => {
            const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const entries: ClockEntry[] = [
                {
                    start: futureDate,
                    end: new Date(futureDate.getTime() + 60000),
                    duration: 1,
                },
            ];
            const issues = checkClockConsistency(entries);
            expect(issues.some((i) => i.type === 'future')).toBe(true);
        });

        it('detects negative duration', () => {
            const start = new Date();
            const entries: ClockEntry[] = [
                {
                    start,
                    end: new Date(start.getTime() - 60000), // End before start
                    duration: -1,
                },
            ];
            const issues = checkClockConsistency(entries);
            expect(issues.some((i) => i.type === 'negative')).toBe(true);
        });

        it('detects overlapping entries', () => {
            const now = Date.now();
            const entries: ClockEntry[] = [
                {
                    start: new Date(now - 120 * 60000),
                    end: new Date(now - 30 * 60000), // Ends 30 min ago
                    duration: 90,
                },
                {
                    start: new Date(now - 60 * 60000), // Starts 60 min ago (overlaps!)
                    end: new Date(now),
                    duration: 60,
                },
            ];
            const issues = checkClockConsistency(entries);
            expect(issues.some((i) => i.type === 'overlap')).toBe(true);
        });

        it('detects very long entries', () => {
            const start = new Date(Date.now() - 15 * 60 * 60 * 1000); // 15 hours ago
            const entries: ClockEntry[] = [
                {
                    start,
                    end: new Date(),
                    duration: 15 * 60, // 15 hours
                },
            ];
            const issues = checkClockConsistency(entries);
            expect(issues.some((i) => i.type === 'long')).toBe(true);
        });

        it('returns empty for valid entries', () => {
            const now = Date.now();
            const entries: ClockEntry[] = [
                {
                    start: new Date(now - 120 * 60000),
                    end: new Date(now - 60 * 60000),
                    duration: 60,
                },
                {
                    start: new Date(now - 50 * 60000),
                    end: new Date(now - 20 * 60000),
                    duration: 30,
                },
            ];
            const issues = checkClockConsistency(entries);
            expect(issues).toHaveLength(0);
        });
    });
});
