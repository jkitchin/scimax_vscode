/**
 * End-to-end test for heading back-links: index real files and verify that
 * getHeadingBacklinks finds links targeting a heading by CUSTOM_ID, ID, and
 * fuzzy title.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

// Creating and indexing a database can pass vitest's 10 s hook limit on a slow CI runner (Windows)
const SETUP_TIMEOUT_MS = 60_000;

describe('heading back-links (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let aPath: string;
    let bPath: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-hbl-'));
        aPath = path.join(dir, 'a.org');
        bPath = path.join(dir, 'b.org');

        fs.writeFileSync(aPath, [
            '* Storage layer',
            ':PROPERTIES:',
            ':CUSTOM_ID: storage',
            ':ID: 11111111-1111-1111',
            ':END:',
            'Body text.',
        ].join('\n'));

        fs.writeFileSync(bPath, [
            '* Review',
            'By custom id [[#storage]].',
            'By title [[Storage layer]].',
            'By id [[id:11111111-1111-1111]].',
        ].join('\n'));

        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(aPath);
        await db.indexFile(bPath);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Windows can hold the SQLite file briefly after close; best-effort.
        }
    });

    it('finds a back-link by CUSTOM_ID', async () => {
        const back = await db.getHeadingBacklinks({ customId: 'storage' });
        expect(back.some(b => b.file_path === bPath)).toBe(true);
    });

    it('finds a back-link by fuzzy title', async () => {
        const back = await db.getHeadingBacklinks({ title: 'Storage layer' });
        expect(back.some(b => b.file_path === bPath)).toBe(true);
    });

    it('finds a back-link by ID', async () => {
        const back = await db.getHeadingBacklinks({ id: '11111111-1111-1111' });
        expect(back.some(b => b.file_path === bPath)).toBe(true);
    });

    it('combines all identifiers and returns the matching links', async () => {
        const back = await db.getHeadingBacklinks({
            title: 'Storage layer',
            customId: 'storage',
            id: '11111111-1111-1111',
        });
        expect(back.length).toBeGreaterThanOrEqual(3);
        expect(back.every(b => b.file_path === bPath)).toBe(true);
    });

    it('batches anchors and headings, one result list per target, like the single lookups', async () => {
        const targets = [
            { kind: 'heading' as const, customId: 'storage' },
            { kind: 'heading' as const, title: 'Storage layer' },
            { kind: 'heading' as const, title: 'Nonexistent' },
            { kind: 'anchor' as const, text: 'nothing here' },
        ];
        const batch = await db.getBacklinksBatch(targets);
        expect(batch).toHaveLength(4);
        expect(batch[0]).toEqual(await db.getHeadingBacklinks({ customId: 'storage' }));
        expect(batch[1]).toEqual(await db.getHeadingBacklinks({ title: 'Storage layer' }));
        expect(batch[1].map(b => b.line_number)).toEqual([3]);
        expect(batch[2]).toEqual([]);
        expect(batch[3]).toEqual([]);
        expect(await db.getBacklinksBatch([])).toEqual([]);
    });

    it('looks link targets up by index rather than scanning the links table', async () => {
        // A scan per heading made opening a long org file stall the extension host.
        const client = (db as any).db;
        const plan = async (where: string) => (await client.execute({
            sql: `EXPLAIN QUERY PLAN SELECT l.id FROM links l WHERE ${where}`, args: ['x'],
        })).rows.map((r: any) => r.detail).join(' ');
        expect(await plan('lower(trim(l.raw_target)) IN (?)')).toContain('idx_links_target_key');
        expect(await plan(`instr(l.raw_target, '::') > 0 AND lower(trim(substr(l.raw_target, instr(l.raw_target, '::') + 2))) IN (?)`))
            .toContain('idx_links_target_suffix');
    });

    it('returns nothing for an unknown heading', async () => {
        const back = await db.getHeadingBacklinks({ title: 'Nonexistent', customId: 'nope' });
        expect(back).toEqual([]);
    });
});
