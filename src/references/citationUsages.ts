/**
 * Find where a citation key is cited in a file's text.
 *
 * Citations are read with the citation parser, so every syntax it knows
 * counts and the key can be anywhere in the citation: org-ref v2
 * (cite:a,key) and v3 (cite:&a;&key, [[cite:&key][desc]]), org-cite
 * ([cite:@key]) and LaTeX (\citep[p. 5]{a,key}). Markdown files also count
 * Pandoc citations ([@key], @key). Keys compare ignoring case, as BibTeX does.
 */

import { parseCitationsFromLine } from './citationParser';

export interface KeyUsage {
    /** 0-based line */
    line: number;
    /** Columns of the key in the line (the whole citation if not found) */
    start: number;
    end: number;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Column of `key` within [from, to) of `line`, as a whole key, or -1. */
function keyColumn(line: string, key: string, from: number, to: number): number {
    const re = new RegExp(`(?<![\\w:-])${escapeRegex(key)}(?![\\w:-])`, 'gi');
    re.lastIndex = from;
    const m = re.exec(line);
    return m && m.index + key.length <= to ? m.index : -1;
}

/** Usages of `key` in one line. */
export function findKeyInLine(line: string, key: string, lineNumber = 0, pandoc = false): KeyUsage[] {
    const lower = key.toLowerCase();
    if (!line.toLowerCase().includes(lower)) return [];

    const usages: KeyUsage[] = [];
    const seen = new Set<number>();
    for (const citation of parseCitationsFromLine(line)) {
        if (!citation.references.some(r => r.key.toLowerCase() === lower)) continue;
        const { start, end } = citation.range;
        const col = keyColumn(line, key, start, end);
        const usage = col >= 0
            ? { line: lineNumber, start: col, end: col + key.length }
            : { line: lineNumber, start, end };
        if (!seen.has(usage.start)) {
            seen.add(usage.start);
            usages.push(usage);
        }
    }

    if (pandoc) {
        const re = new RegExp(`(?<![\\w@.-])@${escapeRegex(key)}(?![\\w:-])`, 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
            const start = m.index + 1;
            if (!seen.has(start)) {
                seen.add(start);
                usages.push({ line: lineNumber, start, end: start + key.length });
            }
        }
    }

    return usages.sort((a, b) => a.start - b.start);
}

/** Usages of `key` in a file's lines. Pandoc citations count in Markdown. */
export function findKeyUsages(lines: string[], key: string, filePath = ''): KeyUsage[] {
    const pandoc = /\.(md|markdown|qmd|rmd)$/i.test(filePath);
    const usages: KeyUsage[] = [];
    for (let i = 0; i < lines.length; i++) {
        usages.push(...findKeyInLine(lines[i], key, i, pandoc));
    }
    return usages;
}

/** The key of the BibTeX entry containing `line` (0-based), if any. */
export function bibtexKeyAtLine(lines: string[], line: number): string | undefined {
    for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
        const m = /^\s*@(\w+)\s*[{(]\s*([^,\s]+)\s*,/.exec(lines[i]);
        if (m) {
            const type = m[1].toLowerCase();
            return type === 'comment' || type === 'string' || type === 'preamble' ? undefined : m[2];
        }
    }
    return undefined;
}
