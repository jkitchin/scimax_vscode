/**
 * A deadline's warning period (`-2w`) brings it into getAgenda's window even
 * when the deadline itself falls after the cutoff; without one it does not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

const SETUP_TIMEOUT_MS = 60_000;

function ymd(daysFromToday: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('deadline warning periods in getAgenda (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-warning-'));
        const file = path.join(dir, 'tasks.org');
        fs.writeFileSync(file, [
            '* TODO Warned three weeks',
            `DEADLINE: <${ymd(20)} -3w>`,
            '* TODO Warned one week',
            `DEADLINE: <${ymd(20)} -1w>`,
            '* TODO No warning',
            `DEADLINE: <${ymd(20)}>`,
            '* TODO Due this week',
            `DEADLINE: <${ymd(3)}>`,
        ].join('\n'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(file);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    });

    it('includes a later deadline only when its warning starts before the cutoff', async () => {
        const items = await db.getAgenda({ before: ymd(7) });
        expect(items.map(i => i.heading.title).sort()).toEqual(['Due this week', 'Warned three weeks']);
        expect(items.find(i => i.heading.title === 'Warned three weeks')!.days_until).toBe(20);
    });
});
