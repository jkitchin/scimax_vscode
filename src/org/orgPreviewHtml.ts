/**
 * Pure helpers for the org preview webview (no VS Code dependency, so they
 * can be unit tested).
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml } from '../utils/escapeUtils';

/** The parts of an exported HTML page the preview reuses */
export interface ExportedPageParts {
    /** Document title (from <title>) */
    title: string;
    /** <style> blocks and stylesheet <link>s from <head>, concatenated */
    styles: string;
    /** Inner HTML of <body> */
    body: string;
}

/**
 * Split a full exported HTML page into the pieces the preview needs.
 *
 * Scripts in <head> are dropped on purpose: the preview page loads MathJax and
 * highlight.js itself and only runs nonce'd scripts, so scripts from the
 * document (e.g. #+HTML_HEAD) never execute.
 */
export function splitExportedHtml(html: string): ExportedPageParts {
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const head = headMatch ? headMatch[1] : '';

    const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const styleParts: string[] = [];
    const styleRe = /<style[^>]*>[\s\S]*?<\/style>|<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = styleRe.exec(head)) !== null) {
        styleParts.push(m[0]);
    }

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : (headMatch ? '' : html);

    return { title, styles: styleParts.join('\n'), body };
}

/** Decode the HTML entities the exporter produces in attribute values */
function unescapeAttr(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/**
 * Resolve an <img src> value to an absolute local file path, or return
 * undefined when it is not a local file (http, data, protocol-relative, ...).
 */
export function resolveLocalResource(src: string, baseDir: string): string | undefined {
    const value = src.trim();
    if (!value || value.startsWith('#') || value.startsWith('//')) {
        return undefined;
    }
    if (/^file:/i.test(value)) {
        try {
            // file:///abs/path URLs
            if (/^file:\/\//i.test(value)) {
                return path.resolve(fileURLToPath(value));
            }
        } catch {
            // Fall through to org-style file:relative/path
        }
        const rest = value.replace(/^file:/i, '');
        const expanded = expandHome(rest);
        return path.resolve(baseDir, expanded);
    }
    // Any other scheme (http:, https:, data:, vscode-webview:, ...). A single
    // letter followed by ':' is a Windows drive, not a scheme.
    if (/^[a-z][a-z0-9+.-]+:/i.test(value)) {
        return undefined;
    }
    const expanded = expandHome(value);
    return path.resolve(baseDir, expanded);
}

function expandHome(p: string): string {
    if (p === '~' || p.startsWith('~/')) {
        const home = process.env.HOME || process.env.USERPROFILE || '';
        return path.join(home, p.slice(1));
    }
    return p;
}

/**
 * Rewrite local image sources so the webview can load them.
 *
 * @param toWebviewUri maps an absolute file path to a URI string the webview
 *   is allowed to load (webview.asWebviewUri)
 */
export function rewriteResourceUrls(
    html: string,
    baseDir: string,
    toWebviewUri: (absPath: string) => string
): string {
    return html.replace(
        /(<(?:img|source|video|audio)\b[^>]*?\bsrc=)(["'])(.*?)\2/gi,
        (whole, prefix: string, quote: string, rawSrc: string) => {
            const local = resolveLocalResource(unescapeAttr(rawSrc), baseDir);
            if (!local) {
                return whole;
            }
            return `${prefix}${quote}${escapeHtml(toWebviewUri(local))}${quote}`;
        }
    );
}

/** Options for building the preview page shell */
export interface PreviewPageOptions {
    /** webview.cspSource */
    cspSource: string;
    /** Nonce for the preview's own scripts */
    nonce: string;
    /** Exported page parts (body already rewritten for the webview) */
    parts: ExportedPageParts;
    /** URI of media/orgPreview/orgPreview.css */
    styleUri: string;
    /** URI of media/orgPreview/orgPreview.js */
    scriptUri: string;
    /** Initial state handed to the preview script */
    state: { uri: string; line: number; scrollPreviewWithEditor: boolean; scrollEditorWithPreview: boolean };
}

const MATHJAX_URL = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
const HLJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0';

/**
 * Build the full preview page. Only the preview's own nonce'd scripts (and
 * the MathJax / highlight.js CDN scripts it loads) may run.
 */
export function buildPreviewPage(opts: PreviewPageOptions): string {
    const { cspSource, nonce, parts, styleUri, scriptUri, state } = opts;
    const csp = [
        `default-src 'none'`,
        `img-src ${cspSource} https: data:`,
        `media-src ${cspSource} https: data:`,
        `style-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
        `font-src ${cspSource} https://cdn.jsdelivr.net https://cdnjs.cloudflare.com data:`,
        `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com`,
    ].join('; ');
    const stateJson = escapeHtml(JSON.stringify(state));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${parts.title}</title>
${parts.styles}
<link rel="stylesheet" id="hljs-light" href="${HLJS_URL}/styles/github.min.css" />
<link rel="stylesheet" id="hljs-dark" href="${HLJS_URL}/styles/github-dark.min.css" disabled />
<link rel="stylesheet" href="${styleUri}" />
<meta id="org-preview-state" data-state="${stateJson}">
<script nonce="${nonce}" src="${scriptUri}"></script>
<script nonce="${nonce}" src="${HLJS_URL}/highlight.min.js"></script>
<script nonce="${nonce}" id="MathJax-script" async src="${MATHJAX_URL}"></script>
</head>
<body>
<div id="org-preview-root">
${parts.body}
</div>
</body>
</html>`;
}
