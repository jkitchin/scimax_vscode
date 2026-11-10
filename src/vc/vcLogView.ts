/**
 * Views opened from C-x v l (the commit's diff, a multi-file change view, or
 * a plain patch) close with q, as Emacs's log-view does. The context key
 * scimax.vcLogViewActive is true while one of them is the active tab.
 */

import * as vscode from 'vscode';
import { setContextKey } from '../utils/contextKeys';

/** Tab labels of the diffs and change views C-x v l opened */
const labels = new Set<string>();
/** URIs of the patch documents C-x v l opened (no git extension) */
const uris = new Set<string>();

function isLogView(tab: vscode.Tab | undefined): boolean {
    if (!tab) return false;
    const input = tab.input;
    if (input instanceof vscode.TabInputText) return uris.has(input.uri.toString());
    // Diff and multi-diff tabs; the label is the title C-x v l gave them
    return labels.has(tab.label);
}

function update(): void {
    setContextKey('scimax.vcLogViewActive', isLogView(vscode.window.tabGroups.activeTabGroup.activeTab));
}

/** Call before opening a diff or change view titled `label` */
export function trackLogTitle(label: string): void {
    labels.add(label);
}

/** Call after opening a patch document */
export function trackLogDocument(uri: vscode.Uri): void {
    uris.add(uri.toString());
    update();
}

export function registerLogView(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs((event) => {
            for (const tab of event.closed) {
                if (tab.input instanceof vscode.TabInputText) uris.delete(tab.input.uri.toString());
                else labels.delete(tab.label);
            }
            update();
        }),
        vscode.window.tabGroups.onDidChangeTabGroups(update),
        vscode.window.onDidChangeActiveTextEditor(update),
        vscode.commands.registerCommand('scimax.vc.logViewQuit', async () => {
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (!isLogView(tab)) return;
            // A patch document is untitled; close it without a save prompt
            await vscode.commands.executeCommand(tab!.input instanceof vscode.TabInputText
                ? 'workbench.action.revertAndCloseActiveEditor'
                : 'workbench.action.closeActiveEditor');
        })
    );
}
