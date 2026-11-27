/**
 * Handing a task to the Claude Code extension.
 *
 * Claude Code has no command that accepts a prompt, but its URI handler
 * (`<scheme>://anthropic.claude-code/open?prompt=...`) opens a new chat with
 * the prompt filled in. The user reviews it and sends it.
 */

import * as vscode from 'vscode';

export const CLAUDE_CODE_ID = 'anthropic.claude-code';

/**
 * True when the Claude Code extension is installed. Otherwise tell the user
 * that `feature` needs it and offer to show the extension.
 */
export async function ensureClaudeCode(feature: string): Promise<boolean> {
    if (vscode.extensions.getExtension(CLAUDE_CODE_ID)) {
        return true;
    }
    const choice = await vscode.window.showInformationMessage(
        `${feature} needs the Claude Code extension.`,
        'Show Extension'
    );
    if (choice) {
        await vscode.commands.executeCommand('extension.open', CLAUDE_CODE_ID);
    }
    return false;
}

/** Open a new Claude Code chat with `prompt` filled in. */
export async function openClaudeCodeWithPrompt(prompt: string): Promise<void> {
    const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://${CLAUDE_CODE_ID}/open?prompt=${encodeURIComponent(prompt)}`);
    await vscode.env.openExternal(uri);
}
