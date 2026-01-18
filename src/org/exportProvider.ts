/**
 * VS Code Export Dispatcher for Org-mode
 * Provides UI for exporting org documents to various formats
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { parseOrgFast } from '../parser/orgExportParser';
import { exportToHtml, HtmlExportOptions } from '../parser/orgExportHtml';
import { exportToLatex, LatexExportOptions } from '../parser/orgExportLatex';
import { processIncludes, hasIncludes } from '../parser/orgInclude';
import { parseBibTeX } from '../references/bibtexParser';
import type { BibEntry } from '../references/bibtexParser';
import type { ExportOptions } from '../parser/orgExport';
import type { OrgDocumentNode, HeadlineElement } from '../parser/orgElementTypes';
import { isBodyOnlyMode } from '../hydra/menus/exportMenu';

/**
 * Execute a command using spawn (no shell, prevents command injection)
 * This is safer than exec() which interprets shell metacharacters
 */
function spawnAsync(
    command: string,
    args: string[],
    options: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            cwd: options.cwd,
            timeout: options.timeout,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const error = new Error(`Command failed with exit code ${code}: ${stderr}`);
                (error as any).code = code;
                (error as any).stdout = stdout;
                (error as any).stderr = stderr;
                reject(error);
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Delete output file if it exists before export
 * This ensures we don't have stale output files if export fails
 */
async function deleteExistingOutput(outputPath: string): Promise<void> {
    try {
        await fs.promises.unlink(outputPath);
    } catch {
        // File doesn't exist or can't be deleted - ignore
    }
}

/**
 * Preprocess content before export - handles #+INCLUDE: directives
 */
function preprocessContent(content: string, basePath: string): string {
    if (!hasIncludes(content)) {
        return content;
    }
    return processIncludes(content, {
        basePath,
        recursive: true,
        maxDepth: 10,
    });
}

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
 * Extract bibliography paths from document content
 */
function extractBibPaths(content: string, basePath: string): string[] {
    const paths: string[] = [];
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    // Match #+BIBLIOGRAPHY: path
    const bibKeywordRegex = /^#\+BIBLIOGRAPHY:\s*(.+?)\s*$/gm;
    let match;
    while ((match = bibKeywordRegex.exec(content)) !== null) {
        let bibPath = match[1].trim();
        // Remove any style options like "plain" at the end
        bibPath = bibPath.split(/\s+/)[0];
        if (!bibPath.endsWith('.bib')) {
            bibPath += '.bib';
        }
        paths.push(bibPath);
    }

    // Match [[bibliography:path]] links
    const bibLinkRegex = /\[\[bibliography:([^\]]+)\]\]/g;
    while ((match = bibLinkRegex.exec(content)) !== null) {
        let bibPath = match[1].trim();
        if (!bibPath.endsWith('.bib')) {
            bibPath += '.bib';
        }
        paths.push(bibPath);
    }

    // Match plain bibliography:path links (org-ref style)
    const plainBibRegex = /(?<!\[)bibliography:([^\s\[\]]+)/g;
    while ((match = plainBibRegex.exec(content)) !== null) {
        let bibPath = match[1].trim();
        if (!bibPath.endsWith('.bib')) {
            bibPath += '.bib';
        }
        paths.push(bibPath);
    }

    // Resolve paths
    return paths.map(p => {
        if (p.startsWith('~')) {
            return p.replace('~', homeDir);
        }
        if (path.isAbsolute(p)) {
            return p;
        }
        return path.resolve(basePath, p);
    });
}

/**
 * Load bibliography entries from paths
 */
async function loadBibEntries(bibPaths: string[]): Promise<BibEntry[]> {
    const entries: BibEntry[] = [];

    for (const bibPath of bibPaths) {
        try {
            const content = await fs.promises.readFile(bibPath, 'utf-8');
            const result = parseBibTeX(content);
            entries.push(...result.entries);
        } catch {
            // File doesn't exist or can't be read - skip silently
        }
    }

    return entries;
}

/**
 * Export to HTML format - runs in chunks to avoid blocking
 */
async function exportHtml(
    content: string,
    options: Partial<HtmlExportOptions>,
    bodyOnly: boolean,
    basePath?: string
): Promise<string> {
    // Yield to event loop before starting
    await new Promise(resolve => setImmediate(resolve));

    const doc = parseOrgFast(content);

    // Yield after parsing
    await new Promise(resolve => setImmediate(resolve));

    const metadata = extractMetadata(doc);

    // Load bibliography entries if basePath is provided
    let bibEntries: BibEntry[] = [];
    if (basePath) {
        const bibPaths = extractBibPaths(content, basePath);
        if (bibPaths.length > 0) {
            bibEntries = await loadBibEntries(bibPaths);
        }
    }

    const htmlOptions: HtmlExportOptions = {
        ...metadata,
        ...options,
        bodyOnly,
        bibEntries: bibEntries.length > 0 ? bibEntries : options.bibEntries,
    };

    // Yield before export
    await new Promise(resolve => setImmediate(resolve));

    const result = exportToHtml(doc, htmlOptions);

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

    const doc = parseOrgFast(content);

    // Yield after parsing
    await new Promise(resolve => setImmediate(resolve));

    const metadata = extractMetadata(doc);

    // Get LaTeX settings from VS Code configuration
    const config = vscode.workspace.getConfiguration('scimax.export.latex');
    const customHeader = options.customHeader || config.get<string>('customHeader');

    // Read default document class from settings (can be overridden by document keywords)
    const defaultDocumentClass = config.get<string>('documentClass', 'article');

    // Read default class options from settings (comma-separated string)
    const defaultClassOptionsStr = config.get<string>('classOptions', '12pt,letterpaper');
    const defaultClassOptions = defaultClassOptionsStr
        ? defaultClassOptionsStr.split(',').map(s => s.trim()).filter(s => s)
        : ['12pt', 'letterpaper'];

    // Read default preamble from settings
    const defaultPreamble = config.get<string>('defaultPreamble', '');

    const latexOptions: LatexExportOptions = {
        ...metadata,
        documentClass: defaultDocumentClass,
        classOptions: defaultClassOptions,
        preamble: defaultPreamble,
        ...options,
        customHeader,
        bodyOnly,
    };

    // Yield before export
    await new Promise(resolve => setImmediate(resolve));

    const result = exportToLatex(doc, latexOptions);

    // Yield after export
    await new Promise(resolve => setImmediate(resolve));

    return result;
}

/**
 * PDF compilation configuration
 */
interface PdfCompilerConfig {
    compiler: 'latexmk-lualatex' | 'latexmk-pdflatex' | 'latexmk-xelatex' | 'lualatex' | 'pdflatex' | 'xelatex';
    bibtexCommand: 'biber' | 'bibtex';
    shellEscape: 'restricted' | 'full' | 'disabled';
    extraArgs: string;
    openLogOnError: boolean;
    cleanAuxFiles: boolean;
}

/**
 * Load PDF compiler configuration from VS Code settings
 */
function loadPdfConfig(): PdfCompilerConfig {
    const config = vscode.workspace.getConfiguration('scimax.export.pdf');
    return {
        compiler: config.get<PdfCompilerConfig['compiler']>('compiler', 'latexmk-lualatex'),
        bibtexCommand: config.get<'biber' | 'bibtex'>('bibtexCommand', 'bibtex'),
        shellEscape: config.get<PdfCompilerConfig['shellEscape']>('shellEscape', 'restricted'),
        extraArgs: config.get<string>('extraArgs', ''),
        openLogOnError: config.get<boolean>('openLogOnError', true),
        cleanAuxFiles: config.get<boolean>('cleanAuxFiles', true),
    };
}

/**
 * Parse extra arguments string into array of arguments
 * Handles quoted arguments and whitespace properly
 * Note: extraArgs is a user setting - users are responsible for their own configuration
 */
function parseExtraArgs(extraArgs: string): string[] {
    if (!extraArgs || !extraArgs.trim()) {
        return [];
    }
    // Simple split on whitespace - for more complex quoting, users should use multiple settings
    return extraArgs.trim().split(/\s+/).filter(arg => arg.length > 0);
}

/**
 * Build the LaTeX compilation command and arguments
 * Returns command and args separately for safe spawn execution (no shell injection)
 */
function buildCompileArgs(
    texPath: string,
    outputDir: string,
    config: PdfCompilerConfig
): { command: string; args: string[] } {
    const extraArgs = parseExtraArgs(config.extraArgs);

    // Determine shell escape flag based on configuration
    // 'restricted' allows minted/pygments but blocks arbitrary commands
    // 'full' allows all shell commands (security risk - LaTeX shell escape, not our shell)
    // 'disabled' disables shell escape entirely
    const shellFlag = config.shellEscape === 'restricted' ? '-shell-restricted'
        : config.shellEscape === 'full' ? '-shell-escape'
        : null;

    // Build base args array
    let command: string;
    let args: string[];

    switch (config.compiler) {
        case 'latexmk-lualatex':
            command = 'latexmk';
            args = ['-lualatex', '-bibtex'];
            break;

        case 'latexmk-pdflatex':
            command = 'latexmk';
            args = ['-pdf', '-bibtex'];
            break;

        case 'latexmk-xelatex':
            command = 'latexmk';
            args = ['-xelatex', '-bibtex'];
            break;

        case 'lualatex':
            command = 'lualatex';
            args = [];
            break;

        case 'pdflatex':
            command = 'pdflatex';
            args = [];
            break;

        case 'xelatex':
            command = 'xelatex';
            args = [];
            break;

        default:
            command = 'latexmk';
            args = ['-lualatex', '-bibtex'];
    }

    // Add shell escape flag if needed
    if (shellFlag) {
        args.push(shellFlag);
    }

    // Add common args
    args.push('-interaction=nonstopmode');
    args.push(`-output-directory=${outputDir}`);

    // Add any extra args from configuration
    args.push(...extraArgs);

    // Add the tex file path last
    args.push(texPath);

    return { command, args };
}

/**
 * Export to PDF via LaTeX
 * Returns the log file path if there was an error
 */
async function exportPdf(
    content: string,
    options: Partial<LatexExportOptions>,
    outputPath: string
): Promise<string | undefined> {
    const pdfConfig = loadPdfConfig();

    // First generate LaTeX
    const latexContent = await exportLatex(content, options, false);

    // Write to temp file
    const tempDir = path.dirname(outputPath);
    const baseName = path.basename(outputPath, '.pdf');
    const texPath = path.join(tempDir, `${baseName}.tex`);
    const logPath = path.join(tempDir, `${baseName}.log`);

    await fs.promises.writeFile(texPath, latexContent, 'utf-8');

    // Build and execute the compile command (using spawn for safety - no shell injection)
    const { command, args } = buildCompileArgs(texPath, tempDir, pdfConfig);

    try {
        await spawnAsync(command, args, {
            cwd: tempDir,
            timeout: 180000, // 3 minutes for complex documents with bibliography
        });
    } catch (error) {
        // Compiler may return non-zero even when PDF is produced (warnings)
        // We'll check for PDF existence below
    }

    // For non-latexmk compilers, we may need to run bibtex/biber and recompile
    if (!pdfConfig.compiler.startsWith('latexmk')) {
        const auxPath = path.join(tempDir, `${baseName}.aux`);
        if (fs.existsSync(auxPath)) {
            // Check if there are citations that need bibliography processing
            const auxContent = await fs.promises.readFile(auxPath, 'utf-8');
            if (auxContent.includes('\\citation') || auxContent.includes('\\bibdata')) {
                try {
                    // Run bibtex/biber (using spawn for safety)
                    await spawnAsync(pdfConfig.bibtexCommand, [baseName], {
                        cwd: tempDir,
                        timeout: 60000,
                    });
                    // Recompile twice for references
                    const recompile = buildCompileArgs(texPath, tempDir, pdfConfig);
                    await spawnAsync(recompile.command, recompile.args, { cwd: tempDir, timeout: 120000 });
                    await spawnAsync(recompile.command, recompile.args, { cwd: tempDir, timeout: 120000 });
                } catch {
                    // Bibliography processing may fail, continue anyway
                }
            }
        }
    }

    // Check if PDF was created
    const pdfCreated = fs.existsSync(outputPath);

    // Clean up auxiliary files if configured
    if (pdfConfig.cleanAuxFiles) {
        const auxFiles = ['.aux', '.bbl', '.blg', '.fdb_latexmk', '.fls', '.out', '.toc', '.synctex.gz', '.run.xml', '.bcf'];
        for (const ext of auxFiles) {
            try {
                await fs.promises.unlink(path.join(tempDir, `${baseName}${ext}`));
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    if (!pdfCreated) {
        // Keep the log and tex file for debugging, return log path
        // The caller will handle opening the log if configured
        return logPath;
    }

    // Clean up log and tex on success (if cleanAuxFiles is enabled)
    if (pdfConfig.cleanAuxFiles) {
        for (const ext of ['.log', '.tex']) {
            try {
                await fs.promises.unlink(path.join(tempDir, `${baseName}${ext}`));
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    return undefined;
}

/**
 * Handle PDF export error by showing log file
 */
async function handlePdfExportError(logPath: string): Promise<void> {
    const pdfConfig = loadPdfConfig();
    if (pdfConfig.openLogOnError && fs.existsSync(logPath)) {
        // Automatically open log file
        const doc = await vscode.workspace.openTextDocument(logPath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showErrorMessage('PDF export failed. Log file opened for review.');
    } else {
        const action = await vscode.window.showErrorMessage(
            'PDF export failed. View log for details.',
            'Open Log'
        );
        if (action === 'Open Log' && fs.existsSync(logPath)) {
            const doc = await vscode.workspace.openTextDocument(logPath);
            await vscode.window.showTextDocument(doc);
        }
    }
}

/**
 * Get a user-friendly description of the PDF compiler
 */
function getPdfCompilerDescription(): string {
    const config = loadPdfConfig();
    switch (config.compiler) {
        case 'latexmk-lualatex': return 'latexmk (lualatex)';
        case 'latexmk-pdflatex': return 'latexmk (pdflatex)';
        case 'latexmk-xelatex': return 'latexmk (xelatex)';
        case 'lualatex': return 'lualatex';
        case 'pdflatex': return 'pdflatex';
        case 'xelatex': return 'xelatex';
        default: return 'LaTeX';
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
                    // Collect all rows and their cell contents
                    const tableRows: string[][] = [];
                    for (const row of elem.children) {
                        if (row.type === 'table-row' && row.properties?.rowType === 'standard') {
                            const cells = (row.children || [])
                                .map((cell: any) => convertObjects(cell.children || []).trim());
                            tableRows.push(cells);
                        }
                    }

                    if (tableRows.length > 0) {
                        // Calculate max width for each column
                        const colCount = Math.max(...tableRows.map(r => r.length));
                        const colWidths: number[] = [];
                        for (let col = 0; col < colCount; col++) {
                            const maxWidth = Math.max(
                                3, // minimum width for separator
                                ...tableRows.map(row => (row[col] || '').length)
                            );
                            colWidths.push(maxWidth);
                        }

                        // Output header row (first row)
                        const headerCells = tableRows[0].map((cell, i) =>
                            cell.padEnd(colWidths[i])
                        );
                        lines.push(`| ${headerCells.join(' | ')} |`);

                        // Output separator row
                        const separator = colWidths.map(w => '-'.repeat(w));
                        lines.push(`| ${separator.join(' | ')} |`);

                        // Output data rows
                        for (let i = 1; i < tableRows.length; i++) {
                            const cells = tableRows[i].map((cell, j) =>
                                (cell || '').padEnd(colWidths[j] || 3)
                            );
                            lines.push(`| ${cells.join(' | ')} |`);
                        }
                        lines.push('');
                    }
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
    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    let content = editor.document.getText();

    // Preprocess content - expand #+INCLUDE: directives
    content = preprocessContent(content, inputDir);

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

    // Determine output path (inputPath and inputDir already defined above)
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

                // Delete existing output file first
                await deleteExistingOutput(outputPath);

                switch (selectedFormat.format.id) {
                    case 'html':
                        result = await exportHtml(content, options, false, inputDir);
                        await fs.promises.writeFile(outputPath, result, 'utf-8');
                        break;

                    case 'html-body':
                        result = await exportHtml(content, options, true, inputDir);
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

    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const content = preprocessContent(editor.document.getText(), inputDir);
    const outputPath = inputPath.replace(/\.org$/, '.html');
    const bodyOnly = isBodyOnlyMode();

    try {
        await deleteExistingOutput(outputPath);
        const result = await exportHtml(content, {}, bodyOnly, inputDir);
        await fs.promises.writeFile(outputPath, result, 'utf-8');
        const suffix = bodyOnly ? ' (body only)' : '';
        vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}${suffix}`);
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

    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const content = preprocessContent(editor.document.getText(), inputDir);
    const outputPath = inputPath.replace(/\.org$/, '.tex');
    const bodyOnly = isBodyOnlyMode();

    try {
        await deleteExistingOutput(outputPath);
        const result = await exportLatex(content, {}, bodyOnly);
        await fs.promises.writeFile(outputPath, result, 'utf-8');
        const suffix = bodyOnly ? ' (body only)' : '';
        vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}${suffix}`);
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

    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const content = preprocessContent(editor.document.getText(), inputDir);
    const outputPath = inputPath.replace(/\.org$/, '.pdf');
    const compilerDesc = getPdfCompilerDescription();

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Exporting to PDF via ${compilerDesc}...`,
            cancellable: false,
        },
        async () => {
            try {
                await deleteExistingOutput(outputPath);
                const logPath = await exportPdf(content, {}, outputPath);
                if (logPath) {
                    await handlePdfExportError(logPath);
                } else {
                    const action = await vscode.window.showInformationMessage(
                        `Exported to ${path.basename(outputPath)}`,
                        'Open'
                    );
                    if (action === 'Open') {
                        await vscode.env.openExternal(vscode.Uri.file(outputPath));
                    }
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

    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const content = preprocessContent(editor.document.getText(), inputDir);
    const outputPath = inputPath.replace(/\.org$/, '.md');

    try {
        await deleteExistingOutput(outputPath);
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

    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const content = preprocessContent(editor.document.getText(), inputDir);
    const fileName = path.basename(inputPath);

    try {
        const htmlContent = await exportHtml(content, {}, false, inputDir);

        // Inject CSP meta tag to allow loading external scripts (MathJax, highlight.js)
        // VS Code webviews have restrictive default CSP that blocks CDN scripts
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: https:; font-src https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;">`;
        const htmlWithCsp = htmlContent.replace(/<head>/, `<head>\n${cspMeta}`);

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

        panel.webview.html = htmlWithCsp;
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
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'org') {
                    vscode.window.showWarningMessage('No org-mode file open');
                    return;
                }
                const inputPath = editor.document.uri.fsPath;
                const inputDir = path.dirname(inputPath);
                const content = preprocessContent(editor.document.getText(), inputDir);
                const outputPath = inputPath.replace(/\.org$/, '.pdf');
                const compilerDesc = getPdfCompilerDescription();

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Exporting to PDF via ${compilerDesc}...`,
                        cancellable: false,
                    },
                    async () => {
                        try {
                            await deleteExistingOutput(outputPath);
                            const logPath = await exportPdf(content, {}, outputPath);
                            if (logPath) {
                                await handlePdfExportError(logPath);
                            } else {
                                await vscode.env.openExternal(vscode.Uri.file(outputPath));
                            }
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            vscode.window.showErrorMessage(`PDF export failed: ${message}`);
                        }
                    }
                );
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
                const inputPath = editor.document.uri.fsPath;
                const inputDir = path.dirname(inputPath);
                const content = preprocessContent(editor.document.getText(), inputDir);
                const outputPath = inputPath.replace(/\.org$/, '.html');
                const bodyOnly = isBodyOnlyMode();
                try {
                    await deleteExistingOutput(outputPath);
                    const html = await exportHtml(content, {}, bodyOnly, inputDir);
                    await fs.promises.writeFile(outputPath, html, 'utf-8');
                    await vscode.env.openExternal(vscode.Uri.file(outputPath));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`HTML export failed: ${message}`);
                }
            }
        )
    );

    // Export Markdown and open
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportMarkdownOpen',
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'org') {
                    vscode.window.showWarningMessage('No org-mode file open');
                    return;
                }
                const inputPath = editor.document.uri.fsPath;
                const inputDir = path.dirname(inputPath);
                const content = preprocessContent(editor.document.getText(), inputDir);
                const outputPath = inputPath.replace(/\.org$/, '.md');
                try {
                    await deleteExistingOutput(outputPath);
                    const result = await exportMarkdown(content, {});
                    await fs.promises.writeFile(outputPath, result, 'utf-8');
                    const doc = await vscode.workspace.openTextDocument(outputPath);
                    await vscode.window.showTextDocument(doc);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Markdown export failed: ${message}`);
                }
            }
        )
    );

    // Export menu via hydra (C-c C-e)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.org.exportMenu',
            async () => {
                await vscode.commands.executeCommand('scimax.hydra.show', 'scimax.export');
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
        { label: '$(code) [h b] HTML body only', description: 'Export HTML body without header/footer', value: 'html-body', keys: 'hb' },
        { label: '$(preview) [h p] HTML preview', description: 'Preview HTML in VS Code', value: 'html-preview', keys: 'hp' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, value: '', keys: '' },
        // LaTeX exports
        { label: '$(file-text) [l l] LaTeX file', description: 'Export to .tex file', value: 'latex-file', keys: 'll' },
        { label: '$(file-code) [l b] LaTeX body only', description: 'Export LaTeX body without preamble', value: 'latex-body', keys: 'lb' },
        { label: '$(file-pdf) [l p] PDF file', description: 'Export to PDF via LaTeX', value: 'pdf-file', keys: 'lp' },
        { label: '$(file-pdf) [l o] PDF and open', description: 'Export to PDF and open', value: 'pdf-open', keys: 'lo' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, value: '', keys: '' },
        // Markdown exports
        { label: '$(markdown) [m m] Markdown file', description: 'Export to .md file', value: 'md-file', keys: 'mm' },
        { label: '$(markdown) [m o] Markdown and open', description: 'Export to .md and open', value: 'md-open', keys: 'mo' },
    ];

    const selected = await vscode.window.showQuickPick(exportOptions.filter(o => o.label !== ''), {
        placeHolder: 'Select export format (type keys: hh, ho, hb, hp, ll, lb, lp, lo, mm, mo)',
        title: 'Org Export Dispatcher - C-c C-e',
        matchOnDescription: true,
    });

    if (!selected || !selected.value) return;

    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const content = preprocessContent(editor.document.getText(), inputDir);

    const bodyOnly = isBodyOnlyMode();
    try {
        switch (selected.value) {
            case 'html-file': {
                const outputPath = inputPath.replace(/\.org$/, '.html');
                await deleteExistingOutput(outputPath);
                const html = await exportHtml(content, {}, bodyOnly, inputDir);
                await fs.promises.writeFile(outputPath, html, 'utf-8');
                const suffix = bodyOnly ? ' (body only)' : '';
                vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}${suffix}`);
                break;
            }
            case 'html-open': {
                const outputPath = inputPath.replace(/\.org$/, '.html');
                await deleteExistingOutput(outputPath);
                const html = await exportHtml(content, {}, bodyOnly, inputDir);
                await fs.promises.writeFile(outputPath, html, 'utf-8');
                await vscode.env.openExternal(vscode.Uri.file(outputPath));
                break;
            }
            case 'html-body': {
                // Explicit body-only export (ignores toggle, always body-only)
                const outputPath = inputPath.replace(/\.org$/, '.html');
                await deleteExistingOutput(outputPath);
                const html = await exportHtml(content, {}, true, inputDir);
                await fs.promises.writeFile(outputPath, html, 'utf-8');
                vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)} (body only)`);
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
            case 'latex-body': {
                // Explicit body-only export (ignores toggle, always body-only)
                const outputPath = inputPath.replace(/\.org$/, '.tex');
                await deleteExistingOutput(outputPath);
                const latex = await exportLatex(content, {}, true);
                await fs.promises.writeFile(outputPath, latex, 'utf-8');
                vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)} (body only)`);
                break;
            }
            case 'pdf-file': {
                const outputPath = inputPath.replace(/\.org$/, '.pdf');
                const compilerDesc = getPdfCompilerDescription();
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Generating PDF via ${compilerDesc}...`, cancellable: false },
                    async (progress) => {
                        progress.report({ message: 'Generating LaTeX and compiling...' });
                        await deleteExistingOutput(outputPath);
                        const logPath = await exportPdf(content, {}, outputPath);
                        if (logPath) {
                            await handlePdfExportError(logPath);
                        } else {
                            vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}`);
                        }
                    }
                );
                break;
            }
            case 'pdf-open': {
                const outputPath = inputPath.replace(/\.org$/, '.pdf');
                const compilerDesc = getPdfCompilerDescription();
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Generating PDF via ${compilerDesc}...`, cancellable: false },
                    async (progress) => {
                        progress.report({ message: 'Generating LaTeX and compiling...' });
                        await deleteExistingOutput(outputPath);
                        const logPath = await exportPdf(content, {}, outputPath);
                        if (logPath) {
                            await handlePdfExportError(logPath);
                        } else {
                            await vscode.env.openExternal(vscode.Uri.file(outputPath));
                        }
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
