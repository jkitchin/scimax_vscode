/**
 * Task dependency graph webview.
 *
 * Renders the TODO dependency graph with vis.js: nodes are tasks colored by
 * status (done / blocked / ready), edges point from a task to the task it
 * depends on. Seeded from the active file's tasks and expanded over the
 * dependency edges (both directions) to show the connected component.
 *
 * A lean parallel to the file link-graph provider — it reuses the same vis.js +
 * postMessage approach but with its own compact, task-specific webview.
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import { isDoneStateName } from './dependencies';

interface GraphNode {
    id: string;
    label: string;
    title: string;         // tooltip
    color: string;
    filePath?: string;
    lineNumber?: number;
}
interface GraphEdge { from: string; to: string; }

const COLOR_DONE = '#4caf50';
const COLOR_BLOCKED = '#e53935';
const COLOR_READY = '#1e88e5';
const COLOR_UNKNOWN = '#9e9e9e';

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

export class TaskGraphProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {}

    async show(): Promise<void> {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'scimaxTaskGraph',
                'Task Dependency Graph',
                vscode.ViewColumn.Beside,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            this.panel.webview.html = this.getHtml();
            this.panel.webview.onDidReceiveMessage(m => this.onMessage(m), undefined, this.context.subscriptions);
            this.panel.onDidDispose(() => { this.panel = undefined; });
        }
        await this.update();
    }

    private async onMessage(message: any): Promise<void> {
        if (message?.type === 'ready') {
            await this.update();
        } else if (message?.type === 'openNode' && message.filePath && message.lineNumber) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.filePath));
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            const pos = new vscode.Position(Math.max(0, message.lineNumber - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    }

    /** Refresh the graph if the panel is open (e.g. after a save). */
    async refresh(): Promise<void> {
        if (this.panel) await this.update();
    }

    private async update(): Promise<void> {
        if (!this.panel) return;
        const data = await this.buildGraph();
        this.panel.webview.postMessage({ type: 'setData', ...data });
    }

    private async buildGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
        const db = await getDatabase();
        if (!db) return { nodes: [], edges: [] };

        const allEdges = await db.getAllDependencies();
        // Adjacency (both directions) for BFS and blocked computation.
        const deps = new Map<string, Set<string>>();   // id -> ids it depends on
        const rev = new Map<string, Set<string>>();     // id -> ids that depend on it
        for (const e of allEdges) {
            if (!e.from_id || !e.to_id) continue;
            (deps.get(e.from_id) ?? deps.set(e.from_id, new Set()).get(e.from_id)!).add(e.to_id);
            (rev.get(e.to_id) ?? rev.set(e.to_id, new Set()).get(e.to_id)!).add(e.from_id);
        }

        // Seed from the active file's task ids (fall back to all edge ids).
        const seed = new Set<string>();
        const editor = vscode.window.activeTextEditor;
        if (editor && isOrg(editor.document)) {
            const text = editor.document.getText();
            const re = /^\s*:ID:\s*(\S+)/gim;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const id = m[1].replace(/^id:/i, '');
                if (deps.has(id) || rev.has(id)) seed.add(id);
            }
        }
        if (seed.size === 0) {
            for (const e of allEdges) { seed.add(e.from_id); seed.add(e.to_id); }
        }

        // BFS over both directions, capped for readability.
        const MAX_NODES = 200;
        const included = new Set<string>();
        const queue = [...seed];
        while (queue.length && included.size < MAX_NODES) {
            const id = queue.shift()!;
            if (included.has(id)) continue;
            included.add(id);
            for (const n of deps.get(id) ?? []) if (!included.has(n)) queue.push(n);
            for (const n of rev.get(id) ?? []) if (!included.has(n)) queue.push(n);
        }

        // Resolve each node and compute status.
        const nodes: GraphNode[] = [];
        const stateCache = new Map<string, { done: boolean; title: string; file?: string; line?: number; found: boolean }>();
        const resolve = async (id: string) => {
            if (stateCache.has(id)) return stateCache.get(id)!;
            const h = await db.getHeadingById(id);
            const rec = h
                ? { done: isDoneStateName(h.todo_state), title: h.title, file: h.file_path, line: h.line_number, found: true }
                : { done: false, title: id, file: undefined, line: undefined, found: false };
            stateCache.set(id, rec);
            return rec;
        };

        for (const id of included) {
            const rec = await resolve(id);
            let color = COLOR_UNKNOWN;
            if (!rec.found) color = COLOR_UNKNOWN;
            else if (rec.done) color = COLOR_DONE;
            else {
                // blocked if any dependency is not done
                let blocked = false;
                for (const depId of deps.get(id) ?? []) {
                    const dep = await resolve(depId);
                    if (!dep.done) { blocked = true; break; }
                }
                color = blocked ? COLOR_BLOCKED : COLOR_READY;
            }
            const statusLabel = color === COLOR_DONE ? 'done'
                : color === COLOR_BLOCKED ? 'blocked'
                : color === COLOR_READY ? 'ready' : 'unresolved';
            nodes.push({
                id,
                label: rec.title.length > 40 ? rec.title.slice(0, 38) + '…' : rec.title,
                title: `${rec.title} — ${statusLabel}`,
                color,
                filePath: rec.file,
                lineNumber: rec.line,
            });
        }

        const edges: GraphEdge[] = [];
        for (const e of allEdges) {
            if (included.has(e.from_id) && included.has(e.to_id)) {
                edges.push({ from: e.from_id, to: e.to_id });
            }
        }
        return { nodes, edges };
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline'; img-src data:;">
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, sans-serif); background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #ccc); overflow: hidden; }
  #graph { width: 100vw; height: 100vh; }
  .legend { position: absolute; top: 10px; left: 10px; z-index: 10; background: var(--vscode-sideBar-background, #252526); padding: 10px 12px; border-radius: 6px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .legend .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .empty { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); color: var(--vscode-descriptionForeground, #888); }
</style>
</head>
<body>
  <div class="legend">
    <div class="row"><span class="dot" style="background:${COLOR_READY}"></span> ready</div>
    <div class="row"><span class="dot" style="background:${COLOR_BLOCKED}"></span> blocked</div>
    <div class="row"><span class="dot" style="background:${COLOR_DONE}"></span> done</div>
    <div class="row"><span class="dot" style="background:${COLOR_UNKNOWN}"></span> unresolved</div>
  </div>
  <div id="graph"></div>
  <div class="empty" id="empty" style="display:none">No task dependencies found. Add a :DEPENDS: property to a task.</div>
<script>
  const vscode = acquireVsCodeApi();
  let network;
  const nodeMeta = new Map();
  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type !== 'setData') return;
    render(msg.nodes || [], msg.edges || []);
  });
  function render(nodes, edges) {
    document.getElementById('empty').style.display = nodes.length ? 'none' : 'block';
    nodeMeta.clear();
    nodes.forEach(n => nodeMeta.set(n.id, n));
    const visNodes = nodes.map(n => ({
      id: n.id, label: n.label, title: n.title,
      color: { background: n.color, border: n.color },
      font: { color: '#ffffff' }, shape: 'box', margin: 8,
    }));
    const visEdges = edges.map(e => ({ from: e.from, to: e.to, arrows: 'to' }));
    const container = document.getElementById('graph');
    const data = { nodes: new vis.DataSet(visNodes), edges: new vis.DataSet(visEdges) };
    const options = {
      layout: { improvedLayout: true },
      physics: { stabilization: true, barnesHut: { gravitationalConstant: -3000, springLength: 120 } },
      interaction: { hover: true, tooltipDelay: 150 },
      edges: { color: { color: '#888', highlight: '#fff' }, smooth: { type: 'cubicBezier' } },
    };
    network = new vis.Network(container, data, options);
    network.on('click', params => {
      if (params.nodes.length) {
        const meta = nodeMeta.get(params.nodes[0]);
        if (meta && meta.filePath) vscode.postMessage({ type: 'openNode', filePath: meta.filePath, lineNumber: meta.lineNumber });
      }
    });
  }
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}

export function registerTaskGraph(context: vscode.ExtensionContext): void {
    const provider = new TaskGraphProvider(context);
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.showTaskGraph', () => provider.show()),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isOrg(doc)) void provider.refresh();
        })
    );
}
