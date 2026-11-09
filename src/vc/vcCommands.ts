/**
 * VC Commands - Emacs-style version control on the C-x v prefix
 *
 * C-x v v runs scimax.vc.nextAction, the counterpart of Emacs
 * `vc-next-action`: it looks at the current file's state and registers,
 * commits, resolves, or syncs it. The other commands mirror the scimax
 * additions to vc-prefix-map (push, pull, magit-status) and the standard
 * C-x v bindings (=, l, u, g, d), delegating to the built-in git extension
 * where it already does the job.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { VcLogBuffer } from './vcLogBuffer';
import { registerSmergeCommands } from './smergeMode';
import { DiredPanel } from '../dired/diredPanel';
import {
    addToGitignore,
    commit,
    commitChanges,
    commitPaths,
    commitStaged,
    decideFilesetAction,
    decideNextAction,
    diffStatPaths,
    FilesetEntry,
    FilesetStatus,
    getFilesetStatus,
    diffPatch,
    diffStat,
    fileLog,
    findRepoRoot,
    getAheadBehind,
    getFileStatus,
    hasConflictMarkers,
    ignorePatternFor,
    initRepo,
    isMergeInProgress,
    locateInRepo,
    pathsLog,
    pathsPatch,
    planDiff,
    revertFile,
    revertPaths,
    runGit,
    stageFile,
    stagedFiles,
    stagePaths,
    unstagePaths,
    untrackFile,
    untrackPaths,
    VcFileState,
} from './vcManager';

const log = createLogger('VC');

/** Minimal slice of the built-in git extension API (vscode.git, v1) */
interface GitApi {
    toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
    getRepository(uri: vscode.Uri): unknown | null;
    openRepository?(root: vscode.Uri): Promise<unknown | null>;
}

function getGitApi(): GitApi | undefined {
    const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
    if (!extension?.isActive) return undefined;
    try {
        return extension.exports.getAPI(1);
    } catch {
        return undefined;
    }
}

/**
 * Make sure the git extension has opened the repository containing `uri`.
 * It skips repositories above the workspace folder (a folder inside a repo,
 * with git.openRepositoryInParentFolders at its default), and its commands
 * then fail with "There are no available repositories".
 */
async function ensureRepositoryOpen(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== 'file') return;
    const api = getGitApi();
    if (!api || api.getRepository(uri)) return;
    let dir = path.dirname(uri.fsPath);
    try {
        if ((await fs.promises.stat(uri.fsPath)).isDirectory()) dir = uri.fsPath;
    } catch {
        // A deleted file: its directory is still the place to look
    }
    const root = await findRepoRoot(dir);
    if (!root) return;
    log.debug('Opening repository for git extension', { root });
    if (api.openRepository) {
        await api.openRepository(vscode.Uri.file(root));
    } else {
        await vscode.commands.executeCommand('git.openRepository', root);
    }
}

/** Run a built-in git command on the repository containing `uri` */
async function gitCommand(command: string, uri: vscode.Uri | undefined): Promise<void> {
    if (uri) await ensureRepositoryOpen(uri);
    await vscode.commands.executeCommand(command, uri);
}

/** The file a VC command acts on: an explorer/argument URI, else the active editor */
function targetFile(uri?: vscode.Uri): vscode.Uri | undefined {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== 'file') {
        vscode.window.showWarningMessage('Version control needs a file saved on disk');
        return undefined;
    }
    return target;
}

/** Save the file's editor buffer first, as vc does before acting on a file */
async function saveIfDirty(uri: vscode.Uri): Promise<void> {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (doc?.isDirty) {
        await doc.save();
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function offerInit(file: string): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath;
    const dir = folder ?? path.dirname(file);
    const choice = await vscode.window.showInformationMessage(
        `${path.basename(file)} is not in a git repository. Create one in ${dir}?`,
        'Create Repository'
    );
    if (choice !== 'Create Repository') return;
    await initRepo(dir);
    await stageFile(file);
    vscode.window.showInformationMessage(`Created repository in ${dir} and registered ${path.basename(file)}`);
}

/**
 * What a commit from the log buffer includes: just the file (vc-next-action),
 * everything staged to conclude a merge, or everything staged plus the file
 * when other changes are already staged.
 */
type CommitScope =
    | { kind: 'file' }
    | { kind: 'merge' }
    | { kind: 'staged'; staged: string[]; includeFile: boolean };

async function openCommitBuffer(
    logBuffer: VcLogBuffer,
    file: string,
    repoRoot: string,
    scope: CommitScope
): Promise<void> {
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    let summary: string[];
    if (scope.kind === 'merge') {
        summary = ['Concluding merge: all staged changes will be committed', `Repository: ${repoRoot}`];
    } else if (scope.kind === 'staged') {
        const files = scope.includeFile && !scope.staged.includes(relative)
            ? [...scope.staged, relative] : scope.staged;
        summary = [`Committing all staged changes (${files.length} file${files.length === 1 ? '' : 's'}):`,
            ...files.map((f) => `  ${f}`), `Repository: ${repoRoot}`];
    } else {
        summary = [`Committing: ${relative}`, `Repository: ${repoRoot}`];
        const stat = await diffStat(file);
        if (stat) summary.push('', ...stat.split('\n'));
    }
    await logBuffer.open({
        summary,
        onCommit: async (message) => {
            if (scope.kind === 'file') {
                const hash = await commit(repoRoot, message, file);
                log.info('Committed', { hash, file: relative });
                vscode.window.showInformationMessage(`Committed ${relative} (${hash})`);
                DiredPanel.refreshVc();
            } else if (scope.kind === 'merge') {
                const hash = await commit(repoRoot, message);
                log.info('Committed merge', { hash });
                vscode.window.showInformationMessage(`Committed merge ${hash}`);
                DiredPanel.refreshVc();
            } else {
                const hash = await commitStaged(repoRoot, message, scope.includeFile ? file : undefined);
                log.info('Committed staged changes', { hash });
                vscode.window.showInformationMessage(`Committed staged changes (${hash})`);
                DiredPanel.refreshVc();
            }
        },
    });
}

/** Clean file: push or pull if the branch has diverged from its upstream */
async function syncBranch(uri: vscode.Uri, repoRoot: string): Promise<void> {
    const name = path.basename(uri.fsPath);
    const { upstream, ahead, behind } = await getAheadBehind(repoRoot);
    if (!upstream) {
        const choice = await vscode.window.showInformationMessage(
            `${name} is up to date. The branch has no upstream.`, 'Push'
        );
        if (choice === 'Push') await gitCommand('git.push', uri);
        return;
    }
    if (ahead > 0 && behind > 0) {
        const choice = await vscode.window.showInformationMessage(
            `${name} is up to date. Branch has diverged from ${upstream}: ${ahead} ahead, ${behind} behind.`, 'Sync'
        );
        if (choice === 'Sync') await gitCommand('git.sync', uri);
    } else if (ahead > 0) {
        const choice = await vscode.window.showInformationMessage(
            `${name} is up to date. ${ahead} commit${ahead === 1 ? '' : 's'} not pushed to ${upstream}.`, 'Push'
        );
        if (choice === 'Push') await gitCommand('git.push', uri);
    } else if (behind > 0) {
        const choice = await vscode.window.showInformationMessage(
            `${name} is up to date. ${behind} commit${behind === 1 ? '' : 's'} to pull from ${upstream}.`, 'Pull'
        );
        if (choice === 'Pull') await gitCommand('git.pull', uri);
    } else {
        vscode.window.showInformationMessage(`${name} is up to date with ${upstream}`);
    }
}

async function nextAction(logBuffer: VcLogBuffer, uri?: vscode.Uri): Promise<void> {
    const target = targetFile(uri);
    if (!target) return;
    const file = target.fsPath;
    const name = path.basename(file);
    await saveIfDirty(target);

    const status = await getFileStatus(file);
    let conflictMarkers = false;
    if (status.state === 'conflict') {
        const doc = await vscode.workspace.openTextDocument(target);
        conflictMarkers = hasConflictMarkers(doc.getText());
    }
    const mergeInProgress = status.state === 'edited' && !!status.repoRoot
        && await isMergeInProgress(status.repoRoot);
    const action = decideNextAction(status.state, { conflictMarkers, mergeInProgress });
    log.debug('Next action', { file, state: status.state, code: status.code, action });
    // Other files already staged: commit them along with this one rather than
    // leaving them behind (or offering to push past them)
    const relative = status.repoRoot ? path.relative(status.repoRoot, file).split(path.sep).join('/') : '';
    const staged = (action === 'commit' || action === 'sync') && status.repoRoot
        ? await stagedFiles(status.repoRoot) : [];
    if (staged.length === 1 && staged[0] === relative) staged.length = 0;

    switch (action) {
        case 'init':
            await offerInit(file);
            break;
        case 'register':
            await stageFile(file);
            vscode.window.showInformationMessage(`Registered ${name} (git add)`);
            break;
        case 'resolve':
            await stageFile(file);
            vscode.window.showInformationMessage(`Marked ${name} as resolved`);
            break;
        case 'fix-conflicts': {
            const choice = await vscode.window.showWarningMessage(
                `${name} still has conflict markers. Resolve them, then run C-x v v again.`,
                'Go to First Conflict',
                'Open Merge Editor'
            );
            if (choice === 'Open Merge Editor') {
                await gitCommand('git.openMergeEditor', target);
            } else if (choice === 'Go to First Conflict') {
                // smerge mode: single keys at the marker line resolve it
                await vscode.window.showTextDocument(target);
                await vscode.commands.executeCommand('scimax.smerge.first');
            }
            break;
        }
        case 'commit':
            await openCommitBuffer(logBuffer, file, status.repoRoot!, staged.length > 0
                ? { kind: 'staged', staged, includeFile: true }
                : { kind: 'file' });
            break;
        case 'commit-merge':
            await openCommitBuffer(logBuffer, file, status.repoRoot!, { kind: 'merge' });
            break;
        case 'ignored':
            vscode.window.showInformationMessage(`${name} is ignored by git`);
            break;
        case 'sync':
            if (staged.length > 0) {
                await openCommitBuffer(logBuffer, file, status.repoRoot!, { kind: 'staged', staged, includeFile: false });
            } else {
                await syncBranch(target, status.repoRoot!);
            }
            break;
    }
}

/** C-x v l: pick a commit from the file's history and show its change */
async function showFileLog(uri?: vscode.Uri): Promise<void> {
    const target = targetFile(uri);
    if (!target) return;
    const file = target.fsPath;
    const entries = await fileLog(file);
    if (entries.length === 0) {
        vscode.window.showInformationMessage(`${path.basename(file)} has no commits`);
        return;
    }
    const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
            label: entry.subject,
            description: `${entry.shortHash}  ${entry.date}  ${entry.author}`,
            entry,
        })),
        { placeHolder: `History of ${path.basename(file)}`, matchOnDescription: true }
    );
    if (!picked) return;
    const { hash, shortHash } = picked.entry;

    await ensureRepositoryOpen(target);
    const api = getGitApi();
    if (api?.getRepository(target)) {
        await vscode.commands.executeCommand(
            'vscode.diff',
            api.toGitUri(target, `${hash}^`),
            api.toGitUri(target, hash),
            `${path.basename(file)} (${shortHash})`
        );
        return;
    }
    // Without the git extension, show the commit as a patch
    const patch = await runGit(['show', hash, '--', path.basename(file)], path.dirname(file));
    const doc = await vscode.workspace.openTextDocument({ language: 'diff', content: patch });
    await vscode.window.showTextDocument(doc, { preview: true });
}

/**
 * C-x v =: diff the file against HEAD (vc-diff). The diff is opened here
 * rather than with git.openChange, which silently does nothing when the git
 * extension does not list the file as changed (a clean file, or a repository
 * it has just opened and not yet scanned).
 */
async function diff(uri?: vscode.Uri): Promise<void> {
    const target = targetFile(uri);
    if (!target) return;
    await saveIfDirty(target);
    const file = target.fsPath;
    const name = path.basename(file);
    const plan = planDiff(await getFileStatus(file), name);
    if (plan.kind === 'message') {
        vscode.window.showInformationMessage(plan.text);
        return;
    }
    if (plan.kind === 'sideBySide') {
        await ensureRepositoryOpen(target);
        const api = getGitApi();
        if (api?.getRepository(target)) {
            await vscode.commands.executeCommand(
                'vscode.diff',
                api.toGitUri(target, 'HEAD'),
                target,
                `${name} (HEAD ↔ working file)`
            );
            return;
        }
    }
    const patch = await diffPatch(file);
    if (!patch.trim()) {
        vscode.window.showInformationMessage(`No changes between HEAD and ${name}`);
        return;
    }
    const doc = await vscode.workspace.openTextDocument({ language: 'diff', content: patch });
    await vscode.window.showTextDocument(doc, { preview: true });
}

/** C-x v u: discard changes to the file, after confirmation */
async function revert(uri?: vscode.Uri): Promise<void> {
    const target = targetFile(uri);
    if (!target) return;
    const file = target.fsPath;
    const name = path.basename(file);
    const status = await getFileStatus(file);
    if (status.state === 'up-to-date') {
        vscode.window.showInformationMessage(`${name} has no changes to revert`);
        return;
    }
    if (status.state !== 'edited' && status.state !== 'conflict') {
        vscode.window.showWarningMessage(`${name} is not a tracked file with changes`);
        return;
    }
    const choice = await vscode.window.showWarningMessage(
        `Discard all changes to ${name}, including staged and unsaved changes?`,
        { modal: true },
        'Discard Changes'
    );
    if (choice !== 'Discard Changes') return;

    await revertFile(file);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target.toString());
    if (doc?.isDirty) {
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }
    vscode.window.showInformationMessage(`Reverted ${name}`);
}

/** C-x v i: add the file (or an edited pattern) to the repository's .gitignore */
async function ignore(uri?: vscode.Uri): Promise<void> {
    const target = targetFile(uri);
    if (!target) return;
    const file = target.fsPath;
    const name = path.basename(file);
    const status = await getFileStatus(file);
    if (!status.repoRoot) {
        vscode.window.showWarningMessage(`${name} is not in a git repository`);
        return;
    }
    if (status.state === 'ignored') {
        vscode.window.showInformationMessage(`${name} is already ignored by git`);
        return;
    }
    const pattern = (await vscode.window.showInputBox({
        prompt: 'Pattern to add to .gitignore',
        value: ignorePatternFor(status.repoRoot, file),
    }))?.trim();
    if (!pattern) return;

    if (!await addToGitignore(status.repoRoot, pattern)) {
        vscode.window.showInformationMessage(`.gitignore already lists ${pattern}`);
        return;
    }
    log.info('Ignored', { pattern });
    // .gitignore has no effect on a file git already tracks
    const tracked = status.state === 'up-to-date' || status.state === 'edited' || status.state === 'conflict';
    if (!tracked || status.code.startsWith('A')) {
        if (status.code.startsWith('A')) await untrackFile(file);
        vscode.window.showInformationMessage(`Added ${pattern} to .gitignore`);
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        `Added ${pattern} to .gitignore. ${name} is already tracked, so git keeps tracking it until it is removed from the index.`,
        'Stop Tracking'
    );
    if (choice === 'Stop Tracking') {
        await untrackFile(file);
        vscode.window.showInformationMessage(`${name} is no longer tracked (the file stays on disk)`);
    }
}

/** C-x v g: toggle line-by-line blame (vc-annotate) */
async function annotate(uri?: vscode.Uri): Promise<void> {
    const target = targetFile(uri);
    if (!target) return;
    // Blame acts on the active editor, so bring a right-clicked file forward
    if (vscode.window.activeTextEditor?.document.uri.toString() !== target.toString()) {
        await vscode.window.showTextDocument(target);
    }
    await ensureRepositoryOpen(target);
    const available = await vscode.commands.getCommands(true);
    for (const command of ['git.blame.toggleEditorDecoration', 'gitlens.toggleFileBlame']) {
        if (available.includes(command)) {
            await vscode.commands.executeCommand(command);
            return;
        }
    }
    vscode.window.showWarningMessage('No blame command available; enable the built-in Git extension');
}

/** Open the active file's repository in the git extension, if there is one */
async function openActiveRepository(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) await ensureRepositoryOpen(uri);
}

/** C-x v t: magit-status via edamagit when installed, else the Source Control view */
async function status(): Promise<void> {
    // edamagit, like the Source Control view, only sees repositories the git
    // extension has opened
    await openActiveRepository();
    if (vscode.extensions.getExtension('kahole.magit')) {
        await vscode.commands.executeCommand('magit.status');
    } else {
        await vscode.commands.executeCommand('workbench.view.scm');
    }
}

// ---------------------------------------------------------------------------
// Filesets: several files at once (dired marks, Explorer multi-select, vc-dir)
// ---------------------------------------------------------------------------

/**
 * What a C-x v command acts on, in order: an Explorer multi-selection or the
 * fileset dired passes, a single URI argument, the marked files (or the file
 * at point) in the focused dired, and finally the active editor's file.
 */
function resolveTargets(uri?: unknown, uris?: unknown): vscode.Uri[] | undefined {
    let targets: vscode.Uri[] = [];
    if (Array.isArray(uris) && uris.length > 0 && uris.every((u) => u instanceof vscode.Uri)) {
        targets = uris as vscode.Uri[];
    } else if (uri instanceof vscode.Uri) {
        targets = [uri];
    } else {
        const dired = DiredPanel.vcFileset();
        if (dired && dired.length > 0) {
            targets = dired.map((p) => vscode.Uri.file(p));
        } else if (vscode.window.activeTextEditor) {
            targets = [vscode.window.activeTextEditor.document.uri];
        }
    }
    targets = targets.filter((t) => t.scheme === 'file');
    if (targets.length === 0) {
        vscode.window.showWarningMessage('Version control needs a file saved on disk');
        return undefined;
    }
    return targets;
}

/** The one file in `targets`, or undefined for several files or a directory */
async function singleFile(targets: vscode.Uri[]): Promise<vscode.Uri | undefined> {
    if (targets.length !== 1) return undefined;
    try {
        if ((await fs.promises.stat(targets[0].fsPath)).isDirectory()) return undefined;
    } catch {
        // A deleted file is still a file
    }
    return targets[0];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Name up to `max` paths, then say how many more */
function nameList(rels: string[], max = 6): string {
    const names = rels.map((r) => r || '.');
    return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/** Fileset status in a single repository, or undefined after telling the user why not */
async function filesetIn(targets: vscode.Uri[]): Promise<(FilesetStatus & { repoRoot: string; displayRoot: string }) | undefined> {
    for (const t of targets) await saveIfDirty(t);
    const status = await getFilesetStatus(targets.map((t) => t.fsPath));
    if (status.repos.length > 1) {
        vscode.window.showWarningMessage(
            `The files are in ${status.repos.length} repositories (${status.repos.join(', ')}). Act on one repository at a time.`);
        return undefined;
    }
    if (!status.repoRoot || !status.displayRoot) {
        vscode.window.showWarningMessage(`Not in a git repository: ${nameList(status.unregistered.map((p) => path.basename(p)))}`);
        return undefined;
    }
    if (status.unregistered.length > 0) {
        vscode.window.showWarningMessage(
            `Not in ${path.basename(status.displayRoot)}: ${nameList(status.unregistered.map((p) => path.basename(p)))}`);
        return undefined;
    }
    return status as FilesetStatus & { repoRoot: string; displayRoot: string };
}

const STATE_NAMES: Partial<Record<VcFileState, string>> = {
    edited: 'edited', untracked: 'untracked', conflict: 'in conflict', ignored: 'ignored',
};

/** C-x v v on several files: every changed file must be in the same state */
async function nextActionSet(logBuffer: VcLogBuffer, targets: vscode.Uri[]): Promise<void> {
    const status = await filesetIn(targets);
    if (!status) return;
    const root = status.repoRoot;
    const withMarkers = new Set<string>();
    for (const e of status.entries.filter((x) => x.state === 'conflict')) {
        try {
            if (hasConflictMarkers(await fs.promises.readFile(e.path, 'utf8'))) withMarkers.add(e.rel);
        } catch {
            // Deleted on one side: no markers to look for
        }
    }
    const mergeInProgress = status.entries.some((e) => e.state === 'edited') && await isMergeInProgress(root);
    const action = decideFilesetAction(status.entries, { withMarkers, mergeInProgress });
    log.debug('Fileset next action', { root, action: action.kind, count: status.entries.length });

    switch (action.kind) {
        case 'register':
            await stagePaths(root, action.rels);
            vscode.window.showInformationMessage(`Registered ${plural(action.rels.length, 'file')} (git add): ${nameList(action.rels)}`);
            break;
        case 'resolve':
            await stagePaths(root, action.rels);
            vscode.window.showInformationMessage(`Marked ${plural(action.rels.length, 'file')} as resolved: ${nameList(action.rels)}`);
            break;
        case 'fix-conflicts': {
            const choice = await vscode.window.showWarningMessage(
                `Still have conflict markers: ${nameList(action.rels)}. Resolve them, then run C-x v v again.`,
                'Go to First Conflict');
            if (choice) {
                await vscode.window.showTextDocument(vscode.Uri.file(path.join(status.displayRoot, action.rels[0])));
                await vscode.commands.executeCommand('scimax.smerge.first');
            }
            break;
        }
        case 'commit':
            await openFilesetCommitBuffer(logBuffer, status.displayRoot, action.rels);
            break;
        case 'commit-merge': {
            const first = status.entries.find((e) => e.state === 'edited')!;
            await openCommitBuffer(logBuffer, first.path, status.displayRoot, { kind: 'merge' });
            break;
        }
        case 'ignored':
            vscode.window.showInformationMessage(`Ignored by git: ${nameList(action.rels)}`);
            break;
        case 'sync': {
            const staged = await stagedFiles(root);
            if (staged.length > 0) {
                await openFilesetCommitBuffer(logBuffer, status.displayRoot, staged, true);
            } else {
                await syncBranch(vscode.Uri.file(status.displayRoot), root);
            }
            break;
        }
        case 'mixed': {
            const groups = Object.entries(action.groups)
                .map(([state, rels]) => `${STATE_NAMES[state as VcFileState] ?? state}: ${nameList(rels ?? [], 4)}`);
            vscode.window.showWarningMessage(
                `C-x v v needs the files in one state. ${groups.join('; ')}. In dired, * e, * ? and * c mark files by state.`);
            break;
        }
    }
}

/** The *vc-log* buffer for a fileset commit (`git commit -- paths`) */
async function openFilesetCommitBuffer(logBuffer: VcLogBuffer, repoRoot: string, rels: string[], staged = false): Promise<void> {
    const summary = [
        staged
            ? `Committing all staged changes (${plural(rels.length, 'file')}):`
            : `Committing ${plural(rels.length, 'file')}:`,
        ...rels.map((r) => `  ${r || '.'}`),
        `Repository: ${repoRoot}`,
    ];
    if (!staged) {
        const stat = await diffStatPaths(repoRoot, rels);
        if (stat) summary.push('', ...stat.split('\n'));
    }
    await logBuffer.open({
        summary,
        onCommit: async (message) => {
            const hash = staged ? await commit(repoRoot, message) : await commitPaths(repoRoot, message, rels);
            log.info('Committed fileset', { hash, count: rels.length });
            vscode.window.showInformationMessage(`Committed ${plural(rels.length, 'file')} (${hash})`);
            DiredPanel.refreshVc();
        },
    });
}

/** Changed files whose diff against HEAD means something (not untracked or ignored) */
const diffable = (entries: FilesetEntry[]) => entries.filter((e) => e.state === 'edited' || e.state === 'conflict');

/** C-x v = on several files: one multi-file diff editor, HEAD against the working files */
async function diffSet(targets: vscode.Uri[]): Promise<void> {
    const status = await filesetIn(targets);
    if (!status) return;
    const changed = diffable(status.entries);
    if (changed.length === 0) {
        const untracked = status.entries.filter((e) => e.state === 'untracked').length;
        vscode.window.showInformationMessage(untracked > 0
            ? `No changes to tracked files (${plural(untracked, 'untracked file')})`
            : 'No changes against HEAD');
        return;
    }
    const root = vscode.Uri.file(status.displayRoot);
    await ensureRepositoryOpen(root);
    const api = getGitApi();
    if (api?.getRepository(root)) {
        const resources = changed.map((e) => {
            const file = vscode.Uri.file(e.path);
            const original = e.code[0] === 'R' && e.origRel
                ? vscode.Uri.file(path.join(status.displayRoot, ...e.origRel.split('/'))) : file;
            const left = e.code[0] === 'A' ? undefined : api.toGitUri(original, 'HEAD');
            const right = fs.existsSync(e.path) ? file : undefined;
            return [file, left, right];
        });
        await vscode.commands.executeCommand('vscode.changes', `Changes in ${plural(changed.length, 'file')}`, resources);
        return;
    }
    const patch = await pathsPatch(status.repoRoot, changed.flatMap((e) => e.origRel ? [e.rel, e.origRel] : [e.rel]));
    const doc = await vscode.workspace.openTextDocument({ language: 'diff', content: patch });
    await vscode.window.showTextDocument(doc, { preview: true });
}

/** Repository-relative paths of the targets, all in one repository */
async function locateAll(targets: vscode.Uri[]): Promise<{ root: string; displayRoot: string; rels: string[] } | undefined> {
    const locations = await Promise.all(targets.map((t) => locateInRepo(t.fsPath)));
    const roots = new Set(locations.map((l) => l?.root));
    if (roots.has(undefined)) {
        vscode.window.showWarningMessage('Not every file is in a git repository');
        return undefined;
    }
    if (roots.size > 1) {
        vscode.window.showWarningMessage('The files are in more than one repository. Act on one repository at a time.');
        return undefined;
    }
    return { root: locations[0]!.root, displayRoot: locations[0]!.displayRoot, rels: locations.map((l) => l!.rel) };
}

/** C-x v l on several files: pick a commit touching any of them and show what it changed among them */
async function logSet(targets: vscode.Uri[]): Promise<void> {
    const where = await locateAll(targets);
    if (!where) return;
    const entries = await pathsLog(where.root, where.rels);
    if (entries.length === 0) {
        vscode.window.showInformationMessage(`No commits touch ${nameList(where.rels)}`);
        return;
    }
    const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({ label: entry.subject, description: `${entry.shortHash}  ${entry.date}  ${entry.author}`, entry })),
        { placeHolder: `History of ${nameList(where.rels, 3)}`, matchOnDescription: true });
    if (!picked) return;
    const { hash, shortHash, subject } = picked.entry;
    const changes = await commitChanges(where.root, hash, where.rels);

    const root = vscode.Uri.file(where.displayRoot);
    await ensureRepositoryOpen(root);
    const api = getGitApi();
    if (api?.getRepository(root) && changes.length > 0) {
        const resources = changes.map((c) => {
            const file = vscode.Uri.file(path.join(where.displayRoot, ...c.rel.split('/')));
            return [
                file,
                c.status === 'A' ? undefined : api.toGitUri(file, `${hash}^`),
                c.status === 'D' ? undefined : api.toGitUri(file, hash),
            ];
        });
        await vscode.commands.executeCommand('vscode.changes', `${shortHash} ${subject}`, resources);
        return;
    }
    const patch = await runGit(['--literal-pathspecs', 'show', hash, '--', ...where.rels.map((r) => r || '.')], where.root);
    const doc = await vscode.workspace.openTextDocument({ language: 'diff', content: patch });
    await vscode.window.showTextDocument(doc, { preview: true });
}

/** C-x v u on several files: one confirmation, then discard every change */
async function revertSet(targets: vscode.Uri[]): Promise<void> {
    const status = await filesetIn(targets);
    if (!status) return;
    const changed = diffable(status.entries);
    if (changed.length === 0) {
        vscode.window.showInformationMessage('No changes to tracked files to revert');
        return;
    }
    const rels = changed.map((e) => e.rel);
    const choice = await vscode.window.showWarningMessage(
        `Discard all changes to ${plural(changed.length, 'file')}, including staged and unsaved changes?`,
        { modal: true, detail: rels.slice(0, 20).join('\n') + (rels.length > 20 ? `\n… and ${rels.length - 20} more` : '') },
        'Discard Changes');
    if (choice !== 'Discard Changes') return;
    await revertPaths(status.repoRoot, changed);
    // Reload editors that still hold the old text
    const paths = new Set(changed.map((e) => e.path));
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.isDirty && doc.uri.scheme === 'file' && paths.has(doc.uri.fsPath)) {
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    }
    vscode.window.showInformationMessage(`Reverted ${plural(changed.length, 'file')}`);
}

/** C-x v i on several files or a directory: add a pattern for each to .gitignore */
async function ignoreSet(targets: vscode.Uri[]): Promise<void> {
    const where = await locateAll(targets);
    if (!where) return;
    const items: (vscode.QuickPickItem & { rel: string })[] = [];
    for (const [i, rel] of where.rels.entries()) {
        if (!rel) continue; // never ignore the repository itself
        let pattern = ignorePatternFor(where.root, path.join(where.root, ...rel.split('/')));
        try {
            if ((await fs.promises.stat(targets[i].fsPath)).isDirectory()) pattern += '/';
        } catch {
            // Gone from disk: a plain file pattern
        }
        items.push({ label: pattern, picked: true, rel });
    }
    if (items.length === 0) {
        vscode.window.showWarningMessage('Nothing to ignore');
        return;
    }
    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true, placeHolder: 'Patterns to add to .gitignore',
    });
    if (!picked || picked.length === 0) return;
    const added: string[] = [];
    for (const item of picked) {
        if (await addToGitignore(where.root, item.label)) added.push(item.label);
    }
    log.info('Ignored', { patterns: added });
    // .gitignore has no effect on files git already tracks
    const rels = picked.map((p) => p.rel);
    const tracked = (await runGit(['--literal-pathspecs', 'ls-files', '-z', '--', ...rels], where.root))
        .split('\0').filter(Boolean);
    const message = added.length > 0
        ? `Added ${nameList(added)} to .gitignore.` : '.gitignore already lists these patterns.';
    if (tracked.length === 0) {
        vscode.window.showInformationMessage(message);
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        `${message} git still tracks ${plural(tracked.length, 'file')} under them until they are removed from the index.`,
        'Stop Tracking');
    if (choice === 'Stop Tracking') {
        await untrackPaths(where.root, rels);
        vscode.window.showInformationMessage(`${plural(tracked.length, 'file')} no longer tracked (the files stay on disk)`);
    }
}

/**
 * Stage the files, or unstage them when every change among them is already
 * staged (the dired/vc-dir `s` key)
 */
async function stageSet(targets: vscode.Uri[]): Promise<void> {
    const status = await filesetIn(targets);
    if (!status) return;
    const changed = status.entries.filter((e) => e.state !== 'up-to-date' && e.state !== 'ignored');
    if (changed.length === 0) {
        vscode.window.showInformationMessage('No changes to stage');
        return;
    }
    const rels = [...new Set(changed.flatMap((e) => e.origRel ? [e.rel, e.origRel] : [e.rel]))];
    const allStaged = changed.every((e) => e.code[1] === ' ' && e.code[0] !== ' ' && e.code[0] !== '?');
    if (allStaged) {
        await unstagePaths(status.repoRoot, rels);
        vscode.window.showInformationMessage(`Unstaged ${plural(changed.length, 'file')}`);
    } else {
        await stagePaths(status.repoRoot, rels);
        vscode.window.showInformationMessage(`Staged ${plural(changed.length, 'file')}`);
    }
}

/** C-x v d: the repository's changed files in a dired buffer (vc-dir) */
async function vcDir(extensionUri: vscode.Uri, uri?: unknown): Promise<void> {
    const start = uri instanceof vscode.Uri && uri.scheme === 'file' ? uri.fsPath
        : DiredPanel.activeDirectory()
        ?? (vscode.window.activeTextEditor?.document.uri.scheme === 'file'
            ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath) : undefined)
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!start) {
        vscode.window.showWarningMessage('Open a file or folder in a git repository first');
        return;
    }
    const where = await locateInRepo(start);
    if (!where) {
        vscode.window.showWarningMessage(`${start} is not in a git repository`);
        return;
    }
    await DiredPanel.showVcDir(extensionUri, where.displayRoot);
}

/** Run a command body, reporting failures instead of leaving them unhandled */
function guarded<T extends unknown[]>(name: string, fn: (...args: T) => Promise<void>): (...args: T) => Promise<void> {
    return async (...args: T) => {
        try {
            await fn(...args);
        } catch (error) {
            log.error(`${name} failed`, error instanceof Error ? error : undefined);
            vscode.window.showErrorMessage(errorMessage(error));
        }
        // A dired listing shows git status; bring it up to date
        DiredPanel.refreshVc();
    };
}

export function registerVcCommands(context: vscode.ExtensionContext): void {
    const logBuffer = new VcLogBuffer();
    // The file or directory a repository-wide command (push, pull, the VC menu) acts in
    const activeUri = () => vscode.window.activeTextEditor?.document.uri
        ?? (DiredPanel.activeDirectory() ? vscode.Uri.file(DiredPanel.activeDirectory()!) : undefined);
    registerSmergeCommands(context);

    /**
     * A C-x v command that takes (uri, uris) the way the Explorer and dired
     * pass a selection: one file goes to `single`, anything else to `set`.
     */
    const onTargets = (
        name: string,
        single: (uri: vscode.Uri) => Promise<void>,
        set: (targets: vscode.Uri[]) => Promise<void>,
    ) => guarded(name, async (uri?: unknown, uris?: unknown) => {
        const targets = resolveTargets(uri, uris);
        if (!targets) return;
        const file = await singleFile(targets);
        await (file ? single(file) : set(targets));
    });

    context.subscriptions.push(
        logBuffer,
        vscode.commands.registerCommand('scimax.vc.nextAction', onTargets('nextAction', (uri) => nextAction(logBuffer, uri), (targets) => nextActionSet(logBuffer, targets))),
        vscode.commands.registerCommand('scimax.vc.logFinish', guarded('logFinish', () => logBuffer.finish())),
        vscode.commands.registerCommand('scimax.vc.logCancel', guarded('logCancel', () => logBuffer.cancel())),
        vscode.commands.registerCommand('scimax.vc.push', guarded('push', async (uri?: vscode.Uri) => {
            await gitCommand('git.push', uri instanceof vscode.Uri ? uri : activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.pull', guarded('pull', async (uri?: vscode.Uri) => {
            await gitCommand('git.pull', uri instanceof vscode.Uri ? uri : activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.diff', onTargets('diff', diff, diffSet)),
        vscode.commands.registerCommand('scimax.vc.log', onTargets('log', showFileLog, logSet)),
        vscode.commands.registerCommand('scimax.vc.revert', onTargets('revert', revert, revertSet)),
        vscode.commands.registerCommand('scimax.vc.ignore', onTargets('ignore', ignore, ignoreSet)),
        vscode.commands.registerCommand('scimax.vc.stage', onTargets('stage', (uri) => stageSet([uri]), stageSet)),
        vscode.commands.registerCommand('scimax.vc.annotate', guarded('annotate', async (uri?: unknown, uris?: unknown) => {
            const targets = resolveTargets(uri, uris);
            const file = targets && await singleFile(targets.slice(0, 1));
            if (!targets) return;
            if (!file) {
                vscode.window.showWarningMessage('Blame needs a file, not a directory');
                return;
            }
            await annotate(file);
        })),
        // Internal (no palette entry): run a built-in git command on the active
        // file's repository, opening it in the git extension first. The VC
        // menu's Stage, Commit, Fetch, Branch, and Checkout go through this.
        vscode.commands.registerCommand('scimax.vc.git', guarded('git', async (command: string) => {
            await gitCommand(command, activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.status', guarded('status', status)),
        vscode.commands.registerCommand('scimax.vc.dir', guarded('dir', (uri?: unknown) => vcDir(context.extensionUri, uri)))
    );
}
