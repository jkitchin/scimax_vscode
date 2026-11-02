import * as vscode from 'vscode';
import { pushKill, killRingHead } from './commands';

/**
 * Auto-copy: text you highlight with the mouse is copied to the clipboard
 * (and the kill ring), like copy-on-select in a terminal.
 *
 * Only mouse selections count, so shift-arrow or C-SPC regions are left alone
 * and selecting text with the keyboard to paste over it still works. The copy
 * waits until the selection stops changing, so a drag copies once, at the end.
 * A notification shows what was copied (`scimax.autoCopy.notify`).
 * Turn it off with `scimax.autoCopy.enabled` or `scimax.autoCopy.toggle`.
 */

const SETTLE_MS = 250;
const NOTIFY_MS = 2000;
const PREVIEW_CHARS = 60;

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('scimax.autoCopy').get<boolean>('enabled', true);
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
    if (!vscode.workspace.getConfiguration('scimax.autoCopy').get<boolean>('notify', true)) return;
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

export function registerAutoCopy(context: vscode.ExtensionContext): void {
    let timer: ReturnType<typeof setTimeout> | undefined;

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
            if (timer) clearTimeout(timer);
            if (!isEnabled()) return;

            const editor = e.textEditor;
            timer = setTimeout(async () => {
                timer = undefined;
                // Read the selection now: it may have moved on since the event
                const text = selectedText(editor.document, editor.selections);
                if (!text.trim() || text === killRingHead()) return;
                await pushKill(text);
                notifyCopied(text);
            }, SETTLE_MS);
        }),

        vscode.commands.registerCommand('scimax.autoCopy.toggle', async () => {
            const config = vscode.workspace.getConfiguration('scimax.autoCopy');
            const next = !isEnabled();
            await config.update('enabled', next, vscode.ConfigurationTarget.Global);
            vscode.window.setStatusBarMessage(`Auto-copy ${next ? 'on' : 'off'}`, 2000);
        }),

        { dispose: () => { if (timer) clearTimeout(timer); } }
    );
}
