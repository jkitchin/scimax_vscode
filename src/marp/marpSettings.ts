/**
 * Marp settings for the thumbnails, the slide preview and exports.
 *
 * Scimax has its own `scimax.marp.themes`, `scimax.marp.enableHtml` and
 * `scimax.marp.mathTypesetting`, so it works without the Marp for VS Code
 * extension. When one of them is not set, the matching `markdown.marp.*`
 * setting of that extension is used, so decks set up for it keep working.
 *
 * A Marp CLI configuration file next to the deck (`.marprc.yml` and so on, see
 * marpConfig.ts) is read too, so the deck looks the same here as from Marp
 * CLI: its `themeSet` themes are added to the configured ones, and its `html`
 * and `options.math` apply unless the Scimax setting is set.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findMarpCliConfig, MarpCliConfig } from './marpConfig';

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

/** The Marp CLI configuration that applies to a deck, if any. */
export function marpCliConfig(document: SettingsScope): MarpCliConfig | undefined {
    if (document.uri.scheme !== 'file') {
        return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return findMarpCliConfig(path.dirname(document.uri.fsPath), folder?.uri.fsPath);
}

/**
 * The Scimax setting `key` if set, else the deck's Marp CLI configuration
 * value `fromCli`, else the Marp for VS Code setting `marpKey`, else `fallback`.
 */
function marpSetting<T>(document: SettingsScope, key: string, marpKey: string, fallback: T, fromCli?: T): T {
    const [section, prop] = splitKey(key);
    const scimax = vscode.workspace.getConfiguration(section, document.uri);
    if (isSet<T>(scimax, prop)) {
        return scimax.get<T>(prop, fallback);
    }
    if (fromCli !== undefined) {
        return fromCli;
    }
    const [marpSection, marpProp] = splitKey(marpKey);
    const marp = vscode.workspace.getConfiguration(marpSection, document.uri);
    if (isSet<T>(marp, marpProp)) {
        return marp.get<T>(marpProp, fallback);
    }
    return scimax.get<T>(prop, fallback);
}

/**
 * Local theme CSS files: `scimax.marp.themes`, resolved against the
 * document's workspace folder (or its own folder outside a workspace), then
 * the `themeSet` of the deck's Marp CLI configuration. Remote URLs are skipped.
 */
export function marpThemeUris(document: SettingsScope): vscode.Uri[] {
    const themes = marpSetting<string[]>(document, 'scimax.marp.themes', 'markdown.marp.themes', []);
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const uris = themes
        .filter(theme => !/^https?:\/\//i.test(theme))
        .map(theme => path.isAbsolute(theme)
            ? vscode.Uri.file(theme)
            : folder
                ? vscode.Uri.joinPath(folder.uri, theme)
                : vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), theme)));
    const configured = new Set(uris.map(uri => uri.fsPath));
    const fromCli = (marpCliConfig(document)?.themeFiles ?? []).filter(file => !configured.has(file));
    return [...uris, ...fromCli.map(file => vscode.Uri.file(file))];
}

/** Allow all raw HTML in slides (`scimax.marp.enableHtml`, or `html` in `.marprc.yml`). */
export function marpHtmlEnabled(document: SettingsScope): boolean {
    return marpSetting<boolean>(document, 'scimax.marp.enableHtml', 'markdown.marp.enableHtml', false,
        marpCliConfig(document)?.html);
}

/** Math typesetting for rendered slides (`scimax.marp.mathTypesetting`). */
export function marpMathTypesetting(document: SettingsScope): MathTypesetting {
    return marpSetting<MathTypesetting>(document, 'scimax.marp.mathTypesetting', 'markdown.marp.mathTypesetting', 'mathjax',
        marpCliConfig(document)?.math);
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
