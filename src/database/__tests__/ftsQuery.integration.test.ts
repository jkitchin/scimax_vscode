/**
 * Full-text search with text FTS5 would otherwise read as syntax, such as a
 * citation key (kitchin-2025-beyon-fourt gave "no such column: 2025"), and
 * findFilesContaining for exact substring lookups.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

const SETUP_TIMEOUT_MS = 60_000;

describe('full-text search with punctuation (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let a: string;
    let b: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-fts-'));
        a = path.join(dir, 'a.org');
        b = path.join(dir, 'b.org');
        fs.writeFileSync(a, '* Paper\nAs shown in cite:&kitchin-2025-beyon-fourt, it works.\n');
        fs.writeFileSync(b, '* Other\nNothing about fourier here, just c++ and e-mail.\n');
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(a);
        await db.indexFile(b);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('finds a hyphenated citation key instead of failing', async () => {
        const results = await db.searchFullText('kitchin-2025-beyon-fourt');
        expect(results.map(r => r.file_path)).toEqual([a]);
    });

    it('does not fail on other punctuation', async () => {
        for (const q of ['cite:&kitchin', 'c++', 'e-mail', '"unclosed', '(paren', 'a.b/c', 'neural AND', 'NEAR(a', '()', 'NOT', '"', 'title: (a OR b)', 'title:']) {
            await expect(db.searchFullText(q)).resolves.toBeDefined();
        }
    });

    it('still supports operators and prefixes', async () => {
        expect((await db.searchFullText('kitchin OR fourier')).length).toBe(2);
        expect((await db.searchFullText('kitch*')).map(r => r.file_path)).toEqual([a]);
        expect((await db.searchFullText('title:a.org')).map(r => r.file_path)).toEqual([a]);
    });

    it('findFilesContaining matches the exact key, ignoring case', async () => {
        expect(await db.findFilesContaining('Kitchin-2025-Beyon-Fourt')).toEqual([a]);
        expect(await db.findFilesContaining('kitchin-2025-beyon-fifth')).toEqual([]);
    });
});
