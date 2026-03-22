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
 * @returns The path to the generated output file
 */
export async function exportMarkdown(
    content: string,
    inputPath: string,
    format: MarkdownExportFormat,
    outputPath?: string,
): Promise<string> {
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

    try {
        fs.writeFileSync(tmpPath, content, 'utf-8');

        const args = [
            '-f', 'markdown',
            '-t', format === 'pdf' ? 'latex' : format,
            '--standalone',
            '-o', outPath,
            tmpPath,
        ];

        await spawnAsync('pandoc', args, { cwd, timeout: 120000 });
    } finally {
        // Clean up temp file
        try {
            fs.unlinkSync(tmpPath);
        } catch {
            // ignore cleanup errors
        }
    }

    return outPath;
}
