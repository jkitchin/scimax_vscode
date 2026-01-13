/**
 * VS Code Export Dispatcher for Org-mode
 * Provides UI for exporting org documents to various formats
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parseOrgFast } from '../parser/orgExportParser';
import { exportToHtml, HtmlExportOptions } from '../parser/orgExportHtml';
import { exportToLatex, LatexExportOptions } from '../parser/orgExportLatex';
import type { ExportOptions } from '../parser/orgExport';
import type { OrgDocumentNode, HeadlineElement } from '../parser/orgElementTypes';

// Pre-promisified exec for PDF compilation
const execAsync = promisify(exec);

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

    // Get keywords directly from document keywords map
    if (doc.keywords) {
        if (doc.keywords.TITLE) options.title = doc.keywords.TITLE;
        if (doc.keywords.AUTHOR) options.author = doc.keywords.AUTHOR;
        if (doc.keywords.DATE) options.date = doc.keywords.DATE;
        if (doc.keywords.LANGUAGE) options.language = doc.keywords.LANGUAGE;
        if (doc.keywords.OPTIONS) parseOptionsLine(doc.keywords.OPTIONS, options);
    }

    // Also look for keywords in the document's section (preamble)
    if (doc.section?.children) {
        for (const elem of doc.section.children) {
            if (elem.type === 'keyword') {
                const keyword = (elem as any).properties?.key?.toUpperCase();
                const value = (elem as any).properties?.value;

                switch (keyword) {
                    case 'TITLE':
                        if (!options.title) options.title = value;
                        break;
                    case 'AUTHOR':
                        if (!options.author) options.author = value;
                        break;
                    case 'DATE':
                        if (!options.date) options.date = value;
                        break;
                    case 'LANGUAGE':
                        if (!options.language) options.language = value;
                        break;
                    case 'OPTIONS':
                        parseOptionsLine(value, options);
                        break;
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
 * Find headline boundaries at cursor position for subtree export
 * Returns the start and end line numbers of the headline subtree
 */
function findHeadlineBoundaries(
    content: string,
    cursorLine: number
): { startLine: number; endLine: number; level: number } | null {
    const lines = content.split('\n');

    // Find the headline at or before cursor
    let headlineStart = -1;
    let headlineLevel = 0;

    for (let i = cursorLine; i >= 0; i--) {
        const match = lines[i].match(/^(\*+)\s+/);
        if (match) {
            headlineStart = i;
            headlineLevel = match[1].length;
            break;
        }
    }

    if (headlineStart === -1) {
        return null;
    }

    // Find the end of this headline (next headline at same or higher level)
    let headlineEnd = lines.length - 1;
    for (let i = headlineStart + 1; i < lines.length; i++) {
        const match = lines[i].match(/^(\*+)\s+/);
        if (match && match[1].length <= headlineLevel) {
            headlineEnd = i - 1;
            break;
        }
    }

    return { startLine: headlineStart, endLine: headlineEnd, level: headlineLevel };
}

/**
 * Export to HTML format - runs in chunks to avoid blocking
 */
async function exportHtml(
    content: string,
    options: Partial<HtmlExportOptions>,
    bodyOnly: boolean
): Promise<string> {
    // Yield to event loop before starting
    await new Promise(resolve => setImmediate(resolve));

    console.log('Export: Parsing document...');
    const doc = parseOrgFast(content);
    console.log(`Export: Parsed ${doc.children.length} headlines`);

    // Yield after parsing
    await new Promise(resolve => setImmediate(resolve));

    const metadata = extractMetadata(doc);

    const htmlOptions: HtmlExportOptions = {
        ...metadata,
        ...options,
        bodyOnly,
    };

    // Yield before export
    await new Promise(resolve => setImmediate(resolve));

    console.log('Export: Converting to HTML...');
    const result = exportToHtml(doc, htmlOptions);
    console.log(`Export: Generated ${result.length} characters of HTML`);

    return result;
}

/**
 * Export to LaTeX format - runs in chunks to avoid blocking
 */
async function exportLatex(
    content: string,
    options: Partial<LatexExportOptions>,
    bodyOnly: boolean
): Promise<string> {
    // Yield to event loop before starting
    await new Promise(resolve => setImmediate(resolve));

    console.log('LaTeX Export: Parsing document...');
    const startParse = Date.now();
    const doc = parseOrgFast(content);
    console.log(`LaTeX Export: Parsed ${doc.children.length} headlines in ${Date.now() - startParse}ms`);

    // Yield after parsing
    await new Promise(resolve => setImmediate(resolve));

    const metadata = extractMetadata(doc);

    const latexOptions: LatexExportOptions = {
        ...metadata,
        ...options,
        bodyOnly,
    };

    // Yield before export
    await new Promise(resolve => setImmediate(resolve));

    console.log('LaTeX Export: Converting to LaTeX...');
    const startExport = Date.now();
    const result = exportToLatex(doc, latexOptions);
    console.log(`LaTeX Export: Generated ${result.length} characters in ${Date.now() - startExport}ms`);

    // Yield after export
    await new Promise(resolve => setImmediate(resolve));

    return result;
}

/**
 * Export to PDF via LaTeX
 */
async function exportPdf(
    content: string,
    options: Partial<LatexExportOptions>,
    outputPath: string
): Promise<void> {

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
    const doc = parseOrgFast(content);
    const lines: string[] = [];

    // Extract metadata
    const metadata = extractMetadata(doc);
    if (metadata.title) {
        lines.push(`# ${metadata.title}`, '');
    }
    if (metadata.author) {
        lines.push(`*${metadata.author}*`, '');
    }

    // Simple markdown conversion - uses fast parser's properties format
    function convertElement(elem: any, depth: number = 0): void {
        switch (elem.type) {
            case 'headline':
                const level = elem.properties?.level || 1;
                const title = elem.properties?.rawValue || '';
                lines.push(`${'#'.repeat(level)} ${title}`);
                // Process section content first
                if (elem.section?.children) {
                    for (const child of elem.section.children) {
                        convertElement(child, depth + 1);
                    }
                }
                // Then child headlines
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
                    const desc = obj.children?.[0]?.properties?.value || url;
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
        const boundaries = findHeadlineBoundaries(content, editor.selection.active.line);

        if (!boundaries) {
            vscode.window.showWarningMessage('No headline found at cursor');
            return;
        }

        // Extract subtree content
        const lines = content.split('\n').slice(boundaries.startLine, boundaries.endLine + 1);
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

    // Export dispatcher (C-c C-e style)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportDispatcher',
            exportDispatcher
        )
    );

    // Direct export commands for keybindings
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportLatexOpen',
            async () => {
                await quickExportPdf();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportHtmlOpen',
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'org') {
                    vscode.window.showWarningMessage('No org-mode file open');
                    return;
                }
                const content = editor.document.getText();
                const inputPath = editor.document.uri.fsPath;
                const outputPath = inputPath.replace(/\.org$/, '.html');
                try {
                    const html = await exportHtml(content, {}, false);
                    await fs.promises.writeFile(outputPath, html, 'utf-8');
                    await vscode.env.openExternal(vscode.Uri.file(outputPath));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`HTML export failed: ${message}`);
                }
            }
        )
    );
}

/**
 * Export dispatcher - org-mode style C-c C-e menu
 * Shows all export options in a single menu with keyboard hints
 */
async function exportDispatcher(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    // All export options in one menu with hints
    const exportOptions = [
        // HTML exports
        { label: '$(globe) [h h] HTML file', description: 'Export to .html file', value: 'html-file', keys: 'hh' },
        { label: '$(globe) [h o] HTML and open', description: 'Export to .html and open in browser', value: 'html-open', keys: 'ho' },
        { label: '$(preview) [h p] HTML preview', description: 'Preview HTML in VS Code', value: 'html-preview', keys: 'hp' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, value: '', keys: '' },
        // LaTeX exports
        { label: '$(file-text) [l l] LaTeX file', description: 'Export to .tex file', value: 'latex-file', keys: 'll' },
        { label: '$(file-pdf) [l p] PDF file', description: 'Export to PDF via LaTeX', value: 'pdf-file', keys: 'lp' },
        { label: '$(file-pdf) [l o] PDF and open', description: 'Export to PDF and open', value: 'pdf-open', keys: 'lo' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, value: '', keys: '' },
        // Markdown exports
        { label: '$(markdown) [m m] Markdown file', description: 'Export to .md file', value: 'md-file', keys: 'mm' },
        { label: '$(markdown) [m o] Markdown and open', description: 'Export to .md and open', value: 'md-open', keys: 'mo' },
    ];

    const selected = await vscode.window.showQuickPick(exportOptions.filter(o => o.label !== ''), {
        placeHolder: 'Select export format (type keys: hh, ho, hp, ll, lp, lo, mm, mo)',
        title: 'Org Export Dispatcher - C-c C-e',
        matchOnDescription: true,
    });

    if (!selected || !selected.value) return;

    const content = editor.document.getText();
    const inputPath = editor.document.uri.fsPath;

    try {
        switch (selected.value) {
            case 'html-file': {
                const outputPath = inputPath.replace(/\.org$/, '.html');
                const html = await exportHtml(content, {}, false);
                await fs.promises.writeFile(outputPath, html, 'utf-8');
                vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}`);
                break;
            }
            case 'html-open': {
                const outputPath = inputPath.replace(/\.org$/, '.html');
                const html = await exportHtml(content, {}, false);
                await fs.promises.writeFile(outputPath, html, 'utf-8');
                await vscode.env.openExternal(vscode.Uri.file(outputPath));
                break;
            }
            case 'html-preview': {
                await vscode.commands.executeCommand('scimax.org.previewHtml');
                break;
            }
            case 'latex-file': {
                await quickExportLatex();
                break;
            }
            case 'pdf-file': {
                const outputPath = inputPath.replace(/\.org$/, '.pdf');
                const totalStart = Date.now();
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Generating PDF...', cancellable: false },
                    async (progress) => {
                        progress.report({ message: 'Parsing and generating LaTeX...' });
                        const latexStart = Date.now();
                        const latex = await exportLatex(content, {}, false);
                        console.log(`PDF Export: LaTeX generation took ${Date.now() - latexStart}ms`);

                        progress.report({ message: 'Writing .tex file...' });
                        const texPath = outputPath.replace(/\.pdf$/, '.tex');
                        await fs.promises.writeFile(texPath, latex, 'utf-8');

                        const tempDir = path.dirname(outputPath);

                        progress.report({ message: 'Running pdflatex (pass 1)...' });
                        const pass1Start = Date.now();
                        await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texPath}"`, { cwd: tempDir, timeout: 60000 });
                        console.log(`PDF Export: pdflatex pass 1 took ${Date.now() - pass1Start}ms`);

                        progress.report({ message: 'Running pdflatex (pass 2)...' });
                        const pass2Start = Date.now();
                        await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texPath}"`, { cwd: tempDir, timeout: 60000 });
                        console.log(`PDF Export: pdflatex pass 2 took ${Date.now() - pass2Start}ms`);

                        // Clean up aux files
                        const baseName = path.basename(outputPath, '.pdf');
                        for (const ext of ['.aux', '.log', '.out', '.toc', '.tex']) {
                            try { await fs.promises.unlink(path.join(tempDir, baseName + ext)); } catch {}
                        }

                        console.log(`PDF Export: Total time ${Date.now() - totalStart}ms`);
                        vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}`);
                    }
                );
                break;
            }
            case 'pdf-open': {
                const outputPath = inputPath.replace(/\.org$/, '.pdf');
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Generating PDF...', cancellable: false },
                    async (progress) => {
                        progress.report({ message: 'Parsing document...' });
                        const latex = await exportLatex(content, {}, false);

                        progress.report({ message: 'Writing .tex file...' });
                        const texPath = outputPath.replace(/\.pdf$/, '.tex');
                        await fs.promises.writeFile(texPath, latex, 'utf-8');

                        progress.report({ message: 'Running pdflatex (pass 1)...' });
                        const tempDir = path.dirname(outputPath);

                        await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texPath}"`, { cwd: tempDir, timeout: 60000 });

                        progress.report({ message: 'Running pdflatex (pass 2)...' });
                        await execAsync(`pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texPath}"`, { cwd: tempDir, timeout: 60000 });

                        // Clean up aux files
                        const baseName = path.basename(outputPath, '.pdf');
                        for (const ext of ['.aux', '.log', '.out', '.toc', '.tex']) {
                            try { await fs.promises.unlink(path.join(tempDir, baseName + ext)); } catch {}
                        }

                        await vscode.env.openExternal(vscode.Uri.file(outputPath));
                    }
                );
                break;
            }
            case 'md-file': {
                await quickExportMarkdown();
                break;
            }
            case 'md-open': {
                await quickExportMarkdown();
                const outputPath = inputPath.replace(/\.org$/, '.md');
                const doc = await vscode.workspace.openTextDocument(outputPath);
                await vscode.window.showTextDocument(doc);
                break;
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
}
