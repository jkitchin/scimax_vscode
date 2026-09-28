/**
 * The Marp deck the slide thumbnails and preview are showing, for commands
 * run from their context menu when the deck is not the active editor.
 */

import type * as vscode from 'vscode';

let current: (() => vscode.TextDocument | undefined) | undefined;

/** Called once by the slide views to share their current deck. */
export function setCurrentDeckSource(source: () => vscode.TextDocument | undefined): void {
    current = source;
}

export function currentMarpDeck(): vscode.TextDocument | undefined {
    return current?.();
}
