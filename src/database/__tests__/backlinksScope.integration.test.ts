/**
 * Back-links scoped to the target's file. [[Title]], [[*Title]] and
 * [[#custom-id]] only resolve within their own file, so a link in one file
 * must not count as a reference to a same-named heading in another; a
 * [[2025]] in a journal file was showing up on every "2025" heading.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

// Creating and indexing a database can pass vitest's 10 s hook limit on a slow CI runner (Windows)
const SETUP_TIMEOUT_MS = 60_000;

describe('back-links scoped to the target file (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let aPath: string;
    let bPath: string;
    let cPath: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-blscope-'));
        aPath = path.join(dir, 'a.org');
        bPath = path.join(dir, 'b.org');
        cPath = path.join(dir, 'c.org');

        fs.writeFileSync(aPath, [
            '* 2025',
            ':PROPERTIES:',
            ':CUSTOM_ID: year',
            ':ID: 22222222-2222-2222',
            ':END:',
            'A passage <<key-point>> here.',
            '* Notes',
            'Same file: [[2025]] and [[#year]].',
        ].join('\n'));

        fs.writeFileSync(bPath, [
            '* 2025',
            'Own heading: [[*2025]] and [[#year]].',
            'Other file by search: [[file:a.org::*2025]] and [[a.org::#year]].',
            'Other file by id: [[id:22222222-2222-2222]].',
            'Anchor in a: [[a.org::key-point]]; anchor in b: [[b.org::key-point]].',
        ].join('\n'));

        fs.writeFileSync(cPath, [
            '* Results',
            '#+BEGIN_SRC sh',
            'curl ...',
            '#+END_SRC',
            '',
            '#+RESULTS:',
            '| {"date-parts":[[2025]]} |',
        ].join('\n'));

        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        for (const p of [aPath, bPath, cPath]) await db.indexFile(p);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Windows can hold the SQLite file briefly after close; best-effort.
        }
    });

    const where = (rows: { file_path: string; line_number: number }[]) =>
        rows.map(r => `${path.basename(r.file_path)}:${r.line_number}`);

    it('counts title and CUSTOM_ID links in the heading\'s file and file:: links naming it', async () => {
        const back = await db.getHeadingBacklinks({ title: '2025', customId: 'year', filePath: aPath });
        // a.org:8 holds [[2025]] and [[#year]]; b.org:3 holds file:a.org::*2025 and a.org::#year.
        expect(where(back)).toEqual(['a.org:8', 'a.org:8', 'b.org:3', 'b.org:3']);
    });

    it('does not lend one file\'s [[*2025]] / [[#year]] to another file\'s heading', async () => {
        const back = await db.getHeadingBacklinks({ title: '2025', customId: 'year', filePath: bPath });
        expect(where(back)).toEqual(['b.org:2', 'b.org:2']);
    });

    it('matches [[id:...]] links from any file', async () => {
        const back = await db.getHeadingBacklinks({ id: '22222222-2222-2222', filePath: aPath });
        expect(where(back)).toEqual(['b.org:4']);
    });

    it('does not index fuzzy links inside #+RESULTS: output', async () => {
        const back = await db.getHeadingBacklinks({ title: '2025' });
        expect(back.some(r => r.file_path === cPath)).toBe(false);
    });

    it('counts file::anchor links only when they name the anchor\'s file', async () => {
        expect(where(await db.getAnchorBacklinks('key-point', aPath))).toEqual(['b.org:5']);
        expect(where(await db.getAnchorBacklinks('key-point', cPath))).toEqual([]);
        // Unscoped, both ::key-point links match.
        expect(await db.getAnchorBacklinks('key-point')).toHaveLength(2);
    });
});
