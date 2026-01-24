/**
 * SyncTeX Utilities
 * Shared utilities for bidirectional sync between LaTeX source and PDF
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Result of forward SyncTeX lookup (source → PDF)
 */
export interface SyncTeXForwardResult {
    page: number;
    x: number;  // PDF points (72 DPI), from left
    y: number;  // PDF points (72 DPI), from bottom
    width: number;
    height: number;
}

/**
 * Result of inverse SyncTeX lookup (PDF → source)
 */
export interface SyncTeXInverseResult {
    file: string;
    line: number;
    column: number;
    offset: number;  // Byte offset from start of line (often more accurate)
}

/**
 * Get enhanced PATH for LaTeX tools
 */
function getEnhancedPath(): string {
    const currentPath = process.env.PATH || '';
    const latexPaths = [
        '/Library/TeX/texbin',           // MacTeX
        '/usr/local/texlive/2025/bin/universal-darwin',
        '/usr/local/texlive/2024/bin/universal-darwin',
        '/usr/local/texlive/2023/bin/universal-darwin',
        '/opt/homebrew/bin',             // Homebrew on Apple Silicon
        '/usr/local/bin',                // Homebrew on Intel
        '/usr/bin',
    ];

    const pathSet = new Set(currentPath.split(path.delimiter));
    for (const p of latexPaths) {
        if (!pathSet.has(p)) {
            pathSet.add(p);
        }
    }

    return Array.from(pathSet).join(path.delimiter);
}

/**
 * Run SyncTeX forward lookup: source line → PDF position
 *
 * @param texFile Path to the .tex file
 * @param line Line number (1-based)
 * @param column Column number (1-based, optional)
 * @param pdfFile Path to the .pdf file
 * @returns Position in PDF or null if lookup fails
 */
export async function runSyncTeXForward(
    texFile: string,
    line: number,
    column: number = 1,
    pdfFile: string
): Promise<SyncTeXForwardResult | null> {
    return new Promise((resolve) => {
        // synctex view -i "line:column:input" -o "output.pdf"
        const args = [
            'view',
            '-i', `${line}:${column}:${texFile}`,
            '-o', pdfFile
        ];

        const proc = spawn('synctex', args, {
            env: {
                ...process.env,
                PATH: getEnhancedPath(),
            }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
            // synctex can return 0 even with no results
            if (!stdout || !stdout.includes('SyncTeX result')) {
                console.error('SyncTeX forward failed: No valid results found');
                resolve(null);
                return;
            }

            // Parse SyncTeX output
            // Output format:
            // SyncTeX result begin
            // Output:...
            // Page:1
            // x:72.26999
            // y:686.12534
            // h:72.26999
            // v:706.12534
            // W:469.46999
            // H:0.0
            // before:...
            // offset:...
            // middle:...
            // after:...
            // SyncTeX result end

            const pageMatch = stdout.match(/^Page:(\d+)/m);
            const xMatch = stdout.match(/^x:([\d.-]+)/m);
            const yMatch = stdout.match(/^y:([\d.-]+)/m);
            const hMatch = stdout.match(/^h:([\d.-]+)/m);
            const vMatch = stdout.match(/^v:([\d.-]+)/m);
            const wMatch = stdout.match(/^W:([\d.-]+)/m);
            const HMatch = stdout.match(/^H:([\d.-]+)/m);

            if (!pageMatch) {
                console.error('SyncTeX: could not parse page from output');
                resolve(null);
                return;
            }

            // x,y are the coordinates of the matched point
            // h,v are additional position info
            // W,H are dimensions
            // Use h,v as they're more reliable for highlighting
            const page = parseInt(pageMatch[1], 10);
            const x = hMatch ? parseFloat(hMatch[1]) : (xMatch ? parseFloat(xMatch[1]) : 72);
            const y = vMatch ? parseFloat(vMatch[1]) : (yMatch ? parseFloat(yMatch[1]) : 700);
            const width = wMatch ? parseFloat(wMatch[1]) : 400;
            const height = HMatch ? parseFloat(HMatch[1]) : 12;

            resolve({
                page,
                x,
                y,
                width: width > 0 ? width : 400,
                height: height > 0 ? height : 12,
            });
        });

        proc.on('error', (err: Error) => {
            console.error('SyncTeX forward error:', err.message);
            resolve(null);
        });
    });
}

/**
 * Run SyncTeX inverse lookup: PDF position → source line
 *
 * @param pdfFile Path to the .pdf file
 * @param page Page number (1-based)
 * @param x X coordinate in PDF points (72 DPI), from left
 * @param y Y coordinate in PDF points (72 DPI), from bottom
 * @returns Source file and line or null if lookup fails
 */
export async function runSyncTeXInverse(
    pdfFile: string,
    page: number,
    x: number,
    y: number
): Promise<SyncTeXInverseResult | null> {
    return new Promise((resolve) => {
        // synctex edit -o "page:x:y:output.pdf"
        const args = [
            'edit',
            '-o', `${page}:${x}:${y}:${pdfFile}`
        ];

        const proc = spawn('synctex', args, {
            env: {
                ...process.env,
                PATH: getEnhancedPath(),
            }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
            // synctex can return 0 even with no results
            if (!stdout || !stdout.includes('SyncTeX result')) {
                resolve(null);
                return;
            }

            // Parse SyncTeX output
            // Output format:
            // SyncTeX result begin
            // Input:/path/to/file.tex
            // Line:42
            // Column:0
            // Offset:0
            // Context:...
            // SyncTeX result end

            const inputMatch = stdout.match(/^Input:(.+)$/m);
            const lineMatch = stdout.match(/^Line:(\d+)/m);
            const columnMatch = stdout.match(/^Column:(\d+)/m);
            const offsetMatch = stdout.match(/^Offset:(\d+)/m);

            if (!inputMatch || !lineMatch) {
                resolve(null);
                return;
            }

            const result = {
                file: inputMatch[1].trim(),
                line: parseInt(lineMatch[1], 10),
                column: columnMatch ? parseInt(columnMatch[1], 10) : 0,
                offset: offsetMatch ? parseInt(offsetMatch[1], 10) : 0,
            };

            resolve(result);
        });

        proc.on('error', (err: Error) => {
            console.error('SyncTeX inverse error:', err.message);
            resolve(null);
        });
    });
}

/**
 * Check if synctex command is available
 */
export async function isSyncTeXAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn('synctex', ['help'], {
            env: {
                ...process.env,
                PATH: getEnhancedPath(),
            }
        });

        proc.on('close', (code: number | null) => {
            resolve(code === 0 || code === 1); // synctex help returns 1 but exists
        });

        proc.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Check if .synctex.gz file exists for a PDF
 * @param pdfPath Path to the PDF file
 * @returns Path to synctex file if it exists, null otherwise
 */
export function getSyncTeXFilePath(pdfPath: string): string | null {
    const basePath = pdfPath.replace(/\.pdf$/, '');

    // Check common synctex file locations
    const possiblePaths = [
        `${basePath}.synctex.gz`,
        `${basePath}.synctex`,
    ];

    for (const syncPath of possiblePaths) {
        if (fs.existsSync(syncPath)) {
            return syncPath;
        }
    }

    return null;
}
