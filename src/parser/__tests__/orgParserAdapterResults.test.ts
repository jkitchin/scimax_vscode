/**
 * Links inside Babel results are generated text, not authored links: JSON
 * output like {"date-parts":[[2025]]} parses as a fuzzy link [[2025]] and
 * produced false back-links to every heading titled "2025". The indexer keeps
 * only file links (output images and files) from results.
 */
import { describe, it, expect } from 'vitest';
import { parseToLegacyFormat } from '../orgParserAdapter';

describe('parseToLegacyFormat: links in #+RESULTS:', () => {
    const doc = parseToLegacyFormat([
        '* Heading',
        'See [[Real target]].',
        '#+BEGIN_SRC sh',
        'curl ...',
        '#+END_SRC',
        '',
        '#+RESULTS:',
        '| {"date-parts":[[2025]]} | [[file:table.png]] |',
        '',
        '#+RESULTS:',
        ':results:',
        '[[2025]] [[file:drawer.png]]',
        ':end:',
        '',
        '#+RESULTS:',
        ': [[2025]]',
        '',
        'After the results, [[Other target]].',
        '',
    ].join('\n'));
    const targets = doc.links.map(l => l.target);

    it('keeps authored links around the results', () => {
        expect(targets).toContain('Real target');
        expect(targets).toContain('Other target');
    });

    it('drops non-file links from results', () => {
        expect(targets).not.toContain('2025');
    });

    it('keeps file links from results', () => {
        expect(targets).toContain('table.png');
        expect(targets).toContain('drawer.png');
    });
});
