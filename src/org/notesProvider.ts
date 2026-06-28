/**
 * Dialog notes provider: capture command, gutter decoration, and the Notes
 * panel. Notes are org footnotes with a `note-` label prefix (see orgNotes.ts),
 * collected under a `* Notes :noexport:` section so they stay out of exports.
 */
import * as vscode from 'vscode';
import * as os from 'os';
import { slugifyAnchor } from '../parser/orgAnchors';
import {
    NOTE_LABEL_PREFIX,
    NOTES_HEADING,
    NoteType,
    makeNoteLabel,
    findNoteReferences,
    findNoteDefinitions,
    buildNoteDefinition,
    NoteDefinition,
} from '../parser/orgNotes';

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

function noteAuthor(): string {
    const configured = vscode.workspace.getConfiguration().get<string>('scimax.org.notes.author', '');
    return configured || os.userInfo().username || '';
}

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Find the line index of the nearest heading at or above `line`, and its title. */
function nearestHeadingTitle(lines: string[], line: number): string {
    for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
        const m = lines[i].match(/^\*+\s+(.*)$/);
        if (m) return m[1].replace(/\s+:[\w@#%:]+:\s*$/, '').trim();
    }
    return '';
}

// ---------------------------------------------------------------------------
// Capture command
// ---------------------------------------------------------------------------

async function addNoteCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isOrg(editor.document)) {
        vscode.window.showWarningMessage('Add note: open an org file first.');
        return;
    }
    const doc = editor.document;
    const sel = editor.selection;

    const typePick = await vscode.window.showQuickPick(
        [
            { label: 'Note', value: 'note' as NoteType },
            { label: 'Decision', value: 'decision' as NoteType },
            { label: 'Question', value: 'question' as NoteType },
        ],
        { placeHolder: 'Note type' }
    );
    if (!typePick) return;

    const body = await vscode.window.showInputBox({
        prompt: `${typePick.label} on the selected passage`,
        placeHolder: 'Your note (the rationale, decision, or question)…',
    });
    if (!body) return;

    // Build a legible, unique label from the selection or the nearest heading.
    const lines = doc.getText().split('\n');
    const selText = doc.getText(sel).trim();
    const basis = selText || nearestHeadingTitle(lines, sel.active.line);
    const prefix = vscode.workspace.getConfiguration().get<string>('scimax.org.notes.labelPrefix', NOTE_LABEL_PREFIX);
    let label = makeNoteLabel(slugifyAnchor(basis), prefix);
    const existing = new Set(findNoteDefinitions(doc.getText(), prefix).map(d => d.label));
    if (existing.has(label)) {
        let n = 2;
        while (existing.has(`${label}-${n}`)) n++;
        label = `${label}-${n}`;
    }

    const reference = `[fn:${label}]`;
    const definition = buildNoteDefinition(label, typePick.value, body, noteAuthor(), today());

    // Compute where the definition goes: end of an existing `* Notes` section, or a new one at EOF.
    const notesHeadingLine = lines.findIndex(l => /^\*+\s+Notes(\s|$)/.test(l));
    let defInsertPos: vscode.Position;
    let defText: string;
    if (notesHeadingLine >= 0) {
        let end = lines.length;
        for (let i = notesHeadingLine + 1; i < lines.length; i++) {
            if (/^\*+\s/.test(lines[i])) { end = i; break; }
        }
        if (end >= lines.length) {
            // Notes is the last section: append at end of document.
            defInsertPos = doc.lineAt(doc.lineCount - 1).range.end;
            defText = `\n${definition}\n`;
        } else {
            defInsertPos = new vscode.Position(end, 0);
            defText = `${definition}\n\n`;
        }
    } else {
        const lastLine = doc.lineAt(doc.lineCount - 1);
        defInsertPos = lastLine.range.end;
        defText = `\n\n* ${NOTES_HEADING} :noexport:\n${definition}\n`;
    }

    await editor.edit(eb => {
        eb.insert(sel.end, reference);   // marker right after the passage
        eb.insert(defInsertPos, defText); // body under the Notes section
    });
    vscode.window.showInformationMessage(`Added ${typePick.label.toLowerCase()} ${reference}.`);
}

// ---------------------------------------------------------------------------
// Gutter decoration
// ---------------------------------------------------------------------------

function registerDecorations(context: vscode.ExtensionContext): void {
    const gutter = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'note-gutter.svg'),
        gutterIconSize: 'contain',
        overviewRulerColor: '#4a90d9',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    context.subscriptions.push(gutter);

    const prefix = () =>
        vscode.workspace.getConfiguration().get<string>('scimax.org.notes.labelPrefix', NOTE_LABEL_PREFIX);

    function refresh(editor: vscode.TextEditor | undefined): void {
        if (!editor || !isOrg(editor.document)) return;
        const refs = findNoteReferences(editor.document.getText(), prefix());
        const ranges = refs.map(r => new vscode.Range(r.line, r.startChar, r.line, r.endChar));
        editor.setDecorations(gutter, ranges);
    }

    let timer: NodeJS.Timeout | undefined;
    const schedule = (editor: vscode.TextEditor | undefined) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => refresh(editor), 300);
    };

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(refresh),
        vscode.workspace.onDidChangeTextDocument(e => {
            const editor = vscode.window.activeTextEditor;
            if (editor && e.document === editor.document) schedule(editor);
        })
    );
    refresh(vscode.window.activeTextEditor);
}

// ---------------------------------------------------------------------------
// Notes panel (tree)
// ---------------------------------------------------------------------------

type NotesNode =
    | { kind: 'heading'; title: string; line: number }
    | { kind: 'note'; def: NoteDefinition; refLine: number };

const TYPE_ICON: Record<NoteType, string> = {
    note: 'comment',
    decision: 'check',
    question: 'question',
};

class NotesTreeProvider implements vscode.TreeDataProvider<NotesNode> {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    refresh(): void { this._onDidChange.fire(); }

    private get prefix(): string {
        return vscode.workspace.getConfiguration().get<string>('scimax.org.notes.labelPrefix', NOTE_LABEL_PREFIX);
    }

    getTreeItem(node: NotesNode): vscode.TreeItem {
        if (node.kind === 'heading') {
            const item = new vscode.TreeItem(node.title || '(top)', vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('symbol-string');
            return item;
        }
        const d = node.def;
        const item = new vscode.TreeItem(d.body || d.label, vscode.TreeItemCollapsibleState.None);
        item.description = [d.type, d.author, d.state].filter(Boolean).join(' · ');
        item.iconPath = new vscode.ThemeIcon(TYPE_ICON[d.type] || 'comment');
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            item.command = {
                command: 'scimax.notes.reveal',
                title: 'Reveal note',
                arguments: [editor.document.uri, node.refLine],
            };
        }
        return item;
    }

    getChildren(node?: NotesNode): NotesNode[] {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isOrg(editor.document)) return [];
        const text = editor.document.getText();
        const lines = text.split('\n');
        const defs = new Map(findNoteDefinitions(text, this.prefix).map(d => [d.label, d]));
        const refs = findNoteReferences(text, this.prefix);

        if (!node) {
            // Top level: headings that contain at least one note reference.
            const headingLines: { title: string; line: number }[] = [];
            lines.forEach((l, i) => {
                const m = l.match(/^\*+\s+(.*)$/);
                if (m) headingLines.push({ title: m[1].replace(/\s+:[\w@#%:]+:\s*$/, '').trim(), line: i });
            });
            const used = new Set<number>();
            for (const ref of refs) {
                let owner = -1;
                for (const h of headingLines) { if (h.line <= ref.line) owner = h.line; else break; }
                used.add(owner);
            }
            const groups: NotesNode[] = [];
            if (used.has(-1)) groups.push({ kind: 'heading', title: '(top)', line: -1 });
            for (const h of headingLines) {
                if (used.has(h.line)) groups.push({ kind: 'heading', title: h.title, line: h.line });
            }
            return groups;
        }

        if (node.kind === 'heading') {
            // Notes whose reference is owned by this heading.
            return refs
                .filter(r => this.refOwner(r.line, lines) === node.line)
                .filter(r => defs.has(r.label))
                .map(r => ({ kind: 'note', def: defs.get(r.label)!, refLine: r.line } as NotesNode));
        }
        return [];
    }

    private refOwner(line: number, lines: string[]): number {
        let owner = -1;
        for (let i = line - 1; i >= 0; i--) { if (/^\*+\s/.test(lines[i])) { owner = i; break; } }
        return owner;
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNotesProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.addNote', addNoteCommand)
    );

    registerDecorations(context);

    const tree = new NotesTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('scimax.notes', tree),
        vscode.window.onDidChangeActiveTextEditor(() => tree.refresh()),
        vscode.workspace.onDidSaveTextDocument(() => tree.refresh()),
        vscode.commands.registerCommand('scimax.notes.refresh', () => tree.refresh()),
        vscode.commands.registerCommand('scimax.notes.reveal', async (uri: vscode.Uri, line: number) => {
            const d = await vscode.workspace.openTextDocument(uri);
            const ed = await vscode.window.showTextDocument(d);
            const pos = new vscode.Position(Math.max(0, line), 0);
            ed.selection = new vscode.Selection(pos, pos);
            ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        })
    );

    let timer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            const editor = vscode.window.activeTextEditor;
            if (editor && e.document === editor.document && isOrg(e.document)) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => tree.refresh(), 400);
            }
        })
    );
}
