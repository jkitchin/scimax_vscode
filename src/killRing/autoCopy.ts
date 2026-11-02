import * as vscode from 'vscode';
import { pushKill, killRingHead } from './commands';

/**
 * Auto-copy: text you highlight with the mouse is copied to the clipboard
 * (and the kill ring), like copy-on-select in a terminal.
 *
 * Only mouse selections count, so shift-arrow or C-SPC regions are left alone
 * and selecting text with the keyboard to paste over it still works. The copy
 * waits until the selection stops changing, so a drag copies once, at the end.
 * Turn it off with `scimax.autoCopy.enabled` or `scimax.autoCopy.toggle`.
 */

const SETTLE_MS = 250;

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('scimax.autoCopy').get<boolean>('enabled', true);
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
                vscode.window.setStatusBarMessage(`Auto-copied ${text.length} characters`, 1500);
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
