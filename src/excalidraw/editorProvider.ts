/**
 * Scimax's Excalidraw editor: a custom text editor for `.excalidraw`,
 * `.excalidraw.json` and `.excalidraw.svg` files, hosting the Excalidraw
 * component (webview-src/excalidraw, bundled to media/excalidraw).
 *
 * The file's text is the source of truth. The webview sends the whole
 * serialized file after each edit and this provider writes it into the
 * TextDocument, so VS Code's dirty state, save, hot exit and git all work as
 * for any text file. Changes made elsewhere (another editor, git checkout)
 * are sent back to the webview.
 *
 * What it adds to Excalidraw, for drawings that map org notes:
 *  - clicking a shape's link opens the org heading beside the drawing
 *  - "Link to note" (C-c C-l) and "Linked box" (C-c C-b) pick a heading from
 *    the drawing's project, another notebook, a file or a typed link
 *  - linked shapes show the heading's TODO state and priority, and hovering
 *    shows its outline path and first lines; refreshed when org files save.
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { findProjectRoot } from '../notebook/notebookManager';
import { resolveOrgLink } from '../org/orgLinkProvider';
import type { ProjectileManager } from '../projectile/projectileManager';
import { extensionLogger as log } from '../utils/logger';
import { openResolvedUri } from './commands';
import { linkForHeading, linkStatus, NoteHeading, NoteIndex, parseOrgHeadings, type LinkStatus, type ResolveContext } from './noteIndex';
import { orgLinkUri, parseOrgLinkUri, parseSceneFile, stampLinkFrom, type ExcalidrawScene } from './scene';

export const EXCALIDRAW_VIEW_TYPE = 'scimax.excalidraw';

type FromWebview =
    | { type: 'ready' }
    | { type: 'edit'; text: string; linkedIds: LinkedId[] }
    | { type: 'openLink'; href: string }
    | { type: 'pickLink'; elementIds: string[] }
    | { type: 'pickInsert' };

interface LinkedId { id: string; link: string }

/** One open drawing. */
interface Session {
    document: vscode.TextDocument;
    panel: vscode.WebviewPanel;
    /** Text the webview last sent, so its own edits are not echoed back */
    lastFromWebview?: string;
    linked: LinkedId[];
}

const EMPTY_SCENE: ExcalidrawScene = { type: 'excalidraw', version: 2, source: 'scimax', elements: [], appState: {}, files: {} };

function isSvg(document: vscode.TextDocument): boolean {
    return /\.svg$/i.test(document.uri.fsPath);
}

export class ExcalidrawEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly sessions = new Set<Session>();
    private readonly index = new NoteIndex();
    /** Boxes to add to a drawing once it has loaded, by path */
    private readonly pendingInserts = new Map<string, Array<{ uri: string; label: string }>>();
    private statusTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly projectile: ProjectileManager | undefined
    ) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (/\.org$/i.test(doc.fileName)) this.scheduleStatus();
            }),
            vscode.workspace.onDidCreateFiles(() => this.index.forget()),
            vscode.workspace.onDidDeleteFiles(() => this.index.forget()),
            vscode.workspace.onDidRenameFiles(() => this.index.forget())
        );
    }

    /** Sessions showing a drawing, most recently focused first. */
    activeSession(): Session | undefined {
        return [...this.sessions].find(s => s.panel.active) ?? [...this.sessions].find(s => s.panel.visible);
    }

    async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        const media = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'excalidraw');
        panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
        panel.webview.html = this.html(panel.webview, media);

        const session: Session = { document, panel, linked: [] };
        this.sessions.add(session);

        const subs: vscode.Disposable[] = [
            panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(session, m)),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document !== document || !e.contentChanges.length) return;
                const text = document.getText();
                if (text === session.lastFromWebview) return;
                const scene = parseSceneFile(text, document.fileName);
                if (scene) void panel.webview.postMessage({ type: 'scene', scene });
            }),
        ];
        panel.onDidDispose(() => {
            this.sessions.delete(session);
            subs.forEach(d => d.dispose());
        });
    }

    private async onMessage(session: Session, m: FromWebview): Promise<void> {
        switch (m.type) {
            case 'ready': {
                const text = session.document.getText();
                let scene: ExcalidrawScene | null = text.trim() ? parseSceneFile(text, session.document.fileName) : EMPTY_SCENE;
                if (!scene) {
                    // Not a scene we can read (e.g. an SVG without one): never overwrite it.
                    const choice = await vscode.window.showErrorMessage(
                        `${path.basename(session.document.fileName)} has no Excalidraw scene that Scimax can read.`,
                        'Open as Text'
                    );
                    if (choice) await vscode.commands.executeCommand('vscode.openWith', session.document.uri, 'default');
                    session.panel.dispose();
                    return;
                }
                scene = { ...scene, files: scene.files ?? {} };
                await session.panel.webview.postMessage({
                    type: 'init', scene, format: isSvg(session.document) ? 'svg' : 'json', name: path.basename(session.document.fileName),
                });
                const queued = this.pendingInserts.get(session.document.uri.fsPath);
                this.pendingInserts.delete(session.document.uri.fsPath);
                if (queued?.length) await session.panel.webview.postMessage({ type: 'insertLinked', items: queued });
                session.linked = (scene.elements ?? [])
                    .filter(e => !e.isDeleted && typeof e.link === 'string' && e.link)
                    .map(e => ({ id: e.id, link: e.link as string }));
                await this.sendStatus(session);
                break;
            }
            case 'edit':
                await this.applyEdit(session, m.text);
                session.linked = m.linkedIds;
                await this.sendStatus(session);
                break;
            case 'openLink':
                await this.openLink(session, m.href);
                break;
            case 'pickLink': {
                const link = await this.pickNote(session.document.uri.fsPath, 'Link the selected shapes to...');
                if (link) await session.panel.webview.postMessage({ type: 'setLink', elementIds: m.elementIds, uri: link.uri });
                break;
            }
            case 'pickInsert': {
                const link = await this.pickNote(session.document.uri.fsPath, 'Add a box linked to...');
                if (link) await session.panel.webview.postMessage({ type: 'insertLinked', items: [link] });
                break;
            }
        }
    }

    /** Replace the document's text with the webview's. */
    private async applyEdit(session: Session, text: string): Promise<void> {
        const doc = session.document;
        if (isSvg(doc)) text = stampLinkFrom(text, doc.uri.fsPath);
        if (text === doc.getText()) return;
        session.lastFromWebview = text;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
        await vscode.workspace.applyEdit(edit);
    }

    // ---------------------------------------------------------------------
    // Following links
    // ---------------------------------------------------------------------

    private resolveContext(drawing: string): ResolveContext {
        const roots: string[] = [];
        const root = findProjectRoot(path.dirname(drawing));
        if (root) roots.push(root);
        for (const f of vscode.workspace.workspaceFolders ?? []) {
            if (!roots.includes(f.uri.fsPath)) roots.push(f.uri.fsPath);
        }
        if (!roots.length) roots.push(path.dirname(drawing));
        this.index.overrides = new Map(vscode.workspace.textDocuments
            .filter(d => d.isDirty && /\.org$/i.test(d.fileName))
            .map(d => [d.uri.fsPath, d.getText()]));
        return {
            index: this.index,
            roots,
            notebookRoot: name => this.projectile?.getProjects().find(p => p.name === name)?.path,
        };
    }

    private async openLink(session: Session, href: string): Promise<void> {
        const drawing = session.document.uri.fsPath;
        const status = await linkStatus(href, drawing, this.resolveContext(drawing));
        if (status?.broken) {
            vscode.window.showWarningMessage(`Scimax: cannot follow this link: ${status.broken}`);
            return;
        }
        if (status?.file && status.line) {
            const doc = await vscode.workspace.openTextDocument(status.file);
            const pos = new vscode.Position(status.line - 1, 0);
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(pos, pos),
            });
            return;
        }
        if (status?.file) {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(status.file), vscode.ViewColumn.Beside);
            return;
        }
        // Not a heading or file: web, cite, doi, cmd... as an org file would.
        const org = parseOrgLinkUri(href);
        if (org) {
            const base = org.from ? path.resolve(path.dirname(drawing), org.from) : drawing;
            const target = resolveOrgLink(org.link, base);
            if (target) await openResolvedUri(target);
            else vscode.window.showWarningMessage(`Scimax: cannot follow link ${org.link}`);
            return;
        }
        if (/^[a-z][\w+.-]*:/i.test(href)) {
            await vscode.env.openExternal(vscode.Uri.parse(href));
        } else {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.resolve(path.dirname(drawing), href)), vscode.ViewColumn.Beside);
        }
    }

    // ---------------------------------------------------------------------
    // Status of linked shapes
    // ---------------------------------------------------------------------

    private scheduleStatus(): void {
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
            for (const s of this.sessions) void this.sendStatus(s);
        }, 250);
    }

    private async sendStatus(session: Session): Promise<void> {
        const drawing = session.document.uri.fsPath;
        const ctx = this.resolveContext(drawing);
        const statuses: Record<string, LinkStatus> = {};
        for (const { id, link } of session.linked) {
            try {
                const s = await linkStatus(link, drawing, ctx);
                if (s) statuses[id] = { ...s, file: s.file ? vscode.workspace.asRelativePath(s.file) : undefined };
            } catch (error) {
                log.debug('Excalidraw link status failed', { link, error: String(error) });
            }
        }
        await session.panel.webview.postMessage({ type: 'status', statuses });
    }

    // ---------------------------------------------------------------------
    // Picking a note to link to
    // ---------------------------------------------------------------------

    /**
     * Ask for a target and return the link to store on a shape (an org-link
     * URI, so other Excalidraw editors and HTML export can follow it too).
     */
    async pickNote(drawing: string, title: string): Promise<{ uri: string; label: string } | undefined> {
        const drawingDir = path.dirname(drawing);
        const root = findProjectRoot(drawingDir) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? drawingDir;
        const picked = await this.pickHeading(root, title, true);
        if (!picked) return undefined;
        if ('special' in picked) {
            if (picked.special === 'file') {
                const files = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(drawingDir), canSelectMany: false });
                if (!files?.length) return undefined;
                const rel = path.relative(drawingDir, files[0].fsPath).split(path.sep).join('/');
                return { uri: orgLinkUri(`file:${rel}`), label: path.basename(files[0].fsPath) };
            }
            if (picked.special === 'typed') {
                const typed = await vscode.window.showInputBox({
                    prompt: 'Org link (relative to the drawing)',
                    placeHolder: 'file:../notes.org::*Results, id:..., nb:project::file.org, https://...',
                });
                if (!typed?.trim()) return undefined;
                return { uri: orgLinkUri(typed.trim().replace(/^\[\[(.+?)\](?:\[.*\])?\]$/s, '$1')), label: typed.trim() };
            }
            // Another notebook: its headings, linked with nb:
            const projects = this.projectile?.getProjects() ?? [];
            const project = await vscode.window.showQuickPick(
                projects.map(p => ({ label: p.name, description: p.path, project: p })),
                { placeHolder: 'Notebook (project) to link into' }
            );
            if (!project) return undefined;
            const h = await this.pickHeading(project.project.path, `Heading in ${project.label}`, false);
            if (!h || 'special' in h) return undefined;
            const rel = path.relative(project.project.path, h.file).split(path.sep).join('/');
            const target = h.customId ? `#${h.customId}` : `*${h.title}`;
            return { uri: orgLinkUri(`nb:${project.label}::${rel}::${target}`), label: h.title };
        }
        const heading = await this.ensureDurable(picked);
        return { uri: orgLinkUri(linkForHeading(heading, drawingDir)), label: heading.title };
    }

    private async pickHeading(root: string, title: string, withExtras: boolean):
        Promise<NoteHeading | { special: 'file' | 'notebook' | 'typed' } | undefined> {
        type Item = vscode.QuickPickItem & { heading?: NoteHeading; special?: 'file' | 'notebook' | 'typed' };
        const qp = vscode.window.createQuickPick<Item>();
        qp.title = title;
        qp.placeholder = `Heading in ${path.basename(root)} (type to filter)`;
        qp.matchOnDescription = true;
        qp.matchOnDetail = true;
        qp.busy = true;
        qp.show();

        this.resolveContext(path.join(root, 'x'));
        const headings = await this.index.projectHeadings(root);
        const items: Item[] = headings.map(h => ({
            label: `${'  '.repeat(Math.min(h.level - 1, 4))}${h.todo ? h.todo + ' ' : ''}${h.priority ? `[#${h.priority}] ` : ''}${h.title}`,
            description: h.outline.join(' › '),
            detail: `${path.relative(root, h.file)}:${h.line}${h.id ? '  · ID' : h.customId ? `  · #${h.customId}` : ''}`,
            heading: h,
        }));
        if (withExtras) {
            items.push(
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(notebook) Heading in another notebook...', special: 'notebook', alwaysShow: true },
                { label: '$(file) A file...', special: 'file', alwaysShow: true },
                { label: '$(link) Type an org link...', special: 'typed', alwaysShow: true },
            );
        }
        qp.items = items;
        qp.busy = false;

        return new Promise(resolve => {
            qp.onDidAccept(() => {
                const sel = qp.selectedItems[0];
                qp.hide();
                if (!sel) resolve(undefined);
                else if (sel.special) resolve({ special: sel.special });
                else resolve(sel.heading);
            });
            qp.onDidHide(() => { qp.dispose(); resolve(undefined); });
        });
    }

    /**
     * Give a heading an :ID: (as org-id does) so the link survives renaming
     * and moving it, unless it has one, has a CUSTOM_ID, or
     * scimax.excalidraw.linkWithId is off.
     */
    private async ensureDurable(h: NoteHeading): Promise<NoteHeading> {
        if (h.id || h.customId) return h;
        if (!vscode.workspace.getConfiguration('scimax.excalidraw').get<boolean>('linkWithId', true)) return h;
        const doc = await vscode.workspace.openTextDocument(h.file);
        const headingLine = h.line - 1;
        if (!/^\*+\s/.test(doc.lineAt(headingLine).text)) return h; // changed since scanned

        const id = crypto.randomUUID();
        const edit = new vscode.WorkspaceEdit();
        let at = headingLine + 1;
        if (at < doc.lineCount && /^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(doc.lineAt(at).text)) at++;
        if (at < doc.lineCount && /^\s*:PROPERTIES:\s*$/i.test(doc.lineAt(at).text)) {
            const indent = doc.lineAt(at).text.match(/^\s*/)?.[0] ?? '';
            edit.insert(doc.uri, new vscode.Position(at + 1, 0), `${indent}:ID:       ${id}\n`);
        } else {
            edit.insert(doc.uri, new vscode.Position(at, 0), `:PROPERTIES:\n:ID:       ${id}\n:END:\n`);
        }
        if (!(await vscode.workspace.applyEdit(edit))) return h;
        await doc.save();
        vscode.window.setStatusBarMessage(`Scimax: gave "${h.title}" an ID so the drawing's link survives renames`, 5000);
        return { ...h, id };
    }

    /**
     * Add a box linked to the heading at `line` of an org document to a
     * drawing: the one in view, else one picked from the project's drawings.
     */
    async addHeadingToDrawing(document: vscode.TextDocument, line: number): Promise<void> {
        const headings = parseOrgHeadings(document.getText(), document.uri.fsPath);
        const heading = [...headings].reverse().find(h => h.line <= line + 1);
        if (!heading) {
            vscode.window.showWarningMessage('Scimax: put the cursor on or under an org heading.');
            return;
        }

        let session = [...this.sessions].find(s => s.panel.visible);
        if (!session) {
            const root = findProjectRoot(path.dirname(document.uri.fsPath)) ?? path.dirname(document.uri.fsPath);
            const drawings = (await vscode.workspace.findFiles(
                new vscode.RelativePattern(root, '**/*.{excalidraw,excalidraw.json,excalidraw.svg}'), '**/node_modules/**', 200))
                .map(u => u.fsPath).sort();
            const picked = await vscode.window.showQuickPick(
                [...drawings.map(d => ({ label: path.relative(root, d), path: d })), { label: '$(add) New drawing...', path: '' }],
                { placeHolder: `Drawing to add "${heading.title}" to` }
            );
            if (!picked) return;
            let target = picked.path;
            if (!target) {
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(root, 'diagrams', 'drawing.excalidraw.svg')),
                    filters: { 'Excalidraw SVG': ['svg'], Excalidraw: ['excalidraw'] },
                });
                if (!uri) return;
                target = /\.excalidraw(\.svg|\.json)?$/i.test(uri.fsPath) ? uri.fsPath : uri.fsPath.replace(/(\.svg)?$/i, '.excalidraw.svg');
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
                await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new Uint8Array());
            }
            const open = [...this.sessions].find(s => s.document.uri.fsPath === target);
            if (!open) this.pendingInserts.set(target, []);
            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), EXCALIDRAW_VIEW_TYPE, vscode.ViewColumn.Beside);
            session = [...this.sessions].find(s => s.document.uri.fsPath === target);
            if (!session) return;
        }

        const durable = await this.ensureDurable(heading);
        const item = { uri: orgLinkUri(linkForHeading(durable, path.dirname(session.document.uri.fsPath))), label: durable.title };
        const queued = this.pendingInserts.get(session.document.uri.fsPath);
        if (queued) queued.push(item); // sent once the drawing has loaded
        else await session.panel.webview.postMessage({ type: 'insertLinked', items: [item] });
        session.panel.reveal(undefined, true);
    }

    // ---------------------------------------------------------------------

    private html(webview: vscode.Webview, media: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('base64');
        const asset = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, p)).toString();
        const base = webview.asWebviewUri(media).toString().replace(/\/?$/, '/');
        const csp = [
            `default-src 'none'`,
            `script-src 'nonce-${nonce}' ${webview.cspSource}`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource} data:`,
            `img-src ${webview.cspSource} data: blob:`,
            `connect-src ${webview.cspSource} data: blob:`,
            `worker-src ${webview.cspSource} blob:`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('editor.css')}">
<script nonce="${nonce}">window.EXCALIDRAW_ASSET_PATH = ${JSON.stringify(base)};</script>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" type="module" src="${asset('editor.js')}"></script>
</body>
</html>`;
    }
}

export function registerExcalidrawEditor(
    context: vscode.ExtensionContext,
    projectile: ProjectileManager | undefined
): ExcalidrawEditorProvider {
    const provider = new ExcalidrawEditorProvider(context, projectile);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(EXCALIDRAW_VIEW_TYPE, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false,
        }),
        vscode.commands.registerCommand('scimax.excalidraw.addHeadingToDrawing', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !/\.org$/i.test(editor.document.fileName)) {
                vscode.window.showWarningMessage('Scimax: run this from an org file, at the heading to add.');
                return;
            }
            await provider.addHeadingToDrawing(editor.document, editor.selection.active.line);
        })
    );
    return provider;
}
