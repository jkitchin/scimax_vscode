/**
 * LaTeX Preview Provider for org-mode
 * Compiles LaTeX equations to images for hover preview
 * Supports:
 * - Inline math: $...$ and \(...\)
 * - Display math: $$...$$ and \[...\]
 * - Environments: \begin{equation}...\end{equation}, \begin{align}...\end{align}, etc.
 * - Document-level settings: #+LATEX_HEADER:
 * - Equation numbering
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

// Cache directory for rendered equations
let cacheDir: string;

// In-memory cache for quick lookup
const renderCache = new Map<string, { svgPath: string; pngPath?: string; timestamp: number }>();

// Equation counter for numbering within a document
const documentEquationCounters = new Map<string, Map<string, number>>();

/**
 * LaTeX math environments that support equation numbering
 */
const NUMBERED_ENVIRONMENTS = new Set([
    'equation',
    'align',
    'gather',
    'multline',
    'eqnarray',
    'alignat',
    'flalign',
]);

/**
 * LaTeX math environments (starred versions are unnumbered)
 */
const MATH_ENVIRONMENTS = new Set([
    ...NUMBERED_ENVIRONMENTS,
    'equation*',
    'align*',
    'gather*',
    'multline*',
    'eqnarray*',
    'alignat*',
    'flalign*',
    'split',
    'aligned',
    'gathered',
    'cases',
    'matrix',
    'pmatrix',
    'bmatrix',
    'vmatrix',
    'Vmatrix',
    'smallmatrix',
]);

/**
 * Initialize the cache directory
 */
export function initLatexPreviewCache(context: vscode.ExtensionContext): void {
    cacheDir = path.join(context.globalStorageUri.fsPath, 'latex-preview-cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Clean up old cache entries on startup (older than 7 days)
    cleanupCache(7 * 24 * 60 * 60 * 1000);
}

/**
 * Clean up cache entries older than maxAge milliseconds
 */
function cleanupCache(maxAge: number): void {
    if (!fs.existsSync(cacheDir)) return;

    const now = Date.now();
    const files = fs.readdirSync(cacheDir);

    for (const file of files) {
        const filePath = path.join(cacheDir, file);
        try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
            }
        } catch {
            // Ignore errors during cleanup
        }
    }
}

/**
 * Represents a LaTeX fragment found in the document
 */
export interface LatexFragment {
    /** Raw LaTeX content including delimiters */
    raw: string;
    /** LaTeX content without delimiters */
    content: string;
    /** Type of math */
    type: 'inline' | 'display' | 'environment';
    /** Environment name if type is 'environment' */
    environment?: string;
    /** Whether the equation is numbered */
    numbered: boolean;
    /** Start position in the line */
    startCol: number;
    /** End position in the line */
    endCol: number;
    /** Line number (0-indexed) */
    line: number;
    /** Start position in document (character offset) */
    startOffset: number;
    /** End position in document (character offset) */
    endOffset: number;
}

/**
 * Document-level LaTeX settings extracted from org keywords
 */
export interface LatexDocumentSettings {
    /** Additional packages from #+LATEX_HEADER: */
    packages: string[];
    /** Custom preamble content */
    preamble: string;
    /** Document class */
    documentClass: string;
    /** Class options */
    classOptions: string[];
}

/**
 * Parse document for LaTeX settings
 */
export function parseLatexSettings(document: vscode.TextDocument): LatexDocumentSettings {
    const settings: LatexDocumentSettings = {
        packages: [],
        preamble: '',
        documentClass: 'standalone',
        classOptions: ['preview', 'border=2pt'],
    };

    const text = document.getText();
    const lines = text.split('\n');
    const preambleLines: string[] = [];

    for (const line of lines) {
        // Stop parsing at first heading
        if (line.match(/^\*\s/)) break;

        // #+LATEX_HEADER: \usepackage{...}
        const headerMatch = line.match(/^#\+LATEX_HEADER:\s*(.+)$/i);
        if (headerMatch) {
            const headerContent = headerMatch[1].trim();

            // Extract package from \usepackage{...} or \usepackage[...]{...}
            const packageMatch = headerContent.match(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/);
            if (packageMatch) {
                // Can be comma-separated packages
                const pkgs = packageMatch[1].split(',').map((p: string) => p.trim());
                settings.packages.push(...pkgs);
            }

            // Add to preamble
            preambleLines.push(headerContent);
        }

        // #+LATEX_CLASS:
        const classMatch = line.match(/^#\+LATEX_CLASS:\s*(\w+)$/i);
        if (classMatch) {
            // For preview, we still use standalone but can extract for reference
        }

        // #+LATEX_CLASS_OPTIONS:
        const classOptsMatch = line.match(/^#\+LATEX_CLASS_OPTIONS:\s*(.+)$/i);
        if (classOptsMatch) {
            // Parse options for reference
        }
    }

    if (preambleLines.length > 0) {
        settings.preamble = preambleLines.join('\n');
    }

    return settings;
}

/**
 * Find all LaTeX fragments in a line
 */
export function findLatexFragmentsInLine(
    line: string,
    lineNumber: number,
    lineOffset: number
): LatexFragment[] {
    const fragments: LatexFragment[] = [];

    // Find inline math: $...$
    let match: RegExpExecArray | null;
    const inlineDollarPattern = /(?<![\\$])(\$)(?!\$)([^$\n]+?)(?<![\\$])(\$)(?!\$)/g;
    while ((match = inlineDollarPattern.exec(line)) !== null) {
        const content = match[2];
        // Skip if it looks like currency (starts with number)
        if (/^\d/.test(content.trim())) continue;

        fragments.push({
            raw: match[0],
            content: content,
            type: 'inline',
            numbered: false,
            startCol: match.index,
            endCol: match.index + match[0].length,
            line: lineNumber,
            startOffset: lineOffset + match.index,
            endOffset: lineOffset + match.index + match[0].length,
        });
    }

    // Find display math: $$...$$
    const displayDollarPattern = /\$\$([^$]+?)\$\$/g;
    while ((match = displayDollarPattern.exec(line)) !== null) {
        fragments.push({
            raw: match[0],
            content: match[1],
            type: 'display',
            numbered: false,
            startCol: match.index,
            endCol: match.index + match[0].length,
            line: lineNumber,
            startOffset: lineOffset + match.index,
            endOffset: lineOffset + match.index + match[0].length,
        });
    }

    // Find \(...\) inline math
    const inlineParenPattern = /\\\((.+?)\\\)/g;
    while ((match = inlineParenPattern.exec(line)) !== null) {
        fragments.push({
            raw: match[0],
            content: match[1],
            type: 'inline',
            numbered: false,
            startCol: match.index,
            endCol: match.index + match[0].length,
            line: lineNumber,
            startOffset: lineOffset + match.index,
            endOffset: lineOffset + match.index + match[0].length,
        });
    }

    // Find \[...\] display math
    const displayBracketPattern = /\\\[(.+?)\\\]/g;
    while ((match = displayBracketPattern.exec(line)) !== null) {
        fragments.push({
            raw: match[0],
            content: match[1],
            type: 'display',
            numbered: false,
            startCol: match.index,
            endCol: match.index + match[0].length,
            line: lineNumber,
            startOffset: lineOffset + match.index,
            endOffset: lineOffset + match.index + match[0].length,
        });
    }

    return fragments;
}

/**
 * Find multi-line LaTeX environments in document
 */
export function findLatexEnvironments(document: vscode.TextDocument): LatexFragment[] {
    const fragments: LatexFragment[] = [];
    const text = document.getText();

    // Match \begin{env}...\end{env} environments
    const envPattern = /\\begin\{(\w+\*?)\}([\s\S]*?)\\end\{\1\}/g;
    let match: RegExpExecArray | null;

    while ((match = envPattern.exec(text)) !== null) {
        const envName = match[1];

        // Only process math environments
        if (!MATH_ENVIRONMENTS.has(envName)) continue;

        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        const isNumbered = NUMBERED_ENVIRONMENTS.has(envName) && !envName.endsWith('*');

        fragments.push({
            raw: match[0],
            content: match[2],
            type: 'environment',
            environment: envName,
            numbered: isNumbered,
            startCol: startPos.character,
            endCol: endPos.character,
            line: startPos.line,
            startOffset: match.index,
            endOffset: match.index + match[0].length,
        });
    }

    return fragments;
}

/**
 * Find all LaTeX fragments in document
 */
export function findAllLatexFragments(document: vscode.TextDocument): LatexFragment[] {
    const fragments: LatexFragment[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineFragments = findLatexFragmentsInLine(lines[i], i, offset);
        fragments.push(...lineFragments);
        offset += lines[i].length + 1; // +1 for newline
    }

    // Add multi-line environments
    const envFragments = findLatexEnvironments(document);
    fragments.push(...envFragments);

    // Sort by start offset and deduplicate overlapping fragments
    fragments.sort((a, b) => a.startOffset - b.startOffset);

    // Remove overlapping fragments (environments take precedence)
    const deduped: LatexFragment[] = [];
    for (const frag of fragments) {
        const overlaps = deduped.some(
            existing =>
                (frag.startOffset >= existing.startOffset && frag.startOffset < existing.endOffset) ||
                (frag.endOffset > existing.startOffset && frag.endOffset <= existing.endOffset)
        );
        if (!overlaps) {
            deduped.push(frag);
        }
    }

    return deduped;
}

/**
 * Get equation number for a fragment
 */
export function getEquationNumber(
    document: vscode.TextDocument,
    fragment: LatexFragment
): number | null {
    if (!fragment.numbered) return null;

    const docUri = document.uri.toString();

    // Get or create counter map for this document
    if (!documentEquationCounters.has(docUri)) {
        // Count all numbered equations in document up to this point
        const allFragments = findAllLatexFragments(document);
        const counterMap = new Map<string, number>();
        let counter = 0;

        for (const frag of allFragments) {
            if (frag.numbered) {
                counter++;
                const key = `${frag.startOffset}`;
                counterMap.set(key, counter);
            }
        }

        documentEquationCounters.set(docUri, counterMap);
    }

    const counterMap = documentEquationCounters.get(docUri)!;
    const key = `${fragment.startOffset}`;
    return counterMap.get(key) ?? null;
}

/**
 * Invalidate equation counter cache for a document
 */
export function invalidateEquationCounterCache(document: vscode.TextDocument): void {
    documentEquationCounters.delete(document.uri.toString());
}

/**
 * Generate a hash for the LaTeX content and settings
 */
function generateCacheKey(
    content: string,
    settings: LatexDocumentSettings,
    equationNumber: number | null
): string {
    const data = JSON.stringify({
        content,
        packages: settings.packages,
        preamble: settings.preamble,
        equationNumber,
    });
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Build the LaTeX document for rendering
 */
function buildLatexDocument(
    fragment: LatexFragment,
    settings: LatexDocumentSettings,
    equationNumber: number | null,
    darkMode: boolean = false
): string {
    const lines: string[] = [];

    // Document class: standalone with preview for tight bounding box
    lines.push('\\documentclass[preview,border=2pt,varwidth]{standalone}');
    lines.push('');

    // Essential packages
    lines.push('% Essential packages');
    lines.push('\\usepackage[utf8]{inputenc}');
    lines.push('\\usepackage[T1]{fontenc}');
    lines.push('\\usepackage{amsmath}');
    lines.push('\\usepackage{amssymb}');
    lines.push('\\usepackage{amsfonts}');
    lines.push('\\usepackage{mathtools}');
    lines.push('\\usepackage{bm}'); // Bold math
    lines.push('\\usepackage{xcolor}');
    lines.push('');

    // Additional packages from document
    if (settings.packages.length > 0) {
        lines.push('% Document packages');
        const seenPackages = new Set(['inputenc', 'fontenc', 'amsmath', 'amssymb', 'amsfonts', 'mathtools', 'bm', 'xcolor']);
        for (const pkg of settings.packages) {
            if (!seenPackages.has(pkg)) {
                lines.push(`\\usepackage{${pkg}}`);
                seenPackages.add(pkg);
            }
        }
        lines.push('');
    }

    // Custom preamble from document
    if (settings.preamble) {
        lines.push('% Custom preamble');
        lines.push(settings.preamble);
        lines.push('');
    }

    // Handle equation numbering
    if (equationNumber !== null) {
        lines.push('% Equation numbering');
        lines.push(`\\setcounter{equation}{${equationNumber - 1}}`);
        lines.push('');
    }

    // Dark mode support
    if (darkMode) {
        lines.push('% Dark mode colors');
        lines.push('\\pagecolor{black}');
        lines.push('\\color{white}');
        lines.push('');
    }

    // Begin document
    lines.push('\\begin{document}');
    lines.push('');

    // Add the math content
    if (fragment.type === 'environment') {
        // Use the raw content (includes \begin{env}...\end{env})
        lines.push(fragment.raw);
    } else if (fragment.type === 'display') {
        // Wrap in equation* for display math (unnumbered)
        lines.push('\\begin{equation*}');
        lines.push(fragment.content);
        lines.push('\\end{equation*}');
    } else {
        // Inline math - wrap in $...$ for preview
        lines.push(`$\\displaystyle ${fragment.content}$`);
    }

    lines.push('');
    lines.push('\\end{document}');

    return lines.join('\n');
}

/**
 * Check if LaTeX tools are available
 */
export async function checkLatexAvailable(): Promise<{ available: boolean; message: string }> {
    return new Promise((resolve) => {
        const proc = spawn('pdflatex', ['--version'], {
            shell: true,
            timeout: 5000,
        });

        let output = '';
        proc.stdout?.on('data', (data: Buffer) => {
            output += data.toString();
        });

        proc.on('error', () => {
            resolve({
                available: false,
                message: 'pdflatex not found. Please install a LaTeX distribution (TeX Live, MiKTeX, or MacTeX).',
            });
        });

        proc.on('close', (code: number | null) => {
            if (code === 0) {
                // Check for dvisvgm
                const dviProc = spawn('dvisvgm', ['--version'], {
                    shell: true,
                    timeout: 5000,
                });

                dviProc.on('error', () => {
                    resolve({
                        available: true,
                        message: 'dvisvgm not found. SVG output will not be available, using PNG fallback.',
                    });
                });

                dviProc.on('close', (dviCode: number | null) => {
                    if (dviCode === 0) {
                        resolve({
                            available: true,
                            message: 'LaTeX tools available (pdflatex + dvisvgm)',
                        });
                    } else {
                        resolve({
                            available: true,
                            message: 'dvisvgm not available, using PNG fallback.',
                        });
                    }
                });
            } else {
                resolve({
                    available: false,
                    message: 'pdflatex not available or returned an error.',
                });
            }
        });
    });
}

/**
 * Render LaTeX to SVG
 */
export async function renderLatexToSvg(
    fragment: LatexFragment,
    settings: LatexDocumentSettings,
    equationNumber: number | null,
    darkMode: boolean = false
): Promise<{ success: boolean; svgPath?: string; pngPath?: string; error?: string }> {
    // Check cache first
    const cacheKey = generateCacheKey(fragment.content, settings, equationNumber);
    const darkSuffix = darkMode ? '-dark' : '';
    const cached = renderCache.get(cacheKey + darkSuffix);

    if (cached && fs.existsSync(cached.svgPath)) {
        return { success: true, svgPath: cached.svgPath, pngPath: cached.pngPath };
    }

    // Create temp directory for this render
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-preview-'));
    const texFile = path.join(tempDir, 'equation.tex');
    const dviFile = path.join(tempDir, 'equation.dvi');
    const svgFile = path.join(cacheDir, `${cacheKey}${darkSuffix}.svg`);
    const pngFile = path.join(cacheDir, `${cacheKey}${darkSuffix}.png`);

    try {
        // Generate LaTeX document
        const texContent = buildLatexDocument(fragment, settings, equationNumber, darkMode);
        fs.writeFileSync(texFile, texContent);

        // Compile to DVI (faster than PDF for preview)
        const latexResult = await runCommand(
            'latex',
            ['-interaction=nonstopmode', '-halt-on-error', 'equation.tex'],
            tempDir,
            10000
        );

        if (!latexResult.success) {
            // Try pdflatex as fallback
            const pdfResult = await runCommand(
                'pdflatex',
                ['-interaction=nonstopmode', '-halt-on-error', 'equation.tex'],
                tempDir,
                10000
            );

            if (!pdfResult.success) {
                return {
                    success: false,
                    error: `LaTeX compilation failed:\n${pdfResult.stderr || latexResult.stderr}`,
                };
            }

            // Convert PDF to PNG using pdftoppm (ImageMagick alternative)
            const pdfFile = path.join(tempDir, 'equation.pdf');
            if (fs.existsSync(pdfFile)) {
                const convertResult = await runCommand(
                    'pdftoppm',
                    ['-png', '-r', '150', '-singlefile', pdfFile, path.join(tempDir, 'equation')],
                    tempDir,
                    10000
                );

                const tempPng = path.join(tempDir, 'equation.png');
                if (convertResult.success && fs.existsSync(tempPng)) {
                    fs.copyFileSync(tempPng, pngFile);
                    renderCache.set(cacheKey + darkSuffix, { svgPath: pngFile, pngPath: pngFile, timestamp: Date.now() });
                    return { success: true, pngPath: pngFile };
                }
            }

            return { success: false, error: 'Could not convert PDF to image' };
        }

        // Convert DVI to SVG using dvisvgm
        if (fs.existsSync(dviFile)) {
            const svgResult = await runCommand(
                'dvisvgm',
                ['--no-fonts', '--exact', '--output=%f', dviFile],
                tempDir,
                10000
            );

            const tempSvg = path.join(tempDir, 'equation.svg');
            if (svgResult.success && fs.existsSync(tempSvg)) {
                fs.copyFileSync(tempSvg, svgFile);
                renderCache.set(cacheKey + darkSuffix, { svgPath: svgFile, timestamp: Date.now() });
                return { success: true, svgPath: svgFile };
            }
        }

        return { success: false, error: 'Could not convert to SVG' };

    } finally {
        // Cleanup temp directory
        try {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                fs.unlinkSync(path.join(tempDir, file));
            }
            fs.rmdirSync(tempDir);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Run a command and capture output
 */
function runCommand(
    cmd: string,
    args: string[],
    cwd: string,
    timeout: number
): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, {
            cwd,
            shell: true,
            timeout,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('error', (err: Error) => {
            resolve({ success: false, stdout, stderr: err.message });
        });

        proc.on('close', (code: number | null) => {
            resolve({ success: code === 0, stdout, stderr });
        });
    });
}

/**
 * Find LaTeX fragment at position
 */
export function findLatexFragmentAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
): LatexFragment | null {
    const offset = document.offsetAt(position);
    const fragments = findAllLatexFragments(document);

    for (const fragment of fragments) {
        if (offset >= fragment.startOffset && offset <= fragment.endOffset) {
            return fragment;
        }
    }

    return null;
}

/**
 * Create hover content for a LaTeX fragment
 */
export async function createLatexHover(
    document: vscode.TextDocument,
    fragment: LatexFragment,
    position: vscode.Position
): Promise<vscode.Hover | null> {
    // Get document settings
    const settings = parseLatexSettings(document);

    // Get equation number if applicable
    const equationNumber = getEquationNumber(document, fragment);

    // Detect dark mode
    const isDarkMode = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
                       vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastDark;

    // Render the equation
    const result = await renderLatexToSvg(fragment, settings, equationNumber, isDarkMode);

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;
    markdown.supportHtml = true;

    if (result.success) {
        const imagePath = result.svgPath || result.pngPath;
        if (imagePath && fs.existsSync(imagePath)) {
            const imageUri = vscode.Uri.file(imagePath);

            // Add equation number if applicable
            if (equationNumber !== null) {
                markdown.appendMarkdown(`**Equation (${equationNumber})**\n\n`);
            } else {
                const typeLabel = fragment.type === 'inline' ? 'Inline' :
                                 fragment.type === 'display' ? 'Display' :
                                 `Environment: ${fragment.environment}`;
                markdown.appendMarkdown(`**${typeLabel} Math**\n\n`);
            }

            // Add rendered image
            if (result.svgPath) {
                // For SVG, embed directly for better quality
                try {
                    const svgContent = fs.readFileSync(imagePath, 'utf-8');
                    // Scale SVG for better visibility
                    const scaledSvg = svgContent.replace(
                        /<svg([^>]*)>/,
                        '<svg$1 style="max-width: 500px; height: auto;">'
                    );
                    markdown.appendMarkdown(`${scaledSvg}\n\n`);
                } catch {
                    // Fall back to img tag
                    markdown.appendMarkdown(`<img src="${imageUri.toString()}" style="max-width: 500px;" />\n\n`);
                }
            } else {
                markdown.appendMarkdown(`<img src="${imageUri.toString()}" style="max-width: 500px;" />\n\n`);
            }

            // Show source LaTeX
            markdown.appendMarkdown('---\n\n');
            markdown.appendCodeBlock(fragment.raw, 'latex');
        }
    } else {
        // Show error with the LaTeX source
        markdown.appendMarkdown('**LaTeX Preview Error**\n\n');
        markdown.appendMarkdown(`⚠️ ${result.error || 'Failed to render equation'}\n\n`);
        markdown.appendMarkdown('---\n\n');
        markdown.appendMarkdown('**Source:**\n\n');
        markdown.appendCodeBlock(fragment.raw, 'latex');

        // Offer fallback: show as text
        markdown.appendMarkdown('\n\n**Rendered (text):**\n\n');
        markdown.appendMarkdown(`\`${fragment.content}\``);
    }

    // Calculate range
    const startPos = document.positionAt(fragment.startOffset);
    const endPos = document.positionAt(fragment.endOffset);
    const range = new vscode.Range(startPos, endPos);

    return new vscode.Hover(markdown, range);
}

/**
 * Clear the render cache
 */
export function clearLatexCache(): void {
    renderCache.clear();
    documentEquationCounters.clear();

    if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        for (const file of files) {
            try {
                fs.unlinkSync(path.join(cacheDir, file));
            } catch {
                // Ignore errors
            }
        }
    }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { entryCount: number; totalSize: number } {
    let totalSize = 0;
    let entryCount = 0;

    if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        entryCount = files.length;

        for (const file of files) {
            try {
                const stats = fs.statSync(path.join(cacheDir, file));
                totalSize += stats.size;
            } catch {
                // Ignore errors
            }
        }
    }

    return { entryCount, totalSize };
}
