import * as vscode from 'vscode';
import { KillRing, KillMode, DEFAULT_KILL_RING_SIZE } from './killRing';
import { deactivateMark } from '../mark/markRing';

/**
 * Emacs-style kill ring for VS Code
 *
 * Kills and copies go onto the ring and also to the system clipboard.
 * C-y yanks the entry under the yank pointer; M-y right after a yank replaces
 * it with the next older entry, otherwise it opens a picker over the ring.
 * Text copied in other applications (or with Cmd+C) is pulled into the ring
 * before the next kill or yank, so it is never lost.
 */

const ring = new KillRing(() =>
    vscode.workspace.getConfiguration('scimax.killRing').get<number>('maxSize', DEFAULT_KILL_RING_SIZE)
);

// The last text we wrote to the system clipboard, to tell our writes from others'
let lastClipboardWrite: string | undefined;

// Where the last appendable kill left the cursor; a kill starting there joins it
let lastKill: { uri: string; version: number; offset: number } | undefined;

// What the last yank inserted, so M-y can replace it
let lastYank: { uri: string; version: number; ranges: vscode.Range[] } | undefined;

/**
 * Pull text copied outside the ring (other apps, Cmd+C) onto the ring.
 */
async function syncFromClipboard(): Promise<void> {
    const clip = await vscode.env.clipboard.readText();
    if (clip && clip !== lastClipboardWrite && clip !== ring.head()) {
        ring.push(clip);
    }
    lastClipboardWrite = clip;
}

async function writeHeadToClipboard(): Promise<void> {
    const head = ring.head() ?? '';
    lastClipboardWrite = head;
    await vscode.env.clipboard.writeText(head);
}

/**
 * Put text on the kill ring and the system clipboard as a new entry.
 * Use this for kills and copies that are not deleted from a contiguous
 * range at the cursor (subtrees, blocks, bibtex entries, ...).
 */
export async function pushKill(text: string): Promise<void> {
    await syncFromClipboard();
    ring.push(text);
    lastKill = undefined;
    await writeHeadToClipboard();
}

/**
 * Delete a range and put its text on the kill ring. Consecutive kills at the
 * same spot with no edit in between join into one entry: forward kills
 * append, backward kills prepend (so C-k C-k C-k yanks back as one piece).
 */
export async function killRange(
    editor: vscode.TextEditor,
    range: vscode.Range,
    direction: 'forward' | 'backward' = 'forward'
): Promise<void> {
    const document = editor.document;
    const text = document.getText(range);
    if (!text) return;

    const uri = document.uri.toString();
    let mode: KillMode = 'new';
    if (lastKill && lastKill.uri === uri && lastKill.version === document.version) {
        const anchor = direction === 'forward' ? range.start : range.end;
        if (document.offsetAt(anchor) === lastKill.offset) {
            mode = direction === 'forward' ? 'append' : 'prepend';
        }
    }

    await syncFromClipboard();
    ring.push(text, mode);
    await writeHeadToClipboard();

    const ok = await editor.edit(editBuilder => editBuilder.delete(range));
    lastKill = ok
        ? { uri, version: document.version, offset: document.offsetAt(range.start) }
        : undefined;
}

/**
 * Insert text at every cursor (replacing selections) and remember the
 * inserted ranges for yank-pop.
 */
async function insertForYank(editor: vscode.TextEditor, text: string): Promise<void> {
    const document = editor.document;
    const ok = await editor.edit(editBuilder => {
        for (const sel of editor.selections) {
            editBuilder.replace(sel, text);
        }
    });
    if (!ok) return;

    // After the edit each cursor sits at the end of its inserted text
    const ranges = editor.selections.map(sel => {
        const end = sel.active;
        const start = document.positionAt(document.offsetAt(end) - text.length);
        return new vscode.Range(start, end);
    });
    lastYank = { uri: document.uri.toString(), version: document.version, ranges };
    lastKill = undefined;
}

function yankStillValid(editor: vscode.TextEditor): boolean {
    if (!lastYank) return false;
    const document = editor.document;
    if (lastYank.uri !== document.uri.toString() || lastYank.version !== document.version) {
        return false;
    }
    const sels = editor.selections;
    return sels.length === lastYank.ranges.length &&
        sels.every((sel, i) => sel.isEmpty && sel.active.isEqual(lastYank!.ranges[i].end));
}

/**
 * Yank (C-y): insert the entry under the yank pointer.
 */
async function yank(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    await syncFromClipboard();
    const text = ring.current();
    if (text === undefined) {
        vscode.window.setStatusBarMessage('Kill ring is empty', 2000);
        return;
    }
    deactivateMark();
    await insertForYank(editor, text);
}

/**
 * Yank-pop (M-y): right after a yank, replace the yanked text with the next
 * older kill. Otherwise, pick an entry from the kill ring to insert.
 */
async function yankPop(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (!yankStillValid(editor)) {
        await browseKillRing();
        return;
    }

    const text = ring.rotate(1);
    if (text === undefined) return;

    const ranges = lastYank!.ranges;
    const document = editor.document;
    const ok = await editor.edit(editBuilder => {
        for (const range of ranges) {
            editBuilder.replace(range, text);
        }
    });
    if (!ok) return;

    const newRanges = editor.selections.map(sel => {
        const end = sel.active;
        return new vscode.Range(document.positionAt(document.offsetAt(end) - text.length), end);
    });
    editor.selections = newRanges.map(r => new vscode.Selection(r.end, r.end));
    lastYank = { uri: document.uri.toString(), version: document.version, ranges: newRanges };
    vscode.window.setStatusBarMessage(`Kill ring: ${ring.pointer + 1}/${ring.length}`, 2000);
}

function previewLabel(text: string): string {
    const oneLine = text.replace(/\r?\n/g, ' ⏎ ').replace(/\t/g, ' ');
    return oneLine.length > 120 ? oneLine.slice(0, 117) + '...' : oneLine;
}

interface KillItem extends vscode.QuickPickItem {
    index: number;
}

/**
 * Show the kill ring in a filterable picker; Enter inserts the chosen entry
 * and points the yank pointer at it. The trash button removes an entry.
 */
async function browseKillRing(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    await syncFromClipboard();
    if (ring.length === 0) {
        vscode.window.setStatusBarMessage('Kill ring is empty', 2000);
        return;
    }

    const removeButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('trash'),
        tooltip: 'Remove from kill ring'
    };

    const makeItems = (): KillItem[] => ring.entries().map((text, index) => {
        const lines = text.split(/\r?\n/).length;
        return {
            label: previewLabel(text),
            description: `${index + 1}${index === ring.pointer ? ' (current)' : ''}`,
            detail: lines > 1 ? `${lines} lines` : undefined,
            buttons: [removeButton],
            index
        };
    });

    const qp = vscode.window.createQuickPick<KillItem>();
    qp.title = 'Kill Ring';
    qp.placeholder = editor ? 'Select a kill to insert' : 'Kill ring entries';
    qp.matchOnDetail = false;
    qp.items = makeItems();

    const chosen = await new Promise<KillItem | undefined>(resolve => {
        let picked: KillItem | undefined;
        qp.onDidTriggerItemButton(e => {
            ring.remove(e.item.index);
            if (ring.length === 0) {
                qp.hide();
                return;
            }
            qp.items = makeItems();
        });
        qp.onDidAccept(() => {
            picked = qp.selectedItems[0];
            qp.hide();
        });
        qp.onDidHide(() => {
            qp.dispose();
            resolve(picked);
        });
        qp.show();
    });

    if (!chosen || !editor) return;
    ring.setPointer(chosen.index);
    deactivateMark();
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    await insertForYank(editor, ring.current()!);
}

/**
 * Kill region (C-w): delete the selection(s) onto the kill ring.
 */
async function killRegion(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selections = editor.selections.filter(sel => !sel.isEmpty);
    if (selections.length === 0) return;
    deactivateMark();

    if (selections.length === 1) {
        const sel = selections[0];
        await killRange(editor, sel, sel.isReversed ? 'backward' : 'forward');
        return;
    }

    // Several cursors: one entry holding every selection, like VS Code's cut
    const sorted = [...selections].sort((a, b) => a.start.compareTo(b.start));
    await pushKill(sorted.map(sel => editor.document.getText(sel)).join('\n'));
    await editor.edit(editBuilder => {
        for (const sel of sorted) editBuilder.delete(sel);
    });
}

/**
 * Copy region (M-w): put the selection(s) on the kill ring without deleting.
 */
async function copyRegion(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selections = editor.selections.filter(sel => !sel.isEmpty);
    if (selections.length === 0) return;

    const sorted = [...selections].sort((a, b) => a.start.compareTo(b.start));
    await pushKill(sorted.map(sel => editor.document.getText(sel)).join('\n'));
    deactivateMark();
    vscode.window.setStatusBarMessage('Copied to kill ring', 1500);
}

function clearKillRing(): void {
    ring.clear();
    lastKill = undefined;
    lastYank = undefined;
    vscode.window.setStatusBarMessage('Kill ring cleared', 2000);
}

export function registerKillRingCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.killRing.yank', yank),
        vscode.commands.registerCommand('scimax.killRing.yankPop', yankPop),
        vscode.commands.registerCommand('scimax.killRing.killRegion', killRegion),
        vscode.commands.registerCommand('scimax.killRing.copyRegion', copyRegion),
        vscode.commands.registerCommand('scimax.killRing.browse', browseKillRing),
        vscode.commands.registerCommand('scimax.killRing.clear', clearKillRing)
    );
}
