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
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { VcLogBuffer } from './vcLogBuffer';
import {
    addToGitignore,
    commit,
    commitStaged,
    decideNextAction,
    diffStat,
    fileLog,
    findRepoRoot,
    getAheadBehind,
    getFileStatus,
    hasConflictMarkers,
    ignorePatternFor,
    initRepo,
    isMergeInProgress,
    revertFile,
    runGit,
    stageFile,
    stagedFiles,
    untrackFile,
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
    const root = await findRepoRoot(path.dirname(uri.fsPath));
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
            } else if (scope.kind === 'merge') {
                const hash = await commit(repoRoot, message);
                log.info('Committed merge', { hash });
                vscode.window.showInformationMessage(`Committed merge ${hash}`);
            } else {
                const hash = await commitStaged(repoRoot, message, scope.includeFile ? file : undefined);
                log.info('Committed staged changes', { hash });
                vscode.window.showInformationMessage(`Committed staged changes (${hash})`);
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
                'Open Merge Editor'
            );
            if (choice === 'Open Merge Editor') {
                await gitCommand('git.openMergeEditor', target);
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

/** C-x v t: magit-status via edamagit when installed, else the Source Control view */
async function status(): Promise<void> {
    if (vscode.extensions.getExtension('kahole.magit')) {
        await vscode.commands.executeCommand('magit.status');
    } else {
        await vscode.commands.executeCommand('workbench.view.scm');
    }
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
    };
}

export function registerVcCommands(context: vscode.ExtensionContext): void {
    const logBuffer = new VcLogBuffer();
    const activeUri = () => vscode.window.activeTextEditor?.document.uri;

    context.subscriptions.push(
        logBuffer,
        vscode.commands.registerCommand('scimax.vc.nextAction',
            guarded('nextAction', (uri?: vscode.Uri) => nextAction(logBuffer, uri))),
        vscode.commands.registerCommand('scimax.vc.logFinish', guarded('logFinish', () => logBuffer.finish())),
        vscode.commands.registerCommand('scimax.vc.logCancel', guarded('logCancel', () => logBuffer.cancel())),
        vscode.commands.registerCommand('scimax.vc.push', guarded('push', async (uri?: vscode.Uri) => {
            await gitCommand('git.push', uri ?? activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.pull', guarded('pull', async (uri?: vscode.Uri) => {
            await gitCommand('git.pull', uri ?? activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.diff', guarded('diff', async (uri?: vscode.Uri) => {
            const target = targetFile(uri);
            if (target) await gitCommand('git.openChange', target);
        })),
        vscode.commands.registerCommand('scimax.vc.log', guarded('log', showFileLog)),
        vscode.commands.registerCommand('scimax.vc.revert', guarded('revert', revert)),
        vscode.commands.registerCommand('scimax.vc.annotate', guarded('annotate', annotate)),
        vscode.commands.registerCommand('scimax.vc.ignore', guarded('ignore', ignore)),
        // Internal (no palette entry): run a built-in git command on the active
        // file's repository, opening it in the git extension first. The VC
        // menu's Stage, Commit, Fetch, Branch, and Checkout go through this.
        vscode.commands.registerCommand('scimax.vc.git', guarded('git', async (command: string) => {
            await gitCommand(command, activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.status', guarded('status', status)),
        vscode.commands.registerCommand('scimax.vc.dir', guarded('dir', async () => {
            await vscode.commands.executeCommand('workbench.view.scm');
        }))
    );
}
