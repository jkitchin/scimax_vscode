/**
 * Editing a Marp deck's document: replace its text with new text as one
 * edit that touches only the part that changed (so one undo reverses it and
 * the rest of the file, and its undo history, is untouched), and find the
 * slides an editor's cursor or selection is on.
 */

import * as vscode from 'vscode';
import { slideStarts } from './slideRenderer';
import { Deck, parseDeck, slideAtLine } from './slideModel';

export function parseDocument(document: vscode.TextDocument): Deck {
    const text = document.getText();
    return parseDeck(text, slideStarts(text));
}

/** Replace `oldText` (the document's current text) with `newText`, rewriting only what differs. */
export async function replaceDocumentText(document: vscode.TextDocument, oldText: string, newText: string): Promise<boolean> {
    if (newText === oldText) {
        return false;
    }
    let prefix = 0;
    const maxPrefix = Math.min(oldText.length, newText.length);
    while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) {
        prefix++;
    }
    let suffix = 0;
    const maxSuffix = maxPrefix - prefix;
    while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) {
        suffix++;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(prefix), document.positionAt(oldText.length - suffix)),
        newText.slice(prefix, newText.length - suffix)
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
        vscode.window.showWarningMessage('Could not edit the slides.');
        return false;
    }
    return true;
}

/** The slides the editor's selections touch (the one under the cursor when nothing is selected). */
export function slidesInSelection(editor: vscode.TextEditor, deck = parseDocument(editor.document)): number[] {
    const indices = new Set<number>();
    for (const selection of editor.selections) {
        const first = slideAtLine(deck.slides, selection.start.line);
        const last = slideAtLine(deck.slides, selection.end.line);
        for (let i = first; i <= last; i++) {
            if (i >= 0) {
                indices.add(i);
            }
        }
    }
    return [...indices].sort((a, b) => a - b);
}
