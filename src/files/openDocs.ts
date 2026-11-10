/**
 * Open editors inside files and folders that are about to be deleted: save
 * their unsaved changes first (so the trash has them), and close their tabs
 * afterwards. Used by F12 f D and dired's D.
 */

import * as vscode from 'vscode';
import * as path from 'path';

/** True if `file` is one of `targets` or inside one of them (a deleted folder). */
export function isInsideAny(file: string, targets: string[]): boolean {
    const resolved = path.resolve(file);
    return targets.some(target => {
        const t = path.resolve(target);
        return resolved === t || resolved.startsWith(t.endsWith(path.sep) ? t : t + path.sep);
    });
}

/**
 * Before deleting `targets`: if open documents inside them have unsaved
 * changes, ask to save them (the deleted files keep the edits in the trash).
 * Returns false when the user cancels.
 */
export async function saveDirtyDocsUnder(targets: string[]): Promise<boolean> {
    const dirty = vscode.workspace.textDocuments
        .filter(doc => doc.uri.scheme === 'file' && doc.isDirty && isInsideAny(doc.uri.fsPath, targets));
    if (dirty.length === 0) return true;
    const names = dirty.map(doc => path.basename(doc.uri.fsPath));
    const choice = await vscode.window.showWarningMessage(
        dirty.length === 1 ? `${names[0]} has unsaved changes.` : `${dirty.length} open files have unsaved changes.`,
        { modal: true, detail: `${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}\n\nSave them before deleting?` },
        'Save and Delete'
    );
    if (choice !== 'Save and Delete') return false;
    for (const doc of dirty) {
        await doc.save();
    }
    return true;
}

/** Close every editor tab showing a file that is one of `targets` or inside one. */
export async function closeTabsUnder(targets: string[]): Promise<void> {
    const tabs = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input instanceof vscode.TabInputText
            && tab.input.uri.scheme === 'file'
            && isInsideAny(tab.input.uri.fsPath, targets));
    if (tabs.length) {
        await vscode.window.tabGroups.close(tabs);
    }
}
