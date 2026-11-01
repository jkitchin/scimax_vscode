/**
 * Markdown link helpers: finding `[text](target)` links on a line, heading
 * anchors (GitHub-style slugs), and converting the org-style links that
 * storeLink records into markdown link targets.
 */

export interface MarkdownLink {
    start: number;        // column of `[` (or `!` for an image)
    end: number;          // column just past `)`
    text: string;         // link text or image alt text
    target: string;       // destination without angle brackets or title
    image: boolean;
}

// [text](dest) or ![alt](dest "title"); dest may be <...> to allow spaces
const MARKDOWN_LINK = /(!?)\[((?:[^[\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/**
 * Find the inline markdown link or image whose text spans column `col`.
 */
export function findMarkdownLinkAt(line: string, col: number): MarkdownLink | null {
    MARKDOWN_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKDOWN_LINK.exec(line)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (col >= start && col <= end) {
            let target = m[3];
            if (target.startsWith('<') && target.endsWith('>')) {
                target = target.slice(1, -1);
            }
            return { start, end, text: m[2], target, image: m[1] === '!' };
        }
    }
    return null;
}

/**
 * Format a markdown link. A destination with spaces is wrapped in <...>.
 */
export function formatMarkdownLink(target: string, description?: string): string {
    const dest = /[\s()]/.test(target) ? `<${target}>` : target;
    return `[${description || target}](${dest})`;
}

/**
 * GitHub-style heading anchor: lower case, punctuation removed, spaces to
 * hyphens. `## Results & Discussion` -> `results--discussion`.
 */
export function markdownHeadingSlug(title: string): string {
    return title
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-');
}

/**
 * Title of an ATX heading line without the `#` marks, a closing `###`
 * sequence, or a Pandoc `{#id .class}` attribute block. Returns null if the
 * line is not a heading.
 */
export function markdownHeadingTitle(line: string): { title: string; id?: string } | null {
    const m = line.match(/^#{1,6}(?:\s+(.*?))?\s*$/);
    if (!m) return null;
    let title = (m[1] ?? '').replace(/\s+#+\s*$/, '').replace(/^#+$/, '');
    let id: string | undefined;
    const attrs = title.match(/\s*\{([^}]*)\}\s*$/);
    if (attrs) {
        id = attrs[1].match(/#([\w:.-]+)/)?.[1];
        title = title.slice(0, attrs.index).trimEnd();
    }
    return { title: title.trim(), id };
}

/**
 * Convert a stored org-style link (`*Heading`, `file:x.md::*Heading`,
 * `file:x.org::#id`, `file:x.md::12`) into a markdown link destination
 * (`#heading`, `x.md#heading`, `x.org#id`, `x.md`). Other links (URLs,
 * `cite:`, `id:`) are returned unchanged.
 */
export function orgLinkToMarkdownTarget(url: string): string {
    if (url.startsWith('*')) {
        return '#' + markdownHeadingSlug(url.slice(1));
    }
    if (!url.startsWith('file:')) {
        return url;
    }
    const [file, search] = url.slice('file:'.length).split('::');
    if (!search) return file;
    if (search.startsWith('*')) return `${file}#${markdownHeadingSlug(search.slice(1))}`;
    if (search.startsWith('#')) return `${file}${search}`;
    return file;
}
