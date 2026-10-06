import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { firstSlideSvg, isMarpText, renderDeck, slideStarts } from '../slideRenderer';

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
        expect(svg).toContain('<br />');
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
