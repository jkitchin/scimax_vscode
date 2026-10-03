/**
 * Context keys for keybinding `when` clauses.
 *
 * setContext is a round trip to the renderer, and the cursor trackers set the
 * same keys on every cursor move, so only changed values are sent.
 */

import * as vscode from 'vscode';

const current = new Map<string, unknown>();

export function setContextKey(key: string, value: unknown): void {
    if (current.has(key) && current.get(key) === value) return;
    current.set(key, value);
    void vscode.commands.executeCommand('setContext', key, value);
}

/**
 * Run `update` on cursor moves, on switching editors and once now, so keys are
 * right as soon as a file opens rather than after the first cursor move.
 */
export function trackEditorContext(
    context: vscode.ExtensionContext,
    update: (editor: vscode.TextEditor | undefined) => void
): void {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => update(e.textEditor)),
        vscode.window.onDidChangeActiveTextEditor(editor => update(editor))
    );
    update(vscode.window.activeTextEditor);
}
