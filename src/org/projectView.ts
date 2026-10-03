/**
 * Project view: a webview with the project's tasks on a graphical Gantt chart.
 *
 * Tasks come from every org file under the project root (see projectData.ts),
 * and the rows are built by projectGantt.ts, which the Excel and PDF exports
 * share, so an export matches the screen.
 *
 * Interaction: double-click a task to jump to it; drag a bar to move the task
 * (or its right end to move the deadline); right-click for VS Code's own
 * context menu (webview/context in package.json), whose commands run the
 * ordinary editing commands on the task's heading and come back here. The view
 * reloads when an org file in the project is saved.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { currentProjectRoot, loadProjectTasks, type ProjectTaskInfo } from './projectData';
import {
    buildGanttModel,
    ganttToPdf,
    isoDay,
    ganttToXlsx,
    type GanttGroupBy,
    type GanttOptions,
} from './projectGantt';
import { runOnSourceHeading } from './agendaDocumentProvider';
import { addDependencyBetween, removeDependencies } from './dependencyCommands';
import { addPlanningDate, planningLines, shiftPlanningLine } from '../parser/planningShift';
import { chooseAndShiftDependents } from './shiftDependents';

/** What VS Code passes to a webview/context command: the row's data-vscode-context. */
interface TaskContext {
    filePath?: string;
    line?: number;
}

/** Options the webview controls; sent back on every change. */
interface ViewOptions {
    assignee?: string;
    tags?: string[];
    showDone: boolean;
    groupBy: GanttGroupBy;
}

type FromWebview =
    | { type: 'ready' }
    | { type: 'refresh' }
    | { type: 'options'; options: ViewOptions }
    | { type: 'open'; filePath: string; line: number }
    | { type: 'export'; format: 'xlsx' | 'pdf' }
    | { type: 'move'; filePath: string; line: number; days: number; edge: 'move' | 'end'; start: string };

class ProjectView implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private root: string | undefined;
    private tasks: ProjectTaskInfo[] = [];
    private options: ViewOptions = { showDone: false, groupBy: 'none' };
    private reloadTimer: NodeJS.Timeout | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly extensionUri: vscode.Uri) {
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (this.panel && this.root && doc.fileName.endsWith('.org') && isInside(doc.fileName, this.root)) {
                    this.scheduleReload();
                }
            })
        );
    }

    /** Show the view for a project (default: the active file's). */
    async open(root = currentProjectRoot()): Promise<void> {
        if (!root) {
            vscode.window.showInformationMessage(
                'No project found: open a file inside a project (a folder with .git, .projectile, ...) first.'
            );
            return;
        }
        this.root = root;
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel('scimax.projectView', '', vscode.ViewColumn.Active, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'projectView')],
            });
            this.panel.iconPath = new vscode.ThemeIcon('project');
            this.panel.webview.html = this.html(this.panel.webview);
            this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m), undefined, this.disposables);
            this.panel.onDidDispose(() => { this.panel = undefined; }, undefined, this.disposables);
        }
        this.panel.title = `Project: ${path.basename(root)}`;
        await this.reload();
    }

    /** Re-read the project's files and redraw. */
    async reload(): Promise<void> {
        if (!this.panel || !this.root) return;
        this.tasks = await loadProjectTasks(this.root);
        this.post();
    }

    private scheduleReload(): void {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => void this.reload(), 300);
    }

    private ganttOptions(): GanttOptions {
        return { ...this.options, root: this.root };
    }

    private post(): void {
        if (!this.panel || !this.root) return;
        const model = buildGanttModel(this.tasks, this.ganttOptions());
        void this.panel.webview.postMessage({
            type: 'model',
            model,
            options: this.options,
            project: path.basename(this.root),
            taskCount: this.tasks.length,
        });
    }

    private async onMessage(message: FromWebview): Promise<void> {
        switch (message.type) {
            case 'ready':
            case 'refresh':
                await this.reload();
                break;
            case 'options':
                this.options = message.options;
                this.post();
                break;
            case 'open':
                await revealTask(message.filePath, message.line);
                break;
            case 'export':
                await this.export(message.format);
                break;
            case 'move':
                await this.moveTask(message.filePath, message.line, message.days, message.edge, message.start);
                break;
        }
    }

    /** Run an editing command on a task's heading, then come back and reload. */
    async runOnTask(arg: TaskContext | undefined, command: string): Promise<void> {
        if (!arg?.filePath || !arg.line) return;
        const changed = await runOnSourceHeading(
            { file: arg.filePath, line: arg.line },
            command,
            () => this.panel?.reveal()
        );
        if (changed) await this.reload();
    }

    /**
     * A bar was dragged `days` days. `move` moves the whole task: its
     * SCHEDULED and DEADLINE dates, or, for a task with neither, a new
     * SCHEDULED on `start` (the bar's new first day). `end` moves only the
     * DEADLINE. Then offers to move the tasks that wait on it by the same days.
     */
    async moveTask(filePath: string, line: number, days: number, edge: 'move' | 'end', start: string): Promise<void> {
        const task = this.tasks.find(t => t.file === filePath && t.line === line);
        if (!task || days === 0 || !this.root) {
            await this.reload();
            return;
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const lines = doc.getText().split(/\r?\n/);
        const heading = lines[line - 1] ?? '';
        if (!/^\*+\s/.test(heading) || !heading.includes(task.title)) {
            vscode.window.showWarningMessage('The project view is out of date: refresh it and try again.');
            await this.reload();
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        const dated = planningLines(lines, line - 1);
        if (edge === 'end' && !task.deadline) {
            await this.reload();
            return;
        }
        if (dated.length) {
            for (const i of dated) {
                const shifted = shiftPlanningLine(lines[i], days, edge === 'end' ? 'DEADLINE' : undefined);
                if (shifted !== lines[i]) edit.replace(doc.uri, doc.lineAt(i).range, shifted);
            }
        } else {
            const [y, m, d] = start.split('-').map(Number);
            const add = addPlanningDate(lines, line - 1, 'SCHEDULED', new Date(y, m - 1, d));
            if (add.insert) edit.insert(doc.uri, new vscode.Position(add.line, 0), add.text + '\n');
            else edit.replace(doc.uri, doc.lineAt(add.line).range, add.text);
        }
        if (!(await vscode.workspace.applyEdit(edit))) {
            vscode.window.showErrorMessage(`Could not move "${task.title}".`);
            await this.reload();
            return;
        }
        await doc.save();

        // Read the project again: adding a SCHEDULED line moves the lines below it.
        this.tasks = await loadProjectTasks(this.root);
        this.post();
        const moved = this.tasks.find(t => t.file === filePath && t.line === line);
        if (moved) {
            const subject = edge === 'end' ? `The deadline of "${task.title}"` : `"${task.title}"`;
            const shifted = await chooseAndShiftDependents(this.root, moved, this.tasks, days, subject);
            if (shifted) await this.reload();
        }
    }

    /**
     * Pick another project task that this one waits on, add it to the task's
     * :DEPENDS:, and redraw. Tasks that already depend on this one, directly
     * or through others, are left out so no cycle can be made.
     */
    async addDependency(arg: TaskContext | undefined): Promise<void> {
        if (!arg?.filePath || !arg.line) return;
        const task = this.tasks.find(t => t.file === arg.filePath && t.line === arg.line);
        if (!task) {
            vscode.window.showWarningMessage('The project view is out of date: refresh it and try again.');
            return;
        }

        const byId = new Map(this.tasks.filter(t => t.id).map(t => [t.id!, t]));
        const waitsOnTask = (t: ProjectTaskInfo, seen = new Set<string>()): boolean =>
            t.dependsIds.some(id => {
                if (id === task.id) return true;
                if (seen.has(id)) return false;
                seen.add(id);
                const next = byId.get(id);
                return next ? waitsOnTask(next, seen) : false;
            });

        interface Item extends vscode.QuickPickItem { target: ProjectTaskInfo }
        const items: Item[] = this.tasks
            .filter(t => t !== task && !(t.id && task.dependsIds.includes(t.id)) && !(task.id && waitsOnTask(t)))
            .sort((a, b) => Number(a.isDone) - Number(b.isDone))
            .map(t => ({
                label: [t.todo, t.title].filter(Boolean).join(' '),
                description: [
                    t.scheduled ? `scheduled ${isoDay(t.scheduled)}` : '',
                    t.deadline ? `deadline ${isoDay(t.deadline)}` : '',
                ].filter(Boolean).join(', '),
                detail: `${path.relative(this.root ?? '', t.file)}:${t.line}`,
                target: t,
            }));
        if (items.length === 0) {
            vscode.window.showInformationMessage(`No other task in the project can be a dependency of "${task.title}".`);
            return;
        }

        const picked = await vscode.window.showQuickPick(items, {
            title: `"${task.title}" depends on...`,
            placeHolder: 'A task that must be done first',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked) return;

        const added = await addDependencyBetween(
            { file: task.file, line: task.line },
            { file: picked.target.file, line: picked.target.line }
        );
        await this.reload();
        if (added) {
            vscode.window.showInformationMessage(`"${task.title}" now depends on "${picked.target.title}".`);
        }
    }

    /** Pick some of a task's dependencies, take them out of :DEPENDS:, and redraw. */
    async removeDependency(arg: TaskContext | undefined): Promise<void> {
        if (!arg?.filePath || !arg.line) return;
        const task = this.tasks.find(t => t.file === arg.filePath && t.line === arg.line);
        if (!task) {
            vscode.window.showWarningMessage('The project view is out of date: refresh it and try again.');
            return;
        }
        if (task.dependsIds.length === 0) {
            vscode.window.showInformationMessage(`"${task.title}" has no dependencies.`);
            return;
        }

        interface Item extends vscode.QuickPickItem { id: string }
        const items: Item[] = task.dependsIds.map(id => {
            const t = this.tasks.find(x => x.id === id);
            return t
                ? {
                    label: [t.todo, t.title].filter(Boolean).join(' '),
                    detail: `${path.relative(this.root ?? '', t.file)}:${t.line}`,
                    id,
                }
                : { label: `id:${id}`, description: 'not found in this project', id };
        });

        // One dependency: no need to choose.
        const picked = items.length === 1
            ? await vscode.window.showQuickPick(items, { title: `Remove "${task.title}"'s dependency on...` })
                .then(i => (i ? [i] : undefined))
            : await vscode.window.showQuickPick(items, {
                title: `Remove "${task.title}"'s dependencies on...`,
                placeHolder: 'Check the dependencies to remove',
                canPickMany: true,
                matchOnDetail: true,
            });
        if (!picked?.length) return;

        const removed = await removeDependencies({ file: task.file, line: task.line }, picked.map(i => i.id));
        await this.reload();
        if (removed) {
            const names = picked.map(i => `"${i.label}"`).join(', ');
            vscode.window.showInformationMessage(`"${task.title}" no longer depends on ${names}.`);
        }
    }

    async export(format: 'xlsx' | 'pdf'): Promise<void> {
        // With the view open, export what it shows; otherwise the active file's project.
        const root = this.panel ? this.root : currentProjectRoot();
        if (!root) {
            vscode.window.showInformationMessage(
                'No project found: open a file inside a project (a folder with .git, .projectile, ...) first.'
            );
            return;
        }
        const tasks = this.panel && this.tasks.length ? this.tasks : await loadProjectTasks(root);
        const name = path.basename(root);
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(root, `${name}-gantt.${format}`)),
            filters: format === 'xlsx' ? { 'Excel workbook': ['xlsx'] } : { PDF: ['pdf'] },
            title: `Export ${name} Gantt chart`,
        });
        if (!target) return;

        const model = buildGanttModel(tasks, { ...this.options, root });
        const data = format === 'xlsx' ? await ganttToXlsx(model, name) : ganttToPdf(model, name);
        await fs.promises.writeFile(target.fsPath, data);
        const choice = await vscode.window.showInformationMessage(
            `Exported ${path.basename(target.fsPath)}`, 'Open'
        );
        if (choice === 'Open') await vscode.env.openExternal(target);
    }

    private html(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const media = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'projectView', file));
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');
        const bodyContext = JSON.stringify({ webviewSection: 'chart', preventDefaultContextMenuItems: true });
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('projectView.css')}">
</head>
<body data-vscode-context='${bodyContext}'>
<div class="toolbar">
  <strong id="project"></strong>
  <span id="count" class="muted"></span>
  <label>Assignee <select id="assignee"></select></label>
  <div class="tagFilter">
    <button id="tagsButton" aria-haspopup="true" aria-expanded="false" title="Show only tasks with any of the chosen tags">Tags: any</button>
    <div id="tagsMenu" class="tagsMenu" role="menu" hidden></div>
  </div>
  <label>Group <select id="groupBy">
    <option value="none">None</option>
    <option value="assignee">Assignee</option>
    <option value="file">File</option>
    <option value="parent">Parent heading</option>
  </select></label>
  <label><input type="checkbox" id="showDone"> Done tasks</label>
  <span class="spacer"></span>
  <button id="zoomOut" title="Narrower days">&minus;</button>
  <button id="zoomIn" title="Wider days">+</button>
  <button id="today" title="Scroll to today">Today</button>
  <button id="refresh" title="Re-read the project's files">Refresh</button>
  <button id="exportXlsx" title="Save the chart as an Excel workbook">Excel</button>
  <button id="exportPdf" title="Save the chart as a PDF">PDF</button>
</div>
<div class="legend">
  <span class="swatch done"></span>done
  <span class="swatch blocked"></span>blocked
  <span class="swatch active"></span>in progress
  <span class="swatch planned"></span>planned
  <span class="swatch milestone"></span>milestone
  <span class="muted">Double-click a task to open it; right-click for more.</span>
</div>
<div id="chart" class="chart" tabindex="0"></div>
<div id="empty" class="empty" hidden></div>
<script nonce="${nonce}" src="${media('projectView.js')}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.panel?.dispose();
        for (const d of this.disposables) d.dispose();
    }
}

function isInside(file: string, root: string): boolean {
    const rel = path.relative(root, file);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function revealTask(filePath: string, line: number): Promise<void> {
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const pos = new vscode.Position(Math.max(0, line - 1), 0);
        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            selection: new vscode.Range(pos, pos),
        });
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch {
        vscode.window.showErrorMessage(`Could not open ${filePath}`);
    }
}

export function registerProjectView(context: vscode.ExtensionContext): void {
    const view = new ProjectView(context.extensionUri);

    const priority = async (arg?: TaskContext) => {
        const picked = await vscode.window.showQuickPick(
            [
                { label: 'A', command: 'scimax.speed.priorityA' },
                { label: 'B', command: 'scimax.speed.priorityB' },
                { label: 'C', command: 'scimax.speed.priorityC' },
                { label: 'None', command: 'scimax.speed.priorityNone' },
            ],
            { placeHolder: 'Priority' }
        );
        if (picked) await view.runOnTask(arg, picked.command);
    };

    context.subscriptions.push(
        view,
        vscode.commands.registerCommand('scimax.project.view', () => view.open()),
        vscode.commands.registerCommand('scimax.project.exportExcel', () => view.export('xlsx')),
        vscode.commands.registerCommand('scimax.project.exportPdf', () => view.export('pdf')),
        vscode.commands.registerCommand('scimax.project.refresh', () => view.reload()),
        // Task context menu (webview/context).
        vscode.commands.registerCommand('scimax.project.task.open', (arg?: TaskContext) =>
            arg?.filePath && arg.line ? revealTask(arg.filePath, arg.line) : undefined),
        vscode.commands.registerCommand('scimax.project.task.cycleTodo', (arg?: TaskContext) =>
            view.runOnTask(arg, 'scimax.org.cycleTodo')),
        vscode.commands.registerCommand('scimax.project.task.assign', (arg?: TaskContext) =>
            view.runOnTask(arg, 'scimax.org.assignTask')),
        vscode.commands.registerCommand('scimax.project.task.priority', priority),
        vscode.commands.registerCommand('scimax.project.task.addDependency', (arg?: TaskContext) =>
            view.addDependency(arg)),
        vscode.commands.registerCommand('scimax.project.task.removeDependency', (arg?: TaskContext) =>
            view.removeDependency(arg)),
        vscode.commands.registerCommand('scimax.project.task.effort', (arg?: TaskContext) =>
            view.runOnTask(arg, 'scimax.speed.setEffort')),
        vscode.commands.registerCommand('scimax.project.task.schedule', (arg?: TaskContext) =>
            view.runOnTask(arg, 'scimax.speed.schedule')),
        vscode.commands.registerCommand('scimax.project.task.deadline', (arg?: TaskContext) =>
            view.runOnTask(arg, 'scimax.speed.deadline')),
    );
}
