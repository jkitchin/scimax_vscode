/**
 * End-to-end test that done-ness in the agenda follows each file's own #+TODO
 * line: index real files, then check getAgenda / todo_type.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

describe('per-file done keywords (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let planPath: string;
    let plainPath: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-todotype-'));
        planPath = path.join(dir, 'plan.org');
        plainPath = path.join(dir, 'plain.org');

        fs.writeFileSync(planPath, [
            '#+todo: TODO NEXT WAITING | DONE CANCELED ABANDONED',
            '* CANCELED Kareem first paper on REE separation',
            'CLOSED: [2026-08-31 Mon 06:45] DEADLINE: <2026-08-15 Sat>',
            '* ABANDONED Old idea',
            'DEADLINE: <2026-08-01 Sat>',
            '* NEXT Collect contributions',
            'DEADLINE: <2026-08-10 Mon>',
        ].join('\n'));

        fs.writeFileSync(plainPath, [
            '* CANCELLED Default spelling',
            'SCHEDULED: <2026-08-02 Sun>',
            '* TODO Still open',
            'SCHEDULED: <2026-08-03 Mon>',
        ].join('\n'));

        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(planPath);
        await db.indexFile(plainPath);
    });

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('stores todo_type from the file\'s #+TODO line', async () => {
        const todos = await db.getTodos();
        const byTitle = Object.fromEntries(todos.map(h => [h.title, h.todo_type]));
        expect(byTitle['Kareem first paper on REE separation']).toBe('done');
        expect(byTitle['Old idea']).toBe('done');
        expect(byTitle['Collect contributions']).toBe('todo');
        expect(byTitle['Default spelling']).toBe('done');
        expect(byTitle['Still open']).toBe('todo');
    });

    it('leaves done headings out of the agenda', async () => {
        const items = await db.getAgenda({ includeUnscheduled: true });
        expect(items.map(i => i.heading.title).sort()).toEqual(['Collect contributions', 'Still open']);
    });

    it('still honours an explicit doneStates list', async () => {
        const items = await db.getAgenda({ doneStates: ['NEXT'] });
        expect(items.map(i => i.heading.title)).toEqual(['Still open']);
    });
});
