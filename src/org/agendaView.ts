/**
 * Agenda view: the agenda in a webview, in the manner of the project view's
 * Gantt chart. An alternative to the agenda buffer, not a replacement.
 *
 * The extension picks the rows: a span of days (paged with an offset), the
 * TODO list, or a custom agenda from scimax.agenda.customCommands, limited to
 * one project (a projectile project, as C-c p p lists them) or not. The
 * webview filters those rows by tags, files, TODO state, priority, assignee,
 * properties and text, so its menus can show every value there is
 * (agendaViewModel.ts).
 *
 * Hovering a row (or Space) shows a tooltip with the heading's context from
 * its file. Clicking a row or pressing Enter opens the heading; right-click
 * gives VS Code's own context menu (webview/context in package.json), whose
 * task actions are shared with the project view (taskActions.ts). The view
 * reloads when the agenda refreshes and when an org file is saved.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
// Per-function imports: the package index loads all of date-fns.
import addDays from 'date-fns/addDays';
import format from 'date-fns/format';
import startOfDay from 'date-fns/startOfDay';
import type { AgendaManager } from './agendaProvider';
import type { ProjectileManager } from '../projectile/projectileManager';
import { loadProjectTasks } from './projectData';
import { readSourceLines } from './agendaDocumentProvider';
import { entrySnippet, outlinePath } from './agendaHover';
import { registerTaskHost, revealTask, runOnTask, type TaskContext } from './taskActions';
import {
    groupByState,
    limitToRoot,
    rowFromItem,
    rowFromTask,
    rowGroups,
    type AgendaRow,
    type AgendaSection,
} from './agendaViewModel';

/** The webview's viewType: webviewId in package.json when-clauses, and the rows' `view`. */
const AGENDA_VIEW_TYPE = 'scimax.agendaView';

type Span = 'day' | 'week' | 'fortnight' | 'month' | 'todo';

const SPAN_DAYS: Record<Exclude<Span, 'todo'>, number> = { day: 1, week: 7, fortnight: 14, month: 30 };

/** Options the webview controls; sent back on every change and kept per workspace. */
interface ViewOptions {
    span: Span;
    /** A custom agenda command's key; it replaces the span */
    custom?: string;
    /** Spans paged forward (+) or back (-) from today */
    offset: number;
    /** Project root the rows are limited to */
    project?: string;
    // Filters the webview applies; kept here so they outlast the view.
    includeTags?: string[];
    excludeTags?: string[];
    hiddenFiles?: string[];
    hiddenStates?: string[];
    hiddenPriorities?: string[];
    /** Show items assigned to any of these ('' = unassigned) */
    assignees?: string[];
    /** Show items whose property KEY has one of the values ('' = not set) */
    properties?: Record<string, string[]>;
    search?: string;
}

type FromWebview =
    | { type: 'ready' }
    | { type: 'refresh' }
    | { type: 'options'; options: ViewOptions }
    | { type: 'open'; filePath: string; line: number }
    | { type: 'cycleTodo'; filePath: string; line: number }
    | { type: 'preview'; id: number; filePath: string; line: number }
    | { type: 'close' };

/** Lines of an entry's body in its tooltip, after the heading. */
const PREVIEW_BODY_LINES = 10;

const OPTIONS_KEY = 'scimax.agendaView.options';

class AgendaWebview implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private options: ViewOptions;
    private reloadTimer: NodeJS.Timeout | undefined;
    /** Bumped on each load, so a slow load cannot overwrite a newer one. */
    private generation = 0;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly state: vscode.Memento,
        private readonly manager: AgendaManager,
        private readonly projectile: ProjectileManager | undefined
    ) {
        this.options = { span: 'week', ...state.get<Partial<ViewOptions>>(OPTIONS_KEY), offset: 0 };
        this.disposables.push(
            manager.onDidRefresh(() => this.scheduleReload()),
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (this.panel && doc.fileName.endsWith('.org')) this.scheduleReload();
            }),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('scimax.agenda')) this.scheduleReload();
            })
        );
    }

    async open(): Promise<void> {
        if (this.panel) {
            this.panel.reveal();
            return;
        }
        // Paging is for the session: a reopened view starts at today.
        this.options = { ...this.options, offset: 0 };
        this.panel = vscode.window.createWebviewPanel('scimax.agendaView', 'Agenda', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'agendaView')],
        });
        this.panel.iconPath = new vscode.ThemeIcon('calendar');
        this.panel.webview.html = this.html(this.panel.webview);
        this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m), undefined, this.disposables);
        this.panel.onDidDispose(() => { this.panel = undefined; }, undefined, this.disposables);
    }

    reveal(): void {
        this.panel?.reveal();
    }

    /** Re-read the agenda and redraw. */
    async reload(): Promise<void> {
        if (!this.panel) return;
        const generation = ++this.generation;
        const loaded = await this.load();
        if (!this.panel || generation !== this.generation) return;
        this.panel.title = loaded.title;
        void this.panel.webview.postMessage({
            type: 'model',
            ...loaded,
            options: this.options,
            projects: this.projects(),
            customs: this.manager.getCustomCommands()
                .filter(c => !c.isPrefix && c.errors.length === 0)
                .map(c => ({ key: c.key, description: c.description || c.key })),
        });
    }

    private scheduleReload(): void {
        if (!this.panel) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => void this.reload(), 300);
    }

    /** Projectile's projects, most recently opened first, plus the chosen one if it is not among them. */
    private projects(): Array<{ name: string; path: string }> {
        const list = (this.projectile?.getProjects() ?? []).map(p => ({ name: p.name, path: p.path }));
        const chosen = this.options.project;
        if (chosen && !list.some(p => p.path === chosen)) list.unshift({ name: path.basename(chosen), path: chosen });
        return list;
    }

    private async load(): Promise<{ title: string; range: string; paged: boolean; sections: AgendaSection[]; error?: string }> {
        const { span, custom, offset, project } = this.options;
        const where = project ? ` (${path.basename(project)})` : '';

        if (custom !== undefined) {
            const outcome = await this.manager.runCustomCommand(custom, { offset });
            if ('error' in outcome) {
                return { title: `Agenda: ${custom}`, range: '', paged: false, sections: [], error: outcome.error };
            }
            const { command, blocks } = outcome.result;
            await this.manager.resolveAssignees(blocks.flatMap(b => b.groups.flatMap(g => g.items)));
            let sections: AgendaSection[] = blocks.map(b => ({ header: b.header, groups: rowGroups(b.groups) }));
            // Custom agendas read the database; the project limits what they found.
            if (project) sections = limitToRoot(sections, project, true);
            const dated = blocks.find(b => b.dateRange);
            return {
                title: `Agenda: ${command.description || command.key}${where}`,
                range: dated?.dateRange ? rangeText(dated.dateRange.start, dated.dateRange.end) : '',
                paged: !!dated,
                sections,
            };
        }

        if (span === 'todo') {
            const rows = project
                // The database only knows its scan roots; read the project's own files.
                ? (await loadProjectTasks(project)).filter(t => !t.isDone).map(rowFromTask)
                : await this.todoRows();
            return { title: `TODO List${where}`, range: '', paged: false, sections: [{ groups: groupByState(rows) }] };
        }

        const days = SPAN_DAYS[span];
        const startDate = addDays(startOfDay(new Date()), offset * days);
        const view = await this.manager.getAgendaView({
            type: span,
            days,
            startDate,
            directories: project ? [project] : undefined,
        });
        await this.manager.resolveAssignees(view.groups.flatMap(g => g.items));
        return {
            title: `Agenda${where}`,
            range: rangeText(view.dateRange.start, view.dateRange.end),
            paged: true,
            sections: [{ groups: rowGroups(view.groups) }],
        };
    }

    /** Every open TODO from the database, with assignees. */
    private async todoRows(): Promise<AgendaRow[]> {
        const items = [...(await this.manager.getTodoList()).byState.values()].flat();
        await this.manager.resolveAssignees(items);
        return items.map(rowFromItem);
    }

    private async onMessage(message: FromWebview): Promise<void> {
        switch (message.type) {
            case 'ready':
            case 'refresh':
                await this.reload();
                break;
            case 'options': {
                const before = this.options;
                this.options = message.options;
                void this.state.update(OPTIONS_KEY, { ...message.options, offset: 0 });
                // The webview filters on its own; only these change the rows.
                if (before.span !== message.options.span || before.custom !== message.options.custom
                    || before.offset !== message.options.offset || before.project !== message.options.project) {
                    await this.reload();
                }
                break;
            }
            case 'open':
                await revealTask(message.filePath, message.line);
                break;
            case 'cycleTodo':
                await runOnTask(
                    { view: AGENDA_VIEW_TYPE, filePath: message.filePath, line: message.line },
                    'scimax.org.cycleTodo'
                );
                break;
            case 'preview':
                await this.preview(message.id, message.filePath, message.line);
                break;
            case 'close':
                this.panel?.dispose();
                break;
        }
    }

    /**
     * Send the context of a row's heading for its tooltip: the headings above
     * it and the start of its entry, read as the agenda buffer's hover does.
     */
    private async preview(id: number, filePath: string, line: number): Promise<void> {
        const lines = await readSourceLines(filePath);
        const snippet = lines ? entrySnippet(lines, line, PREVIEW_BODY_LINES) : undefined;
        void this.panel?.webview.postMessage({
            type: 'preview',
            id,
            outline: lines && snippet ? outlinePath(lines, line) : [],
            lines: snippet?.map(l => l.text) ?? [],
            location: `${vscode.workspace.asRelativePath(filePath)}:${line}`,
        });
    }

    private html(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const media = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'agendaView', file));
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');
        const bodyContext = JSON.stringify({ webviewSection: 'agenda', preventDefaultContextMenuItems: true });
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('agendaView.css')}">
</head>
<body data-vscode-context='${bodyContext}'>
<div class="toolbar">
  <span class="spans" role="group" aria-label="Span">
    <button data-span="day" title="Today (d)">Day</button>
    <button data-span="week" title="Seven days from today (w)">Week</button>
    <button data-span="fortnight" title="Fourteen days from today">Fortnight</button>
    <button data-span="month" title="Thirty days (m)">Month</button>
    <button data-span="todo" title="Every open TODO">TODO</button>
  </span>
  <label>Custom <select id="custom"></select></label>
  <span class="paging">
    <button id="prev" title="Earlier (b)">&lsaquo;</button>
    <button id="today" title="Back to today (.)">Today</button>
    <button id="next" title="Later (f)">&rsaquo;</button>
  </span>
  <label>Project <select id="project"></select></label>
  <div class="menuFilter">
    <button id="tagsButton" aria-haspopup="true" aria-expanded="false" title="Click a tag to require it, again to exclude it, again to clear it">Tags: any</button>
    <div id="tagsMenu" class="menu" role="menu" hidden></div>
  </div>
  <div class="menuFilter">
    <button id="filesButton" aria-haspopup="true" aria-expanded="false" title="Choose which files' items are shown">Files: all</button>
    <div id="filesMenu" class="menu" role="menu" hidden></div>
  </div>
  <div class="menuFilter">
    <button id="statesButton" aria-haspopup="true" aria-expanded="false" title="Choose which TODO states are shown">States: all</button>
    <div id="statesMenu" class="menu" role="menu" hidden></div>
  </div>
  <div class="menuFilter">
    <button id="prioritiesButton" aria-haspopup="true" aria-expanded="false" title="Choose which priorities are shown">Priority: all</button>
    <div id="prioritiesMenu" class="menu" role="menu" hidden></div>
  </div>
  <div class="menuFilter">
    <button id="assigneesButton" aria-haspopup="true" aria-expanded="false" title="Show only items assigned to the checked people (:ASSIGNEE: or @tags, own or inherited)">Assignee: anyone</button>
    <div id="assigneesMenu" class="menu" role="menu" hidden></div>
  </div>
  <div class="menuFilter">
    <button id="propertiesButton" aria-haspopup="true" aria-expanded="false" title="Show only items whose properties have the checked values">Properties: any</button>
    <div id="propertiesMenu" class="menu wide" role="menu" hidden></div>
  </div>
  <input id="search" type="search" placeholder="Filter (/)" aria-label="Filter by text">
  <span class="spacer"></span>
  <button id="clearFilters" title="Clear every filter">Clear filters</button>
  <button id="refresh" title="Re-read the agenda (g)">Refresh</button>
</div>
<div class="status">
  <strong id="title"></strong>
  <span id="range" class="muted"></span>
  <span id="count" class="muted"></span>
  <span class="spacer"></span>
  <span class="muted">Double-click or Enter opens an item; hover (or Space) shows its context; right-click for more. n/p move, f/b page, t cycles TODO, q closes.</span>
</div>
<div id="list" class="list" tabindex="0" role="listbox" aria-label="Agenda items"></div>
<div id="preview" class="preview" role="tooltip" hidden></div>
<script nonce="${nonce}" src="${media('agendaView.js')}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.panel?.dispose();
        for (const d of this.disposables) d.dispose();
    }
}

function rangeText(start: Date, end: Date): string {
    // dateRange.end is the day after the last one shown.
    const last = addDays(end, -1);
    if (last <= start) return format(start, 'EEEE, MMMM d, yyyy');
    return `${format(start, 'MMM d')} to ${format(last, 'MMM d, yyyy')}`;
}

export function registerAgendaView(
    context: vscode.ExtensionContext,
    manager: AgendaManager,
    projectile: ProjectileManager | undefined
): void {
    const view = new AgendaWebview(context.extensionUri, context.workspaceState, manager, projectile);
    context.subscriptions.push(
        view,
        registerTaskHost(AGENDA_VIEW_TYPE, view),
        vscode.commands.registerCommand('scimax.agenda.view', () => view.open()),
        vscode.commands.registerCommand('scimax.agendaView.refresh', () => view.reload()),
        vscode.commands.registerCommand('scimax.agendaView.ignoreFile', async (arg?: TaskContext) => {
            if (!arg?.filePath) return;
            // excludeFile fires onDidRefresh, which reloads the view.
            await manager.excludeFile(arg.filePath);
            vscode.window.showInformationMessage(`Added to agenda exclude list: ${path.basename(arg.filePath)}`);
        }),
    );
}
