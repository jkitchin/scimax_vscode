/**
 * VS Code commands for markdown export via pandoc
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { exportMarkdown, MarkdownExportFormat } from './markdownExport';

/**
 * Get the active markdown editor content and file path.
 * Returns undefined if no markdown file is active.
 */
function getActiveMarkdown(): { content: string; filePath: string } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return undefined;
    }
    if (editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Active file is not a Markdown document');
        return undefined;
    }
    if (editor.document.isUntitled) {
        vscode.window.showWarningMessage('Please save the file before exporting');
        return undefined;
    }
    return {
        content: editor.document.getText(),
        filePath: editor.document.uri.fsPath,
    };
}

/**
 * Export the active markdown file to the given format and optionally open the result.
 */
async function doExport(format: MarkdownExportFormat, open: boolean): Promise<void> {
    const md = getActiveMarkdown();
    if (!md) {
        return;
    }

    try {
        const outPath = await exportMarkdown(md.content, md.filePath, format);
        const basename = path.basename(outPath);
        vscode.window.showInformationMessage(`Exported to ${basename}`);

        if (open) {
            const uri = vscode.Uri.file(outPath);
            if (format === 'html') {
                await vscode.env.openExternal(uri);
            } else if (format === 'pdf' || format === 'docx') {
                await vscode.env.openExternal(uri);
            } else {
                // LaTeX - open in editor
                await vscode.window.showTextDocument(uri);
            }
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Markdown export failed: ${err.message}`);
    }
}

/**
 * Register all markdown export commands
 */
export function registerMarkdownExportCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.markdown.exportHtml', () => doExport('html', false)),
        vscode.commands.registerCommand('scimax.markdown.exportHtmlOpen', () => doExport('html', true)),
        vscode.commands.registerCommand('scimax.markdown.exportPdf', () => doExport('pdf', false)),
        vscode.commands.registerCommand('scimax.markdown.exportPdfOpen', () => doExport('pdf', true)),
        vscode.commands.registerCommand('scimax.markdown.exportDocx', () => doExport('docx', false)),
        vscode.commands.registerCommand('scimax.markdown.exportDocxOpen', () => doExport('docx', true)),
        vscode.commands.registerCommand('scimax.markdown.exportLatex', () => doExport('latex', false)),
        vscode.commands.registerCommand('scimax.markdown.exportLatexOpen', () => doExport('latex', true)),
        vscode.commands.registerCommand('scimax.markdown.exportMenu', () => {
            return vscode.commands.executeCommand('scimax.hydra.show', 'scimax.markdown.export');
        }),
    );
}
