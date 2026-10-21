import { describe, it, expect } from 'vitest';
import { dbItemToAgendaItem, headingToAgendaItem } from '../orgAgendaDb';
import { formatAgendaItem } from '../orgAgenda';
import type { HeadingRecord } from '../../database/scimaxDbCore';

function heading(overrides: Partial<HeadingRecord> = {}): HeadingRecord {
    return {
        id: 1,
        file_id: 1,
        file_path: '/notes/work.org',
        level: 1,
        title: 'Pay rent',
        line_number: 1,
        begin_pos: 0,
        todo_state: 'TODO',
        todo_type: 'todo',
        priority: null,
        tags: '[]',
        inherited_tags: '[]',
        properties: '{}',
        scheduled: null,
        deadline: null,
        closed: null,
        cell_index: null,
        ...overrides,
    } as HeadingRecord;
}

describe('orgAgendaDb repeaters', () => {
    it("marks a deadline with its own repeater", () => {
        const h = heading({ deadline: '2026-10-21 Wed +1m -3d' });
        const item = dbItemToAgendaItem({ type: 'deadline', heading: h, date: h.deadline! });
        expect(item.repeater).toBe('+1m');
        expect(formatAgendaItem(item)).toContain('↻+1m TODO Pay rent');
    });

    it('reads ++ and .+ repeaters', () => {
        const catchUp = heading({ scheduled: '2026-10-21 Wed 09:00 ++1w' });
        expect(dbItemToAgendaItem({ type: 'scheduled', heading: catchUp, date: catchUp.scheduled! }).repeater).toBe('++1w');
        const restart = heading({ scheduled: '2026-10-21 Wed .+2d/4d' });
        expect(dbItemToAgendaItem({ type: 'scheduled', heading: restart, date: restart.scheduled! }).repeater).toBe('.+2d');
    });

    it("falls back to the heading's other timestamp's repeater", () => {
        const h = heading({ scheduled: '2026-10-19 Mon', deadline: '2026-10-30 Fri .+1m' });
        const item = dbItemToAgendaItem({ type: 'scheduled', heading: h, date: h.scheduled! });
        expect(item.repeater).toBe('.+1m');
    });

    it('does not take a deadline warning for a repeater', () => {
        const h = heading({ deadline: '2026-10-21 Wed -3d' });
        const item = dbItemToAgendaItem({ type: 'deadline', heading: h, date: h.deadline! });
        expect(item.repeater).toBeUndefined();
        expect(formatAgendaItem(item)).not.toContain('↻');
    });

    it('marks TODO list rows from either timestamp', () => {
        expect(headingToAgendaItem(heading({ deadline: '2026-10-21 Wed +1y' })).repeater).toBe('+1y');
        expect(headingToAgendaItem(heading()).repeater).toBeUndefined();
    });
});
