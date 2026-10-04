/**
 * Markdown export backend using pandoc
 * Exports markdown files to HTML, PDF, DOCX, and LaTeX
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import { execSync, spawn } from 'child_process';

// =============================================================================
// Pandoc Availability Check
// =============================================================================

let pandocAvailable: boolean | null = null;
let pandocVersion: string | null = null;

/**
 * Check if pandoc is available on the system
 */
export function checkPandoc(): { available: boolean; version: string | null } {
    if (pandocAvailable !== null) {
        return { available: pandocAvailable, version: pandocVersion };
    }
    try {
        const result = execSync('pandoc --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const match = result.match(/pandoc\s+([\d.]+)/);
        pandocVersion = match ? match[1] : 'unknown';
        pandocAvailable = true;
    } catch {
        pandocAvailable = false;
        pandocVersion = null;
    }
    return { available: pandocAvailable, version: pandocVersion };
}

// =============================================================================
// Spawn Helper
// =============================================================================

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
                const error = new Error(`pandoc failed with exit code ${code}: ${stderr}`);
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

// =============================================================================
// Export Functions
// =============================================================================

export type MarkdownExportFormat = 'html' | 'pdf' | 'latex' | 'docx';

export type PdfEngine = 'xelatex' | 'lualatex' | 'pdflatex';

/**
 * How pandoc typesets a PDF. pdflatex cannot set characters such as ′, → or
 * Greek letters typed directly in the text, so the default is xelatex with a
 * font that has them.
 */
export interface PdfExportOptions {
    engine: PdfEngine;
    /** Font family for the body text; empty picks a default for the platform. */
    mainFont: string;
}

export interface MarkdownExportResult {
    outPath: string;
    /** Characters the PDF engine reported as missing from the font, so absent from the PDF. */
    missingCharacters: string[];
}

/**
 * The body font used when none is configured. macOS ships Arial Unicode MS,
 * which covers the arrows, primes, Greek and math symbols common in technical
 * writing; elsewhere pandoc's template default is kept.
 */
export function defaultMainFont(platform: NodeJS.Platform = process.platform): string {
    return platform === 'darwin' ? 'Arial Unicode MS' : '';
}

/**
 * True if the document's YAML front matter sets the given top-level key.
 */
export function frontMatterHasKey(content: string, key: string): boolean {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (!match) {
        return false;
    }
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}\\s*:`, 'm').test(match[1]);
}

/**
 * The pandoc arguments that choose the PDF engine and body font. A `mainfont`
 * in the document's front matter takes precedence over the configured font.
 */
export function pdfArgs(
    content: string,
    options: PdfExportOptions,
    platform: NodeJS.Platform = process.platform,
): string[] {
    const args = [`--pdf-engine=${options.engine}`];
    if (options.engine === 'pdflatex' || frontMatterHasKey(content, 'mainfont')) {
        return args;
    }
    const font = options.mainFont.trim() || defaultMainFont(platform);
    if (font) {
        args.push('-V', `mainfont=${font}`);
    }
    return args;
}

/**
 * The characters xelatex reported as missing from the font, in order of first
 * appearance. xelatex still writes the PDF, leaving these characters out.
 */
export function missingCharacters(stderr: string): string[] {
    const found = new Set<string>();
    for (const match of stderr.matchAll(/Missing character: There is no (\S+)/g)) {
        found.add(match[1]);
    }
    return [...found];
}

const FORMAT_EXTENSIONS: Record<MarkdownExportFormat, string> = {
    html: '.html',
    pdf: '.pdf',
    latex: '.tex',
    docx: '.docx',
};

/**
 * Export a markdown file to the specified format using pandoc.
 *
 * @param content - The markdown content to export
 * @param inputPath - Path to the source markdown file (used for output naming and relative paths)
 * @param format - Target export format
 * @param outputPath - Optional explicit output path; defaults to input path with changed extension
 * @param pdfOptions - PDF engine and body font, used only for PDF export
 * @returns The path to the generated output file and any characters missing from the PDF
 */
export async function exportMarkdown(
    content: string,
    inputPath: string,
    format: MarkdownExportFormat,
    outputPath?: string,
    pdfOptions: PdfExportOptions = { engine: 'xelatex', mainFont: '' },
): Promise<MarkdownExportResult> {
    const pandoc = checkPandoc();
    if (!pandoc.available) {
        throw new Error('pandoc is not installed. Install it from https://pandoc.org/installing.html');
    }

    const ext = FORMAT_EXTENSIONS[format];
    const outPath = outputPath || inputPath.replace(/\.md$/i, ext);
    const cwd = path.dirname(inputPath);

    // Write content to a temp file so unsaved editor changes are exported
    const tmpName = `scimax-md-export-${crypto.randomBytes(16).toString('hex')}.md`;
    const tmpPath = path.join(os.tmpdir(), tmpName);
    let stderr = '';

    try {
        fs.writeFileSync(tmpPath, content, 'utf-8');

        const args = [
            '-f', 'markdown',
            '-t', format === 'pdf' ? 'latex' : format,
            '--standalone',
            ...(format === 'pdf' ? pdfArgs(content, pdfOptions) : []),
            '-o', outPath,
            tmpPath,
        ];

        ({ stderr } = await spawnAsync('pandoc', args, { cwd, timeout: 120000 }));
    } finally {
        // Clean up temp file
        try {
            fs.unlinkSync(tmpPath);
        } catch {
            // ignore cleanup errors
        }
    }

    return { outPath, missingCharacters: missingCharacters(stderr) };
}
