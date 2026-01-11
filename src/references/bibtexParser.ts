/**
 * BibTeX parser for parsing .bib bibliography files
 * Extracts entries with all fields for citation management
 */

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

    // Match field = value patterns
    // Value can be: {braced}, "quoted", or number
    const fieldRegex = /(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|(\d+))/g;
    let match;

    while ((match = fieldRegex.exec(fieldsStr)) !== null) {
        const fieldName = match[1].toLowerCase();
        const value = match[2] ?? match[3] ?? match[4] ?? '';

        // Clean up the value
        const cleanValue = cleanBibValue(value);
        fields[fieldName] = cleanValue;
    }

    return fields;
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
 */
export function formatAuthors(author: string | undefined, maxAuthors: number = 3): string {
    if (!author) return 'Unknown';

    const authors = author.split(/\s+and\s+/i);
    const lastNames = authors.map(a => {
        // Handle "Last, First" format
        if (a.includes(',')) {
            return a.split(',')[0].trim();
        }
        // Handle "First Last" format
        const parts = a.trim().split(/\s+/);
        return parts[parts.length - 1];
    });

    if (lastNames.length <= maxAuthors) {
        if (lastNames.length === 1) {
            return lastNames[0];
        } else if (lastNames.length === 2) {
            return `${lastNames[0]} and ${lastNames[1]}`;
        } else {
            return lastNames.slice(0, -1).join(', ') + ', and ' + lastNames[lastNames.length - 1];
        }
    } else {
        return `${lastNames[0]} et al.`;
    }
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
        let link = `${style}:${key}`;
        if (prenote || postnote) {
            link = `[[${style}:${key}][${prenote || ''}::${postnote || ''}]]`;
        }
        return link;
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
 */
export function generateKey(author: string, year: string, title: string): string {
    // Get first author's last name
    const firstAuthor = author.split(/\s+and\s+/i)[0];
    let lastName = firstAuthor;
    if (firstAuthor.includes(',')) {
        lastName = firstAuthor.split(',')[0].trim();
    } else {
        const parts = firstAuthor.trim().split(/\s+/);
        lastName = parts[parts.length - 1];
    }

    // Clean and lowercase
    lastName = lastName.toLowerCase()
        .replace(/[^a-z]/g, '');

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
