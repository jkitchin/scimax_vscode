/**
 * Deadline warning periods: `DEADLINE: <2026-12-15 Tue -2w>` shows the
 * deadline in an agenda window that overlaps the two weeks before it, not only
 * in a window that contains the date. There is no default period; a deadline
 * without one shows only in a window that contains its date (or once overdue).
 */

// Per-function imports: the package index loads all of date-fns.
import addDays from 'date-fns/addDays';
import isAfter from 'date-fns/isAfter';
import isBefore from 'date-fns/isBefore';
import startOfDay from 'date-fns/startOfDay';
import subMonths from 'date-fns/subMonths';
import subYears from 'date-fns/subYears';

export type WarningUnit = 'h' | 'd' | 'w' | 'm' | 'y';

/**
 * The warning period in a timestamp's text, e.g. "2026-12-15 Tue +1m -2w"
 * (or "--2w", which org applies to the first repeat only). Undefined if none.
 */
export function parseWarning(text: string | undefined): { value: number; unit: WarningUnit } | undefined {
    const m = /(?:^|\s)--?(\d+)([hdwmy])(?=[\s>\]]|$)/.exec(text || '');
    return m ? { value: Number(m[1]), unit: m[2] as WarningUnit } : undefined;
}

/** The first day the deadline should show, or the deadline's own day without a warning. */
export function warningStart(deadline: Date, warning?: { value: number; unit: WarningUnit }): Date {
    const day = startOfDay(deadline);
    if (!warning) return day;
    switch (warning.unit) {
        case 'h': return startOfDay(new Date(deadline.getTime() - warning.value * 3600_000));
        case 'd': return addDays(day, -warning.value);
        case 'w': return addDays(day, -7 * warning.value);
        case 'm': return subMonths(day, warning.value);
        case 'y': return subYears(day, warning.value);
    }
}

/**
 * True when a deadline belongs in the window [start, end): it is due in the
 * window, or due after it with a warning period that starts before `end`.
 * (Overdue deadlines are handled by the callers.)
 */
export function deadlineInWindow(deadline: Date, warnFrom: Date, start: Date, end: Date): boolean {
    return !isBefore(startOfDay(deadline), startOfDay(start)) && isBefore(warnFrom, startOfDay(end));
}

/**
 * The day in [start, end) a warned deadline is listed on when it is due after
 * the window: today if today is in the window and warned, else the first
 * warned day of the window.
 */
export function warningDisplayDay(warnFrom: Date, start: Date, end: Date, today: Date = new Date()): Date {
    const day = isAfter(warnFrom, start) ? startOfDay(warnFrom) : startOfDay(start);
    const t = startOfDay(today);
    return !isBefore(t, day) && isBefore(t, startOfDay(end)) ? t : day;
}
