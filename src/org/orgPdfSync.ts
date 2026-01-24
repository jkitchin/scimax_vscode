/**
 * Org-mode PDF Sync
 * Provides bidirectional sync between org-mode files and PDF output
 * using the same PdfViewerPanel as LaTeX files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exportToLatex } from '../parser/orgExportLatex';
import { parseOrgFast } from '../parser/orgExportParser';
import { runSyncTeXForward, runSyncTeXInverse, getSyncTeXFilePath } from '../latex/synctexUtils';
import { PdfViewerPanel } from '../latex/pdfViewerPanel';

/**
 * Line mapping between org source and generated LaTeX
 */
export interface OrgLineMapping {
    orgLine: number;   // 1-indexed line in .org file
    texLine: number;   // 1-indexed line in generated .tex file
}

/**
 * Stored sync data for an org file
 */
interface OrgSyncData {
    orgPath: string;
    texPath: string;
    pdfPath: string;
    lineMappings: OrgLineMapping[];
    lastExportTime: number;
}

// Global storage for sync data per org file
const syncDataMap = new Map<string, OrgSyncData>();

/**
 * Export org content to LaTeX with line mappings
 * Returns the LaTeX content and a mapping from org lines to tex lines
 */
export function exportOrgToLatexWithMappings(
    orgContent: string,
    options: { toc?: boolean; standalone?: boolean } = {}
): { latex: string; lineMappings: OrgLineMapping[] } {
    const lineMappings: OrgLineMapping[] = [];

    // Parse org content to AST
    const doc = parseOrgFast(orgContent);

    // Export to LaTeX
    const latex = exportToLatex(doc, {
        toc: options.toc ?? false,
    });

    // Build line mappings by analyzing org and tex content
    const orgLines = orgContent.split('\n');
    const texLines = latex.split('\n');

    let texLineNum = 1;
    let inPreamble = true;

    // Find where \begin{document} is
    for (let i = 0; i < texLines.length; i++) {
        if (texLines[i].includes('\\begin{document}')) {
            texLineNum = i + 2; // Start after \begin{document}
            inPreamble = false;
            break;
        }
    }

    // Map org lines to tex lines
    // This is approximate but works well for most content
    for (let orgLineNum = 1; orgLineNum <= orgLines.length; orgLineNum++) {
        const orgLine = orgLines[orgLineNum - 1];

        // Skip front matter keywords (#+TITLE, #+AUTHOR, etc.)
        if (orgLine.match(/^#\+[A-Z_]+:/)) {
            continue;
        }

        // Skip comments
        if (orgLine.startsWith('#')) {
            continue;
        }

        // Skip empty lines in mapping but advance tex counter
        if (orgLine.trim() === '') {
            if (!inPreamble && texLineNum <= texLines.length) {
                // Empty lines often map to empty tex lines
                while (texLineNum <= texLines.length && texLines[texLineNum - 1].trim() === '') {
                    texLineNum++;
                }
            }
            continue;
        }

        // Map content lines
        if (!inPreamble && texLineNum <= texLines.length) {
            lineMappings.push({
                orgLine: orgLineNum,
                texLine: texLineNum,
            });
            texLineNum++;

            // Skip generated tex lines (like \end{...} after content)
            while (texLineNum <= texLines.length) {
                const texLine = texLines[texLineNum - 1];
                // Stop if we hit actual content
                if (texLine.trim() !== '' &&
                    !texLine.match(/^\\(end|item|begin)\{/) &&
                    !texLine.match(/^\\(par|\\)$/)) {
                    break;
                }
                texLineNum++;
            }
        }
    }

    return { latex, lineMappings };
}

/**
 * Get sync data for an org file
 */
export function getSyncData(orgPath: string): OrgSyncData | undefined {
    return syncDataMap.get(orgPath);
}

/**
 * Store sync data for an org file
 */
export function storeSyncData(data: OrgSyncData): void {
    syncDataMap.set(data.orgPath, data);
}

/**
 * Clear sync data for an org file
 */
export function clearSyncData(orgPath: string): void {
    syncDataMap.delete(orgPath);
}

/**
 * Map org line to tex line using stored mappings
 */
export function orgLineToTexLine(orgPath: string, orgLine: number): number | undefined {
    const data = syncDataMap.get(orgPath);
    if (!data) return undefined;

    // Find exact match
    const mapping = data.lineMappings.find(m => m.orgLine === orgLine);
    if (mapping) return mapping.texLine;

    // Find closest mapping before this line
    let closest: OrgLineMapping | undefined;
    for (const m of data.lineMappings) {
        if (m.orgLine <= orgLine) {
            if (!closest || m.orgLine > closest.orgLine) {
                closest = m;
            }
        }
    }

    if (closest) {
        // Estimate tex line based on offset from closest mapping
        const offset = orgLine - closest.orgLine;
        return closest.texLine + offset;
    }

    return undefined;
}

/**
 * Map tex line to org line using stored mappings
 */
export function texLineToOrgLine(orgPath: string, texLine: number): number | undefined {
    const data = syncDataMap.get(orgPath);
    if (!data) return undefined;

    // Find exact match
    const mapping = data.lineMappings.find(m => m.texLine === texLine);
    if (mapping) return mapping.orgLine;

    // Find closest mapping before this line
    let closest: OrgLineMapping | undefined;
    for (const m of data.lineMappings) {
        if (m.texLine <= texLine) {
            if (!closest || m.texLine > closest.texLine) {
                closest = m;
            }
        }
    }

    if (closest) {
        // Estimate org line based on offset from closest mapping
        const offset = texLine - closest.texLine;
        return closest.orgLine + offset;
    }

    return undefined;
}

/**
 * Forward sync: org position → PDF position
 */
export async function orgForwardSync(
    orgPath: string,
    orgLine: number,
    orgColumn: number = 1
): Promise<{ page: number; x: number; y: number; width: number; height: number } | null> {
    const data = syncDataMap.get(orgPath);
    if (!data) {
        return null;
    }

    // Map org line to tex line
    const texLine = orgLineToTexLine(orgPath, orgLine);
    if (!texLine) {
        return null;
    }

    // Run SyncTeX forward
    const result = await runSyncTeXForward(data.texPath, texLine, orgColumn, data.pdfPath);
    return result;
}

/**
 * Inverse sync: PDF position → org position
 */
export async function orgInverseSync(
    orgPath: string,
    page: number,
    x: number,
    y: number
): Promise<{ line: number; column: number } | null> {
    const data = syncDataMap.get(orgPath);
    if (!data) {
        return null;
    }

    // Run SyncTeX inverse
    const result = await runSyncTeXInverse(data.pdfPath, page, x, y);
    if (!result) {
        return null;
    }

    // Map tex line to org line
    const orgLine = texLineToOrgLine(orgPath, result.line);
    if (!orgLine) {
        return { line: result.line, column: result.column };
    }

    return { line: orgLine, column: result.column };
}

/**
 * Check if an org file has valid sync data
 */
export function hasSyncData(orgPath: string): boolean {
    const data = syncDataMap.get(orgPath);
    if (!data) return false;

    // Check if files still exist
    if (!fs.existsSync(data.texPath) || !fs.existsSync(data.pdfPath)) {
        return false;
    }

    // Check if synctex file exists
    if (!getSyncTeXFilePath(data.pdfPath)) {
        return false;
    }

    return true;
}
