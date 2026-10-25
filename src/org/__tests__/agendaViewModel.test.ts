import { describe, it, expect } from 'vitest';
import {
    agendaLeader,
    groupByState,
    isUnder,
    limitToRoot,
    rowFromItem,
    rowGroups,
    type AgendaRow,
} from '../agendaViewModel';
import type { AgendaItem } from '../../parser/orgAgenda';

function item(over: Partial<AgendaItem>): AgendaItem {
    return {
        title: 'Task',
        tags: [],
        file: '/notes/a.org',
        line: 3,
        headline: undefined as unknown as AgendaItem['headline'],
        agendaType: 'todo',
        ...over,
    };
}

function row(over: Partial<AgendaRow>): AgendaRow {
    return { file: '/notes/a.org', line: 1, title: 'T', done: false, tags: [], assignees: [], properties: {}, leader: '', overdue: false, blocked: false, ...over };
}

describe('agendaLeader', () => {
    it('follows the org-agenda leaders', () => {
        expect(agendaLeader(item({ agendaType: 'scheduled' }))).toBe('Scheduled:');
        expect(agendaLeader(item({ agendaType: 'scheduled', overdue: true, daysUntil: -2 }))).toBe('Sched.2x:');
        expect(agendaLeader(item({ agendaType: 'deadline', daysUntil: 0 }))).toBe('Deadline:');
        expect(agendaLeader(item({ agendaType: 'deadline', daysUntil: 3 }))).toBe('In 3 d.:');
        expect(agendaLeader(item({ agendaType: 'deadline', overdue: true, daysUntil: -4 }))).toBe('4 d. ago:');
        expect(agendaLeader(item({ agendaType: 'timestamp' }))).toBe('');
    });
});

describe('rowFromItem', () => {
    it('merges own and inherited tags and names the planning date', () => {
        const r = rowFromItem(item({ tags: ['work', 'urgent'], inheritedTags: ['work', 'proj'], agendaType: 'deadline', daysUntil: 1 }));
        expect(r.tags).toEqual(['work', 'urgent', 'proj']);
        expect(r.planning).toBe('DEADLINE');
        expect(r.leader).toBe('In 1 d.:');
    });

    it('carries assignees and upper-cases property keys', () => {
        const r = rowFromItem(item({ assignees: ['jk', 'jk'], properties: { Assignee: 'jk', effort: ' 1h ' } }));
        expect(r.assignees).toEqual(['jk']);
        expect(r.properties).toEqual({ ASSIGNEE: 'jk', EFFORT: '1h' });
    });

    it('falls back to the headline drawer for parsed items', () => {
        const headline = { propertiesDrawer: { client: 'ACME' } } as unknown as AgendaItem['headline'];
        expect(rowFromItem(item({ headline })).properties).toEqual({ CLIENT: 'ACME' });
    });

    it('leaves planning unset for plain timestamps', () => {
        expect(rowFromItem(item({ agendaType: 'timestamp' })).planning).toBeUndefined();
    });
});

describe('rowGroups', () => {
    it('marks today', () => {
        const groups = rowGroups([
            { label: 'Today', key: '2026-10-24', items: [item({})] },
            { label: 'Tomorrow', key: '2026-10-25', items: [] },
        ], new Date(2026, 9, 24, 12));
        expect(groups.map(g => g.today)).toEqual([true, undefined]);
        expect(groups[0].rows).toHaveLength(1);
    });
});

describe('groupByState', () => {
    it('groups by keyword in first-seen order, priority then title within', () => {
        const groups = groupByState([
            row({ todo: 'NEXT', title: 'b' }),
            row({ todo: 'TODO', title: 'z', priority: 'A' }),
            row({ todo: 'NEXT', title: 'a' }),
            row({ todo: 'TODO', title: 'y' }),
            row({ title: 'plain' }),
        ]);
        expect(groups.map(g => g.label)).toEqual(['NEXT', 'TODO', 'No keyword']);
        expect(groups[0].rows.map(r => r.title)).toEqual(['a', 'b']);
        expect(groups[1].rows.map(r => r.title)).toEqual(['z', 'y']);
    });
});

describe('limitToRoot', () => {
    it('keeps rows under the root', () => {
        expect(isUnder('/p/x/a.org', '/p/x')).toBe(true);
        expect(isUnder('/p/xy/a.org', '/p/x')).toBe(false);
        const sections = [{ header: 'H', groups: [
            { label: 'one', key: '2026-10-24', rows: [row({ file: '/p/x/a.org' }), row({ file: '/q/b.org' })] },
            { label: 'two', key: '2026-10-25', rows: [row({ file: '/q/c.org' })] },
        ] }];
        const kept = limitToRoot(sections, '/p/x');
        expect(kept[0].groups).toHaveLength(1);
        expect(kept[0].groups[0].rows).toHaveLength(1);
        expect(limitToRoot(sections, '/p/x', true)[0].groups).toHaveLength(2);
    });
});
