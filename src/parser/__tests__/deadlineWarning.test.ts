import { describe, it, expect } from 'vitest';
import { deadlineInWindow, parseWarning, warningDisplayDay, warningStart } from '../deadlineWarning';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('parseWarning', () => {
    it('reads the warning period from timestamp text, ignoring the date and repeaters', () => {
        expect(parseWarning('2014-11-15 Sat -2w')).toEqual({ value: 2, unit: 'w' });
        expect(parseWarning('2026-01-31 Fri +1m -3d')).toEqual({ value: 3, unit: 'd' });
        expect(parseWarning('<2026-01-31 Fri ++1w --1m>')).toEqual({ value: 1, unit: 'm' });
        expect(parseWarning('2026-01-31 Fri 10:00 +1w')).toBeUndefined();
        expect(parseWarning('2026-01-31')).toBeUndefined();
        expect(parseWarning(undefined)).toBeUndefined();
    });
});

describe('warningStart', () => {
    it('subtracts days, weeks, months and years; no warning means the day itself', () => {
        const due = d(2026, 3, 31);
        expect(warningStart(due)).toEqual(due);
        expect(warningStart(due, { value: 3, unit: 'd' })).toEqual(d(2026, 3, 28));
        expect(warningStart(due, { value: 2, unit: 'w' })).toEqual(d(2026, 3, 17));
        expect(warningStart(due, { value: 1, unit: 'm' })).toEqual(d(2026, 2, 28));
        expect(warningStart(due, { value: 1, unit: 'y' })).toEqual(d(2025, 3, 31));
        expect(warningStart(due, { value: 0, unit: 'd' })).toEqual(due);
    });
});

describe('deadlineInWindow', () => {
    const start = d(2026, 10, 5);
    const end = d(2026, 10, 12); // exclusive: the week of Oct 5-11

    it('includes a deadline due in the window', () => {
        expect(deadlineInWindow(d(2026, 10, 8), d(2026, 10, 8), start, end)).toBe(true);
    });

    it('includes a later deadline whose warning starts inside the window', () => {
        expect(deadlineInWindow(d(2026, 10, 20), d(2026, 10, 6), start, end)).toBe(true);
    });

    it('excludes a later deadline whose warning starts after the window', () => {
        expect(deadlineInWindow(d(2026, 10, 20), d(2026, 10, 12), start, end)).toBe(false);
    });

    it('leaves deadlines before the window to the overdue handling', () => {
        expect(deadlineInWindow(d(2026, 10, 1), d(2026, 9, 1), start, end)).toBe(false);
    });
});

describe('warningDisplayDay', () => {
    const start = d(2026, 10, 5);
    const end = d(2026, 10, 12);
    it('uses today when today is in the window and warned', () => {
        expect(warningDisplayDay(d(2026, 9, 1), start, end, d(2026, 10, 7))).toEqual(d(2026, 10, 7));
    });
    it('uses the first warned day otherwise', () => {
        expect(warningDisplayDay(d(2026, 10, 9), start, end, d(2026, 10, 7))).toEqual(d(2026, 10, 9));
        expect(warningDisplayDay(d(2026, 9, 1), start, end, d(2026, 11, 1))).toEqual(start);
    });
});
