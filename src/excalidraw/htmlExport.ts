/**
 * Inline Excalidraw drawings into exported HTML with working links.
 *
 * A bare link to a drawing (`[[file:diagrams/flow.excalidraw.svg]]`, or a
 * `.excalidraw` scene, which is rendered here) becomes an inline <svg>.
 * Links on its elements are rewritten for the web: scimax org-link URIs point
 * at the exported HTML of the linked org file (`notes.org::*Results` becomes
 * `notes.html#results`), web links stay, and links that only work inside
 * VS Code (`command:`, `cmd:`, `cite:`, ...) are dropped.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseOrgLinkUri, parseSceneFile, prepareSvgForHtml, renderSceneSvg } from './scene';

/** Largest drawing inlined; bigger files keep the plain <img>/<a> export. */
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export const EXCALIDRAW_LINK_RE = /\.excalidraw(\.json|\.svg)?$/i;

export interface ExcalidrawHtmlOptions {
    /** Folder of the org file being exported; the HTML is written next to it. */
    baseDir: string;
    /**
     * Href for an org file link relative to baseDir, e.g. `notes.org::*Results`
     * (the exporter's own mapping, so anchors match the exported headings).
     */
    fileHref: (link: string) => string;
}

function expandHome(p: string): string {
    return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

function toPosix(p: string): string {
    return p.split(path.sep).join('/');
}

/** Relative path from baseDir, so the exported HTML links stay portable. */
function relativeTo(baseDir: string, absolute: string): string {
    const rel = toPosix(path.relative(baseDir, absolute));
    return rel || '.';
}

/** Web href for an org link followed from `linkDir`, or null when it has none. */
export function orgLinkToHtmlHref(
    orgLink: string,
    linkDir: string,
    fromFile: string | undefined,
    options: ExcalidrawHtmlOptions
): string | null {
    let link = orgLink.trim();
    const bracket = link.match(/^\[\[(.+?)\](?:\[.*\])?\]$/s);
    if (bracket) link = bracket[1];

    if (/^(https?|mailto):/i.test(link)) return link;
    if (/^doi:/i.test(link)) return `https://doi.org/${link.slice(4)}`;
    if (/^id:/i.test(link)) return `#${link.slice(3)}`;

    // *Heading / #custom-id are searches in the file the link was written in
    if (/^[*#]/.test(link)) {
        if (!fromFile) return options.fileHref(`::${link}`);
        return options.fileHref(`${relativeTo(options.baseDir, fromFile)}::${link}`);
    }

    const isFile = /^file:/i.test(link) || link.includes('/') || link.includes('::')
        || /\.(org|md|html|pdf|png|jpe?g|svg|txt)$/i.test(link);
    if (!isFile) return null;

    const [filePart, ...search] = link.replace(/^file:/i, '').split('::');
    const absolute = path.resolve(linkDir, expandHome(filePart));
    const rel = relativeTo(options.baseDir, absolute);
    return options.fileHref(search.length ? `${rel}::${search.join('::')}` : rel);
}

/** Rewrite one href found in a drawing at `drawingDir`. */
export function rewriteDrawingHref(href: string, drawingDir: string, options: ExcalidrawHtmlOptions): string | null {
    const org = parseOrgLinkUri(href);
    if (org) {
        const fromFile = org.from
            ? path.resolve(options.baseDir, expandHome(org.from))
            : undefined;
        const linkDir = fromFile ? path.dirname(fromFile) : drawingDir;
        return orgLinkToHtmlHref(org.link, linkDir, fromFile, options);
    }
    if (/^(https?|mailto):/i.test(href) || href.startsWith('#')) return href;
    if (/^[a-z][\w+.-]*:/i.test(href)) return null; // vscode:, command:, file:, ...
    // A plain relative path in the drawing is relative to the drawing
    return relativeTo(options.baseDir, path.resolve(drawingDir, href));
}

/**
 * Inline HTML for a link to a drawing, or null to fall back to the normal
 * link export (file missing, too big, or not a readable scene).
 */
export function excalidrawHtml(linkPath: string, options: ExcalidrawHtmlOptions): string | null {
    const file = path.resolve(options.baseDir, expandHome(linkPath.replace(/^file:/i, '')));
    let content: string;
    try {
        if (fs.statSync(file).size > MAX_INLINE_BYTES) return null;
        content = fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }

    let svg: string | null;
    if (/\.svg$/i.test(file)) {
        svg = /<svg[\s>]/i.test(content) ? content : null;
    } else {
        const scene = parseSceneFile(content, file);
        svg = scene ? renderSceneSvg(scene) : null;
    }
    if (!svg) return null;

    const drawingDir = path.dirname(file);
    const inline = prepareSvgForHtml(svg, href => rewriteDrawingHref(href, drawingDir, options));
    // Scale down to the page width instead of overflowing it
    const responsive = inline.replace(/<svg\b/i, '<svg style="max-width: 100%; height: auto"');
    return `<span class="org-excalidraw">${responsive}</span>`;
}
