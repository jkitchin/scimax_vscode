/**
 * Author name parsing utilities using citation-js
 *
 * Provides proper BibTeX author name parsing with support for:
 * - Particles (von, van der, de la, etc.)
 * - Suffixes (Jr., III, etc.)
 * - Corporate/institutional authors ({NASA}, {National Academy of Sciences})
 * - Multiple author formats ("Last, First", "First Last")
 */

import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';

/**
 * CSL author type (matches citation-js output)
 * See: https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html#name-fields
 */
export interface CSLAuthor {
    /** Family name (last name) */
    family?: string;
    /** Given name(s) (first name, middle names) */
    given?: string;
    /** Particle that may be dropped (e.g., "von" in some contexts) */
    'dropping-particle'?: string;
    /** Particle that stays with the name (e.g., "van" in Dutch names) */
    'non-dropping-particle'?: string;
    /** Name suffix (Jr., III, etc.) */
    suffix?: string;
    /** Literal name for corporate/institutional authors */
    literal?: string;
}

/**
 * Parse author string using citation-js
 *
 * This creates a minimal BibTeX entry to leverage citation-js's proper
 * BibTeX name parsing, which handles:
 * - "Last, First" format
 * - "First Last" format with proper particle detection
 * - Suffixes: "Smith, Jr., John" or "John Smith Jr."
 * - Corporate authors in braces: "{NASA}"
 *
 * @param authorStr - BibTeX author string (may contain multiple authors separated by " and ")
 * @returns Array of parsed CSL author objects
 */
export function parseAuthors(authorStr: string): CSLAuthor[] {
    if (!authorStr || !authorStr.trim()) {
        return [];
    }

    try {
        // Create minimal BibTeX for citation-js to parse
        // Use a temporary key and escape braces in the author string
        const bibtex = `@misc{temp, author = {${authorStr}}}`;
        const cite = new Cite(bibtex);

        // Get the parsed data in CSL-JSON format
        const csl = cite.get({ format: 'real', type: 'json' }) as Array<{ author?: CSLAuthor[] }>;

        return csl[0]?.author || [];
    } catch {
        // Fallback: simple parsing if citation-js fails
        return parseAuthorsFallback(authorStr);
    }
}

/**
 * Fallback author parser when citation-js fails
 * Uses simple heuristics for basic name formats
 */
function parseAuthorsFallback(authorStr: string): CSLAuthor[] {
    const authors: CSLAuthor[] = [];
    const authorParts = authorStr.split(/\s+and\s+/i);

    for (const part of authorParts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        // Check for literal/corporate author (in braces)
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            authors.push({ literal: trimmed.slice(1, -1) });
            continue;
        }

        // Handle "Last, First" format
        if (trimmed.includes(',')) {
            const [family, given] = trimmed.split(',').map(s => s.trim());
            authors.push({ family, given });
        } else {
            // "First Last" format - last word is family name
            const words = trimmed.split(/\s+/);
            if (words.length === 1) {
                authors.push({ literal: words[0] });
            } else {
                const family = words.pop();
                const given = words.join(' ');
                authors.push({ family, given });
            }
        }
    }

    return authors;
}

/**
 * Get display last name for an author (includes particles)
 *
 * For display purposes, particles should be included with the family name:
 * - "van der Berg" not "Berg"
 * - "de la Cruz" not "Cruz"
 *
 * @param author - CSL author object
 * @returns Display-ready last name
 */
export function getDisplayLastName(author: CSLAuthor): string {
    // Corporate/literal authors
    if (author.literal) {
        return author.literal;
    }

    // Build name with particles
    const parts: string[] = [];

    // Non-dropping particle comes first (e.g., "van" in "van Gogh")
    if (author['non-dropping-particle']) {
        parts.push(author['non-dropping-particle']);
    }

    // Dropping particle (e.g., "von" in some German names)
    if (author['dropping-particle']) {
        parts.push(author['dropping-particle']);
    }

    // Family name
    if (author.family) {
        parts.push(author.family);
    }

    return parts.join(' ') || 'Unknown';
}

/**
 * Get key-safe last name for BibTeX key generation
 *
 * For keys, we want:
 * - Lowercase
 * - ASCII only (no accents)
 * - No spaces or special characters
 *
 * @param author - CSL author object
 * @returns Key-safe last name (lowercase, ASCII only)
 */
export function getKeyLastName(author: CSLAuthor): string {
    // Corporate/literal authors - clean up for key use
    if (author.literal) {
        return cleanForKey(author.literal);
    }

    // For key generation, we typically want just the family name
    // (particles are optional/style-dependent)
    const lastName = author.family || '';

    return cleanForKey(lastName);
}

/**
 * Clean a string for use in a BibTeX key
 */
function cleanForKey(str: string): string {
    return str
        .toLowerCase()
        // Normalize unicode (decompose accents)
        .normalize('NFD')
        // Remove accent marks
        .replace(/[\u0300-\u036f]/g, '')
        // Keep only a-z
        .replace(/[^a-z]/g, '');
}

/**
 * Format author list for display
 *
 * @param authors - Array of CSL authors
 * @param maxAuthors - Maximum authors before "et al." (default: 3)
 * @returns Formatted author string
 */
export function formatAuthorListDisplay(authors: CSLAuthor[], maxAuthors: number = 3): string {
    if (!authors || authors.length === 0) {
        return 'Unknown';
    }

    const lastNames = authors.map(a => getDisplayLastName(a));

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
 * Get the first author's key-safe last name from an author string
 * Convenience function for key generation
 *
 * @param authorStr - BibTeX author string
 * @returns Key-safe last name of first author
 */
export function getFirstAuthorKeyName(authorStr: string): string {
    const authors = parseAuthors(authorStr);

    if (authors.length === 0) {
        return 'unknown';
    }

    const keyName = getKeyLastName(authors[0]);
    return keyName || 'unknown';
}

/**
 * Get the first author's display last name from an author string
 * Convenience function for display
 *
 * @param authorStr - BibTeX author string
 * @returns Display last name of first author
 */
export function getFirstAuthorDisplayName(authorStr: string): string {
    const authors = parseAuthors(authorStr);

    if (authors.length === 0) {
        return 'Unknown';
    }

    return getDisplayLastName(authors[0]);
}
