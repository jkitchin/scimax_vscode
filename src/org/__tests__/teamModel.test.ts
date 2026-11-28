import { describe, it, expect } from 'vitest';
import { buildTeamModel, mondayOf, parseCapacity, readAway, type TeamPerson, type TeamTask } from '../teamModel';

function task(over: Partial<TeamTask> & { title: string }): TeamTask {
    return {
        level: 2, isDone: false, assignees: [], tags: [], dependsIds: [], line: 1,
        file: '/p/a/project.org', project: 'a', ganttId: over.id ?? over.title, ...over,
    } as TeamTask;
}

const d = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };

describe('team model', () => {
    it('reads capacities', () => {
        expect(parseCapacity('32h/week')).toBe(32);
        expect(parseCapacity('4d / week')).toBe(32);
        expect(parseCapacity('80%')).toBe(32);
        expect(parseCapacity('0.5')).toBe(20);
        expect(parseCapacity('30')).toBe(30);
        expect(parseCapacity('10 hours per week')).toBe(10);
        expect(parseCapacity('lots')).toBeUndefined();
        expect(parseCapacity(undefined)).toBeUndefined();
    });

    it('reads time away under :person: headings only', () => {
        const lines = [
            '* Ana                    :person:',
            '** Away',
            '   <2026-12-21 Mon>--<2027-01-01 Fri>',
            '** Away at a conference <2027-02-03 Wed>',
            '** Notes',
            '   <2027-03-01 Mon>',
            '* Project',
            '** Away',
            '   <2027-04-01 Thu>',
            '* Bo                     :person:',
            '** Vacation             :away:',
            '   <2027-05-03 Mon>--<2027-05-07 Fri>',
        ];
        const away = readAway(lines);
        expect(away.get(1)).toEqual([['2026-12-21', '2027-01-01'], ['2027-02-03', '2027-02-03']]);
        expect(away.get(10)).toEqual([['2027-05-03', '2027-05-07']]);
        expect(away.size).toBe(2);
    });

    it('spreads effort over working days, splits shared tasks, and cuts capacity for time away', () => {
        const people: TeamPerson[] = [
            { handle: 'ana', name: 'Ana', capacity: 40, away: [['2026-12-09', '2026-12-10']] },
            { handle: 'bo', name: 'Bo', away: [] },
        ];
        const tasks = [
            // 2 days of work (16h) from Thu Dec 3: Thu and Fri, then nothing (span ends Sat).
            task({ title: 'Two days', id: 't1', scheduled: d('2026-12-03'), effortMinutes: 16 * 60, assignees: ['ana'] }),
            // 5 days (40h) from Fri Dec 4, split between ana and bo: 20h each over Fri..Tue (calendar span of 5 days).
            task({ title: 'Shared', id: 't2', scheduled: d('2026-12-04'), effortMinutes: 40 * 60, assignees: ['ana', 'bo'] }),
            task({ title: 'Done', id: 't3', scheduled: d('2026-12-03'), effortMinutes: 600, assignees: ['ana'], isDone: true }),
            task({ title: 'Nobody', id: 't4', scheduled: d('2026-12-07'), effortMinutes: 120 }),
            task({ title: 'No effort', id: 't5', scheduled: d('2026-12-07'), assignees: ['bo'] }),
        ];
        const m = buildTeamModel(tasks, people, { start: d('2026-12-02'), weeks: 2, today: d('2026-11-01') });
        expect(m.weeks).toEqual(['2026-11-30', '2026-12-07']);
        const ana = m.rows.find(r => r.handle === 'ana')!;
        // t1: 16h over Thu+Fri. t2: 20h over its working days Fri, Mon, Tue (span Fri..Tue): 6.67h a day.
        expect(ana.load[0]).toBeCloseTo(16 + 20 / 3, 1);
        expect(ana.load[1]).toBeCloseTo(40 / 3, 1);
        expect(ana.awayDays).toEqual([0, 2]);
        expect(ana.capacity).toEqual([40, 24]);
        const bo = m.rows.find(r => r.handle === 'bo')!;
        expect(bo.capacity).toEqual([undefined, undefined]);
        expect(bo.unestimated).toBe(1);
        expect(bo.tasks.find(t => t.title === 'Shared')!.with).toEqual(['ana']);
        const nobody = m.rows.find(r => r.handle === '(unassigned)')!;
        expect(nobody.load[1]).toBe(2);
        expect(m.rows.map(r => r.handle)).toEqual(['ana', 'bo', '(unassigned)']);
        expect(m.taskCount).toBe(4);
    });

    it('books past work as overdue and far work as later, and filters by project', () => {
        const tasks = [
            task({ title: 'Old', id: 'o', scheduled: d('2026-11-02'), effortMinutes: 8 * 60, assignees: ['ana'] }),
            task({ title: 'Far', id: 'f', scheduled: d('2027-03-01'), effortMinutes: 8 * 60, assignees: ['ana'], project: 'b' }),
            task({ title: 'Weekend', id: 'w', scheduled: d('2026-12-12'), effortMinutes: 60, assignees: ['ana'] }),
        ];
        const people: TeamPerson[] = [{ handle: 'ana', name: 'Ana', capacity: 40, away: [] }];
        const m = buildTeamModel(tasks, people, { start: d('2026-12-07'), weeks: 1, today: d('2026-12-07') });
        const ana = m.rows[0];
        expect(ana.overdue).toBe(8);
        expect(ana.later).toBe(8);
        expect(ana.load).toEqual([1]);
        expect(m.projects).toEqual(['a', 'b']);
        const onlyA = buildTeamModel(tasks, people, { start: d('2026-12-07'), weeks: 1, today: d('2026-12-07'), projects: ['a'] });
        expect(onlyA.rows[0].later).toBe(0);
    });

    it('finds the Monday of a week', () => {
        expect(mondayOf(d('2026-12-06')).getDate()).toBe(30);
        expect(mondayOf(d('2026-11-30')).getDate()).toBe(30);
    });
});
