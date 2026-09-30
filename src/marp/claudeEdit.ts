/**
 * "Edit with Claude Code": open the Claude Code extension with a prompt that
 * names the deck and the slides to change, so you only type the change.
 *
 * Claude Code has no command that accepts a prompt, but its URI handler
 * (`<scheme>://anthropic.claude-code/open?prompt=...`) opens it with the
 * prompt filled in. You finish the sentence and send it; Claude Code edits the
 * file with its own tools.
 *
 * That handler always opens a new tab (given a session id it reuses the tab but
 * drops the prompt). So when a Claude Code tab is already open, we select the
 * slides and run `claude-vscode.insertAtMention`, which adds an
 * `@deck.md#Lstart-end` reference to the open chat's input instead.
 */

import * as vscode from 'vscode';
import { slideStarts, isMarpText } from './slideRenderer';
import { parseDeck } from './slideModel';
import { slidesInSelection } from './deckEdits';
import { slideEditPrompt, slideLineSpan } from './claudePrompt';

const CLAUDE_CODE_ID = 'anthropic.claude-code';
/** Claude Code's webview panel type; VS Code reports it with a prefix in tab inputs. */
const CLAUDE_PANEL_VIEW_TYPE = 'claudeVSCodePanel';

/** True when a Claude Code chat is open in an editor tab. */
function claudeCodeTabOpen(): boolean {
    return vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
        tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(CLAUDE_PANEL_VIEW_TYPE)));
}

/** Select lines `start`-`end` (0-based) of `document` and @-mention them in the open Claude Code chat. */
async function mentionInOpenChat(document: vscode.TextDocument, start: number, end: number): Promise<void> {
    const visible = vscode.window.visibleTextEditors.find(e => e.document === document);
    const editor = await vscode.window.showTextDocument(document, { viewColumn: visible?.viewColumn, preview: false });
    editor.selection = new vscode.Selection(start, 0, end, document.lineAt(end).text.length);
    editor.revealRange(editor.selection);
    await vscode.commands.executeCommand('claude-vscode.insertAtMention');
}

/** Open Claude Code with a prompt to edit slides `indices` (0-based) of `document`. */
export async function editSlidesWithClaudeCode(document: vscode.TextDocument, indices: number[]): Promise<void> {
    if (!vscode.extensions.getExtension(CLAUDE_CODE_ID)) {
        const choice = await vscode.window.showInformationMessage(
            'Edit with Claude Code needs the Claude Code extension.',
            'Show Extension'
        );
        if (choice) {
            await vscode.commands.executeCommand('extension.open', CLAUDE_CODE_ID);
        }
        return;
    }
    // Claude Code reads the file from disk.
    if (document.isDirty && !(await document.save())) {
        return;
    }
    const text = document.getText();
    const deck = parseDeck(text, slideStarts(text));
    if (indices.length === 0 || deck.slides.length === 0) {
        return;
    }
    const lines = text.split(/\r?\n/);
    const span = slideLineSpan(lines, deck.slides, indices);
    if (span && claudeCodeTabOpen()) {
        await mentionInOpenChat(document, span.start, span.end);
        return;
    }
    const prompt = slideEditPrompt(
        vscode.workspace.asRelativePath(document.uri, false),
        lines,
        deck.slides,
        indices
    );
    const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://${CLAUDE_CODE_ID}/open?prompt=${encodeURIComponent(prompt)}`);
    await vscode.env.openExternal(uri);
}

export function registerClaudeEditCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.marp.editSlideWithClaude', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown' || !isMarpText(editor.document.getText())) {
                vscode.window.showInformationMessage('Put the cursor on a slide in a Marp deck first.');
                return;
            }
            await editSlidesWithClaudeCode(editor.document, slidesInSelection(editor));
        })
    );
}
