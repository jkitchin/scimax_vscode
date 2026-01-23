/**
 * Test citation linking in HTML export
 */
import { describe, it, expect } from 'vitest';
import { exportToHtml } from '../orgExportHtml';
import { parseOrgFast } from '../orgExportParser';
import { createCitationProcessor } from '../../references/citationProcessor';
import type { BibEntry } from '../../references/bibtexParser';

describe('Citation Linking in HTML Export', () => {
    const sampleBibEntries: BibEntry[] = [
        {
            type: 'article',
            key: 'smith-2020',
            title: 'A Study of Something Important',
            author: 'Smith, John and Doe, Jane',
            year: '2020',
            journal: 'Journal of Important Studies',
            fields: {} as Record<string, string>,
            raw: '@article{smith-2020, author={Smith, John}, title={Test}, year={2020}}',
        },
        {
            type: 'book',
            key: 'jones-2021',
            title: 'The Complete Guide',
            author: 'Jones, Bob',
            year: '2021',
            fields: { publisher: 'Academic Press' } as Record<string, string>,
            raw: '@book{jones-2021, author={Jones, Bob}, title={Guide}, year={2021}}',
        },
    ];

    it('adds href links from citations to bibliography entries', () => {
        const orgContent = `* Test Section
This is a test cite:smith-2020 citation.
`;
        const doc = parseOrgFast(orgContent);
        const citationProcessor = createCitationProcessor(sampleBibEntries, { style: 'apa' });

        const html = exportToHtml(doc, {
            bodyOnly: true,
            bibliography: true,
            citationProcessor,
        });

        // Check that citation has href link
        expect(html).toContain('href="#ref-smith-2020"');
        expect(html).toContain('class="citation-link"');
    });

    it('adds id anchors to bibliography entries', () => {
        const orgContent = `* Test Section
This is a test cite:smith-2020 and cite:jones-2021 citations.
`;
        const doc = parseOrgFast(orgContent);
        const citationProcessor = createCitationProcessor(sampleBibEntries, { style: 'apa' });

        const html = exportToHtml(doc, {
            bodyOnly: true,
            bibliography: true,
            citationProcessor,
        });

        // Check that bibliography entries have id anchors
        expect(html).toContain('id="ref-smith-2020"');
        expect(html).toContain('id="ref-jones-2021"');
    });

    it('includes target highlight CSS for navigated entries', () => {
        const orgContent = `* Test
cite:smith-2020
`;
        const doc = parseOrgFast(orgContent);
        const citationProcessor = createCitationProcessor(sampleBibEntries, { style: 'apa' });

        const html = exportToHtml(doc, {
            bodyOnly: false,
            bibliography: true,
            citationProcessor,
        });

        // Check for :target CSS rule
        expect(html).toContain('.csl-entry:target');
    });

    it('handles multiple citations with links to first entry', () => {
        const orgContent = `* Test
cite:smith-2020,jones-2021
`;
        const doc = parseOrgFast(orgContent);
        const citationProcessor = createCitationProcessor(sampleBibEntries, { style: 'apa' });

        const html = exportToHtml(doc, {
            bodyOnly: true,
            bibliography: true,
            citationProcessor,
        });

        // Multiple citation should link to first key
        expect(html).toContain('href="#ref-smith-2020"');
    });

    it('handles fallback citations without processor', () => {
        const orgContent = `* Test
cite:unknown-key
`;
        const doc = parseOrgFast(orgContent);

        const html = exportToHtml(doc, {
            bodyOnly: true,
            bibliography: true,
            // No citation processor
        });

        // Fallback should still have link structure
        expect(html).toContain('href="#ref-unknown-key"');
    });

    it('adds unique IDs to each citation for back-linking', () => {
        const orgContent = `* Test
First cite:smith-2020 and second cite:smith-2020 citation.
`;
        const doc = parseOrgFast(orgContent);
        const citationProcessor = createCitationProcessor(sampleBibEntries, { style: 'apa' });

        const html = exportToHtml(doc, {
            bodyOnly: true,
            bibliography: true,
            citationProcessor,
        });

        // Each citation should have a unique ID
        expect(html).toContain('id="cite-1"');
        expect(html).toContain('id="cite-2"');
    });

    it('adds back-links from bibliography to citations', () => {
        const orgContent = `* Test
First cite:smith-2020 and second cite:smith-2020 citation.
`;
        const doc = parseOrgFast(orgContent);
        const citationProcessor = createCitationProcessor(sampleBibEntries, { style: 'apa' });

        const html = exportToHtml(doc, {
            bodyOnly: true,
            bibliography: true,
            citationProcessor,
        });

        // Bibliography should have back-links
        expect(html).toContain('class="citation-backlinks"');
        expect(html).toContain('class="citation-backlink"');
        expect(html).toContain('href="#cite-1"');
        expect(html).toContain('href="#cite-2"');
    });

    it('includes CSS for citation highlighting on navigation', () => {
        const orgContent = `* Test
cite:smith-2020
`;
        const doc = parseOrgFast(orgContent);
        const citationProcessor = createCitationProcessor(sampleBibEntries, { style: 'apa' });

        const html = exportToHtml(doc, {
            bodyOnly: false,
            bibliography: true,
            citationProcessor,
        });

        // Check for citation :target CSS rule
        expect(html).toContain('.citation:target');
        expect(html).toContain('.citation-backlink');
    });
});
