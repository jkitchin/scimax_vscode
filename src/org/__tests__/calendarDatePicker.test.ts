import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { getCalendarHtml, dateKey } from '../calendarDatePicker';

/** Extract the day cells (class list and day number) from the rendered grid */
function dayCells(html: string): { classes: string; day: string }[] {
    const grid = html.slice(html.indexOf('<div class="calendar-grid">'));
    const re = /<div class="(day[^"]*)"[^>]*>(\d*)<\/div>/g;
    const cells: { classes: string; day: string }[] = [];
    let m;
    while ((m = re.exec(grid)) !== null) {
        cells.push({ classes: m[1], day: m[2] });
    }
    return cells;
}

describe('calendarDatePicker', () => {
    const today = new Date(2026, 9, 5); // 2026-10-05, a Monday

    it('dateKey formats local dates as YYYY-MM-DD', () => {
        expect(dateKey(new Date(2026, 0, 3))).toBe('2026-01-03');
    });

    it('marks days in markedDates with a dot class and tooltip', () => {
        const html = getCalendarHtml(2026, 9, today, 'Go', {
            markedDates: new Set(['2026-10-01', '2026-10-05', '2026-11-02']),
            markedTooltip: 'Has journal entry'
        });
        const cells = dayCells(html).filter(c => c.day);
        const marked = cells.filter(c => c.classes.includes('marked')).map(c => c.day);
        expect(marked).toEqual(['1', '5']);
        // Marked past days are not dimmed
        expect(cells[0].classes).not.toContain('past');
        expect(cells[1].classes).toContain('past');
        expect(html).toContain('title="Has journal entry"');
    });

    it('bolds months that contain marked dates in the month picker', () => {
        const html = getCalendarHtml(2026, 9, today, 'Go', {
            markedDates: new Set(['2026-03-14', '2025-07-01'])
        });
        expect(html).toMatch(/month-btn has-marked" onclick="goToMonth\(2\)"/);
        expect(html).not.toMatch(/has-marked" onclick="goToMonth\(6\)"/);
    });

    it('respects weekStartsOn', () => {
        // 2026-10-01 is a Thursday
        const sun = dayCells(getCalendarHtml(2026, 9, today, 'Go'));
        expect(sun.findIndex(c => c.day === '1')).toBe(4);
        const mon = dayCells(getCalendarHtml(2026, 9, today, 'Go', { weekStartsOn: 'monday' }));
        expect(mon.findIndex(c => c.day === '1')).toBe(3);
        expect(getCalendarHtml(2026, 9, today, 'Go', { weekStartsOn: 'monday' }))
            .toMatch(/day-header">Mo<\/div><div class="day-header">Tu/);
    });

    it('renders no marks by default', () => {
        expect(getCalendarHtml(2026, 9, today, 'Go')).not.toMatch(/class="day[^"]*marked/);
    });
});
