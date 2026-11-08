/**
 * searchHeadingsFiltered (the search view's headings mode: title words, tags
 * with inheritance, properties) and getFileCountsByFolder (the database view).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

const SETUP_TIMEOUT_MS = 60_000;

describe('searchHeadingsFiltered (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let a: string;
    let b: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-hf-'));
        fs.mkdirSync(path.join(dir, 'sub'));
        a = path.join(dir, 'a.org');
        b = path.join(dir, 'sub', 'b.org');
        fs.writeFileSync(a, [
            '* Catalysis project                :work:',
            ':PROPERTIES:',
            ':STATUS: Draft v2',
            ':END:',
            '** Literature on oxides',
            '** Notes_100% done                 :home:',
            '* Garden plans                     :home:',
            '',
        ].join('\n'));
        fs.writeFileSync(b, [
            '* Oxide synthesis                  :work:lab:',
            ':PROPERTIES:',
            ':AUTHOR: me',
            ':END:',
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(dir, 'c.org'), [
            '#+TODO: TODO WAIT | SHIPPED',
            '* TODO Write report',
            '* WAIT Hear back',
            '* SHIPPED Release',
            '* DONE Old item',
            '* Plain heading',
            '',
        ].join('\n'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(a);
        await db.indexFile(b);
        await db.indexFile(path.join(dir, 'c.org'));
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    const titles = (hs: Array<{ title: string }>) => hs.map(h => h.title).sort();

    it('returns nothing with no criteria', async () => {
        expect(await db.searchHeadingsFiltered({})).toEqual([]);
    });

    it('matches every title word, ignoring case', async () => {
        expect(titles(await db.searchHeadingsFiltered({ terms: ['OXIDE'] }))).toEqual(['Literature on oxides', 'Oxide synthesis']);
        expect(titles(await db.searchHeadingsFiltered({ terms: ['oxide', 'synth'] }))).toEqual(['Oxide synthesis']);
    });

    it('treats LIKE wildcards in terms literally', async () => {
        expect(titles(await db.searchHeadingsFiltered({ terms: ['100%'] }))).toEqual(['Notes_100% done']);
        expect(await db.searchHeadingsFiltered({ terms: ['Not_s'] })).toEqual([]);
    });

    it('filters by own and inherited tags', async () => {
        expect(titles(await db.searchHeadingsFiltered({ requiredTags: ['work'] }))).toEqual(
            ['Catalysis project', 'Literature on oxides', 'Notes_100% done', 'Oxide synthesis']);
        expect(titles(await db.searchHeadingsFiltered({ requiredTags: ['work'], excludedTags: ['home', 'lab'] }))).toEqual(
            ['Catalysis project', 'Literature on oxides']);
    });

    it('filters by property key and value', async () => {
        expect(titles(await db.searchHeadingsFiltered({ properties: [{ key: 'status', value: 'draft' }] }))).toEqual(['Catalysis project']);
        expect(titles(await db.searchHeadingsFiltered({ properties: [{ key: 'AUTHOR' }] }))).toEqual(['Oxide synthesis']);
        expect(await db.searchHeadingsFiltered({ properties: [{ key: 'STATUS', value: 'final' }] })).toEqual([]);
    });

    it('combines terms, tags and properties', async () => {
        expect(titles(await db.searchHeadingsFiltered({ terms: ['oxide'], requiredTags: ['lab'], properties: [{ key: 'AUTHOR' }] }))).toEqual(['Oxide synthesis']);
    });

    it('filters by TODO state, any open and any done', async () => {
        const done = ['DONE'];
        expect(titles(await db.searchHeadingsFiltered({ todoStates: ['WAIT'], doneStates: done }))).toEqual(['Hear back']);
        expect(titles(await db.searchHeadingsFiltered({ todoStates: ['@open'], doneStates: done }))).toEqual(['Hear back', 'Write report']);
        expect(titles(await db.searchHeadingsFiltered({ todoStates: ['@done'], doneStates: done }))).toEqual(['Old item', 'Release']);
        expect(titles(await db.searchHeadingsFiltered({ todoStates: ['TODO', 'SHIPPED'], doneStates: done }))).toEqual(['Release', 'Write report']);
    });

    it('drops excluded TODO states', async () => {
        expect(titles(await db.searchHeadingsFiltered({ todoStates: ['@open'], excludedTodoStates: ['WAIT'], doneStates: ['DONE'] })))
            .toEqual(['Write report']);
        expect(titles(await db.searchHeadingsFiltered({ terms: ['e'], excludedTodoStates: ['@done'], doneStates: ['DONE'] })))
            .not.toContain('Release');
    });

    it('counts TODO states', async () => {
        const counts = await db.getTodoStateCounts();
        expect(counts).toEqual(expect.arrayContaining([
            expect.objectContaining({ state: 'WAIT', count: 1 }),
            expect.objectContaining({ state: 'SHIPPED', count: 1, done: true }),
        ]));
    });

    it('counts files by folder', async () => {
        const counts = await db.getFileCountsByFolder();
        expect(counts).toEqual(expect.arrayContaining([
            { folder: dir, files: 2 },
            { folder: path.join(dir, 'sub'), files: 1 },
        ]));
    });
});
