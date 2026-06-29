/**
 * Shared escape utilities for HTML, LaTeX, and text normalization
 * Consolidates duplicate escape functions across the codebase
 */

import { NON_ASCII_MAP, LATEX_UNICODE_DECLARATIONS } from './nonAsciiMap';

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
    const escaped = String(str)
        .replace(/\\/g, BACKSLASH_PLACEHOLDER)
        .replace(/[&%$#_{}]/g, '\\$&')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\textbackslash{}');
    return unicodeToLatex(escaped);
}

/**
 * Translate non-ASCII Unicode characters to LaTeX macros using NON_ASCII_MAP.
 *
 * This must run AFTER the special-character escaping above so the macros it
 * inserts (which contain $, \, {, }) are not themselves re-escaped. Characters
 * not present in the map (and all ASCII) pass through unchanged, so behavior is
 * only changed for known Unicode characters. Iterating with for..of yields whole
 * code points, so astral characters are handled safely.
 *
 * @param str - String that has already had LaTeX specials escaped
 * @returns String with known Unicode characters replaced by LaTeX macros
 */
export function unicodeToLatex(str: string): string {
    if (str === null || str === undefined) return '';
    // Fast path: pure ASCII needs no translation. Any non-ASCII character has a
    // UTF-16 code unit >= 0x80 (this also catches surrogate halves of astral chars).
    if (!/[\u0080-\uFFFF]/.test(str)) return str;
    let result = '';
    for (const ch of str) {
        const mapping = NON_ASCII_MAP[ch];
        result += mapping ? mapping.latex : ch;
    }
    return result;
}

/**
 * Sanitize a name into a LaTeX label/ref key that is safe and stable.
 *
 * A \label / \ref key must avoid catcode-special and fragile characters
 * (%, #, \, {, }, ~, ^, spaces, parentheses, …); a raw "%" in particular turns
 * the rest of the line into a comment. Characters outside a conservative safe
 * set are mapped to '-'. Apply this to BOTH the \label and the \ref/\hyperref
 * of the same target so they always match — e.g. a table named
 * "tab:weird name (v2)" yields the same key on both sides.
 *
 * Only the auto-generated label/ref of #+NAME:-d elements should use this;
 * user-authored org-ref links (ref:/label:/eqref:) are passed through verbatim.
 */
export function sanitizeLatexLabel(name: string): string {
    if (!name) return name;
    return name.replace(/[^A-Za-z0-9:_.+-]/g, '-');
}

/**
 * Escape a URL for the argument of \href. hyperref reads the URL almost
 * verbatim; only % and # (and a literal backslash) must be escaped. General
 * LaTeX escaping would corrupt links by turning _ & ~ into \_ \& \~. Use the
 * raw URL for \url (which is fully verbatim) and this for \href.
 */
export function escapeLatexUrl(url: string): string {
    if (!url) return url;
    return url
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/#/g, '\\#');
}

/**
 * Return the distinct non-ASCII characters in `text` that the LaTeX backend can
 * neither translate (NON_ASCII_MAP) nor declare for verbatim/pdflatex
 * (LATEX_UNICODE_DECLARATIONS). Such characters are emitted raw and only render
 * on Unicode-aware engines/fonts, so the export layer warns about them.
 */
export function findUnmappedNonAscii(text: string): string[] {
    if (text === null || text === undefined) return [];
    const set = new Set<string>();
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined && cp > 127 && !NON_ASCII_MAP[ch] && !LATEX_UNICODE_DECLARATIONS[ch]) {
            set.add(ch);
        }
    }
    return [...set];
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
