/**
 * Local file references in slide Markdown, so slides keep their images when
 * they are copied from one deck and pasted into a deck in another folder.
 *
 * Copy writes every relative reference as an absolute path
 * (`absolutizeLinks`); paste writes them relative to the target deck again
 * (`relativizeLinks`), optionally pointing at copies of the images made next
 * to the target (`planAssetCopies`). Pasting back into the same deck gives the
 * original relative paths.
 *
 * References found:
 *   - Markdown images and links: `![bg left](figs/a.png)`, `[text](<b c.pdf>)`
 *   - Link reference definitions: `[id]: figs/a.png`
 *   - HTML attributes: `<img src="...">`, `<video poster="...">`, `<a href="...">`
 *   - CSS `url(...)`, as in `<!-- _backgroundImage: url(figs/a.png) -->`
 * Text in code fences and inline code is left alone, as are URLs with a
 * scheme (`https:`, `data:`), `//host/...` and `#anchors`.
 *
 * This module has no VS Code dependency so it can be unit tested directly.
 */

import * as path from 'path';

/** `asset`: shown on the slide (an image, video, background); `link`: only linked to. */
export type LinkKind = 'asset' | 'link';

/** New path for a local reference (decoded, as on disk), or undefined to keep it. */
type Rewrite = (target: string, kind: LinkKind) => string | undefined;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN = /(`+)[\s\S]*?[^`]\1(?!`)|(`+)\2(?!`)/g;
const MARKDOWN_LINK = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>\n]*>|[^\s()<>]+(?:\([^\s()]*\)[^\s()]*)*)/g;
const REFERENCE_DEFINITION = /^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>\n]*>|\S+)/;
const HTML_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
const HTML_ATTRIBUTE = /(\s(?:src|poster|href|data)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/g;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

function isLocal(target: string): boolean {
    return target !== '' && !target.startsWith('#') && !target.startsWith('//') && !SCHEME.test(target);
}

function decode(target: string): string {
    try {
        return decodeURI(target);
    } catch {
        return target;
    }
}

/**
 * Rewrite one reference as written in the source. `literal` is true where
 * spaces can be written as they are (`<...>` destinations, quoted values).
 */
function rewriteTarget(written: string, kind: LinkKind, rewrite: Rewrite, literal: boolean): string {
    // A query or fragment (`a.svg#icon`) stays on the rewritten path.
    const cut = written.search(/[?#]/);
    const file = cut > 0 ? written.slice(0, cut) : written;
    const suffix = cut > 0 ? written.slice(cut) : '';
    if (!isLocal(written)) {
        return written;
    }
    const next = rewrite(literal ? file : decode(file), kind);
    if (next === undefined) {
        return written;
    }
    const slashed = next.split(path.sep).join('/');
    return (literal ? slashed : slashed.replace(/ /g, '%20')) + suffix;
}

function rewriteSegment(text: string, rewrite: Rewrite): string {
    return text
        .replace(MARKDOWN_LINK, (match: string, bang: string, _label: string, dest: string) => {
            const angled = dest.startsWith('<');
            const inner = angled ? dest.slice(1, -1) : dest;
            const next = rewriteTarget(inner, bang ? 'asset' : 'link', rewrite, angled);
            return match.slice(0, match.length - dest.length) + (angled ? `<${next}>` : next);
        })
        .replace(HTML_TAG, (tag: string, name: string) => {
            const kind: LinkKind = name.toLowerCase() === 'a' ? 'link' : 'asset';
            return tag.replace(HTML_ATTRIBUTE, (_m: string, attr: string, double?: string, single?: string) => {
                const quote = double !== undefined ? '"' : '\'';
                const next = rewriteTarget(double ?? single ?? '', kind, rewrite, true);
                return `${attr}${quote}${next}${quote}`;
            });
        })
        .replace(CSS_URL, (_m: string, double?: string, single?: string, bare?: string) => {
            const quote = double !== undefined ? '"' : single !== undefined ? '\'' : '';
            const next = rewriteTarget(double ?? single ?? bare ?? '', 'asset', rewrite, quote !== '');
            return `url(${quote}${next}${quote})`;
        });
}

/** Rewrite a line outside a code fence, skipping inline code. */
function rewriteLine(line: string, rewrite: Rewrite): string {
    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition) {
        const dest = definition[2];
        const angled = dest.startsWith('<');
        const next = rewriteTarget(angled ? dest.slice(1, -1) : dest, 'link', rewrite, angled);
        return definition[1] + (angled ? `<${next}>` : next) + line.slice(definition[0].length);
    }
    let out = '';
    let from = 0;
    for (const span of line.matchAll(CODE_SPAN)) {
        out += rewriteSegment(line.slice(from, span.index), rewrite) + span[0];
        from = (span.index ?? 0) + span[0].length;
    }
    return out + rewriteSegment(line.slice(from), rewrite);
}

/** Apply `rewrite` to every local file reference in `text`. */
export function rewriteLinks(text: string, rewrite: Rewrite): string {
    let fence: string | null = null;
    return text.split('\n').map(line => {
        const marker = FENCE.exec(line)?.[1];
        if (fence !== null) {
            if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
                fence = null;
            }
            return line;
        }
        if (marker) {
            fence = marker;
            return line;
        }
        return rewriteLine(line, rewrite);
    }).join('\n');
}

/** `text` with relative references made absolute, taken from `fromDir`. */
export function absolutizeLinks(text: string, fromDir: string): string {
    return rewriteLinks(text, target => path.isAbsolute(target) ? undefined : path.resolve(fromDir, target));
}

/**
 * `text` with absolute references made relative to `toDir`. `moved` maps an
 * absolute path to the copy to point at instead.
 */
export function relativizeLinks(text: string, toDir: string, moved: ReadonlyMap<string, string> = new Map()): string {
    return rewriteLinks(text, target => {
        if (!path.isAbsolute(target)) {
            return undefined;
        }
        const file = moved.get(path.resolve(target)) ?? target;
        const relative = path.relative(toDir, file);
        // On Windows a file on another drive has no relative path.
        return path.isAbsolute(relative) ? file : relative;
    });
}

/** Absolute paths of the assets (images, videos, backgrounds) `text` shows, without duplicates. */
export function assetTargets(text: string): string[] {
    const found = new Set<string>();
    rewriteLinks(text, (target, kind) => {
        if (kind === 'asset' && path.isAbsolute(target)) {
            found.add(path.resolve(target));
        }
        return undefined;
    });
    return [...found];
}

/** Whether `file` is inside `dir` (at any depth). */
export function isInside(file: string, dir: string): boolean {
    const relative = path.relative(dir, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Where to copy each asset so a deck in `targetDir` can use it. Assets already
 * inside `targetDir` are not copied. One inside `sourceDir` (the copied deck's
 * folder, when known) keeps its path relative to the deck, so `figs/a.png`
 * goes to `targetDir/figs/a.png`; any other goes to `targetDir/<folder>/`.
 *
 * @returns Absolute source path to absolute destination path.
 */
export function planAssetCopies(
    assets: string[], targetDir: string, sourceDir: string | undefined, folder = 'figs',
): Map<string, string> {
    const plan = new Map<string, string>();
    for (const asset of assets) {
        if (isInside(asset, targetDir)) {
            continue;
        }
        const destination = sourceDir !== undefined && isInside(asset, sourceDir)
            ? path.join(targetDir, path.relative(sourceDir, asset))
            : path.join(targetDir, folder, path.basename(asset));
        plan.set(asset, destination);
    }
    return plan;
}

/** `file` with `-1`, `-2`, ... before its extension, for the n-th alternative name. */
export function numberedName(file: string, n: number): string {
    const ext = path.extname(file);
    return `${file.slice(0, file.length - ext.length)}-${n}${ext}`;
}
