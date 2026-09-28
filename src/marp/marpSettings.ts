/**
 * Marp settings for the thumbnails, the slide preview and exports.
 *
 * Scimax has its own `scimax.marp.themes`, `scimax.marp.enableHtml` and
 * `scimax.marp.mathTypesetting`, so it works without the Marp for VS Code
 * extension. When one of them is not set, the matching `markdown.marp.*`
 * setting of that extension is used, so decks set up for it keep working.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type MathTypesetting = 'mathjax' | 'katex' | 'off';

/** What settings are read for: a document, or just its URI (the Markdown preview has only that). */
export interface SettingsScope {
    uri: vscode.Uri;
}

/** True if the user set `key` anywhere (user, workspace or folder settings). */
function isSet<T>(config: vscode.WorkspaceConfiguration, key: string): boolean {
    const inspected = config.inspect<T>(key);
    return inspected !== undefined && (
        inspected.globalValue !== undefined
        || inspected.workspaceValue !== undefined
        || inspected.workspaceFolderValue !== undefined
    );
}

/** Section and property of a full setting key: 'a.b.c' -> ['a.b', 'c']. */
function splitKey(key: string): [string, string] {
    const dot = key.lastIndexOf('.');
    return [key.slice(0, dot), key.slice(dot + 1)];
}

/** The Scimax setting `key` if set, else the Marp for VS Code setting `marpKey`, else `fallback`. */
function marpSetting<T>(document: SettingsScope, key: string, marpKey: string, fallback: T): T {
    const [section, prop] = splitKey(key);
    const scimax = vscode.workspace.getConfiguration(section, document.uri);
    if (isSet<T>(scimax, prop)) {
        return scimax.get<T>(prop, fallback);
    }
    const [marpSection, marpProp] = splitKey(marpKey);
    const marp = vscode.workspace.getConfiguration(marpSection, document.uri);
    if (isSet<T>(marp, marpProp)) {
        return marp.get<T>(marpProp, fallback);
    }
    return scimax.get<T>(prop, fallback);
}

/**
 * Local theme CSS files (`scimax.marp.themes`), resolved against the
 * document's workspace folder, or its own folder outside a workspace. Remote
 * URLs are skipped.
 */
export function marpThemeUris(document: SettingsScope): vscode.Uri[] {
    const themes = marpSetting<string[]>(document, 'scimax.marp.themes', 'markdown.marp.themes', []);
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return themes
        .filter(theme => !/^https?:\/\//i.test(theme))
        .map(theme => path.isAbsolute(theme)
            ? vscode.Uri.file(theme)
            : folder
                ? vscode.Uri.joinPath(folder.uri, theme)
                : vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), theme)));
}

/** Allow all raw HTML in slides (`scimax.marp.enableHtml`). */
export function marpHtmlEnabled(document: SettingsScope): boolean {
    return marpSetting<boolean>(document, 'scimax.marp.enableHtml', 'markdown.marp.enableHtml', false);
}

/** Math typesetting for rendered slides (`scimax.marp.mathTypesetting`). */
export function marpMathTypesetting(document: SettingsScope): MathTypesetting {
    return marpSetting<MathTypesetting>(document, 'scimax.marp.mathTypesetting', 'markdown.marp.mathTypesetting', 'mathjax');
}

/**
 * Rendering options for a deck, read synchronously (for the Markdown preview,
 * whose markdown-it plugin cannot wait). Missing theme files are skipped.
 */
export function marpRenderOptionsSync(document: SettingsScope): { enableHtml: boolean; math: MathTypesetting; themes: string[] } {
    const themes: string[] = [];
    for (const uri of marpThemeUris(document)) {
        try {
            themes.push(fs.readFileSync(uri.fsPath, 'utf8'));
        } catch {
            // The deck falls back to a built-in theme.
        }
    }
    return { enableHtml: marpHtmlEnabled(document), math: marpMathTypesetting(document), themes };
}

/**
 * Rendering options for a deck in the Markdown preview. VS Code puts the
 * previewed document's URI in markdown-it's `env.currentDocument`.
 */
export function marpPreviewRenderOptions(env: unknown): ReturnType<typeof marpRenderOptionsSync> | Record<string, never> {
    const uri = (env as { currentDocument?: unknown } | undefined)?.currentDocument;
    const scope = uri instanceof vscode.Uri ? { uri } : vscode.window.activeTextEditor?.document;
    return scope ? marpRenderOptionsSync(scope) : {};
}

/** True if a configuration change affects rendered slides. */
export function affectsMarpRendering(event: vscode.ConfigurationChangeEvent): boolean {
    return event.affectsConfiguration('scimax.marp') || event.affectsConfiguration('markdown.marp');
}
