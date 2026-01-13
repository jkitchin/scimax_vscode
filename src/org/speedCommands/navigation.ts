/**
 * Speed Command Navigation Functions
 *
 * Sibling navigation and other navigation helpers.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';

/**
 * Navigate to the next sibling heading (same level)
 */
export async function nextSiblingHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentLevel = getHeadingLevel(document, currentLine);

    if (currentLevel === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    // Search forward for heading at same level
    for (let i = currentLine + 1; i < document.lineCount; i++) {
        const level = getHeadingLevel(document, i);
        if (level === currentLevel) {
            // Found sibling
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
        if (level > 0 && level < currentLevel) {
            // Hit a parent heading, stop
            vscode.window.showInformationMessage('No next sibling');
            return;
        }
    }

    vscode.window.showInformationMessage('No next sibling');
}

/**
 * Navigate to the previous sibling heading (same level)
 */
export async function previousSiblingHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentLevel = getHeadingLevel(document, currentLine);

    if (currentLevel === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    // Search backward for heading at same level
    for (let i = currentLine - 1; i >= 0; i--) {
        const level = getHeadingLevel(document, i);
        if (level === currentLevel) {
            // Found sibling
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
        if (level > 0 && level < currentLevel) {
            // Hit a parent heading, stop
            vscode.window.showInformationMessage('No previous sibling');
            return;
        }
    }

    vscode.window.showInformationMessage('No previous sibling');
}

/**
 * Navigate to the first heading in the document
 */
export async function firstHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;

    for (let i = 0; i < document.lineCount; i++) {
        const level = getHeadingLevel(document, i);
        if (level > 0) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No headings found');
}

/**
 * Navigate to the last heading in the document
 */
export async function lastHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;

    for (let i = document.lineCount - 1; i >= 0; i--) {
        const level = getHeadingLevel(document, i);
        if (level > 0) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No headings found');
}
