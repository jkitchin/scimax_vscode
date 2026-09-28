/**
 * Marp for VS Code settings that Scimax follows, so the thumbnails and exports
 * match the Marp preview.
 */

import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Local theme files from `markdown.marp.themes`, resolved against the
 * document's workspace folder (or its own folder) as the Marp extension does.
 * Remote URLs are skipped.
 */
export function marpThemeUris(document: vscode.TextDocument): vscode.Uri[] {
    const themes = vscode.workspace.getConfiguration('markdown.marp', document.uri).get<string[]>('themes', []);
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return themes
        .filter(theme => !/^https?:\/\//i.test(theme))
        .map(theme => path.isAbsolute(theme)
            ? vscode.Uri.file(theme)
            : folder
                ? vscode.Uri.joinPath(folder.uri, theme)
                : vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), theme)));
}

/** `markdown.marp.enableHtml`: allow all raw HTML in slides. */
export function marpHtmlEnabled(document: vscode.TextDocument): boolean {
    return vscode.workspace.getConfiguration('markdown.marp', document.uri).get<boolean>('enableHtml', false);
}
