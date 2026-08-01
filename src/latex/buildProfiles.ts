/**
 * LaTeX Build Profiles
 *
 * A build profile is a named sequence of commands that turns a .tex file into a
 * PDF. Different documents need different sequences - pdflatex + bibtex for a
 * classic paper, lualatex + biber for a biblatex document, a single fast pass
 * while drafting - and those sequences are stable enough to be worth naming.
 *
 * Profiles come from three places (later sources win):
 *   1. Built-ins (see BUILT_IN_PROFILES)
 *   2. The `scimax.export.pdf.profiles` setting
 *   3. `latex-profiles.json` files, searched from the document's directory
 *      upward (`.scimax/latex-profiles.json` or `latex-profiles.json`)
 *
 * A document selects one with `#+LATEX_BUILD: <name>`; otherwise the nearest
 * profiles file's `"default"` or the `scimax.export.pdf.profile` setting is
 * used. With no profile at all, callers fall back to the compiler settings.
 *
 * This module deliberately has no vscode dependency so the CLI can use it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

// =============================================================================
// Types
// =============================================================================

/** One command in a build profile */
export interface BuildStep {
    /** Executable to run (e.g. "pdflatex"). Never run through a shell. */
    command: string;
    /** Arguments; `%` tokens are substituted (see substituteTokens) */
    args?: string[];
    /** Label shown in progress/logs (defaults to the command) */
    label?: string;
    /** Working directory; tokens allowed. Defaults to the .tex file's directory */
    cwd?: string;
    /** Extra environment variables for this step */
    env?: Record<string, string>;
    /** Milliseconds before the step is killed (default 180000) */
    timeoutMs?: number;
    /**
     * Keep going when this step fails. Default true, because LaTeX engines
     * routinely exit non-zero while still producing a usable PDF. Set false to
     * abort the build at the first failing step.
     */
    continueOnError?: boolean;
    /** Run only if this file exists; tokens allowed (e.g. "%b.bcf") */
    whenFileExists?: string;
    /** Run only if this file matches a pattern (e.g. citations in the .aux) */
    whenFileMatches?: {
        /** File to inspect; tokens allowed (e.g. "%b.aux") */
        file: string;
        /** Substring or regular expression source to look for */
        pattern: string;
        /** Treat `pattern` as a regular expression (default: plain substring) */
        regex?: boolean;
    };
}

/** A named build sequence */
export interface BuildProfile {
    /** Profile name (filled in from the containing map when absent) */
    name?: string;
    /** Human-readable description shown in the profile picker */
    description?: string;
    /** Commands to run, in order */
    steps: BuildStep[];
    /** Environment variables applied to every step */
    env?: Record<string, string>;
    /** Where this profile was defined (built-in, settings, or a file path) */
    source?: string;
}

/** Shape of a latex-profiles.json file */
export interface BuildProfileFile {
    /** Profile to use when a document does not name one */
    default?: string;
    /** Profiles by name */
    profiles: Record<string, BuildProfile>;
}

/** Everything needed to expand `%` tokens */
export interface BuildContext {
    /** Absolute path to the .tex file being compiled */
    texPath: string;
    /** Directory LaTeX writes output to (defaults to the .tex file's directory) */
    outDir?: string;
}

/** Outcome of a single step */
export interface StepResult {
    label: string;
    command: string;
    args: string[];
    /** True when a `whenFile*` guard excluded the step */
    skipped: boolean;
    /** Why the step was skipped */
    skipReason?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    /** Set when the process could not be started or timed out */
    error?: string;
}

/** Outcome of a whole profile run */
export interface BuildResult {
    profileName: string;
    steps: StepResult[];
    /** False when a step failed and `continueOnError` was false */
    completed: boolean;
}

// =============================================================================
// Built-in profiles
// =============================================================================

/** Args every LaTeX engine invocation gets */
const ENGINE_ARGS = ['-interaction=nonstopmode', '-synctex=1', '%f'];

const engineStep = (command: string, label: string): BuildStep => ({
    command,
    args: [...ENGINE_ARGS],
    label,
});

/**
 * Profiles available without any configuration. User-defined profiles with the
 * same name replace these.
 */
export const BUILT_IN_PROFILES: Record<string, BuildProfile> = {
    'pdflatex-bibtex': {
        description: 'pdflatex, bibtex, pdflatex x2 (classic BibTeX workflow)',
        steps: [
            engineStep('pdflatex', 'pdflatex (pass 1)'),
            {
                command: 'bibtex',
                args: ['%b'],
                label: 'bibtex',
                whenFileMatches: { file: '%b.aux', pattern: '\\citation' },
            },
            engineStep('pdflatex', 'pdflatex (pass 2)'),
            engineStep('pdflatex', 'pdflatex (pass 3)'),
        ],
    },
    'lualatex-biber': {
        description: 'lualatex, biber, lualatex x2 (biblatex workflow)',
        steps: [
            engineStep('lualatex', 'lualatex (pass 1)'),
            {
                command: 'biber',
                args: ['%b'],
                label: 'biber',
                whenFileExists: '%b.bcf',
            },
            engineStep('lualatex', 'lualatex (pass 2)'),
            engineStep('lualatex', 'lualatex (pass 3)'),
        ],
    },
    'xelatex-biber': {
        description: 'xelatex, biber, xelatex x2 (biblatex workflow)',
        steps: [
            engineStep('xelatex', 'xelatex (pass 1)'),
            {
                command: 'biber',
                args: ['%b'],
                label: 'biber',
                whenFileExists: '%b.bcf',
            },
            engineStep('xelatex', 'xelatex (pass 2)'),
            engineStep('xelatex', 'xelatex (pass 3)'),
        ],
    },
    'latexmk-pdflatex': {
        description: 'latexmk -pdf (handles reruns and bibliography itself)',
        steps: [
            {
                command: 'latexmk',
                args: ['-pdf', '-bibtex', '-f', '-interaction=nonstopmode', '-synctex=1', '%f'],
                label: 'latexmk (pdflatex)',
            },
        ],
    },
    'latexmk-lualatex': {
        description: 'latexmk -lualatex (handles reruns and bibliography itself)',
        steps: [
            {
                command: 'latexmk',
                args: ['-lualatex', '-bibtex', '-f', '-interaction=nonstopmode', '-synctex=1', '%f'],
                label: 'latexmk (lualatex)',
            },
        ],
    },
    'pdflatex-fast': {
        description: 'Single pdflatex pass - quick drafts, stale references',
        steps: [engineStep('pdflatex', 'pdflatex')],
    },
};

// =============================================================================
// Token substitution
// =============================================================================

/**
 * Expand `%` tokens in a profile argument.
 *
 * | Token | Meaning                                        | Example          |
 * |-------|------------------------------------------------|------------------|
 * | `%f`  | .tex file name with extension (relative to cwd) | `paper.tex`      |
 * | `%b`  | base name, no extension - what bibtex/biber want| `paper`          |
 * | `%p`  | absolute path to the .tex file                  | `/x/y/paper.tex` |
 * | `%d`  | absolute directory holding the .tex file        | `/x/y`           |
 * | `%o`  | output directory                                | `/x/y`           |
 * | `%P`  | absolute path to the PDF that will be produced  | `/x/y/paper.pdf` |
 * | `%%`  | a literal `%`                                   | `%`              |
 *
 * Unknown tokens are left alone, so a stray `%` in an argument is harmless.
 */
export function substituteTokens(arg: string, context: BuildContext): string {
    const texPath = path.resolve(context.texPath);
    const dir = path.dirname(texPath);
    const outDir = context.outDir ? path.resolve(context.outDir) : dir;
    const base = path.basename(texPath, path.extname(texPath));

    return arg.replace(/%(.)/g, (match, token: string) => {
        switch (token) {
            case 'f': return path.basename(texPath);
            case 'b': return base;
            case 'p': return texPath;
            case 'd': return dir;
            case 'o': return outDir;
            case 'P': return path.join(outDir, `${base}.pdf`);
            case '%': return '%';
            default: return match;
        }
    });
}

// =============================================================================
// Loading and resolution
// =============================================================================

/** File names checked at each directory level, in order */
const PROFILE_FILE_NAMES = [
    path.join('.scimax', 'latex-profiles.json'),
    'latex-profiles.json',
];

/**
 * Validate and normalize a parsed profiles file.
 * Returns undefined when the content is not a usable profiles definition.
 */
export function parseProfileFile(
    raw: unknown,
    source: string
): BuildProfileFile | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }

    const obj = raw as Record<string, unknown>;

    // Accept both { profiles: {...}, default: "..." } and a bare { name: {...} } map
    const hasWrapper = typeof obj.profiles === 'object' && obj.profiles !== null;
    const rawProfiles = (hasWrapper ? obj.profiles : obj) as Record<string, unknown>;

    const profiles: Record<string, BuildProfile> = {};
    for (const [name, value] of Object.entries(rawProfiles)) {
        if (name === 'default' && !hasWrapper) continue;
        const profile = normalizeProfile(name, value, source);
        if (profile) {
            profiles[name] = profile;
        }
    }

    if (Object.keys(profiles).length === 0) {
        return undefined;
    }

    const defaultName = typeof obj.default === 'string' ? obj.default : undefined;
    return { default: defaultName, profiles };
}

/**
 * Coerce a value into a BuildProfile, dropping anything malformed.
 */
function normalizeProfile(
    name: string,
    value: unknown,
    source: string
): BuildProfile | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    const obj = value as Record<string, unknown>;
    if (!Array.isArray(obj.steps)) {
        return undefined;
    }

    const steps: BuildStep[] = [];
    for (const rawStep of obj.steps) {
        // A step may be written as a bare command string
        if (typeof rawStep === 'string') {
            steps.push({ command: rawStep });
            continue;
        }
        if (!rawStep || typeof rawStep !== 'object') continue;

        const step = rawStep as Record<string, unknown>;
        if (typeof step.command !== 'string' || !step.command.trim()) continue;

        steps.push({
            command: step.command.trim(),
            args: Array.isArray(step.args)
                ? step.args.filter((a): a is string => typeof a === 'string')
                : undefined,
            label: typeof step.label === 'string' ? step.label : undefined,
            cwd: typeof step.cwd === 'string' ? step.cwd : undefined,
            env: isStringMap(step.env) ? step.env : undefined,
            timeoutMs: typeof step.timeoutMs === 'number' ? step.timeoutMs : undefined,
            continueOnError: typeof step.continueOnError === 'boolean' ? step.continueOnError : undefined,
            whenFileExists: typeof step.whenFileExists === 'string' ? step.whenFileExists : undefined,
            whenFileMatches: normalizeWhenFileMatches(step.whenFileMatches),
        });
    }

    if (steps.length === 0) {
        return undefined;
    }

    return {
        name,
        description: typeof obj.description === 'string' ? obj.description : undefined,
        steps,
        env: isStringMap(obj.env) ? obj.env : undefined,
        source,
    };
}

function normalizeWhenFileMatches(value: unknown): BuildStep['whenFileMatches'] {
    if (!value || typeof value !== 'object') return undefined;
    const obj = value as Record<string, unknown>;
    if (typeof obj.file !== 'string' || typeof obj.pattern !== 'string') return undefined;
    return {
        file: obj.file,
        pattern: obj.pattern,
        regex: obj.regex === true,
    };
}

function isStringMap(value: unknown): value is Record<string, string> {
    return (
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.values(value as Record<string, unknown>).every(v => typeof v === 'string')
    );
}

/**
 * Find latex-profiles.json files, nearest first, walking up from `startDir`.
 *
 * The walk stops at `stopDir` (typically the workspace root) when given, and
 * always stops at the filesystem root.
 */
export function findProfileFiles(startDir: string, stopDir?: string): string[] {
    const found: string[] = [];
    const stop = stopDir ? path.resolve(stopDir) : undefined;

    let dir = path.resolve(startDir);
    // Guard against symlink loops / pathological depth
    for (let i = 0; i < 64; i++) {
        for (const name of PROFILE_FILE_NAMES) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) {
                found.push(candidate);
            }
        }

        if (stop && dir === stop) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return found;
}

/** Read and parse one profiles file; returns undefined on any error */
export function loadProfileFile(filePath: string): BuildProfileFile | undefined {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parseProfileFile(raw, filePath);
    } catch {
        return undefined;
    }
}

/** Inputs for assembling the profile set visible to a document */
export interface LoadProfilesOptions {
    /** Directory to search upward from (usually the document's directory) */
    startDir?: string;
    /** Stop the upward search here (usually the workspace root) */
    stopDir?: string;
    /** Profiles from `scimax.export.pdf.profiles` */
    settingsProfiles?: Record<string, unknown>;
    /** Additional profiles files to read last (e.g. ~/scimax/latex-profiles.json) */
    extraFiles?: string[];
    /** Set false to ignore project-local files (untrusted workspaces) */
    includeLocalFiles?: boolean;
}

/** The profile set that applies to a document */
export interface LoadedProfiles {
    profiles: Record<string, BuildProfile>;
    /** `"default"` from the nearest profiles file that declares one */
    defaultProfile?: string;
    /** Files that contributed profiles, nearest first */
    files: string[];
}

/**
 * Assemble every profile visible to a document.
 *
 * Precedence, lowest to highest: built-ins, settings, global/extra files,
 * then profiles files from the workspace root down to the document's directory
 * (nearest wins).
 */
export function loadBuildProfiles(options: LoadProfilesOptions = {}): LoadedProfiles {
    const profiles: Record<string, BuildProfile> = {};

    for (const [name, profile] of Object.entries(BUILT_IN_PROFILES)) {
        profiles[name] = { ...profile, name, source: 'built-in' };
    }

    if (options.settingsProfiles) {
        const parsed = parseProfileFile(options.settingsProfiles, 'scimax.export.pdf.profiles');
        if (parsed) {
            Object.assign(profiles, parsed.profiles);
        }
    }

    // Nearest file first; apply in reverse so nearer definitions win
    const localFiles = options.includeLocalFiles === false || !options.startDir
        ? []
        : findProfileFiles(options.startDir, options.stopDir);
    const files = [...localFiles, ...(options.extraFiles || []).filter(f => fs.existsSync(f))];

    let defaultProfile: string | undefined;
    const contributing: string[] = [];

    for (const file of [...files].reverse()) {
        const parsed = loadProfileFile(file);
        if (!parsed) continue;
        Object.assign(profiles, parsed.profiles);
        contributing.unshift(file);
        // Later iterations are nearer files, so their default wins
        if (parsed.default) {
            defaultProfile = parsed.default;
        }
    }

    return { profiles, defaultProfile, files: contributing };
}

/**
 * Extract the build-related keywords from document text.
 *
 * Org files use `#+LATEX_BUILD:`; .tex files use a magic comment
 * `% !SCIMAX build = <name>` in the same spirit as `% !TEX program`.
 */
export function readBuildKeywords(content: string): Record<string, string> {
    const keywords: Record<string, string> = {};
    const lines = content.split('\n', 60);

    for (const line of lines) {
        const org = line.match(/^#\+LATEX_BUILD:\s*(.+)$/i);
        if (org) {
            keywords.LATEX_BUILD = org[1].trim();
            break;
        }
        const magic = line.match(/^%\s*!SCIMAX\s+build\s*=\s*(.+)$/i);
        if (magic) {
            keywords.LATEX_BUILD = magic[1].trim();
            break;
        }
    }

    return keywords;
}

/**
 * Pick the profile for a document.
 *
 * Order: `#+LATEX_BUILD:` keyword, then the nearest file's `"default"`, then
 * the `scimax.export.pdf.profile` setting. `none` anywhere in that chain means
 * "use the plain compiler settings instead".
 */
export function resolveBuildProfile(
    loaded: LoadedProfiles,
    keywords?: Record<string, string>,
    settingDefault?: string
): { profile?: BuildProfile; requested?: string; unknown?: boolean } {
    const candidates = [
        keywords?.LATEX_BUILD?.trim(),
        loaded.defaultProfile?.trim(),
        settingDefault?.trim(),
    ];

    for (const requested of candidates) {
        if (!requested) continue;
        if (['none', 'nil', 'off', 'default'].includes(requested.toLowerCase())) {
            return { requested };
        }
        const profile = loaded.profiles[requested]
            // Be forgiving about case in a hand-typed keyword
            || loaded.profiles[
                Object.keys(loaded.profiles).find(
                    n => n.toLowerCase() === requested.toLowerCase()
                ) ?? ''
            ];
        if (profile) {
            return { profile, requested };
        }
        return { requested, unknown: true };
    }

    return {};
}

// =============================================================================
// Execution
// =============================================================================

/** Options for running a profile */
export interface RunProfileOptions extends BuildContext {
    /** Called before each step starts and after it finishes */
    onProgress?: (message: string) => void;
    /** Called with each step's captured output */
    onOutput?: (chunk: string) => void;
    /** Extra environment for every step */
    env?: Record<string, string>;
    /** Aborts the running step and stops the build (e.g. a cancelled progress) */
    signal?: AbortSignal;
}

/**
 * Run every step of a profile in order.
 *
 * Steps run through spawn() without a shell, so arguments are never re-parsed
 * by a shell. The caller decides whether the build succeeded (typically by
 * checking that the PDF exists) - a non-zero LaTeX exit code is common even for
 * usable output.
 */
export async function runBuildProfile(
    profile: BuildProfile,
    options: RunProfileOptions
): Promise<BuildResult> {
    const context: BuildContext = { texPath: options.texPath, outDir: options.outDir };
    const defaultCwd = path.dirname(path.resolve(options.texPath));
    const results: StepResult[] = [];

    for (const step of profile.steps) {
        if (options.signal?.aborted) {
            options.onProgress?.('Build cancelled');
            return { profileName: profile.name || 'profile', steps: results, completed: false };
        }

        const args = (step.args || []).map(arg => substituteTokens(arg, context));
        const label = step.label || step.command;
        const cwd = step.cwd ? substituteTokens(step.cwd, context) : defaultCwd;

        const skipReason = shouldSkipStep(step, context, cwd);
        if (skipReason) {
            options.onProgress?.(`Skipping ${label}: ${skipReason}`);
            results.push({ label, command: step.command, args, skipped: true, skipReason });
            continue;
        }

        options.onProgress?.(`Running ${label}...`);

        const env = {
            ...process.env,
            ...options.env,
            ...profile.env,
            ...step.env,
        };

        const outcome = await runStep(step, args, cwd, env, options.signal);
        results.push({ label, command: step.command, args, skipped: false, ...outcome });

        if (outcome.stdout) options.onOutput?.(outcome.stdout);
        if (outcome.stderr) options.onOutput?.(outcome.stderr);

        if (options.signal?.aborted) {
            options.onProgress?.('Build cancelled');
            return { profileName: profile.name || 'profile', steps: results, completed: false };
        }

        const failed = outcome.error !== undefined || (outcome.exitCode ?? 0) !== 0;
        if (failed && step.continueOnError === false) {
            options.onProgress?.(`${label} failed - stopping build`);
            return { profileName: profile.name || 'profile', steps: results, completed: false };
        }
    }

    return { profileName: profile.name || 'profile', steps: results, completed: true };
}

/**
 * Evaluate a step's guards. Returns a reason when the step should be skipped.
 */
function shouldSkipStep(
    step: BuildStep,
    context: BuildContext,
    cwd: string
): string | undefined {
    const resolveFile = (file: string) => {
        const expanded = substituteTokens(file, context);
        return path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded);
    };

    if (step.whenFileExists) {
        const target = resolveFile(step.whenFileExists);
        if (!fs.existsSync(target)) {
            return `${path.basename(target)} does not exist`;
        }
    }

    if (step.whenFileMatches) {
        const target = resolveFile(step.whenFileMatches.file);
        let content: string;
        try {
            content = fs.readFileSync(target, 'utf-8');
        } catch {
            return `${path.basename(target)} does not exist`;
        }

        const { pattern, regex } = step.whenFileMatches;
        const matched = regex
            ? safeRegexTest(pattern, content)
            : content.includes(pattern);
        if (!matched) {
            return `${path.basename(target)} does not contain ${pattern}`;
        }
    }

    return undefined;
}

/** Test a user-supplied pattern, treating an invalid regex as no match */
function safeRegexTest(pattern: string, content: string): boolean {
    try {
        return new RegExp(pattern).test(content);
    } catch {
        return false;
    }
}

/** Spawn one step and capture its output */
function runStep(
    step: BuildStep,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal
): Promise<Pick<StepResult, 'exitCode' | 'stdout' | 'stderr' | 'error'>> {
    return new Promise((resolve) => {
        // No shell: arguments are passed through verbatim, never re-parsed
        const proc = spawn(step.command, args, {
            cwd,
            env,
            timeout: step.timeoutMs ?? 180000,
            signal,
        });

        const stdout: string[] = [];
        const stderr: string[] = [];

        proc.stdout?.on('data', (data: Buffer) => stdout.push(data.toString()));
        proc.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

        proc.on('error', (error) => {
            resolve({
                error: error instanceof Error ? error.message : String(error),
                stdout: stdout.join(''),
                stderr: stderr.join(''),
            });
        });

        proc.on('close', (code) => {
            resolve({
                exitCode: code ?? undefined,
                stdout: stdout.join(''),
                stderr: stderr.join(''),
            });
        });
    });
}

/** Example file written by the "create profiles file" command */
export const EXAMPLE_PROFILES_FILE: BuildProfileFile = {
    default: 'pdflatex-bibtex',
    profiles: {
        'pdflatex-bibtex': {
            description: 'pdflatex, bibtex, pdflatex x2',
            steps: [
                { command: 'pdflatex', args: ['-interaction=nonstopmode', '-synctex=1', '%f'] },
                {
                    command: 'bibtex',
                    args: ['%b'],
                    whenFileMatches: { file: '%b.aux', pattern: '\\citation' },
                },
                { command: 'pdflatex', args: ['-interaction=nonstopmode', '-synctex=1', '%f'] },
                { command: 'pdflatex', args: ['-interaction=nonstopmode', '-synctex=1', '%f'] },
            ],
        },
        'lualatex-biber': {
            description: 'lualatex, biber, lualatex x2',
            steps: [
                { command: 'lualatex', args: ['-interaction=nonstopmode', '-synctex=1', '%f'] },
                { command: 'biber', args: ['%b'], whenFileExists: '%b.bcf' },
                { command: 'lualatex', args: ['-interaction=nonstopmode', '-synctex=1', '%f'] },
                { command: 'lualatex', args: ['-interaction=nonstopmode', '-synctex=1', '%f'] },
            ],
        },
    },
};
