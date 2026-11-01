import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { parseTaskLine, parseDate, isOverdue, setDateTagOnLine, formatDate } from '../taskParser';

function daysFromToday(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return formatDate(d);
}

describe('taskParser dates', () => {
    it('parses valid ISO and US dates', () => {
        expect(formatDate(parseDate('2026-02-28')!)).toBe('2026-02-28');
        expect(formatDate(parseDate('02/28/2026')!)).toBe('2026-02-28');
    });

    it('rejects invalid dates instead of rolling over', () => {
        expect(parseDate('2026-02-30')).toBeUndefined();
        expect(parseDate('2026-13-01')).toBeUndefined();
        expect(parseDate('02/30/2026')).toBeUndefined();
        expect(parseDate('Feb 30 2026')).toBeUndefined();
    });

    it('reads @deadline as due, with @due taking precedence', () => {
        expect(formatDate(parseTaskLine('- [ ] x @deadline(2026-03-01)', 'f', 0)!.due!)).toBe('2026-03-01');
        expect(formatDate(parseTaskLine('- [ ] x @due(2026-03-02) @deadline(2026-03-01)', 'f', 0)!.due!)).toBe('2026-03-02');
        expect(parseTaskLine('- [ ] x @deadline(2026-03-01)', 'f', 0)!.title).toBe('x');
    });
});

describe('isOverdue', () => {
    it('counts a past scheduled date for an incomplete task', () => {
        expect(isOverdue(parseTaskLine(`- [ ] x @scheduled(${daysFromToday(-2)})`, 'f', 0)!)).toBe(true);
        expect(isOverdue(parseTaskLine(`- [ ] x @scheduled(${daysFromToday(2)})`, 'f', 0)!)).toBe(false);
        expect(isOverdue(parseTaskLine(`- [x] x @scheduled(${daysFromToday(-2)})`, 'f', 0)!)).toBe(false);
    });

    it('still counts a past due date', () => {
        expect(isOverdue(parseTaskLine(`- [ ] x @due(${daysFromToday(-1)})`, 'f', 0)!)).toBe(true);
        expect(isOverdue(parseTaskLine(`- [ ] x @due(${daysFromToday(0)})`, 'f', 0)!)).toBe(false);
    });
});

describe('tags', () => {
    it('only takes #word after whitespace/start, starting with a letter', () => {
        const t = parseTaskLine('- [ ] read http://x.org/page#section issue #123 #work #to-do', 'f', 0)!;
        expect(t.tags).toEqual(['work', 'to-do']);
        expect(t.title).toBe('read http://x.org/page#section issue #123');
    });

    it('accepts a tag at the start of the content', () => {
        expect(parseTaskLine('- [ ] #home fix sink', 'f', 0)!.tags).toEqual(['home']);
    });
});

describe('setDateTagOnLine', () => {
    it('appends to a heading line', () => {
        expect(setDateTagOnLine('## TODO Write paper  ', 'scheduled', '2026-01-05'))
            .toBe('## TODO Write paper @scheduled(2026-01-05)');
    });

    it('replaces an existing tag of the same kind in place', () => {
        expect(setDateTagOnLine('# TODO x @scheduled(2026-01-01) #work', 'scheduled', '2026-01-05'))
            .toBe('# TODO x @scheduled(2026-01-05) #work');
    });

    it('replaces @deadline when setting due, keeping indentation of tasks', () => {
        expect(setDateTagOnLine('  - [ ] x @deadline(2026-01-01) @due(2026-01-02)', 'due', '2026-01-05'))
            .toBe('  - [ ] x @due(2026-01-05)');
    });

    it('returns undefined on other lines', () => {
        expect(setDateTagOnLine('plain text', 'due', '2026-01-05')).toBeUndefined();
        expect(setDateTagOnLine('#hashtag line', 'due', '2026-01-05')).toBeUndefined();
    });
});
