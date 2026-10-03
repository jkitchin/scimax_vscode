import { describe, it, expect } from 'vitest';
import {
    addPlanningDate,
    dayDelta,
    dependentsToShift,
    headingDeadline,
    headingForPlanningLine,
    planningDate,
    planningLines,
    shiftPlanningLine,
    type ShiftableTask,
} from '../planningShift';

interface T extends ShiftableTask { name: string }
const task = (name: string, deps: string[] = [], extra: Partial<T> = {}): T => ({
    name,
    id: name,
    dependsIds: deps,
    isDone: false,
    scheduled: new Date(2026, 9, 1),
    ...extra,
});

describe('shiftPlanningLine', () => {
    it('moves SCHEDULED and DEADLINE, keeping times, repeaters and warnings', () => {
        expect(shiftPlanningLine('SCHEDULED: <2026-10-05 Mon 09:00 +1w> DEADLINE: <2026-10-09 Fri -2d>', 3))
            .toBe('SCHEDULED: <2026-10-08 Thu 09:00 +1w> DEADLINE: <2026-10-12 Mon -2d>');
    });

    it('crosses month and year ends, both ways', () => {
        expect(shiftPlanningLine('DEADLINE: <2026-12-30 Wed>', 5)).toBe('DEADLINE: <2027-01-04 Mon>');
        expect(shiftPlanningLine('DEADLINE: <2026-03-02 Mon>', -2)).toBe('DEADLINE: <2026-02-28 Sat>');
    });

    it('adds a missing day name and leaves CLOSED alone', () => {
        expect(shiftPlanningLine('CLOSED: [2026-10-01 Thu 10:00] SCHEDULED: <2026-10-05>', 1))
            .toBe('CLOSED: [2026-10-01 Thu 10:00] SCHEDULED: <2026-10-06 Tue>');
    });
});

describe('shiftPlanningLine with one keyword', () => {
    it('moves only the DEADLINE', () => {
        expect(shiftPlanningLine('SCHEDULED: <2026-10-05 Mon> DEADLINE: <2026-10-09 Fri>', 2, 'DEADLINE'))
            .toBe('SCHEDULED: <2026-10-05 Mon> DEADLINE: <2026-10-11 Sun>');
    });
});

describe('addPlanningDate', () => {
    it('adds a planning line under a heading that has none', () => {
        expect(addPlanningDate(['* TODO A', 'Body'], 0, 'SCHEDULED', new Date(2026, 9, 5)))
            .toEqual({ line: 1, text: 'SCHEDULED: <2026-10-05 Mon>', insert: true });
    });

    it('adds to an existing CLOSED line', () => {
        expect(addPlanningDate(['* DONE A', 'CLOSED: [2026-10-01 Thu]  '], 0, 'SCHEDULED', new Date(2026, 9, 5)))
            .toEqual({ line: 1, text: 'CLOSED: [2026-10-01 Thu] SCHEDULED: <2026-10-05 Mon>', insert: false });
    });
});

describe('planningLines', () => {
    it('finds the planning lines directly under the heading only', () => {
        const lines = ['* TODO A', 'SCHEDULED: <2026-10-05 Mon>', 'DEADLINE: <2026-10-09 Fri>', 'Body DEADLINE: <2026-10-09 Fri>'];
        expect(planningLines(lines, 0)).toEqual([1, 2]);
        expect(planningLines(['* TODO A', 'CLOSED: [2026-10-01 Thu]', ':PROPERTIES:'], 0)).toEqual([]);
    });
});

describe('dependentsToShift', () => {
    it('follows dependencies transitively and skips done or undated tasks', () => {
        const a = task('a');
        const b = task('b', ['a']);
        const c = task('c', ['b']);
        const done = task('done', ['a'], { isDone: true });
        const undated = task('undated', ['a'], { scheduled: undefined });
        const afterUndated = task('after', ['undated']);
        const other = task('other');
        const shifted = dependentsToShift(a, [a, b, c, done, undated, afterUndated, other]).map(t => t.name);
        expect(shifted).toEqual(['b', 'c', 'after']);
    });

    it('stops on cycles and needs an id', () => {
        const a = task('a', ['b']);
        const b = task('b', ['a']);
        expect(dependentsToShift(a, [a, b]).map(t => t.name)).toEqual(['b']);
        expect(dependentsToShift(task('x', [], { id: undefined }), [a, b])).toEqual([]);
    });
});

describe('dayDelta', () => {
    it('counts calendar days across a daylight saving change', () => {
        expect(dayDelta(new Date(2026, 2, 7), new Date(2026, 2, 10))).toBe(3);
        expect(dayDelta(new Date(2026, 9, 10), new Date(2026, 9, 3))).toBe(-7);
    });
});

describe('deadline lookups', () => {
    const lines = ['* TODO A', 'SCHEDULED: <2026-10-05 Mon>', 'DEADLINE: <2026-10-09 Fri 17:00>', 'Text DEADLINE: <2026-11-01 Sun>', '* TODO B'];

    it('reads a keyword\'s date from a planning line', () => {
        expect(planningDate('SCHEDULED: <2026-10-05 Mon> DEADLINE: <2026-10-09 Fri>', 'DEADLINE')).toEqual(new Date(2026, 9, 9));
        expect(planningDate('SCHEDULED: <2026-10-05 Mon>', 'DEADLINE')).toBeUndefined();
    });

    it('finds the heading of a planning line, not of body text', () => {
        expect(headingForPlanningLine(lines, 1)).toBe(0);
        expect(headingForPlanningLine(lines, 2)).toBe(0);
        expect(headingForPlanningLine(lines, 3)).toBe(-1);
        expect(headingForPlanningLine(['DEADLINE: <2026-10-09 Fri>'], 0)).toBe(-1);
    });

    it('reads a heading\'s deadline from its planning lines only', () => {
        expect(headingDeadline(lines, 0)).toEqual(new Date(2026, 9, 9));
        expect(headingDeadline(lines, 4)).toBeUndefined();
    });
});
