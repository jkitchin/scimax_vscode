import * as vscode from 'vscode';
import { pushKill, killRingHead, retractKill } from './commands';

/**
 * Auto-copy: text you highlight with the mouse is copied to the clipboard
 * (and the kill ring), like copy-on-select in a terminal.
 *
 * Only mouse selections count, so shift-arrow or C-SPC regions are left alone
 * and selecting text with the keyboard to paste over it still works. The copy
 * waits until the selection stops changing, so a drag copies once, at the end.
 * A notification shows what was copied (`scimax.autoCopy.notify`).
 * Turn it off with `scimax.autoCopy.enabled` or `scimax.autoCopy.toggle`.
 *
 * Selecting text in order to delete it should not clobber the clipboard, so
 * when the auto-copied selection is then deleted (Backspace/Delete) or typed
 * over, the copy is undone: the ring entry is dropped and the previous
 * clipboard comes back (`scimax.autoCopy.undoOnDelete`). Cutting it (Cmd+X,
 * C-w) keeps the copy, as does moving the cursor or editing anything else.
 */

const SETTLE_MS = 250;
const NOTIFY_MS = 2000;
const PREVIEW_CHARS = 60;

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('scimax.autoCopy');
}

function isEnabled(): boolean {
    return config().get<boolean>('enabled', true);
}

/** One-line preview of copied text for the notification. */
export function copyPreview(text: string): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > PREVIEW_CHARS ? oneLine.slice(0, PREVIEW_CHARS - 1) + '…' : oneLine;
}

/**
 * Show a notification (lower right) that closes itself: a progress
 * notification goes away when its task resolves, unlike an information
 * message, which stays until it times out or is dismissed.
 */
function notifyCopied(text: string): void {
    if (!config().get<boolean>('notify', true)) return;
    void vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Copied: ${copyPreview(text)}` },
        () => new Promise<void>(resolve => setTimeout(resolve, NOTIFY_MS))
    );
}

/** The selected text, one selection per line for multiple cursors (as Cmd+C does). */
export function selectedText(document: vscode.TextDocument, selections: readonly vscode.Selection[]): string {
    return selections
        .filter(sel => !sel.isEmpty)
        .map(sel => document.getText(sel))
        .join(document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
}

/** The last auto-copy, while its selection is still in place and unedited. */
interface PendingCopy {
    document: vscode.TextDocument;
    version: number;
    ranges: vscode.Range[];
    text: string;
    clipboard: string;
}

function sameRanges(a: readonly vscode.Range[], b: readonly vscode.Range[]): boolean {
    return a.length === b.length && a.every((r, i) => r.isEqual(b[i]));
}

export function registerAutoCopy(context: vscode.ExtensionContext): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: PendingCopy | undefined;

    const setPending = (p: PendingCopy | undefined): void => {
        const had = pending !== undefined;
        pending = p;
        if (had !== (p !== undefined)) {
            void vscode.commands.executeCommand('setContext', 'scimax.autoCopy.justCopied', p !== undefined);
        }
    };

    /** Undo the pending auto-copy, if there is one. */
    const retract = async (): Promise<void> => {
        const p = pending;
        setPending(undefined);
        if (p && (await retractKill(p.text, p.clipboard))) {
            vscode.window.setStatusBarMessage('Auto-copy undone', 1500);
        }
    };

    const nonEmpty = (editor: vscode.TextEditor): vscode.Range[] =>
        editor.selections.filter(sel => !sel.isEmpty);

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            // The selection moved without an edit: the copy is kept for good.
            // (After an edit the document listener decides.)
            if (pending && (e.textEditor.document !== pending.document
                || (e.textEditor.document.version === pending.version
                    && !sameRanges(nonEmpty(e.textEditor), pending.ranges)))) {
                setPending(undefined);
            }

            if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
            if (timer) clearTimeout(timer);
            if (!isEnabled()) return;

            const editor = e.textEditor;
            timer = setTimeout(async () => {
                timer = undefined;
                // Read the selection now: it may have moved on since the event
                const text = selectedText(editor.document, editor.selections);
                if (!text.trim() || text === killRingHead()) return;
                const clipboard = await vscode.env.clipboard.readText();
                await pushKill(text);
                notifyCopied(text);
                if (config().get<boolean>('undoOnDelete', true)) {
                    setPending({
                        document: editor.document,
                        version: editor.document.version,
                        ranges: nonEmpty(editor),
                        text,
                        clipboard,
                    });
                }
            }, SETTLE_MS);
        }),

        vscode.workspace.onDidChangeTextDocument(e => {
            if (!pending || e.document !== pending.document || e.contentChanges.length === 0) return;
            const ranges = pending.ranges;
            // Typed over the selection (not pasted back over itself)
            const typedOver = e.contentChanges.some(c =>
                c.text !== '' && c.text !== pending!.text && ranges.some(r => r.isEqual(c.range)));
            if (typedOver) void retract();
            else setPending(undefined);
        }),

        // Backspace/Delete on the auto-copied selection (bound only while
        // scimax.autoCopy.justCopied is set): undo the copy, then delete.
        vscode.commands.registerCommand('scimax.autoCopy.deleteSelection', async (direction?: string) => {
            const editor = vscode.window.activeTextEditor;
            if (pending && editor && editor.document === pending.document
                && editor.document.version === pending.version
                && sameRanges(nonEmpty(editor), pending.ranges)) {
                await retract();
            } else {
                setPending(undefined);
            }
            await vscode.commands.executeCommand(direction === 'right' ? 'deleteRight' : 'deleteLeft');
        }),

        vscode.commands.registerCommand('scimax.autoCopy.toggle', async () => {
            const next = !isEnabled();
            await config().update('enabled', next, vscode.ConfigurationTarget.Global);
            vscode.window.setStatusBarMessage(`Auto-copy ${next ? 'on' : 'off'}`, 2000);
        }),

        { dispose: () => { if (timer) clearTimeout(timer); } }
    );
}
