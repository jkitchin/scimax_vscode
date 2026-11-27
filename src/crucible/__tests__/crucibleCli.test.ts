import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CrucibleCliError, askPrompt, distillPrompt, findCrucibleRoot, graphNodeForFile, lintIssueRange, listWikiArticles, orgTitle, parseIngestOutput,
    runCrucible, runCrucibleJson, sourceCiteKey,
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

describe('parseIngestOutput', () => {
    it('reads a new ingest', () => {
        const output = [
            'Ingested: Test notes',
            '  Source ID: 1',
            '  Cite key: test2026',
            '  Type: notebook (shareable)',
            '  Stored: .crucible/sources/notebooks/notes.org',
            '  Extracted: 51 chars',
            '',
            'Ready for distillation. Use citep:test2026 in articles.',
        ].join('\n');
        expect(parseIngestOutput(output)).toEqual({
            title: 'Test notes', citeKey: 'test2026',
            stored: '.crucible/sources/notebooks/notes.org', alreadyIngested: false,
        });
    });

    it('reads a repeat ingest', () => {
        const output = [
            'Already ingested (identical content): Test notes',
            '  Source ID: 1',
            '  Cite key: test2026',
            '  Stored: .crucible/sources/notebooks/notes.org',
            '  Skipped: no changes made.',
        ].join('\n');
        const result = parseIngestOutput(output);
        expect(result.alreadyIngested).toBe(true);
        expect(result.title).toBe('Test notes');
        expect(result.citeKey).toBe('test2026');
    });

    it('tolerates output it does not recognize', () => {
        expect(parseIngestOutput('something else')).toEqual({
            title: undefined, citeKey: undefined, stored: undefined, alreadyIngested: false,
        });
    });
});

describe('sourceCiteKey', () => {
    const source = { id: 1, path: 'p', title: 't', source_type: 'pdf' };
    it('reads the key from the metadata JSON', () => {
        expect(sourceCiteKey({ ...source, metadata: '{"cite_key": "smith2024", "content_hash": "x"}' })).toBe('smith2024');
    });
    it('is undefined without metadata or a key', () => {
        expect(sourceCiteKey({ ...source, metadata: null })).toBeUndefined();
        expect(sourceCiteKey({ ...source, metadata: '{}' })).toBeUndefined();
        expect(sourceCiteKey({ ...source, metadata: 'not json' })).toBeUndefined();
    });
});

describe('distillPrompt', () => {
    const source = { path: '.crucible/sources/notebooks/notes.org', title: 'Test notes', citeKey: 'test2026' };

    it('names the crucible, source and cite key, and asks for a plan first', () => {
        const prompt = distillPrompt('/kb', source);
        expect(prompt).toContain('crucible at /kb');
        expect(prompt).toContain(path.join('/kb', source.path));
        expect(prompt).toContain('cite key test2026');
        expect(prompt).toContain('SOURCE_KEYS set to test2026');
        expect(prompt).toMatch(/plan .* before writing anything/);
        expect(prompt).not.toContain('Focus on');
    });

    it('adds a focus when given', () => {
        expect(distillPrompt('/kb', source, '  the kinetics  ')).toMatch(/Focus on: the kinetics\.$/);
        expect(distillPrompt('/kb', source, '   ')).not.toContain('Focus on');
    });

    it('works without a cite key', () => {
        const prompt = distillPrompt('/kb', { path: 'x.pdf', title: 'X' });
        expect(prompt).not.toContain('cite key');
        expect(prompt).toContain('SOURCE_KEYS set,');
    });
});

describe('graphNodeForFile', () => {
    const graph = {
        root: '/kb',
        nodes: [
            { id: 'a1', type: 'article' as const, path: '.crucible/wiki/concepts/x.org', title: 'X' },
            { id: 's1', type: 'source' as const, path: '.crucible/sources/notebooks/x.org', title: 'X' },
            { id: 'c1', type: 'concept' as const, name: 'x', article_count: 1 },
        ],
        edges: [],
    };
    it('finds the article at a file', () => {
        expect(graphNodeForFile(graph, '/kb/.crucible/wiki/concepts/x.org')).toBe('a1');
    });
    it('ignores sources and other files', () => {
        expect(graphNodeForFile(graph, '/kb/.crucible/sources/notebooks/x.org')).toBeUndefined();
        expect(graphNodeForFile(graph, '/elsewhere/x.org')).toBeUndefined();
    });
});

describe('askPrompt', () => {
    it('names the crucible and question, and keeps the wiki unedited', () => {
        const prompt = askPrompt('/kb', '  What limits NSF CAREER success?  ');
        expect(prompt).toContain('crucible knowledge base at /kb: What limits NSF CAREER success?\n');
        expect(prompt).toContain('from /kb');
        expect(prompt).toContain('Do not edit the wiki.');
    });
});
