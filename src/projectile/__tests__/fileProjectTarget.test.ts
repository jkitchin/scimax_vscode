import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
    window: {}, workspace: {}, commands: {}, languages: {}, Uri: {},
    EventEmitter: class {}, ThemeIcon: class {}, TreeItem: class {}, ThemeColor: class {},
    TreeItemCollapsibleState: {}, QuickPickItemKind: {}, Position: class {}, Range: class {}, Selection: class {},
}));
vi.mock('../../dired/diredPanel', () => ({ DiredPanel: {} }));

import { fileProjectTarget, findProjectRootForDir } from '../commands';

describe('fileProjectTarget (C-c p .)', () => {
    it('uses the dired entry at point and remembers the listing', () => {
        expect(fileProjectTarget({ path: '/p/src/a.ts', directory: '/p/src' },
            { scheme: 'file', fsPath: '/q/b.ts', line: 4 }))
            .toEqual({ file: '/p/src/a.ts', line: 0, dired: '/p/src' });
    });

    it('falls back to the active file and its line', () => {
        expect(fileProjectTarget(undefined, { scheme: 'file', fsPath: '/q/b.ts', line: 4 }))
            .toEqual({ file: '/q/b.ts', line: 4 });
    });

    it('is undefined for a non-file editor and no dired', () => {
        expect(fileProjectTarget(undefined, { scheme: 'untitled', fsPath: 'x', line: 0 })).toBeUndefined();
        expect(fileProjectTarget(undefined, undefined)).toBeUndefined();
    });
});

describe('findProjectRootForDir', () => {
    it('counts the directory itself as a project root', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-proj-'));
        try {
            fs.writeFileSync(path.join(root, '.projectile'), '');
            fs.mkdirSync(path.join(root, 'sub'));
            expect(findProjectRootForDir(root, [])).toBe(root);
            expect(findProjectRootForDir(path.join(root, 'sub'), [])).toBe(root);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
