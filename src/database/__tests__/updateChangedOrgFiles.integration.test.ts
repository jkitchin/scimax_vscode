/**
 * updateChangedOrgFiles: the agenda's check for files changed on disk since
 * they were indexed (e.g. synced from another machine).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

// Creating and indexing a database can pass vitest's 10 s hook limit on a slow CI runner (Windows)
const SETUP_TIMEOUT_MS = 60_000;

describe('updateChangedOrgFiles (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;

    const write = (name: string, content: string, mtime?: Date) => {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        if (mtime) fs.utimesSync(file, mtime, mtime);
        return file;
    };
    const todos = async () => (await db.getTodos()).map(h => h.title).sort();

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-changed-'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
    }, SETUP_TIMEOUT_MS);

    afterEach(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('re-indexes changed files and leaves unchanged ones alone', async () => {
        const past = new Date(Date.now() - 60_000);
        const a = write('a.org', '* TODO Old task\n', past);
        const b = write('b.org', '* TODO Untouched\n', past);
        await db.indexFile(a);
        await db.indexFile(b);

        write('a.org', '* TODO New task from another machine\n');
        const result = await db.updateChangedOrgFiles();

        expect(result).toEqual({ checked: 2, reindexed: 1, removed: 0 });
        expect(await todos()).toEqual(['New task from another machine', 'Untouched']);
        expect((await db.updateChangedOrgFiles()).reindexed).toBe(0);
    }, SETUP_TIMEOUT_MS);

    it('drops deleted files, but not ones whose folder is gone', async () => {
        const a = write('a.org', '* TODO Deleted\n');
        const b = write('sub/b.org', '* TODO Folder unavailable\n');
        await db.indexFile(a);
        await db.indexFile(b);

        fs.unlinkSync(a);
        fs.rmSync(path.join(dir, 'sub'), { recursive: true });
        const result = await db.updateChangedOrgFiles();

        expect(result.removed).toBe(1);
        expect(await todos()).toEqual(['Folder unavailable']);
    }, SETUP_TIMEOUT_MS);
});
