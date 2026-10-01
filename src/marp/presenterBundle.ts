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
 * An offline deck (`presenter: offline`) also carries Pyodide and the packages
 * its cells import, so the cells run without a network. That block is kept out
 * of the base64 copy (it would double the size); `s` copies it from the page.
 *
 * No VS Code dependency, so it can be unit tested.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Marks the vendored scripts carry in their first line, so a page is never given them twice. */
const PRESENTER_MARK = 'marp-present: presenter tools';
const PYCELLS_MARK = 'marp-present: live, editable Python cells';
const TIMER_MARK = 'marp-present: talk timer';
const SHOW_MARK = 'marp-present: show tools';
const EDIT_MARK = 'marp-present: slide editing';
const INK_EMPTY = '<script type="application/json" id="marp-ink-data">{}</script>';
const SELF_EMPTY = '<script type="text/plain" id="marp-self"></script>';
const PYODIDE_EMPTY = '<script type="application/json" id="marp-pyodide"></script>';
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
    timer: string;
    /** Blank screen, zoom, go to a slide, exercise countdowns. */
    show: string;
    /** Editing the slides' text and layout in the slideshow. */
    edit: string;
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
export function addPresenterScripts(html: string, assets: PresenterAssets, timer = false): string {
    const files: string[] = [];
    // The editor goes first: while editing, it takes every key and mouse press before the other tools
    if (!html.includes(EDIT_MARK)) {
        files.push(assets.edit);
    }
    if (!html.includes(PRESENTER_MARK)) {
        files.push(assets.marked, assets.presenter);   // marked renders sticky notes
    }
    if (!html.includes(SHOW_MARK)) {
        files.push(assets.show);
    }
    if (timer && !html.includes(TIMER_MARK)) {
        files.push(assets.timer);
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
    /** Pyodide files to embed for offline Python (file name under the Pyodide base URL -> bytes). */
    pyodide?: Record<string, Buffer>;
    /** Length of the talk in seconds: a countdown in the corner of every slide. */
    timer?: number;
}

/**
 * Make a Marp HTML deck self-contained, with the presenter tools and a copy
 * of itself for saving with ink. Throws if the page is not a Marp deck or is
 * already bundled.
 */
export async function bundlePresenterDeck(html: string, options: BundleOptions): Promise<{ html: string; report: BundleReport }> {
    if (html.includes(INK_EMPTY) || html.includes('<script type="text/plain" id="marp-self">') || html.includes('id="marp-pyodide"')) {
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
    const timer = options.timer !== undefined && options.timer > 0 ? Math.round(options.timer) : undefined;
    if (timer) {
        head += `<script>window.__MARP_TIMER__ = ${timer};</script>`;
    }
    const pyodide = options.pyodide && hasRunCells(text) ? options.pyodide : undefined;
    // In <head>, so it is in the page before pycells.js (at the end of <body>) runs
    head += INK_EMPTY + SELF_EMPTY + (pyodide ? PYODIDE_EMPTY : '');
    text = text.replace('</head>', () => head + '</head>');
    text = addPresenterScripts(text, options.assets, timer !== undefined);
    inlined.report.counts.presenter = 1;
    if (timer) {
        inlined.report.counts.timer = 1;
    }
    if (hasRunCells(text)) {
        inlined.report.counts['python cells'] = 1;
    }

    const b64 = Buffer.from(text, 'utf8').toString('base64');
    let result = text.replace(SELF_EMPTY, () => SELF_EMPTY.replace('></script>', `>${b64}</script>`));
    if (pyodide) {
        const files: Record<string, string> = {};
        for (const [name, data] of Object.entries(pyodide)) {
            files[name] = data.toString('base64');
        }
        // Base64 and file names never contain '<', so the JSON cannot close the script
        result = result.replace(PYODIDE_EMPTY, () => PYODIDE_EMPTY.replace('></script>', `>${JSON.stringify(files)}</script>`));
        inlined.report.counts['offline Python files'] = Object.keys(files).length;
    }
    return { html: result, report: inlined.report };
}

/** The vendored scripts under the extension's media/marpPresent folder. */
export function presenterAssets(mediaDir: string): PresenterAssets {
    return {
        presenter: path.join(mediaDir, 'presenter.js'),
        pycells: path.join(mediaDir, 'pycells.js'),
        marked: path.join(mediaDir, 'vendor', 'marked.js'),
        codemirror: path.join(mediaDir, 'vendor', 'codemirror.js'),
        timer: path.join(mediaDir, 'timer.js'),
        show: path.join(mediaDir, 'showtools.js'),
        edit: path.join(mediaDir, 'editor.js'),
    };
}

/** True if the deck's front matter turns presenter tools on (`presenter: true` or `offline`). */
export function presenterRequested(frontMatterValue: string | undefined): boolean {
    return /^(true|yes|on|offline)$/i.test((frontMatterValue ?? '').trim());
}

/** True if the deck asks for Python cells that run without a network (`presenter: offline`). */
export function presenterOffline(frontMatterValue: string | undefined): boolean {
    return /^offline$/i.test((frontMatterValue ?? '').trim());
}

/**
 * Length of the talk from the deck's `timer:` front matter, in seconds: a bare
 * number is minutes (`20`, `7.5`); also `20m`, `90s`, `1h30m`, `1h 5m 30s`,
 * `45:00` (m:ss) and `1:05:00` (h:mm:ss). Undefined if absent, zero or not a time.
 */
export function parseTimer(value: string | undefined): number | undefined {
    const text = (value ?? '').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
    let seconds: number | undefined;
    if (/^\d+(\.\d+)?$/.test(text)) {
        seconds = parseFloat(text) * 60;
    } else if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
        seconds = text.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
    } else {
        const m = text.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?|s)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?|s)?)?)?$/);
        if (m && (m[1] || m[2] || m[3])) {
            seconds = parseFloat(m[1] ?? '0') * 3600 + parseFloat(m[2] ?? '0') * 60 + parseInt(m[3] ?? '0', 10);
        }
    }
    return seconds !== undefined && seconds > 0 ? Math.round(seconds) : undefined;
}

// ------------------------------------------------------------ offline Python --

/** Pyodide's own files, always embedded. */
export const PYODIDE_CORE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

/** The Pyodide release pycells.js loads (its `const PYODIDE = "..."`), e.g. https://cdn.jsdelivr.net/pyodide/v314.0.7/full/ */
export function pyodideBaseUrl(pycellsSource: string): string {
    const m = pycellsSource.match(/const PYODIDE = "(https:\/\/[^"]+\/)"/);
    if (!m) {
        throw new Error('Could not find the Pyodide URL in pycells.js');
    }
    return m[1];
}

/** A ```python run cell in a deck's Markdown (a fence engine.cjs marks). */
export interface RunCell {
    code: string;
    /** The words after the language: `run`, and `auto` / `hidden` */
    flags: string[];
    /** 0-based line of the opening fence */
    startLine: number;
    /** 0-based line of the closing fence */
    endLine: number;
}

/** The ```python run cells in a deck's Markdown, in order. */
export function runCells(markdown: string): RunCell[] {
    const text = markdown.replace(/\r\n/g, '\n');
    const cells: RunCell[] = [];
    const re = /^([ \t]*)(`{3,}|~{3,})[ \t]*(python|py|python3)\b([^\n]*)\n([\s\S]*?)^\1\2[ \t]*$/gim;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const flags = m[4].trim().split(/\s+/);
        if (flags.includes('run')) {
            const startLine = text.slice(0, m.index).split('\n').length - 1;
            cells.push({ code: m[5], flags, startLine, endLine: startLine + m[0].split('\n').length - 1 });
        }
    }
    return cells;
}

/** The run cell containing 0-based `line` (fences included), if any. */
export function runCellAt(markdown: string, line: number): RunCell | undefined {
    return runCells(markdown).find(cell => line >= cell.startLine && line <= cell.endLine);
}

/** The code of the ```python run cells in a deck's Markdown. */
export function runCellCode(markdown: string): string[] {
    return runCells(markdown).map(cell => cell.code);
}

/** Top-level module names a piece of Python imports (import a.b, c / from d.e import f). */
export function pythonImports(code: string): string[] {
    const names = new Set<string>();
    for (const line of code.split(/\r?\n/)) {
        const imp = line.match(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/);
        if (imp) {
            for (const part of imp[1].split(',')) {
                names.add(part.trim().split(/[.\s]/)[0]);
            }
            continue;
        }
        const from = line.match(/^\s*from\s+(\w[\w.]*)\s+import\b/);
        if (from) {
            names.add(from[1].split('.')[0]);
        }
    }
    return [...names];
}

/** The part of pyodide-lock.json this needs. */
export interface PyodideLock {
    packages: Record<string, { file_name: string; imports?: string[]; depends?: string[]; sha256?: string }>;
}

export interface OfflinePlan {
    /** Lock-file package names to embed, with everything they depend on. */
    packages: string[];
    /** Files to embed: Pyodide's core files and the packages' wheels. */
    files: string[];
    /** Imports that are not Pyodide packages: the standard library, or PyPI packages that need a network. */
    other: string[];
    /** True if a cell uses %pip / !pip, which always needs a network. */
    pip: boolean;
}

/**
 * Decide what an offline deck carries: Pyodide itself, micropip (pycells.js
 * loads it at start), and every Pyodide package the run cells import, with
 * their dependencies.
 */
export function planOfflinePython(markdown: string, lock: PyodideLock): OfflinePlan {
    const byImport = new Map<string, string>();
    for (const [name, pkg] of Object.entries(lock.packages)) {
        for (const imp of pkg.imports ?? []) {
            byImport.set(imp, name);
        }
    }
    const cells = runCellCode(markdown);
    const wanted = ['micropip'];
    const other: string[] = [];
    for (const imp of new Set(cells.flatMap(pythonImports))) {
        const pkg = byImport.get(imp) ?? (lock.packages[imp] ? imp : undefined);
        if (pkg) {
            wanted.push(pkg);
        } else {
            other.push(imp);
        }
    }
    const packages = new Set<string>();
    const stack = wanted.filter(name => lock.packages[name]);
    while (stack.length > 0) {
        const name = stack.pop()!;
        if (packages.has(name) || !lock.packages[name]) {
            continue;
        }
        packages.add(name);
        stack.push(...(lock.packages[name].depends ?? []));
    }
    const sorted = [...packages].sort();
    return {
        packages: sorted,
        files: [...PYODIDE_CORE_FILES, ...sorted.map(name => lock.packages[name].file_name)],
        other: other.sort(),
        pip: cells.some(code => /^\s*[%!]pip\s/m.test(code)),
    };
}

// ------------------------------------------------------------ offline check --

/** Modules that come with Python (and Pyodide's own), so importing them needs no download. */
const BUILTIN_MODULES = new Set((
    'abc aifc argparse array ast asyncio atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar ' +
    'cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib ' +
    'contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest email ' +
    'encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc ' +
    'genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http imaplib imghdr importlib ' +
    'inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox mailcap marshal math ' +
    'mimetypes mmap modulefinder multiprocessing netrc numbers opcode operator optparse os pathlib pdb pickle ' +
    'pickletools pipes pkgutil platform plistlib poplib posixpath pprint profile pstats pty pwd py_compile pyclbr ' +
    'pydoc queue quopri random re reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex ' +
    'shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string stringprep struct ' +
    'subprocess symtable sys sysconfig tabnanny tarfile tempfile textwrap this threading time timeit token ' +
    'tokenize tomllib trace traceback tracemalloc tty turtle types typing unicodedata unittest urllib uu uuid ' +
    'venv warnings wave weakref webbrowser wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo ' +
    'js pyodide pyodide_js __future__'
).split(' '));

/** Something in a deck that needs a network connection (or is missing). */
export interface DeckIssue {
    /** 0-based line in the deck's Markdown */
    line: number;
    message: string;
}

export interface OfflineCheck {
    markdown: string;
    /** What inlining reported (missing files, remote URLs), if the deck was built */
    report?: BundleReport;
    /** The offline Python plan, for a `presenter: offline` deck */
    plan?: OfflinePlan;
    /** Why Python could not be prepared for offline use, if it could not */
    pythonError?: string;
}

/**
 * What would not work without an internet connection when the deck is
 * presented, each tied to the Markdown line it comes from (the front
 * matter's first line when there is no better place).
 */
export function offlineIssues(check: OfflineCheck): DeckIssue[] {
    const lines = check.markdown.split(/\r?\n/);
    const issues: DeckIssue[] = [];
    const lineOf = (pattern: RegExp, fallback = 0): number => {
        const i = lines.findIndex(line => pattern.test(line));
        return i >= 0 ? i : fallback;
    };
    const escape = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const presenterLine = lineOf(/^presenter\s*:/);
    const themeLine = lineOf(/^theme\s*:/, presenterLine);
    const cells = runCells(check.markdown);
    const presenter = lines.slice(0, 40).map(line => line.match(/^presenter\s*:\s*(\S+)/)?.[1]).find(Boolean);

    if (cells.length > 0 && presenterRequested(presenter) && !presenterOffline(presenter)) {
        issues.push({ line: presenterLine, message: 'Python is downloaded when the deck opens, so the Python cells need an internet connection. Use presenter: offline to include Python in the deck.' });
    }
    if (check.pythonError) {
        issues.push({ line: presenterLine, message: `Python could not be included for offline use: ${check.pythonError}` });
    }
    if (check.plan) {
        const notPyodide = new Set(check.plan.other.filter(name => !BUILTIN_MODULES.has(name)));
        for (const cell of cells) {
            cell.code.split('\n').forEach((text, i) => {
                const line = cell.startLine + 1 + i;
                if (/^\s*[%!]pip\s/.test(text)) {
                    issues.push({ line, message: `${text.trim()} downloads from PyPI and needs an internet connection.` });
                    return;
                }
                for (const name of pythonImports(text)) {
                    if (notPyodide.has(name)) {
                        issues.push({ line, message: `${name} is not a Pyodide package; it is downloaded from PyPI and needs an internet connection.` });
                    }
                }
            });
        }
    }
    for (const missing of check.report?.missing ?? []) {
        const ref = missing.split(' (relative to ')[0];
        issues.push({ line: lineOf(escape(path.basename(ref))), message: `File not found: ${missing}` });
    }
    for (const url of check.report?.external ?? []) {
        const at = lines.findIndex(line => line.includes(url));
        issues.push(at >= 0
            ? { line: at, message: `Loaded from the web: ${url}` }
            : { line: themeLine, message: `Loaded from the web by the theme or a style: ${url}. Without a connection the browser uses a fallback.` });
    }
    return issues;
}
