/**
 * VS Code commands for markdown export via pandoc
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { exportMarkdown, MarkdownExportFormat, PdfEngine, PdfExportOptions } from './markdownExport';
import { isMarpText } from '../marp/slideRenderer';
import { previewedMarkdownDocument } from './previewSource';

/**
 * Get the content and file path of the active markdown editor, or of the file
 * shown in the active Markdown preview. Returns undefined if there is neither.
 */
async function getActiveMarkdown(): Promise<{ content: string; filePath: string } | undefined> {
    const document = vscode.window.activeTextEditor?.document ?? await previewedMarkdownDocument();
    if (!document) {
        vscode.window.showWarningMessage('No active editor');
        return undefined;
    }
    if (document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Active file is not a Markdown document');
        return undefined;
    }
    if (document.isUntitled) {
        vscode.window.showWarningMessage('Please save the file before exporting');
        return undefined;
    }
    return {
        content: document.getText(),
        filePath: document.uri.fsPath,
    };
}

/**
 * Read the PDF engine and body font from the scimax.markdown.export settings.
 */
function loadPdfOptions(): PdfExportOptions {
    const config = vscode.workspace.getConfiguration('scimax.markdown.export');
    return {
        engine: config.get<PdfEngine>('pdfEngine', 'xelatex'),
        mainFont: config.get<string>('mainFont', ''),
    };
}

/**
 * Export the active markdown file to the given format and optionally open the result.
 */
async function doExport(format: MarkdownExportFormat, open: boolean): Promise<void> {
    const md = await getActiveMarkdown();
    if (!md) {
        return;
    }

    try {
        const { outPath, missingCharacters } = await exportMarkdown(
            md.content, md.filePath, format, undefined, loadPdfOptions());
        const basename = path.basename(outPath);
        if (missingCharacters.length > 0) {
            vscode.window.showWarningMessage(
                `Exported to ${basename}, but the font has no ${missingCharacters.join(' ')}, ` +
                'so they are missing from the PDF. Choose a font that has them in scimax.markdown.export.mainFont.');
        } else {
            vscode.window.showInformationMessage(`Exported to ${basename}`);
        }

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
        // The PDF button on the Markdown preview: a Marp deck exports its slides.
        vscode.commands.registerCommand('scimax.markdown.preview.exportPdf', async () => {
            const document = await previewedMarkdownDocument() ?? vscode.window.activeTextEditor?.document;
            if (document && isMarpText(document.getText())) {
                return vscode.commands.executeCommand('scimax.marp.exportPdf');
            }
            return doExport('pdf', true);
        }),
        vscode.commands.registerCommand('scimax.markdown.exportMenu', async () => {
            // Marp decks get the slide export menu, which links back to this one.
            const document = vscode.window.activeTextEditor?.document ?? await previewedMarkdownDocument();
            const menu = document && isMarpText(document.getText()) ? 'scimax.marp.export' : 'scimax.markdown.export';
            return vscode.commands.executeCommand('scimax.hydra.show', menu);
        }),
    );
}
