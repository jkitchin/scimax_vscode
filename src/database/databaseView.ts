/**
 * Database view: a webview about the Scimax database, in the manner of the
 * agenda and search views. It shows what is in the index (counts, size,
 * embeddings, the folders with the most files), runs the maintenance
 * commands (sync, rebuild, optimize, backup...) and edits the database and
 * search settings in place, with a link to each one in VS Code's settings.
 *
 * The settings come from package.json (their type, default, enum and
 * description), so a new scimax.db.* or scimax.search.* setting shows up
 * here without changes. A value is written where it is set now: the
 * workspace when it has a workspace value, the user settings otherwise.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { getDatabase } from './lazyDb';
import type { ScimaxDb } from './scimaxDb';

const VIEW_TYPE = 'scimax.databaseView';

/** Commands the webview may run, with the label and help its buttons show. */
const ACTIONS: Array<{ group: string; command: string; label: string; detail: string; danger?: boolean }> = [
    { group: 'Index', command: 'scimax.db.refresh', label: 'Sync files', detail: 'Index new and changed files in the indexed folders, and drop deleted ones' },
    { group: 'Index', command: 'scimax.db.removeOutOfScope', label: 'Remove files outside indexed folders', detail: 'Files saved elsewhere or left from before: pick which to remove' },
    { group: 'Index', command: 'scimax.db.cancelSync', label: 'Cancel sync', detail: 'Stop a background sync' },
    { group: 'Index', command: 'scimax.db.rebuild', label: 'Rebuild', detail: 'Clear the index and index everything again (asks first)', danger: true },
    { group: 'Maintenance', command: 'scimax.db.optimize', label: 'Optimize', detail: 'VACUUM and rebuild the full-text index' },
    { group: 'Maintenance', command: 'scimax.db.verify', label: 'Verify integrity', detail: 'Check the SQLite file for corruption' },
    { group: 'Maintenance', command: 'scimax.db.backup', label: 'Back up', detail: 'Copy the database to a file' },
    { group: 'Maintenance', command: 'scimax.db.restore', label: 'Restore', detail: 'Replace the database with a backup' },
    { group: 'Maintenance', command: 'scimax.db.clear', label: 'Clear', detail: 'Remove everything from the index (asks first)', danger: true },
    { group: 'Search', command: 'scimax.search.view', label: 'Search view', detail: 'Search the index as you type' },
    { group: 'Search', command: 'scimax.db.browseFiles', label: 'Browse indexed files', detail: 'Open a file from the index' },
    { group: 'Search', command: 'scimax.db.setScope', label: 'Set search scope', detail: 'Search all files, one folder or one project' },
    { group: 'Embeddings', command: 'scimax.db.configureEmbeddings', label: 'Configure embeddings', detail: 'Set up Ollama for semantic search' },
    { group: 'Embeddings', command: 'scimax.db.cancelEmbeddings', label: 'Cancel embeddings', detail: 'Stop making embeddings' },
];

/** Setting sections, by key prefix; the first match wins. */
const SECTIONS: Array<{ title: string; match: RegExp }> = [
    { title: 'What gets indexed', match: /^scimax\.db\.(include\w*|exclude|fileExtensions)$/ },
    { title: 'Embeddings', match: /^scimax\.db\.(embeddingProvider|ollama\w*)$/ },
    { title: 'Syncing', match: /^scimax\.db\.(autoIndex|autoCheckStale|checkStaleOnActivation|staleCheckDelayMs|dirsPerSession|max(Reindex|NewFiles)PerSync|reindex\w*|maxFilesPerReindex)$/ },
    { title: 'Limits', match: /^scimax\.db\./ },
    { title: 'Search', match: /^scimax\.search\./ },
];

interface SettingInfo {
    key: string;
    section: string;
    type: string;
    description: string;
    default: unknown;
    value: unknown;
    enum?: string[];
    enumDescriptions?: string[];
    minimum?: number;
    maximum?: number;
    /** Where the value comes from */
    where: 'default' | 'user' | 'workspace' | 'folder';
}

type FromWebview =
    | { type: 'ready' }
    | { type: 'refresh' }
    | { type: 'run'; command: string }
    | { type: 'set'; key: string; value: unknown }
    | { type: 'reset'; key: string }
    | { type: 'openSetting'; key?: string }
    | { type: 'openSettingsJson' }
    | { type: 'reveal' }
    | { type: 'addInclude' }
    | { type: 'exclude'; folder: string }
    | { type: 'openFile'; path: string };

export class DatabaseWebview implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private panelDisposables: vscode.Disposable[] = [];
    private timer: ReturnType<typeof setInterval> | undefined;
    private reloadTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly extension: vscode.Extension<unknown>, private readonly extensionUri: vscode.Uri) {
        this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.db') || e.affectsConfiguration('scimax.search')) void this.sendSettings();
        }));
    }

    open(): void {
        if (this.panel) { this.panel.reveal(); return; }
        this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Scimax Database', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'databaseView')],
        });
        this.panel.iconPath = new vscode.ThemeIcon('database');
        this.panel.webview.html = this.html(this.panel.webview);
        this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m), undefined, this.panelDisposables);
        this.panel.onDidDispose(() => {
            this.panel = undefined;
            if (this.timer) clearInterval(this.timer);
            this.timer = undefined;
            for (const d of this.panelDisposables) d.dispose();
            this.panelDisposables = [];
        }, undefined, this.panelDisposables);
        // Counts change while a sync or the embedding queue runs.
        this.timer = setInterval(() => { if (this.panel?.visible) void this.sendStats(false); }, 5000);
        void getDatabase().then(db => {
            if (!db || !this.panel) return;
            const soon = () => this.scheduleStats();
            this.panelDisposables.push(db.onDidIndexFile(soon), db.onDidChangeEmbeddings(soon), db.onDidClear(soon), db.onDidRebuild(soon));
        });
    }

    private scheduleStats(): void {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => void this.sendStats(true), 1000);
    }

    private async onMessage(m: FromWebview): Promise<void> {
        switch (m.type) {
            case 'ready':
                void this.panel?.webview.postMessage({ type: 'actions', actions: ACTIONS });
                await Promise.all([this.sendStats(true), this.sendSettings()]);
                break;
            case 'refresh':
                await this.sendStats(true);
                break;
            case 'run': {
                if (!ACTIONS.some(a => a.command === m.command)) return;
                try {
                    await vscode.commands.executeCommand(m.command);
                } finally {
                    await this.sendStats(true);
                }
                break;
            }
            case 'set':
                await this.update(m.key, m.value);
                break;
            case 'reset':
                await this.update(m.key, undefined);
                break;
            case 'openSetting':
                await vscode.commands.executeCommand('workbench.action.openSettings', m.key ?? 'scimax.db');
                break;
            case 'openSettingsJson':
                await vscode.commands.executeCommand('workbench.action.openSettingsJson');
                break;
            case 'reveal': {
                const db = await getDatabase();
                if (db) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(db.getDatabasePath()));
                break;
            }
            case 'addInclude': {
                const picked = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: true,
                    canSelectMany: true,
                    openLabel: 'Index',
                    title: 'Folders or files to index',
                });
                if (!picked?.length) return;
                const current = vscode.workspace.getConfiguration().get<string[]>('scimax.db.include', []);
                const added = picked.map(u => u.fsPath).filter(p => !current.includes(p));
                if (added.length) await this.update('scimax.db.include', [...current, ...added]);
                break;
            }
            case 'openFile': {
                const db = await getDatabase();
                // Only open files the index knows about.
                if (!db || !(await db.getRecentFiles(50)).some(f => f.path === m.path)) return;
                await vscode.window.showTextDocument(vscode.Uri.file(m.path), { preview: true });
                break;
            }
            case 'exclude': {
                const current = vscode.workspace.getConfiguration().get<string[]>('scimax.db.exclude', []);
                if (current.includes(m.folder)) return;
                await this.update('scimax.db.exclude', [...current, m.folder]);
                const choice = await vscode.window.showInformationMessage(
                    `Added ${m.folder} to scimax.db.exclude. Its files stay in the index until removed.`,
                    'Remove them now'
                );
                if (choice) {
                    await vscode.commands.executeCommand('scimax.db.removeOutOfScope');
                    await this.sendStats(true);
                }
                break;
            }
        }
    }

    /** Write a setting where it is set now: workspace if it has a workspace value, else user. */
    private async update(key: string, value: unknown): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const inspect = config.inspect(key);
        const target = inspect?.workspaceValue !== undefined
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        try {
            await config.update(key, value, target);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not set ${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
        await this.sendSettings();
    }

    private async sendStats(full: boolean): Promise<void> {
        if (!this.panel) return;
        const db = await getDatabase();
        if (!db) {
            void this.panel.webview.postMessage({ type: 'stats', missing: true });
            return;
        }
        try {
            const message: Record<string, unknown> = { type: 'stats', ...(await statsOf(db)) };
            if (full) {
                const [folders, recent, schema] = await Promise.all([
                    db.getFileCountsByFolder(15),
                    db.getRecentFiles(8),
                    db.getSchemaInfo().catch(() => undefined),
                ]);
                message.folders = folders.map(f => ({ ...f, label: tildify(f.folder) }));
                message.recent = recent.map(f => ({ path: f.path, label: vscode.workspace.asRelativePath(f.path, true), mtime: f.mtime }));
                message.schema = schema ? { current: schema.currentVersion, latest: schema.latestVersion } : undefined;
            }
            void this.panel?.webview.postMessage(message);
        } catch (error) {
            void this.panel?.webview.postMessage({ type: 'stats', error: error instanceof Error ? error.message : String(error) });
        }
    }

    private async sendSettings(): Promise<void> {
        if (!this.panel) return;
        void this.panel.webview.postMessage({ type: 'settings', settings: settingsOf(this.extension), sections: SECTIONS.map(s => s.title) });
    }

    private html(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const media = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'databaseView', file));
        const csp = [`default-src 'none'`, `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('databaseView.css')}">
</head>
<body>
<header>
  <h1>Scimax Database</h1>
  <span class="spacer"></span>
  <button id="refresh" title="Read the numbers again">Refresh</button>
  <button id="openSettings" title="Database settings in VS Code's Settings editor">Open settings</button>
  <button id="openJson" title="Edit settings.json">settings.json</button>
</header>
<main>
  <section>
    <h2>Overview</h2>
    <div id="cards" class="cards"></div>
    <div id="dbPath" class="muted pathLine"></div>
  </section>
  <section>
    <h2>Actions</h2>
    <div id="actions" class="actions"></div>
  </section>
  <section class="twoCol">
    <div>
      <h2>Folders with the most files</h2>
      <p class="muted">Exclude a folder to keep its files out of the index.</p>
      <table id="folders" class="table"></table>
    </div>
    <div>
      <h2>Recently changed files</h2>
      <table id="recent" class="table"></table>
    </div>
  </section>
  <section>
    <h2>Settings</h2>
    <p class="muted">Changes are saved as you make them, to your user settings, or to the workspace's when the setting is set there. ⚙ opens a setting in VS Code's Settings editor.</p>
    <input id="settingsFilter" type="search" placeholder="Filter settings" aria-label="Filter settings">
    <div id="settings"></div>
  </section>
</main>
<script nonce="${nonce}" src="${media('databaseView.js')}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.timer) clearInterval(this.timer);
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.panel?.dispose();
        for (const d of this.disposables) d.dispose();
    }
}

function tildify(p: string): string {
    const home = process.env.HOME || process.env.USERPROFILE;
    return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

async function statsOf(db: ScimaxDb): Promise<Record<string, unknown>> {
    const stats = await db.getStats();
    const scope = db.getSearchScope();
    const vector = db.getVectorSearchStatus();
    return {
        files: stats.files,
        byType: stats.by_type,
        headings: stats.headings,
        blocks: stats.blocks,
        chunks: stats.chunks,
        size: stats.database_size,
        lastIndexed: stats.last_indexed,
        embeddings: {
            stored: stats.has_embeddings,
            supported: vector.supported,
            error: vector.error,
            service: vector.hasEmbeddings,
            progress: db.getEmbeddingProgress(),
        },
        scope: scope.type === 'all' ? 'All files' : `${scope.type === 'project' ? 'Project' : 'Folder'}: ${tildify(scope.path ?? '')}`,
        dbPath: tildify(db.getDatabasePath()),
        dbFile: path.basename(db.getDatabasePath()),
    };
}

/** Every scimax.db.* and scimax.search.* setting, with its schema and current value. */
function settingsOf(extension: vscode.Extension<unknown>): SettingInfo[] {
    const pkg = extension.packageJSON as { contributes?: { configuration?: unknown } };
    const raw = pkg.contributes?.configuration;
    const blocks = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{ properties?: Record<string, any> }>;
    const config = vscode.workspace.getConfiguration();
    const out: SettingInfo[] = [];
    for (const block of blocks) {
        for (const [key, schema] of Object.entries(block.properties ?? {})) {
            const section = SECTIONS.find(s => s.match.test(key));
            if (!section || schema.deprecationMessage || schema.markdownDeprecationMessage) continue;
            const inspect = config.inspect(key);
            const where = inspect?.workspaceFolderValue !== undefined ? 'folder'
                : inspect?.workspaceValue !== undefined ? 'workspace'
                : inspect?.globalValue !== undefined ? 'user' : 'default';
            out.push({
                key,
                section: section.title,
                type: Array.isArray(schema.type) ? schema.type[0] : schema.type,
                description: String(schema.markdownDescription ?? schema.description ?? ''),
                default: schema.default,
                value: config.get(key),
                enum: schema.enum,
                enumDescriptions: schema.enumDescriptions ?? schema.markdownEnumDescriptions,
                minimum: schema.minimum,
                maximum: schema.maximum,
                where,
            });
        }
    }
    return out;
}

export function registerDatabaseWebview(context: vscode.ExtensionContext): void {
    const view = new DatabaseWebview(context.extension, context.extensionUri);
    context.subscriptions.push(
        view,
        vscode.commands.registerCommand('scimax.db.view', () => view.open()),
    );
}
