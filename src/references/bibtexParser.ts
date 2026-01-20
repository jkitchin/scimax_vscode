/**
 * BibTeX parser for parsing .bib bibliography files
 * Extracts entries with all fields for citation management
 */

import {
    parseAuthors,
    getDisplayLastName,
    getFirstAuthorKeyName,
    formatAuthorListDisplay,
} from './authorUtils';

export interface BibEntry {
    key: string;
    type: string;  // article, book, inproceedings, etc.
    fields: Record<string, string>;
    raw: string;
    // Common convenience fields
    author?: string;
    title?: string;
    year?: string;
    journal?: string;
    booktitle?: string;
    volume?: string;
    number?: string;
    pages?: string;
    doi?: string;
    url?: string;
    abstract?: string;
    keywords?: string;
}

export interface ParseResult {
    entries: BibEntry[];
    errors: { line: number; message: string }[];
}

/**
 * Parse a BibTeX file content into structured entries
 */
export function parseBibTeX(content: string): ParseResult {
    const entries: BibEntry[] = [];
    const errors: { line: number; message: string }[] = [];

    // Remove comments (lines starting with %)
    const lines = content.split('\n');
    const cleanedLines: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('%')) {
            cleanedLines.push(line);
        }
    }
    const cleanedContent = cleanedLines.join('\n');

    // Match entries: @type{key, ... }
    const entryRegex = /@(\w+)\s*\{\s*([^,\s]+)\s*,([^@]*?)(?=\n\s*@|\n*$)/gs;
    let match;

    while ((match = entryRegex.exec(cleanedContent)) !== null) {
        try {
            const type = match[1].toLowerCase();
            const key = match[2].trim();
            const fieldsStr = match[3];
            const raw = match[0];

            // Skip @string, @preamble, @comment
            if (['string', 'preamble', 'comment'].includes(type)) {
                continue;
            }

            const fields = parseFields(fieldsStr);

            const entry: BibEntry = {
                key,
                type,
                fields,
                raw,
                // Extract common fields for convenience
                author: fields.author,
                title: fields.title,
                year: fields.year,
                journal: fields.journal,
                booktitle: fields.booktitle,
                volume: fields.volume,
                number: fields.number,
                pages: fields.pages,
                doi: fields.doi,
                url: fields.url,
                abstract: fields.abstract,
                keywords: fields.keywords
            };

            entries.push(entry);
        } catch (e) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            errors.push({
                line: lineNumber,
                message: `Failed to parse entry: ${e}`
            });
        }
    }

    return { entries, errors };
}

/**
 * Parse field definitions from a BibTeX entry body
 */
function parseFields(fieldsStr: string): Record<string, string> {
    const fields: Record<string, string> = {};

    // Find field assignments: fieldname = value
    // We need to handle arbitrary brace nesting, so we use a state machine approach
    const fieldStartRegex = /(\w+)\s*=\s*/g;
    let match;

    while ((match = fieldStartRegex.exec(fieldsStr)) !== null) {
        const fieldName = match[1].toLowerCase();
        const valueStart = match.index + match[0].length;

        // Parse the value starting from valueStart
        const value = extractFieldValue(fieldsStr, valueStart);
        if (value !== null) {
            const cleanValue = cleanBibValue(value);
            fields[fieldName] = cleanValue;
        }
    }

    return fields;
}

/**
 * Extract a field value handling arbitrary brace nesting
 */
function extractFieldValue(str: string, start: number): string | null {
    if (start >= str.length) return null;

    const firstChar = str[start];

    // Braced value: {content with {nested} braces}
    if (firstChar === '{') {
        let depth = 1;
        let i = start + 1;
        while (i < str.length && depth > 0) {
            if (str[i] === '{') depth++;
            else if (str[i] === '}') depth--;
            i++;
        }
        if (depth === 0) {
            return str.slice(start + 1, i - 1);
        }
        return null;
    }

    // Quoted value: "content"
    if (firstChar === '"') {
        let i = start + 1;
        while (i < str.length && str[i] !== '"') {
            if (str[i] === '\\' && i + 1 < str.length) i++; // skip escaped chars
            i++;
        }
        if (i < str.length) {
            return str.slice(start + 1, i);
        }
        return null;
    }

    // Numeric or bare value (until comma, newline, or closing brace)
    const endMatch = str.slice(start).match(/^([^,}\n]+)/);
    if (endMatch) {
        return endMatch[1].trim();
    }

    return null;
}

/**
 * Clean a BibTeX field value
 */
function cleanBibValue(value: string): string {
    return value
        // Remove extra whitespace
        .replace(/\s+/g, ' ')
        // Remove LaTeX commands for common characters
        .replace(/\\&/g, '&')
        .replace(/\\_/g, '_')
        .replace(/\\%/g, '%')
        .replace(/\\\$/g, '$')
        .replace(/\\#/g, '#')
        // Remove accent commands (simplified)
        .replace(/\{?\\[`'^"~=.uvHtcdb]\{?(\w)\}?\}?/g, '$1')
        // Remove remaining braces (but keep content)
        .replace(/\{([^{}]*)\}/g, '$1')
        .trim();
}

/**
 * Format author names for display
 * Input: "Last, First and Another, Name and Third, Person"
 * Output: "Last, Another, Third" or "Last et al."
 *
 * Now uses citation-js for proper BibTeX name parsing with support for:
 * - Particles (von, van der, de la, etc.)
 * - Suffixes (Jr., III, etc.)
 * - Corporate/institutional authors ({NASA}, {National Academy of Sciences})
 */
export function formatAuthors(author: string | undefined, maxAuthors: number = 3): string {
    if (!author) return 'Unknown';

    const parsedAuthors = parseAuthors(author);
    return formatAuthorListDisplay(parsedAuthors, maxAuthors);
}

/**
 * Format a citation for display
 */
export function formatCitation(entry: BibEntry, style: 'full' | 'short' | 'inline' = 'short'): string {
    const author = formatAuthors(entry.author);
    const year = entry.year || 'n.d.';
    const title = entry.title || 'Untitled';

    switch (style) {
        case 'full':
            let full = `${author} (${year}). ${title}.`;
            if (entry.journal) {
                full += ` ${entry.journal}`;
                if (entry.volume) {
                    full += `, ${entry.volume}`;
                    if (entry.number) {
                        full += `(${entry.number})`;
                    }
                }
                if (entry.pages) {
                    full += `, ${entry.pages}`;
                }
                full += '.';
            } else if (entry.booktitle) {
                full += ` In ${entry.booktitle}.`;
            }
            if (entry.doi) {
                full += ` https://doi.org/${entry.doi}`;
            }
            return full;

        case 'short':
            return `${author} (${year}). ${title}`;

        case 'inline':
            return `${author} (${year})`;

        default:
            return `${author} (${year})`;
    }
}

/**
 * Format citation for insertion based on style
 */
export function formatCitationLink(
    key: string,
    style: 'cite' | 'citet' | 'citep' | 'citeauthor' | 'citeyear',
    format: 'org' | 'markdown' | 'latex',
    prenote?: string,
    postnote?: string
): string {
    if (format === 'org') {
        // Use org-ref v3 syntax: style:&key (with & prefix and ; separator)
        if (prenote && postnote) {
            // With notes: style:prenote;&key postnote
            return `${style}:${prenote};&${key} ${postnote}`;
        } else if (prenote) {
            return `${style}:${prenote};&${key}`;
        } else if (postnote) {
            return `${style}:&${key} ${postnote}`;
        }
        return `${style}:&${key}`;
    } else if (format === 'latex') {
        // LaTeX style: \cite{key}, \citet{key}, \citep{key}, etc.
        // Map styles to LaTeX commands
        const latexCmd = style === 'cite' ? 'cite' : style;
        if (prenote && postnote) {
            return `\\${latexCmd}[${prenote}][${postnote}]{${key}}`;
        } else if (postnote) {
            return `\\${latexCmd}[${postnote}]{${key}}`;
        } else if (prenote) {
            return `\\${latexCmd}[${prenote}][]{${key}}`;
        }
        return `\\${latexCmd}{${key}}`;
    } else {
        // Markdown/Pandoc style
        let citation = `@${key}`;
        if (postnote) {
            citation = `@${key}, ${postnote}`;
        }
        if (prenote) {
            citation = `${prenote} ${citation}`;
        }
        return `[${citation}]`;
    }
}

/**
 * Generate a BibTeX key from entry metadata
 *
 * Now uses citation-js for proper BibTeX name parsing with support for:
 * - Particles (von, van der, de la, etc.)
 * - Suffixes (Jr., III, etc.)
 * - Corporate/institutional authors ({NASA}, {National Academy of Sciences})
 */
export function generateKey(author: string, year: string, title: string): string {
    // Get first author's last name using citation-js parsing
    const lastName = getFirstAuthorKeyName(author);

    // Get first significant word from title
    const titleWords = title.toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !['the', 'and', 'for', 'with', 'from'].includes(w));

    const titleWord = titleWords[0] || 'untitled';

    return `${lastName}${year}${titleWord}`;
}

/**
 * Convert BibEntry to BibTeX string
 */
export function entryToBibTeX(entry: BibEntry): string {
    let result = `@${entry.type}{${entry.key},\n`;

    for (const [field, value] of Object.entries(entry.fields)) {
        if (value) {
            result += `  ${field} = {${value}},\n`;
        }
    }

    result += '}\n';
    return result;
}

/**
 * Search entries by query (matches key, author, title, year)
 */
export function searchEntries(entries: BibEntry[], query: string): BibEntry[] {
    const queryLower = query.toLowerCase();

    return entries.filter(entry => {
        const searchable = [
            entry.key,
            entry.author,
            entry.title,
            entry.year,
            entry.journal,
            entry.booktitle,
            entry.keywords
        ].filter(Boolean).join(' ').toLowerCase();

        return searchable.includes(queryLower);
    }).sort((a, b) => {
        // Prioritize key matches, then author, then title
        const aKeyMatch = a.key.toLowerCase().includes(queryLower);
        const bKeyMatch = b.key.toLowerCase().includes(queryLower);
        if (aKeyMatch && !bKeyMatch) return -1;
        if (!aKeyMatch && bKeyMatch) return 1;

        const aAuthorMatch = a.author?.toLowerCase().includes(queryLower);
        const bAuthorMatch = b.author?.toLowerCase().includes(queryLower);
        if (aAuthorMatch && !bAuthorMatch) return -1;
        if (!aAuthorMatch && bAuthorMatch) return 1;

        return 0;
    });
}
