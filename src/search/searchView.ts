/**
 * Search view: a webview for searching the database as you type, in the
 * manner of the agenda view.
 *
 * The webview sends the query, the modes that are checked (full text,
 * semantic, headings) and the filters (tags, properties, paths) on every
 * change; the extension searches the database and sends back results
 * grouped by file, with the lines that matched and the headings above them
 * (searchModel.ts). Full-text and heading results go out first; semantic
 * results, which wait on the embedding service, follow in a second message.
 * A newer search makes an older one's results be dropped.
 *
 * The view re-runs its search when an org or Markdown file is saved, so it
 * stays in step with the database.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { getDatabase } from '../database/lazyDb';
import { onPathsChanged } from '../shared/pathChanges';
import type { ScimaxDb } from '../database/scimaxDb';
import type { HeadingRecord } from '../database/scimaxDbCore';
import { readSourceLines } from '../org/agendaDocumentProvider';
import {
    chunkLines,
    emptyFilters,
    FileOutline,
    filesInOrder,
    hasFilters,
    headingPasses,
    headingTags,
    marksIn,
    matchingLines,
    MAX_HITS_PER_FILE,
    parsePathPatterns,
    parsePropertyFilters,
    parseSnippet,
    pathPasses,
    queryTerms,
    ResultBuilder,
    termRegex,
    DEFAULT_DONE_STATES,
    type FileResult,
    type SearchFilters,
    type SearchMode,
    type SortOrder,
} from './searchModel';

const VIEW_TYPE = 'scimax.searchView';
const OPTIONS_KEY = 'scimax.searchView.options';

/** What the webview controls; kept per workspace so the view reopens as it was. */
interface ViewOptions {
    query: string;
    modes: SearchMode[];
    includeTags: string[];
    excludeTags: string[];
    /** TODO states, or '@open' / '@done' */
    includeTodo: string[];
    excludeTodo: string[];
    /** `KEY=value, KEY` as typed */
    properties: string;
    /** Path patterns as typed */
    paths: string;
    sort: SortOrder;
}

const DEFAULT_OPTIONS: ViewOptions = {
    query: '',
    modes: ['fulltext', 'headings'],
    includeTags: [],
    excludeTags: [],
    includeTodo: [],
    excludeTodo: [],
    properties: '',
    paths: '',
    sort: 'recent',
};

type FromWebview =
    | { type: 'ready' }
    | { type: 'search'; id: number; options: ViewOptions; limit: number }
    | { type: 'open'; filePath: string; line: number; column?: number; length?: number }
    | { type: 'database' }
    | { type: 'close' };

/** A file's lines and headings, read once per search. */
interface FileData {
    lines: string[] | undefined;
    outline: FileOutline;
}

export class SearchWebview implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private options: ViewOptions;
    /** The newest search's id; older searches stop when they see it changed */
    private latest = 0;
    private lastRequest: { id: number; options: ViewOptions; limit: number } | undefined;
    private rerunTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly state: vscode.Memento,
    ) {
        this.options = { ...DEFAULT_OPTIONS, ...state.get<Partial<ViewOptions>>(OPTIONS_KEY, {}) };
        this.disposables.push(vscode.workspace.onDidSaveTextDocument(doc => {
            if (/\.(org|md|markdown|qmd)$/i.test(doc.fileName)) this.scheduleRerun();
        }));
        // A rename or delete (dired, F12 f, the Explorer) leaves results pointing at old paths.
        this.disposables.push(
            onPathsChanged(() => this.scheduleRerun()),
            vscode.workspace.onDidRenameFiles(() => this.scheduleRerun()),
            vscode.workspace.onDidDeleteFiles(() => this.scheduleRerun()),
        );
    }

    /** Open the view, or bring it forward; `query` replaces the query. */
    open(query?: string): void {
        if (query !== undefined) this.options = { ...this.options, query };
        if (this.panel) {
            this.panel.reveal();
            if (query !== undefined) void this.panel.webview.postMessage({ type: 'setQuery', query });
            return;
        }
        this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Search', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'searchView')],
        });
        this.panel.iconPath = new vscode.ThemeIcon('search');
        this.panel.webview.html = this.html(this.panel.webview);
        this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m), undefined, this.disposables);
        this.panel.onDidDispose(() => { this.panel = undefined; }, undefined, this.disposables);
    }

    private scheduleRerun(): void {
        if (!this.panel || !this.lastRequest) return;
        if (this.rerunTimer) clearTimeout(this.rerunTimer);
        // Give the save handler time to re-index the file first.
        this.rerunTimer = setTimeout(() => {
            // Same id: the webview takes results only for its newest request.
            if (this.lastRequest && this.lastRequest.id === this.latest) void this.search(this.lastRequest, true);
        }, 1500);
    }

    private async onMessage(message: FromWebview): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this.sendSetup();
                break;
            case 'search':
                this.options = message.options;
                void this.state.update(OPTIONS_KEY, message.options);
                this.latest = Math.max(this.latest, message.id);
                await this.search(message, false);
                break;
            case 'open':
                await openAt(message.filePath, message.line, message.column, message.length);
                break;
            case 'database':
                await vscode.commands.executeCommand('scimax.db.view');
                break;
            case 'close':
                this.panel?.dispose();
                break;
        }
    }

    /** The saved options, what the database can do, and the tags and property names for the filters. */
    private async sendSetup(): Promise<void> {
        const db = await getDatabase();
        const [tags, propertyNames, todoCounts] = db
            ? await Promise.all([
                db.getAllTags().catch(() => []),
                db.getAllPropertyNames().catch(() => []),
                db.getTodoStateCounts().catch(() => []),
            ])
            : [[], [], []];
        const doneStates = configuredDoneStates();
        const todoStates = todoCounts
            .map(t => ({ ...t, done: t.done || doneStates.includes(t.state) }))
            // Open states first, each group by how often it is used
            .sort((a, b) => Number(a.done) - Number(b.done) || b.count - a.count);
        void this.panel?.webview.postMessage({
            type: 'setup',
            options: this.options,
            semantic: semanticStatus(db),
            tags,
            propertyNames,
            todoStates,
            dbMissing: !db,
        });
    }

    private async search(request: { id: number; options: ViewOptions; limit: number }, quiet: boolean): Promise<void> {
        this.lastRequest = request;
        const { id, options } = request;
        const post = (msg: Record<string, unknown>) => {
            if (id === this.latest) void this.panel?.webview.postMessage({ ...msg, id, quiet });
        };
        const started = Date.now();
        const db = await getDatabase();
        if (!db) {
            post({ type: 'results', files: [], pending: false, error: 'The database is not available.' });
            return;
        }
        const filters: SearchFilters = {
            ...emptyFilters(),
            includeTags: options.includeTags,
            excludeTags: options.excludeTags,
            includeTodo: options.includeTodo ?? [],
            excludeTodo: options.excludeTodo ?? [],
            doneStates: configuredDoneStates(),
            properties: parsePropertyFilters(options.properties),
            paths: parsePathPatterns(options.paths),
        };
        try {
            const run = new SearchRun(db, options.query.trim(), new Set(options.modes), filters, request.limit,
                options.sort ?? 'recent', () => id !== this.latest);
            const semantic = run.semanticWanted() ? run.semanticResults() : undefined;
            await run.collectFast();
            if (id !== this.latest) return;
            post({ type: 'results', ...this.payload(await run.results()), note: run.note(), pending: !!semantic, ms: Date.now() - started });
            if (semantic) {
                await run.collectSemantic(await semantic);
                if (id !== this.latest) return;
                post({ type: 'results', ...this.payload(await run.results()), note: run.note(), pending: false, ms: Date.now() - started });
            }
        } catch (error) {
            post({ type: 'results', files: [], pending: false, error: error instanceof Error ? error.message : String(error) });
        }
    }

    private payload(files: FileResult[]): { files: Array<FileResult & { relPath: string; name: string; dir: string }> } {
        return {
            files: files.map(f => {
                const relPath = vscode.workspace.asRelativePath(f.filePath, true);
                return { ...f, relPath, name: path.basename(f.filePath), dir: path.dirname(relPath) };
            }),
        };
    }

    private html(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const media = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'searchView', file));
        const csp = [`default-src 'none'`, `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('searchView.css')}">
</head>
<body>
<div class="toolbar">
  <div class="row">
    <input id="query" type="search" placeholder="Search notes: words, &quot;a phrase&quot;, prefix*, a OR b, NOT c" aria-label="Search" autofocus>
    <span class="modes" role="group" aria-label="Search modes">
      <label title="Words in file text (FTS5: phrases, prefix*, OR, NOT)"><input type="checkbox" data-mode="fulltext"> Full text</label>
      <label id="semanticLabel" title="Passages close in meaning (needs embeddings)"><input type="checkbox" data-mode="semantic"> Semantic</label>
      <label title="Words in heading titles"><input type="checkbox" data-mode="headings"> Headings</label>
    </span>
  </div>
  <div class="row">
    <div class="menuFilter">
      <button id="tagsButton" aria-haspopup="true" aria-expanded="false" title="Click a tag to require it, again to exclude it, again to clear it">Tags: any</button>
      <div id="tagsMenu" class="menu" role="menu" hidden>
        <input id="tagsSearch" type="search" placeholder="Find a tag" aria-label="Find a tag">
        <div id="tagsList" class="menuList"></div>
      </div>
    </div>
    <div class="menuFilter">
      <button id="todoButton" aria-haspopup="true" aria-expanded="false" title="Click a state to select it, again to exclude it, again to clear it. Selected states: any may match">TODO: any</button>
      <div id="todoMenu" class="menu" role="menu" hidden>
        <div id="todoList" class="menuList"></div>
      </div>
    </div>
    <input id="properties" class="filter" type="text" list="propertyNames" placeholder="Properties: KEY=value, KEY" aria-label="Property filters" title="Headings with these properties: KEY=value (value contains), or KEY (set at all); comma separated">
    <datalist id="propertyNames"></datalist>
    <input id="paths" class="filter" type="text" placeholder="Paths: text or glob, comma separated" aria-label="Path filters" title="Files whose path contains the text or matches the glob (e.g. projects, *.md, notes/**/*.org); any may match">
    <button id="clearFilters" title="Clear the tag, property and path filters">Clear filters</button>
    <button id="database" title="Database View: what is indexed, maintenance and settings (C-c d i)">Database…</button>
  </div>
</div>
<div class="status">
  <span id="count"></span>
  <span id="pending" class="muted" hidden>Searching by meaning…</span>
  <span id="note" class="muted"></span>
  <span class="spacer"></span>
  <label class="sortLabel muted">Sort
    <select id="sort" aria-label="Sort files" title="Order of the files: last modified first, best match first, or by file name">
      <option value="recent">Recently modified</option>
      <option value="relevance">Best match</option>
      <option value="name">File name</option>
    </select>
  </label>
  <span class="muted">↓ or Enter moves to the results; n/p move, Enter opens, / back to the query, q closes.</span>
</div>
<div id="list" class="list" tabindex="0" role="listbox" aria-label="Search results"></div>
<script nonce="${nonce}" src="${media('searchView.js')}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.rerunTimer) clearTimeout(this.rerunTimer);
        this.panel?.dispose();
        for (const d of this.disposables) d.dispose();
    }
}

/** The states the agenda counts as done (scimax.agenda.doneStates). */
function configuredDoneStates(): string[] {
    return vscode.workspace.getConfiguration('scimax.agenda').get<string[]>('doneStates', DEFAULT_DONE_STATES);
}

function semanticStatus(db: ScimaxDb | null): { available: boolean; reason?: string } {
    if (!db) return { available: false, reason: 'The database is not available.' };
    const status = db.getVectorSearchStatus();
    if (!status.supported) return { available: false, reason: status.error ?? 'Vector search is not supported.' };
    if (!db.isVectorSearchAvailable()) {
        return { available: false, reason: 'No embedding service: run "Scimax: Configure Embedding Service".' };
    }
    if (!status.hasEmbeddings) return { available: false, reason: 'No embeddings yet: they are made as files are indexed.' };
    return { available: true };
}

/** One search: queries the database and builds the results. */
class SearchRun {
    private readonly builder = new ResultBuilder();
    private readonly files = new Map<string, Promise<FileData>>();
    private readonly re: RegExp | null;
    private readonly filtered: boolean;
    private headingsOnly = false;

    constructor(
        private readonly db: ScimaxDb,
        private readonly query: string,
        private readonly modes: Set<SearchMode>,
        private readonly filters: SearchFilters,
        private readonly limit: number,
        private readonly sort: SortOrder,
        private readonly stale: () => boolean,
    ) {
        this.re = termRegex(queryTerms(query));
        this.filtered = hasFilters(filters);
    }

    semanticWanted(): boolean {
        return !!this.query && this.modes.has('semantic') && semanticStatus(this.db).available;
    }

    /** A line for the status bar about what was searched, when it is not obvious. */
    note(): string {
        if (this.headingsOnly) return 'No query: headings that match the filters.';
        if (!this.query) return '';
        if (!this.modes.size) return 'Check a search mode.';
        return '';
    }

    private readonly mtimes = new Map<string, number>();

    async results(): Promise<FileResult[]> {
        // Every file gets its modified time: the view shows it, and 'recent' sorts by it.
        const missing = this.builder.paths().filter(p => !this.mtimes.has(p));
        await Promise.all(missing.map(p => fs.promises.stat(p)
            .then(st => { this.mtimes.set(p, st.mtimeMs); })
            .catch(() => undefined)));
        return this.builder.results(this.sort, this.mtimes).slice(0, this.limit);
    }

    private fetchLimit(): number {
        // Filters drop files after the query, and the newest files need not be the
        // best matches: ask for more so the page holds the right ones.
        const factor = (this.filtered ? 4 : 1) * (this.sort === 'relevance' ? 1 : 3);
        return Math.min(this.limit * factor, 2000);
    }

    private fileData(filePath: string): Promise<FileData> {
        let data = this.files.get(filePath);
        if (!data) {
            data = Promise.all([readSourceLines(filePath), this.db.getHeadingsInFile(filePath)])
                .then(([lines, headings]) => ({ lines, outline: new FileOutline(headings) }));
            this.files.set(filePath, data);
        }
        return data;
    }

    private relPath(filePath: string): string | undefined {
        const rel = vscode.workspace.asRelativePath(filePath, false);
        return rel === filePath ? undefined : rel;
    }

    private pathOk(filePath: string): boolean {
        return pathPasses(filePath, this.filters.paths, this.relPath(filePath));
    }

    /** Full text and headings: both answer quickly from SQLite. */
    async collectFast(): Promise<void> {
        const tasks: Promise<void>[] = [];
        if (this.query && this.modes.has('fulltext')) tasks.push(this.collectFullText());
        if (this.modes.has('headings') || (!this.query && this.filtered)) {
            this.headingsOnly = !this.query;
            tasks.push(this.collectHeadings());
        }
        await Promise.all(tasks);
    }

    private async collectFullText(): Promise<void> {
        const found = await this.db.searchFullText(this.query, { limit: this.fetchLimit() });
        if (this.stale()) return;
        const files = found.filter(r => this.pathOk(r.file_path));
        await Promise.all(files.map(async (r, rank) => {
            const data = await this.fileData(r.file_path);
            if (!data.lines) return;
            const lines = this.re ? matchingLines(data.lines, this.re) : [];
            const passing = lines
                .map(m => ({ m, heading: data.outline.headingAt(m.line) }))
                .filter(x => headingPasses(x.heading, this.filters))
                // Lines with more of the query's words first, then document order.
                .sort((a, b) => b.m.distinct - a.m.distinct || a.m.line - b.m.line)
                .slice(0, MAX_HITS_PER_FILE);
            if (!passing.length) {
                // The words are in the file but not on one line (or the stemmer
                // matched what the line search did not): show the database's snippet.
                if (lines.length || this.filtered) return;
                const f = this.builder.rankFile(r.file_path, 'fulltext', rank);
                if (r.preview) f.snippet = parseSnippet(r.preview).text;
                return;
            }
            this.builder.rankFile(r.file_path, 'fulltext', rank);
            for (const { m, heading } of passing) {
                this.builder.addHit(r.file_path, {
                    line: m.line,
                    text: m.text,
                    marks: m.marks,
                    outline: data.outline.outline(heading),
                    kinds: ['fulltext'],
                });
            }
        }));
    }

    private async collectHeadings(): Promise<void> {
        const words = this.query.replace(/"/g, ' ').split(/\s+/)
            .filter(w => w && !/^(AND|OR|NOT|NEAR)$/.test(w))
            .map(w => w.replace(/\*$/, ''));
        const headings = await this.db.searchHeadingsFiltered({
            terms: words,
            requiredTags: this.filters.includeTags,
            excludedTags: this.filters.excludeTags,
            properties: this.filters.properties,
            todoStates: this.filters.includeTodo,
            excludedTodoStates: this.filters.excludeTodo,
            doneStates: this.filters.doneStates,
            limit: this.fetchLimit() * 5,
        });
        if (this.stale()) return;
        const byFile = new Map<string, HeadingRecord[]>();
        for (const h of headings) {
            if (!this.pathOk(h.file_path)) continue;
            const list = byFile.get(h.file_path) ?? [];
            list.push(h);
            byFile.set(h.file_path, list);
        }
        const re = this.re ?? termRegex(words.map(text => ({ text, prefix: true })));
        await Promise.all([...byFile.entries()].map(async ([filePath, list], rank) => {
            const data = await this.fileData(filePath);
            this.builder.rankFile(filePath, 'headings', rank);
            for (const h of list) {
                // The file's own line shows the stars and tags as written; the
                // index's line can be stale, so check it is still this heading.
                const line = data.lines?.[h.line_number - 1];
                const text = line !== undefined && line.includes(h.title) ? line : h.title;
                this.builder.addHit(filePath, {
                    line: h.line_number,
                    text,
                    marks: marksIn(text, re),
                    outline: data.outline.outline(data.outline.headingAt(h.line_number)),
                    kinds: ['headings'],
                    todo: h.todo_state,
                    tags: headingTags(h),
                });
            }
        }));
    }

    semanticResults() {
        return this.db.searchSemantic(this.query, { limit: Math.max(30, this.fetchLimit()) }).catch(() => []);
    }

    async collectSemantic(chunks: Awaited<ReturnType<SearchRun['semanticResults']>>): Promise<void> {
        const files = filesInOrder(chunks).filter(f => this.pathOk(f));
        const rankOf = new Map(files.map((f, i) => [f, i]));
        await Promise.all(files.map(async filePath => {
            const data = await this.fileData(filePath);
            const own = chunks.filter(c => c.file_path === filePath);
            const hits = [];
            for (const c of own) {
                const lines = data.lines;
                // The chunk's text is from when it was embedded; take its first
                // non-blank line from the file as it is now.
                let line = c.line_number;
                const preview = chunkLines(c.preview, 3);
                if (lines) {
                    while (line <= lines.length && !lines[line - 1]?.trim()) line++;
                }
                const heading = data.outline.headingAt(line);
                if (!headingPasses(heading, this.filters)) continue;
                const text = lines?.[line - 1]?.trimEnd() ?? preview[0] ?? '';
                const more = lines ? lines.slice(line, line + 2).filter(l => l.trim()) : preview.slice(1);
                hits.push({ line, text, marks: marksIn(text, this.re), more, outline: data.outline.outline(heading), kinds: ['semantic' as SearchMode] });
            }
            if (!hits.length) return;
            this.builder.rankFile(filePath, 'semantic', rankOf.get(filePath) ?? 0);
            for (const h of hits) this.builder.addHit(filePath, h);
        }));
    }
}

/** Open a file at a 1-based line beside the view, selecting the matched text when given. */
async function openAt(filePath: string, line: number, column?: number, length?: number): Promise<void> {
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const l = Math.min(Math.max(0, line - 1), doc.lineCount - 1);
        const start = new vscode.Position(l, column ?? 0);
        const end = length ? start.translate(0, length) : start;
        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            selection: new vscode.Range(start, end),
        });
        editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
    } catch {
        vscode.window.showErrorMessage(`Could not open ${filePath}`);
    }
}

export function registerSearchView(context: vscode.ExtensionContext): void {
    const view = new SearchWebview(context.extensionUri, context.workspaceState);
    context.subscriptions.push(
        view,
        vscode.commands.registerCommand('scimax.search.view', (query?: unknown) => {
            if (typeof query === 'string') return view.open(query);
            // A one-line selection in the editor becomes the query.
            const editor = vscode.window.activeTextEditor;
            const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
            view.open(selected && !selected.includes('\n') ? selected.trim() : undefined);
        }),
    );
}

