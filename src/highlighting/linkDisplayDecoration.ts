/**
 * Descriptive link display for org files (like Emacs `org-link-descriptive').
 *
 * When enabled, [[target][description]] renders as just "description" and
 * [[target]] renders as "target": the brackets and target are hidden with a
 * display:none decoration. The text stays clickable because the
 * OrgLinkProvider's DocumentLink covers the whole bracketed range.
 *
 * Controlled by `scimax.org.descriptiveLinks`; `scimax.org.toggleLinkDisplay`
 * flips it. `scimax.org.descriptiveLinksReveal` chooses whether the literal
 * link opens up while the cursor is inside it ("cursor") or stays collapsed
 * ("never"; edit it with C-c C-l). With links collapsed, the cursor skips
 * over the hidden parts (see hiddenCursor.ts).
 */

import * as vscode from 'vscode';
import { HiddenRange, skipHidden } from './hiddenCursor';

const LINK_PATTERN = /\[\[((?:[^\]\\]|\\.)+)\](?:\[([^\]]+)\])?\]/g;
const BLOCK_BEGIN = /^\s*#\+begin_(src|example)\b/i;
const BLOCK_END = /^\s*#\+end_(src|example)\b/i;

interface LinkSpan {
    /** Whole link, [[ ... ]] */
    range: vscode.Range;
    /** Leading part to hide: "[[target][" or "[[" */
    prefix: vscode.Range;
    /** Trailing part to hide: "]]" */
    suffix: vscode.Range;
}

let hiddenDecoration: vscode.TextEditorDecorationType | undefined;

/** Cached link spans per document, keyed by document version. */
const spanCache = new WeakMap<vscode.TextDocument, { version: number; spans: LinkSpan[] }>();

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('scimax.org').get<boolean>('descriptiveLinks', true);
}

function revealAtCursor(): boolean {
    return vscode.workspace.getConfiguration('scimax.org').get<string>('descriptiveLinksReveal', 'never') === 'cursor';
}

function findLinkSpans(document: vscode.TextDocument): LinkSpan[] {
    const cached = spanCache.get(document);
    if (cached && cached.version === document.version) {
        return cached.spans;
    }

    const spans: LinkSpan[] = [];
    let inBlock = false;
    for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
        const lineText = document.lineAt(lineNum).text;
        if (inBlock) {
            if (BLOCK_END.test(lineText)) {
                inBlock = false;
            }
            continue;
        }
        if (BLOCK_BEGIN.test(lineText)) {
            inBlock = true;
            continue;
        }
        if (lineText.indexOf('[[') < 0) {
            continue;
        }
        const re = new RegExp(LINK_PATTERN.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(lineText)) !== null) {
            const start = m.index;
            const end = start + m[0].length;
            // With a description, hide "[[target][" ; without, hide only "[["
            const prefixEnd = m[2] !== undefined ? start + 2 + m[1].length + 2 : start + 2;
            spans.push({
                range: new vscode.Range(lineNum, start, lineNum, end),
                prefix: new vscode.Range(lineNum, start, lineNum, prefixEnd),
                suffix: new vscode.Range(lineNum, end - 2, lineNum, end),
            });
        }
    }

    spanCache.set(document, { version: document.version, spans });
    return spans;
}

function updateDecorations(editor: vscode.TextEditor): void {
    if (!hiddenDecoration || editor.document.languageId !== 'org') {
        return;
    }
    if (!isEnabled()) {
        editor.setDecorations(hiddenDecoration, []);
        return;
    }

    const reveal = revealAtCursor();
    const hidden: vscode.Range[] = [];
    for (const span of findLinkSpans(editor.document)) {
        // Optionally reveal the literal link while any cursor touches it
        const touched = reveal && editor.selections.some(sel => span.range.intersection(sel) !== undefined);
        if (!touched) {
            hidden.push(span.prefix, span.suffix);
        }
    }
    editor.setDecorations(hiddenDecoration, hidden);
}

/** Each editor's cursor positions after the last selection change */
const lastActive = new WeakMap<vscode.TextEditor, readonly vscode.Position[]>();

/**
 * Move cursors that landed inside hidden link text to the visible text, in
 * the direction they were moving (see skipHidden).
 */
function skipHiddenText(event: vscode.TextEditorSelectionChangeEvent): void {
    const editor = event.textEditor;
    const previous = lastActive.get(editor);
    lastActive.set(editor, event.selections.map(sel => sel.active));
    if (editor.document.languageId !== 'org' || !isEnabled() || revealAtCursor()) {
        return;
    }

    const spans = findLinkSpans(editor.document);
    if (spans.length === 0) return;

    const keyboard = event.kind === vscode.TextEditorSelectionChangeKind.Keyboard;
    let changed = false;
    const selections = event.selections.map((sel, i) => {
        const active = sel.active;
        const hidden: HiddenRange[] = [];
        for (const span of spans) {
            if (span.range.start.line !== active.line) continue;
            hidden.push(
                { start: span.prefix.start.character, end: span.prefix.end.character },
                { start: span.suffix.start.character, end: span.suffix.end.character },
            );
        }
        if (hidden.length === 0) return sel;

        const prev = previous?.[i];
        const from = keyboard && prev && prev.line === active.line ? prev.character : undefined;
        const lineLength = editor.document.lineAt(active.line).text.length;
        const col = skipHidden(hidden, from, active.character, lineLength);
        if (col === active.character) return sel;

        changed = true;
        const moved = active.with(undefined, col);
        return sel.isEmpty ? new vscode.Selection(moved, moved) : new vscode.Selection(sel.anchor, moved);
    });

    if (changed) {
        editor.selections = selections;
        lastActive.set(editor, selections.map(sel => sel.active));
    }
}

const updateTimeouts = new WeakMap<vscode.TextEditor, NodeJS.Timeout>();

function triggerUpdateDecorations(editor: vscode.TextEditor): void {
    const existing = updateTimeouts.get(editor);
    if (existing) {
        clearTimeout(existing);
    }
    const timeout = setTimeout(() => updateDecorations(editor), 100);
    updateTimeouts.set(editor, timeout);
}

async function toggleLinkDisplay(): Promise<void> {
    const next = !isEnabled();
    await vscode.workspace.getConfiguration('scimax.org')
        .update('descriptiveLinks', next, vscode.ConfigurationTarget.Global);
    vscode.window.setStatusBarMessage(
        next ? 'Links: descriptive display' : 'Links: literal display',
        2000
    );
}

export function registerLinkDisplayDecorations(context: vscode.ExtensionContext): void {
    hiddenDecoration = vscode.window.createTextEditorDecorationType({
        // VS Code has no "invisible" option; injecting display:none removes the
        // characters from layout so the description reads as plain text.
        // This needs editor.disableMonospaceOptimizations (an [org] default in
        // package.json): otherwise ASCII lines place the cursor and map clicks
        // at column * charWidth, as if the hidden text were still there.
        textDecoration: 'none; display: none;',
    });

    for (const editor of vscode.window.visibleTextEditors) {
        triggerUpdateDecorations(editor);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.toggleLinkDisplay', toggleLinkDisplay),
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                triggerUpdateDecorations(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === event.document) {
                    triggerUpdateDecorations(editor);
                }
            }
        }),
        // Selection changes update immediately so the link opens up as the cursor enters
        // (only matters when descriptiveLinksReveal is "cursor")
        vscode.window.onDidChangeTextEditorSelection(event => {
            skipHiddenText(event);
            updateDecorations(event.textEditor);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('scimax.org.descriptiveLinks') ||
                event.affectsConfiguration('scimax.org.descriptiveLinksReveal')) {
                for (const editor of vscode.window.visibleTextEditors) {
                    updateDecorations(editor);
                }
            }
        }),
        {
            dispose: () => hiddenDecoration?.dispose(),
        }
    );
}
