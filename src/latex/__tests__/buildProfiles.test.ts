/**
 * Tests for LaTeX build profiles
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import {
    BUILT_IN_PROFILES,
    BuildProfile,
    EXAMPLE_PROFILES_FILE,
    findProfileFiles,
    loadBuildProfiles,
    loadProfileFile,
    parseProfileFile,
    readBuildKeywords,
    resolveBuildProfile,
    runBuildProfile,
    substituteTokens,
} from '../buildProfiles';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-profiles-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a profiles file, creating parent directories as needed */
function writeProfiles(filePath: string, contents: unknown): string {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(contents, null, 2));
    return filePath;
}

describe('substituteTokens', () => {
    const context = { texPath: '/papers/2026/thesis.tex' };

    it('expands %f to the file name with extension', () => {
        expect(substituteTokens('%f', context)).toBe('thesis.tex');
    });

    it('expands %b to the base name without extension (what bibtex takes)', () => {
        expect(substituteTokens('%b', context)).toBe('thesis');
    });

    it('expands %p to the absolute .tex path', () => {
        expect(substituteTokens('%p', context)).toBe(path.resolve('/papers/2026/thesis.tex'));
    });

    it('expands %d to the directory holding the .tex file', () => {
        expect(substituteTokens('%d', context)).toBe(path.resolve('/papers/2026'));
    });

    it('defaults %o to the .tex directory', () => {
        expect(substituteTokens('%o', context)).toBe(path.resolve('/papers/2026'));
    });

    it('uses outDir for %o and %P when given', () => {
        const withOut = { texPath: '/papers/2026/thesis.tex', outDir: '/build' };
        expect(substituteTokens('%o', withOut)).toBe(path.resolve('/build'));
        expect(substituteTokens('%P', withOut)).toBe(path.join(path.resolve('/build'), 'thesis.pdf'));
    });

    it('expands %P to the PDF that will be produced', () => {
        expect(substituteTokens('%P', context)).toBe(path.join(path.resolve('/papers/2026'), 'thesis.pdf'));
    });

    it('expands %% to a literal percent', () => {
        expect(substituteTokens('100%%', context)).toBe('100%');
    });

    it('leaves unknown tokens alone', () => {
        expect(substituteTokens('-jobname=%z', context)).toBe('-jobname=%z');
    });

    it('substitutes inside a longer argument', () => {
        expect(substituteTokens('-output-directory=%d/out', context))
            .toBe(`-output-directory=${path.resolve('/papers/2026')}/out`);
    });

    it('handles multiple tokens in one argument', () => {
        expect(substituteTokens('%b.aux', context)).toBe('thesis.aux');
    });

    it('keeps a base name that itself contains dots', () => {
        expect(substituteTokens('%b', { texPath: '/x/paper.v2.tex' })).toBe('paper.v2');
    });
});

describe('parseProfileFile', () => {
    it('accepts the wrapped { default, profiles } form', () => {
        const parsed = parseProfileFile({
            default: 'quick',
            profiles: { quick: { steps: [{ command: 'pdflatex', args: ['%f'] }] } },
        }, 'test');

        expect(parsed?.default).toBe('quick');
        expect(parsed?.profiles.quick.steps).toHaveLength(1);
        expect(parsed?.profiles.quick.steps[0].args).toEqual(['%f']);
        expect(parsed?.profiles.quick.source).toBe('test');
        expect(parsed?.profiles.quick.name).toBe('quick');
    });

    it('accepts a bare { name: profile } map', () => {
        const parsed = parseProfileFile({
            quick: { steps: [{ command: 'pdflatex' }] },
        }, 'test');

        expect(Object.keys(parsed!.profiles)).toEqual(['quick']);
    });

    it('does not treat a bare map key named "default" as a profile', () => {
        const parsed = parseProfileFile({
            default: 'quick',
            quick: { steps: [{ command: 'pdflatex' }] },
        }, 'test');

        expect(Object.keys(parsed!.profiles)).toEqual(['quick']);
        expect(parsed?.default).toBe('quick');
    });

    it('expands a bare string step into a command', () => {
        const parsed = parseProfileFile({
            profiles: { quick: { steps: ['pdflatex'] } },
        }, 'test');

        expect(parsed?.profiles.quick.steps[0]).toEqual({ command: 'pdflatex' });
    });

    it('drops profiles with no steps array', () => {
        const parsed = parseProfileFile({
            profiles: { broken: { description: 'no steps' }, ok: { steps: ['pdflatex'] } },
        }, 'test');

        expect(Object.keys(parsed!.profiles)).toEqual(['ok']);
    });

    it('drops steps with no command', () => {
        const parsed = parseProfileFile({
            profiles: { p: { steps: [{ args: ['%f'] }, { command: '  ' }, { command: 'biber' }] } },
        }, 'test');

        expect(parsed?.profiles.p.steps).toEqual([{
            command: 'biber',
            args: undefined,
            label: undefined,
            cwd: undefined,
            env: undefined,
            timeoutMs: undefined,
            continueOnError: undefined,
            whenFileExists: undefined,
            whenFileMatches: undefined,
        }]);
    });

    it('drops non-string args', () => {
        const parsed = parseProfileFile({
            profiles: { p: { steps: [{ command: 'pdflatex', args: ['%f', 3, null] }] } },
        }, 'test');

        expect(parsed?.profiles.p.steps[0].args).toEqual(['%f']);
    });

    it('normalizes whenFileMatches and ignores incomplete guards', () => {
        const parsed = parseProfileFile({
            profiles: {
                p: {
                    steps: [
                        { command: 'bibtex', whenFileMatches: { file: '%b.aux', pattern: '\\citation', regex: true } },
                        { command: 'biber', whenFileMatches: { file: '%b.bcf' } },
                    ],
                },
            },
        }, 'test');

        expect(parsed?.profiles.p.steps[0].whenFileMatches)
            .toEqual({ file: '%b.aux', pattern: '\\citation', regex: true });
        expect(parsed?.profiles.p.steps[1].whenFileMatches).toBeUndefined();
    });

    it('returns undefined for non-objects and empty results', () => {
        expect(parseProfileFile(null, 'test')).toBeUndefined();
        expect(parseProfileFile('string', 'test')).toBeUndefined();
        expect(parseProfileFile([1, 2], 'test')).toBeUndefined();
        expect(parseProfileFile({}, 'test')).toBeUndefined();
        expect(parseProfileFile({ profiles: {} }, 'test')).toBeUndefined();
    });

    it('parses the shipped example file', () => {
        const parsed = parseProfileFile(EXAMPLE_PROFILES_FILE, 'example');
        expect(parsed).toBeDefined();
        expect(Object.keys(parsed!.profiles).length).toBeGreaterThan(0);
    });
});

describe('loadProfileFile', () => {
    it('reads and parses a file from disk', () => {
        const file = writeProfiles(path.join(tmpDir, 'latex-profiles.json'), {
            profiles: { quick: { steps: ['pdflatex'] } },
        });

        expect(loadProfileFile(file)?.profiles.quick.source).toBe(file);
    });

    it('returns undefined for malformed JSON', () => {
        const file = path.join(tmpDir, 'latex-profiles.json');
        fs.writeFileSync(file, '{ not json');
        expect(loadProfileFile(file)).toBeUndefined();
    });

    it('returns undefined for a missing file', () => {
        expect(loadProfileFile(path.join(tmpDir, 'nope.json'))).toBeUndefined();
    });
});

describe('findProfileFiles', () => {
    it('finds files walking up, nearest first', () => {
        const deep = path.join(tmpDir, 'a', 'b');
        fs.mkdirSync(deep, { recursive: true });
        const near = writeProfiles(path.join(deep, 'latex-profiles.json'), { p: { steps: ['x'] } });
        const far = writeProfiles(path.join(tmpDir, 'latex-profiles.json'), { p: { steps: ['x'] } });

        expect(findProfileFiles(deep, tmpDir)).toEqual([near, far]);
    });

    it('prefers .scimax/latex-profiles.json over a sibling latex-profiles.json', () => {
        const dot = writeProfiles(path.join(tmpDir, '.scimax', 'latex-profiles.json'), { p: { steps: ['x'] } });
        const plain = writeProfiles(path.join(tmpDir, 'latex-profiles.json'), { p: { steps: ['x'] } });

        expect(findProfileFiles(tmpDir, tmpDir)).toEqual([dot, plain]);
    });

    it('stops at stopDir', () => {
        const deep = path.join(tmpDir, 'a', 'b');
        fs.mkdirSync(deep, { recursive: true });
        writeProfiles(path.join(tmpDir, 'latex-profiles.json'), { p: { steps: ['x'] } });
        const inner = writeProfiles(path.join(tmpDir, 'a', 'latex-profiles.json'), { p: { steps: ['x'] } });

        expect(findProfileFiles(deep, path.join(tmpDir, 'a'))).toEqual([inner]);
    });

    it('returns an empty list when nothing is found', () => {
        expect(findProfileFiles(tmpDir, tmpDir)).toEqual([]);
    });
});

describe('loadBuildProfiles', () => {
    it('always provides the built-ins', () => {
        const loaded = loadBuildProfiles();
        for (const name of Object.keys(BUILT_IN_PROFILES)) {
            expect(loaded.profiles[name].source).toBe('built-in');
        }
    });

    it('lets settings profiles override built-ins', () => {
        const loaded = loadBuildProfiles({
            settingsProfiles: { 'pdflatex-bibtex': { steps: ['my-latex'] } },
        });

        expect(loaded.profiles['pdflatex-bibtex'].steps).toEqual([{ command: 'my-latex' }]);
        expect(loaded.profiles['pdflatex-bibtex'].source).toBe('scimax.export.pdf.profiles');
    });

    it('lets a nearer file override a farther one', () => {
        const deep = path.join(tmpDir, 'a');
        fs.mkdirSync(deep, { recursive: true });
        writeProfiles(path.join(tmpDir, 'latex-profiles.json'), {
            profiles: { paper: { steps: ['far'] } },
        });
        writeProfiles(path.join(deep, 'latex-profiles.json'), {
            profiles: { paper: { steps: ['near'] } },
        });

        const loaded = loadBuildProfiles({ startDir: deep, stopDir: tmpDir });
        expect(loaded.profiles.paper.steps).toEqual([{ command: 'near' }]);
        expect(loaded.files[0]).toBe(path.join(deep, 'latex-profiles.json'));
    });

    it('takes the default from the nearest file that declares one', () => {
        const deep = path.join(tmpDir, 'a');
        fs.mkdirSync(deep, { recursive: true });
        writeProfiles(path.join(tmpDir, 'latex-profiles.json'), {
            default: 'far-default',
            profiles: { 'far-default': { steps: ['x'] } },
        });
        writeProfiles(path.join(deep, 'latex-profiles.json'), {
            default: 'near-default',
            profiles: { 'near-default': { steps: ['x'] } },
        });

        expect(loadBuildProfiles({ startDir: deep, stopDir: tmpDir }).defaultProfile)
            .toBe('near-default');
    });

    it('inherits a parent default when the nearer file declares none', () => {
        const deep = path.join(tmpDir, 'a');
        fs.mkdirSync(deep, { recursive: true });
        writeProfiles(path.join(tmpDir, 'latex-profiles.json'), {
            default: 'far-default',
            profiles: { 'far-default': { steps: ['x'] } },
        });
        writeProfiles(path.join(deep, 'latex-profiles.json'), {
            profiles: { other: { steps: ['x'] } },
        });

        expect(loadBuildProfiles({ startDir: deep, stopDir: tmpDir }).defaultProfile)
            .toBe('far-default');
    });

    it('ignores project-local files when includeLocalFiles is false', () => {
        writeProfiles(path.join(tmpDir, 'latex-profiles.json'), {
            profiles: { untrusted: { steps: ['x'] } },
        });

        const loaded = loadBuildProfiles({
            startDir: tmpDir,
            stopDir: tmpDir,
            includeLocalFiles: false,
        });

        expect(loaded.profiles.untrusted).toBeUndefined();
        expect(loaded.files).toEqual([]);
    });

    it('reads extraFiles and skips ones that do not exist', () => {
        const global = writeProfiles(path.join(tmpDir, 'global.json'), {
            profiles: { fromGlobal: { steps: ['x'] } },
        });

        const loaded = loadBuildProfiles({
            extraFiles: [global, path.join(tmpDir, 'missing.json')],
        });

        expect(loaded.profiles.fromGlobal).toBeDefined();
        expect(loaded.files).toEqual([global]);
    });

    it('lets a project-local file override an extra (global) file', () => {
        const global = writeProfiles(path.join(tmpDir, 'global.json'), {
            profiles: { paper: { steps: ['global'] } },
        });
        const local = path.join(tmpDir, 'proj');
        writeProfiles(path.join(local, 'latex-profiles.json'), {
            profiles: { paper: { steps: ['local'] } },
        });

        const loaded = loadBuildProfiles({
            startDir: local,
            stopDir: local,
            extraFiles: [global],
        });

        expect(loaded.profiles.paper.steps).toEqual([{ command: 'local' }]);
    });
});

describe('resolveBuildProfile', () => {
    const loaded = loadBuildProfiles({
        settingsProfiles: { mine: { steps: ['x'] }, MixedCase: { steps: ['y'] } },
    });

    it('prefers the #+LATEX_BUILD keyword', () => {
        const result = resolveBuildProfile(loaded, { LATEX_BUILD: 'mine' }, 'lualatex-biber');
        expect(result.profile?.name).toBe('mine');
    });

    it('falls back to the file default, then the setting', () => {
        expect(resolveBuildProfile({ ...loaded, defaultProfile: 'mine' }, {}, 'lualatex-biber').profile?.name)
            .toBe('mine');
        expect(resolveBuildProfile(loaded, {}, 'lualatex-biber').profile?.name)
            .toBe('lualatex-biber');
    });

    it('returns nothing when no one asks for a profile', () => {
        expect(resolveBuildProfile(loaded, {}, '')).toEqual({});
        expect(resolveBuildProfile(loaded)).toEqual({});
    });

    it('treats none/nil/off/default as an opt-out', () => {
        for (const opt of ['none', 'NIL', 'off', 'Default']) {
            const result = resolveBuildProfile(loaded, { LATEX_BUILD: opt }, 'lualatex-biber');
            expect(result.profile).toBeUndefined();
            expect(result.unknown).toBeUndefined();
            expect(result.requested).toBe(opt);
        }
    });

    it('matches a hand-typed name case-insensitively', () => {
        expect(resolveBuildProfile(loaded, { LATEX_BUILD: 'mixedcase' }).profile?.name)
            .toBe('MixedCase');
    });

    it('flags an unknown name without falling through to lower-priority sources', () => {
        const result = resolveBuildProfile(loaded, { LATEX_BUILD: 'typo' }, 'lualatex-biber');
        expect(result.unknown).toBe(true);
        expect(result.requested).toBe('typo');
        expect(result.profile).toBeUndefined();
    });

    it('ignores blank keyword values', () => {
        expect(resolveBuildProfile(loaded, { LATEX_BUILD: '   ' }, 'mine').profile?.name).toBe('mine');
    });
});

describe('readBuildKeywords', () => {
    it('reads #+LATEX_BUILD from an org file', () => {
        expect(readBuildKeywords('#+TITLE: Paper\n#+LATEX_BUILD: lualatex-biber\n\n* Intro'))
            .toEqual({ LATEX_BUILD: 'lualatex-biber' });
    });

    it('is case-insensitive about the keyword', () => {
        expect(readBuildKeywords('#+latex_build: mine').LATEX_BUILD).toBe('mine');
    });

    it('reads the % !SCIMAX build magic comment from a .tex file', () => {
        expect(readBuildKeywords('% !SCIMAX build = pdflatex-bibtex\n\\documentclass{article}'))
            .toEqual({ LATEX_BUILD: 'pdflatex-bibtex' });
    });

    it('returns nothing when no build keyword is present', () => {
        expect(readBuildKeywords('#+TITLE: Paper\n\n* Intro')).toEqual({});
    });

    it('only looks near the top of the file', () => {
        const content = `${'\n'.repeat(100)}#+LATEX_BUILD: late`;
        expect(readBuildKeywords(content)).toEqual({});
    });
});

describe('runBuildProfile', () => {
    /** A profile that runs `node -e ...` so tests do not need a TeX install */
    function nodeProfile(steps: BuildProfile['steps']): BuildProfile {
        return { name: 'test', steps };
    }

    it('substitutes tokens in args before spawning', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        const outFile = path.join(tmpDir, 'echoed.txt');

        const result = await runBuildProfile(
            nodeProfile([{
                command: process.execPath,
                args: ['-e', `require('fs').writeFileSync(process.argv[1], process.argv[2])`, outFile, '%b'],
                label: 'echo base',
            }]),
            { texPath }
        );

        expect(result.completed).toBe(true);
        expect(result.steps[0].exitCode).toBe(0);
        expect(fs.readFileSync(outFile, 'utf-8')).toBe('paper');
    });

    it('runs steps in order in the .tex directory', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        const outFile = path.join(tmpDir, 'order.txt');
        const appendStep = (value: string) => ({
            command: process.execPath,
            args: ['-e', `require('fs').appendFileSync('order.txt', process.argv[1])`, value],
            label: `append ${value}`,
        });

        const result = await runBuildProfile(nodeProfile([appendStep('1'), appendStep('2')]), { texPath });

        expect(result.steps.map(s => s.label)).toEqual(['append 1', 'append 2']);
        expect(fs.readFileSync(outFile, 'utf-8')).toBe('12');
    });

    it('skips a step whose whenFileExists guard fails', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');

        const result = await runBuildProfile(
            nodeProfile([{ command: process.execPath, args: ['-e', ''], whenFileExists: '%b.bcf', label: 'biber' }]),
            { texPath }
        );

        expect(result.steps[0].skipped).toBe(true);
        expect(result.steps[0].skipReason).toContain('paper.bcf');
    });

    it('runs a step whose whenFileExists guard passes', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        fs.writeFileSync(path.join(tmpDir, 'paper.bcf'), '');

        const result = await runBuildProfile(
            nodeProfile([{ command: process.execPath, args: ['-e', ''], whenFileExists: '%b.bcf' }]),
            { texPath }
        );

        expect(result.steps[0].skipped).toBe(false);
        expect(result.steps[0].exitCode).toBe(0);
    });

    it('gates a bibtex-style step on \\citation in the aux file', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        fs.writeFileSync(path.join(tmpDir, 'paper.aux'), '\\relax\n');

        const guard = {
            command: process.execPath,
            args: ['-e', ''],
            whenFileMatches: { file: '%b.aux', pattern: '\\\\citation', regex: true },
        };

        const uncited = await runBuildProfile(nodeProfile([guard]), { texPath });
        expect(uncited.steps[0].skipped).toBe(true);

        fs.writeFileSync(path.join(tmpDir, 'paper.aux'), '\\citation{kitchin-2015}\n');
        const cited = await runBuildProfile(nodeProfile([guard]), { texPath });
        expect(cited.steps[0].skipped).toBe(false);
    });

    it('treats an invalid guard regex as no match instead of throwing', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        fs.writeFileSync(path.join(tmpDir, 'paper.aux'), 'anything');

        const result = await runBuildProfile(
            nodeProfile([{
                command: process.execPath,
                args: ['-e', ''],
                whenFileMatches: { file: '%b.aux', pattern: '([', regex: true },
            }]),
            { texPath }
        );

        expect(result.steps[0].skipped).toBe(true);
    });

    it('continues past a failing step by default', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');

        const result = await runBuildProfile(
            nodeProfile([
                { command: process.execPath, args: ['-e', 'process.exit(1)'], label: 'fails' },
                { command: process.execPath, args: ['-e', ''], label: 'still runs' },
            ]),
            { texPath }
        );

        expect(result.completed).toBe(true);
        expect(result.steps[0].exitCode).toBe(1);
        expect(result.steps).toHaveLength(2);
    });

    it('stops the build when continueOnError is false', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');

        const result = await runBuildProfile(
            nodeProfile([
                { command: process.execPath, args: ['-e', 'process.exit(1)'], continueOnError: false, label: 'fails' },
                { command: process.execPath, args: ['-e', ''], label: 'never runs' },
            ]),
            { texPath }
        );

        expect(result.completed).toBe(false);
        expect(result.steps).toHaveLength(1);
    });

    it('reports a missing executable as a step error rather than throwing', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');

        const result = await runBuildProfile(
            nodeProfile([{ command: 'scimax-no-such-compiler', args: [], label: 'missing' }]),
            { texPath }
        );

        expect(result.steps[0].error).toBeTruthy();
        expect(result.completed).toBe(true);
    });

    it('does not re-parse arguments through a shell', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        const outFile = path.join(tmpDir, 'arg.txt');
        const injected = 'a; touch /tmp/scimax-should-not-exist && echo x';

        await runBuildProfile(
            nodeProfile([{
                command: process.execPath,
                args: ['-e', `require('fs').writeFileSync(process.argv[1], process.argv[2])`, outFile, injected],
            }]),
            { texPath }
        );

        expect(fs.readFileSync(outFile, 'utf-8')).toBe(injected);
        expect(fs.existsSync('/tmp/scimax-should-not-exist')).toBe(false);
    });

    it('passes profile and step env to the process', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        const outFile = path.join(tmpDir, 'env.txt');

        await runBuildProfile(
            {
                name: 'env',
                env: { SCIMAX_TEST_A: 'from-profile', SCIMAX_TEST_B: 'from-profile' },
                steps: [{
                    command: process.execPath,
                    args: [
                        '-e',
                        `require('fs').writeFileSync(process.argv[1], process.env.SCIMAX_TEST_A + ',' + process.env.SCIMAX_TEST_B)`,
                        outFile,
                    ],
                    env: { SCIMAX_TEST_B: 'from-step' },
                }],
            },
            { texPath }
        );

        expect(fs.readFileSync(outFile, 'utf-8')).toBe('from-profile,from-step');
    });

    it('reports progress for each step', async () => {
        const texPath = path.join(tmpDir, 'paper.tex');
        fs.writeFileSync(texPath, '');
        const messages: string[] = [];

        await runBuildProfile(
            nodeProfile([
                { command: process.execPath, args: ['-e', ''], label: 'compile' },
                { command: process.execPath, args: ['-e', ''], label: 'biber', whenFileExists: '%b.bcf' },
            ]),
            { texPath, onProgress: (m) => messages.push(m) }
        );

        expect(messages).toEqual([
            'Running compile...',
            'Skipping biber: paper.bcf does not exist',
        ]);
    });
});

describe('built-in profiles', () => {
    it('cover the common engine/bibliography combinations', () => {
        expect(Object.keys(BUILT_IN_PROFILES)).toEqual(expect.arrayContaining([
            'pdflatex-bibtex',
            'lualatex-biber',
            'xelatex-biber',
        ]));
    });

    it('pass the base name (not the file name) to bibtex', () => {
        const bibtex = BUILT_IN_PROFILES['pdflatex-bibtex'].steps.find(s => s.command === 'bibtex');
        expect(bibtex?.args).toEqual(['%b']);
    });

    it('gate the bibliography step so uncited documents skip it', () => {
        const bibtex = BUILT_IN_PROFILES['pdflatex-bibtex'].steps.find(s => s.command === 'bibtex');
        expect(bibtex?.whenFileMatches?.file).toBe('%b.aux');

        const biber = BUILT_IN_PROFILES['lualatex-biber'].steps.find(s => s.command === 'biber');
        expect(biber?.whenFileExists ?? biber?.whenFileMatches?.file).toBeTruthy();
    });
});
