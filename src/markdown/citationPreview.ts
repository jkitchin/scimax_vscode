/**
 * Citations in the Markdown preview: `[@key]`, `[see @a, p. 3; @b]`, a bare
 * `@key` (only when the key is in the bibliography) and MyST `{cite:t}` /
 * `{cite:p}` roles render as author-year text with the full reference as a
 * tooltip.
 *
 * The bibliography comes from the front matter `bibliography:` key, or from
 * the nearest `myst.yml` (`project.bibliography`) or Jupyter Book
 * `_config.yml` (`bibtex_bibfiles`) above the file. Parsed files are cached
 * by modification time.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BibEntry, formatAuthors, formatCitation, parseBibTeX } from '../references/bibtexParser';

export interface CitationItem {
    key: string;
    prefix?: string;
    suffix?: string;
}

/** p: (Grant et al., 2006); t: Grant et al. (2006); alp: Grant et al., 2006 */
export type CitationMode = 'p' | 't' | 'alp' | 'author' | 'year';

interface CachedBib {
    mtimeMs: number;
    entries: Map<string, BibEntry>;
    labels: Map<string, { author: string; year: string; full: string }>;
}

const bibCache = new Map<string, CachedBib>();

function loadYaml(text: string): any {
    try {
        return yaml.load(text);
    } catch {
        return undefined;
    }
}

function asList(value: unknown): string[] {
    if (typeof value === 'string') {
        return value.split(',').map(s => s.trim()).filter(Boolean);
    }
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** `bibliography:` from a document's YAML front matter. */
export function frontMatterBibliography(src: string): string[] {
    const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(src);
    return m ? asList(loadYaml(m[1])?.bibliography) : [];
}

let fallbackLookup: ((key: string) => BibEntry | undefined) | undefined;

/**
 * Where to look up a key the document's own bibliography does not have:
 * Scimax's reference manager (configured, workspace and added .bib files),
 * set by the extension, so the previews know what the editor's citation
 * hover knows.
 */
export function setFallbackCitationLookup(lookup: ((key: string) => BibEntry | undefined) | undefined): void {
    fallbackLookup = lookup;
}

/** True when keys can be found without a bibliography file. */
export function hasFallbackCitationLookup(): boolean {
    return !!fallbackLookup;
}

/**
 * The reference manager's entries for the keys that may be cited in `text`,
 * for Marp CLI, which renders in another process (see cliEngine.ts). Every
 * word that could be a key is looked up, so nothing cited is missed.
 */
export function fallbackEntriesFor(text: string): Record<string, BibEntry> {
    const found: Record<string, BibEntry> = {};
    if (!fallbackLookup) return found;
    for (const word of new Set(text.match(/[\w][\w:.\-/+]*/g) ?? [])) {
        for (const key of [word, word.replace(/[:.\-/+]+$/, '')]) {
            if (key in found) continue;
            const entry = fallbackLookup(key);
            if (entry) found[key] = entry;
        }
    }
    return found;
}

/** Bibliography files for a document: front matter first, then the project config. */
export function bibliographyPaths(docPath: string, frontMatter: string[]): string[] {
    const docDir = path.dirname(docPath);
    const paths = frontMatter.map(p => path.resolve(docDir, p));
    for (let dir = docDir; ; dir = path.dirname(dir)) {
        const myst = path.join(dir, 'myst.yml');
        const jb = path.join(dir, '_config.yml');
        if (fs.existsSync(myst)) {
            paths.push(...asList(loadYaml(fs.readFileSync(myst, 'utf8'))?.project?.bibliography)
                .map(p => path.resolve(dir, p)));
            break;
        }
        if (fs.existsSync(jb)) {
            const bibs = asList(loadYaml(fs.readFileSync(jb, 'utf8'))?.bibtex_bibfiles);
            if (bibs.length) {
                paths.push(...bibs.map(p => path.resolve(dir, p)));
                break;
            }
        }
        if (path.dirname(dir) === dir) {
            break;
        }
    }
    return [...new Set(paths)];
}

function loadBib(file: string): CachedBib | undefined {
    try {
        const { mtimeMs } = fs.statSync(file);
        const cached = bibCache.get(file);
        if (cached?.mtimeMs === mtimeMs) {
            return cached;
        }
        const entries = new Map(parseBibTeX(fs.readFileSync(file, 'utf8')).entries.map(e => [e.key, e]));
        const entry: CachedBib = { mtimeMs, entries, labels: new Map() };
        bibCache.set(file, entry);
        return entry;
    } catch {
        return undefined;
    }
}

const stripBraces = (s: string) => s.replace(/[{}]/g, '');

function labelFor(entry: BibEntry): { author: string; year: string; full: string } {
    return {
        author: stripBraces(formatAuthors(entry.author, 2)),
        year: entry.year || 'n.d.',
        full: stripBraces(formatCitation(entry, 'full')),
    };
}

const fallbackLabels = new WeakMap<BibEntry, { author: string; year: string; full: string }>();

/**
 * Author, year and full reference for a key: from the files, then the
 * fallback lookup. Undefined when it is in neither.
 */
export function lookupCitation(key: string, bibFiles: string[]): { author: string; year: string; full: string } | undefined {
    for (const file of bibFiles) {
        const bib = loadBib(file);
        const entry = bib?.entries.get(key);
        if (!bib || !entry) {
            continue;
        }
        let label = bib.labels.get(key);
        if (!label) {
            label = labelFor(entry);
            bib.labels.set(key, label);
        }
        return label;
    }
    const entry = fallbackLookup?.(key);
    if (!entry) {
        return undefined;
    }
    let label = fallbackLabels.get(entry);
    if (!label) {
        label = labelFor(entry);
        fallbackLabels.set(entry, label);
    }
    return label;
}

/** Items of a bracketed citation body: "see @a, p. 3; @b". Undefined if it is not one. */
export function parseCitationItems(body: string): CitationItem[] | undefined {
    const items: CitationItem[] = [];
    for (const part of body.split(';')) {
        const m = /^\s*(.*?)-?@([\w][\w:.#$%&+?<>~/-]*?)([,\s][\s\S]*)?$/.exec(part);
        if (!m) {
            return undefined;
        }
        items.push({ key: m[2], prefix: m[1].trim() || undefined, suffix: m[3]?.replace(/^\s*,?\s*/, '').trim() || undefined });
    }
    return items.length ? items : undefined;
}

/**
 * HTML for a citation; `escape` is markdown-it's escapeHtml. With `numbers`
 * (key -> number, set for Marp decks by slideCitations.ts), citations are
 * numbered: [1], [1, 3], [2, p. 4]; a textual one is "Author [1]".
 */
export function renderCitation(
    items: CitationItem[],
    mode: CitationMode,
    bibFiles: string[],
    escape: (s: string) => string,
    numbers?: Map<string, number>
): string {
    if (numbers && mode !== 'author' && mode !== 'year') {
        return renderNumbered(items, mode, bibFiles, escape, numbers);
    }
    const parts = items.map(item => {
        const found = lookupCitation(item.key, bibFiles);
        let text: string;
        if (!found) {
            text = item.key;
        } else if (mode === 't') {
            text = `${found.author} (${found.year}${item.suffix ? ', ' + item.suffix : ''})`;
        } else if (mode === 'author') {
            text = found.author;
        } else if (mode === 'year') {
            text = found.year;
        } else {
            text = `${found.author}, ${found.year}`;
        }
        if (mode !== 't' && item.suffix) {
            text += `, ${item.suffix}`;
        }
        const title = found ? found.full : `${item.key}: not found in the bibliography`;
        const cls = found ? 'scimax-cite' : 'scimax-cite scimax-cite-missing';
        const prefix = item.prefix ? `${escape(item.prefix)} ` : '';
        return `${prefix}<span class="${cls}" title="${escape(title)}">${escape(text)}</span>`;
    });
    const sep = mode === 't' ? ', ' : '; ';
    return mode === 'p' ? `(${parts.join(sep)})` : parts.join(sep);
}

function renderNumbered(
    items: CitationItem[],
    mode: CitationMode,
    bibFiles: string[],
    escape: (s: string) => string,
    numbers: Map<string, number>
): string {
    const parts = items.map(item => {
        const found = lookupCitation(item.key, bibFiles);
        const n = numbers.get(item.key);
        const prefix = item.prefix ? `${escape(item.prefix)} ` : '';
        if (!found || n === undefined) {
            return `${prefix}<span class="scimax-cite scimax-cite-missing" title="${escape(`${item.key}: not found in the bibliography`)}">${escape(item.key)}</span>`;
        }
        const num = `<span class="scimax-cite" title="${escape(found.full)}">${n}${item.suffix ? escape(`, ${item.suffix}`) : ''}</span>`;
        return mode === 't' ? `${prefix}${escape(found.author)} [${num}]` : prefix + num;
    });
    return mode === 't' ? parts.join(', ') : `[${parts.join(', ')}]`;
}

/** `html` (already escaped) with each http(s) URL made a link; trailing punctuation stays outside. */
export function linkifyUrls(html: string): string {
    return html.replace(/\bhttps?:\/\/[^\s<>"]+/g, url => {
        const tail = /[.,;:)\]]+$/.exec(url)?.[0] ?? '';
        const href = tail ? url.slice(0, -tail.length) : url;
        return `<a href="${href}">${href}</a>${tail}`;
    });
}
