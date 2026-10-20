/**
 * Tests for the VC manager: state detection, the next-action decision, and
 * single-file commits, run against real git repositories in temp directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    addToGitignore,
    classifyStatusCode,
    cleanCommitMessage,
    commit,
    commitStaged,
    decideNextAction,
    fileLog,
    getAheadBehind,
    getFileStatus,
    hasConflictMarkers,
    ignorePatternFor,
    isMergeInProgress,
    parseLog,
    parsePorcelainCode,
    revertFile,
    runGit,
    stageFile,
    stagedFiles,
    untrackFile,
} from '../vcManager';

async function git(repo: string, ...args: string[]): Promise<string> {
    return runGit(args, repo);
}

async function makeRepo(): Promise<string> {
    // realpathSync.native expands Windows 8.3 short names (RUNNER~1) so the
    // path matches what git reports for the repository root
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-vc-')));
    await git(dir, 'init', '-q', '-b', 'main');
    await git(dir, 'config', 'user.name', 'Test');
    await git(dir, 'config', 'user.email', 'test@example.com');
    await git(dir, 'config', 'commit.gpgsign', 'false');
    // Windows runners default to autocrlf=true, which rewrites checkouts as CRLF
    await git(dir, 'config', 'core.autocrlf', 'false');
    return dir;
}

function write(repo: string, rel: string, content: string): string {
    const file = path.join(repo, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
}

describe('pure helpers', () => {
    it('classifies porcelain codes', () => {
        expect(classifyStatusCode('')).toBe('up-to-date');
        expect(classifyStatusCode('??')).toBe('untracked');
        expect(classifyStatusCode('!!')).toBe('ignored');
        expect(classifyStatusCode('UU')).toBe('conflict');
        expect(classifyStatusCode('AA')).toBe('conflict');
        expect(classifyStatusCode(' M')).toBe('edited');
        expect(classifyStatusCode('M ')).toBe('edited');
        expect(classifyStatusCode('A ')).toBe('edited');
        expect(classifyStatusCode('MM')).toBe('edited');
        expect(classifyStatusCode(' D')).toBe('edited');
    });

    it('builds an anchored, escaped .gitignore pattern for one file', () => {
        const root = path.join(os.tmpdir(), 'repo');
        expect(ignorePatternFor(root, path.join(root, 'notes', 'a.pptx'))).toBe('/notes/a.pptx');
        expect(ignorePatternFor(root, path.join(root, '#draft[1]*.org'))).toBe('/\\#draft\\[1\\]\\*.org');
    });

    it('reads the first porcelain -z record', () => {
        expect(parsePorcelainCode(' M a.txt\0')).toBe(' M');
        expect(parsePorcelainCode('')).toBe('');
    });

    it('decides the next action like vc-next-action', () => {
        expect(decideNextAction('unregistered')).toBe('init');
        expect(decideNextAction('untracked')).toBe('register');
        expect(decideNextAction('ignored')).toBe('ignored');
        expect(decideNextAction('conflict', { conflictMarkers: true })).toBe('fix-conflicts');
        expect(decideNextAction('conflict', { conflictMarkers: false })).toBe('resolve');
        expect(decideNextAction('edited')).toBe('commit');
        expect(decideNextAction('edited', { mergeInProgress: true })).toBe('commit-merge');
        expect(decideNextAction('up-to-date')).toBe('sync');
    });

    it('detects conflict markers only at line starts', () => {
        expect(hasConflictMarkers('a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> other\n')).toBe(true);
        expect(hasConflictMarkers('text with <<<<<<< inside\n')).toBe(false);
        expect(hasConflictMarkers('<<<<<<< HEAD\nonly the start\n')).toBe(false);
    });

    it('cleans the log buffer text into a message', () => {
        const text = 'Fix the thing  \n\n\nMore detail\n\n# Committing: a.txt\n#\n';
        expect(cleanCommitMessage(text)).toBe('Fix the thing\n\nMore detail');
        expect(cleanCommitMessage('\n\n# only comments\n')).toBe('');
    });

    it('parses log records', () => {
        const out = 'abc123\x1fabc\x1fAnn\x1f2026-01-02\x1fFirst\x1e\ndef456\x1fdef\x1fBob\x1f2026-01-03\x1fSecond\x1e\n';
        expect(parseLog(out)).toEqual([
            { hash: 'abc123', shortHash: 'abc', author: 'Ann', date: '2026-01-02', subject: 'First' },
            { hash: 'def456', shortHash: 'def', author: 'Bob', date: '2026-01-03', subject: 'Second' },
        ]);
    });
});

describe('against a git repository', () => {
    let repo: string;

    beforeEach(async () => {
        repo = await makeRepo();
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('reports a file outside any repository as unregistered', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-novc-'));
        try {
            const file = write(dir, 'a.txt', 'a');
            // A temp dir can sit inside a repo on some machines; only assert
            // when git agrees there is no repository
            const inRepo = await git(dir, 'rev-parse', '--is-inside-work-tree').then(() => true, () => false);
            if (!inRepo) {
                expect((await getFileStatus(file)).state).toBe('unregistered');
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('walks a file through untracked -> edited -> up-to-date', async () => {
        const file = write(repo, 'sub/notes.org', '* Notes\n');
        const untracked = await getFileStatus(file);
        expect(untracked.state).toBe('untracked');
        expect(fs.realpathSync.native(untracked.repoRoot!)).toBe(fs.realpathSync.native(repo));

        await stageFile(file);
        expect((await getFileStatus(file)).state).toBe('edited');

        await commit(untracked.repoRoot!, 'Add notes', file);
        expect((await getFileStatus(file)).state).toBe('up-to-date');

        fs.appendFileSync(file, 'more\n');
        expect((await getFileStatus(file)).state).toBe('edited');
    });

    it('detects ignored files, including inside ignored directories', async () => {
        write(repo, '.gitignore', 'build/\n*.log\n');
        expect((await getFileStatus(write(repo, 'x.log', 'x'))).state).toBe('ignored');
        expect((await getFileStatus(write(repo, 'build/deep/out.txt', 'x'))).state).toBe('ignored');
    });

    it('commits only the named file and leaves other staged changes staged', async () => {
        const a = write(repo, 'a.txt', 'a\n');
        const b = write(repo, 'b.txt', 'b\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'init');

        fs.appendFileSync(a, 'a2\n');
        fs.appendFileSync(b, 'b2\n');
        await git(repo, 'add', 'b.txt');

        await commit(repo, 'Change a', a);

        const files = (await git(repo, 'show', '--name-only', '--format=', 'HEAD')).trim();
        expect(files).toBe('a.txt');
        expect((await getFileStatus(a)).state).toBe('up-to-date');
        expect((await getFileStatus(b)).code).toBe('M ');
    });

    it('commits an unstaged modification without a separate add', async () => {
        const a = write(repo, 'a.txt', 'a\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'init');
        fs.appendFileSync(a, 'a2\n');
        expect((await getFileStatus(a)).code).toBe(' M');

        await commit(repo, 'Edit a', a);
        expect((await getFileStatus(a)).state).toBe('up-to-date');
        expect((await git(repo, 'log', '-1', '--format=%s')).trim()).toBe('Edit a');
    });

    it('reverts a modified file to HEAD', async () => {
        const a = write(repo, 'a.txt', 'original\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'init');
        fs.writeFileSync(a, 'changed\n');
        await git(repo, 'add', 'a.txt');

        await revertFile(a);
        expect(fs.readFileSync(a, 'utf8')).toBe('original\n');
        expect((await getFileStatus(a)).state).toBe('up-to-date');
    });

    it('lists file history newest first', async () => {
        const a = write(repo, 'a.txt', '1\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'first');
        fs.appendFileSync(a, '2\n');
        await git(repo, 'commit', '-q', '-am', 'second');

        const entries = await fileLog(a);
        expect(entries.map((e) => e.subject)).toEqual(['second', 'first']);
        expect(entries[0].author).toBe('Test');
    });

    it('handles a merge conflict: conflict, resolve, then whole-tree merge commit', async () => {
        const a = write(repo, 'a.txt', 'base\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'base');
        await git(repo, 'checkout', '-q', '-b', 'other');
        fs.writeFileSync(a, 'other\n');
        await git(repo, 'commit', '-q', '-am', 'other');
        await git(repo, 'checkout', '-q', 'main');
        fs.writeFileSync(a, 'main\n');
        await git(repo, 'commit', '-q', '-am', 'main');
        await expect(git(repo, 'merge', 'other')).rejects.toThrow();

        const conflicted = await getFileStatus(a);
        expect(conflicted.state).toBe('conflict');
        expect(hasConflictMarkers(fs.readFileSync(a, 'utf8'))).toBe(true);
        expect(await isMergeInProgress(repo)).toBe(true);

        fs.writeFileSync(a, 'merged\n');
        await stageFile(a);
        const resolved = await getFileStatus(a);
        expect(resolved.state).toBe('edited');
        expect(decideNextAction(resolved.state, { mergeInProgress: true })).toBe('commit-merge');

        // A partial commit is refused during a merge; the whole-tree commit works
        await expect(commit(repo, 'nope', a)).rejects.toThrow();
        await commit(repo, 'Merge other');
        expect(await isMergeInProgress(repo)).toBe(false);
        expect((await git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(3);
    });

    it('counts commits ahead of and behind the upstream', async () => {
        expect(await getAheadBehind(repo)).toEqual({ ahead: 0, behind: 0 });

        const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-vc-remote-'));
        try {
            await git(remote, 'init', '-q', '--bare', '-b', 'main');
            write(repo, 'a.txt', '1\n');
            await git(repo, 'add', '.');
            await git(repo, 'commit', '-q', '-m', 'first');
            await git(repo, 'remote', 'add', 'origin', remote);
            await git(repo, 'push', '-q', '-u', 'origin', 'main');
            expect(await getAheadBehind(repo)).toEqual({ upstream: 'origin/main', ahead: 0, behind: 0 });

            write(repo, 'a.txt', '2\n');
            await git(repo, 'commit', '-q', '-am', 'second');
            expect(await getAheadBehind(repo)).toEqual({ upstream: 'origin/main', ahead: 1, behind: 0 });
        } finally {
            fs.rmSync(remote, { recursive: true, force: true });
        }
    });

    it('ignores a file through .gitignore and untracks it on request', async () => {
        const deck = write(repo, 'notes/deck.pptx', 'x');
        expect((await getFileStatus(deck)).state).toBe('untracked');

        write(repo, '.gitignore', 'node_modules');
        expect(await addToGitignore(repo, ignorePatternFor(repo, deck))).toBe(true);
        expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe('node_modules\n/notes/deck.pptx\n');
        expect((await getFileStatus(deck)).state).toBe('ignored');
        // A second add is a no-op
        expect(await addToGitignore(repo, '/notes/deck.pptx')).toBe(false);

        // A tracked file stays tracked until it leaves the index
        const data = write(repo, 'data.csv', '1\n');
        await git(repo, 'add', 'data.csv');
        await git(repo, 'commit', '-q', '-m', 'data');
        await addToGitignore(repo, ignorePatternFor(repo, data));
        expect((await getFileStatus(data)).state).toBe('up-to-date');
        await untrackFile(data);
        await git(repo, 'commit', '-q', '-m', 'untrack');
        expect((await getFileStatus(data)).state).toBe('ignored');
        expect(fs.existsSync(data)).toBe(true);
    });

    it('commits everything staged together with the current file', async () => {
        write(repo, 'a.txt', '1\n');
        write(repo, 'b.txt', '1\n');
        const c = write(repo, 'c.txt', '1\n');
        await git(repo, 'add', '.');
        await git(repo, 'commit', '-q', '-m', 'first');

        write(repo, 'a.txt', '2\n');
        write(repo, 'sub/new.txt', 'n\n');
        await git(repo, 'add', 'a.txt', 'sub/new.txt');
        write(repo, 'b.txt', '2\n');   // edited but not staged: stays out
        write(repo, 'c.txt', '2\n');   // the current file, unstaged
        expect(await stagedFiles(repo)).toEqual(['a.txt', 'sub/new.txt']);

        await commitStaged(repo, 'batch', c);
        const changed = (await git(repo, 'show', '--name-only', '--format=', 'HEAD')).trim().split('\n');
        expect(changed.sort()).toEqual(['a.txt', 'c.txt', 'sub/new.txt']);
        expect(await stagedFiles(repo)).toEqual([]);
        expect((await getFileStatus(path.join(repo, 'b.txt'))).state).toBe('edited');
    });
});
