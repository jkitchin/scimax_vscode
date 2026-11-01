import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { firstSlideSvg, isMarpText, renderDeck, slideStarts } from '../slideRenderer';
import { fallbackEntriesFor, setFallbackCitationLookup } from '../../markdown/citationPreview';
import { parseBibTeX } from '../../references/bibtexParser';

const DECK = '---\nmarp: true\nheadingDivider: 2\n---\n\n# One\n\n## Two\n\n```\n---\n```\n\n---\n\nThree\n';

describe('isMarpText', () => {
    it('detects marp: true in the front matter', () => {
        expect(isMarpText(DECK)).toBe(true);
    });

    it('ignores decks without it', () => {
        expect(isMarpText('---\ntitle: x\n---\n# Hi')).toBe(false);
        expect(isMarpText('# Hi\n\nmarp: true')).toBe(false);
        expect(isMarpText('---\ntitle: x\n---\nmarp: true')).toBe(false);
    });
});

describe('slideStarts', () => {
    it('uses Marp slide boundaries', () => {
        expect(slideStarts(DECK)).toEqual([0, 7, 13]);
    });
});

describe('renderDeck', () => {
    it('renders one svg per slide', () => {
        const deck = renderDeck(DECK);
        expect(deck.html.match(/<svg data-marpit-svg/g)).toHaveLength(3);
        expect(deck.css.length).toBeGreaterThan(0);
    });

    it('shows countdown fences as countdown boxes', () => {
        const deck = renderDeck('---\nmarp: true\n---\n\n```countdown 2:30\nTalk it over\n```\n');
        expect(deck.html).toContain('class="marp-countdown"');
        expect(deck.html).toContain('data-seconds="150"');
    });
});

describe('firstSlideSvg', () => {
    it('renders only the first slide as a standalone SVG', () => {
        const { svg, width, height } = firstSlideSvg(DECK, os.tmpdir());
        expect([width, height]).toEqual([1280, 720]);
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"')).toBe(true);
        expect(svg.match(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" data-marpit-svg/g)).toHaveLength(1);
        expect(svg).toContain('<section xmlns="http://www.w3.org/1999/xhtml"');
        expect(svg).toContain('<style><![CDATA[');
        expect(svg).not.toContain('<script');
        expect(svg).not.toContain('@import');
        expect(svg).toContain('One');
        expect(svg).not.toContain('Three');
    });

    it('writes XHTML void elements', () => {
        const { svg } = firstSlideSvg('---\nmarp: true\n---\n\nA<br>B\n\n---\n\nC\n', os.tmpdir());
        expect(svg).toMatch(/<br ?\/>/);
    });

    it('writes raw HTML as well-formed XML', () => {
        const text = '---\nmarp: true\n---\n\n<div>jaxsr & discopt</div>\n';
        const { svg } = firstSlideSvg(text, os.tmpdir());
        expect(svg).toContain('<div>jaxsr &amp; discopt</div>');
        expect(svg).toContain('<foreignObject');
        expect(svg).toContain('viewBox=');
    });

    it('drops web font imports whose URL holds semicolons', () => {
        const theme = '/* @theme t */\n@import url("https://fonts.example.org/css2?family=A:wght@0,400;0,600&display=swap");\nsection { color: red; }';
        const { svg } = firstSlideSvg('---\nmarp: true\ntheme: t\n---\n\nA\n', os.tmpdir(), { themes: [theme] });
        expect(svg).not.toContain('@import');
        expect(svg).not.toContain('0,600');
        expect(svg).toContain('color:red');
    });

    it('inlines local images and leaves remote ones', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-svg-'));
        fs.writeFileSync(path.join(dir, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const text = '---\nmarp: true\n---\n\n![bg right](a.png)\n![](a.png)\n![](https://example.org/b.png)\n';
        const { svg } = firstSlideSvg(text, dir);
        expect(svg).toContain('url(&quot;data:image/png;base64,iVBORw==&quot;)');
        expect(svg).toContain('src="data:image/png;base64,iVBORw=="');
        expect(svg).toContain('src="https://example.org/b.png"');
        fs.rmSync(dir, { recursive: true });
    });
});

describe('renderDeck citations', () => {
    const BIB = '@book{boyd2004convex,\n  author = {Boyd, Stephen and Vandenberghe, Lieven},\n  title = {Convex Optimization},\n  year = {2004}\n}\n'
        + '@article{kitchin2025,\n  author = {Kitchin, John},\n  title = {Beyond Fourier},\n  journal = {Nat. Chem. Eng.},\n  year = {2025},\n  doi = {10.1038/s44286-024-00170-x}\n}\n';

    it('numbers citations across the deck, with a numbered reference list on each citing slide', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-cite-'));
        try {
            fs.writeFileSync(path.join(dir, 'refs.bib'), BIB);
            const deck = '---\nmarp: true\nbibliography: refs.bib\n---\n\n# Title\n\nSee [@boyd2004convex] and @boyd2004convex.\n'
                + '\n---\n\n# Two\n\nNo citations, [@unknown].\n'
                + '\n---\n\n# Three\n\nBoth [@kitchin2025; @boyd2004convex, p. 4].\n';
            const { html } = renderDeck(deck, { documentPath: path.join(dir, 'deck.md') });
            expect(renderDeck(deck).html).toContain('[@boyd2004convex]');
            const slides = html.split('</section>');
            // Slide 1: [1] and Boyd and Vandenberghe [1], one reference
            expect(slides[0]).toContain('[<span class="scimax-cite" title="Boyd');
            expect(slides[0]).toMatch(/>1<\/span>\]/);
            expect(slides[0]).toContain('Boyd and Vandenberghe [<span');
            expect(slides[0]).not.toMatch(/>Boyd and Vandenberghe,? \(?2004/);
            expect(slides[0].match(/<li>/g)).toHaveLength(1);
            expect(slides[0]).toMatch(/<li><span class="scimax-ref-num">\[1\]<\/span> [^<]*Convex Optimization/);
            // Slide 2 cites nothing found: no list, and the missing key does not take a number
            expect(slides[1]).not.toContain('scimax-slide-refs');
            // Slide 3: Kitchin is [2] (first used here), Boyd keeps [1]; the list is in number order
            expect(slides[2]).toMatch(/>2<\/span>, <span[^>]*>1, p\. 4<\/span>\]/);
            expect(slides[2]).toMatch(/\[1\]<\/span> [^<]*Convex.*\[2\]<\/span> [^<]*Beyond Fourier/s);
            // The DOI is a link
            expect(slides[2]).toContain('<a href="https://doi.org/10.1038/s44286-024-00170-x">');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('renderDeck citations without a bibliography: line', () => {
    it('finds keys through the fallback lookup (the reference manager)', () => {
        const entries = new Map(parseBibTeX(
            '@article{kitchin-2025,\n  author = {Kitchin, John},\n  title = {Beyond Fourier},\n  journal = {J. Chem. Phys.},\n  year = {2025}\n}\n'
        ).entries.map(e => [e.key, e]));
        setFallbackCitationLookup(key => entries.get(key));
        try {
            const deck = '---\nmarp: true\n---\n\n# Title\n\nSee [@kitchin-2025].\n';
            const { html } = renderDeck(deck, { documentPath: path.join(os.tmpdir(), 'no-such-dir', 'deck.md') });
            expect(html).toMatch(/\[<span class="scimax-cite"[^>]*>1<\/span>\]/);
            expect(html).toMatch(/scimax-slide-refs.*Beyond Fourier/s);
        } finally {
            setFallbackCitationLookup(undefined);
        }
    });

    it('collects the entries a deck may cite, for Marp CLI', () => {
        const entries = new Map(parseBibTeX(
            '@article{kitchin-2025,\n  author = {Kitchin, John},\n  title = {Beyond Fourier},\n  year = {2025}\n}\n'
        ).entries.map(e => [e.key, e]));
        expect(fallbackEntriesFor('See @kitchin-2025.')).toEqual({});
        setFallbackCitationLookup(key => entries.get(key));
        try {
            const found = fallbackEntriesFor('As shown [@kitchin-2025]. Also @kitchin-2025.');
            expect(Object.keys(found)).toEqual(['kitchin-2025']);
            expect(found['kitchin-2025'].title).toBe('Beyond Fourier');
            expect(fallbackEntriesFor('No citations here.')).toEqual({});
        } finally {
            setFallbackCitationLookup(undefined);
        }
    });
});
