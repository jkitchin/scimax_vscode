/**
 * Tests for version control on filesets (dired marks, Explorer multi-select,
 * vc-dir), run against real git repositories in temp directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    commitChanges,
    commitPaths,
    decideFilesetAction,
    directoryVcStatus,
    diffStatPaths,
    FilesetEntry,
    getFilesetStatus,
    locateInRepo,
    parsePorcelain,
    pathsLog,
    repoChanges,
    revertPaths,
    runGit,
    stagePaths,
    stagedFiles,
    unstagePaths,
    vcStatusLabel,
} from '../vcManager';

async function git(repo: string, ...args: string[]): Promise<string> {
    return runGit(args, repo);
}

async function makeRepo(): Promise<string> {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-vcset-')));
    await git(dir, 'init', '-q', '-b', 'main');
    await git(dir, 'config', 'user.name', 'Test');
    await git(dir, 'config', 'user.email', 'test@example.com');
    await git(dir, 'config', 'commit.gpgsign', 'false');
    await git(dir, 'config', 'core.autocrlf', 'false');
    return dir;
}

function write(repo: string, rel: string, content: string): string {
    const file = path.join(repo, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
}

const entry = (rel: string, code: string, state: FilesetEntry['state'], origRel?: string): FilesetEntry =>
    ({ path: '/r/' + rel, rel, code, state, origRel });

describe('pure fileset helpers', () => {
    it('parses porcelain -z records, including renames', () => {
        expect(parsePorcelain(' M b.txt\0R  c.txt\0a.txt\0?? d/\0')).toEqual([
            { code: ' M', rel: 'b.txt' },
            { code: 'R ', rel: 'c.txt', origRel: 'a.txt' },
            { code: '??', rel: 'd/' },
        ]);
        expect(parsePorcelain('')).toEqual([]);
    });

    it('labels status codes the way vc-dir does', () => {
        expect(vcStatusLabel(' M')).toBe('edited');
        expect(vcStatusLabel('M ')).toBe('edited, staged');
        expect(vcStatusLabel('MM')).toBe('edited, part staged');
        expect(vcStatusLabel('A ')).toBe('added, staged');
        expect(vcStatusLabel(' D')).toBe('removed');
        expect(vcStatusLabel('R ')).toBe('renamed, staged');
        expect(vcStatusLabel('??')).toBe('untracked');
        expect(vcStatusLabel('!!')).toBe('ignored');
        expect(vcStatusLabel('UU')).toBe('conflict');
        expect(vcStatusLabel('')).toBe('');
    });

    it('decides C-x v v on a fileset', () => {
        expect(decideFilesetAction([entry('a', '??', 'untracked'), entry('b', '??', 'untracked')]))
            .toEqual({ kind: 'register', rels: ['a', 'b'] });
        expect(decideFilesetAction([entry('a', ' M', 'edited'), entry('c', '', 'up-to-date'), entry('n', 'R ', 'edited', 'o')]))
            .toEqual({ kind: 'commit', rels: ['a', 'n', 'o'] });
        expect(decideFilesetAction([entry('a', ' M', 'edited')], { mergeInProgress: true }))
            .toEqual({ kind: 'commit-merge' });
        expect(decideFilesetAction([entry('a', 'UU', 'conflict'), entry('b', 'UU', 'conflict')]))
            .toEqual({ kind: 'resolve', rels: ['a', 'b'] });
        expect(decideFilesetAction([entry('a', 'UU', 'conflict'), entry('b', 'UU', 'conflict')], { withMarkers: new Set(['b']) }))
            .toEqual({ kind: 'fix-conflicts', rels: ['b'] });
        expect(decideFilesetAction([entry('a', '', 'up-to-date')])).toEqual({ kind: 'sync' });
        expect(decideFilesetAction([entry('a', '', 'up-to-date')], { mergeInProgress: true })).toEqual({ kind: 'commit-merge' });
        expect(decideFilesetAction([entry('a', ' M', 'edited'), entry('b', '??', 'untracked')]))
            .toEqual({ kind: 'mixed', groups: { edited: ['a'], untracked: ['b'] } });
    });
});

describe('filesets in a real repository', () => {
    let repo: string;

    beforeEach(async () => {
        repo = await makeRepo();
        write(repo, 'a.txt', 'a\n');
        write(repo, 'b.txt', 'b\n');
        write(repo, 'sub/c.txt', 'c\n');
        write(repo, '.gitignore', '*.log\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'init');
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('locates paths, including files that no longer exist', async () => {
        expect(await locateInRepo(path.join(repo, 'sub', 'c.txt'))).toEqual({ root: repo, displayRoot: repo, rel: 'sub/c.txt' });
        expect((await locateInRepo(path.join(repo, 'gone', 'x.txt')))?.rel).toBe('gone/x.txt');
        expect((await locateInRepo(repo))?.rel).toBe('');
        expect(await locateInRepo(os.tmpdir())).toBeUndefined();
    });

    it('reports named files and the changed files below named directories', async () => {
        write(repo, 'a.txt', 'a2\n');
        write(repo, 'sub/new.txt', 'n\n');
        write(repo, 'x.log', 'l\n');
        const status = await getFilesetStatus([
            path.join(repo, 'a.txt'), path.join(repo, 'b.txt'), path.join(repo, 'x.log'), path.join(repo, 'sub'),
        ]);
        expect(status.repoRoot).toBe(repo);
        const byRel = Object.fromEntries(status.entries.map((e) => [e.rel, e.state]));
        expect(byRel).toEqual({ 'a.txt': 'edited', 'sub/new.txt': 'untracked', 'b.txt': 'up-to-date', 'x.log': 'ignored' });
        expect(status.entries.find((e) => e.rel === 'a.txt')?.path).toBe(path.join(repo, 'a.txt'));
    });

    it('refuses to mix repositories and reports paths outside any', async () => {
        const other = await makeRepo();
        try {
            const status = await getFilesetStatus([path.join(repo, 'a.txt'), path.join(other, 'z.txt')]);
            expect(status.repos.sort()).toEqual([repo, other].sort());
            expect(status.repoRoot).toBeUndefined();
            const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-norepo-'));
            const none = await getFilesetStatus([path.join(outside, 'f.txt')]);
            expect(none.unregistered).toHaveLength(1);
            fs.rmSync(outside, { recursive: true, force: true });
        } finally {
            fs.rmSync(other, { recursive: true, force: true });
        }
    });

    it('commits exactly the named files and leaves other staged changes staged', async () => {
        write(repo, 'a.txt', 'a2\n');
        write(repo, 'b.txt', 'b2\n');
        write(repo, 'sub/c.txt', 'c2\n');
        await git(repo, 'add', 'sub/c.txt');
        const hash = await commitPaths(repo, 'two files', ['a.txt', 'b.txt']);
        expect(hash).toMatch(/^[0-9a-f]+$/);
        expect((await git(repo, 'show', '--name-only', '--format=', 'HEAD')).trim().split('\n').sort()).toEqual(['a.txt', 'b.txt']);
        expect(await stagedFiles(repo)).toEqual(['sub/c.txt']);
        expect(await diffStatPaths(repo, ['a.txt'])).toBe('');
    });

    it('commits a rename as one change', async () => {
        await git(repo, 'mv', 'a.txt', 'renamed.txt');
        const status = await getFilesetStatus([path.join(repo, 'renamed.txt')]);
        const action = decideFilesetAction(status.entries);
        expect(action).toEqual({ kind: 'commit', rels: ['renamed.txt', 'a.txt'] });
        await commitPaths(repo, 'rename', (action as { rels: string[] }).rels);
        expect((await git(repo, 'status', '--porcelain')).trim()).toBe('');
    });

    it('stages, unstages and registers files', async () => {
        write(repo, 'a.txt', 'a2\n');
        write(repo, 'new.txt', 'n\n');
        await stagePaths(repo, ['a.txt', 'new.txt']);
        expect((await stagedFiles(repo)).sort()).toEqual(['a.txt', 'new.txt']);
        await unstagePaths(repo, ['a.txt', 'new.txt']);
        expect(await stagedFiles(repo)).toEqual([]);
        expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a2\n');
    });

    it('reverts edits, deletions, additions and renames', async () => {
        write(repo, 'a.txt', 'a2\n');
        fs.rmSync(path.join(repo, 'b.txt'));
        write(repo, 'added.txt', 'n\n');
        await git(repo, 'add', 'added.txt');
        await git(repo, 'mv', 'sub/c.txt', 'sub/d.txt');
        const status = await getFilesetStatus([repo]);
        await revertPaths(repo, status.entries);
        expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a\n');
        expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(true);
        expect(fs.existsSync(path.join(repo, 'sub', 'c.txt'))).toBe(true);
        // The added file is unregistered but kept, like vc-revert
        expect(fs.existsSync(path.join(repo, 'added.txt'))).toBe(true);
        const left = (await git(repo, 'status', '--porcelain')).trim().split('\n').sort();
        expect(left).toEqual(['?? added.txt', '?? sub/d.txt']);
    });

    it('shows the history of a fileset and what each commit changed', async () => {
        write(repo, 'a.txt', 'a2\n');
        await commitPaths(repo, 'change a', ['a.txt']);
        write(repo, 'b.txt', 'b2\n');
        await commitPaths(repo, 'change b', ['b.txt']);
        const log = await pathsLog(repo, ['a.txt', 'sub']);
        expect(log.map((e) => e.subject)).toEqual(['change a', 'init']);
        expect(await commitChanges(repo, log[0].hash, ['a.txt', 'b.txt'])).toEqual([{ status: 'M', rel: 'a.txt' }]);
        // The root commit lists its files as added
        expect(await commitChanges(repo, log[1].hash, ['sub'])).toEqual([{ status: 'A', rel: 'sub/c.txt' }]);
    });

    it('summarizes a directory listing for the dired status column', async () => {
        write(repo, 'a.txt', 'a2\n');
        write(repo, 'new.txt', 'n\n');
        write(repo, 'x.log', 'l\n');
        write(repo, 'sub/c.txt', 'c2\n');
        write(repo, 'sub/more.log', 'l\n');
        write(repo, 'fresh/f.txt', 'f\n');
        const status = await directoryVcStatus(repo);
        expect(status?.get('a.txt')).toEqual({ state: 'edited', label: 'edited', code: ' M' });
        expect(status?.get('new.txt')?.state).toBe('untracked');
        expect(status?.get('x.log')?.state).toBe('ignored');
        expect(status?.get('sub')).toEqual({ state: 'edited', label: 'edited', code: '' });
        expect(status?.get('fresh')?.state).toBe('untracked');
        expect(status?.has('b.txt')).toBe(false);

        const sub = await directoryVcStatus(path.join(repo, 'sub'));
        expect([...sub!.keys()].sort()).toEqual(['c.txt', 'more.log']);
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-norepo-'));
        expect(await directoryVcStatus(outside)).toBeUndefined();
        fs.rmSync(outside, { recursive: true, force: true });
    });

    it('lists the changed files of the whole repository for vc-dir', async () => {
        write(repo, 'sub/c.txt', 'c2\n');
        write(repo, 'new.txt', 'n\n');
        write(repo, 'x.log', 'l\n');
        const changes = await repoChanges(path.join(repo, 'sub'));
        expect(changes?.root).toBe(repo);
        expect(changes?.branch).toBe('main');
        expect(changes?.records.map((r) => r.rel).sort()).toEqual(['new.txt', 'sub/c.txt']);
    });
});
