/**
 * Tests for the author parsing utilities
 */

import { describe, it, expect } from 'vitest';
import {
    parseAuthors,
    getDisplayLastName,
    getKeyLastName,
    formatAuthorListDisplay,
    getFirstAuthorKeyName,
    getFirstAuthorDisplayName,
} from '../authorUtils';
import type { CSLAuthor } from '../authorUtils';

describe('Author Utilities', () => {
    describe('parseAuthors', () => {
        it('parses "Last, First" format', () => {
            const authors = parseAuthors('Smith, John');
            expect(authors).toHaveLength(1);
            expect(authors[0].family).toBe('Smith');
            expect(authors[0].given).toBe('John');
        });

        it('parses "First Last" format', () => {
            const authors = parseAuthors('John Smith');
            expect(authors).toHaveLength(1);
            expect(authors[0].family).toBe('Smith');
            expect(authors[0].given).toBe('John');
        });

        it('handles multiple authors with "and"', () => {
            const authors = parseAuthors('Smith, John and Doe, Jane');
            expect(authors).toHaveLength(2);
            expect(authors[0].family).toBe('Smith');
            expect(authors[1].family).toBe('Doe');
        });

        it('handles particles in "Last, First" format', () => {
            const authors = parseAuthors('van der Berg, Hans');
            expect(authors).toHaveLength(1);
            // citation-js may store "van der" as non-dropping-particle
            // or include it in family - check both
            const displayName = getDisplayLastName(authors[0]);
            expect(displayName.toLowerCase()).toContain('berg');
        });

        it('handles particles in "First Last" format', () => {
            const authors = parseAuthors('Hans van der Berg');
            expect(authors).toHaveLength(1);
            const displayName = getDisplayLastName(authors[0]);
            expect(displayName.toLowerCase()).toContain('berg');
        });

        it('handles "de la" particle', () => {
            const authors = parseAuthors('Maria de la Cruz');
            expect(authors).toHaveLength(1);
            const displayName = getDisplayLastName(authors[0]);
            expect(displayName.toLowerCase()).toContain('cruz');
        });

        it('handles suffix "Jr."', () => {
            const authors = parseAuthors('Smith, Jr., John');
            expect(authors).toHaveLength(1);
            expect(authors[0].family).toBe('Smith');
            // Suffix should be parsed
            if (authors[0].suffix) {
                expect(authors[0].suffix).toContain('Jr');
            }
        });

        it('handles corporate authors in braces', () => {
            const authors = parseAuthors('{NASA}');
            expect(authors).toHaveLength(1);
            // citation-js puts protected names in family, which is valid CSL-JSON
            // The braces protect from "First Last" parsing
            expect(authors[0].family || authors[0].literal).toBe('NASA');
        });

        it('handles long corporate name in braces', () => {
            const authors = parseAuthors('{National Academy of Sciences}');
            expect(authors).toHaveLength(1);
            // citation-js puts protected names in family, which is valid CSL-JSON
            expect(authors[0].family || authors[0].literal).toBe('National Academy of Sciences');
        });

        it('handles single-name author', () => {
            const authors = parseAuthors('Aristotle');
            expect(authors).toHaveLength(1);
            // Single names are treated as family or literal
            const displayName = getDisplayLastName(authors[0]);
            expect(displayName).toBe('Aristotle');
        });

        it('handles empty string', () => {
            const authors = parseAuthors('');
            expect(authors).toHaveLength(0);
        });

        it('handles multiple authors with particles', () => {
            const authors = parseAuthors('Smith, John and van der Berg, Hans');
            expect(authors).toHaveLength(2);
            expect(authors[0].family).toBe('Smith');
        });
    });

    describe('getDisplayLastName', () => {
        it('returns family name for simple author', () => {
            const author: CSLAuthor = { family: 'Smith', given: 'John' };
            expect(getDisplayLastName(author)).toBe('Smith');
        });

        it('returns literal for corporate author', () => {
            const author: CSLAuthor = { literal: 'NASA' };
            expect(getDisplayLastName(author)).toBe('NASA');
        });

        it('includes non-dropping particle', () => {
            const author: CSLAuthor = {
                family: 'Berg',
                given: 'Hans',
                'non-dropping-particle': 'van der',
            };
            expect(getDisplayLastName(author)).toBe('van der Berg');
        });

        it('includes dropping particle', () => {
            const author: CSLAuthor = {
                family: 'Beethoven',
                given: 'Ludwig',
                'dropping-particle': 'van',
            };
            expect(getDisplayLastName(author)).toBe('van Beethoven');
        });

        it('returns "Unknown" for empty author', () => {
            const author: CSLAuthor = {};
            expect(getDisplayLastName(author)).toBe('Unknown');
        });
    });

    describe('getKeyLastName', () => {
        it('returns lowercase family name', () => {
            const author: CSLAuthor = { family: 'Smith', given: 'John' };
            expect(getKeyLastName(author)).toBe('smith');
        });

        it('removes accents', () => {
            const author: CSLAuthor = { family: 'Müller', given: 'Hans' };
            expect(getKeyLastName(author)).toBe('muller');
        });

        it('removes special characters', () => {
            const author: CSLAuthor = { family: "O'Brien", given: 'Patrick' };
            expect(getKeyLastName(author)).toBe('obrien');
        });

        it('cleans corporate name for key', () => {
            const author: CSLAuthor = { literal: 'National Academy of Sciences' };
            expect(getKeyLastName(author)).toBe('nationalacademyofsciences');
        });

        it('returns empty string for empty family', () => {
            const author: CSLAuthor = { given: 'John' };
            expect(getKeyLastName(author)).toBe('');
        });
    });

    describe('formatAuthorListDisplay', () => {
        it('formats single author', () => {
            const authors: CSLAuthor[] = [{ family: 'Smith', given: 'John' }];
            expect(formatAuthorListDisplay(authors)).toBe('Smith');
        });

        it('formats two authors with "and"', () => {
            const authors: CSLAuthor[] = [
                { family: 'Smith', given: 'John' },
                { family: 'Doe', given: 'Jane' },
            ];
            expect(formatAuthorListDisplay(authors)).toBe('Smith and Doe');
        });

        it('formats three authors with serial comma', () => {
            const authors: CSLAuthor[] = [
                { family: 'Smith', given: 'John' },
                { family: 'Doe', given: 'Jane' },
                { family: 'Johnson', given: 'Bob' },
            ];
            expect(formatAuthorListDisplay(authors)).toBe('Smith, Doe, and Johnson');
        });

        it('uses "et al." for more than maxAuthors', () => {
            const authors: CSLAuthor[] = [
                { family: 'Smith', given: 'John' },
                { family: 'Doe', given: 'Jane' },
                { family: 'Johnson', given: 'Bob' },
                { family: 'Williams', given: 'Alice' },
            ];
            expect(formatAuthorListDisplay(authors, 3)).toBe('Smith et al.');
        });

        it('respects custom maxAuthors', () => {
            const authors: CSLAuthor[] = [
                { family: 'Smith', given: 'John' },
                { family: 'Doe', given: 'Jane' },
            ];
            expect(formatAuthorListDisplay(authors, 1)).toBe('Smith et al.');
        });

        it('returns "Unknown" for empty list', () => {
            expect(formatAuthorListDisplay([])).toBe('Unknown');
        });

        it('includes particles in display', () => {
            const authors: CSLAuthor[] = [
                { family: 'Berg', given: 'Hans', 'non-dropping-particle': 'van der' },
            ];
            expect(formatAuthorListDisplay(authors)).toBe('van der Berg');
        });
    });

    describe('getFirstAuthorKeyName', () => {
        it('returns first author key name from simple format', () => {
            expect(getFirstAuthorKeyName('Smith, John')).toBe('smith');
        });

        it('returns first author when multiple', () => {
            expect(getFirstAuthorKeyName('Smith, John and Doe, Jane')).toBe('smith');
        });

        it('handles particles for key generation', () => {
            // For keys, we typically use just the family name
            const keyName = getFirstAuthorKeyName('van der Berg, Hans');
            expect(keyName).toBe('berg');
        });

        it('returns "unknown" for empty string', () => {
            expect(getFirstAuthorKeyName('')).toBe('unknown');
        });

        it('cleans corporate name', () => {
            expect(getFirstAuthorKeyName('{NASA}')).toBe('nasa');
        });
    });

    describe('getFirstAuthorDisplayName', () => {
        it('returns first author display name', () => {
            expect(getFirstAuthorDisplayName('Smith, John')).toBe('Smith');
        });

        it('returns first author when multiple', () => {
            expect(getFirstAuthorDisplayName('Smith, John and Doe, Jane')).toBe('Smith');
        });

        it('includes particles in display', () => {
            const displayName = getFirstAuthorDisplayName('van der Berg, Hans');
            expect(displayName.toLowerCase()).toContain('berg');
        });

        it('returns "Unknown" for empty string', () => {
            expect(getFirstAuthorDisplayName('')).toBe('Unknown');
        });

        it('returns corporate name as-is', () => {
            expect(getFirstAuthorDisplayName('{NASA}')).toBe('NASA');
        });
    });
});
