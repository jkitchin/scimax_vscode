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
                reject(new GitError(`git ${args[0]} failed: ${detail}`, stderr, typeof code === 'number' ? code : null));
                return;
            }
            resolve(stdout);
        });
    });
}

/** Top-level directory of the repository containing `dir`, or undefined */
export async function findRepoRoot(dir: string): Promise<string | undefined> {
    try {
        return (await runGit(['rev-parse', '--show-toplevel'], dir)).trim();
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
        case 'up-to-date': return 'sync';
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

/** Discard working-tree and staged changes to a tracked file */
export async function revertFile(filePath: string): Promise<void> {
    await runGit(['checkout', 'HEAD', '--', path.basename(filePath)], path.dirname(filePath));
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

/** One-line summary of what a commit of this file would include */
export async function diffStat(filePath: string): Promise<string> {
    try {
        return (await runGit(['diff', 'HEAD', '--stat', '--', path.basename(filePath)], path.dirname(filePath))).trimEnd();
    } catch {
        // Unborn branch: there is no HEAD to diff against
        return '';
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
