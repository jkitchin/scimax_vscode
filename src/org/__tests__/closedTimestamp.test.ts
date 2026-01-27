/**
 * Tests for CLOSED timestamp handling
 * Tests that CLOSED is properly added/removed on the planning line
 */

import { describe, it, expect } from 'vitest';
import {
    findPlanningLine,
    buildPlanningLine,
    removeClosed,
} from '../planningLine';

describe('CLOSED Timestamp Handling', () => {
    describe('findPlanningLine', () => {
        it('finds DEADLINE line after heading', () => {
            const lines = [
                '* TODO Task',
                'DEADLINE: <2026-01-27 Tue>',
                'Body text',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(1);
        });

        it('finds SCHEDULED line after heading', () => {
            const lines = [
                '* TODO Task',
                'SCHEDULED: <2026-01-27 Tue>',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(1);
        });

        it('finds line with both DEADLINE and SCHEDULED', () => {
            const lines = [
                '* TODO Task',
                'SCHEDULED: <2026-01-27 Tue> DEADLINE: <2026-01-28 Wed>',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(1);
        });

        it('finds CLOSED line after heading', () => {
            const lines = [
                '* DONE Task',
                'CLOSED: [2026-01-27 Tue 14:00]',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(1);
        });

        it('finds combined planning line', () => {
            const lines = [
                '* DONE Task',
                'CLOSED: [2026-01-27 Tue 14:00] DEADLINE: <2026-01-27 Tue>',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(1);
        });

        it('returns -1 when no planning line exists', () => {
            const lines = [
                '* TODO Task',
                'Body text',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(-1);
        });

        it('stops at next heading', () => {
            const lines = [
                '* TODO Task 1',
                'Body text',
                '* TODO Task 2',
                'DEADLINE: <2026-01-27 Tue>',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(-1);
        });

        it('handles indented planning line', () => {
            const lines = [
                '** TODO Subtask',
                '   DEADLINE: <2026-01-27 Tue>',
            ];
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(1);
        });

        it('skips property drawer to find planning line', () => {
            const lines = [
                '* TODO Task',
                ':PROPERTIES:',
                ':ID: abc123',
                ':END:',
                'DEADLINE: <2026-01-27 Tue>',
            ];
            // Planning line should be after properties
            const result = findPlanningLine(lines, 0);
            expect(result).toBe(-1); // Planning lines must be immediately after heading or CLOSED
        });
    });

    describe('buildPlanningLine', () => {
        it('adds CLOSED to existing DEADLINE line', () => {
            const existingLine = 'DEADLINE: <2026-01-27 Tue>';
            const closedTs = '[2026-01-27 Tue 14:00]';
            const result = buildPlanningLine(existingLine, closedTs);
            expect(result).toBe('CLOSED: [2026-01-27 Tue 14:00] DEADLINE: <2026-01-27 Tue>');
        });

        it('adds CLOSED to existing SCHEDULED line', () => {
            const existingLine = 'SCHEDULED: <2026-01-27 Tue>';
            const closedTs = '[2026-01-27 Tue 14:00]';
            const result = buildPlanningLine(existingLine, closedTs);
            expect(result).toBe('CLOSED: [2026-01-27 Tue 14:00] SCHEDULED: <2026-01-27 Tue>');
        });

        it('adds CLOSED to combined SCHEDULED and DEADLINE line', () => {
            const existingLine = 'SCHEDULED: <2026-01-27 Tue> DEADLINE: <2026-01-28 Wed>';
            const closedTs = '[2026-01-27 Tue 14:00]';
            const result = buildPlanningLine(existingLine, closedTs);
            expect(result).toBe('CLOSED: [2026-01-27 Tue 14:00] SCHEDULED: <2026-01-27 Tue> DEADLINE: <2026-01-28 Wed>');
        });

        it('preserves indentation', () => {
            const existingLine = '   DEADLINE: <2026-01-27 Tue>';
            const closedTs = '[2026-01-27 Tue 14:00]';
            const result = buildPlanningLine(existingLine, closedTs);
            expect(result).toBe('   CLOSED: [2026-01-27 Tue 14:00] DEADLINE: <2026-01-27 Tue>');
        });

        it('updates existing CLOSED timestamp', () => {
            const existingLine = 'CLOSED: [2026-01-26 Mon 10:00] DEADLINE: <2026-01-27 Tue>';
            const closedTs = '[2026-01-27 Tue 14:00]';
            const result = buildPlanningLine(existingLine, closedTs);
            expect(result).toBe('CLOSED: [2026-01-27 Tue 14:00] DEADLINE: <2026-01-27 Tue>');
        });
    });

    describe('removeClosed', () => {
        it('removes CLOSED from combined line, keeping DEADLINE', () => {
            const line = 'CLOSED: [2026-01-27 Tue 14:00] DEADLINE: <2026-01-27 Tue>';
            const result = removeClosed(line);
            expect(result).toBe('DEADLINE: <2026-01-27 Tue>');
        });

        it('removes CLOSED from combined line, keeping SCHEDULED', () => {
            const line = 'CLOSED: [2026-01-27 Tue 14:00] SCHEDULED: <2026-01-27 Tue>';
            const result = removeClosed(line);
            expect(result).toBe('SCHEDULED: <2026-01-27 Tue>');
        });

        it('removes CLOSED from line with both SCHEDULED and DEADLINE', () => {
            const line = 'CLOSED: [2026-01-27 Tue 14:00] SCHEDULED: <2026-01-27 Tue> DEADLINE: <2026-01-28 Wed>';
            const result = removeClosed(line);
            expect(result).toBe('SCHEDULED: <2026-01-27 Tue> DEADLINE: <2026-01-28 Wed>');
        });

        it('preserves indentation when removing CLOSED', () => {
            const line = '   CLOSED: [2026-01-27 Tue 14:00] DEADLINE: <2026-01-27 Tue>';
            const result = removeClosed(line);
            expect(result).toBe('   DEADLINE: <2026-01-27 Tue>');
        });

        it('returns empty string for line with only CLOSED', () => {
            const line = 'CLOSED: [2026-01-27 Tue 14:00]';
            const result = removeClosed(line);
            expect(result).toBe('');
        });

        it('returns empty string for indented line with only CLOSED', () => {
            const line = '   CLOSED: [2026-01-27 Tue 14:00]';
            const result = removeClosed(line);
            expect(result).toBe('');
        });

        it('returns line unchanged if no CLOSED present', () => {
            const line = 'DEADLINE: <2026-01-27 Tue>';
            const result = removeClosed(line);
            expect(result).toBe('DEADLINE: <2026-01-27 Tue>');
        });
    });
});
