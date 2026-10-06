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

/** Author, year and full reference for a key, or undefined if it is not in the files. */
export function lookupCitation(key: string, bibFiles: string[]): { author: string; year: string; full: string } | undefined {
    for (const file of bibFiles) {
        const bib = loadBib(file);
        const entry = bib?.entries.get(key);
        if (!bib || !entry) {
            continue;
        }
        let label = bib.labels.get(key);
        if (!label) {
            label = {
                author: stripBraces(formatAuthors(entry.author, 2)),
                year: entry.year || 'n.d.',
                full: stripBraces(formatCitation(entry, 'full')),
            };
            bib.labels.set(key, label);
        }
        return label;
    }
    return undefined;
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

/** HTML for a citation; `escape` is markdown-it's escapeHtml. */
export function renderCitation(
    items: CitationItem[],
    mode: CitationMode,
    bibFiles: string[],
    escape: (s: string) => string
): string {
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
