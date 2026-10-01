/**
 * Presenter tools for Marp HTML decks: make a deck self-contained and add the
 * pen, laser, notes and save tools (media/marpPresent/presenter.js) and, when
 * the deck has ```python run cells, the Pyodide cell runner (pycells.js).
 *
 * Everything local that the page references is inlined, so the HTML can be
 * emailed, moved or opened offline on its own:
 *
 * - <img>/<video>/<audio>/<source> src and poster, and url(...) in styles
 *   (Marp's ![bg] images) -> data URIs
 * - <iframe src="local.html"> -> srcdoc, with that page's own files inlined
 * - <script src>, <link rel=stylesheet href> -> inline
 * - KaTeX fonts from cdn.jsdelivr.net -> woff2 data URIs (fetched by the caller)
 *
 * It then adds the deck's Markdown as window.__MARP_SOURCE__ (for the `m`
 * key), an empty ink block, and a base64 copy of the finished page, which the
 * `s` key writes back out with the ink filled in.
 *
 * No VS Code dependency, so it can be unit tested.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Marks the vendored scripts carry in their first line, so a page is never given them twice. */
const PRESENTER_MARK = 'marp-present: presenter tools';
const PYCELLS_MARK = 'marp-present: live, editable Python cells';
const INK_EMPTY = '<script type="application/json" id="marp-ink-data">{}</script>';
const SELF_EMPTY = '<script type="text/plain" id="marp-self"></script>';
const MAX_IFRAME_DEPTH = 3;

const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
    '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.htm': 'text/html',
    '.json': 'application/json', '.pdf': 'application/pdf', '.txt': 'text/plain',
};

/** The vendored scripts, as file paths (media/marpPresent/...). */
export interface PresenterAssets {
    presenter: string;
    marked: string;
    pycells: string;
    codemirror: string;
}

/** What inlining did. */
export interface BundleReport {
    /** Counts by kind: "images/media", "fonts", "scripts", ... */
    counts: Record<string, number>;
    /** Remote URLs the page still loads (other than KaTeX fonts). */
    external: string[];
    /** Local references that were not found. */
    missing: string[];
}

export interface InlineOptions {
    /** Download a font (a KaTeX woff2 URL); the caller caches it. Without it, fonts stay remote. */
    fetchFont?: (url: string) => Promise<Buffer>;
}

/** Content that can sit inside <script>...</script> without closing it early. */
export function scriptSafe(text: string): string {
    return text.replace(/<\/(script)/gi, '<\\/$1');
}

/** True for a reference to a local file (not a URL with a scheme, an anchor or //host). */
export function isLocalRef(ref: string): boolean {
    return ref.trim() !== '' && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref);
}

function unescapeHtml(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function escapeAttr(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/** String.replace with an async replacer (matches are replaced in order). */
async function replaceAsync(
    text: string,
    re: RegExp,
    replacer: (match: RegExpExecArray) => Promise<string>
): Promise<string> {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const global = new RegExp(re.source, flags);
    const parts: string[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
        parts.push(text.slice(last, m.index), await replacer(m));
        last = m.index + m[0].length;
        if (m[0].length === 0) {
            global.lastIndex++;
        }
    }
    parts.push(text.slice(last));
    return parts.join('');
}

class Inliner {
    readonly report: BundleReport = { counts: {}, external: [], missing: [] };
    private readonly external = new Set<string>();
    private readonly fonts = new Map<string, string>();

    constructor(private readonly options: InlineOptions) {}

    finish(): BundleReport {
        this.report.external = [...this.external].filter(url => !url.includes('katex')).sort();
        return this.report;
    }

    private note(what: string): void {
        this.report.counts[what] = (this.report.counts[what] ?? 0) + 1;
    }

    private remote(ref: string): void {
        if (/^https?:/i.test(ref)) {
            this.external.add(ref);
        }
    }

    private resolve(base: string, ref: string): string | undefined {
        let rel = ref.split('#')[0].split('?')[0];
        try {
            rel = decodeURIComponent(rel);
        } catch {
            // Keep a reference with a stray % as written.
        }
        const file = path.resolve(base, rel);
        try {
            if (fs.statSync(file).isFile()) {
                return file;
            }
        } catch {
            // Reported below.
        }
        this.report.missing.push(`${ref} (relative to ${base})`);
        return undefined;
    }

    private dataUri(file: string): string {
        const mime = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        this.note('images/media');
        return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    }

    private async fontUri(url: string): Promise<string | undefined> {
        if (!this.options.fetchFont) {
            return undefined;
        }
        let uri = this.fonts.get(url);
        if (!uri) {
            uri = `data:font/woff2;base64,${(await this.options.fetchFont(url)).toString('base64')}`;
            this.fonts.set(url, uri);
        }
        this.note('fonts');
        return uri;
    }

    /** Inline every local reference in an HTML document located in directory `base`. */
    async inline(text: string, base: string, depth = 0): Promise<string> {
        // Rewrite markup and CSS only: never touch the inside of a <script> element.
        const chunks = text.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/i);
        const out: string[] = [];
        for (const chunk of chunks) {
            if (/^<script\b/i.test(chunk)) {
                out.push(this.inlineScript(chunk, base));
            } else {
                out.push(await this.markup(chunk, base, depth));
            }
        }
        return out.join('');
    }

    private inlineScript(chunk: string, base: string): string {
        return chunk.replace(/<script([^>]*?)\s+src="([^"]+)"([^>]*)>\s*<\/script>/i, (whole, before: string, rawRef: string, after: string) => {
            const ref = unescapeHtml(rawRef);
            if (!isLocalRef(ref)) {
                this.external.add(ref);
                return whole;
            }
            const file = this.resolve(base, ref);
            if (!file) {
                return whole;
            }
            this.note('scripts');
            return `<script${before}${after}>${scriptSafe(fs.readFileSync(file, 'utf8'))}</script>`;
        });
    }

    private async markup(part: string, base: string, depth: number): Promise<string> {
        part = await replaceAsync(part, /<iframe([^>]*?)\s+src="([^"]+)"/i, async m => {
            const ref = unescapeHtml(m[2]);
            if (!isLocalRef(ref) || depth > MAX_IFRAME_DEPTH) {
                return m[0];
            }
            const file = this.resolve(base, ref);
            if (!file) {
                return m[0];
            }
            const inner = await this.inline(fs.readFileSync(file, 'utf8'), path.dirname(file), depth + 1);
            this.note('iframes');
            return `<iframe${m[1]} srcdoc="${escapeAttr(inner)}"`;
        });
        const stylesheet = async (m: RegExpExecArray): Promise<string> => {
            const ref = unescapeHtml(m[1]);
            if (!isLocalRef(ref)) {
                this.external.add(ref);
                return m[0];
            }
            const file = this.resolve(base, ref);
            if (!file) {
                return m[0];
            }
            this.note('stylesheets');
            return `<style>${await this.inlineCss(fs.readFileSync(file, 'utf8'), path.dirname(file))}</style>`;
        };
        part = await replaceAsync(part, /<link\b[^>]*?rel="stylesheet"[^>]*?href="([^"]+)"[^>]*>/i, stylesheet);
        part = await replaceAsync(part, /<link\b[^>]*?href="([^"]+)"[^>]*?rel="stylesheet"[^>]*>/i, stylesheet);
        part = part.replace(/\b(src|poster)=(["'])([^"']+)\2/g, (whole, attr: string, quote: string, rawRef: string) => {
            if (!isLocalRef(rawRef)) {
                this.remote(rawRef);
                return whole;
            }
            const file = this.resolve(base, unescapeHtml(rawRef));
            return file ? `${attr}=${quote}${this.dataUri(file)}${quote}` : whole;
        });
        return this.inlineCss(part, base);
    }

    async inlineCss(text: string, base: string): Promise<string> {
        // KaTeX fonts: keep only the woff2 source, inlined.
        text = await replaceAsync(
            text,
            /src:url\((['"]?)(https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^'")]+\.woff2)\1\) format\((["'])woff2\3\)(?:,\s*url\([^)]*\) format\([^)]*\))*/,
            async m => {
                const uri = await this.fontUri(m[2]);
                return uri ? `src:url(${uri}) format("woff2")` : m[0];
            }
        );
        return text.replace(/url\((&quot;|['"]?)([^'")&]+?)\1\)/g, (whole, quote: string, rawRef: string) => {
            const ref = unescapeHtml(rawRef);
            if (!isLocalRef(ref)) {
                this.remote(ref);
                return whole;
            }
            const file = this.resolve(base, ref);
            return file ? `url(${quote}${this.dataUri(file)}${quote})` : whole;
        });
    }
}

/** Inline the local files an HTML page in directory `baseDir` refers to. */
export async function inlineDeck(
    html: string,
    baseDir: string,
    options: InlineOptions = {}
): Promise<{ html: string; report: BundleReport }> {
    const inliner = new Inliner(options);
    const out = await inliner.inline(html, baseDir);
    return { html: out, report: inliner.finish() };
}

/** True if the rendered deck has ```python run cells (marked by engine.cjs). */
export function hasRunCells(html: string): boolean {
    return html.includes('<pre data-run=');
}

/**
 * Add the presenter tools (and the Python cell runner, if the deck has run
 * cells) before the last </body>. Scripts already in the page are not added again.
 */
export function addPresenterScripts(html: string, assets: PresenterAssets): string {
    const files: string[] = [];
    if (!html.includes(PRESENTER_MARK)) {
        files.push(assets.marked, assets.presenter);   // marked renders sticky notes
    }
    if (hasRunCells(html) && !html.includes(PYCELLS_MARK)) {
        files.push(assets.codemirror, assets.pycells);
    }
    if (files.length === 0) {
        return html;
    }
    const at = html.lastIndexOf('</body>');
    if (at < 0) {
        throw new Error('The page has no </body>');
    }
    const scripts = files.map(file => `<script>${scriptSafe(fs.readFileSync(file, 'utf8'))}</script>`).join('');
    return html.slice(0, at) + scripts + html.slice(at);
}

export interface BundleOptions extends InlineOptions {
    /** Folder the HTML's relative references are relative to. */
    baseDir: string;
    /** The deck's Markdown, for saving annotated Markdown (`m`). */
    markdown?: string;
    assets: PresenterAssets;
}

/**
 * Make a Marp HTML deck self-contained, with the presenter tools and a copy
 * of itself for saving with ink. Throws if the page is not a Marp deck or is
 * already bundled.
 */
export async function bundlePresenterDeck(html: string, options: BundleOptions): Promise<{ html: string; report: BundleReport }> {
    if (html.includes(INK_EMPTY) || html.includes('<script type="text/plain" id="marp-self">')) {
        throw new Error('This deck already has presenter tools; rebuild it from the Markdown first');
    }
    const inlined = await inlineDeck(html, options.baseDir, options);
    let text = inlined.html;
    if (text.split('</head>').length !== 2 || !text.includes('</body>')) {
        throw new Error('This does not look like a Marp HTML deck');
    }

    let head = '';
    if (options.markdown !== undefined) {
        head += `<script>window.__MARP_SOURCE__ = ${JSON.stringify(options.markdown).replace(/<\//g, '<\\/')};</script>`;
    }
    head += INK_EMPTY + SELF_EMPTY;
    text = text.replace('</head>', () => head + '</head>');
    text = addPresenterScripts(text, options.assets);
    inlined.report.counts.presenter = 1;
    if (hasRunCells(text)) {
        inlined.report.counts['python cells'] = 1;
    }

    const b64 = Buffer.from(text, 'utf8').toString('base64');
    const withSelf = text.replace(SELF_EMPTY, () => SELF_EMPTY.replace('></script>', `>${b64}</script>`));
    return { html: withSelf, report: inlined.report };
}

/** The vendored scripts under the extension's media/marpPresent folder. */
export function presenterAssets(mediaDir: string): PresenterAssets {
    return {
        presenter: path.join(mediaDir, 'presenter.js'),
        pycells: path.join(mediaDir, 'pycells.js'),
        marked: path.join(mediaDir, 'vendor', 'marked.js'),
        codemirror: path.join(mediaDir, 'vendor', 'codemirror.js'),
    };
}

/** True if the deck's front matter turns presenter tools on (`presenter: true`). */
export function presenterRequested(frontMatterValue: string | undefined): boolean {
    return /^(true|yes|on)$/i.test((frontMatterValue ?? '').trim());
}
