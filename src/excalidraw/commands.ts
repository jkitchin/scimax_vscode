/**
 * VS Code side of Excalidraw links into org files.
 *
 * Elements in a drawing link to `vscode://jkitchin.scimax-vscode/org-link?...`
 * (see scene.ts). Clicking one in the Excalidraw editor sends the URI to the
 * OS, which hands it back to VS Code and to the `/org-link` route here; the
 * route follows the org link as if it were clicked in an org file.
 */
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { registerUriRoute } from '../utils/uriHandler';
import { resolveOrgLink } from '../org/orgLinkProvider';
import { newDrawing } from './newDrawing';
import { orgLinkUri, parseOrgLinkQuery } from './scene';
import { extensionLogger as log } from '../utils/logger';

/** File the active tab shows, including custom editors such as Excalidraw. */
function activeTabFile(): string | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
        return input.uri.scheme === 'file' ? input.uri.fsPath : undefined;
    }
    return vscode.window.activeTextEditor?.document.uri.fsPath;
}

/**
 * File the org link is relative to: `from` when given (relative to the first
 * workspace folder), else the drawing in the active tab, else the workspace.
 */
function linkBase(from: string | undefined): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    if (from === '~' || from?.startsWith('~/')) return path.join(os.homedir(), from.slice(1));
    if (from) return path.isAbsolute(from) ? from : path.join(root, from);
    return activeTabFile() ?? path.join(root, '.');
}

/** Strip `[[...]]` / `[[...][desc]]` so pasted bracket links work too. */
export function bareOrgLink(link: string): string {
    const m = link.trim().match(/^\[\[(.+?)\](?:\[.*\])?\]$/s);
    return m ? m[1] : link.trim();
}

/** Open what a resolved org link points at. */
export async function openResolvedUri(uri: vscode.Uri): Promise<void> {
    if (uri.scheme === 'command') {
        let args: unknown[] = [];
        if (uri.query) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(uri.query);
            } catch {
                parsed = JSON.parse(decodeURIComponent(uri.query));
            }
            args = Array.isArray(parsed) ? parsed : [parsed];
        }
        await vscode.commands.executeCommand(uri.path, ...args);
    } else if (uri.scheme === 'file') {
        await vscode.commands.executeCommand('vscode.open', uri);
    } else {
        await vscode.env.openExternal(uri);
    }
}

/** `/org-link?from=<file>&link=<org link>` */
export async function handleOrgLinkUri(uri: vscode.Uri): Promise<void> {
    const parsed = parseOrgLinkQuery(uri.query, false);
    if (!parsed) {
        vscode.window.showWarningMessage('Scimax: org-link URI has no link= parameter.');
        return;
    }
    const link = bareOrgLink(parsed.link);
    const base = linkBase(parsed.from);
    const target = resolveOrgLink(link, base);
    log.debug('Following org link from URI', { link, base, target: target?.toString() });
    if (!target) {
        vscode.window.showWarningMessage(`Scimax: cannot follow link ${link}`);
        return;
    }
    await openResolvedUri(target);
}

/**
 * Org link to the heading at the cursor: `id:` when the heading has an ID
 * (stable across moves), else `file:<name>::#custom-id` or `file:<name>::*Title`.
 */
export function headingOrgLink(document: vscode.TextDocument, line: number): { link: string; title: string } | null {
    let headingLine = -1;
    for (let i = line; i >= 0; i--) {
        if (/^\*+\s/.test(document.lineAt(i).text)) { headingLine = i; break; }
    }
    const fileName = path.basename(document.uri.fsPath);
    if (headingLine < 0) return null;

    const title = document.lineAt(headingLine).text
        .replace(/^\*+\s+/, '')
        .replace(/\s+:[\w@#%:-]+:\s*$/, '')
        .replace(/^(TODO|DONE|NEXT|WAITING|HOLD|CANCELLED|CANCELED)\s+/, '')
        .replace(/^\[#[A-Z0-9]\]\s*/, '')
        .trim();

    // Property drawer right below the heading (after an optional planning line)
    let id: string | undefined;
    let customId: string | undefined;
    let inDrawer = false;
    for (let j = headingLine + 1; j < Math.min(headingLine + 60, document.lineCount); j++) {
        const text = document.lineAt(j).text;
        if (!inDrawer) {
            if (/^\s*:PROPERTIES:\s*$/i.test(text)) { inDrawer = true; continue; }
            if (j === headingLine + 1 && /^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(text)) continue;
            break;
        }
        if (/^\s*:END:\s*$/i.test(text)) break;
        const m = text.match(/^\s*:(ID|CUSTOM_ID):\s*(\S.*?)\s*$/i);
        if (m?.[1].toUpperCase() === 'ID') id = m[2];
        if (m?.[1].toUpperCase() === 'CUSTOM_ID') customId = m[2];
    }
    if (id) return { link: `id:${id}`, title };
    if (customId) return { link: `file:${fileName}::#${customId}`, title };
    return { link: `file:${fileName}::*${title}`, title };
}

export function registerExcalidrawCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        registerUriRoute('/org-link', handleOrgLinkUri),

        vscode.commands.registerCommand('scimax.excalidraw.newDrawing', newDrawing),

        vscode.commands.registerCommand('scimax.excalidraw.copyOrgLink', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Scimax: open an org file at the heading to link to.');
                return;
            }
            const doc = editor.document;
            const heading = headingOrgLink(doc, editor.selection.active.line);
            const link = heading?.link ?? `file:${path.basename(doc.uri.fsPath)}::${editor.selection.active.line + 1}`;
            const uri = orgLinkUri(link, doc.uri.scheme === 'file' ? doc.uri.fsPath : undefined);
            await vscode.env.clipboard.writeText(uri);
            vscode.window.showInformationMessage(
                `Scimax: copied a link to ${heading ? heading.title : 'this line'}. Paste it into an Excalidraw element's link (Ctrl+K).`);
        })
    );
}
