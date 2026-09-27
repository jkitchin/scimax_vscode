/**
 * Marp slide navigation between the Markdown source and its preview.
 *
 * Preview -> source is handled by the preview script media/marp/marpPreview.js
 * (double-click a slide). This module covers source -> preview.
 */

import * as vscode from 'vscode';

/** Webview tabs of the built-in Markdown preview have a viewType ending in this. */
const MARKDOWN_PREVIEW_VIEW_TYPE = 'markdown.preview';

/**
 * Longer than the built-in preview's 50 ms debounce of the editor's top line,
 * so a nudge and the final reveal are seen as two separate scroll positions.
 */
const NUDGE_DELAY_MS = 80;

/** Time for the editor's visible ranges to reflect a reveal. */
const SETTLE_DELAY_MS = 30;

function isMarkdownPreviewTab(tab: vscode.Tab | undefined): boolean {
    return tab?.input instanceof vscode.TabInputWebview
        && tab.input.viewType.endsWith(MARKDOWN_PREVIEW_VIEW_TYPE);
}

function hasVisibleMarkdownPreview(): boolean {
    return vscode.window.tabGroups.all.some(group => isMarkdownPreviewTab(group.activeTab));
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scroll the Markdown preview to the cursor line.
 *
 * The built-in preview has no command for this, but it follows the editor's
 * top visible line ("markdown.preview.scrollPreviewWithEditor"). So the cursor
 * line is made the editor's first visible line and the preview scrolls with it.
 * If that line is already at the top, no scroll event would fire, so the editor
 * is nudged by one line first.
 */
async function revealInPreview(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showInformationMessage('Reveal in preview works in a Markdown editor.');
        return;
    }

    const scrollSync = vscode.workspace
        .getConfiguration('markdown', editor.document.uri)
        .get<boolean>('preview.scrollPreviewWithEditor', true);
    if (!scrollSync) {
        vscode.window.showWarningMessage(
            'Reveal in preview needs "markdown.preview.scrollPreviewWithEditor" to be enabled.'
        );
        return;
    }

    const line = editor.selection.active.line;

    if (!hasVisibleMarkdownPreview()) {
        await vscode.commands.executeCommand('markdown.showPreviewToSide');
        // Opening the preview moves focus to it; return to the editor.
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    }

    if (editor.visibleRanges[0]?.start.line === line) {
        const lastLine = editor.document.lineCount - 1;
        await scrollToTop(editor, line < lastLine ? line + 1 : Math.max(0, line - 1));
        await delay(NUDGE_DELAY_MS);
    }
    await scrollToTop(editor, line);
}

/**
 * Make `line` the editor's first visible line. revealRange(AtTop) leaves a few
 * lines of context (more with sticky scroll) above the target, and the preview
 * follows the first visible line, so scroll the difference away.
 */
async function scrollToTop(editor: vscode.TextEditor, line: number): Promise<void> {
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
    await delay(SETTLE_DELAY_MS);
    const top = editor.visibleRanges[0]?.start.line ?? line;
    if (top < line) {
        await vscode.commands.executeCommand('editorScroll', { to: 'down', by: 'line', value: line - top });
    }
}

export function registerMarpCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.marp.revealInPreview', revealInPreview)
    );
}
