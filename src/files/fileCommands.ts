/**
 * Commands on the current file: open it in its default app, rename it, and
 * move it to the trash. Used by the File menu (F12 f).
 */

import * as vscode from 'vscode';
import * as path from 'path';

/** The file in the active editor, or undefined (with a warning). */
function currentFile(action: string): vscode.Uri | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
        vscode.window.showWarningMessage(`No file to ${action}`);
        return undefined;
    }
    return uri;
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
    }
}

/** Move the current file to the trash, after asking, and close its editor. */
async function deleteCurrentFile(): Promise<void> {
    const uri = currentFile('delete');
    if (!uri) return;
    const name = path.basename(uri.fsPath);
    const choice = await vscode.window.showWarningMessage(
        `Move ${name} to the trash?`,
        { modal: true, detail: uri.fsPath },
        'Move to Trash'
    );
    if (choice !== 'Move to Trash') return;

    const document = vscode.window.activeTextEditor?.document;
    if (document?.isDirty) {
        await document.save();
    }
    try {
        await vscode.workspace.fs.delete(uri, { useTrash: true });
    } catch (err) {
        vscode.window.showErrorMessage(`Could not delete ${name}: ${(err as Error).message}`);
        return;
    }
    // Close every tab showing the file.
    const tabs = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
    if (tabs.length) {
        await vscode.window.tabGroups.close(tabs);
    }
    vscode.window.showInformationMessage(`Moved ${name} to the trash`);
}

export function registerFileCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.file.openInDefaultApp', openInDefaultApp),
        vscode.commands.registerCommand('scimax.file.rename', renameCurrentFile),
        vscode.commands.registerCommand('scimax.file.delete', deleteCurrentFile)
    );
}
