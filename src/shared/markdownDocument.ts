/**
 * Per-document helpers for markdown files that need the VS Code document.
 *
 * The non-prose mask (fenced code, YAML front matter, HTML comments) is cached
 * per document version, so callers on every cursor move stay cheap.
 */

import * as vscode from 'vscode';
import { isMarkdownLike } from './markdownLike';
import { markdownNonProseMask } from './markdownFences';

const maskCache = new WeakMap<vscode.TextDocument, { version: number; mask: boolean[] }>();

function nonProseMask(document: vscode.TextDocument): boolean[] {
    let cached = maskCache.get(document);
    if (!cached || cached.version !== document.version) {
        cached = { version: document.version, mask: markdownNonProseMask(document.getText().split(/\r?\n/)) };
        maskCache.set(document, cached);
    }
    return cached.mask;
}

/**
 * True if the line of a markdown document is code, front matter or an HTML
 * comment, so a `#` there is not a heading. Always false for other languages.
 */
export function isMarkdownNonProseLine(document: vscode.TextDocument, lineNumber: number): boolean {
    if (!isMarkdownLike(document.languageId)) return false;
    return nonProseMask(document)[lineNumber] ?? false;
}

const MD_HEADING = /^(#{1,6})(?:\s|$)/;

/**
 * Level (1-6) of the ATX heading on a markdown line, or 0 if the line is not a
 * heading (including `#` lines inside code, front matter or comments).
 */
export function markdownHeadingLevel(document: vscode.TextDocument, lineNumber: number): number {
    if (isMarkdownNonProseLine(document, lineNumber)) return 0;
    const match = document.lineAt(lineNumber).text.match(MD_HEADING);
    return match ? match[1].length : 0;
}
