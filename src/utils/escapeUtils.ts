/**
 * Shared escape utilities for HTML, LaTeX, and text normalization
 * Consolidates duplicate escape functions across the codebase
 */

/**
 * Normalize line endings to Unix-style (LF only)
 * Converts CRLF (\r\n) and standalone CR (\r) to LF (\n)
 * @param str - String to normalize
 * @returns String with consistent LF line endings
 */
export function normalizeLineEndings(str: string): string {
    if (str === null || str === undefined) return '';
    return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Escape special HTML characters to prevent XSS and rendering issues
 * @param str - String to escape
 * @returns Escaped string safe for HTML insertion
 */
export function escapeHtml(str: string): string {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape special LaTeX characters
 * @param str - String to escape
 * @returns Escaped string safe for LaTeX
 */
export function escapeLatex(str: string): string {
    if (str === null || str === undefined) return '';
    // Use a placeholder for backslashes first to avoid double escaping
    const BACKSLASH_PLACEHOLDER = '\x00BACKSLASH\x00';
    return String(str)
        .replace(/\\/g, BACKSLASH_PLACEHOLDER)
        .replace(/[&%$#_{}]/g, '\\$&')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\textbackslash{}');
}

/**
 * Escape string for the specified format
 * Unified function for escaping in different output formats
 * @param str - String to escape
 * @param format - Target format ('html' or 'latex')
 * @returns Escaped string
 */
export function escapeString(str: string, format: 'html' | 'latex'): string {
    if (format === 'html') {
        return escapeHtml(str);
    } else if (format === 'latex') {
        return escapeLatex(str);
    }
    return str;
}
