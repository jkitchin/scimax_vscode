/**
 * Citation processor using citation-js for formatting citations and bibliographies
 * Supports CSL (Citation Style Language) styles for consistent formatting
 */

import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-csl';

import type { BibEntry } from './bibtexParser';
import type { ParsedCitation, CitationReference } from './citationTypes';
import { getNormalizedStyle } from './citationParser';
import { parseAuthors as parseAuthorsFromBibtex, getDisplayLastName, type CSLAuthor } from './authorUtils';

/**
 * CSL-JSON entry type (simplified)
 * Full spec: https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html
 */
export interface CSLEntry {
    id: string;
    type: string;
    title?: string;
    author?: Array<{ family?: string; given?: string; literal?: string }>;
    issued?: { 'date-parts'?: number[][]; literal?: string };
    'container-title'?: string;
    volume?: string | number;
    issue?: string | number;
    page?: string;
    DOI?: string;
    URL?: string;
    publisher?: string;
    'publisher-place'?: string;
    edition?: string | number;
    abstract?: string;
    keyword?: string;
    [key: string]: unknown;
}

/**
 * Map BibTeX entry types to CSL types
 */
const BIBTEX_TO_CSL_TYPE: Record<string, string> = {
    article: 'article-journal',
    book: 'book',
    booklet: 'pamphlet',
    inbook: 'chapter',
    incollection: 'chapter',
    inproceedings: 'paper-conference',
    conference: 'paper-conference',
    manual: 'book',
    mastersthesis: 'thesis',
    phdthesis: 'thesis',
    proceedings: 'book',
    techreport: 'report',
    unpublished: 'manuscript',
    misc: 'document',
    online: 'webpage',
    patent: 'patent',
    periodical: 'periodical',
    report: 'report',
    thesis: 'thesis',
    dataset: 'dataset',
    software: 'software',
};

/**
 * Parse author string into CSL author array
 * Handles formats like "Last, First and Last2, First2" or "First Last and First2 Last2"
 *
 * Now uses citation-js for proper BibTeX name parsing with support for:
 * - Particles (von, van der, de la, etc.)
 * - Suffixes (Jr., III, etc.)
 * - Corporate/institutional authors ({NASA}, {National Academy of Sciences})
 */
function parseAuthors(authorStr: string | undefined): CSLEntry['author'] {
    if (!authorStr) return undefined;

    const authors = parseAuthorsFromBibtex(authorStr);
    return authors.length > 0 ? authors as CSLEntry['author'] : undefined;
}

/**
 * Parse year string into CSL date format
 */
function parseYear(yearStr: string | undefined): CSLEntry['issued'] {
    if (!yearStr) return undefined;

    const year = parseInt(yearStr, 10);
    if (isNaN(year)) {
        return { literal: yearStr };
    }

    return { 'date-parts': [[year]] };
}

/**
 * Convert BibEntry to CSL-JSON format
 */
export function bibEntryToCSL(entry: BibEntry): CSLEntry {
    const cslType = BIBTEX_TO_CSL_TYPE[entry.type.toLowerCase()] || 'document';

    const csl: CSLEntry = {
        id: entry.key,
        type: cslType,
        title: entry.title,
        author: parseAuthors(entry.author),
        issued: parseYear(entry.year),
        'container-title': entry.journal || entry.booktitle,
        volume: entry.volume,
        issue: entry.number,
        page: entry.pages,
        DOI: entry.doi,
        URL: entry.url,
        abstract: entry.abstract,
        keyword: entry.keywords,
    };

    // Add additional fields from the fields record
    if (entry.fields.publisher) {
        csl.publisher = entry.fields.publisher;
    }
    if (entry.fields.address) {
        csl['publisher-place'] = entry.fields.address;
    }
    if (entry.fields.edition) {
        csl.edition = entry.fields.edition;
    }
    if (entry.fields.editor) {
        csl.editor = parseAuthors(entry.fields.editor);
    }
    if (entry.fields.isbn) {
        csl.ISBN = entry.fields.isbn;
    }
    if (entry.fields.issn) {
        csl.ISSN = entry.fields.issn;
    }

    // Remove undefined values
    for (const key of Object.keys(csl)) {
        if (csl[key] === undefined) {
            delete csl[key];
        }
    }

    return csl;
}

/**
 * Available built-in CSL styles
 */
export type CSLStyleName =
    | 'apa'
    | 'vancouver'
    | 'harvard1'
    | 'chicago'
    | 'mla'
    | 'ieee'
    | 'nature'
    | 'science'
    | 'cell';

/**
 * Citation processor configuration
 */
export interface CitationProcessorConfig {
    /** CSL style name or custom CSL XML */
    style?: CSLStyleName | string;
    /** Language locale (default: en-US) */
    locale?: string;
    /** Whether to generate hyperlinks for DOIs/URLs */
    hyperlinks?: boolean;
}

/**
 * Formatted citation result
 */
export interface FormattedCitation {
    /** The formatted inline citation text */
    html: string;
    /** Plain text version */
    text: string;
    /** The citation keys used */
    keys: string[];
}

/**
 * Citation processor for formatting citations and bibliographies
 */
export class CitationProcessor {
    private entries: Map<string, CSLEntry> = new Map();
    private cite: typeof Cite | null = null;
    private style: string;
    private locale: string;
    private citedKeys: Set<string> = new Set();
    private citationOrder: string[] = [];

    constructor(config: CitationProcessorConfig = {}) {
        this.style = config.style || 'apa';
        this.locale = config.locale || 'en-US';
    }

    /**
     * Load bibliography entries
     */
    loadEntries(entries: BibEntry[]): void {
        for (const entry of entries) {
            const csl = bibEntryToCSL(entry);
            this.entries.set(entry.key, csl);
        }
    }

    /**
     * Add a single entry
     */
    addEntry(entry: BibEntry): void {
        const csl = bibEntryToCSL(entry);
        this.entries.set(entry.key, csl);
    }

    /**
     * Get entry by key
     */
    getEntry(key: string): CSLEntry | undefined {
        return this.entries.get(key);
    }

    /**
     * Check if a key exists
     */
    hasEntry(key: string): boolean {
        return this.entries.has(key);
    }

    /**
     * Format a parsed citation for inline display
     */
    formatCitation(citation: ParsedCitation): FormattedCitation {
        const keys = citation.references.map(r => r.key);
        const style = getNormalizedStyle(citation);

        // Track cited keys for bibliography
        for (const key of keys) {
            if (!this.citedKeys.has(key)) {
                this.citedKeys.add(key);
                this.citationOrder.push(key);
            }
        }

        // Get CSL entries for these keys
        const cslEntries = keys
            .map(key => this.entries.get(key))
            .filter((e): e is CSLEntry => e !== undefined);

        if (cslEntries.length === 0) {
            // No entries found - return placeholder
            const keyList = keys.join(', ');
            return {
                html: `<span class="citation-missing">[${keyList}]</span>`,
                text: `[${keyList}]`,
                keys,
            };
        }

        try {
            const cite = new Cite(cslEntries);

            // Format based on style
            let html: string;
            let text: string;

            if (style === 'textual') {
                // Author (Year) format
                html = this.formatTextualCitation(cslEntries, citation);
                text = this.stripHtml(html);
            } else if (style === 'author') {
                // Author only
                html = this.formatAuthorOnly(cslEntries);
                text = this.stripHtml(html);
            } else if (style === 'year') {
                // Year only
                html = this.formatYearOnly(cslEntries);
                text = this.stripHtml(html);
            } else {
                // Parenthetical (default)
                html = cite.format('citation', {
                    format: 'html',
                    template: this.style,
                    lang: this.locale,
                });
                text = cite.format('citation', {
                    format: 'text',
                    template: this.style,
                    lang: this.locale,
                });
            }

            // Add pre/post notes
            html = this.addNotes(html, citation);
            text = this.addNotesText(text, citation);

            return { html, text, keys };
        } catch (error) {
            // Fallback on error
            const keyList = keys.join(', ');
            return {
                html: `<span class="citation">(${keyList})</span>`,
                text: `(${keyList})`,
                keys,
            };
        }
    }

    /**
     * Format a simple citation by keys
     */
    formatCitationByKeys(
        keys: string[],
        style: 'textual' | 'parenthetical' | 'author' | 'year' = 'parenthetical'
    ): FormattedCitation {
        // Track cited keys
        for (const key of keys) {
            if (!this.citedKeys.has(key)) {
                this.citedKeys.add(key);
                this.citationOrder.push(key);
            }
        }

        const cslEntries = keys
            .map(key => this.entries.get(key))
            .filter((e): e is CSLEntry => e !== undefined);

        if (cslEntries.length === 0) {
            const keyList = keys.join(', ');
            return {
                html: `<span class="citation-missing">[${keyList}]</span>`,
                text: `[${keyList}]`,
                keys,
            };
        }

        try {
            const cite = new Cite(cslEntries);

            let html: string;
            let text: string;

            if (style === 'textual') {
                html = this.formatTextualCitation(cslEntries, null);
                text = this.stripHtml(html);
            } else if (style === 'author') {
                html = this.formatAuthorOnly(cslEntries);
                text = this.stripHtml(html);
            } else if (style === 'year') {
                html = this.formatYearOnly(cslEntries);
                text = this.stripHtml(html);
            } else {
                html = cite.format('citation', {
                    format: 'html',
                    template: this.style,
                    lang: this.locale,
                });
                text = cite.format('citation', {
                    format: 'text',
                    template: this.style,
                    lang: this.locale,
                });
            }

            return { html, text, keys };
        } catch {
            const keyList = keys.join(', ');
            return {
                html: `<span class="citation">(${keyList})</span>`,
                text: `(${keyList})`,
                keys,
            };
        }
    }

    /**
     * Generate bibliography HTML for all cited entries
     * Each entry gets an anchor id="ref-{key}" for linking from citations
     * @param backLinks Optional map of citation key -> array of citation IDs for back-linking
     */
    generateBibliography(backLinks?: Map<string, string[]>): string {
        if (this.citedKeys.size === 0) {
            return '';
        }

        const cslEntries = this.citationOrder
            .map(key => this.entries.get(key))
            .filter((e): e is CSLEntry => e !== undefined);

        if (cslEntries.length === 0) {
            return '';
        }

        // Helper to generate back-link HTML for a key
        const generateBackLinks = (key: string): string => {
            if (!backLinks || !backLinks.has(key)) {
                return '';
            }
            const citeIds = backLinks.get(key)!;
            const links = citeIds.map((id, idx) =>
                `<a href="#${id}" class="citation-backlink" title="Jump to citation">${idx + 1}</a>`
            );
            return ` <span class="citation-backlinks">[${links.join(', ')}]</span>`;
        };

        try {
            const cite = new Cite(cslEntries);
            let html = cite.format('bibliography', {
                format: 'html',
                template: this.style,
                lang: this.locale,
            });

            // Add anchor IDs and back-links to each csl-entry
            // citation-js may output either:
            //   <div class="csl-entry">...</div>
            //   <div data-csl-entry-id="key" class="csl-entry">...</div>
            // We need to add id="ref-{key}" and back-links to each one
            let entryIndex = 0;
            html = html.replace(/<div(?:\s+data-csl-entry-id="([^"]*)")?\s+class="csl-entry">([^]*?)<\/div>/g, (match, dataId, content) => {
                const key = dataId || cslEntries[entryIndex]?.id || `entry-${entryIndex}`;
                entryIndex++;
                const backLinkHtml = generateBackLinks(key);
                return `<div class="csl-entry" id="ref-${key}">${content}${backLinkHtml}</div>`;
            });

            return `<section class="bibliography">\n<h2>References</h2>\n${html}\n</section>`;
        } catch {
            // Fallback: simple list
            let html = '<section class="bibliography">\n<h2>References</h2>\n<ul>\n';
            for (const entry of cslEntries) {
                const authors = this.formatAuthorList(entry);
                const year = this.getYear(entry);
                const title = entry.title || 'Untitled';
                const backLinkHtml = generateBackLinks(entry.id);
                html += `<li id="ref-${entry.id}">${authors} (${year}). ${title}.${backLinkHtml}</li>\n`;
            }
            html += '</ul>\n</section>';
            return html;
        }
    }

    /**
     * Get the set of cited keys
     */
    getCitedKeys(): Set<string> {
        return new Set(this.citedKeys);
    }

    /**
     * Reset citation tracking (for new document)
     */
    reset(): void {
        this.citedKeys.clear();
        this.citationOrder = [];
    }

    /**
     * Set the citation style
     */
    setStyle(style: CSLStyleName | string): void {
        this.style = style;
    }

    // Private helper methods

    private formatTextualCitation(entries: CSLEntry[], citation: ParsedCitation | null): string {
        const parts: string[] = [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const authors = this.formatAuthorList(entry);
            const year = this.getYear(entry);

            let part = `${authors} (${year})`;

            // Add individual suffix if available
            if (citation?.references[i]?.suffix) {
                part = `${authors} (${year}, ${citation.references[i].suffix})`;
            }

            parts.push(part);
        }

        return `<span class="citation textual">${parts.join('; ')}</span>`;
    }

    private formatAuthorOnly(entries: CSLEntry[]): string {
        const authors = entries.map(e => this.formatAuthorList(e)).join('; ');
        return `<span class="citation author-only">${authors}</span>`;
    }

    private formatYearOnly(entries: CSLEntry[]): string {
        const years = entries.map(e => this.getYear(e)).join('; ');
        return `<span class="citation year-only">${years}</span>`;
    }

    private formatAuthorList(entry: CSLEntry): string {
        if (!entry.author || entry.author.length === 0) {
            return 'Unknown';
        }

        const authors = entry.author;
        if (authors.length === 1) {
            return getDisplayLastName(authors[0] as CSLAuthor);
        } else if (authors.length === 2) {
            const a1 = getDisplayLastName(authors[0] as CSLAuthor);
            const a2 = getDisplayLastName(authors[1] as CSLAuthor);
            return `${a1} & ${a2}`;
        } else {
            return `${getDisplayLastName(authors[0] as CSLAuthor)} et al.`;
        }
    }

    private getYear(entry: CSLEntry): string {
        if (entry.issued?.['date-parts']?.[0]?.[0]) {
            return String(entry.issued['date-parts'][0][0]);
        }
        if (entry.issued?.literal) {
            return entry.issued.literal;
        }
        return 'n.d.';
    }

    private addNotes(html: string, citation: ParsedCitation): string {
        let result = html;

        // Add common prefix
        if (citation.commonPrefix) {
            result = `${citation.commonPrefix} ${result}`;
        }

        // Add common suffix
        if (citation.commonSuffix) {
            result = `${result}, ${citation.commonSuffix}`;
        }

        return result;
    }

    private addNotesText(text: string, citation: ParsedCitation): string {
        let result = text;

        if (citation.commonPrefix) {
            result = `${citation.commonPrefix} ${result}`;
        }

        if (citation.commonSuffix) {
            result = `${result}, ${citation.commonSuffix}`;
        }

        return result;
    }

    private stripHtml(html: string): string {
        return html.replace(/<[^>]*>/g, '');
    }
}

/**
 * Create a citation processor with entries loaded
 */
export function createCitationProcessor(
    entries: BibEntry[],
    config?: CitationProcessorConfig
): CitationProcessor {
    const processor = new CitationProcessor(config);
    processor.loadEntries(entries);
    return processor;
}
