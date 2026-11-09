/**
 * smerge mode: resolve git conflict blocks from the keyboard, like Emacs
 * smerge-mode.
 *
 * It is on in a file that git lists as conflicted and that has conflict
 * blocks (context key scimax.smergeActive, and "smerge 2/5" in the status
 * bar). The commands also work from the palette or the Conflicts menu on
 * any file with conflict blocks. With the cursor at the start of a
 * marker line (scimax.atConflictMarker), single keys act on that conflict:
 * n/p move, m/t/b/B keep mine/theirs/both/base, M/T keep mine/theirs
 * everywhere, RET keeps the side the marker belongs to, e opens the merge
 * editor, = compares the sides, and ? shows the Conflicts menu. The same final
 * keys work anywhere in the file after C-c ^.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { getFileStatus, stageFile } from './vcManager';
import {
    Conflict,
    ConflictChoice,
    conflictAt,
    conflictIndex,
    isConflictMarkerAt,
    mayHaveConflicts,
    nextConflict,
    parseConflicts,
    previousConflict,
    resolveConflict,
    sideAt,
    sideName,
} from './smerge';

const log = createLogger('VC');

const COMPARE_SCHEME = 'scimax-smerge';

/** Conflicts of a document, cached by version */
const cache = new Map<string, { version: number; conflicts: Conflict[] }>();

function conflictsOf(document: vscode.TextDocument): Conflict[] {
    const key = document.uri.toString();
    const cached = cache.get(key);
    if (cached && cached.version === document.version) return cached.conflicts;
    const text = document.getText();
    const conflicts = mayHaveConflicts(text) ? parseConflicts(text.split(/\r?\n/)) : [];
    cache.set(key, { version: document.version, conflicts });
    return conflicts;
}

function moveTo(editor: vscode.TextEditor, line: number): void {
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function flash(text: string): void {
    vscode.window.setStatusBarMessage(text, 3000);
}

/** The range covering a conflict block's lines, including the final line break */
function blockRange(document: vscode.TextDocument, conflict: Conflict): vscode.Range {
    const start = new vscode.Position(conflict.start, 0);
    const end = conflict.end + 1 < document.lineCount
        ? new vscode.Position(conflict.end + 1, 0)
        : document.lineAt(conflict.end).range.end;
    return new vscode.Range(start, end);
}

function replacement(document: vscode.TextDocument, conflict: Conflict, lines: string[]): string {
    if (lines.length === 0) return '';
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const atEnd = conflict.end + 1 >= document.lineCount;
    return lines.join(eol) + (atEnd ? '' : eol);
}

class SmergeMode implements vscode.Disposable {
    private readonly statusItem: vscode.StatusBarItem;
    private readonly compareContents = new Map<string, string>();
    private readonly disposables: vscode.Disposable[] = [];
    private active = false;
    private atMarker = false;
    /**
     * Whether git lists each file as conflicted (unmerged). Like Emacs, which
     * starts smerge only when vc-git-conflicted-p, smerge mode needs both git's
     * word and conflict blocks, so a file that merely shows a conflict as an
     * example (in docs or a talk) is left alone. Rechecked when the file is
     * focused or saved.
     */
    private readonly gitConflicted = new Map<string, boolean | 'pending'>();

    constructor() {
        this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusItem.command = 'scimax.smerge.menu';
        this.disposables.push(
            this.statusItem,
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) this.gitConflicted.delete(editor.document.uri.toString());
                this.refresh();
            }),
            vscode.workspace.onDidSaveTextDocument((d) => {
                this.gitConflicted.delete(d.uri.toString());
                if (d === vscode.window.activeTextEditor?.document) this.refresh();
            }),
            vscode.window.onDidChangeTextEditorSelection((e) => {
                if (e.textEditor === vscode.window.activeTextEditor) this.refresh();
            }),
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document === vscode.window.activeTextEditor?.document) this.refresh();
            }),
            vscode.workspace.onDidCloseTextDocument((d) => {
                cache.delete(d.uri.toString());
                this.gitConflicted.delete(d.uri.toString());
            }),
            vscode.workspace.registerTextDocumentContentProvider(COMPARE_SCHEME, {
                provideTextDocumentContent: (uri) => this.compareContents.get(uri.toString()) ?? '',
            })
        );
        this.refresh();
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    /** Update the context keys and the status bar for the active editor */
    refresh(): void {
        const editor = vscode.window.activeTextEditor;
        const conflicts = editor ? conflictsOf(editor.document) : [];
        const active = !!editor && conflicts.length > 0 && this.isGitConflicted(editor.document);
        const line = editor?.selection.active.line ?? 0;
        const atMarker = active && !!editor && editor.selection.isEmpty
            && editor.selection.active.character === 0 && isConflictMarkerAt(conflicts, line);
        if (active !== this.active) {
            this.active = active;
            vscode.commands.executeCommand('setContext', 'scimax.smergeActive', active);
        }
        if (atMarker !== this.atMarker) {
            this.atMarker = atMarker;
            vscode.commands.executeCommand('setContext', 'scimax.atConflictMarker', atMarker);
        }
        if (active) {
            this.statusItem.text = `$(git-merge) smerge ${conflictIndex(conflicts, line)}/${conflicts.length}`;
            this.statusItem.tooltip = 'Merge conflicts in this file. At a marker line: n/p move, '
                + 'm/t/b keep mine/theirs/both, RET keeps this side, ? for all keys. Click for the Conflicts menu.';
            this.statusItem.show();
        } else {
            this.statusItem.hide();
        }
    }

    /** Cached git verdict; starts a check (and refreshes after it) when unknown */
    private isGitConflicted(document: vscode.TextDocument): boolean {
        if (document.uri.scheme !== 'file') return false;
        const key = document.uri.toString();
        const known = this.gitConflicted.get(key);
        if (known === undefined) {
            this.gitConflicted.set(key, 'pending');
            getFileStatus(document.uri.fsPath)
                .then((status) => status.state === 'conflict', () => false)
                .then((conflicted) => {
                    if (this.gitConflicted.get(key) !== 'pending') return;
                    this.gitConflicted.set(key, conflicted);
                    if (conflicted) this.refresh();
                });
            return false;
        }
        return known === true;
    }

    private editorWithConflicts(): { editor: vscode.TextEditor; conflicts: Conflict[] } | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;
        const conflicts = conflictsOf(editor.document);
        if (conflicts.length === 0) {
            flash('No merge conflicts in this file');
            return undefined;
        }
        return { editor, conflicts };
    }

    next(fromTop = false): void {
        const found = this.editorWithConflicts();
        if (!found) return;
        const target = fromTop ? found.conflicts[0] : nextConflict(found.conflicts, found.editor.selection.active.line);
        if (target) moveTo(found.editor, target.start);
        else flash('No more conflicts below');
    }

    previous(): void {
        const found = this.editorWithConflicts();
        if (!found) return;
        const line = found.editor.selection.active.line;
        const inside = conflictAt(found.conflicts, line);
        const target = previousConflict(found.conflicts, inside && inside.start < line ? inside.start + 1 : line);
        if (target) moveTo(found.editor, target.start);
        else flash('No more conflicts above');
    }

    /** Keep one side of the conflict at the cursor, then go to the next one */
    async keep(choice: ConflictChoice): Promise<void> {
        const found = this.editorWithConflicts();
        if (!found) return;
        const { editor } = found;
        const conflict = conflictAt(found.conflicts, editor.selection.active.line);
        if (!conflict) {
            flash('Not in a conflict; n goes to the next one');
            return;
        }
        const lines = resolveConflict(conflict, choice);
        if (!lines) {
            flash('This conflict has no base version (set merge.conflictStyle to diff3)');
            return;
        }
        const document = editor.document;
        const ok = await editor.edit((edit) => edit.replace(blockRange(document, conflict), replacement(document, conflict, lines)));
        if (!ok) return;
        flash(`Kept ${sideName(conflict, choice)}`);
        const remaining = conflictsOf(document);
        const target = remaining.find((c) => c.start >= conflict.start) ?? remaining[0];
        if (target) {
            moveTo(editor, target.start);
        } else {
            moveTo(editor, Math.min(conflict.start, document.lineCount - 1));
            await this.allResolved(document);
        }
    }

    /** RET: keep the side whose marker (or text) the cursor is on */
    async keepCurrent(): Promise<void> {
        const found = this.editorWithConflicts();
        if (!found) return;
        const line = found.editor.selection.active.line;
        const conflict = conflictAt(found.conflicts, line);
        if (!conflict) {
            flash('Not in a conflict; n goes to the next one');
            return;
        }
        const side = sideAt(conflict, line);
        if (!side) {
            flash('The ======= line is between the sides: use m (mine) or t (theirs)');
            return;
        }
        await this.keep(side);
    }

    /** M / T: keep one side of every conflict in the file */
    async keepAll(choice: 'mine' | 'theirs'): Promise<void> {
        const found = this.editorWithConflicts();
        if (!found) return;
        const { editor, conflicts } = found;
        const document = editor.document;
        const ok = await editor.edit((edit) => {
            for (const conflict of conflicts) {
                edit.replace(blockRange(document, conflict), replacement(document, conflict, resolveConflict(conflict, choice) ?? []));
            }
        });
        if (!ok) return;
        flash(`Kept ${choice} in ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`);
        moveTo(editor, Math.min(conflicts[0].start, document.lineCount - 1));
        await this.allResolved(document);
    }

    /** =: the two sides of the conflict at the cursor in the diff editor */
    async compare(): Promise<void> {
        const found = this.editorWithConflicts();
        if (!found) return;
        const { editor } = found;
        const line = editor.selection.active.line;
        const conflict = conflictAt(found.conflicts, line) ?? nextConflict(found.conflicts, line);
        if (!conflict) {
            flash('No conflict here or below');
            return;
        }
        const name = path.basename(editor.document.uri.fsPath || editor.document.uri.path);
        const stamp = Date.now().toString(36);
        const left = vscode.Uri.from({ scheme: COMPARE_SCHEME, path: `/${stamp}/mine/${name}` });
        const right = vscode.Uri.from({ scheme: COMPARE_SCHEME, path: `/${stamp}/theirs/${name}` });
        this.compareContents.set(left.toString(), conflict.mine.join('\n') + '\n');
        this.compareContents.set(right.toString(), conflict.theirs.join('\n') + '\n');
        await vscode.commands.executeCommand('vscode.diff', left, right,
            `${name}: ${sideName(conflict, 'mine')} ↔ ${sideName(conflict, 'theirs')}`);
    }

    /** The last conflict is gone: offer to mark the file resolved (git add) */
    private async allResolved(document: vscode.TextDocument): Promise<void> {
        if (document.uri.scheme !== 'file') {
            flash('No conflicts left');
            return;
        }
        const file = document.uri.fsPath;
        const name = path.basename(file);
        let state: string;
        try {
            state = (await getFileStatus(file)).state;
        } catch (error) {
            log.debug('smerge: no git status', { file, error: String(error) });
            flash('No conflicts left');
            return;
        }
        if (state !== 'conflict') {
            flash('No conflicts left');
            return;
        }
        const choice = await vscode.window.showInformationMessage(
            `No conflicts left in ${name}. Save it and mark it resolved (git add)?`, 'Mark Resolved');
        if (choice !== 'Mark Resolved') return;
        if (document.isDirty) await document.save();
        await stageFile(file);
        this.gitConflicted.set(document.uri.toString(), false);
        this.refresh();
        vscode.window.showInformationMessage(`${name} is resolved. C-x v v commits to finish the merge.`);
    }
}

export function registerSmergeCommands(context: vscode.ExtensionContext): void {
    const mode = new SmergeMode();
    const guard = (name: string, fn: () => unknown) => async () => {
        try {
            await fn();
        } catch (error) {
            log.error(`${name} failed`, error instanceof Error ? error : undefined);
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    };
    context.subscriptions.push(
        mode,
        vscode.commands.registerCommand('scimax.smerge.next', guard('scimax.smerge.next', () => mode.next())),
        // Internal: C-x v v's "Go to First Conflict"
        vscode.commands.registerCommand('scimax.smerge.first', guard('scimax.smerge.first', () => mode.next(true))),
        vscode.commands.registerCommand('scimax.smerge.previous', guard('scimax.smerge.previous', () => mode.previous())),
        vscode.commands.registerCommand('scimax.smerge.keepMine', guard('scimax.smerge.keepMine', () => mode.keep('mine'))),
        vscode.commands.registerCommand('scimax.smerge.keepTheirs', guard('scimax.smerge.keepTheirs', () => mode.keep('theirs'))),
        vscode.commands.registerCommand('scimax.smerge.keepBoth', guard('scimax.smerge.keepBoth', () => mode.keep('both'))),
        vscode.commands.registerCommand('scimax.smerge.keepBase', guard('scimax.smerge.keepBase', () => mode.keep('base'))),
        vscode.commands.registerCommand('scimax.smerge.keepCurrent', guard('scimax.smerge.keepCurrent', () => mode.keepCurrent())),
        vscode.commands.registerCommand('scimax.smerge.keepAllMine', guard('scimax.smerge.keepAllMine', () => mode.keepAll('mine'))),
        vscode.commands.registerCommand('scimax.smerge.keepAllTheirs', guard('scimax.smerge.keepAllTheirs', () => mode.keepAll('theirs'))),
        vscode.commands.registerCommand('scimax.smerge.compare', guard('scimax.smerge.compare', () => mode.compare())),
        vscode.commands.registerCommand('scimax.smerge.mergeEditor', guard('scimax.smerge.mergeEditor', () => vscode.commands.executeCommand('scimax.vc.git', 'git.openMergeEditor'))),
        vscode.commands.registerCommand('scimax.smerge.menu', guard('scimax.smerge.menu', () => vscode.commands.executeCommand('scimax.hydra.show', 'scimax.conflicts')))
    );
}
