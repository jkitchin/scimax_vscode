/**
 * VC Manager - git operations behind the Emacs-style C-x v commands
 *
 * Runs the git CLI directly (execFile, never a shell) so that commits can be
 * restricted to a single file, the way Emacs `vc-next-action` does. Everything
 * here is independent of the VS Code API so it can be tested against real
 * repositories.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Version-control state of a single file, as vc-next-action sees it */
export type VcFileState =
    | 'unregistered'   // not inside a git repository
    | 'untracked'      // in a repository but not added
    | 'ignored'        // matched by .gitignore
    | 'conflict'       // unmerged paths (UU, AA, ...)
    | 'edited'         // modified, added, deleted, renamed (staged or not)
    | 'up-to-date';    // tracked and clean

export interface VcFileStatus {
    state: VcFileState;
    /** Two-letter porcelain code (e.g. ' M', 'A ', 'UU'), empty when clean */
    code: string;
    /** Repository top-level directory, undefined when unregistered */
    repoRoot?: string;
}

/** The action vc-next-action will take for a file */
export type VcNextAction =
    | 'init'           // offer to create a repository
    | 'register'       // git add
    | 'resolve'        // git add a conflicted file whose markers are gone
    | 'fix-conflicts'  // conflict markers remain; send the user to fix them
    | 'commit'         // open the log buffer and commit this file
    | 'commit-merge'   // finish an in-progress merge (whole-tree commit)
    | 'ignored'        // nothing to do; tell the user why
    | 'sync';          // file is clean; push/pull if the branch has diverged

export interface AheadBehind {
    upstream?: string;
    ahead: number;
    behind: number;
}

export interface LogEntry {
    hash: string;
    shortHash: string;
    author: string;
    date: string;
    subject: string;
}

export class GitError extends Error {
    constructor(message: string, public readonly stderr: string, public readonly exitCode: number | null) {
        super(message);
        this.name = 'GitError';
    }
}

const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/**
 * Run git with an argument array in `cwd`. Rejects with GitError on a
 * non-zero exit. Terminal prompts are disabled so a missing credential fails
 * instead of hanging the extension host.
 */
export function runGit(args: string[], cwd: string, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('git', args, {
            cwd,
            timeout: timeoutMs,
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        }, (error, stdout, stderr) => {
            if (error) {
                const code = (error as { code?: unknown }).code;
                const detail = (stderr || error.message).trim();
                const name = args.find((arg) => !arg.startsWith('-')) ?? args[0];
                reject(new GitError(`git ${name} failed: ${detail}`, stderr, typeof code === 'number' ? code : null));
                return;
            }
            resolve(stdout);
        });
    });
}

/** Top-level directory of the repository containing `dir`, or undefined */
export async function findRepoRoot(dir: string): Promise<string | undefined> {
    try {
        // git prints C:/x on Windows; spell it the way path.join does
        return path.resolve((await runGit(['rev-parse', '--show-toplevel'], dir)).trim());
    } catch {
        return undefined;
    }
}

/** Classify a two-letter porcelain v1 status code */
export function classifyStatusCode(code: string): VcFileState {
    if (code === '') return 'up-to-date';
    if (code === '??') return 'untracked';
    if (code === '!!') return 'ignored';
    if (UNMERGED_CODES.has(code)) return 'conflict';
    return 'edited';
}

/** First status code in `git status --porcelain=v1 -z` output */
export function parsePorcelainCode(output: string): string {
    const first = output.split('\0')[0];
    return first.length >= 2 ? first.slice(0, 2) : '';
}

/**
 * Status of one file. Git runs from the file's directory with the basename
 * as pathspec, which sidesteps symlinked-path mismatches (e.g. /tmp vs
 * /private/tmp on macOS).
 */
export async function getFileStatus(filePath: string): Promise<VcFileStatus> {
    const dir = path.dirname(filePath);
    const repoRoot = await findRepoRoot(dir);
    if (!repoRoot) {
        return { state: 'unregistered', code: '' };
    }
    const output = await runGit(
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--', path.basename(filePath)],
        dir
    );
    const code = parsePorcelainCode(output);
    return { state: classifyStatusCode(code), code, repoRoot };
}

/** True when the text still contains git conflict markers */
export function hasConflictMarkers(text: string): boolean {
    return /^<{7}( |$)/m.test(text) && /^>{7}( |$)/m.test(text);
}

/** True when a merge is in progress (MERGE_HEAD exists) */
export async function isMergeInProgress(repoRoot: string): Promise<boolean> {
    try {
        const gitPath = (await runGit(['rev-parse', '--git-path', 'MERGE_HEAD'], repoRoot)).trim();
        return fs.existsSync(path.resolve(repoRoot, gitPath));
    } catch {
        return false;
    }
}

/**
 * Decide what vc-next-action should do, given the file state and a little
 * extra context gathered by the caller.
 */
export function decideNextAction(
    state: VcFileState,
    context: { conflictMarkers?: boolean; mergeInProgress?: boolean } = {}
): VcNextAction {
    switch (state) {
        case 'unregistered': return 'init';
        case 'untracked': return 'register';
        case 'ignored': return 'ignored';
        case 'conflict': return context.conflictMarkers ? 'fix-conflicts' : 'resolve';
        // git refuses partial commits during a merge, so the merge has to be
        // finished as a whole
        case 'edited': return context.mergeInProgress ? 'commit-merge' : 'commit';
        // A clean file during a merge (say its resolution matched HEAD):
        // the next step is still the merge commit, not a push or pull
        case 'up-to-date': return context.mergeInProgress ? 'commit-merge' : 'sync';
    }
}

/** git init in `dir` */
export async function initRepo(dir: string): Promise<void> {
    await runGit(['init'], dir);
}

/** git add one file (register, or mark a conflict resolved) */
export async function stageFile(filePath: string): Promise<void> {
    await runGit(['add', '--', path.basename(filePath)], path.dirname(filePath));
}

/**
 * Commit only `filePath`, like `git commit -- file`: the file's working-tree
 * content is committed and anything else that is staged is left staged.
 * With `filePath` undefined the whole index is committed (used to conclude a
 * merge). Returns the new commit's short hash.
 */
export async function commit(repoRoot: string, message: string, filePath?: string): Promise<string> {
    if (filePath) {
        await runGit(['commit', '-m', message, '--', path.basename(filePath)], path.dirname(filePath));
    } else {
        await runGit(['commit', '-m', message], repoRoot);
    }
    return (await runGit(['rev-parse', '--short', 'HEAD'], repoRoot)).trim();
}

/** Repository-relative paths of the files with staged changes */
export async function stagedFiles(repoRoot: string): Promise<string[]> {
    const output = await runGit(['diff', '--cached', '--name-only', '-z'], repoRoot);
    return output.split('\0').filter(Boolean);
}

/**
 * Commit everything staged, plus `filePath`'s working-tree changes when it is
 * given (it is staged first). Returns the new commit's short hash.
 */
export async function commitStaged(repoRoot: string, message: string, filePath?: string): Promise<string> {
    if (filePath) await stageFile(filePath);
    return commit(repoRoot, message);
}

/** Discard working-tree and staged changes to a tracked file */
export async function revertFile(filePath: string): Promise<void> {
    await runGit(['checkout', 'HEAD', '--', path.basename(filePath)], path.dirname(filePath));
}

/**
 * The .gitignore pattern that matches exactly `filePath`: its path relative
 * to the repository root, anchored with a leading '/', with glob and comment
 * characters escaped.
 */
export function ignorePatternFor(repoRoot: string, filePath: string): string {
    const relative = path.relative(repoRoot, filePath).split(path.sep).join('/');
    return '/' + relative.replace(/[\\*?[\]!#]/g, '\\$&').replace(/ $/, '\\ ');
}

/**
 * Append `pattern` to the repository's top-level .gitignore, creating it if
 * needed. Returns false when the exact pattern is already listed.
 */
export async function addToGitignore(repoRoot: string, pattern: string): Promise<boolean> {
    const file = path.join(repoRoot, '.gitignore');
    let existing = '';
    try {
        existing = await fs.promises.readFile(file, 'utf8');
    } catch {
        // No .gitignore yet
    }
    if (existing.split(/\r?\n/).some((line) => line.trim() === pattern)) return false;
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    await fs.promises.appendFile(file, `${separator}${pattern}\n`);
    return true;
}

/** Remove a tracked file from the index, keeping it on disk (git rm --cached) */
export async function untrackFile(filePath: string): Promise<void> {
    await runGit(['rm', '--cached', '-q', '--', path.basename(filePath)], path.dirname(filePath));
}

/** Commits the current branch is ahead of / behind its upstream */
export async function getAheadBehind(repoRoot: string): Promise<AheadBehind> {
    let upstream: string;
    try {
        upstream = (await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot)).trim();
    } catch {
        return { ahead: 0, behind: 0 };
    }
    const counts = (await runGit(['rev-list', '--left-right', '--count', '@{u}...HEAD'], repoRoot)).trim();
    const [behind, ahead] = counts.split(/\s+/).map((n) => parseInt(n, 10) || 0);
    return { upstream, ahead, behind };
}

const LOG_SEP = '\x1f';

/** Parse `git log` output written with the LOG_FORMAT below */
export function parseLog(output: string): LogEntry[] {
    return output
        .split('\x1e')
        .map((record) => record.replace(/^\n/, ''))
        .filter((record) => record.length > 0)
        .map((record) => {
            const [hash, shortHash, author, date, subject] = record.split(LOG_SEP);
            return { hash, shortHash, author, date, subject: subject ?? '' };
        });
}

const LOG_FORMAT = ['%H', '%h', '%an', '%ad', '%s'].join(LOG_SEP) + '\x1e';

/** History of one file, newest first, following renames */
export async function fileLog(filePath: string, maxCount = 200): Promise<LogEntry[]> {
    const output = await runGit(
        ['log', '--follow', `--max-count=${maxCount}`, '--date=short', `--format=${LOG_FORMAT}`, '--', path.basename(filePath)],
        path.dirname(filePath)
    );
    return parseLog(output);
}

/**
 * Where a file lived in one commit of its history and in that commit's
 * parent, as paths relative to the repository root. `before` is undefined
 * when the commit added the file (its first commit), `after` when the commit
 * deleted it. History follows renames, so the paths can differ from today's.
 */
export interface RevisionPaths {
    before?: string;
    after?: string;
}

/**
 * Parse `git log --follow --name-status --format=%x1e%H` into the paths of
 * each commit. Merge commits list no files; they get the path of the next
 * newer commit (or `current`).
 */
export function parseRevisionPaths(output: string, current: string): Map<string, RevisionPaths> {
    const result = new Map<string, RevisionPaths>();
    let latest = current;
    for (const record of output.split('\x1e')) {
        const lines = record.split(/\r?\n/).filter((l) => l.trim());
        const hash = lines.shift()?.trim();
        if (!hash) continue;
        const status = lines.map((l) => l.split('\t')).find((f) => f.length >= 2);
        if (!status) {
            result.set(hash, { before: latest, after: latest });
            continue;
        }
        const code = status[0][0];
        if (code === 'A') {
            result.set(hash, { after: status[1] });
            latest = status[1];
        } else if (code === 'D') {
            result.set(hash, { before: status[1] });
            latest = status[1];
        } else if ((code === 'R' || code === 'C') && status.length >= 3) {
            result.set(hash, { before: status[1], after: status[2] });
            latest = status[1];
        } else {
            result.set(hash, { before: status[1], after: status[1] });
            latest = status[1];
        }
    }
    return result;
}

/** The file's paths before and after `hash` (see RevisionPaths) */
export async function revisionPaths(filePath: string, hash: string): Promise<RevisionPaths & { root: string }> {
    const dir = path.dirname(filePath);
    const root = await findRepoRoot(dir);
    if (!root) throw new Error(`${path.basename(filePath)} is not in a git repository`);
    const current = path.relative(root, path.resolve(filePath)).split(path.sep).join('/');
    const output = await runGit(
        ['-c', 'core.quotePath=false', 'log', '--follow', '--name-status', '--format=%x1e%H', '--', path.basename(filePath)],
        dir
    );
    const paths = parseRevisionPaths(output, current).get(hash) ?? { before: current, after: current };
    return { root, ...paths };
}

/** One-line summary of what a commit of this file would include */
export async function diffStat(filePath: string): Promise<string> {
    try {
        return (await runGit(['diff', 'HEAD', '--stat', '--', path.basename(filePath)], path.dirname(filePath))).trimEnd();
    } catch {
        // Unborn branch: there is no HEAD to diff against
        return '';
    }
}

/** What C-x v = does for a file: open a diff, or explain why there is none */
export type VcDiffPlan =
    | { kind: 'message'; text: string }
    | { kind: 'sideBySide' }   // HEAD on the left, the working file on the right
    | { kind: 'patch' };       // no HEAD version (added) or no working file (deleted)

export function planDiff(status: VcFileStatus, name: string): VcDiffPlan {
    switch (status.state) {
        case 'unregistered':
            return { kind: 'message', text: `${name} is not in a git repository` };
        case 'untracked':
            return { kind: 'message', text: `${name} is not tracked by git (C-x v v adds it)` };
        case 'ignored':
            return { kind: 'message', text: `${name} is ignored by git` };
        case 'up-to-date':
            return { kind: 'message', text: `No changes between HEAD and ${name}` };
        default:
            return status.code.includes('A') || status.code.includes('D')
                ? { kind: 'patch' }
                : { kind: 'sideBySide' };
    }
}

/** The file's changes against HEAD as a patch (against the index on an unborn branch) */
export async function diffPatch(filePath: string): Promise<string> {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath);
    try {
        return await runGit(['diff', 'HEAD', '--', name], dir);
    } catch {
        return runGit(['diff', '--cached', '--', name], dir);
    }
}

/**
 * Turn the log buffer's text into a commit message: drop comment lines,
 * trim trailing whitespace, and collapse runs of blank lines.
 */
export function cleanCommitMessage(text: string): string {
    const lines = text
        .split(/\r?\n/)
        .filter((line) => !line.startsWith('#'))
        .map((line) => line.trimEnd());
    const collapsed: string[] = [];
    for (const line of lines) {
        if (line === '' && (collapsed.length === 0 || collapsed[collapsed.length - 1] === '')) continue;
        collapsed.push(line);
    }
    while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop();
    return collapsed.join('\n');
}

// ---------------------------------------------------------------------------
// Filesets: several files (or directories) at once, as from dired marks, the
// Explorer's multi-selection, or vc-dir
// ---------------------------------------------------------------------------

/** One record of `git status --porcelain=v1 -z` (paths relative to the repository root) */
export interface PorcelainRecord {
    code: string;
    rel: string;
    /** The old path of a rename or copy */
    origRel?: string;
}

/** Parse all records of `git status --porcelain=v1 -z` output */
export function parsePorcelain(output: string): PorcelainRecord[] {
    const fields = output.split('\0');
    const records: PorcelainRecord[] = [];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field.length < 4) continue;
        const record: PorcelainRecord = { code: field.slice(0, 2), rel: field.slice(3) };
        // A rename or copy is followed by its source path: "R  new\0old\0"
        if (/[RC]/.test(record.code)) record.origRel = fields[++i];
        records.push(record);
    }
    return records;
}

/**
 * The word vc-dir shows for a status code: edited, added, removed, renamed,
 * untracked, ignored or conflict, with ", staged" when all of the change is
 * in the index and ", part staged" when some of it is.
 */
export function vcStatusLabel(code: string): string {
    const state = classifyStatusCode(code);
    if (state !== 'edited') return state === 'up-to-date' ? '' : state;
    const [x, y] = code;
    const kind = x === 'A' || y === 'A' || x === 'C' ? 'added'
        : x === 'D' || y === 'D' ? 'removed'
            : x === 'R' ? 'renamed'
                : 'edited';
    const staged = x !== ' ';
    const unstaged = y !== ' ';
    return staged && unstaged ? `${kind}, part staged` : staged ? `${kind}, staged` : kind;
}

/** A path's place in its repository */
export interface RepoLocation {
    /** Repository top level as git reports it (symlinks resolved) */
    root: string;
    /** The same directory, spelled the way the caller's path spells it */
    displayRoot: string;
    /** Path relative to the root with '/' separators; '' for the root itself */
    rel: string;
}

async function isDirectory(p: string): Promise<boolean> {
    try {
        return (await fs.promises.stat(p)).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Where `p` sits in its repository, or undefined outside one. Works for
 * files that no longer exist (a deletion) by starting from the nearest
 * directory that does. The relative path comes from git's own prefix, so a
 * path through a symlink (~/Dropbox, /tmp on macOS) still matches git's paths.
 */
export async function locateInRepo(p: string): Promise<RepoLocation | undefined> {
    const target = path.resolve(p);
    let start = await isDirectory(target) ? target : path.dirname(target);
    while (!await isDirectory(start)) {
        const parent = path.dirname(start);
        if (parent === start) return undefined;
        start = parent;
    }
    let output: string;
    try {
        output = await runGit(['rev-parse', '--show-toplevel', '--show-prefix'], start);
    } catch {
        return undefined;
    }
    const [gitRoot, prefix = ''] = output.split(/\r?\n/);
    const root = path.resolve(gitRoot.trim());
    const prefixParts = prefix.split('/').filter(Boolean);
    const displayRoot = prefixParts.length > 0 ? path.resolve(start, ...prefixParts.map(() => '..')) : start;
    const below = path.relative(start, target).split(path.sep).filter(Boolean);
    const rel = [...prefixParts, ...below].join('/');
    return { root, displayRoot, rel };
}

/** Pathspecs for repository-relative paths ('' is the whole repository) */
function pathspecs(rels: string[]): string[] {
    return rels.map((rel) => rel || '.');
}

/** git with pathspecs taken literally (a file named '*.txt' or ':x') */
function runGitLiteral(args: string[], cwd: string): Promise<string> {
    return runGit(['--literal-pathspecs', ...args], cwd);
}

export interface FilesetEntry {
    /** Absolute path, spelled like the caller's paths */
    path: string;
    rel: string;
    code: string;
    state: VcFileState;
    origRel?: string;
}

export interface FilesetStatus {
    /** Set when every path is in one repository */
    repoRoot?: string;
    displayRoot?: string;
    /** Every repository the paths are in */
    repos: string[];
    /** The changed files under the paths, plus each named file (up-to-date or ignored when unchanged) */
    entries: FilesetEntry[];
    /** Paths outside any repository */
    unregistered: string[];
}

/**
 * Status of a set of files and directories with one `git status` call. A
 * directory stands for every file below it, as in Emacs vc on a fileset.
 */
export async function getFilesetStatus(paths: string[]): Promise<FilesetStatus> {
    const located: (RepoLocation & { input: string; isDir: boolean })[] = [];
    const unregistered: string[] = [];
    for (const p of paths) {
        const location = await locateInRepo(p);
        if (location) located.push({ ...location, input: p, isDir: await isDirectory(p) });
        else unregistered.push(p);
    }
    const repos = [...new Set(located.map((l) => l.root))];
    if (repos.length !== 1) return { repos, entries: [], unregistered };

    const { root, displayRoot } = located[0];
    const rels = [...new Set(located.map((l) => l.rel))];
    const output = await runGitLiteral(
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...pathspecs(rels)], root);
    const toPath = (rel: string) => path.join(displayRoot, ...rel.split('/'));
    const records = parsePorcelain(output);
    // git only pairs a rename up when both paths are in the pathspec, so ask
    // the whole index which added files are renames
    if (records.some((r) => r.code[0] === 'A')) {
        const index = parsePorcelain(await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=no'], root));
        for (const record of records) {
            const rename = index.find((r) => r.rel === record.rel && r.origRel);
            if (record.code[0] === 'A' && rename) {
                record.code = rename.code;
                record.origRel = rename.origRel;
            }
        }
    }
    const entries: FilesetEntry[] = records.map((r) => ({
        path: toPath(r.rel), rel: r.rel, code: r.code, state: classifyStatusCode(r.code), origRel: r.origRel,
    }));

    // Named files git did not list are clean or ignored
    const listed = new Set(entries.map((e) => e.rel));
    const quiet = located.filter((l) => !l.isDir && !listed.has(l.rel)).map((l) => l.rel);
    const ignored = new Set<string>();
    if (quiet.length > 0) {
        try {
            const out = await runGit(['-c', 'core.quotePath=false', 'check-ignore', '--', ...quiet], root);
            out.split('\n').filter(Boolean).forEach((rel) => ignored.add(rel));
        } catch {
            // Exit status 1: none of them is ignored
        }
    }
    for (const rel of new Set(quiet)) {
        const isIgnored = ignored.has(rel);
        entries.push({ path: toPath(rel), rel, code: isIgnored ? '!!' : '', state: isIgnored ? 'ignored' : 'up-to-date' });
    }
    return { repoRoot: root, displayRoot, repos, entries, unregistered };
}

/** What C-x v v does with a fileset */
export type FilesetAction =
    | { kind: 'register'; rels: string[] }
    | { kind: 'resolve'; rels: string[] }
    | { kind: 'fix-conflicts'; rels: string[] }
    | { kind: 'commit'; rels: string[] }
    | { kind: 'commit-merge' }
    | { kind: 'ignored'; rels: string[] }
    | { kind: 'sync' }
    | { kind: 'mixed'; groups: Partial<Record<VcFileState, string[]>> };

/**
 * vc-next-action on a fileset: every changed file has to be in the same
 * state, as in Emacs. Unchanged files in the set are left out.
 */
export function decideFilesetAction(
    entries: FilesetEntry[],
    context: { withMarkers?: Set<string>; mergeInProgress?: boolean } = {}
): FilesetAction {
    const active = entries.filter((e) => e.state !== 'up-to-date');
    if (active.length === 0) return context.mergeInProgress ? { kind: 'commit-merge' } : { kind: 'sync' };
    const groups: Partial<Record<VcFileState, string[]>> = {};
    for (const e of active) (groups[e.state] ??= []).push(e.rel);
    const states = Object.keys(groups) as VcFileState[];
    if (states.length > 1) return { kind: 'mixed', groups };
    const rels = active.map((e) => e.rel);
    switch (states[0]) {
        case 'untracked': return { kind: 'register', rels };
        case 'ignored': return { kind: 'ignored', rels };
        case 'conflict': {
            const marked = rels.filter((rel) => context.withMarkers?.has(rel));
            return marked.length > 0 ? { kind: 'fix-conflicts', rels: marked } : { kind: 'resolve', rels };
        }
        case 'edited':
            if (context.mergeInProgress) return { kind: 'commit-merge' };
            // A rename is committed as the new path plus the removal of the old one
            return { kind: 'commit', rels: [...new Set(active.flatMap((e) => e.origRel ? [e.rel, e.origRel] : [e.rel]))] };
        default:
            return { kind: 'mixed', groups };
    }
}

/** git add the paths (new files, changes and deletions) */
export async function stagePaths(repoRoot: string, rels: string[]): Promise<void> {
    await runGitLiteral(['add', '--all', '--', ...pathspecs(rels)], repoRoot);
}

/** Take the paths' changes out of the index, leaving the working files alone */
export async function unstagePaths(repoRoot: string, rels: string[]): Promise<void> {
    try {
        await runGitLiteral(['restore', '--staged', '--', ...pathspecs(rels)], repoRoot);
    } catch {
        // Unborn branch: there is no HEAD to restore from
        await runGitLiteral(['rm', '--cached', '-r', '-q', '--', ...pathspecs(rels)], repoRoot);
    }
}

/**
 * Commit exactly these paths' working-tree content (`git commit -- paths`);
 * anything else staged stays staged. Returns the short hash.
 */
export async function commitPaths(repoRoot: string, message: string, rels: string[]): Promise<string> {
    await runGitLiteral(['commit', '-m', message, '--', ...pathspecs(rels)], repoRoot);
    return (await runGit(['rev-parse', '--short', 'HEAD'], repoRoot)).trim();
}

/**
 * Discard the changes to tracked files. A newly added file is taken out of
 * the index and kept on disk (vc-revert unregisters it); a staged rename is
 * undone.
 */
export async function revertPaths(repoRoot: string, entries: FilesetEntry[]): Promise<void> {
    const unregister: string[] = [];
    const restore: string[] = [];
    for (const e of entries) {
        if (e.code[0] === 'A') {
            unregister.push(e.rel);
        } else if (e.code[0] === 'R' && e.origRel) {
            unregister.push(e.rel);
            restore.push(e.origRel);
        } else {
            restore.push(e.rel);
        }
    }
    if (unregister.length > 0) await runGitLiteral(['rm', '--cached', '-q', '--', ...unregister], repoRoot);
    if (restore.length > 0) await runGitLiteral(['checkout', 'HEAD', '--', ...restore], repoRoot);
}

/** Remove paths from the index, keeping them on disk */
export async function untrackPaths(repoRoot: string, rels: string[]): Promise<void> {
    await runGitLiteral(['rm', '--cached', '-r', '-q', '--', ...pathspecs(rels)], repoRoot);
}

/** Commits that touch any of the paths, newest first */
export async function pathsLog(repoRoot: string, rels: string[], maxCount = 200): Promise<LogEntry[]> {
    const output = await runGitLiteral(
        ['log', `--max-count=${maxCount}`, '--date=short', `--format=${LOG_FORMAT}`, '--', ...pathspecs(rels)], repoRoot);
    return parseLog(output);
}

/** The files a commit changed among the paths, with their status letter (A, M, D, ...) */
export async function commitChanges(repoRoot: string, hash: string, rels: string[]): Promise<{ status: string; rel: string }[]> {
    const output = await runGitLiteral(
        ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '--no-renames', '--root', hash, '--', ...pathspecs(rels)],
        repoRoot);
    const fields = output.split('\0').filter(Boolean);
    const changes: { status: string; rel: string }[] = [];
    for (let i = 0; i + 1 < fields.length; i += 2) changes.push({ status: fields[i], rel: fields[i + 1] });
    return changes;
}

/** `git diff HEAD --stat` for the paths ('' on an unborn branch) */
export async function diffStatPaths(repoRoot: string, rels: string[]): Promise<string> {
    try {
        return (await runGitLiteral(['diff', 'HEAD', '--stat', '--', ...pathspecs(rels)], repoRoot)).trimEnd();
    } catch {
        return '';
    }
}

/** The paths' changes against HEAD as one patch (against the index on an unborn branch) */
export async function pathsPatch(repoRoot: string, rels: string[]): Promise<string> {
    try {
        return await runGitLiteral(['diff', 'HEAD', '--', ...pathspecs(rels)], repoRoot);
    } catch {
        return runGitLiteral(['diff', '--cached', '--', ...pathspecs(rels)], repoRoot);
    }
}

/** Status shown for a dired entry */
export interface VcEntryStatus {
    state: VcFileState;
    label: string;
    code: string;
}

const STATE_RANK: Partial<Record<VcFileState, number>> = { conflict: 3, edited: 2, untracked: 1 };

/**
 * Git status of each entry of a directory listing, keyed by name, for the
 * dired status column. A directory shows the most pressing state below it
 * (conflict, then edited, then untracked); clean entries are left out.
 * Undefined when the directory is not in a repository.
 */
export async function directoryVcStatus(dir: string): Promise<Map<string, VcEntryStatus> | undefined> {
    const location = await locateInRepo(dir);
    if (!location) return undefined;
    const prefix = location.rel ? location.rel + '/' : '';
    const output = await runGit(
        ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignored=traditional', '--', '.'], dir);
    const result = new Map<string, VcEntryStatus>();
    for (const record of parsePorcelain(output)) {
        if (!record.rel.startsWith(prefix)) continue;
        const rest = record.rel.slice(prefix.length).replace(/\/$/, '');
        const slash = rest.indexOf('/');
        const state = classifyStatusCode(record.code);
        if (slash < 0) {
            result.set(rest, { state, label: vcStatusLabel(record.code), code: record.code });
            continue;
        }
        // Something below a directory: summarize it (ignored files inside a
        // tracked directory say nothing about the directory)
        const name = rest.slice(0, slash);
        const rank = STATE_RANK[state];
        if (!rank) continue;
        const current = result.get(name);
        if (!current || (STATE_RANK[current.state] ?? 0) < rank) {
            result.set(name, { state, label: state, code: '' });
        }
    }
    return result;
}

/** The repository's changed files, for vc-dir */
export interface RepoChanges {
    root: string;
    displayRoot: string;
    branch: string;
    records: PorcelainRecord[];
}

export async function repoChanges(dir: string): Promise<RepoChanges | undefined> {
    const location = await locateInRepo(dir);
    if (!location) return undefined;
    const output = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], location.root);
    let branch: string;
    try {
        branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], location.root)).trim();
    } catch {
        branch = 'detached HEAD';
    }
    return { root: location.root, displayRoot: location.displayRoot, branch, records: parsePorcelain(output) };
}
