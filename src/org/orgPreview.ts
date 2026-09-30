/**
 * Live org-mode preview (like VS Code's Markdown preview).
 *
 * Renders the document with the HTML exporter, updates as you type, resolves
 * local images, follows the VS Code theme and keeps the editor and preview
 * scrolled together.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { preprocessContent, exportHtml, extractBibPaths } from './exportProvider';
import { parseBibTeX } from '../references/bibtexParser';
import type { BibEntry } from '../references/bibtexParser';
import { escapeHtml } from '../utils/escapeUtils';
import { extensionLogger as log } from '../utils/logger';
import {
    buildPreviewPage,
    resolveLocalResource,
    rewriteResourceUrls,
    splitExportedHtml,
} from './orgPreviewHtml';

export const ORG_PREVIEW_VIEW_TYPE = 'scimax.org.preview';

interface PreviewSettings {
    updateDelay: number;
    scrollPreviewWithEditor: boolean;
    scrollEditorWithPreview: boolean;
}

interface PreviewEntry {
    uri: vscode.Uri;
    panel: vscode.WebviewPanel;
    /** Extra resource roots discovered from image paths */
    roots: Set<string>;
    /** Incremented per render so stale renders are dropped */
    renderId: number;
    timer?: ReturnType<typeof setTimeout>;
    /** Styles of the page currently loaded in the webview */
    styles?: string;
    /** True once the webview script reported it is ready */
    ready: boolean;
    /** Body waiting for the webview to become ready */
    pending?: { html: string; title: string };
    /** Top source line (1-based) last shown */
    line: number;
    /**
     * Whether the webview keeps its page while hidden. Restored panels do not,
     * so they reload the page whenever they are shown again.
     */
    retained: boolean;
    /** The document changed while the panel was hidden */
    stale: boolean;
    /** Visibility at the last view-state change */
    visible: boolean;
    disposables: vscode.Disposable[];
}

interface WebviewMessage {
    type: string;
    line?: number;
    href?: string;
}

function getSettings(): PreviewSettings {
    const config = vscode.workspace.getConfiguration('scimax.orgPreview');
    return {
        updateDelay: config.get<number>('updateDelay', 300),
        scrollPreviewWithEditor: config.get<boolean>('scrollPreviewWithEditor', true),
        scrollEditorWithPreview: config.get<boolean>('scrollEditorWithPreview', true),
    };
}

function isOrgDocument(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    return !!doc && doc.languageId === 'org';
}

function topLine(editor: vscode.TextEditor | undefined): number {
    const range = editor?.visibleRanges[0];
    return range ? range.start.line + 1 : 1;
}

export class OrgPreviewManager implements vscode.WebviewPanelSerializer, vscode.Disposable {
    private readonly entries = new Map<string, PreviewEntry>();
    private activeEntry: PreviewEntry | undefined;
    private readonly bibCache = new Map<string, { mtimeMs: number; entries: BibEntry[] }>();
    /** Ignore editor scroll events caused by the preview scrolling the editor */
    private ignoreEditorScrollUntil = 0;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly extensionUri: vscode.Uri) {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                const entry = this.entries.get(event.document.uri.toString());
                if (entry && event.contentChanges.length > 0) {
                    this.scheduleRender(entry);
                }
            }),
            vscode.workspace.onDidSaveTextDocument(doc => {
                const entry = this.entries.get(doc.uri.toString());
                if (entry) {
                    this.scheduleRender(entry, 0);
                }
            }),
            vscode.window.onDidChangeTextEditorVisibleRanges(event => {
                if (Date.now() < this.ignoreEditorScrollUntil) {
                    return;
                }
                const entry = this.entries.get(event.textEditor.document.uri.toString());
                if (!entry || !getSettings().scrollPreviewWithEditor) {
                    return;
                }
                entry.line = topLine(event.textEditor);
                void entry.panel.webview.postMessage({ type: 'scrollToLine', line: entry.line });
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (!event.affectsConfiguration('scimax.orgPreview')) {
                    return;
                }
                const settings = getSettings();
                for (const entry of this.entries.values()) {
                    void entry.panel.webview.postMessage({
                        type: 'settings',
                        settings: {
                            scrollPreviewWithEditor: settings.scrollPreviewWithEditor,
                            scrollEditorWithPreview: settings.scrollEditorWithPreview,
                        },
                    });
                }
            })
        );
    }

    /**
     * Open (or reveal) the preview for the active org editor.
     * @param toSide open beside the editor instead of in its group
     */
    async open(toSide: boolean): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isOrgDocument(editor.document)) {
            vscode.window.showWarningMessage('No org-mode file open');
            return;
        }

        const existing = this.entries.get(editor.document.uri.toString());
        if (existing) {
            existing.panel.reveal(existing.panel.viewColumn, toSide);
            return;
        }

        const viewColumn = toSide
            ? vscode.ViewColumn.Beside
            : (editor.viewColumn ?? vscode.ViewColumn.Active);
        const panel = vscode.window.createWebviewPanel(
            ORG_PREVIEW_VIEW_TYPE,
            this.titleFor(editor.document.uri),
            { viewColumn, preserveFocus: toSide },
            { ...this.webviewOptions(editor.document.uri, new Set()), retainContextWhenHidden: true }
        );
        this.attach(panel, editor.document.uri, topLine(editor), true);
    }

    /** Show the source of the focused preview in the preview's group */
    async showSource(): Promise<void> {
        const entry = this.activeEntry;
        if (!entry) {
            return;
        }
        await vscode.window.showTextDocument(entry.uri, { viewColumn: entry.panel.viewColumn });
    }

    /** Restore a preview after a window reload */
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
        const saved = state as { uri?: string; line?: number } | undefined;
        if (!saved?.uri) {
            panel.dispose();
            return;
        }
        const uri = vscode.Uri.parse(saved.uri);
        if (this.entries.has(uri.toString())) {
            panel.dispose();
            return;
        }
        panel.webview.options = this.webviewOptions(uri, new Set());
        this.attach(panel, uri, typeof saved.line === 'number' ? saved.line : 1, false);
    }

    dispose(): void {
        for (const entry of [...this.entries.values()]) {
            entry.panel.dispose();
        }
        for (const d of this.disposables) {
            d.dispose();
        }
    }

    // ------------------------------------------------------------------

    private titleFor(uri: vscode.Uri): string {
        return `Preview ${path.basename(uri.fsPath)}`;
    }

    private webviewOptions(uri: vscode.Uri, extraRoots: Set<string>): vscode.WebviewOptions {
        const roots: vscode.Uri[] = [
            vscode.Uri.joinPath(this.extensionUri, 'media'),
            vscode.Uri.file(path.dirname(uri.fsPath)),
            ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri),
            ...[...extraRoots].map(r => vscode.Uri.file(r)),
        ];
        return { enableScripts: true, localResourceRoots: roots };
    }

    private attach(panel: vscode.WebviewPanel, uri: vscode.Uri, line: number, retained: boolean): void {
        const entry: PreviewEntry = {
            uri,
            panel,
            roots: new Set(),
            renderId: 0,
            ready: false,
            line,
            retained,
            stale: false,
            visible: panel.visible,
            disposables: [],
        };
        const key = uri.toString();
        this.entries.set(key, entry);
        if (panel.active) {
            this.activeEntry = entry;
        }

        entry.disposables.push(
            panel.onDidDispose(() => {
                if (entry.timer) {
                    clearTimeout(entry.timer);
                }
                entry.disposables.forEach(d => d.dispose());
                this.entries.delete(key);
                if (this.activeEntry === entry) {
                    this.activeEntry = undefined;
                }
            }),
            panel.onDidChangeViewState(event => {
                const becameVisible = event.webviewPanel.visible && !entry.visible;
                entry.visible = event.webviewPanel.visible;
                if (becameVisible && (entry.stale || !entry.retained)) {
                    entry.stale = false;
                    void this.render(entry, true);
                }
                if (event.webviewPanel.active) {
                    this.activeEntry = entry;
                } else if (this.activeEntry === entry) {
                    this.activeEntry = undefined;
                }
            }),
            panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(entry, msg))
        );

        void this.render(entry);
    }

    private scheduleRender(entry: PreviewEntry, delay = getSettings().updateDelay): void {
        if (entry.timer) {
            clearTimeout(entry.timer);
        }
        entry.timer = setTimeout(() => {
            entry.timer = undefined;
            void this.render(entry);
        }, delay);
    }

    private async loadBibEntries(content: string, baseDir: string): Promise<BibEntry[]> {
        const entries: BibEntry[] = [];
        for (const bibPath of extractBibPaths(content, baseDir)) {
            try {
                const stat = await fs.promises.stat(bibPath);
                const cached = this.bibCache.get(bibPath);
                if (cached && cached.mtimeMs === stat.mtimeMs) {
                    entries.push(...cached.entries);
                    continue;
                }
                const parsed = parseBibTeX(await fs.promises.readFile(bibPath, 'utf-8')).entries;
                this.bibCache.set(bibPath, { mtimeMs: stat.mtimeMs, entries: parsed });
                entries.push(...parsed);
            } catch {
                // Missing or unreadable bibliography - skip
            }
        }
        return entries;
    }

    private async render(entry: PreviewEntry, forceReload = false): Promise<void> {
        if (!entry.panel.visible && !forceReload && entry.styles !== undefined) {
            entry.stale = true;
            return;
        }
        const renderId = ++entry.renderId;
        const baseDir = path.dirname(entry.uri.fsPath);

        let title = path.basename(entry.uri.fsPath);
        let styles = '';
        let body: string;
        try {
            const document = await vscode.workspace.openTextDocument(entry.uri);
            const content = preprocessContent(document.getText(), baseDir);
            const bibEntries = await this.loadBibEntries(content, baseDir);
            const html = await exportHtml(
                content,
                {
                    sourceLineMarkers: true,
                    bibEntries: bibEntries.length > 0 ? bibEntries : undefined,
                },
                false
            );
            const parts = splitExportedHtml(html);
            title = parts.title || title;
            styles = parts.styles;
            body = parts.body;
        } catch (error) {
            log.error('Org preview render failed', error instanceof Error ? error : undefined);
            const message = error instanceof Error ? error.message : String(error);
            body = `<div class="org-preview-error"><strong>Preview failed:</strong> ${escapeHtml(message)}</div>`;
        }

        if (renderId !== entry.renderId) {
            return; // A newer render has started
        }

        // Local images need their folder to be a resource root
        const newRoots: string[] = [];
        body = rewriteResourceUrls(body, baseDir, absPath => {
            const dir = path.dirname(absPath);
            if (!this.isUnderRoot(entry, dir) && !entry.roots.has(dir)) {
                newRoots.push(dir);
            }
            return entry.panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
        });
        let reload = forceReload || entry.styles === undefined || entry.styles !== styles;
        if (newRoots.length > 0) {
            newRoots.forEach(r => entry.roots.add(r));
            entry.panel.webview.options = this.webviewOptions(entry.uri, entry.roots);
            reload = true;
        }

        entry.panel.title = `Preview ${path.basename(entry.uri.fsPath)}`;

        if (reload) {
            this.loadPage(entry, { title, styles, body });
        } else if (entry.ready) {
            void entry.panel.webview.postMessage({ type: 'update', html: body, title });
        } else {
            entry.pending = { html: body, title };
        }
    }

    private isUnderRoot(entry: PreviewEntry, dir: string): boolean {
        const roots = [
            path.dirname(entry.uri.fsPath),
            ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
        ];
        return roots.some(root => {
            const rel = path.relative(root, dir);
            return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        });
    }

    private loadPage(entry: PreviewEntry, parts: { title: string; styles: string; body: string }): void {
        const webview = entry.panel.webview;
        const media = vscode.Uri.joinPath(this.extensionUri, 'media', 'orgPreview');
        const settings = getSettings();
        entry.ready = false;
        entry.pending = undefined;
        entry.styles = parts.styles;
        webview.html = buildPreviewPage({
            cspSource: webview.cspSource,
            nonce: crypto.randomBytes(16).toString('base64'),
            parts,
            styleUri: webview.asWebviewUri(vscode.Uri.joinPath(media, 'orgPreview.css')).toString(),
            scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(media, 'orgPreview.js')).toString(),
            state: {
                uri: entry.uri.toString(),
                line: entry.line,
                scrollPreviewWithEditor: settings.scrollPreviewWithEditor,
                scrollEditorWithPreview: settings.scrollEditorWithPreview,
            },
        });
    }

    private async onMessage(entry: PreviewEntry, msg: WebviewMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                entry.ready = true;
                if (entry.pending) {
                    void entry.panel.webview.postMessage({ type: 'update', ...entry.pending });
                    entry.pending = undefined;
                }
                break;
            case 'revealLine':
                if (typeof msg.line === 'number') {
                    this.revealInEditors(entry, msg.line);
                }
                break;
            case 'gotoLine':
                if (typeof msg.line === 'number') {
                    await this.gotoLine(entry, msg.line);
                }
                break;
            case 'openLink':
                if (typeof msg.href === 'string') {
                    await this.openLink(entry, msg.href);
                }
                break;
        }
    }

    private visibleEditors(entry: PreviewEntry): vscode.TextEditor[] {
        const key = entry.uri.toString();
        return vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === key);
    }

    /** Scroll source editors so that (1-based, possibly fractional) line is at the top */
    private revealInEditors(entry: PreviewEntry, line: number): void {
        entry.line = line;
        for (const editor of this.visibleEditors(entry)) {
            const lineIndex = Math.max(0, Math.min(Math.floor(line) - 1, editor.document.lineCount - 1));
            this.ignoreEditorScrollUntil = Date.now() + 150;
            editor.revealRange(
                new vscode.Range(lineIndex, 0, lineIndex, 0),
                vscode.TextEditorRevealType.AtTop
            );
        }
    }

    /** Put the cursor on a source line (double-click in the preview) */
    private async gotoLine(entry: PreviewEntry, line: number): Promise<void> {
        const visible = this.visibleEditors(entry)[0];
        // Focus the source editor: the fold commands act on the active editor
        const editor = await vscode.window.showTextDocument(entry.uri, {
            viewColumn: visible?.viewColumn ?? entry.panel.viewColumn,
        });
        const lineIndex = Math.max(0, Math.min(line - 1, editor.document.lineCount - 1));
        const pos = new vscode.Position(lineIndex, 0);
        editor.selection = new vscode.Selection(pos, pos);
        // Open every fold (collapsed heading, block, drawer) hiding the line
        await vscode.commands.executeCommand('editor.unfold', {
            levels: 100,
            direction: 'up',
            selectionLines: [lineIndex],
        });
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private async openLink(entry: PreviewEntry, href: string): Promise<void> {
        if (/^(https?|mailto):/i.test(href)) {
            await vscode.env.openExternal(vscode.Uri.parse(href));
            return;
        }
        const baseDir = path.dirname(entry.uri.fsPath);
        // Drop org search options (file.org::*Heading) and URL fragments
        let target = href.replace(/::.*$/, '').replace(/#.*$/, '');
        try {
            target = decodeURI(target);
        } catch {
            // Keep the raw value
        }
        let filePath = resolveLocalResource(target, baseDir);
        if (!filePath) {
            vscode.window.showInformationMessage(`Cannot open link from preview: ${href}`);
            return;
        }
        // The exporter points links to other org files at their .html export
        if (!fs.existsSync(filePath) && filePath.endsWith('.html')) {
            const orgPath = filePath.replace(/\.html$/, '.org');
            if (fs.existsSync(orgPath)) {
                filePath = orgPath;
            }
        }
        if (!fs.existsSync(filePath)) {
            vscode.window.showWarningMessage(`File not found: ${filePath}`);
            return;
        }
        const column = this.visibleEditors(entry)[0]?.viewColumn ?? entry.panel.viewColumn;
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), column);
    }
}

/**
 * Register the org preview commands and panel serializer
 */
export function registerOrgPreview(context: vscode.ExtensionContext): OrgPreviewManager {
    const manager = new OrgPreviewManager(context.extensionUri);
    context.subscriptions.push(
        manager,
        vscode.window.registerWebviewPanelSerializer('scimax.org.preview', manager),
        vscode.commands.registerCommand('scimax.org.preview.open', () => manager.open(false)),
        vscode.commands.registerCommand('scimax.org.preview.openToSide', () => manager.open(true)),
        vscode.commands.registerCommand('scimax.org.preview.showSource', () => manager.showSource())
    );
    return manager;
}
