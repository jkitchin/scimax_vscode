import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CrucibleCliError, findCrucibleRoot, lintIssueRange, listWikiArticles, orgTitle, runCrucible, runCrucibleJson,
} from '../crucibleCli';

let tmp: string;

beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-')));
});

/**
 * A fake crucible executable: a shell script. Windows cannot run a shell
 * script as an executable (pip installs a real crucible.exe there), so the
 * tests that use it are POSIX only.
 */
const posixIt = it.skipIf(process.platform === 'win32');

/** A fake crucible executable: a shell script that prints `stdout`. */
function fakeCli(script: string): string {
    const file = path.join(tmp, 'crucible');
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return file;
}

describe('findCrucibleRoot', () => {
    it('finds the nearest ancestor with .crucible/wiki', () => {
        fs.mkdirSync(path.join(tmp, 'kb', '.crucible', 'wiki', 'concepts'), { recursive: true });
        const file = path.join(tmp, 'kb', '.crucible', 'wiki', 'concepts', 'a.org');
        expect(findCrucibleRoot(file, path.join(tmp, 'home'))).toBe(path.join(tmp, 'kb'));
        expect(findCrucibleRoot(path.join(tmp, 'elsewhere', 'b.org'), path.join(tmp, 'home'))).toBeUndefined();
    });

    it('never treats the home directory (the global registry) as a root', () => {
        const home = path.join(tmp, 'home');
        fs.mkdirSync(path.join(home, '.crucible', 'wiki'), { recursive: true });
        expect(findCrucibleRoot(path.join(home, 'projects', 'x.org'), home)).toBeUndefined();
    });
});

describe('wiki listing', () => {
    it('lists articles by title, falling back to the file name', () => {
        const dir = path.join(tmp, '.crucible', 'wiki', 'concepts');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'b.org'), '#+TITLE: Activation energy\n\n* x\n');
        fs.writeFileSync(path.join(dir, 'a.org'), '* No title\n');
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
        expect(listWikiArticles(tmp, 'concepts').map(a => a.title)).toEqual(['a', 'Activation energy']);
        expect(listWikiArticles(tmp, 'methods')).toEqual([]);
        expect(orgTitle(path.join(dir, 'b.org'))).toBe('Activation energy');
    });
});

describe('runCrucibleJson', () => {
    posixIt('adds --json and parses the output', async () => {
        const cli = fakeCli('echo "[\\"$@\\"]"');
        const result = await runCrucibleJson<string[]>(['concepts'], { command: cli, cwd: tmp });
        expect(result).toEqual(['concepts --json']);
    });

    posixIt('reports the last stderr line of a failed run', async () => {
        const cli = fakeCli('echo "Error: Not inside a crucible project." >&2; exit 1');
        await expect(runCrucibleJson(['stats'], { command: cli, cwd: tmp }))
            .rejects.toThrow('crucible stats: Not inside a crucible project.');
    });

    posixIt('says when the output is not JSON (crucible too old for --json)', async () => {
        const cli = fakeCli('echo "Sources: 3"');
        await expect(runCrucibleJson(['stats'], { command: cli, cwd: tmp })).rejects.toThrow(/too old/);
    });

    it('flags a missing executable', async () => {
        const error = await runCrucibleJson(['stats'], { command: path.join(tmp, 'nope'), cwd: tmp })
            .catch((e: unknown) => e) as CrucibleCliError;
        expect(error).toBeInstanceOf(CrucibleCliError);
        expect(error.notFound).toBe(true);
    });
});

describe('runCrucible', () => {
    posixIt('returns the trimmed output without adding --json', async () => {
        const cli = fakeCli('echo "ran $@"');
        expect(await runCrucible(['sync'], { command: cli, cwd: tmp })).toBe('ran sync');
    });
});

describe('lintIssueRange', () => {
    const text = '#+TITLE: A\n\nSee [[file:missing.org][it]] and citep:smith2024,jones2020a.\n';

    it('finds a broken link by its target', () => {
        expect(lintIssueRange({ type: 'broken_link', severity: 'warning', message: '', link: 'missing.org' }, text))
            .toEqual([2, 4, 22]);
    });

    it('finds a cite key, not a longer key that contains it', () => {
        const issue = { type: 'missing_citation', severity: 'warning' as const, message: '', key: 'jones2020' };
        expect(lintIssueRange(issue, text)).toEqual([0, 0, 0]);
        expect(lintIssueRange({ ...issue, key: 'jones2020a' }, text)).toEqual([2, 49, 59]);
        expect(lintIssueRange({ ...issue, key: 'smith2024' }, text)).toEqual([2, 39, 48]);
    });

    it('puts other issues on the first line', () => {
        expect(lintIssueRange({ type: 'missing_tags', severity: 'warning', message: '' }, text)).toEqual([0, 0, 0]);
    });
});
