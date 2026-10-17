/**
 * Custom agenda commands end to end: org files indexed into a real database,
 * then each block type run through the shared database source.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import format from 'date-fns/format';
import addDays from 'date-fns/addDays';
import { ScimaxDbCore } from '../scimaxDbCore';
import { resolveCustomCommands, runCustomCommand, renderCustomCommand } from '../../parser/orgAgendaCustom';
import { createDbAgendaSource } from '../../parser/orgAgendaCustomSource';

// Creating and indexing a database can pass vitest's 10 s hook limit on a slow CI runner (Windows)
const SETUP_TIMEOUT_MS = 60_000;

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd EEE');

describe('custom agenda commands (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let work: string;
    let home: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-custom-agenda-'));
        work = path.join(dir, 'work.org');
        home = path.join(dir, 'home.org');
        fs.writeFileSync(work, [
            '* Projects                                  :work:',
            '** Grant proposal',
            '*** NEXT Draft the aims',
            `    SCHEDULED: <${day(0)}>`,
            '*** TODO [#A] Budget                        :money:',
            `    DEADLINE: <${day(2)}>`,
            '    waiting on the department',
            '** Website refresh',
            '*** WAITING Get photos',
            '** DONE Old project',
            '* TODO [#C] Inbox triage',
            ':PROPERTIES:',
            ':EFFORT: 0:30',
            ':CLIENT: Acme',
            ':END:',
        ].join('\n'));
        fs.writeFileSync(home, [
            '* TODO Fix the sink                         :chore:',
            `  SCHEDULED: <${day(1)}>`,
            '* TODO Plan the garden                      :someday:',
            '  seeds and compost',
        ].join('\n'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(work);
        await db.indexFile(home);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    const run = async (cmd: object) => {
        const { commands, problems } = resolveCustomCommands([{ key: 'x', ...cmd }]);
        expect(problems).toEqual([]);
        expect(commands[0].errors).toEqual([]);
        return runCustomCommand(commands[0], createDbAgendaSource(db));
    };
    const titles = async (cmd: object, blockIndex = 0) =>
        (await run(cmd)).blocks[blockIndex].groups.flatMap(g => g.items.map(i => i.title));

    it('tags-todo matches inherited tags', async () => {
        expect((await titles({ type: 'tags-todo', match: '+work' })).sort())
            .toEqual(['Budget', 'Draft the aims', 'Get photos']);
        expect(await titles({ type: 'tags-todo', match: '+work', inheritTags: false })).toEqual([]);
        expect(await titles({ type: 'tags-todo', match: '+work-money/!-WAITING' })).toEqual(['Draft the aims']);
    });

    it('tags matches headings without a TODO keyword, and properties', async () => {
        expect(await titles({ type: 'tags', match: 'LEVEL=2+work' })).toEqual(['Grant proposal', 'Website refresh']);
        expect(await titles({ type: 'tags', match: 'CLIENT="Acme"+EFFORT<1:00' })).toEqual(['Inbox triage']);
    });

    it('todo lists chosen keywords; alltodo sorts by priority', async () => {
        expect((await titles({ type: 'todo', match: 'NEXT|WAITING' })).sort()).toEqual(['Draft the aims', 'Get photos']);
        const all = await titles({ type: 'alltodo' });
        expect(all[0]).toBe('Budget');
        expect(all[all.length - 1]).toBe('Inbox triage');
        expect(all).not.toContain('Old project');
    });

    it('skip conditions drop entries', async () => {
        const t = await titles({ type: 'alltodo', skip: { scheduled: true, deadline: true, tags: ['someday'] } });
        expect(t.sort()).toEqual(['Get photos', 'Inbox triage']);
        expect(await titles({ type: 'alltodo', skip: { notRegexp: 'department' } })).toEqual(['Budget']);
    });

    it('search finds words in entry bodies', async () => {
        expect(await titles({ type: 'search', match: 'compost' })).toEqual(['Plan the garden']);
        expect(await titles({ type: 'search', match: 'the -garden -sink -aims' })).toEqual(['Budget']);
    });

    it('stuck lists projects with no next action', async () => {
        expect(await titles({ type: 'stuck' })).toEqual(['Website refresh']);
    });

    it('agenda blocks show dated entries, filtered by match', async () => {
        const r = await run({ blocks: [{ type: 'agenda', span: 3 }, { type: 'agenda', span: 3, match: '+chore' }] });
        expect(r.blocks[0].groups).toHaveLength(3);
        expect(r.blocks[0].groups[0].items.map(i => i.title)).toEqual(['Draft the aims']);
        expect(r.blocks[0].groups[1].items.map(i => i.title)).toEqual(['Fix the sink']);
        expect(r.blocks[1].totalItems).toBe(1);
    });

    it('restricts blocks to files', async () => {
        expect((await titles({ type: 'alltodo', files: [home] })).sort()).toEqual(['Fix the sink', 'Plan the garden']);
    });

    it('renders a composite view', async () => {
        const r = await run({ description: 'Daily', blocks: [{ type: 'agenda', span: 1 }, { type: 'stuck' }] });
        const out = renderCustomCommand(r);
        expect(out.text).toContain('Daily   [x]');
        expect(out.text).toContain('Stuck projects');
        expect(out.lineMap.size).toBe(2);
    });
});
