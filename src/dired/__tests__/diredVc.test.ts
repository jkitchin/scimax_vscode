/**
 * Tests for the git side of dired: the status column, marking by state,
 * and the vc-dir listing of a repository's changed files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: vi.fn(() => ({
            get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
        })),
    },
    Uri: { file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }) },
    window: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
    },
}));

import { DiredManager } from '../diredManager';
import { runGit } from '../../vc/vcManager';

const git = (repo: string, ...args: string[]) => runGit(args, repo);

function write(repo: string, rel: string, content: string): void {
    const file = path.join(repo, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

describe('dired with git', () => {
    let repo: string;
    let manager: DiredManager;

    beforeEach(async () => {
        repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-diredvc-')));
        await git(repo, 'init', '-q', '-b', 'main');
        await git(repo, 'config', 'user.name', 'Test');
        await git(repo, 'config', 'user.email', 'test@example.com');
        await git(repo, 'config', 'commit.gpgsign', 'false');
        write(repo, 'a.txt', 'a\n');
        write(repo, 'b.txt', 'b\n');
        write(repo, 'c.txt', 'c\n');
        write(repo, 'sub/d.txt', 'd\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'init');
        write(repo, 'a.txt', 'a2\n');
        write(repo, 'b.txt', 'b2\n');
        write(repo, 'new.txt', 'n\n');
        fs.rmSync(path.join(repo, 'sub', 'd.txt'));
        manager = new DiredManager(repo);
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    const byName = () => Object.fromEntries(manager.getState().entries.map((e) => [e.name, e]));

    it('shows a git status column inside a repository', async () => {
        await manager.loadDirectory();
        const state = manager.getState();
        expect(state.vcColumn).toBe(true);
        const entries = byName();
        expect(entries['a.txt'].vc?.label).toBe('edited');
        expect(entries['new.txt'].vc?.state).toBe('untracked');
        expect(entries['c.txt'].vc).toBeUndefined();
    });

    it('has no status column outside a repository', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-norepo-'));
        try {
            await manager.loadDirectory(outside);
            expect(manager.getState().vcColumn).toBe(false);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('marks files by state, and the state of the file at point', async () => {
        await manager.loadDirectory();
        expect(manager.markByVcState('edited')).toBe(2);
        expect(manager.getMarkedEntries().map((e) => e.name).sort()).toEqual(['a.txt', 'b.txt']);
        manager.unmarkAll();

        const names = manager.getState().entries.map((e) => e.name);
        manager.selectIndex(names.indexOf('new.txt'));
        expect(manager.markByVcState('current')).toBe(1);
        manager.selectIndex(names.indexOf('c.txt'));
        expect(manager.markByVcState('current')).toBe(-1);
    });

    it('keeps marks when the listing is refreshed', async () => {
        await manager.loadDirectory();
        manager.markByVcState('edited');
        await manager.loadDirectory();
        expect(manager.getMarkedEntries().map((e) => e.name).sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('lists the changed files of the whole repository in vc-dir', async () => {
        await manager.loadVcDir(path.join(repo, 'sub'));
        const state = manager.getState();
        expect(state.vcDir).toBe(repo);
        expect(state.vcInfo).toMatch(/^On branch main/);
        const entries = byName();
        expect(Object.keys(entries).sort()).toEqual(['a.txt', 'b.txt', 'new.txt', 'sub/d.txt']);
        expect(entries['sub/d.txt'].missing).toBe(true);
        expect(entries['sub/d.txt'].vc?.label).toBe('removed');
        expect(entries['a.txt'].path).toBe(path.join(repo, 'a.txt'));

        // A refresh stays in vc-dir; ^ goes back to dired at the repository
        await manager.loadDirectory();
        expect(manager.getState().vcDir).toBe(repo);
        await manager.navigateToParent();
        expect(manager.getState().vcDir).toBeUndefined();
        expect(manager.getState().currentDirectory).toBe(repo);
    });

    it('refuses vc-dir outside a repository', async () => {
        await expect(manager.loadVcDir(os.tmpdir())).rejects.toThrow(/not in a git repository/);
    });
});
