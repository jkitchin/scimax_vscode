/**
 * VS Code Export Dispatcher for Org-mode
 * Provides UI for exporting org documents to various formats
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseOrg } from '../parser/orgParserUnified';
import { exportToHtml, HtmlExportOptions } from '../parser/orgExportHtml';
import { exportToLatex, LatexExportOptions } from '../parser/orgExportLatex';
import type { ExportOptions } from '../parser/orgExport';
import type { OrgDocumentNode, HeadlineElement } from '../parser/orgElementTypes';

/**
 * Export format options
 */
interface ExportFormat {
    id: string;
    label: string;
    description: string;
    extension: string;
    icon: string;
}

/**
 * Available export formats
 */
const EXPORT_FORMATS: ExportFormat[] = [
    {
        id: 'html',
        label: 'HTML',
        description: 'Export to HTML document',
        extension: '.html',
        icon: '$(globe)',
    },
    {
        id: 'html-body',
        label: 'HTML (body only)',
        description: 'Export HTML body without header/footer',
        extension: '.html',
        icon: '$(code)',
    },
    {
        id: 'latex',
        label: 'LaTeX',
        description: 'Export to LaTeX document',
        extension: '.tex',
        icon: '$(file-text)',
    },
    {
        id: 'latex-body',
        label: 'LaTeX (body only)',
        description: 'Export LaTeX body without preamble',
        extension: '.tex',
        icon: '$(file-code)',
    },
    {
        id: 'pdf',
        label: 'PDF (via LaTeX)',
        description: 'Export to PDF via LaTeX compilation',
        extension: '.pdf',
        icon: '$(file-pdf)',
    },
    {
        id: 'markdown',
        label: 'Markdown',
        description: 'Export to Markdown format',
        extension: '.md',
        icon: '$(markdown)',
    },
];

/**
 * Export scope options
 */
interface ExportScope {
    id: 'full' | 'subtree' | 'visible';
    label: string;
    description: string;
}

const EXPORT_SCOPES: ExportScope[] = [
    {
        id: 'full',
        label: 'Full document',
        description: 'Export the entire document',
    },
    {
        id: 'subtree',
        label: 'Current subtree',
        description: 'Export only the current headline and its children',
    },
    {
        id: 'visible',
        label: 'Visible content',
        description: 'Export only visible (non-folded) content',
    },
];

/**
 * Extract document metadata from keywords
 */
function extractMetadata(doc: OrgDocumentNode): Partial<ExportOptions> {
    const options: Partial<ExportOptions> = {};

    // Look for keywords in the document
    for (const child of doc.children || []) {
        if (child.type === 'section') {
            for (const elem of (child as any).children || []) {
                if (elem.type === 'keyword') {
                    const keyword = elem.properties?.key?.toUpperCase();
                    const value = elem.properties?.value;

                    switch (keyword) {
                        case 'TITLE':
                            options.title = value;
                            break;
                        case 'AUTHOR':
                            options.author = value;
                            break;
                        case 'DATE':
                            options.date = value;
                            break;
                        case 'LANGUAGE':
                            options.language = value;
                            break;
                        case 'OPTIONS':
                            // Parse OPTIONS line
                            parseOptionsLine(value, options);
                            break;
                    }
                }
            }
        }
    }

    return options;
}

/**
 * Parse #+OPTIONS: line
 */
function parseOptionsLine(value: string, options: Partial<ExportOptions>): void {
    if (!value) return;

    const parts = value.split(/\s+/);
    for (const part of parts) {
        const [key, val] = part.split(':');
        switch (key) {
            case 'toc':
                options.toc = val === 't' || val === 'yes' || (parseInt(val) > 0 ? parseInt(val) : false);
                break;
            case 'num':
                options.sectionNumbers = val === 't' || val === 'yes';
                break;
            case 'H':
                options.headlineLevel = parseInt(val) || 0;
                break;
        }
    }
}

/**
 * Find the headline at cursor position for subtree export
 */
function findHeadlineAtCursor(
    doc: OrgDocumentNode,
    line: number
): HeadlineElement | null {
    function searchHeadlines(elements: any[]): HeadlineElement | null {
        for (const elem of elements) {
            if (elem.type === 'headline') {
                const headline = elem as HeadlineElement;
                const startLine = headline.position?.start?.line ?? -1;
                const endLine = headline.position?.end?.line ?? Infinity;

                if (line >= startLine && line <= endLine) {
                    // Check children first for more specific match
                    if (headline.children && headline.children.length > 0) {
                        const childMatch = searchHeadlines(headline.children);
                        if (childMatch) return childMatch;
                    }
                    return headline;
                }
            }

            // Check children of sections, etc.
            if (elem.children) {
                const found = searchHeadlines(elem.children);
                if (found) return found;
            }
        }
        return null;
    }

    return searchHeadlines(doc.children || []);
}

/**
 * Export to HTML format
 */
async function exportHtml(
    content: string,
    options: Partial<HtmlExportOptions>,
    bodyOnly: boolean
): Promise<string> {
    const doc = parseOrg(content, { addPositions: true });
    const metadata = extractMetadata(doc);

    const htmlOptions: HtmlExportOptions = {
        ...metadata,
        ...options,
        bodyOnly,
    };

    return exportToHtml(doc, htmlOptions);
}

/**
 * Export to LaTeX format
 */
async function exportLatex(
    content: string,
    options: Partial<LatexExportOptions>,
    bodyOnly: boolean
): Promise<string> {
    const doc = parseOrg(content, { addPositions: true });
    const metadata = extractMetadata(doc);

    const latexOptions: LatexExportOptions = {
        ...metadata,
        ...options,
        bodyOnly,
    };

    return exportToLatex(doc, latexOptions);
}

/**
 * Export to PDF via LaTeX
 */
async function exportPdf(
    content: string,
    options: Partial<LatexExportOptions>,
    outputPath: string
): Promise<void> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // First generate LaTeX
    const latexContent = await exportLatex(content, options, false);

    // Write to temp file
    const tempDir = path.dirname(outputPath);
    const baseName = path.basename(outputPath, '.pdf');
    const texPath = path.join(tempDir, `${baseName}.tex`);

    await fs.promises.writeFile(texPath, latexContent, 'utf-8');

    // Compile with pdflatex
    try {
        // Run pdflatex twice for references
        await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texPath}"`, {
            cwd: tempDir,
            timeout: 60000,
        });
        await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texPath}"`, {
            cwd: tempDir,
            timeout: 60000,
        });
    } catch (error) {
        // Try to clean up
        const auxFiles = ['.aux', '.log', '.out', '.toc'];
        for (const ext of auxFiles) {
            try {
                await fs.promises.unlink(path.join(tempDir, `${baseName}${ext}`));
            } catch {
                // Ignore cleanup errors
            }
        }
        throw error;
    }

    // Clean up auxiliary files
    const auxFiles = ['.aux', '.log', '.out', '.toc', '.tex'];
    for (const ext of auxFiles) {
        try {
            await fs.promises.unlink(path.join(tempDir, `${baseName}${ext}`));
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Export to Markdown format
 */
async function exportMarkdown(
    content: string,
    _options: Partial<ExportOptions>
): Promise<string> {
    const doc = parseOrg(content, { addPositions: true });
    const lines: string[] = [];

    // Extract metadata
    const metadata = extractMetadata(doc);
    if (metadata.title) {
        lines.push(`# ${metadata.title}`, '');
    }
    if (metadata.author) {
        lines.push(`*${metadata.author}*`, '');
    }

    // Simple markdown conversion
    function convertElement(elem: any, depth: number = 0): void {
        switch (elem.type) {
            case 'headline':
                const level = elem.properties?.level || 1;
                const title = elem.properties?.title || '';
                lines.push(`${'#'.repeat(level)} ${title}`);
                if (elem.children) {
                    for (const child of elem.children) {
                        convertElement(child, depth + 1);
                    }
                }
                break;

            case 'section':
                if (elem.children) {
                    for (const child of elem.children) {
                        convertElement(child, depth);
                    }
                }
                break;

            case 'paragraph':
                const text = convertObjects(elem.children || []);
                lines.push(text, '');
                break;

            case 'src-block':
                const lang = elem.properties?.language || '';
                const code = elem.properties?.value || '';
                lines.push('```' + lang);
                lines.push(code);
                lines.push('```', '');
                break;

            case 'example-block':
                const example = elem.properties?.value || '';
                lines.push('```');
                lines.push(example);
                lines.push('```', '');
                break;

            case 'quote-block':
                if (elem.children) {
                    for (const child of elem.children) {
                        if (child.type === 'paragraph') {
                            const quoteText = convertObjects(child.children || []);
                            lines.push(`> ${quoteText}`, '');
                        }
                    }
                }
                break;

            case 'plain-list':
                if (elem.children) {
                    for (const item of elem.children) {
                        if (item.type === 'item') {
                            const bullet = elem.properties?.listType === 'ordered' ? '1.' : '-';
                            const itemText = convertObjects(item.children?.[0]?.children || []);
                            lines.push(`${bullet} ${itemText}`);
                        }
                    }
                    lines.push('');
                }
                break;

            case 'table':
                if (elem.children) {
                    let isFirst = true;
                    for (const row of elem.children) {
                        if (row.type === 'table-row' && row.properties?.rowType === 'standard') {
                            const cells = (row.children || [])
                                .map((cell: any) => convertObjects(cell.children || []))
                                .join(' | ');
                            lines.push(`| ${cells} |`);

                            if (isFirst) {
                                const separator = (row.children || [])
                                    .map(() => '---')
                                    .join(' | ');
                                lines.push(`| ${separator} |`);
                                isFirst = false;
                            }
                        }
                    }
                    lines.push('');
                }
                break;

            case 'horizontal-rule':
                lines.push('---', '');
                break;
        }
    }

    function convertObjects(objects: any[]): string {
        return objects.map((obj: any) => {
            switch (obj.type) {
                case 'plain-text':
                    return obj.properties?.value || '';
                case 'bold':
                    return `**${convertObjects(obj.children || [])}**`;
                case 'italic':
                    return `*${convertObjects(obj.children || [])}*`;
                case 'underline':
                    return `_${convertObjects(obj.children || [])}_`;
                case 'strike-through':
                    return `~~${convertObjects(obj.children || [])}~~`;
                case 'code':
                    return `\`${obj.properties?.value || ''}\``;
                case 'verbatim':
                    return `\`${obj.properties?.value || ''}\``;
                case 'link':
                    const url = obj.properties?.path || '';
                    const desc = convertObjects(obj.children || []) || url;
                    return `[${desc}](${url})`;
                default:
                    return obj.properties?.value || '';
            }
        }).join('');
    }

    for (const child of doc.children || []) {
        convertElement(child);
    }

    return lines.join('\n');
}

/**
 * Main export command - shows export dispatcher
 */
async function showExportDispatcher(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    if (editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('Not an org-mode file');
        return;
    }

    // Show format picker
    const formatItems = EXPORT_FORMATS.map(f => ({
        label: `${f.icon} ${f.label}`,
        description: f.description,
        format: f,
    }));

    const selectedFormat = await vscode.window.showQuickPick(formatItems, {
        placeHolder: 'Select export format',
        title: 'Org Export',
    });

    if (!selectedFormat) return;

    // Show scope picker
    const scopeItems = EXPORT_SCOPES.map(s => ({
        label: s.label,
        description: s.description,
        scope: s,
    }));

    const selectedScope = await vscode.window.showQuickPick(scopeItems, {
        placeHolder: 'Select export scope',
        title: 'Export Scope',
    });

    if (!selectedScope) return;

    // Get content to export
    let content = editor.document.getText();
    const options: Partial<ExportOptions> = {
        scope: selectedScope.scope.id,
    };

    // Handle subtree export
    if (selectedScope.scope.id === 'subtree') {
        const doc = parseOrg(content, { addPositions: true });
        const headline = findHeadlineAtCursor(doc, editor.selection.active.line);

        if (!headline) {
            vscode.window.showWarningMessage('No headline found at cursor');
            return;
        }

        // Extract subtree content
        const startLine = headline.position?.start?.line ?? 0;
        const endLine = headline.position?.end?.line ?? editor.document.lineCount;
        const lines = content.split('\n').slice(startLine, endLine + 1);
        content = lines.join('\n');
    }

    // Determine output path
    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath, '.org');
    const defaultOutputPath = path.join(inputDir, inputName + selectedFormat.format.extension);

    // Ask for output location
    const outputUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultOutputPath),
        filters: {
            [selectedFormat.format.label]: [selectedFormat.format.extension.slice(1)],
        },
        title: 'Save Export As',
    });

    if (!outputUri) return;

    const outputPath = outputUri.fsPath;

    // Perform export with progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Exporting to ${selectedFormat.format.label}...`,
            cancellable: false,
        },
        async () => {
            try {
                let result: string;

                switch (selectedFormat.format.id) {
                    case 'html':
                        result = await exportHtml(content, options, false);
                        await fs.promises.writeFile(outputPath, result, 'utf-8');
                        break;

                    case 'html-body':
                        result = await exportHtml(content, options, true);
                        await fs.promises.writeFile(outputPath, result, 'utf-8');
                        break;

                    case 'latex':
                        result = await exportLatex(content, options, false);
                        await fs.promises.writeFile(outputPath, result, 'utf-8');
                        break;

                    case 'latex-body':
                        result = await exportLatex(content, options, true);
                        await fs.promises.writeFile(outputPath, result, 'utf-8');
                        break;

                    case 'pdf':
                        await exportPdf(content, options, outputPath);
                        break;

                    case 'markdown':
                        result = await exportMarkdown(content, options);
                        await fs.promises.writeFile(outputPath, result, 'utf-8');
                        break;

                    default:
                        throw new Error(`Unknown format: ${selectedFormat.format.id}`);
                }

                // Show success message with option to open
                const action = await vscode.window.showInformationMessage(
                    `Exported to ${path.basename(outputPath)}`,
                    'Open',
                    'Open Folder'
                );

                if (action === 'Open') {
                    if (selectedFormat.format.id === 'pdf') {
                        // Open PDF externally
                        await vscode.env.openExternal(vscode.Uri.file(outputPath));
                    } else {
                        // Open in VS Code
                        const doc = await vscode.workspace.openTextDocument(outputPath);
                        await vscode.window.showTextDocument(doc);
                    }
                } else if (action === 'Open Folder') {
                    await vscode.env.openExternal(vscode.Uri.file(inputDir));
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Export failed: ${message}`);
            }
        }
    );
}

/**
 * Quick export to HTML
 */
async function quickExportHtml(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    const content = editor.document.getText();
    const inputPath = editor.document.uri.fsPath;
    const outputPath = inputPath.replace(/\.org$/, '.html');

    try {
        const result = await exportHtml(content, {}, false);
        await fs.promises.writeFile(outputPath, result, 'utf-8');
        vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
}

/**
 * Quick export to LaTeX
 */
async function quickExportLatex(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    const content = editor.document.getText();
    const inputPath = editor.document.uri.fsPath;
    const outputPath = inputPath.replace(/\.org$/, '.tex');

    try {
        const result = await exportLatex(content, {}, false);
        await fs.promises.writeFile(outputPath, result, 'utf-8');
        vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
}

/**
 * Quick export to PDF
 */
async function quickExportPdf(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    const content = editor.document.getText();
    const inputPath = editor.document.uri.fsPath;
    const outputPath = inputPath.replace(/\.org$/, '.pdf');

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Exporting to PDF...',
            cancellable: false,
        },
        async () => {
            try {
                await exportPdf(content, {}, outputPath);
                const action = await vscode.window.showInformationMessage(
                    `Exported to ${path.basename(outputPath)}`,
                    'Open'
                );
                if (action === 'Open') {
                    await vscode.env.openExternal(vscode.Uri.file(outputPath));
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`PDF export failed: ${message}`);
            }
        }
    );
}

/**
 * Quick export to Markdown
 */
async function quickExportMarkdown(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    const content = editor.document.getText();
    const inputPath = editor.document.uri.fsPath;
    const outputPath = inputPath.replace(/\.org$/, '.md');

    try {
        const result = await exportMarkdown(content, {});
        await fs.promises.writeFile(outputPath, result, 'utf-8');
        vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
}

/**
 * Preview HTML export in a webview panel
 */
async function previewHtml(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    const content = editor.document.getText();
    const fileName = path.basename(editor.document.uri.fsPath);

    try {
        const htmlContent = await exportHtml(content, {}, false);

        // Create webview panel
        const panel = vscode.window.createWebviewPanel(
            'orgHtmlPreview',
            `Preview: ${fileName}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        panel.webview.html = htmlContent;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Preview failed: ${message}`);
    }
}

/**
 * Register export commands
 */
export function registerExportCommands(context: vscode.ExtensionContext): void {
    // Main export dispatcher (C-c C-e equivalent)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.export',
            showExportDispatcher
        )
    );

    // Quick exports
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportHtml',
            quickExportHtml
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportLatex',
            quickExportLatex
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportPdf',
            quickExportPdf
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportMarkdown',
            quickExportMarkdown
        )
    );

    // HTML preview
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.previewHtml',
            previewHtml
        )
    );
}
