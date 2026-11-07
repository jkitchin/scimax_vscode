import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forcedFiles, underRoots, settingsPath, samePath } from '../indexScope';
import { isExcludedPath } from '../ignorePatterns';
import { ScimaxDbCore } from '../../database/scimaxDbCore';

describe('indexScope', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-scope-'));
        fs.mkdirSync(path.join(dir, 'notes'));
        fs.mkdirSync(path.join(dir, 'archive'));
        fs.writeFileSync(path.join(dir, 'notes', 'a.org'), '* a\n');
        fs.writeFileSync(path.join(dir, 'archive', 'keep.org'), '* TODO keep\n');
        fs.writeFileSync(path.join(dir, 'archive', 'old.org'), '* TODO old\n');
    });
    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a db open */ }
    });

    it('underRoots: inside a folder root, equal to a file root, not a look-alike prefix', () => {
        const roots = [path.join(dir, 'notes'), path.join(dir, 'archive', 'keep.org')];
        expect(underRoots(path.join(dir, 'notes', 'a.org'), roots)).toBe(true);
        expect(underRoots(path.join(dir, 'archive', 'keep.org'), roots)).toBe(true);
        expect(underRoots(path.join(dir, 'archive', 'old.org'), roots)).toBe(false);
        expect(underRoots(path.join(dir, 'notes2', 'x.org'), roots)).toBe(false);
    });

    it('forcedFiles: the include entries that are existing files', () => {
        const include = [path.join(dir, 'notes'), path.join(dir, 'archive', 'keep.org'), path.join(dir, 'missing.org'), dir + '/*.org'];
        expect(forcedFiles(include)).toEqual([path.join(dir, 'archive', 'keep.org')]);
    });

    it('settingsPath writes ~ for the home directory; samePath reads it back', () => {
        const home = os.homedir(), f = path.join(home, 'Dropbox', 'x.org');
        expect(settingsPath(f)).toBe('~' + path.sep + path.join('Dropbox', 'x.org'));
        expect(samePath('~/Dropbox/x.org', f)).toBe(true);
        expect(samePath(f, f)).toBe(true);
        expect(samePath('~/Dropbox/*.org', f)).toBe(false);
    });

    it('a forced file beats an excluded folder, but not the built-in excludes', () => {
        const keep = path.join(dir, 'archive', 'keep.org'), old = path.join(dir, 'archive', 'old.org');
        const exclude = [path.join(dir, 'archive') + '/**'];
        const forced = new Set([keep]);
        expect(isExcludedPath(keep, exclude, forced)).toBe(false);
        expect(isExcludedPath(old, exclude, forced)).toBe(true);
        expect(isExcludedPath(keep, exclude)).toBe(true);           // not forced: excluded
        const nm = path.join(dir, 'node_modules', 'x.org');
        expect(isExcludedPath(nm, [], new Set([nm]))).toBe(true);   // built-in: always
    });

    it('indexFile indexes a forced file in an excluded folder and skips its neighbour', async () => {
        const keep = path.join(dir, 'archive', 'keep.org'), old = path.join(dir, 'archive', 'old.org');
        const db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db'), ignorePatterns: [path.join(dir, 'archive') + '/**'] });
        await db.initialize();
        try {
            db.setForcedFiles([keep]);
            await db.indexFile(keep);
            await db.indexFile(old);
            expect((await db.getFiles()).map(f => f.path)).toEqual([keep]);
            expect(await db.isIndexed(keep)).toBe(true);
            expect(await db.isIndexed(old)).toBe(false);
        } finally {
            await db.close();
        }
    });
});
