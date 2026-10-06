import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
    window: {}, workspace: {}, commands: {}, languages: {}, Uri: {},
    EventEmitter: class {}, ThemeIcon: class {}, TreeItem: class {}, ThemeColor: class {},
    TreeItemCollapsibleState: {}, QuickPickItemKind: {}, Position: class {}, Range: class {}, Selection: class {},
}));

import { findProjectRootFor } from '../commands';

describe('findProjectRootFor', () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'projroot-')));
        // tmp/repo/.git, tmp/repo/sub/.projectile, tmp/known/notes, tmp/loose
        fs.mkdirSync(path.join(tmp, 'repo', '.git'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'repo', 'docs'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'repo', 'sub', 'deep'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'repo', 'sub', '.projectile'), '');
        fs.mkdirSync(path.join(tmp, 'known', 'notes'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'loose'), { recursive: true });
    });
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('finds the nearest .git or .projectile directory above the file', () => {
        expect(findProjectRootFor(path.join(tmp, 'repo', 'docs', 'a.org'), [])).toBe(path.join(tmp, 'repo'));
        expect(findProjectRootFor(path.join(tmp, 'repo', 'sub', 'deep', 'b.org'), [])).toBe(path.join(tmp, 'repo', 'sub'));
    });

    it('treats a known project as a root even without markers', () => {
        expect(findProjectRootFor(path.join(tmp, 'known', 'notes', 'c.org'), [path.join(tmp, 'known')])).toBe(path.join(tmp, 'known'));
    });

    it('returns undefined outside any project', () => {
        // tmpdir itself could sit inside a repo on some machines; only assert when it does not.
        const outside = findProjectRootFor(path.join(tmp, 'loose', 'd.org'), []);
        if (outside !== undefined) expect(tmp.startsWith(outside)).toBe(true);
    });
});
