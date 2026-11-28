/**
 * Team view: each person's planned work, week by week, against their
 * capacity, across every project (see teamModel.ts for how load and
 * capacity are worked out). A companion to the project view's Gantt chart,
 * which shows one project's tasks over time; this shows people's time.
 *
 * Tasks come from every indexed file with task metadata (:ASSIGNEE: or
 * :DEPENDS:), read from disk (or the open editor), so the view covers the
 * whole portfolio; a toolbar menu narrows it to one workspace folder.
 * People are the indexed :person: headings, with :CAPACITY: and "Away"
 * subheadings. Double-click a task to open it. The view reloads when an org
 * file is saved.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { setPanelThemeIcon } from '../utils/webviewIcon';
import { getDatabase } from '../database/lazyDb';
import { org } from '../parser/orgModify';
import { extractProjectTasks } from '../parser/projectTasks';
import { loadOrgDocuments, projectRootFor } from './projectData';
import { getPeople, invalidatePeopleCache } from './people';
import { revealTask } from './taskActions';
import { buildTeamModel, mondayOf, parseCapacity, parseIsoDay, readAway, type TeamPerson, type TeamTask } from './teamModel';

interface TeamViewOptions {
    /** ISO Monday of the first week. */
    start: string;
    weeks: number;
    /** Projects to include; all when empty. */
    projects: string[];
    /** A workspace folder to confine the view to, or '' for everything indexed. */
    scope: string;
    /** Show hours, or percent of capacity. */
    unit: 'hours' | 'percent';
}

type FromWebview =
    | { type: 'ready' }
    | { type: 'refresh' }
    | { type: 'options'; options: TeamViewOptions }
    | { type: 'open'; filePath: string; line: number };

function isInside(file: string, root: string): boolean {
    const rel = path.relative(root, file);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Every task in the indexed task files (and open org files), labelled with its project. */
async function loadTeamTasks(scope: string): Promise<TeamTask[]> {
    const db = await getDatabase();
    const files = new Set<string>();
    if (db) {
        for (const prop of ['ASSIGNEE', 'DEPENDS']) {
            for (const h of await db.searchByProperty(prop)) files.add(h.file_path);
        }
    }
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file' && doc.fileName.endsWith('.org') && /:(ASSIGNEE|DEPENDS):/i.test(doc.getText())) {
            files.add(doc.uri.fsPath);
        }
    }
    const inScope = [...files].filter(f => !scope || isInside(f, scope)).sort();
    const tasks: TeamTask[] = [];
    const ganttIds = { used: new Set<string>(), counter: 0 };
    for (const { filePath, doc } of await loadOrgDocuments(inScope)) {
        const root = projectRootFor(vscode.Uri.file(filePath));
        const project = root ? path.basename(root) : path.basename(path.dirname(filePath));
        for (const t of extractProjectTasks(doc, org.getAllHeadlines(doc), { todoOnly: true, file: filePath, ganttIds })) {
            tasks.push({ ...t, file: filePath, project });
        }
    }
    return tasks;
}

/** The indexed people, with capacity, and time away read from their files. */
async function loadTeamPeople(): Promise<TeamPerson[]> {
    invalidatePeopleCache();
    const people = await getPeople();
    const awayByFile = new Map<string, Map<number, Array<[string, string]>>>();
    const awayIn = (file: string) => {
        let map = awayByFile.get(file);
        if (!map) {
            const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file);
            let text = '';
            try { text = open ? open.getText() : fs.readFileSync(file, 'utf-8'); } catch { /* unreadable: no time away */ }
            map = readAway(text.split(/\r?\n/));
            awayByFile.set(file, map);
        }
        return map;
    };
    return people.map(p => ({
        handle: p.handle,
        name: p.name,
        role: p.role,
        capacity: parseCapacity(p.capacity),
        away: awayIn(p.filePath).get(p.lineNumber) ?? [],
        filePath: p.filePath,
        line: p.lineNumber,
    }));
}

class TeamView implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private tasks: TeamTask[] = [];
    private people: TeamPerson[] = [];
    private options: TeamViewOptions = {
        start: '', weeks: 12, projects: [], scope: '', unit: 'hours',
    };
    private reloadTimer: NodeJS.Timeout | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly extensionUri: vscode.Uri) {
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (this.panel && doc.fileName.endsWith('.org')) this.scheduleReload();
            }),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('scimax.team')) this.post();
            })
        );
    }

    async open(): Promise<void> {
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel('scimax.teamView', 'Team', vscode.ViewColumn.Active, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'teamView')],
            });
            setPanelThemeIcon(this.panel, 'organization');
            this.panel.webview.html = this.html(this.panel.webview);
            this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m), undefined, this.disposables);
            this.panel.onDidDispose(() => { this.panel = undefined; }, undefined, this.disposables);
        }
        await this.reload();
    }

    async reload(): Promise<void> {
        if (!this.panel) return;
        const [tasks, people] = await Promise.all([loadTeamTasks(this.options.scope), loadTeamPeople()]);
        this.tasks = tasks;
        this.people = people;
        this.post();
    }

    private scheduleReload(): void {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => void this.reload(), 300);
    }

    private post(): void {
        if (!this.panel) return;
        const config = vscode.workspace.getConfiguration('scimax.team');
        const start = this.options.start ? parseIsoDay(this.options.start) : mondayOf(new Date());
        const model = buildTeamModel(this.tasks, this.people, {
            start,
            weeks: this.options.weeks,
            projects: this.options.projects,
            defaultCapacity: parseCapacity(config.get<string>('defaultCapacity', '')),
        });
        const folders = (vscode.workspace.workspaceFolders ?? []).map(f => ({ path: f.uri.fsPath, name: f.name }));
        void this.panel.webview.postMessage({ type: 'model', model, options: this.options, folders });
    }

    private async onMessage(message: FromWebview): Promise<void> {
        switch (message.type) {
            case 'ready':
            case 'refresh':
                await this.reload();
                break;
            case 'options': {
                const scopeChanged = message.options.scope !== this.options.scope;
                this.options = message.options;
                if (scopeChanged) await this.reload();
                else this.post();
                break;
            }
            case 'open':
                await revealTask(message.filePath, message.line);
                break;
        }
    }

    private html(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'teamView', file));
        const csp = [`default-src 'none'`, `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('teamView.css')}">
<title>Team</title>
</head>
<body>
<div class="toolbar">
  <button id="prev" title="Earlier weeks">&#x2039;</button>
  <button id="today" title="Start at this week">This week</button>
  <button id="next" title="Later weeks">&#x203A;</button>
  <label>Weeks <select id="weeks"><option>4</option><option>8</option><option selected>12</option><option>26</option><option>52</option></select></label>
  <label>Show <select id="unit"><option value="hours">hours</option><option value="percent">% of capacity</option></select></label>
  <label>Scope <select id="scope"></select></label>
  <span class="projects"><button id="projectsButton" title="Choose projects">Projects: all</button><div id="projectsMenu" class="menu" hidden></div></span>
  <button id="refresh" title="Reload the tasks">Refresh</button>
  <span id="status"></span>
</div>
<div id="grid" class="grid" role="table" aria-label="Workload by person and week"></div>
<div id="details" class="details" hidden></div>
<div class="legend">
  <span class="key free">under 80%</span>
  <span class="key busy">80 to 100%</span>
  <span class="key over">over capacity</span>
  <span class="key away">away</span>
  <span>Click a person to see their tasks; click a cell for that week; double-click a task to open it.</span>
</div>
<script nonce="${nonce}" src="${media('teamView.js')}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this.panel?.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

export function registerTeamView(context: vscode.ExtensionContext): void {
    const view = new TeamView(context.extensionUri);
    context.subscriptions.push(
        view,
        vscode.commands.registerCommand('scimax.team.view', () => view.open()),
    );
}
