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
    commit,
    decideNextAction,
    diffStat,
    fileLog,
    getAheadBehind,
    getFileStatus,
    hasConflictMarkers,
    initRepo,
    isMergeInProgress,
    revertFile,
    runGit,
    stageFile,
} from './vcManager';

const log = createLogger('VC');

/** Minimal slice of the built-in git extension API (vscode.git, v1) */
interface GitApi {
    toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
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

async function openCommitBuffer(
    logBuffer: VcLogBuffer,
    file: string,
    repoRoot: string,
    wholeTree: boolean
): Promise<void> {
    const relative = path.relative(repoRoot, file);
    const summary = wholeTree
        ? ['Concluding merge: all staged changes will be committed', `Repository: ${repoRoot}`]
        : [`Committing: ${relative}`, `Repository: ${repoRoot}`];
    if (!wholeTree) {
        const stat = await diffStat(file);
        if (stat) summary.push('', ...stat.split('\n'));
    }
    await logBuffer.open({
        summary,
        onCommit: async (message) => {
            const hash = await commit(repoRoot, message, wholeTree ? undefined : file);
            log.info('Committed', { hash, file: wholeTree ? undefined : relative });
            vscode.window.showInformationMessage(
                wholeTree ? `Committed merge ${hash}` : `Committed ${relative} (${hash})`
            );
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
        if (choice === 'Push') await vscode.commands.executeCommand('git.push', uri);
        return;
    }
    if (ahead > 0 && behind > 0) {
        const choice = await vscode.window.showInformationMessage(
            `${name} is up to date. Branch has diverged from ${upstream}: ${ahead} ahead, ${behind} behind.`, 'Sync'
        );
        if (choice === 'Sync') await vscode.commands.executeCommand('git.sync', uri);
    } else if (ahead > 0) {
        const choice = await vscode.window.showInformationMessage(
            `${name} is up to date. ${ahead} commit${ahead === 1 ? '' : 's'} not pushed to ${upstream}.`, 'Push'
        );
        if (choice === 'Push') await vscode.commands.executeCommand('git.push', uri);
    } else if (behind > 0) {
        const choice = await vscode.window.showInformationMessage(
            `${name} is up to date. ${behind} commit${behind === 1 ? '' : 's'} to pull from ${upstream}.`, 'Pull'
        );
        if (choice === 'Pull') await vscode.commands.executeCommand('git.pull', uri);
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
                await vscode.commands.executeCommand('git.openMergeEditor', target);
            }
            break;
        }
        case 'commit':
            await openCommitBuffer(logBuffer, file, status.repoRoot!, false);
            break;
        case 'commit-merge':
            await openCommitBuffer(logBuffer, file, status.repoRoot!, true);
            break;
        case 'ignored':
            vscode.window.showInformationMessage(`${name} is ignored by git`);
            break;
        case 'sync':
            await syncBranch(target, status.repoRoot!);
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

    const api = getGitApi();
    if (api) {
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

/** C-x v g: toggle line-by-line blame (vc-annotate) */
async function annotate(uri?: vscode.Uri): Promise<void> {
    const target = targetFile(uri);
    if (!target) return;
    // Blame acts on the active editor, so bring a right-clicked file forward
    if (vscode.window.activeTextEditor?.document.uri.toString() !== target.toString()) {
        await vscode.window.showTextDocument(target);
    }
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
            await vscode.commands.executeCommand('git.push', uri ?? activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.pull', guarded('pull', async (uri?: vscode.Uri) => {
            await vscode.commands.executeCommand('git.pull', uri ?? activeUri());
        })),
        vscode.commands.registerCommand('scimax.vc.diff', guarded('diff', async (uri?: vscode.Uri) => {
            const target = targetFile(uri);
            if (target) await vscode.commands.executeCommand('git.openChange', target);
        })),
        vscode.commands.registerCommand('scimax.vc.log', guarded('log', showFileLog)),
        vscode.commands.registerCommand('scimax.vc.revert', guarded('revert', revert)),
        vscode.commands.registerCommand('scimax.vc.annotate', guarded('annotate', annotate)),
        vscode.commands.registerCommand('scimax.vc.status', guarded('status', status)),
        vscode.commands.registerCommand('scimax.vc.dir', guarded('dir', async () => {
            await vscode.commands.executeCommand('workbench.view.scm');
        }))
    );
}
