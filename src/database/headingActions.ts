/**
 * Alternate actions for a heading picked in the heading search (C-c d h).
 *
 * RET opens the heading; M-o in the search opens this menu, where a single
 * key runs an action on the highlighted heading (ivy-style). Esc goes back to
 * the search with the query intact.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import type { HeadingRecord } from './scimaxDb';
import { currentHeadingLine, runOnSourceHeading } from '../org/agendaDocumentProvider';
import { ensureHeadingId, addDependencyBetween } from '../org/dependencyCommands';
import { findEnclosingHeadingLine } from '../org/dependencies';
import { isMarkdownLike } from '../shared/markdownLike';
import { formatMarkdownLink, markdownHeadingSlug } from '../shared/markdownLinks';

/** Where the search was started from: the place links get inserted. */
export interface HeadingActionOrigin {
    editor?: vscode.TextEditor;
}

export interface HeadingAction {
    key: string;
    label: string;
    description: string;
    run: (heading: HeadingRecord, origin: HeadingActionOrigin) => Promise<void>;
}

function isMarkdownFile(filePath: string): boolean {
    return /\.(md|markdown|qmd|rmd)$/i.test(filePath);
}

/**
 * Open a heading's file with the cursor on the heading. `where` is the
 * current group, the group beside it, or a new floating window ("frame").
 */
export async function openHeading(heading: HeadingRecord, where: 'here' | 'beside' | 'frame' = 'here'): Promise<void> {
    let doc: vscode.TextDocument;
    try {
        doc = await vscode.workspace.openTextDocument(heading.file_path);
    } catch {
        vscode.window.showErrorMessage(`Could not open ${heading.file_path}`);
        return;
    }
    const line = Math.max(0, currentHeadingLine(doc, heading.line_number, heading.title) - 1);
    const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), 0);
    const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: where === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
        selection: new vscode.Range(pos, pos),
        preview: false,
    });
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    if (where === 'frame') {
        try {
            await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
        } catch {
            vscode.window.showInformationMessage('This VS Code cannot open editors in a new window.');
        }
    }
}

/** The heading's path as seen from the file the link goes into. */
function linkPath(heading: HeadingRecord, fromDoc?: vscode.TextDocument): string {
    if (!fromDoc || fromDoc.isUntitled) return heading.file_path;
    if (path.resolve(fromDoc.uri.fsPath) === path.resolve(heading.file_path)) return '';
    const rel = path.relative(path.dirname(fromDoc.uri.fsPath), heading.file_path);
    return rel.startsWith('..') && rel.split(path.sep).length > 4 ? heading.file_path : rel;
}

/**
 * A link to the heading for a document of `languageId`.
 *   kind 'id':   [[id:ID][Title]]   (gives an org heading an :ID: if it has none)
 *   kind 'file': [[file:x.org::*Title][Title]]  ([[*Title]] in the same file)
 * Markdown targets and markdown documents get [Title](x.md#slug).
 */
async function buildLink(
    heading: HeadingRecord,
    kind: 'id' | 'file',
    fromDoc?: vscode.TextDocument
): Promise<string | undefined> {
    const title = heading.title;
    const p = linkPath(heading, fromDoc);
    const intoMarkdown = isMarkdownLike(fromDoc?.languageId);

    if (kind === 'id' && !isMarkdownFile(heading.file_path)) {
        const doc = await vscode.workspace.openTextDocument(heading.file_path);
        const line = currentHeadingLine(doc, heading.line_number, heading.title) - 1;
        const id = await ensureHeadingId(doc, line);
        if (!id) {
            vscode.window.showErrorMessage('Could not add an ID to the heading.');
            return undefined;
        }
        if (doc.isDirty && doc !== fromDoc) await doc.save();
        return intoMarkdown ? formatMarkdownLink(`id:${id}`, title) : `[[id:${id}][${title}]]`;
    }

    if (intoMarkdown) {
        const anchor = isMarkdownFile(heading.file_path) ? '#' + markdownHeadingSlug(title) : '';
        return formatMarkdownLink(p + anchor, title);
    }
    return p ? `[[file:${p}::*${title}][${title}]]` : `[[*${title}][${title}]]`;
}

async function insertLink(heading: HeadingRecord, origin: HeadingActionOrigin, kind: 'id' | 'file'): Promise<void> {
    const editor = origin.editor;
    if (!editor || editor.document.isClosed) {
        vscode.window.showWarningMessage('No editor to insert the link into.');
        return;
    }
    const link = await buildLink(heading, kind, editor.document);
    if (!link) return;
    // Re-show the editor; the selection tracks any :ID: drawer added above it.
    const shown = await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    const sel = shown.selection;
    await shown.edit(eb => eb.replace(sel, link));
}

async function copyLink(heading: HeadingRecord, origin: HeadingActionOrigin): Promise<void> {
    const link = await buildLink(heading, 'id', origin.editor?.document);
    if (!link) return;
    await vscode.env.clipboard.writeText(link);
    vscode.window.showInformationMessage(`Copied ${link}`);
}

/** Run an editing command on the heading, then go back to where we started. */
async function runOn(heading: HeadingRecord, origin: HeadingActionOrigin, command: string): Promise<void> {
    await runOnSourceHeading(
        { file: heading.file_path, line: heading.line_number, title: heading.title },
        command,
        async () => {
            if (origin.editor && !origin.editor.document.isClosed) {
                await vscode.window.showTextDocument(origin.editor.document, origin.editor.viewColumn);
            }
        }
    );
}

async function addAsDependency(heading: HeadingRecord, origin: HeadingActionOrigin): Promise<void> {
    const doc = origin.editor?.document;
    if (!doc || !(doc.languageId === 'org' || doc.fileName.endsWith('.org'))) {
        vscode.window.showWarningMessage('Start the search from an org heading to add a dependency.');
        return;
    }
    const line = findEnclosingHeadingLine(doc, origin.editor!.selection.active.line);
    if (line < 0) {
        vscode.window.showWarningMessage('The cursor is not under a heading.');
        return;
    }
    if (doc.isDirty) await doc.save();
    const added = await addDependencyBetween(
        { file: doc.uri.fsPath, line: line + 1 },
        { file: heading.file_path, line: heading.line_number }
    );
    if (added) vscode.window.showInformationMessage(`Now blocked by: ${heading.title}`);
}

export const HEADING_ACTIONS: HeadingAction[] = [
    { key: 'o', label: 'Open', description: 'Go to the heading (default, RET)', run: h => openHeading(h, 'here') },
    { key: 'j', label: 'Open in other window', description: 'Open in the editor group beside this one', run: h => openHeading(h, 'beside') },
    { key: 'w', label: 'Open in new frame', description: 'Open in a new floating window', run: h => openHeading(h, 'frame') },
    { key: 'l', label: 'Insert id link', description: '[[id:…][Title]] at point (adds an :ID: if needed)', run: (h, o) => insertLink(h, o, 'id') },
    { key: 'L', label: 'Insert file link', description: '[[file:…::*Title][Title]] at point', run: (h, o) => insertLink(h, o, 'file') },
    { key: 'c', label: 'Copy id link', description: 'Copy [[id:…][Title]] to the clipboard', run: copyLink },
    { key: 't', label: 'Cycle TODO state', description: 'Change the heading\'s TODO keyword', run: (h, o) => runOn(h, o, 'scimax.org.cycleTodo') },
    { key: 's', label: 'Schedule', description: 'Set SCHEDULED on the heading', run: (h, o) => runOn(h, o, 'scimax.speed.schedule') },
    { key: 'd', label: 'Deadline', description: 'Set DEADLINE on the heading', run: (h, o) => runOn(h, o, 'scimax.speed.deadline') },
    { key: 'i', label: 'Clock in', description: 'Start the clock on the heading', run: (h, o) => runOn(h, o, 'scimax.speed.clockIn') },
    { key: ':', label: 'Set tags', description: 'Edit the heading\'s tags', run: (h, o) => runOn(h, o, 'scimax.speed.setTags') },
    { key: 'D', label: 'Add as dependency', description: 'The heading at point becomes blocked by this one', run: addAsDependency },
];

/**
 * Show the action menu for `heading`. Typing an action's key runs it at once;
 * clicking or RET on an item also works. Resolves to true when an action ran,
 * false when the menu was cancelled.
 */
export function showHeadingActions(heading: HeadingRecord, origin: HeadingActionOrigin): Promise<boolean> {
    return new Promise(resolve => {
        type Item = vscode.QuickPickItem & { action: HeadingAction };
        const qp = vscode.window.createQuickPick<Item>();
        qp.title = heading.title;
        qp.placeholder = 'Press a key to run an action (Esc returns to the search)';
        qp.items = HEADING_ACTIONS.map(action => ({
            label: `[${action.key}] ${action.label}`,
            description: action.description,
            action,
        }));
        let done = false;
        const run = (action: HeadingAction) => {
            if (done) return;
            done = true;
            qp.hide();
            resolve(true);
            void action.run(heading, origin).catch(err =>
                vscode.window.showErrorMessage(`${action.label} failed: ${err}`));
        };
        qp.onDidChangeValue(value => {
            const action = HEADING_ACTIONS.find(a => a.key === value);
            if (action) run(action);
            else if (value.length > 0) qp.value = '';
        });
        qp.onDidAccept(() => {
            const item = qp.activeItems[0];
            if (item) run(item.action);
        });
        qp.onDidHide(() => {
            qp.dispose();
            if (!done) { done = true; resolve(false); }
        });
        qp.show();
    });
}
