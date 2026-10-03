/**
 * The Markdown file shown in VS Code's built-in Markdown preview.
 *
 * The preview is the markdown extension's webview, so it is not a text editor
 * and VS Code does not say which file it shows. Its tab is labelled
 * "Preview name.md" (or "[Preview] name.md" when locked; the word is
 * translated in other languages), so the file is found among the open Markdown
 * documents by the name the label ends with.
 */

import * as vscode from 'vscode';
import * as path from 'path';

/** True when a Markdown preview tab labelled `label` can show a file named `fileName`. */
export function previewLabelShows(label: string, fileName: string): boolean {
    const l = label.trim();
    return l === fileName || l.endsWith(' ' + fileName);
}

/** True when the active tab is VS Code's Markdown preview. */
export function markdownPreviewIsActive(): boolean {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputWebview && input.viewType.endsWith('markdown.preview');
}

/**
 * The Markdown document behind the active Markdown preview. When several
 * open files have the previewed name, a visible one wins, else the user picks.
 */
export async function previewedMarkdownDocument(): Promise<vscode.TextDocument | undefined> {
    if (!markdownPreviewIsActive()) return undefined;
    const label = vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? '';
    const candidates = vscode.workspace.textDocuments.filter(
        d => d.languageId === 'markdown' && previewLabelShows(label, path.basename(d.uri.fsPath))
    );
    if (candidates.length <= 1) return candidates[0];
    const visible = candidates.filter(d => vscode.window.visibleTextEditors.some(e => e.document === d));
    if (visible.length === 1) return visible[0];

    const picked = await vscode.window.showQuickPick(
        candidates.map(d => ({ label: path.basename(d.uri.fsPath), description: vscode.workspace.asRelativePath(d.uri), document: d })),
        { title: 'Which file does the preview show?' }
    );
    return picked?.document;
}
