/**
 * Tests for the CitationProcessor using citation-js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CitationProcessor,
    bibEntryToCSL,
    createCitationProcessor,
    CSLEntry,
} from '../citationProcessor';
import type { BibEntry } from '../bibtexParser';

// Sample BibTeX entries for testing
const sampleEntries: BibEntry[] = [
    {
        type: 'article',
        key: 'smith-2020',
        title: 'A Study of Something Important',
        author: 'Smith, John and Doe, Jane',
        year: '2020',
        journal: 'Journal of Important Studies',
        volume: '42',
        pages: '1-25',
        fields: {},
        raw: '@article{smith-2020, author={Smith, John and Doe, Jane}, title={A Study of Something Important}, journal={Journal of Important Studies}, year={2020}, volume={42}, pages={1-25}}',
    },
    {
        type: 'book',
        key: 'jones-2021',
        title: 'The Complete Guide',
        author: 'Jones, Bob',
        year: '2021',
        fields: {
            publisher: 'Academic Press',
            address: 'New York',
        },
        raw: '@book{jones-2021, author={Jones, Bob}, title={The Complete Guide}, year={2021}, publisher={Academic Press}, address={New York}}',
    },
    {
        type: 'article',
        key: 'doe-2022',
        title: 'Recent Advances in Research',
        author: 'Doe, Jane and Smith, John and Williams, Alice',
        year: '2022',
        journal: 'Nature',
        volume: '100',
        pages: '500-510',
        doi: '10.1000/example',
        fields: {},
        raw: '@article{doe-2022, author={Doe, Jane and Smith, John and Williams, Alice}, title={Recent Advances in Research}, journal={Nature}, year={2022}, volume={100}, pages={500-510}, doi={10.1000/example}}',
    },
];

describe('CitationProcessor', () => {
    describe('bibEntryToCSL', () => {
        it('converts article entry to CSL-JSON', () => {
            const csl = bibEntryToCSL(sampleEntries[0]);
            expect(csl.id).toBe('smith-2020');
            expect(csl.type).toBe('article-journal');
            expect(csl.title).toBe('A Study of Something Important');
            expect(csl['container-title']).toBe('Journal of Important Studies');
            expect(csl.volume).toBe('42');
            expect(csl.page).toBe('1-25');
        });

        it('converts book entry to CSL-JSON', () => {
            const csl = bibEntryToCSL(sampleEntries[1]);
            expect(csl.id).toBe('jones-2021');
            expect(csl.type).toBe('book');
            expect(csl.title).toBe('The Complete Guide');
            expect(csl.publisher).toBe('Academic Press');
            expect(csl['publisher-place']).toBe('New York');
        });

        it('parses author strings correctly', () => {
            const csl = bibEntryToCSL(sampleEntries[0]);
            expect(csl.author).toHaveLength(2);
            expect(csl.author?.[0]).toEqual({ family: 'Smith', given: 'John' });
            expect(csl.author?.[1]).toEqual({ family: 'Doe', given: 'Jane' });
        });

        it('handles multiple authors with et al pattern', () => {
            const csl = bibEntryToCSL(sampleEntries[2]);
            expect(csl.author).toHaveLength(3);
            expect(csl.author?.[0]).toEqual({ family: 'Doe', given: 'Jane' });
            expect(csl.author?.[1]).toEqual({ family: 'Smith', given: 'John' });
            expect(csl.author?.[2]).toEqual({ family: 'Williams', given: 'Alice' });
        });

        it('parses year to CSL date format', () => {
            const csl = bibEntryToCSL(sampleEntries[0]);
            expect(csl.issued).toEqual({ 'date-parts': [[2020]] });
        });

        it('includes DOI when present', () => {
            const csl = bibEntryToCSL(sampleEntries[2]);
            expect(csl.DOI).toBe('10.1000/example');
        });
    });

    describe('CitationProcessor class', () => {
        let processor: CitationProcessor;

        beforeEach(() => {
            processor = new CitationProcessor({ style: 'apa' });
            processor.loadEntries(sampleEntries);
        });

        it('loads entries correctly', () => {
            expect(processor.hasEntry('smith-2020')).toBe(true);
            expect(processor.hasEntry('jones-2021')).toBe(true);
            expect(processor.hasEntry('nonexistent')).toBe(false);
        });

        it('retrieves entries by key', () => {
            const entry = processor.getEntry('smith-2020');
            expect(entry).toBeDefined();
            expect(entry?.title).toBe('A Study of Something Important');
        });

        it('formats parenthetical citation by keys', () => {
            const result = processor.formatCitationByKeys(['smith-2020'], 'parenthetical');
            expect(result.keys).toEqual(['smith-2020']);
            expect(result.text).toBeTruthy();
            // APA style: (Smith, 2020)
            expect(result.text).toMatch(/Smith/);
            expect(result.text).toMatch(/2020/);
        });

        it('formats textual citation by keys', () => {
            const result = processor.formatCitationByKeys(['smith-2020'], 'textual');
            expect(result.keys).toEqual(['smith-2020']);
            // Textual: Smith & Doe (2020)
            expect(result.text).toMatch(/Smith/);
            expect(result.text).toMatch(/Doe/);
            expect(result.text).toMatch(/2020/);
        });

        it('formats author-only citation', () => {
            const result = processor.formatCitationByKeys(['smith-2020'], 'author');
            expect(result.text).toMatch(/Smith/);
            // Should not include year in author-only
        });

        it('formats year-only citation', () => {
            const result = processor.formatCitationByKeys(['smith-2020'], 'year');
            expect(result.text).toMatch(/2020/);
        });

        it('handles missing keys gracefully', () => {
            const result = processor.formatCitationByKeys(['nonexistent'], 'parenthetical');
            expect(result.html).toContain('citation-missing');
            expect(result.text).toContain('nonexistent');
        });

        it('formats multiple citations', () => {
            const result = processor.formatCitationByKeys(
                ['smith-2020', 'jones-2021'],
                'parenthetical'
            );
            expect(result.keys).toEqual(['smith-2020', 'jones-2021']);
        });

        it('tracks cited keys for bibliography', () => {
            processor.reset();
            processor.formatCitationByKeys(['smith-2020'], 'parenthetical');
            processor.formatCitationByKeys(['jones-2021'], 'parenthetical');

            const cited = processor.getCitedKeys();
            expect(cited.has('smith-2020')).toBe(true);
            expect(cited.has('jones-2021')).toBe(true);
            expect(cited.has('doe-2022')).toBe(false);
        });

        it('generates bibliography for cited entries', () => {
            processor.reset();
            processor.formatCitationByKeys(['smith-2020'], 'parenthetical');
            processor.formatCitationByKeys(['jones-2021'], 'parenthetical');

            const bib = processor.generateBibliography();
            expect(bib).toContain('References');
            expect(bib).toContain('bibliography');
            expect(bib).toContain('Smith');
            expect(bib).toContain('Jones');
        });

        it('returns empty bibliography when no citations', () => {
            processor.reset();
            const bib = processor.generateBibliography();
            expect(bib).toBe('');
        });

        it('resets citation tracking', () => {
            processor.formatCitationByKeys(['smith-2020'], 'parenthetical');
            expect(processor.getCitedKeys().size).toBeGreaterThan(0);

            processor.reset();
            expect(processor.getCitedKeys().size).toBe(0);
        });

        it('allows style change', () => {
            processor.setStyle('vancouver');
            const result = processor.formatCitationByKeys(['smith-2020'], 'parenthetical');
            // Vancouver uses numbered citations
            expect(result.text).toBeTruthy();
        });
    });

    describe('createCitationProcessor helper', () => {
        it('creates processor with entries loaded', () => {
            const processor = createCitationProcessor(sampleEntries);
            expect(processor.hasEntry('smith-2020')).toBe(true);
        });

        it('accepts configuration options', () => {
            const processor = createCitationProcessor(sampleEntries, {
                style: 'vancouver',
                locale: 'en-US',
            });
            expect(processor.hasEntry('smith-2020')).toBe(true);
        });
    });

    describe('edge cases', () => {
        let processor: CitationProcessor;

        beforeEach(() => {
            processor = new CitationProcessor();
        });

        it('handles entry with missing author', () => {
            const entry: BibEntry = {
                type: 'misc',
                key: 'anonymous-2020',
                title: 'Anonymous Work',
                year: '2020',
                fields: {},
                raw: '@misc{anonymous-2020, title={Anonymous Work}, year={2020}}',
            };
            processor.loadEntries([entry]);
            const result = processor.formatCitationByKeys(['anonymous-2020'], 'textual');
            expect(result.text).toContain('Unknown');
        });

        it('handles entry with missing year', () => {
            const entry: BibEntry = {
                type: 'book',
                key: 'timeless',
                title: 'Timeless Classic',
                author: 'Author, Unknown',
                fields: {},
                raw: '@book{timeless, title={Timeless Classic}, author={Author, Unknown}}',
            };
            processor.loadEntries([entry]);
            const result = processor.formatCitationByKeys(['timeless'], 'parenthetical');
            expect(result.text).toMatch(/n\.d\./);
        });

        it('handles single-name author', () => {
            const entry: BibEntry = {
                type: 'book',
                key: 'aristotle',
                title: 'Metaphysics',
                author: 'Aristotle',
                year: '-350',
                fields: {},
                raw: '@book{aristotle, title={Metaphysics}, author={Aristotle}, year={-350}}',
            };
            processor.loadEntries([entry]);
            const csl = processor.getEntry('aristotle');
            expect(csl?.author?.[0].literal).toBe('Aristotle');
        });

        it('handles "First Last" author format', () => {
            const entry: BibEntry = {
                type: 'article',
                key: 'test-2020',
                title: 'Test Article',
                author: 'John Smith',
                year: '2020',
                fields: {},
                raw: '@article{test-2020, title={Test Article}, author={John Smith}, year={2020}}',
            };
            const csl = bibEntryToCSL(entry);
            expect(csl.author?.[0]).toEqual({ family: 'Smith', given: 'John' });
        });
    });
});
