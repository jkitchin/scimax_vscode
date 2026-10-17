import { describe, it, expect } from 'vitest';
import {
    resolveCustomCommands,
    resolveStartDay,
    commandsUnderPrefix,
    sortItems,
    groupList,
    parseSearchWords,
    formatCustomItem,
    renderCustomCommand,
    customCommandToHtml,
    customCommandToIcs,
    customCommandToJson,
    exportCustomCommand,
    entryText,
    shouldSkip,
    type CustomCommandResult,
    type ResolvedBlock,
} from '../orgAgendaCustom';
import type { AgendaItem } from '../orgAgenda';
import type { HeadlineElement } from '../orgElementTypes';

const NOW = new Date(2026, 9, 17, 12, 0); // Sat Oct 17 2026

function item(over: Partial<AgendaItem> = {}): AgendaItem {
    return {
        title: 'Task',
        tags: [],
        file: '/org/work.org',
        line: 1,
        agendaType: 'todo',
        headline: { type: 'headline', properties: { level: 1 } } as unknown as HeadlineElement,
        ...over,
    };
}

function resolveOne(cmd: object) {
    const { commands, problems } = resolveCustomCommands([cmd], { home: '/home/me' });
    expect(problems).toEqual([]);
    return commands[0];
}

describe('resolveCustomCommands', () => {
    it('accepts a single-block command given inline', () => {
        const c = resolveOne({ key: 'w', description: 'Work', type: 'tags-todo', match: '+work' });
        expect(c.errors).toEqual([]);
        expect(c.isPrefix).toBe(false);
        expect(c.blocks).toHaveLength(1);
        expect(c.blocks[0].type).toBe('tags-todo');
        expect(c.blocks[0].prefilter).toEqual({ requiredTags: ['work'] });
        expect(c.blocks[0].header).toBe('TODO headlines with tags matching: +work');
    });

    it('treats a command with no blocks as a prefix', () => {
        const c = resolveOne({ key: 'g', description: 'Group' });
        expect(c.isPrefix).toBe(true);
    });

    it('merges command settings into blocks and expands ~', () => {
        const c = resolveOne({
            key: 'x',
            settings: { files: ['~/org/a.org'], skip: { scheduled: true } },
            blocks: [{ type: 'alltodo', skip: { deadline: true } }, { type: 'agenda', span: 1 }],
        });
        expect(c.blocks[0].files).toEqual(['/home/me/org/a.org']);
        expect(c.blocks[0].skip).toEqual({ scheduled: true, deadline: true });
        expect(c.blocks[1].skip).toEqual({ scheduled: true });
    });

    it('reports bad block types, match strings, sort keys and regexes', () => {
        const c = resolveOne({
            key: 'b',
            blocks: [
                { type: 'nope' },
                { type: 'tags', match: '+work+{abc' },
                { type: 'alltodo', sort: ['sideways'] },
                { type: 'alltodo', skip: { regexp: '[' } },
                { type: 'agenda', span: 0 },
                { type: 'search' },
            ],
        });
        expect(c.errors).toHaveLength(6);
        expect(c.errors[0]).toMatch(/unknown block type "nope"/);
        expect(c.errors[1]).toMatch(/column/);
        expect(c.errors[2]).toMatch(/sideways/);
        expect(c.errors[3]).toMatch(/skip.regexp/);
        expect(c.errors[4]).toMatch(/span/);
        expect(c.errors[5]).toMatch(/search block/);
    });

    it('reports duplicate keys and entries without a key', () => {
        const { commands, problems } = resolveCustomCommands([{ key: 'a', type: 'alltodo' }, { key: 'a', type: 'alltodo' }, { type: 'alltodo' }]);
        expect(commands[1].errors[0]).toMatch(/Duplicate/);
        expect(problems[0]).toMatch(/needs a "key"/);
    });

    it('rejects a non-array setting', () => {
        expect(resolveCustomCommands({}).problems[0]).toMatch(/must be an array/);
        expect(resolveCustomCommands(undefined)).toEqual({ commands: [], problems: [] });
    });

    it('parses todo keywords and compiles the stuck match', () => {
        const c = resolveOne({ key: 't', blocks: [{ type: 'todo', match: 'NEXT|WAITING' }, { type: 'stuck' }] });
        expect(c.blocks[0].keywords).toEqual(['NEXT', 'WAITING']);
        expect(c.blocks[1].parsed).toBeDefined();
        expect(c.blocks[1].prefilter.level).toBe(2);
    });

    it('lists commands under a prefix', () => {
        const { commands } = resolveCustomCommands([
            { key: 'a', type: 'alltodo' }, { key: 'g' }, { key: 'gw', type: 'alltodo' }, { key: 'gh', type: 'alltodo' },
        ]);
        expect(commandsUnderPrefix(commands, '').map(c => c.key)).toEqual(['a', 'g']);
        expect(commandsUnderPrefix(commands, 'g').map(c => c.key)).toEqual(['gw', 'gh']);
    });
});

describe('resolveStartDay', () => {
    it('resolves names, offsets and dates', () => {
        expect(resolveStartDay(undefined, NOW)).toEqual(new Date(2026, 9, 17));
        expect(resolveStartDay('monday', NOW)).toEqual(new Date(2026, 9, 12));
        expect(resolveStartDay('-1d', NOW)).toEqual(new Date(2026, 9, 16));
        expect(resolveStartDay('+7', NOW)).toEqual(new Date(2026, 9, 24));
        expect(resolveStartDay('2026-11-01', NOW)).toEqual(new Date(2026, 10, 1));
        expect(resolveStartDay('someday', NOW)).toBeUndefined();
    });
});

describe('sortItems', () => {
    const a = item({ title: 'b', priority: 'C', category: 'home', properties: { EFFORT: '2h' } });
    const b = item({ title: 'a', priority: 'A', category: 'work', deadline: new Date(2026, 9, 20) });
    const c = item({ title: 'c', category: 'home', deadline: new Date(2026, 9, 18), properties: { Effort: '0:30' } });

    it('sorts by priority, highest first for priority-down', () => {
        expect(sortItems([a, b, c], ['priority-down']).map(i => i.title)).toEqual(['a', 'c', 'b']);
        expect(sortItems([a, b, c], ['priority-up']).map(i => i.title)).toEqual(['b', 'c', 'a']);
    });

    it('puts missing dates and efforts last', () => {
        expect(sortItems([a, b, c], ['deadline-up']).map(i => i.title)).toEqual(['c', 'a', 'b']);
        expect(sortItems([a, b, c], ['effort-up']).map(i => i.title)).toEqual(['c', 'b', 'a']);
    });

    it('keeps category order of first appearance, then applies later keys', () => {
        expect(sortItems([a, b, c], ['category-keep', 'alpha-up']).map(i => i.title)).toEqual(['b', 'c', 'a']);
    });

    it('is stable and a no-op without a strategy', () => {
        expect(sortItems([a, b, c], undefined)).toEqual([a, b, c]);
        expect(sortItems([a, c], ['level-up'])).toEqual([a, c]);
    });

    it('orders TODO states by the given keyword order', () => {
        const next = item({ title: 'n', todoState: 'NEXT' });
        const todo = item({ title: 't', todoState: 'TODO' });
        expect(sortItems([next, todo], ['todo-state-up'], ['TODO', 'NEXT']).map(i => i.title)).toEqual(['t', 'n']);
    });
});

describe('groupList', () => {
    it('groups by TODO state and by tag', () => {
        const items = [item({ todoState: 'TODO', tags: ['x'] }), item({ todoState: 'NEXT' }), item({ todoState: 'TODO' })];
        expect(groupList(items, 'todo', 'H').map(g => [g.label, g.items.length])).toEqual([['TODO', 2], ['NEXT', 1]]);
        expect(groupList(items, 'tag', 'H').map(g => g.label)).toEqual(['x', 'Untagged']);
        expect(groupList(items, undefined, 'H')).toEqual([{ label: 'H', key: 'all', items }]);
    });
});

describe('parseSearchWords', () => {
    it('splits required, excluded and regex terms', () => {
        const s = parseSearchWords('budget +grant -draft {^\\*+ TODO} "two words"');
        expect(s.required).toEqual(['budget', 'grant', 'two words']);
        expect(s.excluded).toEqual(['draft']);
        expect(s.regexes).toHaveLength(1);
        expect(parseSearchWords('{[}').error).toBeDefined();
    });
});

describe('entryText', () => {
    it('stops at the next heading of any level', () => {
        const text = '* One\nbody 1\n** Two\nbody 2\n* Three';
        expect(entryText(text, 1)).toBe('* One\nbody 1');
        expect(entryText(text, 3)).toBe('** Two\nbody 2');
    });
});

describe('shouldSkip', () => {
    const block = (skip: ResolvedBlock['skip'], extra: Partial<ResolvedBlock> = {}) =>
        ({ type: 'alltodo', header: '', prefilter: {}, keywords: [], skip, ...extra }) as ResolvedBlock;
    const source = { readFile: async () => '* TODO Task\nwaiting on Bob\n* Next' };
    const run = (i: AgendaItem, b: ResolvedBlock) => shouldSkip(i, b, source, new Map());

    it('skips by planning dates', async () => {
        expect(await run(item({ scheduled: NOW }), block({ scheduled: true }))).toBe(true);
        expect(await run(item(), block({ scheduled: true }))).toBe(false);
        expect(await run(item(), block({ notDeadline: true }))).toBe(true);
    });

    it('skips by state, with todo/done as classes', async () => {
        expect(await run(item({ todoState: 'WAITING' }), block({ todo: ['WAITING'] }))).toBe(true);
        expect(await run(item({ todoState: 'DONE', isDone: true }), block({ todo: ['done'] }))).toBe(true);
        expect(await run(item({ todoState: 'NEXT' }), block({ notTodo: ['TODO'] }))).toBe(true);
    });

    it('skips by own or inherited tags', async () => {
        expect(await run(item({ inheritedTags: ['someday'] }), block({ tags: ['someday'] }))).toBe(true);
        expect(await run(item({ tags: ['work'] }), block({ notTags: ['home'] }))).toBe(true);
    });

    it('skips by a regex over the entry body', async () => {
        expect(await run(item(), block({ regexp: 'Bob' }, { skipRegexp: /Bob/m }))).toBe(true);
        expect(await run(item(), block({ notRegexp: 'Alice' }, { skipNotRegexp: /Alice/m }))).toBe(true);
        expect(await run(item(), block({ regexp: 'Next' }, { skipRegexp: /Next/m }))).toBe(false);
    });

    it('skips blocked entries', async () => {
        expect(await run(item({ blocked: true }), block({ blocked: true }))).toBe(true);
        expect(await run(item({ blocked: false }), block({ blocked: true }))).toBe(false);
    });
});

describe('formatCustomItem', () => {
    it('expands the prefix format', () => {
        const i = item({
            title: 'Call', todoState: 'TODO', priority: 'A', tags: ['phone'], category: 'work',
            time: '09:30', agendaType: 'scheduled', properties: { EFFORT: '1:15' },
        });
        expect(formatCustomItem(i, '%-8c %t %s %e')).toBe('work:    09:30 Scheduled: 1:15 TODO [#A] Call :phone:');
        expect(formatCustomItem(i, '%f ')).toBe('work.org TODO [#A] Call :phone:');
    });
});

function result(): CustomCommandResult {
    const { commands } = resolveCustomCommands([{
        key: 'w', description: 'Work <review>',
        blocks: [{ type: 'agenda', span: 1 }, { type: 'alltodo', header: 'All & sundry' }],
    }]);
    const dated = item({ title: 'Meet <boss>', todoState: 'TODO', scheduled: new Date(2026, 9, 17), time: '10:00', agendaType: 'scheduled', category: 'work' });
    const undated = item({ title: 'Read, "paper"', todoState: 'NEXT', line: 5 });
    return {
        command: commands[0],
        generatedAt: NOW,
        blocks: [
            {
                header: 'Agenda', block: commands[0].blocks[0], totalItems: 1,
                groups: [{ label: 'Today', key: '2026-10-17', items: [dated] }],
                dateRange: { start: new Date(2026, 9, 17), end: new Date(2026, 9, 18) },
            },
            {
                header: 'All & sundry', block: commands[0].blocks[1], totalItems: 1,
                groups: [{ label: 'All & sundry', key: 'all', items: [undated] }],
            },
        ],
    };
}

describe('rendering and export', () => {
    it('renders blocks into one buffer with a line map', () => {
        const r = renderCustomCommand(result());
        const lines = r.text.split('\n');
        expect(lines[0]).toBe('Work <review>   [w]');
        expect(lines).toContain('Today');
        expect(lines).toContain('All & sundry');
        expect(lines[lines.length - 1]).toBe('Total: 2 items');
        const mapped = [...r.lineMap.entries()].map(([n, i]) => [lines[n].trim(), i.title]);
        expect(mapped).toEqual([
            [expect.stringContaining('Meet <boss>'), 'Meet <boss>'],
            [expect.stringContaining('Read, "paper"'), 'Read, "paper"'],
        ]);
    });

    it('escapes HTML', () => {
        const html = customCommandToHtml(result());
        expect(html).toContain('Meet &lt;boss&gt;');
        expect(html).toContain('All &amp; sundry');
        expect(html).toContain('Read, &quot;paper&quot;');
        expect(html).not.toContain('<boss>');
    });

    it('writes dated entries to iCalendar', () => {
        const ics = customCommandToIcs(result());
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('DTSTART:20261017T100000');
        expect(ics).toContain('SUMMARY:S: TODO Meet <boss>');
        expect(ics).not.toContain('paper');
        expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    });

    it('picks the format from the file extension', () => {
        expect(exportCustomCommand(result(), 'a.HTML')).toMatch(/^<!DOCTYPE html>/);
        expect(exportCustomCommand(result(), 'a.ics')).toMatch(/^BEGIN:VCALENDAR/);
        expect(exportCustomCommand(result(), 'a.txt')).toMatch(/^Work <review>/);
        expect(JSON.parse(exportCustomCommand(result(), 'a.json'))).toHaveProperty('blocks');
    });

    it('serializes to JSON with snake_case fields', () => {
        const json = customCommandToJson(result()) as { blocks: { groups: { items: Record<string, unknown>[] }[] }[] };
        expect(json.blocks[0].groups[0].items[0]).toMatchObject({ title: 'Meet <boss>', scheduled: '2026-10-17', line_number: 1 });
    });
});
