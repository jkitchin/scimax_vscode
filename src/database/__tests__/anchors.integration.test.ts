/**
 * End-to-end test for granular addressing: index real org files and verify the
 * anchors table, cross-file anchor resolution, and object-level back-links.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

describe('granular addressing (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let aPath: string;
    let bPath: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-anchors-'));
        aPath = path.join(dir, 'a.org');
        bPath = path.join(dir, 'b.org');

        fs.writeFileSync(aPath, [
            '* Design notes',
            'Here is a key passage <<why-sqlite>> worth pointing at.',
            '',
            '#+NAME: results-table',
            '| x | y |',
            '|---+---|',
            '| 1 | 2 |',
            '',
            '* Glossary',
            'A <<<dynamic knowledge repository>>> is a living base.',
        ].join('\n'));

        fs.writeFileSync(bPath, [
            '* Review',
            'See the rationale at [[why-sqlite]] for the choice.',
            'Also the table [[a.org::results-table]] is relevant.',
        ].join('\n'));

        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(aPath);
        await db.indexFile(bPath);
    });

    afterAll(async () => {
        await db.close?.();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('resolves a dedicated target to its file and line', async () => {
        const hit = await db.resolveAnchor('why-sqlite');
        expect(hit).not.toBeNull();
        expect(hit!.file_path).toBe(aPath);
        expect(hit!.line_number).toBe(2);
        expect(hit!.kind).toBe('target');
    });

    it('resolves a #+NAME anchor', async () => {
        const hit = await db.resolveAnchor('results-table');
        expect(hit).not.toBeNull();
        expect(hit!.kind).toBe('name');
        expect(hit!.file_path).toBe(aPath);
    });

    it('resolves a radio target (case-insensitive)', async () => {
        const hit = await db.resolveAnchor('Dynamic Knowledge Repository');
        expect(hit).not.toBeNull();
        expect(hit!.kind).toBe('radio');
    });

    it('finds object-level back-links to an anchor from another file', async () => {
        const back = await db.getAnchorBacklinks('why-sqlite');
        expect(back.length).toBeGreaterThanOrEqual(1);
        expect(back.some(b => b.file_path === bPath)).toBe(true);
    });

    it('matches ::-suffixed links back to the NAME anchor', async () => {
        const back = await db.getAnchorBacklinks('results-table');
        expect(back.some(b => b.file_path === bPath)).toBe(true);
    });

    it('re-indexing after deleting the anchor orphans the link', async () => {
        // Remove the <<why-sqlite>> anchor from a.org and re-index.
        fs.writeFileSync(aPath, '* Design notes\nThe passage no longer has an anchor.\n');
        await db.indexFile(aPath);

        const hit = await db.resolveAnchor('why-sqlite');
        expect(hit).toBeNull(); // gone from the index → link is detectably orphaned
    });
});
