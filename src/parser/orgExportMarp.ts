/**
 * Marp slide deck export backend: an org file becomes a Marp Markdown deck.
 *
 * The mapping follows uliw's ox-marp exporter for Emacs. uliw suggested an org
 * to Marp exporter and contributed its specification and reference fixture in
 * https://github.com/jkitchin/scimax_vscode/issues/77:
 *
 * - Keywords become YAML front matter (TITLE, AUTHOR, DATE and MARP_*), and a
 *   title slide is generated from them.
 * - Headings at or above the heading divider (levels 1 and 2 by default) are
 *   slides. The next level is a fragment: the heading and everything under it
 *   appear together, in a `<div data-marpit-fragment>`. Deeper headings are
 *   bold list items (`* **Heading:** text`).
 * - Lists use Marp's fragmented markers, `*` and `1)`, so they build one item
 *   at a time. Code blocks right after a list go into its last item, so they
 *   are revealed with it.
 * - Babel languages are mapped to Markdown ones (jupyter-python -> python), and
 *   `:run t` makes a live Python cell (```python run).
 *
 * On top of that it writes Scimax's own Marp features: per-slide directives
 * from MARP_* heading properties, image options from #+ATTR_MARP, speaker notes
 * from #+BEGIN_NOTES, exercise countdowns, hidden slides, and citations that
 * the slide citation plugin numbers and lists on each slide.
 *
 * Pure: no vscode imports.
 */

import { parseOrgFast } from './orgExportParser';
import {
    BIBLIOGRAPHY_LINK_TYPES,
    CITATION_LINK_TYPES,
    pandocCitationLink,
    pandocCitationObject,
} from './orgExportMarkdown';

// The fast parser's nodes are loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

export type MarpPresenter = boolean | 'offline';

export interface MarpExportOptions {
    /** Marp theme (`theme:`). */
    theme: string;
    /** Headings at this level or above start a slide (`headingDivider:`). */
    headingDivider: number;
    /** Page numbers (`paginate:`). */
    paginate: boolean;
    /** Math typesetting (`math:`). */
    math: 'katex' | 'mathjax';
    /** Scimax presenter tools and live Python cells (`presenter:`). */
    presenter: MarpPresenter;
    /** Make a title slide from TITLE, AUTHOR and DATE. */
    titleSlide: boolean;
    /** Class of the title slide ('' for none). */
    titleSlideClass: string;
    /** Fragmented lists (`*`, `1)`) and fragment divs for the level below the slides. */
    fragments: boolean;
    /** Put code blocks that follow a list into its last item. */
    nestBlocksUnderLists: boolean;
    /** Babel language -> Markdown fence language, on top of the defaults. */
    languageMap: Record<string, string>;
    /** More front matter keys. */
    frontMatter: Record<string, string | number | boolean>;
}

export const DEFAULT_MARP_LANGUAGE_MAP: Record<string, string> = {
    'jupyter-python': 'python',
    'ipython': 'python',
    'jupyter-r': 'r',
    'jupyter-julia': 'julia',
    'emacs-lisp': 'elisp',
    'sh': 'bash',
    'shell': 'bash',
};

export const DEFAULT_MARP_EXPORT_OPTIONS: MarpExportOptions = {
    theme: 'default',
    headingDivider: 2,
    paginate: true,
    math: 'katex',
    presenter: true,
    titleSlide: true,
    titleSlideClass: 'lead',
    fragments: true,
    nestBlocksUnderLists: true,
    languageMap: {},
    frontMatter: {},
};

/** Export blocks and snippets written into the deck as they are. */
const PASSTHROUGH_BACKENDS = new Set(['marp', 'md', 'markdown', 'html']);

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|ogv)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i;

/** Front matter keys handled by name rather than copied. */
const SPECIAL_KEYWORDS = new Set(['MARP_THEME', 'MARP_HEADING_DIVIDER', 'MARP_PAGINATE', 'MARP_MATH', 'MARP_PRESENTER', 'MARP_FRONT_MATTER']);

/** Heading properties that are not slide directives. */
const SPECIAL_PROPERTIES = new Set(['MARP_FIT', 'MARP_HIDDEN']);

function isTrue(v: string | undefined): boolean {
    return /^(t|true|yes|on|1)$/i.test((v ?? '').trim());
}

function isFalse(v: string | undefined): boolean {
    return /^(nil|false|no|off|0)$/i.test((v ?? '').trim());
}

/** MARP_BACKGROUND_COLOR -> backgroundColor */
function directiveName(key: string): string {
    return key.replace(/^MARP_/i, '').toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** A YAML scalar: plain when that reads back as the same string, otherwise quoted. */
export function yamlScalar(value: string | number | boolean): string {
    if (typeof value !== 'string') return String(value);
    if (/^[\p{L}\p{N}_][\p{L}\p{N}_ .,/()@+'-]*$/u.test(value)
        && !/\s$/.test(value)
        && !/^(true|false|yes|no|on|off|null|~|[-+]?\d[\d_.e+-]*)$/i.test(value)) {
        return value;
    }
    return JSON.stringify(value);
}

/** A keyword value as YAML: t/nil are booleans, numbers stay numbers. */
function keywordValue(v: string): string {
    const s = v.trim();
    if (isTrue(s)) return 'true';
    if (isFalse(s)) return 'false';
    if (/^-?\d+(\.\d+)?$/.test(s)) return s;
    return yamlScalar(s);
}

interface Keyword {
    key: string;
    value: string;
}

/**
 * The document's keywords, in order, repeats included (the parser keeps one
 * value per key). Lines inside blocks are skipped.
 */
function collectKeywords(lines: string[]): Keyword[] {
    const out: Keyword[] = [];
    let inBlock: string | undefined;
    for (const line of lines) {
        const begin = /^\s*#\+begin_(\S+)/i.exec(line);
        if (inBlock) {
            if (new RegExp(`^\\s*#\\+end_${inBlock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line)) inBlock = undefined;
            continue;
        }
        if (begin) {
            inBlock = begin[1];
            continue;
        }
        const m = /^\s*#\+([A-Za-z][\w-]*):\s?(.*)$/.exec(line);
        if (m) out.push({ key: m[1].toUpperCase(), value: m[2].trim() });
    }
    return out;
}

/** `:key value :flag :other "quoted value"` -> map (keys lowercased, no colon). */
export function parseHeaderArgs(params: string | undefined): Map<string, string> {
    const args = new Map<string, string>();
    if (!params) return args;
    const re = /:([\w-]+)((?:\s+(?:"[^"]*"|(?!:)\S+))*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(params)) !== null) {
        let value = m[2].trim();
        if (/^"[^"]*"$/.test(value)) value = value.slice(1, -1);
        args.set(m[1].toLowerCase(), value);
    }
    return args;
}

/** `:bg left :width 300px :sepia` -> [['bg','left'],['width','300px'],['sepia','']] */
function parseAttrLine(value: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const re = /:([\w-]+)((?:\s+(?:"[^"]*"|(?!:)\S+))*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
        let v = m[2].trim();
        if (/^"[^"]*"$/.test(v)) v = v.slice(1, -1);
        out.push([m[1].toLowerCase(), v]);
    }
    return out;
}

function indent(lines: string[], n = 4): string[] {
    const pad = ' '.repeat(n);
    return lines.map(l => (l.trim() ? pad + l : ''));
}

/** A fence long enough not to be closed by backticks in the code. */
function fence(code: string): string {
    let ticks = '```';
    while (code.includes(ticks)) ticks += '`';
    return ticks;
}

/** Text inside an HTML comment cannot contain `-->`. */
function commentSafe(s: string): string {
    return s.replace(/-->/g, '-\\->');
}

/** Blocks joined by one blank line; nested lists stay tight under their text. */
function joinBlocks(blocks: Array<{ kind: string; lines: string[] }>): string[] {
    const out: string[] = [];
    for (const block of blocks) {
        if (block.lines.length === 0) continue;
        if (out.length && block.kind !== 'tight') out.push('');
        out.push(...block.lines);
    }
    return out;
}

interface Context {
    opts: MarpExportOptions;
    sourceLines: string[];
    keywords: Record<string, string>;
    headerArgs: Map<string, string>;
    languageMap: Record<string, string>;
    excludeTags: Set<string>;
    bibliographies: string[];
    /** The source block before the current element hid its results. */
    skipResults: boolean;
    /** Image options for links in the paragraph being written. */
    imageOptions?: string[];
}

export function exportToMarp(content: string, options: Partial<MarpExportOptions> = {}): string {
    const sourceLines = content.split(/\r?\n/);
    const doc = parseOrgFast(content);
    const keywordList = collectKeywords(sourceLines);
    const keywords: Record<string, string> = {};
    for (const k of keywordList) keywords[k.key] = k.value;

    const opts: MarpExportOptions = { ...DEFAULT_MARP_EXPORT_OPTIONS, ...options };

    // In-file settings win over the options passed in.
    if (keywords['MARP_THEME']) opts.theme = keywords['MARP_THEME'];
    const divider = parseInt(keywords['MARP_HEADING_DIVIDER'] ?? '', 10);
    if (divider >= 1 && divider <= 6) opts.headingDivider = divider;
    if (keywords['MARP_PAGINATE'] !== undefined) opts.paginate = !isFalse(keywords['MARP_PAGINATE']);
    if (/^(katex|mathjax)$/i.test(keywords['MARP_MATH'] ?? '')) opts.math = keywords['MARP_MATH'].toLowerCase() as 'katex' | 'mathjax';
    if (keywords['MARP_PRESENTER'] !== undefined) {
        const p = keywords['MARP_PRESENTER'];
        opts.presenter = /^offline$/i.test(p) ? 'offline' : !isFalse(p);
    }
    for (const k of keywordList.filter(k => k.key === 'OPTIONS')) {
        for (const m of k.value.matchAll(/(marp-title-slide|marp-fragments):(\S+)/g)) {
            const on = !isFalse(m[2]);
            if (m[1] === 'marp-title-slide') opts.titleSlide = on;
            else opts.fragments = on;
        }
    }

    const languageMap: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...DEFAULT_MARP_LANGUAGE_MAP, ...opts.languageMap })) {
        languageMap[k.toLowerCase()] = v;
    }

    // Document-wide header arguments: #+PROPERTY: header-args[:lang] ...
    const headerArgs = new Map<string, string>();
    for (const k of keywordList.filter(k => k.key === 'PROPERTY')) {
        const m = /^header-args(?::(\S+))?\s+(.*)$/i.exec(k.value);
        if (m) headerArgs.set((m[1] ?? '').toLowerCase(), [headerArgs.get((m[1] ?? '').toLowerCase()), m[2]].filter(Boolean).join(' '));
    }

    const excludeTags = new Set<string>(['noexport']);
    for (const k of keywordList.filter(k => k.key === 'EXCLUDE_TAGS')) {
        for (const t of k.value.split(/\s+/).filter(Boolean)) excludeTags.add(t);
    }

    const ctx: Context = {
        opts,
        sourceLines,
        keywords,
        headerArgs,
        languageMap,
        excludeTags,
        bibliographies: [],
        skipResults: false,
    };
    for (const k of keywordList.filter(k => k.key === 'BIBLIOGRAPHY')) addBibliography(ctx, k.value.split(/\s+/)[0]);

    // The body first: it can add bibliographies to the front matter.
    const preamble = doc.section ? renderBlocks(doc.section.children || [], ctx) : [];
    const body: string[] = [];
    for (const h of doc.children || []) {
        const lines = renderHeadline(h, ctx);
        if (lines.length) body.push(...(body.length ? [''] : []), ...lines);
    }

    const out: string[] = [...frontMatter(ctx, keywordList), ''];

    const title = keywords['TITLE'];
    if (opts.titleSlide && title) {
        const titleSlide: string[] = [];
        if (opts.titleSlideClass) titleSlide.push(`<!-- _class: ${opts.titleSlideClass} -->`);
        titleSlide.push('<!-- _paginate: false -->', '', `# ${title}`, '');
        if (keywords['SUBTITLE']) titleSlide.push(`*${keywords['SUBTITLE']}*`, '');
        // A heading below the divider, so it does not start a slide of its own.
        if (keywords['AUTHOR']) titleSlide.push(`${'#'.repeat(Math.min(opts.headingDivider + 1, 6))} ${keywords['AUTHOR']}`, '');
        if (keywords['DATE']) titleSlide.push(dateText(keywords['DATE']), '');
        if (preamble.length) titleSlide.push(...preamble, '');
        out.push(...titleSlide);
        // A slide heading starts a slide anyway; a --- before it would leave an empty one.
        const slideHeading = new RegExp(`^#{1,${opts.headingDivider}} `);
        if (body.length && !slideHeading.test(body[0])) out.push('---', '');
    } else if (preamble.length) {
        out.push(...preamble, '');
    }
    out.push(...body);

    // Trailing spaces off, at most one blank line in a row (except inside code).
    const result: string[] = [];
    let inFence: string | undefined;
    for (const line of out) {
        const f = /^\s*(`{3,}|~{3,})/.exec(line);
        if (f) {
            if (!inFence) inFence = f[1];
            else if (f[1].startsWith(inFence) && line.trim() === f[1]) inFence = undefined;
        }
        if (!inFence && !line.trim() && result.length && !result[result.length - 1].trim()) continue;
        result.push(inFence ? line : line.replace(/[ \t]+$/, ''));
    }
    while (result.length && !result[result.length - 1].trim()) result.pop();
    return result.join('\n') + '\n';
}

function dateText(date: string): string {
    // <2026-11-08 Sun> -> 2026-11-08 Sun
    return date.replace(/^[<[]([^>\]]*)[>\]]$/, '$1');
}

function addBibliography(ctx: Context, paths: string): void {
    for (let p of paths.split(',').map(x => x.trim()).filter(Boolean)) {
        if (!/\.(bib|json|ya?ml|ris)$/i.test(p)) p += '.bib';
        if (!ctx.bibliographies.includes(p)) ctx.bibliographies.push(p);
    }
}

function frontMatter(ctx: Context, keywordList: Keyword[]): string[] {
    const { opts, keywords } = ctx;
    const fm: Array<[string, string]> = [['marp', 'true'], ['theme', yamlScalar(opts.theme)]];
    if (keywords['TITLE']) fm.push(['title', yamlScalar(keywords['TITLE'])]);
    if (keywords['AUTHOR']) fm.push(['author', yamlScalar(keywords['AUTHOR'])]);
    if (keywords['DATE']) fm.push(['date', yamlScalar(dateText(keywords['DATE']))]);
    fm.push(['paginate', String(opts.paginate)]);
    fm.push(['math', opts.math]);
    fm.push(['presenter', String(opts.presenter)]);
    fm.push(['headingDivider', String(opts.headingDivider)]);
    if (ctx.bibliographies.length === 1) fm.push(['bibliography', yamlScalar(ctx.bibliographies[0])]);
    else if (ctx.bibliographies.length > 1) fm.push(['bibliography', `\n${ctx.bibliographies.map(b => `  - ${yamlScalar(b)}`).join('\n')}`]);

    const set = (key: string, value: string) => {
        const i = fm.findIndex(([k]) => k === key);
        if (i >= 0) fm[i] = [key, value];
        else fm.push([key, value]);
    };
    for (const [k, v] of Object.entries(opts.frontMatter)) set(k, typeof v === 'string' ? keywordValue(v) : String(v));
    // #+MARP_TIMER: 20 -> timer: 20, and so on for any other MARP_ keyword.
    for (const k of keywordList) {
        if (k.key.startsWith('MARP_') && !SPECIAL_KEYWORDS.has(k.key) && k.value) set(directiveName(k.key), keywordValue(k.value));
    }
    // #+MARP_FRONT_MATTER: key: value, written as it is.
    for (const k of keywordList.filter(k => k.key === 'MARP_FRONT_MATTER')) {
        const m = /^([\w-]+):\s*(.*)$/.exec(k.value);
        if (m) set(m[1], m[2]);
    }
    return ['---', ...fm.map(([k, v]) => (v.startsWith('\n') ? `${k}:${v}` : `${k}: ${v}`)), '---'];
}

// ---------------------------------------------------------------------------
// Headings

function shouldExportHeadline(h: Node, ctx: Context): boolean {
    const p = h.properties || {};
    if (p.commentedp || p.archivedp) return false;
    return !(p.tags || []).some((t: string) => ctx.excludeTags.has(t));
}

function headlineTitle(h: Node, ctx: Context): string {
    const p = h.properties || {};
    const title = p.title?.length ? inline(p.title, ctx) : (p.rawValue || '');
    return title.replace(/\s*\n\s*/g, ' ').trim();
}

/** The heading's body: its section, then its subheadings. */
function headlineBody(h: Node, ctx: Context): string[] {
    const lines = renderBlocks(h.section?.children || [], ctx);
    for (const child of h.children || []) {
        const sub = renderHeadline(child, ctx);
        if (sub.length) lines.push(...(lines.length ? [''] : []), ...sub);
    }
    return lines;
}

function renderHeadline(h: Node, ctx: Context): string[] {
    if (!shouldExportHeadline(h, ctx)) return [];
    const { opts } = ctx;
    const level: number = h.properties?.level || 1;
    const title = headlineTitle(h, ctx);
    const props: Record<string, string> = h.propertiesDrawer || {};
    ctx.skipResults = false;

    if (level <= opts.headingDivider) {
        // A slide.
        const fit = isTrue(props['MARP_FIT']) ? '<!-- fit --> ' : '';
        const lines = [`${'#'.repeat(level)} ${fit}${title}`];
        const directives = Object.entries(props)
            .filter(([k, v]) => /^MARP_/i.test(k) && !SPECIAL_PROPERTIES.has(k.toUpperCase()) && v.trim())
            .map(([k, v]) => `<!-- _${directiveName(k)}: ${v.trim()} -->`);
        if (directives.length) lines.push('', ...directives);
        const body = headlineBody(h, ctx);
        if (body.length) lines.push('', ...body);
        const hidden = isTrue(props['MARP_HIDDEN']) || (h.properties?.tags || []).includes('hidden');
        // Scimax's hidden slide: Marp skips the comment; the slide sorter can unhide it.
        return hidden ? ['<!-- scimax-hidden', ...lines.map(commentSafe), 'scimax-hidden -->'] : lines;
    }

    if (level === opts.headingDivider + 1) {
        // A section of the slide that appears as one step.
        const lines = [`${'#'.repeat(level)} ${title}`];
        const body = headlineBody(h, ctx);
        if (body.length) lines.push('', ...body);
        return opts.fragments ? ['<div data-marpit-fragment>', '', ...lines, '', '</div>'] : lines;
    }

    // Deeper headings are list items: * **Heading:** text
    const bullet = opts.fragments ? '*' : '-';
    const label = /[:?!.]$/.test(title) ? `**${title}**` : `**${title}:**`;
    const section: Node[] = h.section?.children || [];
    const first = section.find(el => !isSilent(el));
    let head = `${bullet} ${label}`;
    let restElements = section;
    if (first?.type === 'paragraph' && !isImageParagraph(first)) {
        const text = renderParagraph(first, ctx);
        head += ` ${text[0]}`;
        const tail = indent(text.slice(1));
        restElements = section.slice(section.indexOf(first) + 1);
        const rest = blockLines(restElements, h, ctx);
        return [head, ...tail, ...(rest.length ? ['', ...indent(rest)] : [])];
    }
    const rest = blockLines(restElements, h, ctx);
    return [head, ...(rest.length ? ['', ...indent(rest)] : [])];
}

/** The rendered elements, then the subheadings of h. */
function blockLines(elements: Node[], h: Node, ctx: Context): string[] {
    const lines = renderBlocks(elements, ctx);
    for (const child of h.children || []) {
        const sub = renderHeadline(child, ctx);
        if (sub.length) lines.push(...(lines.length ? [''] : []), ...sub);
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Elements

/** Elements that produce nothing. */
function isSilent(el: Node): boolean {
    return ['property-drawer', 'keyword', 'planning', 'clock', 'comment', 'comment-block', 'babel-call', 'inlinetask'].includes(el.type);
}

function isResults(el: Node): boolean {
    return el.affiliated?.results !== undefined || (el.type === 'drawer' && /^results$/i.test(el.properties?.name || ''));
}

function isCodeLike(el: Node): boolean {
    return el.type === 'src-block' || el.type === 'example-block' || isResults(el);
}

/**
 * Code blocks (and their results) right after a list go into its last item,
 * so they appear with it instead of before the list builds.
 */
function nestUnderLists(elements: Node[], ctx: Context): Node[] {
    if (!ctx.opts.nestBlocksUnderLists) return elements;
    const out: Node[] = [];
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.type !== 'plain-list' || !el.children?.length) {
            out.push(el);
            continue;
        }
        const moved: Node[] = [];
        while (i + 1 < elements.length && isCodeLike(elements[i + 1])) moved.push(elements[++i]);
        if (!moved.length) {
            out.push(el);
            continue;
        }
        const items = [...el.children];
        const last = items[items.length - 1];
        items[items.length - 1] = { ...last, children: [...(last.children || []), ...moved] };
        out.push({ ...el, children: items });
    }
    return out;
}

function renderBlocks(elements: Node[], ctx: Context): string[] {
    const blocks: Array<{ kind: string; lines: string[] }> = [];
    for (const el of nestUnderLists(elements, ctx)) {
        if (isResults(el)) {
            const skip = ctx.skipResults;
            ctx.skipResults = false;
            if (skip) continue;
        } else if (el.type !== 'src-block' && !isSilent(el)) {
            ctx.skipResults = false;
        }
        const lines = renderElement(el, ctx);
        if (lines) blocks.push({ kind: el.type, lines });
    }
    return joinBlocks(blocks);
}

function renderElement(el: Node, ctx: Context): string[] | undefined {
    switch (el.type) {
        case 'paragraph':
            return withCaption(renderParagraph(el, ctx), el, ctx);
        case 'plain-list':
            return renderList(el, ctx);
        case 'src-block':
            return renderSrcBlock(el, ctx);
        case 'example-block':
        case 'fixed-width': {
            const value = String(el.properties?.value ?? '').replace(/\n+$/, '');
            const ticks = fence(value);
            return [ticks, ...value.split('\n'), ticks];
        }
        case 'verse-block': {
            const value = String(el.properties?.value ?? '').replace(/\n+$/, '');
            // A backslash at the end of a line is a hard line break.
            return value.split('\n').map((l, i, all) => (i < all.length - 1 && l.trim() ? `${l.trim()}\\` : l.trim()));
        }
        case 'quote-block': {
            const inner = renderBlocks(el.children || [], ctx);
            return inner.map(l => (l ? `> ${l}` : '>'));
        }
        case 'center-block':
            return ['<div style="text-align: center;">', '', ...renderBlocks(el.children || [], ctx), '', '</div>'];
        case 'special-block':
            return renderSpecialBlock(el, ctx);
        case 'drawer': {
            const name = String(el.properties?.name || '').toUpperCase();
            if (name === 'NOTES') return notes(renderBlocks(el.children || [], ctx));
            if (name === 'RESULTS') return renderResultsDrawer(el, ctx);
            return undefined;
        }
        case 'dynamic-block':
            return renderBlocks(el.children || [], ctx);
        case 'export-block': {
            const backend = String(el.properties?.backend || '').toLowerCase();
            if (!PASSTHROUGH_BACKENDS.has(backend)) return undefined;
            return String(el.properties?.value ?? '').replace(/\n+$/, '').split('\n');
        }
        case 'latex-environment': {
            const value = String(el.properties?.value ?? '').trim();
            return ['$$', ...value.split('\n'), '$$'];
        }
        case 'table':
            return withCaption(renderTable(el, ctx) ?? [], el, ctx);
        case 'horizontal-rule':
            // An explicit slide break.
            return ['---'];
        case 'footnote-definition': {
            const label = el.properties?.label ?? '';
            const text = renderBlocks(el.children || [], ctx);
            if (!text.length) return undefined;
            return [`<sup>${label}</sup> ${text[0]}`, ...text.slice(1)];
        }
        default:
            return undefined;
    }
}

function withCaption(lines: string[], el: Node, ctx: Context): string[] {
    const caption = el.affiliated?.caption;
    if (!caption || !lines.length) return lines;
    // A background image has nowhere to put a caption.
    if (ctx.imageOptions === undefined && attrOptions(el, ctx).some(o => /^bg\b/.test(o))) return lines;
    return [...lines, '', `*${String(caption).trim()}*`];
}

function renderParagraph(el: Node, ctx: Context): string[] {
    const saved = ctx.imageOptions;
    ctx.imageOptions = attrOptions(el, ctx);
    const text = inline(el.children || [], ctx);
    ctx.imageOptions = saved;
    return text.replace(/^\s*\n|\n\s*$/g, '').split('\n').map(l => l.replace(/^\s+/, ''));
}

function isImageParagraph(el: Node): boolean {
    const kids = (el.children || []).filter((o: Node) => !(o.type === 'plain-text' && !String(o.properties?.value ?? '').trim()));
    return kids.length > 0 && kids.every((o: Node) => o.type === 'link' && isImageLink(o));
}

function htmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Seconds in a YouTube `t=` / `start=` value: `90`, `90s`, `1m30s`, `1h2m3s`. */
function youtubeSeconds(value: string | null): number | undefined {
    if (!value) return undefined;
    if (/^\d+$/.test(value)) return Number(value);
    const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m || !(m[1] || m[2] || m[3])) return undefined;
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * The privacy-enhanced embed URL for a YouTube watch, short, live, embed or
 * youtu.be link, keeping its start time; undefined for other URLs.
 */
export function youtubeEmbedUrl(url: string): string | undefined {
    let u: URL;
    try { u = new URL(url); } catch { return undefined; }
    const host = u.hostname.replace(/^(www|m)\./, '');
    let id: string | null | undefined;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] === 'watch') id = u.searchParams.get('v');
        else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
    }
    if (!id || !/^[\w-]{6,}$/.test(id)) return undefined;
    const start = youtubeSeconds(u.searchParams.get('start') ?? u.searchParams.get('t'));
    return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`;
}

/** `<video>`, `<audio>` or a YouTube `<iframe>` for a bare link, else undefined. */
export function mediaEmbed(type: string, path: string): string | undefined {
    const web = type === 'http' || type === 'https';
    const url = web && !/^https?:/i.test(path) ? `${type}:${path}` : path;
    if (web) {
        const embed = youtubeEmbedUrl(url);
        if (embed) return `<iframe src="${htmlAttr(embed)}" width="768" height="432" allowfullscreen></iframe>`;
    }
    if (!web && type !== 'file' && type !== 'attachment') return undefined;
    const bare = path.replace(/[?#].*$/, '');
    if (VIDEO_EXTENSIONS.test(bare)) return `<video src="${htmlAttr(url)}" controls></video>`;
    if (AUDIO_EXTENSIONS.test(bare)) return `<audio src="${htmlAttr(url)}" controls></audio>`;
    return undefined;
}

function isImageLink(o: Node): boolean {
    const type = String(o.properties?.linkType || '').toLowerCase();
    return (type === 'file' || type === 'http' || type === 'https' || type === 'attachment')
        && IMAGE_EXTENSIONS.test(String(o.properties?.path || '').replace(/[?#].*$/, ''))
        && !(o.children?.length);
}

/**
 * Marp image options for the element, from the #+ATTR_MARP lines above it
 * (`:bg left :width 300px :sepia`), or the size in #+ATTR_HTML / #+ATTR_ORG.
 * They are read from the source because the parser drops valueless keys.
 */
function attrOptions(el: Node, ctx: Context): string[] {
    const attrs: Record<string, Array<[string, string]>> = {};
    if (el.sourceLine) {
        for (let i = el.sourceLine - 2; i >= 0; i--) {
            const m = /^\s*#\+(ATTR_[\w-]+|CAPTION|NAME|LABEL|RESULTS|HEADER|PLOT)(?:\[[^\]]*\])?:\s?(.*)$/i.exec(ctx.sourceLines[i]);
            if (!m) break;
            const key = m[1].toUpperCase();
            if (key.startsWith('ATTR_')) attrs[key] = [...parseAttrLine(m[2]), ...(attrs[key] || [])];
        }
    }
    const options: string[] = [];
    const marp = attrs['ATTR_MARP'];
    if (marp) {
        for (const [k, v] of marp) {
            if (k === 'alt') continue;
            if (k === 'width' || k === 'w') options.push(`w:${v}`);
            else if (k === 'height' || k === 'h') options.push(`h:${v}`);
            else if (!v || isTrue(v)) options.push(k);
            else if (k === 'bg') options.push(`bg ${v}`);
            else options.push(`${k}:${v}`);
        }
        const alt = marp.find(([k]) => k === 'alt');
        if (alt) options.unshift(alt[1]);
        return options;
    }
    for (const backend of ['ATTR_HTML', 'ATTR_ORG']) {
        for (const [k, v] of attrs[backend] || []) {
            if (k === 'width' && v) options.push(`w:${v}`);
            if (k === 'height' && v) options.push(`h:${v}`);
            if (k === 'alt' && v) options.unshift(v);
        }
        if (options.length) break;
    }
    return options;
}

function renderList(list: Node, ctx: Context): string[] {
    const listOrdered = list.properties?.listType === 'ordered';
    const fragments = ctx.opts.fragments;
    const out: string[] = [];
    let n = 0;
    let previousOrdered: boolean | undefined;
    for (const item of list.children || []) {
        if (item.type !== 'item') continue;
        const children: Node[] = [...(item.children || [])];
        let firstLines: string[] = [];
        if (children[0]?.type === 'paragraph') firstLines = renderParagraph(children.shift(), ctx);
        let first = firstLines[0] ?? '';

        // Counter: [@5] (also when the parser left it in the text).
        let counter = Number(item.properties?.counter) || undefined;
        const counterMatch = /^\[@(\d+)\]\s*/.exec(first);
        if (counterMatch) {
            counter = Number(counterMatch[1]);
            first = first.slice(counterMatch[0].length);
        }
        // Org keeps `-` and `1.` items at one indentation in one list; Markdown does not.
        const bullet = String(item.properties?.bullet ?? '');
        const ordered = bullet ? /^(\d+|[a-zA-Z])[.)]$/.test(bullet) : listOrdered;
        if (ordered !== previousOrdered) n = 0;
        previousOrdered = ordered;
        n = counter ?? n + 1;
        const marker = ordered ? `${n}${fragments ? ')' : '.'}` : fragments ? '*' : '-';

        const checkbox = item.properties?.checkbox;
        const box = checkbox === 'on' ? '[x] ' : checkbox === 'off' ? '[ ] ' : checkbox === 'trans' ? '[-] ' : '';

        // Description items: term :: text
        let term = '';
        const tag = item.properties?.tag;
        if (tag) {
            term = `**${Array.isArray(tag) ? inline(tag, ctx) : String(tag)}:** `;
        } else {
            const d = /^(.+?) :: ?(.*)$/.exec(first);
            if (d) {
                term = `**${d[1]}:** `;
                first = d[2];
            }
        }

        out.push(`${marker} ${box}${term}${first}`.replace(/\s+$/, ''));
        out.push(...indent(firstLines.slice(1)));
        const blocks: Array<{ kind: string; lines: string[] }> = [];
        for (const child of nestUnderLists(children, ctx)) {
            if (isResults(child)) {
                const skip = ctx.skipResults;
                ctx.skipResults = false;
                if (skip) continue;
            } else if (child.type !== 'src-block' && !isSilent(child)) {
                ctx.skipResults = false;
            }
            const lines = renderElement(child, ctx);
            // A nested list sits right under the item's text.
            if (lines) blocks.push({ kind: child.type === 'plain-list' && !blocks.length ? 'tight' : child.type, lines });
        }
        const rest = joinBlocks(blocks);
        if (rest.length) out.push(...(blocks[0].kind === 'tight' ? [] : ['']), ...indent(rest));
    }
    return out;
}

function fenceLanguage(language: string, ctx: Context): string {
    const lang = language.trim();
    const mapped = ctx.languageMap[lang.toLowerCase()];
    if (mapped !== undefined) return mapped;
    const jupyter = /^jupyter-(.+)$/i.exec(lang);
    return jupyter ? jupyter[1].toLowerCase() : lang;
}

function renderSrcBlock(el: Node, ctx: Context): string[] | undefined {
    const language = String(el.properties?.language || '');
    const args = new Map<string, string>([
        ...parseHeaderArgs(ctx.headerArgs.get('')),
        ...parseHeaderArgs(ctx.headerArgs.get(language.toLowerCase())),
        ...parseHeaderArgs(el.properties?.parameters),
    ]);

    const exports = (args.get('exports') || 'code').toLowerCase();
    ctx.skipResults = exports === 'code' || exports === 'none';
    if (exports === 'none' || exports === 'results') return undefined;

    let info = fenceLanguage(language, ctx);
    const runner = args.get('python') ?? args.get('marp');
    const run = args.get('marp-run') ?? args.get('run');
    if (runner && /\brun\b/.test(runner)) {
        // :python "python run" gives the fence line itself.
        info = runner;
    } else if (run !== undefined && !isFalse(run)) {
        info += /^(auto|hidden)$/i.test(run) ? ` run ${run.toLowerCase()}` : ' run';
    }

    const value = String(el.properties?.value ?? '').replace(/\n+$/, '');
    const ticks = fence(value);
    return [`${ticks}${info}`, ...value.split('\n'), ticks];
}

function renderResultsDrawer(el: Node, ctx: Context): string[] | undefined {
    // `: output` lines inside a drawer come through as a paragraph.
    const blocks: Array<{ kind: string; lines: string[] }> = [];
    for (const child of el.children || []) {
        const text = child.type === 'paragraph' ? inline(child.children || [], ctx) : '';
        if (text && text.split('\n').every(l => /^:( |$)/.test(l))) {
            const value = text.split('\n').map(l => l.replace(/^: ?/, '')).join('\n');
            const ticks = fence(value);
            blocks.push({ kind: 'fixed-width', lines: [ticks, ...value.split('\n'), ticks] });
        } else {
            const lines = renderElement(child, ctx);
            if (lines) blocks.push({ kind: child.type, lines });
        }
    }
    return joinBlocks(blocks);
}

function notes(lines: string[]): string[] | undefined {
    if (!lines.length) return undefined;
    // Marp shows HTML comments as presenter notes.
    return ['<!--', ...lines.map(commentSafe), '-->'];
}

function renderSpecialBlock(el: Node, ctx: Context): string[] | undefined {
    const type = String(el.properties?.blockType || '').toLowerCase();
    if (type === 'notes') return notes(renderBlocks(el.children || [], ctx));
    if (type === 'countdown') {
        // #+begin_countdown 3:00 -> ```countdown 3:00
        const begin = el.sourceLine ? ctx.sourceLines[el.sourceLine - 1] : '';
        const time = /^\s*#\+begin_countdown\s+(\S+)/i.exec(begin ?? '')?.[1];
        const label = renderBlocks(el.children || [], ctx);
        return [`\`\`\`countdown${time ? ` ${time}` : ''}`, ...label, '```'];
    }
    // Other blocks become a div with the block's name as its class, for theme CSS.
    return [`<div class="${type.replace(/[^\w-]/g, '')}">`, '', ...renderBlocks(el.children || [], ctx), '', '</div>'];
}

function renderTable(el: Node, ctx: Context): string[] | undefined {
    const rows: string[][] = [];
    for (const row of el.children || []) {
        if (row.type === 'table-row' && row.properties?.rowType === 'standard') {
            rows.push((row.children || []).map((cell: Node) => inline(cell.children || [], ctx).trim().replace(/\|/g, '\\|')));
        }
    }
    if (!rows.length) return undefined;
    const cols = Math.max(...rows.map(r => r.length));
    const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
    const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
    return [line(rows[0]), `|${Array(cols).fill('---').join('|')}|`, ...rows.slice(1).map(line)];
}

// ---------------------------------------------------------------------------
// Objects

function inline(objects: Node[], ctx: Context): string {
    return objects.map(o => inlineObject(o, ctx)).join('');
}

function codeSpan(value: string): string {
    let ticks = '`';
    while (value.includes(ticks)) ticks += '`';
    const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
    return `${ticks}${pad}${value}${pad}${ticks}`;
}

function inlineObject(o: Node, ctx: Context): string {
    const p = o.properties || {};
    switch (o.type) {
        case 'plain-text':
            return p.value ?? '';
        case 'bold':
            return `**${inline(o.children || [], ctx)}**`;
        case 'italic':
            return `*${inline(o.children || [], ctx)}*`;
        case 'underline':
            return `<u>${inline(o.children || [], ctx)}</u>`;
        case 'strike-through':
            return `~~${inline(o.children || [], ctx)}~~`;
        case 'code':
        case 'verbatim':
            return codeSpan(p.value ?? '');
        case 'inline-src-block':
            return codeSpan(p.value ?? '');
        case 'superscript':
            return `<sup>${inline(o.children || [], ctx)}</sup>`;
        case 'subscript':
            return `<sub>${inline(o.children || [], ctx)}</sub>`;
        case 'entity':
            return p.utf8 || p.html || '';
        case 'latex-fragment': {
            const v = String(p.value ?? '');
            if (p.fragmentType === 'inline-math') {
                const m = /^\\\(([\s\S]*)\\\)$/.exec(v);
                return m ? `$${m[1]}$` : v;
            }
            if (p.fragmentType === 'display-math') {
                // Marp renders $$ only as a block on lines of its own.
                const m = /^\\\[([\s\S]*)\\\]$/.exec(v) ?? /^\$\$([\s\S]*)\$\$$/.exec(v);
                return m ? `\n$$\n${m[1].trim()}\n$$\n` : v;
            }
            return v;
        }
        case 'line-break':
            return '\\\n';
        case 'footnote-reference':
            return `<sup>${p.label ?? p.value ?? ''}</sup>`;
        case 'timestamp':
            return p.rawValue ?? '';
        case 'statistics-cookie':
            return p.value ?? '';
        case 'target':
            return '';
        case 'radio-target':
            return inline(o.children || [], ctx) || (p.value ?? '');
        case 'export-snippet':
            return PASSTHROUGH_BACKENDS.has(String(p.backend || '').toLowerCase()) ? (p.value ?? '') : '';
        case 'inline-babel-call':
            return '';
        case 'macro': {
            const key = String(p.key || '').toLowerCase();
            const fromKeyword = ({ title: 'TITLE', author: 'AUTHOR', date: 'DATE', email: 'EMAIL' } as Record<string, string>)[key];
            if (fromKeyword) return ctx.keywords[fromKeyword] ?? '';
            return p.value ?? '';
        }
        case 'citation':
            return pandocCitationObject(p);
        case 'link':
            return inlineLink(o, ctx);
        default:
            return o.children ? inline(o.children, ctx) : (p.value ?? '');
    }
}

function markdownUrl(url: string): string {
    return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}

function inlineLink(o: Node, ctx: Context): string {
    const p = o.properties || {};
    let type = String(p.linkType || '').toLowerCase();
    let path = String(p.path || '');
    // The export parser leaves link types it does not know (marp:) as fuzzy
    const scheme = type === 'fuzzy' ? path.match(/^(marp):(.*)$/i) : null;
    if (scheme) { type = scheme[1].toLowerCase(); path = scheme[2]; }
    const desc = o.children?.length ? inline(o.children, ctx) : '';

    if (CITATION_LINK_TYPES.has(type)) return pandocCitationLink(type, path);
    if (BIBLIOGRAPHY_LINK_TYPES.has(type)) {
        if (type === 'bibliography' || type === 'nobibliography') addBibliography(ctx, path);
        return '';
    }

    if (isImageLink(o)) {
        const url = (type === 'http' || type === 'https') && !/^https?:/i.test(path) ? `${type}:${path}` : path;
        return `![${(ctx.imageOptions ?? []).join(' ')}](${markdownUrl(url)})`;
    }

    // A bare link to a movie, sound or YouTube video plays on the slide (an
    // image link shows the image); with a description it stays a link.
    if (!desc) {
        const media = mediaEmbed(type, path);
        if (media) return media;
    }

    let url: string | undefined;
    switch (type) {
        case 'marp':
            // Another deck: link to the .md file, without the ::N slide number
            url = path.replace(/::.*$/, '');
            break;
        case 'http':
        case 'https':
        case 'ftp':
        case 'mailto':
            url = /^[a-z][\w+.-]*:/i.test(path) ? path : `${type}:${path}`;
            break;
        case 'doi':
            url = `https://doi.org/${path}`;
            break;
        case 'file':
        case 'attachment':
            url = path;
            break;
        default:
            // Internal links (headings, targets, ids) and app links: just the text.
            return desc || path;
    }
    if (!desc && (type === 'http' || type === 'https')) return `<${url}>`;
    return `[${desc || path}](${markdownUrl(url)})`;
}
