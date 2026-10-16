/**
 * Tests for which timestamp field S-up/S-down changes based on cursor position
 */

import { describe, it, expect } from 'vitest';

import { getTimestampComponent } from '../timestampComponent';

describe('getTimestampComponent', () => {
    const line = 'DEADLINE: <2026-10-19 Mon 09:30 +1w>';
    const start = line.indexOf('<');
    const ts = { start, end: line.length, hour: 9, repeater: '+1w' };
    const at = (s: string) => line.indexOf(s);

    it('cursor inside a field selects that field', () => {
        expect(getTimestampComponent(line, at('026'), ts)).toBe('year');
        expect(getTimestampComponent(line, at('0-19'), ts)).toBe('month');
        expect(getTimestampComponent(line, at('9 Mon'), ts)).toBe('day');
        expect(getTimestampComponent(line, at('9:30'), ts)).toBe('hour');
        expect(getTimestampComponent(line, at('0 +1w'), ts)).toBe('minute');
        expect(getTimestampComponent(line, at('1w'), ts)).toBe('repeater');
    });

    it('cursor directly after a field selects that field', () => {
        expect(getTimestampComponent(line, at('-10'), ts)).toBe('year');
        expect(getTimestampComponent(line, at('-19'), ts)).toBe('month');
        expect(getTimestampComponent(line, at(' Mon'), ts)).toBe('day');
        expect(getTimestampComponent(line, at(':30'), ts)).toBe('hour');
        expect(getTimestampComponent(line, at(' +1w'), ts)).toBe('minute');
    });

    it('cursor on the day name defaults to day', () => {
        expect(getTimestampComponent(line, at('on '), ts)).toBe('day');
    });
});
