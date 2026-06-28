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
    });

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

    it('returns nothing for an unknown heading', async () => {
        const back = await db.getHeadingBacklinks({ title: 'Nonexistent', customId: 'nope' });
        expect(back).toEqual([]);
    });
});
