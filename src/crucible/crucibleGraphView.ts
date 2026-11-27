/**
 * The Crucible graph: an interactive SVG of a crucible's knowledge graph
 * (`crucible graph --json`) in a webview. It shows the whole crucible,
 * centred on the article you are reading, and follows you as you open other
 * articles. Clicking an article or source opens it.
 *
 * The layout and drawing live in media/crucibleGraph/crucibleGraph.js.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { CrucibleGraph, cruciblePaths, findCrucibleRoot, graphNodeForFile } from './crucibleCli';

type LoadGraph = (root: string) => Promise<CrucibleGraph>;
/** Search a crucible; returns the matching article paths, relative to its root. */
export type SearchGraph = (root: string, query: string, tags: string[], types: string[]) => Promise<string[]>;

interface GraphPanel {
    panel: vscode.WebviewPanel;
    graph?: CrucibleGraph;
}

export class CrucibleGraphView implements vscode.Disposable {
    /** One panel per crucible root. */
    private panels = new Map<string, GraphPanel>();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly loadGraph: LoadGraph,
        private readonly search: SearchGraph,
        private readonly onError: (error: unknown) => Promise<void>,
    ) {
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            const uri = editor?.document.uri;
            if (uri?.scheme === 'file') {
                this.follow(uri.fsPath);
            }
        }));
    }

    /** Show the graph of the crucible at `root`, centred on `file` when it is one of its articles. */
    async show(root: string, name: string, file?: string): Promise<void> {
        let entry = this.panels.get(root);
        if (entry) {
            entry.panel.reveal(undefined, true);
        } else {
            const panel = vscode.window.createWebviewPanel('scimax.crucibleGraph', `Graph: ${name}`,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'crucibleGraph')],
                });
            const created: GraphPanel = { panel };
            entry = created;
            this.panels.set(root, created);
            panel.onDidDispose(() => this.panels.delete(root));
            panel.webview.onDidReceiveMessage(message => this.onMessage(root, created, message));
            panel.webview.html = this.html(panel.webview);
            return; // The webview asks for the graph when it is ready.
        }
        await this.send(root, entry, file);
    }

    /** Reload the graph of `root` (after a sync), if its panel is open. */
    async refresh(root: string): Promise<void> {
        const entry = this.panels.get(root);
        if (entry) {
            await this.send(root, entry, vscode.window.activeTextEditor?.document.uri.fsPath, true);
        }
    }

    /** Centre the open graph of `file`'s crucible on it. */
    private follow(file: string): void {
        const root = findCrucibleRoot(file);
        const entry = root ? this.panels.get(root) : undefined;
        if (!entry?.graph || !file.startsWith(cruciblePaths(root!).wiki + path.sep)) {
            return;
        }
        const id = graphNodeForFile(entry.graph, file);
        if (id) {
            void entry.panel.webview.postMessage({ type: 'focus', id });
        }
    }

    private async send(root: string, entry: GraphPanel, file?: string, keepView = false): Promise<void> {
        try {
            entry.graph = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Loading crucible graph' },
                () => this.loadGraph(root));
        } catch (error) {
            void entry.panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            await this.onError(error);
            return;
        }
        const focus = file && findCrucibleRoot(file) === root ? graphNodeForFile(entry.graph, file) : undefined;
        void entry.panel.webview.postMessage({ type: 'graph', graph: entry.graph, focus, keepView });
    }

    private async onMessage(root: string, entry: GraphPanel, message: {
        type: string; path?: string; id?: number; query?: string; tags?: string[]; types?: string[];
    }): Promise<void> {
        switch (message.type) {
            case 'search': {
                const reply = { type: 'searchResults', id: message.id };
                try {
                    const paths = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Window, title: 'Searching crucible' },
                        () => this.search(root, message.query ?? '', message.tags ?? [], message.types ?? []));
                    void entry.panel.webview.postMessage({ ...reply, paths });
                } catch (error) {
                    void entry.panel.webview.postMessage({ ...reply, error: error instanceof Error ? error.message : String(error) });
                }
                return;
            }
            case 'ready':
                await this.send(root, entry, vscode.window.activeTextEditor?.document.uri.fsPath);
                return;
            case 'refresh':
                await this.send(root, entry, undefined, true);
                return;
            case 'open': {
                // Only paths inside this crucible are opened.
                const file = message.path ? path.resolve(root, message.path) : undefined;
                if (!file || !file.startsWith(path.resolve(root) + path.sep)) {
                    return;
                }
                const uri = vscode.Uri.file(file);
                if (file.endsWith('.org')) {
                    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
                } else {
                    await vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.One);
                }
                return;
            }
        }
    }

    private html(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const media = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'crucibleGraph', file));
        const csp = [`default-src 'none'`, `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('crucibleGraph.css')}">
</head>
<body>
<div class="toolbar">
  <input id="find" type="search" placeholder="Find an article or concept" list="titles">
  <datalist id="titles"></datalist>
  <label><input type="checkbox" id="showConcepts" checked> Concepts</label>
  <label><input type="checkbox" id="showSources"> Sources</label>
  <label><input type="checkbox" id="showLabels"> All labels</label>
  <button id="zoomOut" title="Zoom out (-)">&minus;</button>
  <button id="zoomIn" title="Zoom in (+)">+</button>
  <button id="center" title="Centre on the current article (c)">Centre</button>
  <button id="fit" title="Fit the whole graph (f)">Fit</button>
  <button id="reload" title="Reload the graph from crucible">Reload</button>
  <span id="status"></span>
</div>
<div class="toolbar filters">
  <input id="query" type="search" placeholder="Search filter (Enter): crucible search">
  <span class="tagFilter">
    <input id="tagInput" type="search" placeholder="Add tag filter" list="tagNames">
    <datalist id="tagNames"></datalist>
    <span id="tagChips"></span>
  </span>
  <span class="types" role="group" aria-label="Article types">
    <label><input type="checkbox" data-type="concept"> concept</label>
    <label><input type="checkbox" data-type="summary"> summary</label>
    <label><input type="checkbox" data-type="comparison"> comparison</label>
    <label><input type="checkbox" data-type="method"> method</label>
  </span>
  <label title="Also show the nodes linked to the matches"><input type="checkbox" id="withNeighbours" checked> Neighbours</label>
  <button id="clearFilter" title="Show everything">Clear</button>
</div>
<svg id="graph" tabindex="0" aria-label="Crucible knowledge graph"></svg>
<div id="tooltip" hidden></div>
<div class="legend">
  <span class="key concept-article">concept article</span>
  <span class="key summary">summary</span>
  <span class="key comparison">comparison</span>
  <span class="key method">method</span>
  <span class="key tag">concept tag</span>
  <span class="key source">source</span>
</div>
<script nonce="${nonce}" src="${media('crucibleGraph.js')}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this.panels.forEach(entry => entry.panel.dispose());
        this.disposables.forEach(d => d.dispose());
    }
}
