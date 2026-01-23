/**
 * Tests for the unified citation parser
 */

import { describe, it, expect } from 'vitest';
import {
    parseCitationsFromLine,
    findCitationAtPosition,
    findReferenceIndexAtPosition,
    rebuildCitation,
    convertCitationSyntax,
    extractCitationKeys,
    containsCitation,
    getNormalizedStyle,
} from '../citationParser';
import type { ParsedCitation } from '../citationTypes';

describe('Citation Parser', () => {
    describe('org-ref v2 syntax', () => {
        it('parses simple cite:key', () => {
            const citations = parseCitationsFromLine('See cite:smith-2020 for details.');
            expect(citations).toHaveLength(1);
            expect(citations[0].syntax).toBe('org-ref-v2');
            expect(citations[0].command).toBe('cite');
            expect(citations[0].references).toHaveLength(1);
            expect(citations[0].references[0].key).toBe('smith-2020');
        });

        it('parses multiple comma-separated keys', () => {
            const citations = parseCitationsFromLine('cite:smith-2020,jones-2021,doe-2022');
            expect(citations).toHaveLength(1);
            expect(citations[0].references).toHaveLength(3);
            expect(citations[0].references[0].key).toBe('smith-2020');
            expect(citations[0].references[1].key).toBe('jones-2021');
            expect(citations[0].references[2].key).toBe('doe-2022');
        });

        it('parses citet, citep, citeauthor, citeyear', () => {
            const line = 'citet:smith-2020 citep:jones-2021 citeauthor:doe-2022 citeyear:foo-2023';
            const citations = parseCitationsFromLine(line);
            expect(citations).toHaveLength(4);
            expect(citations[0].command).toBe('citet');
            expect(citations[1].command).toBe('citep');
            expect(citations[2].command).toBe('citeauthor');
            expect(citations[3].command).toBe('citeyear');
        });

        it('parses capitalized variants', () => {
            const citations = parseCitationsFromLine('Citet:smith-2020 and Citep:jones-2021');
            expect(citations).toHaveLength(2);
            expect(citations[0].command).toBe('Citet');
            expect(citations[1].command).toBe('Citep');
        });

        it('handles keys with colons and underscores', () => {
            const citations = parseCitationsFromLine('cite:smith_jones:2020,doe_2021');
            expect(citations).toHaveLength(1);
            expect(citations[0].references[0].key).toBe('smith_jones:2020');
            expect(citations[0].references[1].key).toBe('doe_2021');
        });
    });

    describe('org-ref v3 syntax', () => {
        it('parses simple cite:&key', () => {
            const citations = parseCitationsFromLine('See cite:&smith-2020 for details.');
            expect(citations).toHaveLength(1);
            expect(citations[0].syntax).toBe('org-ref-v3');
            expect(citations[0].command).toBe('cite');
            expect(citations[0].references).toHaveLength(1);
            expect(citations[0].references[0].key).toBe('smith-2020');
        });

        it('parses multiple semicolon-separated keys', () => {
            const citations = parseCitationsFromLine('cite:&smith-2020;&jones-2021;&doe-2022');
            expect(citations).toHaveLength(1);
            expect(citations[0].references).toHaveLength(3);
            expect(citations[0].references[0].key).toBe('smith-2020');
            expect(citations[0].references[1].key).toBe('jones-2021');
            expect(citations[0].references[2].key).toBe('doe-2022');
        });

        it('parses citation with common prefix', () => {
            const citations = parseCitationsFromLine('citep:See;&smith-2020');
            expect(citations).toHaveLength(1);
            expect(citations[0].commonPrefix).toBe('See');
            expect(citations[0].references[0].key).toBe('smith-2020');
        });

        it('parses citation with common suffix', () => {
            const citations = parseCitationsFromLine('citep:&smith-2020;for example');
            expect(citations).toHaveLength(1);
            expect(citations[0].commonSuffix).toBe('for example');
            expect(citations[0].references[0].key).toBe('smith-2020');
        });

        it('parses citation with individual postnotes', () => {
            const citations = parseCitationsFromLine('citep:&smith-2020 p. 42;&jones-2021 ch. 3');
            expect(citations).toHaveLength(1);
            expect(citations[0].references[0].key).toBe('smith-2020');
            expect(citations[0].references[0].suffix).toBe('p. 42');
            expect(citations[0].references[1].key).toBe('jones-2021');
            expect(citations[0].references[1].suffix).toBe('ch. 3');
        });

        it('parses complex citation with prefix, suffix, and notes', () => {
            const citations = parseCitationsFromLine('citep:See;&smith-2020 p. 5;&jones-2021;for examples');
            expect(citations).toHaveLength(1);
            expect(citations[0].commonPrefix).toBe('See');
            expect(citations[0].commonSuffix).toBe('for examples');
            expect(citations[0].references[0].key).toBe('smith-2020');
            expect(citations[0].references[0].suffix).toBe('p. 5');
            expect(citations[0].references[1].key).toBe('jones-2021');
        });

        it('parses citet, citep variants', () => {
            const line = 'citet:&smith-2020 and citep:&jones-2021';
            const citations = parseCitationsFromLine(line);
            expect(citations).toHaveLength(2);
            expect(citations[0].command).toBe('citet');
            expect(citations[1].command).toBe('citep');
        });
    });

    describe('org-cite syntax', () => {
        it('parses simple [cite:@key]', () => {
            const citations = parseCitationsFromLine('See [cite:@smith-2020] for details.');
            expect(citations).toHaveLength(1);
            expect(citations[0].syntax).toBe('org-cite');
            expect(citations[0].command).toBe('cite');
            expect(citations[0].references).toHaveLength(1);
            expect(citations[0].references[0].key).toBe('smith-2020');
        });

        it('parses multiple semicolon-separated keys', () => {
            const citations = parseCitationsFromLine('[cite:@smith-2020;@jones-2021;@doe-2022]');
            expect(citations).toHaveLength(1);
            expect(citations[0].references).toHaveLength(3);
            expect(citations[0].references[0].key).toBe('smith-2020');
            expect(citations[0].references[1].key).toBe('jones-2021');
            expect(citations[0].references[2].key).toBe('doe-2022');
        });

        it('parses citation with style /t', () => {
            const citations = parseCitationsFromLine('[cite/t:@smith-2020]');
            expect(citations).toHaveLength(1);
            expect(citations[0].style).toBe('t');
            expect(citations[0].command).toBe('citet');
        });

        it('parses citation with style /p', () => {
            const citations = parseCitationsFromLine('[cite/p:@smith-2020]');
            expect(citations).toHaveLength(1);
            expect(citations[0].style).toBe('p');
            expect(citations[0].command).toBe('citep');
        });

        it('parses citation with common prefix', () => {
            const citations = parseCitationsFromLine('[cite:See;@smith-2020]');
            expect(citations).toHaveLength(1);
            expect(citations[0].commonPrefix).toBe('See');
            expect(citations[0].references[0].key).toBe('smith-2020');
        });

        it('parses citation with common suffix', () => {
            const citations = parseCitationsFromLine('[cite:@smith-2020;for example]');
            expect(citations).toHaveLength(1);
            expect(citations[0].commonSuffix).toBe('for example');
        });

        it('parses citation with individual postnotes', () => {
            const citations = parseCitationsFromLine('[cite:@smith-2020 p. 42;@jones-2021 ch. 3]');
            expect(citations).toHaveLength(1);
            expect(citations[0].references[0].suffix).toBe('p. 42');
            expect(citations[0].references[1].suffix).toBe('ch. 3');
        });

        it('parses complex citation with all components', () => {
            const citations = parseCitationsFromLine('[cite/t:See;@smith-2020 p. 5;@jones-2021;for examples]');
            expect(citations).toHaveLength(1);
            expect(citations[0].style).toBe('t');
            expect(citations[0].commonPrefix).toBe('See');
            expect(citations[0].commonSuffix).toBe('for examples');
            expect(citations[0].references[0].key).toBe('smith-2020');
            expect(citations[0].references[0].suffix).toBe('p. 5');
        });
    });

    describe('LaTeX syntax', () => {
        it('parses simple \\cite{key}', () => {
            const citations = parseCitationsFromLine('See \\cite{smith2020} for details.');
            expect(citations).toHaveLength(1);
            expect(citations[0].syntax).toBe('latex');
            expect(citations[0].command).toBe('cite');
            expect(citations[0].references[0].key).toBe('smith2020');
        });

        it('parses multiple comma-separated keys', () => {
            const citations = parseCitationsFromLine('\\cite{smith2020,jones2021,doe2022}');
            expect(citations).toHaveLength(1);
            expect(citations[0].references).toHaveLength(3);
        });

        it('parses \\citep and \\citet', () => {
            const line = '\\citet{smith2020} and \\citep{jones2021}';
            const citations = parseCitationsFromLine(line);
            expect(citations).toHaveLength(2);
            expect(citations[0].command).toBe('citet');
            expect(citations[1].command).toBe('citep');
        });

        it('parses citation with postnote', () => {
            const citations = parseCitationsFromLine('\\citep[p. 42]{smith2020}');
            expect(citations).toHaveLength(1);
            expect(citations[0].commonSuffix).toBe('p. 42');
        });

        it('parses citation with prenote and postnote', () => {
            const citations = parseCitationsFromLine('\\citep[See][p. 42]{smith2020}');
            expect(citations).toHaveLength(1);
            expect(citations[0].commonPrefix).toBe('See');
            expect(citations[0].commonSuffix).toBe('p. 42');
        });
    });

    describe('mixed syntaxes in one line', () => {
        it('parses v2 and v3 in same line', () => {
            const line = 'cite:old-key and cite:&new-key';
            const citations = parseCitationsFromLine(line);
            expect(citations).toHaveLength(2);
            expect(citations[0].syntax).toBe('org-ref-v2');
            expect(citations[1].syntax).toBe('org-ref-v3');
        });

        it('parses org-cite and org-ref in same line', () => {
            const line = '[cite:@smith-2020] and cite:jones-2021';
            const citations = parseCitationsFromLine(line);
            expect(citations).toHaveLength(2);
            expect(citations[0].syntax).toBe('org-cite');
            expect(citations[1].syntax).toBe('org-ref-v2');
        });

        it('parses all syntaxes together', () => {
            const line = 'cite:v2-key [cite:@org-cite-key] cite:&v3-key \\cite{latex-key}';
            const citations = parseCitationsFromLine(line);
            expect(citations).toHaveLength(4);
            const syntaxes = citations.map(c => c.syntax);
            expect(syntaxes).toContain('org-ref-v2');
            expect(syntaxes).toContain('org-ref-v3');
            expect(syntaxes).toContain('org-cite');
            expect(syntaxes).toContain('latex');
        });
    });

    describe('findCitationAtPosition', () => {
        it('finds citation at cursor position', () => {
            const line = 'Some text cite:smith-2020 more text';
            const citation = findCitationAtPosition(line, 15);
            expect(citation).not.toBeNull();
            expect(citation?.references[0].key).toBe('smith-2020');
        });

        it('returns null when not on a citation', () => {
            const line = 'Some text cite:smith-2020 more text';
            const citation = findCitationAtPosition(line, 3);
            expect(citation).toBeNull();
        });
    });

    describe('rebuildCitation', () => {
        it('rebuilds org-ref v2 citation', () => {
            const citation: ParsedCitation = {
                syntax: 'org-ref-v2',
                command: 'cite',
                references: [{ key: 'smith-2020' }, { key: 'jones-2021' }],
                raw: 'cite:smith-2020,jones-2021',
                range: { start: 0, end: 26 },
            };
            expect(rebuildCitation(citation)).toBe('cite:smith-2020,jones-2021');
        });

        it('rebuilds org-ref v3 citation', () => {
            const citation: ParsedCitation = {
                syntax: 'org-ref-v3',
                command: 'citep',
                references: [{ key: 'smith-2020', suffix: 'p. 5' }],
                commonPrefix: 'See',
                raw: 'citep:See;&smith-2020 p. 5',
                range: { start: 0, end: 26 },
            };
            expect(rebuildCitation(citation)).toBe('citep:See;&smith-2020 p. 5');
        });

        it('rebuilds org-cite citation', () => {
            const citation: ParsedCitation = {
                syntax: 'org-cite',
                command: 'citet',
                style: 't',
                references: [{ key: 'smith-2020' }],
                raw: '[cite/t:@smith-2020]',
                range: { start: 0, end: 20 },
            };
            expect(rebuildCitation(citation)).toBe('[cite/t:@smith-2020]');
        });

        it('rebuilds LaTeX citation', () => {
            const citation: ParsedCitation = {
                syntax: 'latex',
                command: 'citep',
                references: [{ key: 'smith2020' }],
                commonPrefix: 'See',
                commonSuffix: 'p. 42',
                raw: '\\citep[See][p. 42]{smith2020}',
                range: { start: 0, end: 29 },
            };
            expect(rebuildCitation(citation)).toBe('\\citep[See][p. 42]{smith2020}');
        });
    });

    describe('convertCitationSyntax', () => {
        it('converts v2 to v3', () => {
            const citation: ParsedCitation = {
                syntax: 'org-ref-v2',
                command: 'cite',
                references: [{ key: 'smith-2020' }],
                raw: 'cite:smith-2020',
                range: { start: 0, end: 15 },
            };
            const converted = convertCitationSyntax(citation, 'org-ref-v3');
            expect(converted).toBe('cite:&smith-2020');
        });

        it('converts v3 to org-cite', () => {
            const citation: ParsedCitation = {
                syntax: 'org-ref-v3',
                command: 'citet',
                references: [{ key: 'smith-2020' }],
                raw: 'citet:&smith-2020',
                range: { start: 0, end: 17 },
            };
            const converted = convertCitationSyntax(citation, 'org-cite');
            expect(converted).toBe('[cite/t:@smith-2020]');
        });
    });

    describe('extractCitationKeys', () => {
        it('extracts all unique keys from line', () => {
            const line = 'cite:smith-2020,jones-2021 and [cite:@smith-2020]';
            const keys = extractCitationKeys(line);
            expect(keys).toHaveLength(2);
            expect(keys).toContain('smith-2020');
            expect(keys).toContain('jones-2021');
        });
    });

    describe('containsCitation', () => {
        it('returns true for lines with citations', () => {
            expect(containsCitation('cite:key')).toBe(true);
            expect(containsCitation('[cite:@key]')).toBe(true);
            expect(containsCitation('\\cite{key}')).toBe(true);
        });

        it('returns false for lines without citations', () => {
            expect(containsCitation('no citations here')).toBe(false);
            expect(containsCitation('citrus fruits')).toBe(false);
        });
    });

    describe('getNormalizedStyle', () => {
        it('identifies textual citations', () => {
            const citation: ParsedCitation = {
                syntax: 'org-ref-v3',
                command: 'citet',
                references: [{ key: 'key' }],
                raw: 'citet:&key',
                range: { start: 0, end: 10 },
            };
            expect(getNormalizedStyle(citation)).toBe('textual');
        });

        it('identifies parenthetical citations', () => {
            const citation: ParsedCitation = {
                syntax: 'org-ref-v3',
                command: 'citep',
                references: [{ key: 'key' }],
                raw: 'citep:&key',
                range: { start: 0, end: 10 },
            };
            expect(getNormalizedStyle(citation)).toBe('parenthetical');
        });

        it('identifies author-only citations', () => {
            const citation: ParsedCitation = {
                syntax: 'org-ref-v3',
                command: 'citeauthor',
                references: [{ key: 'key' }],
                raw: 'citeauthor:&key',
                range: { start: 0, end: 15 },
            };
            expect(getNormalizedStyle(citation)).toBe('author');
        });
    });
});
