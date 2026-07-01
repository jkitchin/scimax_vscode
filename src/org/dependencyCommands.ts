/**
 * Commands for authoring and navigating TODO task dependencies.
 *
 *   - scimax.org.addDependency   pick a target heading and add it to :DEPENDS:
 *   - scimax.org.gotoBlocker     jump to the first unsatisfied dependency
 *   - scimax.org.showDependencies reveal the dependency tree view
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import { getTodoWorkflowForDocument, getTodoStatesFromText, extractHeadingTitle } from './todoStates';
import { slugify } from '../parser/projectTasks';
import {
    findEnclosingHeadingLine,
    readHeadingProperty,
    getDependsAt,
    getUnsatisfiedBlockers,
    parseDepends,
    DEPENDS_PROPERTY,
} from './dependencies';

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A readable, workspace-unique id derived from a heading title, e.g.
 * "Run analysis" -> "run-analysis" (then "-2", "-3", … on collision). Uniqueness
 * is checked against the DB index and the current document (for unsaved siblings).
 */
async function uniqueSlugId(base: string, document: vscode.TextDocument): Promise<string> {
    const slug = base || 'item';
    const db = await getDatabase();
    const docText = document.getText();
    const taken = async (cand: string): Promise<boolean> => {
        const re = new RegExp(`^\\s*:ID:\\s*(?:id:)?${escapeRegExp(cand)}\\s*$`, 'im');
        if (re.test(docText)) return true;
        if (db) {
            try { if (await db.getHeadingById(cand)) return true; } catch { /* ignore */ }
        }
        return false;
    };
    let cand = slug;
    let i = 1;
    while (await taken(cand)) { i += 1; cand = `${slug}-${i}`; }
    return cand;
}

/**
 * Locate the `:PROPERTIES:`/`:END:` span (and any existing line for `property`)
 * directly under a heading. Line numbers are 0-based; -1 means "not present".
 */
export function findDrawer(document: vscode.TextDocument, headingLine: number, property: string): {
    start: number; end: number; existingLine: number;
} {
    let start = -1, end = -1, existingLine = -1;
    const propRe = new RegExp(`^\\s*:${property}:\\s*`, 'i');
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        if (/^\*+\s/.test(line)) break;
        if (/^\s*:PROPERTIES:\s*$/i.test(line)) { start = i; continue; }
        if (start !== -1 && /^\s*:END:\s*$/i.test(line)) { end = i; break; }
        if (start !== -1 && propRe.test(line)) existingLine = i;
        if (start === -1 && line.trim() !== '' && !line.match(/^\s*:/)) break;
    }
    return { start, end, existingLine };
}

/** Return the heading's `:ID:`, minting a readable, unique slug id if it has none. */
export async function ensureHeadingId(document: vscode.TextDocument, headingLine: number): Promise<string | undefined> {
    const existing = readHeadingProperty(document, headingLine, 'ID');
    if (existing) return existing.replace(/^id:/i, '');

    const todoStates = getTodoStatesFromText(document.getText());
    const title = extractHeadingTitle(document.lineAt(headingLine).text, todoStates);
    const id = await uniqueSlugId(slugify(title), document);

    const drawer = findDrawer(document, headingLine, 'ID');
    const edit = new vscode.WorkspaceEdit();
    if (drawer.start !== -1 && drawer.end !== -1) {
        edit.insert(document.uri, new vscode.Position(drawer.end, 0), `:ID: ${id}\n`);
    } else {
        edit.insert(document.uri, new vscode.Position(headingLine + 1, 0), `:PROPERTIES:\n:ID: ${id}\n:END:\n`);
    }
    const ok = await vscode.workspace.applyEdit(edit);
    return ok ? id : undefined;
}

/** Add `targetId` to the heading's `:DEPENDS:` list (creating the drawer/property as needed). */
async function appendDependency(
    document: vscode.TextDocument,
    headingLine: number,
    targetId: string
): Promise<void> {
    const existing = parseDepends(readHeadingProperty(document, headingLine, DEPENDS_PROPERTY));
    if (existing.includes(targetId)) {
        vscode.window.showInformationMessage('Dependency already present.');
        return;
    }
    const newValue = [...existing, targetId].map(id => `id:${id}`).join(' ');

    const drawer = findDrawer(document, headingLine, DEPENDS_PROPERTY);
    const edit = new vscode.WorkspaceEdit();
    if (drawer.existingLine !== -1) {
        edit.replace(document.uri, document.lineAt(drawer.existingLine).range, `:${DEPENDS_PROPERTY}: ${newValue}`);
    } else if (drawer.start !== -1 && drawer.end !== -1) {
        edit.insert(document.uri, new vscode.Position(drawer.end, 0), `:${DEPENDS_PROPERTY}: ${newValue}\n`);
    } else {
        edit.insert(
            document.uri,
            new vscode.Position(headingLine + 1, 0),
            `:PROPERTIES:\n:${DEPENDS_PROPERTY}: ${newValue}\n:END:\n`
        );
    }
    await vscode.workspace.applyEdit(edit);
}

async function addDependencyCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isOrg(editor.document)) {
        vscode.window.showWarningMessage('Add Dependency works in org files.');
        return;
    }
    const document = editor.document;
    const headingLine = findEnclosingHeadingLine(document, editor.selection.active.line);
    if (headingLine < 0) {
        vscode.window.showWarningMessage('Not under a heading.');
        return;
    }

    const db = await getDatabase();
    if (!db) {
        vscode.window.showWarningMessage('Database not available — cannot list headings.');
        return;
    }

    interface Candidate { file_path: string; line_number: number; title: string; }
    interface PickItem extends vscode.QuickPickItem { heading: Candidate; }

    // Current-file headings come from the LIVE buffer so they're always offered
    // (even before the file is saved/indexed) and never stale.
    const thisFile = document.uri.fsPath;
    const todoStates = getTodoStatesFromText(document.getText());
    const liveItems: PickItem[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        if (i === headingLine) continue; // don't depend on self
        const text = document.lineAt(i).text;
        if (!/^\*+\s+/.test(text)) continue;
        liveItems.push({
            label: extractHeadingTitle(text, todoStates) || text.replace(/^\*+\s+/, ''),
            description: '(this file)',
            detail: `${vscode.workspace.asRelativePath(thisFile)}:${i + 1}`,
            heading: { file_path: thisFile, line_number: i + 1, title: extractHeadingTitle(text, todoStates) },
        });
    }

    // Other files come from the DB index.
    const dbHeadings = await db.searchHeadings('', { limit: 1000 });
    const dbItems: PickItem[] = dbHeadings
        .filter(h => h.file_path !== thisFile)
        .map(h => ({
            label: h.title,
            description: h.todo_state ? `[${h.todo_state}]` : '',
            detail: `${vscode.workspace.asRelativePath(h.file_path)}:${h.line_number}`,
            heading: { file_path: h.file_path, line_number: h.line_number, title: h.title },
        }));

    const items = [...liveItems, ...dbItems];
    if (items.length === 0) {
        vscode.window.showWarningMessage('No headings found to depend on.');
        return;
    }

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a task this one depends on (must be DONE before this can complete)',
        matchOnDetail: true,
    });
    if (!picked) return;

    // Ensure the chosen target has an :ID:. If it lives in another file, write
    // the id there so the dependency is stable.
    const targetDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(picked.heading.file_path));
    const targetHeadingLine = picked.heading.line_number - 1;
    const targetId = await ensureHeadingId(targetDoc, targetHeadingLine);
    if (!targetId) {
        vscode.window.showErrorMessage('Could not assign an ID to the target heading.');
        return;
    }
    if (targetDoc.isDirty) await targetDoc.save();

    // Re-resolve our heading line in case ensureHeadingId edited the same file
    // above our heading (shifts line numbers).
    const freshHeadingLine = picked.heading.file_path === document.uri.fsPath
        ? findEnclosingHeadingLine(document, editor.selection.active.line)
        : headingLine;

    await ensureHeadingId(document, freshHeadingLine); // give the dependent an id too (needed for triggers)
    await appendDependency(document, findEnclosingHeadingLine(document, editor.selection.active.line), targetId);
    vscode.window.showInformationMessage(`Added dependency on "${picked.heading.title}".`);
}

async function gotoBlockerCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isOrg(editor.document)) return;
    const document = editor.document;
    const line = editor.selection.active.line;

    const dependsIds = getDependsAt(document, line);
    if (dependsIds.length === 0) {
        vscode.window.showInformationMessage('This heading has no dependencies.');
        return;
    }
    const workflow = getTodoWorkflowForDocument(document);
    const unmet = await getUnsatisfiedBlockers(dependsIds, new Set(workflow.doneStates));
    if (unmet.length === 0) {
        vscode.window.showInformationMessage('All dependencies are satisfied — not blocked.');
        return;
    }
    const target = unmet.find(b => b.found && b.filePath && b.lineNumber);
    if (!target || !target.filePath || !target.lineNumber) {
        vscode.window.showWarningMessage(`Blocked by missing dependency "${unmet[0].id}".`);
        return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.filePath));
    const ed = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(Math.max(0, target.lineNumber - 1), 0);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

export function registerDependencyCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.addDependency', addDependencyCommand),
        vscode.commands.registerCommand('scimax.org.gotoBlocker', gotoBlockerCommand),
        vscode.commands.registerCommand('scimax.org.showDependencies', async () => {
            await vscode.commands.executeCommand('scimaxDependencies.focus');
        })
    );
}
