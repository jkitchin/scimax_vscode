import * as vscode from 'vscode';
import { isInTable, alignTable } from '../org/tableProvider';

/**
 * Toggle checkbox on current line, or align table if in a table
 * Converts [ ] to [x] and vice versa
 */
export async function toggleCheckbox(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Check if we're in a table first - C-c C-c aligns the table
    if (isInTable(document, position)) {
        await alignTable();
        return;
    }

    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Match checkbox patterns: - [ ], - [x], - [X], * [ ], * [x], etc.
    const checkboxPattern = /^(\s*[-*+]\s*)\[([ xX])\](.*)$/;
    const match = lineText.match(checkboxPattern);

    if (match) {
        const prefix = match[1];
        const currentState = match[2];
        const suffix = match[3];

        // Toggle the state
        const newState = (currentState === ' ') ? 'x' : ' ';
        const newLine = `${prefix}[${newState}]${suffix}`;

        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });
    }
}

/**
 * Toggle checkbox at a specific position (for click handling)
 */
export async function toggleCheckboxAt(uri: vscode.Uri, line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    const lineObj = document.lineAt(line);
    const lineText = lineObj.text;

    const checkboxPattern = /^(\s*[-*+]\s*)\[([ xX])\](.*)$/;
    const match = lineText.match(checkboxPattern);

    if (match) {
        const prefix = match[1];
        const currentState = match[2];
        const suffix = match[3];

        const newState = (currentState === ' ') ? 'x' : ' ';
        const newLine = `${prefix}[${newState}]${suffix}`;

        await editor.edit(editBuilder => {
            editBuilder.replace(lineObj.range, newLine);
        });
    }
}

/**
 * Document link provider for checkboxes
 * Makes the [ ] or [x] clickable
 */
export class CheckboxLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            if (token.isCancellationRequested) break;

            const line = document.lineAt(i);
            const lineText = line.text;

            // Find checkbox in line
            const checkboxMatch = lineText.match(/^(\s*[-*+]\s*)\[([ xX])\]/);
            if (checkboxMatch) {
                // Calculate position of the checkbox brackets
                const bracketStart = checkboxMatch[1].length;
                const bracketEnd = bracketStart + 3; // [x] is 3 chars

                const range = new vscode.Range(
                    new vscode.Position(i, bracketStart),
                    new vscode.Position(i, bracketEnd)
                );

                const link = new vscode.DocumentLink(range);
                const state = checkboxMatch[2] === ' ' ? 'unchecked' : 'checked';
                link.tooltip = `Click to ${state === 'unchecked' ? 'check' : 'uncheck'}`;

                // Use command URI to toggle - use org version for org files
                const args = encodeURIComponent(JSON.stringify({
                    uri: document.uri.toString(),
                    line: i
                }));
                const command = document.languageId === 'org'
                    ? 'scimax.org.toggleCheckboxAt'
                    : 'scimax.markdown.toggleCheckboxAt';
                link.target = vscode.Uri.parse(`command:${command}?${args}`);

                links.push(link);
            }
        }

        return links;
    }
}

/**
 * Register checkbox commands and providers
 */
export function registerCheckboxFeatures(context: vscode.ExtensionContext): void {
    // Register toggle command (for keybinding)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.markdown.toggleCheckbox', toggleCheckbox)
    );

    // Register toggle at position command (for click)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.markdown.toggleCheckboxAt', async (args: { uri: string; line: number }) => {
            const uri = vscode.Uri.parse(args.uri);
            await toggleCheckboxAt(uri, args.line);
        })
    );

    // Register document link provider for markdown
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            { language: 'markdown', scheme: 'file' },
            new CheckboxLinkProvider()
        )
    );

    // Also register for org-mode (org has similar checkbox syntax)
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            { language: 'org', scheme: 'file' },
            new CheckboxLinkProvider()
        )
    );
}
