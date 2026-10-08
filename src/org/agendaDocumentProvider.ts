/**
 * Agenda buffer: a persistent, refreshable agenda in a full editor tab.
 *
 * This is the org-agenda-mode analogue of the sidebar TreeView. It is backed by
 * a TextDocumentContentProvider, which gets us two things for free: the buffer
 * is read-only (no accidental edits, no dirty-tab prompts), and re-rendering is
 * a matter of firing onDidChange rather than replacing an editor's contents.
 *
 * Design note — why the URI is stable:
 * The view configuration is deliberately NOT encoded in the URI. Each view type
 * gets one fixed URI (`org-agenda:Agenda.org`) and the mutable state (date
 * offset, config) lives in this provider, keyed by that URI. Paging forward
 * therefore mutates state and re-renders the *same* document, so `f`/`b` update
 * the tab in place. Encoding the offset in the URI would make every page turn a
 * distinct document, and hence a new editor tab.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
// Per-function imports: the package index loads all of date-fns.
import addDays from 'date-fns/addDays';
import startOfDay from 'date-fns/startOfDay';
import {
    renderAgendaBuffer,
    type AgendaItem,
    type AgendaViewConfig,
} from '../parser/orgAgenda';
import { renderSnippetMarkdown, type SnippetLine } from './agendaHover';
import type { AgendaManager } from './agendaProvider';

/** URI scheme for agenda buffers. Matches `resourceScheme` in when-clauses. */
export const AGENDA_SCHEME = 'org-agenda';

/**
 * Names an agenda line from outside the buffer's cursor, e.g. a hover link.
 * The buffer commands take this as an optional argument and fall back to the
 * cursor line without it.
 */
export interface AgendaLineRef {
    /** The agenda buffer's URI, as a string */
    uri: string;
    /** 0-based line in the agenda buffer */
    line: number;
}

/** Body lines shown under the heading in an item's hover. */
const HOVER_BODY_LINES = 6;

/** Commands the hover links may run; nothing else is trusted. */
const HOVER_COMMANDS = [
    'scimax.agenda.buffer.goto',
    'scimax.agenda.buffer.openToSide',
    'scimax.agenda.buffer.cycleTodo',
    'scimax.agenda.buffer.ignoreFile',
    'scimax.agenda.buffer.openEntryLink',
];

/** State backing one open agenda buffer. */
interface ViewState {
    /** Base configuration, as requested when the buffer was opened */
    config: Partial<AgendaViewConfig>;
    /** Span in days; also the unit for paging */
    days: number;
    /** Periods paged forward (+) or back (-) from the base start date */
    offset: number;
}

export class AgendaDocumentProvider
    implements
        vscode.TextDocumentContentProvider,
        vscode.DocumentLinkProvider,
        vscode.HoverProvider
{
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    private states = new Map<string, ViewState>();
    private lineMaps = new Map<string, Map<number, AgendaItem>>();

    constructor(private manager: AgendaManager) {}

    /**
     * Render the buffer. Called by VS Code on open and after every
     * onDidChange fire — never call it directly.
     */
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const state = this.states.get(uri.toString());
        if (!state) {
            // The tab was restored across a window reload, so the state that
            // produced it is gone. Say so rather than silently showing nothing.
            return [
                'This agenda buffer is no longer live.',
                '',
                'Reopen it with: Scimax: Open Agenda Buffer',
            ].join('\n');
        }

        const view = await this.manager.getAgendaView(this.resolveConfig(state));
        const { text, lineMap } = renderAgendaBuffer(view);
        this.lineMaps.set(uri.toString(), lineMap);
        return text;
    }

    /** Apply the current page offset to the base config. */
    private resolveConfig(state: ViewState): Partial<AgendaViewConfig> {
        const base = state.config.startDate ?? startOfDay(new Date());
        return {
            ...state.config,
            days: state.days,
            startDate: addDays(base, state.offset * state.days),
        };
    }

    /** The item rendered on a given 0-based line, if any. */
    itemAtLine(uri: vscode.Uri, line: number): AgendaItem | undefined {
        return this.lineMaps.get(uri.toString())?.get(line);
    }

    /**
     * Make every item line a clickable link to its source heading.
     *
     * VS Code opens document links on Ctrl/Cmd+click, not plain click — a plain
     * click in a text editor is a cursor move and cannot be intercepted. The
     * `RET` binding covers the keyboard case and the context menu the mouse
     * case, so between the three there is always a one-gesture way in.
     */
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        const lineMap = this.lineMaps.get(document.uri.toString());
        if (!lineMap) return [];

        const links: vscode.DocumentLink[] = [];
        for (const [lineNumber, item] of lineMap) {
            if (lineNumber >= document.lineCount) continue;

            const text = document.lineAt(lineNumber).text;
            const start = text.length - text.trimStart().length;
            const end = text.trimEnd().length;
            if (end <= start) continue;

            // The `#L<n>` fragment is how VS Code encodes "open at this line".
            const target = vscode.Uri.file(item.file).with({
                fragment: `L${Math.max(1, item.line)}`,
            });

            const link = new vscode.DocumentLink(
                new vscode.Range(lineNumber, start, lineNumber, end),
                target
            );
            links.push(link);
        }
        return links;
    }

    /**
     * Hover an item to see where it lives, the start of its entry, and links
     * that act on it. The file path is in the hover, so the link has no
     * tooltip of its own.
     */
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const item = this.itemAtLine(document.uri, position.line);
        if (!item) return undefined;

        const ref: AgendaLineRef = { uri: document.uri.toString(), line: position.line };
        const link = (label: string, command: string, title: string) =>
            `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([ref]))} "${title}")`;

        const md = new vscode.MarkdownString();
        md.isTrusted = { enabledCommands: HOVER_COMMANDS };
        md.supportThemeIcons = true;

        md.appendMarkdown(`$(file) \`${item.file}:${item.line}\`\n\n`);

        const snippet = await readEntrySnippet(item.file, item.line);
        if (snippet) {
            const entryLink = (target: unknown) =>
                `command:scimax.agenda.buffer.openEntryLink?${encodeURIComponent(JSON.stringify([target]))}`;
            md.appendMarkdown(renderSnippetMarkdown(item.file, snippet, entryLink));
            md.appendMarkdown('\n\n---\n\n');
        } else {
            md.appendText(item.title);
            md.appendMarkdown('\n\n');
        }

        md.appendMarkdown(
            [
                link('$(go-to-file) Open', 'scimax.agenda.buffer.goto', 'Jump to the heading (RET)'),
                link('$(split-horizontal) Open to Side', 'scimax.agenda.buffer.openToSide', 'Open beside the agenda'),
                link('$(sync) Cycle TODO', 'scimax.agenda.buffer.cycleTodo', 'Cycle the TODO state (t)'),
                link('$(eye-closed) Ignore File', 'scimax.agenda.buffer.ignoreFile', 'Exclude this file from the agenda'),
            ].join(' &nbsp;|&nbsp; ')
        );
        return new vscode.Hover(md);
    }

    /** Resolve a hover-link reference, or the cursor line of the active buffer. */
    resolveLine(ref?: AgendaLineRef): { uri: vscode.Uri; item: AgendaItem } | undefined {
        let uri: vscode.Uri | undefined;
        let line: number | undefined;
        if (ref) {
            uri = vscode.Uri.parse(ref.uri);
            line = ref.line;
        } else {
            const editor = vscode.window.activeTextEditor;
            uri = editor?.document.uri;
            line = editor?.selection.active.line;
        }
        if (!uri || line === undefined || !this.owns(uri)) return undefined;
        const item = this.itemAtLine(uri, line);
        return item ? { uri, item } : undefined;
    }

    /** True if this provider is backing the given document. */
    owns(uri: vscode.Uri): boolean {
        return uri.scheme === AGENDA_SCHEME && this.states.has(uri.toString());
    }

    /** Re-render one buffer. */
    refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    /** Re-render every live buffer (e.g. after the database is reindexed). */
    refreshAll(): void {
        for (const key of this.states.keys()) {
            this._onDidChange.fire(vscode.Uri.parse(key));
        }
    }

    /** Page forward (+1) or back (-1) by one span, in place. */
    page(uri: vscode.Uri, delta: number): void {
        const state = this.states.get(uri.toString());
        if (!state) return;
        state.offset += delta;
        this._onDidChange.fire(uri);
    }

    /** The base configuration a buffer was opened with. */
    getConfig(uri: vscode.Uri): Partial<AgendaViewConfig> | undefined {
        return this.states.get(uri.toString())?.config;
    }

    /** Change a buffer's filters in place, keeping its tab and page. */
    updateConfig(uri: vscode.Uri, patch: Partial<AgendaViewConfig>): void {
        const state = this.states.get(uri.toString());
        if (!state) return;
        state.config = { ...state.config, ...patch };
        this._onDidChange.fire(uri);
    }

    /** Return to the period containing today. */
    resetToToday(uri: vscode.Uri): void {
        const state = this.states.get(uri.toString());
        if (!state) return;
        state.offset = 0;
        this._onDidChange.fire(uri);
    }

    /**
     * Open (or reveal) an agenda buffer. Reusing `name` reuses the tab.
     */
    async open(name: string, config: Partial<AgendaViewConfig>, days: number): Promise<void> {
        const uri = vscode.Uri.parse(`${AGENDA_SCHEME}:${name}.org`);
        const key = uri.toString();

        const existing = this.states.get(key);
        if (existing) {
            // Reopening resets the config but keeps the tab.
            existing.config = config;
            existing.days = days;
            existing.offset = 0;
        } else {
            this.states.set(key, { config, days, offset: 0 });
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        // Borrow org highlighting rather than contributing a new grammar.
        await vscode.languages.setTextDocumentLanguage(doc, 'org');
        await vscode.window.showTextDocument(doc, { preview: false });

        // If the tab already existed, opening it does not re-render on its own.
        this._onDidChange.fire(uri);
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.states.clear();
        this.lineMaps.clear();
    }
}

/**
 * The heading at a 1-based line and the first few lines of its entry, with
 * property drawers left out. Reads an open editor's text when there is one, so
 * unsaved edits show; otherwise reads the file.
 */
async function readEntrySnippet(file: string, line: number): Promise<SnippetLine[] | undefined> {
    let lines: string[];
    const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file);
    if (open) {
        lines = open.getText().split(/\r?\n/);
    } else {
        try {
            lines = (await fs.promises.readFile(file, 'utf8')).split(/\r?\n/);
        } catch {
            return undefined;
        }
    }

    const start = line - 1;
    if (start < 0 || start >= lines.length) return undefined;

    const out: SnippetLine[] = [{ text: lines[start], line }];
    let inDrawer = false;
    for (let i = start + 1; i < lines.length && out.length <= HOVER_BODY_LINES; i++) {
        const text = lines[i];
        if (/^\*+\s/.test(text)) break;
        if (/^\s*:PROPERTIES:\s*$/i.test(text)) {
            inDrawer = true;
            continue;
        }
        if (inDrawer) {
            if (/^\s*:END:\s*$/i.test(text)) inDrawer = false;
            continue;
        }
        out.push({ text: text.length > 200 ? `${text.slice(0, 200)}...` : text, line: i + 1 });
    }
    return out;
}

/**
 * Run a command against an item's source heading, then return to the agenda.
 *
 * The editing commands (TODO cycling and friends) all operate on the active
 * editor's cursor, and they carry real semantics we must not fork: repeater
 * advancement, CLOSED timestamps, and the org-depend completion guard. Rather
 * than reimplement any of that against a file path and line number, briefly
 * make the source the active editor, invoke the real command, and come back.
 *
 * The visible round trip is the cost of not duplicating that logic. Emacs
 * changes state without leaving the agenda; we trade that for correctness.
 */
export async function runOnSourceHeading(
    item: Pick<AgendaItem, 'file' | 'line'>,
    command: string,
    returnTo: vscode.Uri | (() => Thenable<unknown> | void)
): Promise<boolean> {
    let sourceEditor: vscode.TextEditor;
    try {
        const doc = await vscode.workspace.openTextDocument(item.file);
        sourceEditor = await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
        vscode.window.showErrorMessage(`Could not open file: ${item.file}`);
        return false;
    }

    const line = Math.max(0, item.line - 1);
    if (line >= sourceEditor.document.lineCount) {
        vscode.window.showWarningMessage(
            `Agenda is out of date: ${item.file} no longer has line ${item.line}. Refresh with g.`
        );
        return false;
    }

    const position = new vscode.Position(line, 0);
    sourceEditor.selection = new vscode.Selection(position, position);

    try {
        await vscode.commands.executeCommand(command);
    } catch (error) {
        vscode.window.showErrorMessage(`${command} failed: ${error}`);
        return false;
    }

    // Save so the indexer sees the change and the agenda can reflect it.
    if (sourceEditor.document.isDirty) {
        await sourceEditor.document.save();
    }

    // Return to where the command was started (the agenda, or a webview).
    if (returnTo instanceof vscode.Uri) {
        const agendaDoc = await vscode.workspace.openTextDocument(returnTo);
        await vscode.window.showTextDocument(agendaDoc, { preview: false });
    } else {
        await returnTo();
    }
    return true;
}

/** Jump to the source heading behind an agenda line. */
export async function revealAgendaItem(
    item: AgendaItem,
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active
): Promise<void> {
    try {
        const doc = await vscode.workspace.openTextDocument(item.file);
        const editor = await vscode.window.showTextDocument(doc, { viewColumn });
        const position = new vscode.Position(Math.max(0, item.line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    } catch {
        vscode.window.showErrorMessage(`Could not open file: ${item.file}`);
    }
}
