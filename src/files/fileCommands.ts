/**
 * Commands on the current file: open it in its default app, copy its path,
 * rename it, and move it to the trash. Used by the File menu (F12 f). When
 * dired is the active tab they act on the entry at point.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DiredPanel } from '../dired/diredPanel';
import { closeTabsUnder, saveDirtyDocsUnder } from './openDocs';
import { notifyPathsChanged } from '../shared/pathChanges';

/**
 * The entry at point in dired (when dired is the active tab), else the file
 * in the active editor, or undefined (with a warning).
 */
function currentFile(action: string): vscode.Uri | undefined {
    const dired = DiredPanel.activeEntry();
    if (dired) return vscode.Uri.file(dired.path);
    if (DiredPanel.activeDirectory()) {
        vscode.window.showWarningMessage(`Move to a file in dired to ${action} it`);
        return undefined;
    }
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
        vscode.window.showWarningMessage(`No file to ${action}`);
        return undefined;
    }
    return uri;
}

/** Copy the path of the dired entry at point (or listed directory), or the current file. */
async function copyPath(relative: boolean): Promise<void> {
    const diredPath = DiredPanel.activePath();
    const uri = diredPath ? vscode.Uri.file(diredPath) : vscode.window.activeTextEditor?.document.uri;
    // The built-in commands take the file as an argument; with none they use the active tab.
    await vscode.commands.executeCommand(relative ? 'copyRelativeFilePath' : 'copyFilePath', uri);
}

/**
 * Check a new file name typed by the user. Returns an error message, or
 * undefined when the name is fine.
 */
export function validateNewFileName(name: string, oldName: string): string | undefined {
    const trimmed = name.trim();
    if (!trimmed) return 'Enter a file name';
    if (trimmed === oldName) return 'The new name is the same as the old one';
    if (trimmed === '.' || trimmed === '..') return 'Not a valid file name';
    return undefined;
}

/** Open the current file in the operating system's default application. */
async function openInDefaultApp(): Promise<void> {
    const uri = currentFile('open');
    if (!uri) return;
    const opened = await vscode.env.openExternal(uri);
    if (!opened) {
        vscode.window.showErrorMessage(`Could not open ${path.basename(uri.fsPath)}`);
    }
}

/**
 * Rename (or move) the current file. The new name is relative to the file's
 * folder, so `../notes.org` or `archive/notes.org` also move it. The editor
 * follows the file.
 */
async function renameCurrentFile(): Promise<void> {
    // In dired, dired's own R: the marked entries (moved to a folder) or the entry at point, which keeps point
    if (await DiredPanel.runFileAction('rename')) return;
    const uri = currentFile('rename');
    if (!uri) return;
    const dir = path.dirname(uri.fsPath);
    const oldName = path.basename(uri.fsPath);
    const dot = oldName.lastIndexOf('.');
    const newName = await vscode.window.showInputBox({
        prompt: `Rename ${oldName} (relative to its folder)`,
        value: oldName,
        valueSelection: [0, dot > 0 ? dot : oldName.length],
        validateInput: value => validateNewFileName(value, oldName),
    });
    if (newName === undefined) return;

    const target = vscode.Uri.file(path.resolve(dir, newName.trim()));
    try {
        await vscode.workspace.fs.stat(target);
        vscode.window.showErrorMessage(`${newName.trim()} already exists`);
        return;
    } catch {
        // The target does not exist, as expected.
    }

    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
    } catch {
        // Already there.
    }
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(uri, target, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit))) {
        vscode.window.showErrorMessage(`Could not rename ${oldName}`);
        return;
    }
    DiredPanel.refreshVc();
}

/** Move the current file to the trash, after asking, and close its editor. */
async function deleteCurrentFile(): Promise<void> {
    // In dired, dired's own D: the flagged or marked entries, or the entry at point
    if (await DiredPanel.runFileAction('delete')) return;
    const uri = currentFile('delete');
    if (!uri) return;
    const name = path.basename(uri.fsPath);
    const choice = await vscode.window.showWarningMessage(
        `Move ${name} to the trash?`,
        { modal: true, detail: uri.fsPath },
        'Move to Trash'
    );
    if (choice !== 'Move to Trash') return;

    // Unsaved edits in the file, or in files inside the folder, go to the trash with it
    if (!await saveDirtyDocsUnder([uri.fsPath])) return;
    let recursive = false;
    try {
        recursive = (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
    } catch {
        // Gone already; delete reports it.
    }
    try {
        await vscode.workspace.fs.delete(uri, { useTrash: true, recursive });
    } catch (err) {
        vscode.window.showErrorMessage(`Could not delete ${name}: ${(err as Error).message}`);
        return;
    }
    notifyPathsChanged({ deleted: [uri.fsPath] });
    // Close every tab showing the file, or a file inside the folder.
    await closeTabsUnder([uri.fsPath]);
    DiredPanel.refreshVc();
    vscode.window.showInformationMessage(`Moved ${name} to the trash`);
}

export function registerFileCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.file.openInDefaultApp', openInDefaultApp),
        vscode.commands.registerCommand('scimax.file.rename', renameCurrentFile),
        vscode.commands.registerCommand('scimax.file.delete', deleteCurrentFile),
        vscode.commands.registerCommand('scimax.file.copyPath', () => copyPath(false)),
        vscode.commands.registerCommand('scimax.file.copyRelativePath', () => copyPath(true))
    );
}
