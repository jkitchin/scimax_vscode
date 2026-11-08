/**
 * The search view's logic, kept free of vscode so it can be tested.
 *
 * The database finds files (full text), chunks (semantic) and headings; this
 * module turns those into results grouped by file, each with the lines that
 * are relevant: the lines that contain the query's words, the start of a
 * semantic chunk, or the heading itself, with the headings above each line.
 * The tag, property and TODO filters apply to a line through the heading it
 * is under, so a full-text hit in a :paper: subtree passes a "paper" filter.
 */

import { minimatch } from 'minimatch';
import type { HeadingRecord, SearchResult } from '../database/scimaxDbCore';

export type SearchMode = 'fulltext' | 'semantic' | 'headings';

/** How files are ordered: last modified first, best match first, or by file name. */
export type SortOrder = 'recent' | 'relevance' | 'name';

export interface PropertyFilter {
    key: string;
    /** Value must contain this (case-insensitive); unset means the property is set at all */
    value?: string;
}

export interface SearchFilters {
    includeTags: string[];
    excludeTags: string[];
    properties: PropertyFilter[];
    /** Path patterns: globs (with * ? [ {) or plain text found anywhere in the path */
    paths: string[];
    /** TODO states the heading must have one of; TODO_OPEN and TODO_DONE stand for any open or done state */
    includeTodo: string[];
    /** TODO states the heading must not have (TODO_OPEN and TODO_DONE work here too) */
    excludeTodo: string[];
    /** States that count as done, besides those a file's #+TODO line marks done */
    doneStates: string[];
}

/** Any TODO state that is not done. */
export const TODO_OPEN = '@open';
/** Any done state. */
export const TODO_DONE = '@done';
export const DEFAULT_DONE_STATES = ['DONE', 'CANCELLED', 'CANCELED'];

/** A word or phrase of the query, for finding and marking it in a line. */
export interface QueryTerm {
    text: string;
    /** prefix* in the query: matches any word that starts with it */
    prefix: boolean;
}

export interface Hit {
    /** 1-based line in the file */
    line: number;
    text: string;
    /** [start, end) character ranges of `text` to highlight */
    marks: Array<[number, number]>;
    /** Lines after `text` shown with it (a semantic chunk's next lines) */
    more?: string[];
    /** Titles of the heading the line is in and the ones above it, outermost first */
    outline: string[];
    kinds: SearchMode[];
    /** The hit is a heading line: its TODO keyword and tags */
    todo?: string | null;
    tags?: string[];
}

export interface FileResult {
    filePath: string;
    hits: Hit[];
    /** Higher is better: reciprocal-rank fusion over the modes that found the file */
    score: number;
    kinds: SearchMode[];
    /** A full-text match with no single line holding a query word: the database's snippet */
    snippet?: string;
    /** Last modified, in ms since the epoch, when known */
    mtime?: number;
}

const HIGHLIGHT_OPEN = '<mark>';
const HIGHLIGHT_CLOSE = '</mark>';

/** No filters at all. */
export function emptyFilters(): SearchFilters {
    return { includeTags: [], excludeTags: [], properties: [], paths: [], includeTodo: [], excludeTodo: [], doneStates: DEFAULT_DONE_STATES };
}

export function hasFilters(f: SearchFilters): boolean {
    return f.includeTags.length + f.excludeTags.length + f.properties.length + f.paths.length
        + f.includeTodo.length + f.excludeTodo.length > 0;
}

/**
 * `STATUS=draft, AUTHOR` → [{key: STATUS, value: draft}, {key: AUTHOR}].
 * Commas or semicolons separate filters; `:` also works for `=`.
 */
export function parsePropertyFilters(text: string): PropertyFilter[] {
    return text.split(/[,;]/).map(s => s.trim()).filter(Boolean).map(part => {
        const m = /^:?([^=:\s]+):?\s*(?:[=:]\s*(.*))?$/.exec(part);
        if (!m) return { key: part };
        const value = m[2]?.trim();
        return value ? { key: m[1], value } : { key: m[1] };
    });
}

/** Comma- or newline-separated path patterns. */
export function parsePathPatterns(text: string): string[] {
    return text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

/**
 * The words and phrases of a full-text query worth marking: FTS5 operators,
 * NOT terms, column names, ^ and parentheses are dropped.
 */
export function queryTerms(query: string): QueryTerm[] {
    const terms: QueryTerm[] = [];
    const tokenRe = /"((?:[^"]|"")*)"?\*?|[^\s(),"]+/g;
    let negate = false;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(query)) !== null) {
        const tok = m[0];
        if (tok === 'NOT') { negate = true; continue; }
        if (tok === 'AND' || tok === 'OR' || tok === 'NEAR' || /^\d+$/.test(tok)) continue;
        let text: string;
        let prefix = false;
        if (tok.startsWith('"')) {
            text = (m[1] ?? '').replace(/""/g, '"');
            prefix = tok.endsWith('*');
        } else {
            text = tok.replace(/^(?:file_path|title|content):/, '').replace(/^\^/, '');
            if (text.endsWith('*')) { prefix = true; text = text.slice(0, -1); }
            text = text.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, '');
        }
        text = text.trim();
        if (negate) { negate = false; continue; }
        if (text && !terms.some(t => t.text.toLowerCase() === text.toLowerCase())) terms.push({ text, prefix });
    }
    return terms;
}

/** Words that the index's porter stemmer reduces to the same stem start alike; strip common endings. */
function stem(word: string): string {
    const w = word.toLowerCase();
    if (w.length <= 4) return w;
    let s = w.replace(/(?:ational|ization|ations|ation|ings|ing|ies|ied|edly|ed|es|ly|s)$/, '');
    // running → runn → run, as the porter stemmer has it
    if (s !== w && /([b-df-hj-np-tv-z])\1$/.test(s) && !/(?:ll|ss|zz)$/.test(s)) s = s.slice(0, -1);
    return s.length >= 3 ? s : w;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One regex that finds any of the terms in a line, case-insensitively, at
 * the start of a word. A one-word term matches its inflections (stemmed, as
 * the index matches); a phrase matches its words with any spacing between.
 */
export function termRegex(terms: QueryTerm[]): RegExp | null {
    if (!terms.length) return null;
    const parts = terms.map(t => {
        const words = t.text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
        if (!words.length) return escapeRegex(t.text);
        if (words.length === 1) {
            const w = words[0];
            const s = stem(w);
            const open = t.prefix || s !== w.toLowerCase();
            return escapeRegex(open ? s : w) + (open ? '[\\p{L}\\p{N}_]*' : '(?![\\p{L}\\p{N}_])');
        }
        return words.map(escapeRegex).join('[^\\p{L}\\p{N}_]+') + (t.prefix ? '[\\p{L}\\p{N}_]*' : '');
    });
    return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${parts.join('|')})`, 'giu');
}

export interface LineMatch {
    line: number;
    text: string;
    marks: Array<[number, number]>;
    /** How many different terms the line has */
    distinct: number;
}

/** Every line that contains a term, with the ranges to mark. */
export function matchingLines(lines: string[], re: RegExp): LineMatch[] {
    const out: LineMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        re.lastIndex = 0;
        const marks: Array<[number, number]> = [];
        const seen = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) { re.lastIndex++; continue; }
            marks.push([m.index, m.index + m[0].length]);
            seen.add(stem(m[0]));
        }
        if (marks.length) out.push({ line: i + 1, text, marks, distinct: seen.size });
    }
    return out;
}

/** Marks for a line, for heading and semantic hits whose line was found another way. */
export function marksIn(text: string, re: RegExp | null): Array<[number, number]> {
    if (!re) return [];
    return matchingLines([text], re)[0]?.marks ?? [];
}

/** Ranges of a `<mark>`-highlighted FTS snippet, with the tags taken out. */
export function parseSnippet(snippet: string): { text: string; marks: Array<[number, number]> } {
    let text = '';
    const marks: Array<[number, number]> = [];
    let rest = snippet.replace(/\s*\n\s*/g, ' ');
    while (rest.length) {
        const open = rest.indexOf(HIGHLIGHT_OPEN);
        if (open < 0) { text += rest; break; }
        text += rest.slice(0, open);
        rest = rest.slice(open + HIGHLIGHT_OPEN.length);
        const close = rest.indexOf(HIGHLIGHT_CLOSE);
        const inner = close < 0 ? rest : rest.slice(0, close);
        marks.push([text.length, text.length + inner.length]);
        text += inner;
        rest = close < 0 ? '' : rest.slice(close + HIGHLIGHT_CLOSE.length);
    }
    return { text, marks };
}

// ----------------------------------------------------------------------
// Headings: which heading a line is in, its outline and its tags
// ----------------------------------------------------------------------

function jsonList(text: string | null | undefined): string[] {
    if (!text) return [];
    try {
        const v = JSON.parse(text);
        return Array.isArray(v) ? v.map(String) : [];
    } catch {
        return [];
    }
}

function jsonObject(text: string | null | undefined): Record<string, string> {
    if (!text) return {};
    try {
        const v = JSON.parse(text);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
        return {};
    }
}

/** A file's headings in line order, for finding the heading a line is in. */
export class FileOutline {
    private readonly headings: HeadingRecord[];

    constructor(headings: HeadingRecord[]) {
        this.headings = [...headings].sort((a, b) => a.line_number - b.line_number);
    }

    /** The heading whose section holds `line` (the nearest at or above it), if any. */
    headingAt(line: number): HeadingRecord | undefined {
        let lo = 0;
        let hi = this.headings.length - 1;
        let found: HeadingRecord | undefined;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (this.headings[mid].line_number <= line) { found = this.headings[mid]; lo = mid + 1; }
            else hi = mid - 1;
        }
        return found;
    }

    /** Titles from the top-level heading down to `heading`, inclusive. */
    outline(heading: HeadingRecord | undefined): string[] {
        if (!heading) return [];
        const out = [heading.title];
        let level = heading.level;
        const start = this.headings.indexOf(heading);
        for (let i = start - 1; i >= 0 && level > 1; i--) {
            const h = this.headings[i];
            if (h.level < level) { out.unshift(h.title); level = h.level; }
        }
        return out;
    }
}

/** A heading's own and inherited tags, lowercased. */
export function headingTags(h: HeadingRecord): string[] {
    return [...new Set([...jsonList(h.tags), ...jsonList(h.inherited_tags)].map(t => t.toLowerCase()))];
}

/** Whether a heading's TODO state is done: by its file's #+TODO line or by `doneStates`. */
export function headingDone(h: HeadingRecord, doneStates: string[]): boolean {
    return h.todo_type === 'done' || (!!h.todo_state && doneStates.includes(h.todo_state));
}

/** Whether a heading has the TODO state `want` (a state, TODO_OPEN or TODO_DONE). */
export function todoMatches(h: HeadingRecord, want: string, doneStates: string[]): boolean {
    if (want === TODO_OPEN) return !!h.todo_state && !headingDone(h, doneStates);
    if (want === TODO_DONE) return headingDone(h, doneStates);
    return h.todo_state === want;
}

/**
 * Whether a line under `heading` passes the tag, property and TODO filters.
 * A line above every heading passes only the exclude filters.
 */
export function headingPasses(heading: HeadingRecord | undefined, f: SearchFilters): boolean {
    if (!f.includeTags.length && !f.excludeTags.length && !f.properties.length
        && !f.includeTodo.length && !f.excludeTodo.length) return true;
    if (!heading) return !f.includeTags.length && !f.properties.length && !f.includeTodo.length;
    if (f.includeTodo.length && !f.includeTodo.some(t => todoMatches(heading, t, f.doneStates))) return false;
    if (f.excludeTodo.some(t => todoMatches(heading, t, f.doneStates))) return false;
    const tags = headingTags(heading);
    if (!f.includeTags.every(t => tags.includes(t.toLowerCase()))) return false;
    if (f.excludeTags.some(t => tags.includes(t.toLowerCase()))) return false;
    if (f.properties.length) {
        const props = jsonObject(heading.properties);
        const byKey = new Map(Object.entries(props).map(([k, v]) => [k.toUpperCase(), String(v)]));
        for (const p of f.properties) {
            const v = byKey.get(p.key.toUpperCase());
            if (v === undefined) return false;
            if (p.value && !v.toLowerCase().includes(p.value.toLowerCase())) return false;
        }
    }
    return true;
}

/**
 * Whether a file passes the path patterns: any pattern may match. A pattern
 * with glob characters is matched against the absolute path, and against the
 * path relative to its workspace folder when there is one, so a relative
 * glob like `notes/*.org` works; a glob with no slash matches the file name.
 * Plain text matches anywhere in the path, case-insensitively.
 */
export function pathPasses(filePath: string, patterns: string[], relativePath?: string): boolean {
    if (!patterns.length) return true;
    const abs = filePath.replace(/\\/g, '/');
    const rel = relativePath?.replace(/\\/g, '/');
    return patterns.some(raw => {
        const p = raw.replace(/\\/g, '/');
        if (/[*?[{]/.test(p)) {
            const opts = { dot: true, nocase: true, matchBase: !p.includes('/') };
            return minimatch(abs, p, opts) || (rel !== undefined && minimatch(rel, p, opts));
        }
        return abs.toLowerCase().includes(p.toLowerCase());
    });
}

// ----------------------------------------------------------------------
// Assembling results
// ----------------------------------------------------------------------

/** How many hits are kept per file; the view shows a few and expands to the rest. */
export const MAX_HITS_PER_FILE = 50;

/** Collects hits per file across the modes, merging hits on the same line. */
export class ResultBuilder {
    private readonly files = new Map<string, FileResult>();
    private readonly order: string[] = [];

    /** Score a file found by `mode` at 0-based `rank` among that mode's files. */
    rankFile(filePath: string, mode: SearchMode, rank: number): FileResult {
        let f = this.files.get(filePath);
        if (!f) {
            f = { filePath, hits: [], score: 0, kinds: [] };
            this.files.set(filePath, f);
            this.order.push(filePath);
        }
        if (!f.kinds.includes(mode)) {
            f.kinds.push(mode);
            f.score += 1 / (rank + 1);
        }
        return f;
    }

    has(filePath: string): boolean {
        return this.files.has(filePath);
    }

    addHit(filePath: string, hit: Hit): void {
        const f = this.files.get(filePath);
        if (!f) return;
        const same = f.hits.find(h => h.line === hit.line);
        if (same) {
            for (const k of hit.kinds) if (!same.kinds.includes(k)) same.kinds.push(k);
            if (!same.marks.length && hit.marks.length) same.marks = hit.marks;
            if (hit.more && !same.more) same.more = hit.more;
            if (hit.todo !== undefined && same.todo === undefined) { same.todo = hit.todo; same.tags = hit.tags; }
            return;
        }
        f.hits.push(hit);
    }

    /** Drop a file (it had no hits left after filtering). */
    remove(filePath: string): void {
        if (!this.files.delete(filePath)) return;
        const i = this.order.indexOf(filePath);
        if (i >= 0) this.order.splice(i, 1);
    }

    /** The files collected so far, in the order they were found. */
    paths(): string[] {
        return this.order.filter(p => this.files.has(p));
    }

    /**
     * Files in `order` (best match first by default), hits in line order and
     * capped. Files with neither hits nor snippet are left out. For 'recent',
     * `mtimes` gives each file's modified time; files without one go last.
     */
    results(order: SortOrder = 'relevance', mtimes?: Map<string, number>): FileResult[] {
        const byScore = (a: FileResult, b: FileResult) => b.score - a.score;
        const compare: Record<SortOrder, (a: FileResult, b: FileResult) => number> = {
            relevance: byScore,
            recent: (a, b) => (b.mtime ?? -Infinity) - (a.mtime ?? -Infinity) || byScore(a, b),
            name: (a, b) => baseName(a.filePath).localeCompare(baseName(b.filePath), undefined, { sensitivity: 'base', numeric: true })
                || a.filePath.localeCompare(b.filePath) || byScore(a, b),
        };
        return this.order
            .map(p => this.files.get(p))
            .filter((f): f is FileResult => !!f && (f.hits.length > 0 || !!f.snippet))
            .map(f => ({
                ...f,
                hits: [...f.hits].sort((a, b) => a.line - b.line).slice(0, MAX_HITS_PER_FILE),
                mtime: mtimes?.get(f.filePath) ?? f.mtime,
            }))
            .sort(compare[order] ?? byScore);
    }
}

function baseName(p: string): string {
    return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

/** Up to `count` non-blank lines of a semantic chunk, trimmed. */
export function chunkLines(content: string, count: number): string[] {
    return content.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim()).slice(0, count);
}

/** Unique file paths in result order. */
export function filesInOrder(results: Array<Pick<SearchResult, 'file_path'>>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of results) {
        if (!seen.has(r.file_path)) { seen.add(r.file_path); out.push(r.file_path); }
    }
    return out;
}
