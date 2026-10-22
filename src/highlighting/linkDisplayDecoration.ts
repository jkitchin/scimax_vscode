/**
 * Descriptive link display for org files (like Emacs `org-link-descriptive').
 *
 * When enabled, [[target][description]] renders as just "description" and
 * [[target]] renders as "target": the brackets and target are hidden with a
 * display:none decoration. The full link is revealed while the cursor is inside
 * it, so it can still be edited. The text stays clickable because the
 * OrgLinkProvider's DocumentLink covers the whole bracketed range.
 *
 * Controlled by `scimax.org.descriptiveLinks`; `scimax.org.toggleLinkDisplay`
 * flips it.
 */

import * as vscode from 'vscode';

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

    const hidden: vscode.Range[] = [];
    for (const span of findLinkSpans(editor.document)) {
        // Reveal the literal link while any cursor touches it
        const touched = editor.selections.some(sel => span.range.intersection(sel) !== undefined);
        if (!touched) {
            hidden.push(span.prefix, span.suffix);
        }
    }
    editor.setDecorations(hiddenDecoration, hidden);
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
        vscode.window.onDidChangeTextEditorSelection(event => updateDecorations(event.textEditor)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('scimax.org.descriptiveLinks')) {
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
