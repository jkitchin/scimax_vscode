import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require('markdown-it');
import { marpPreviewPlugin } from '../marpPreviewPlugin';

const DECK = '---\nmarp: true\ntheme: gaia\n---\n\n# Title\n\n---\n\n## Two\n\n- a\n';

function preview() {
    const md = new MarkdownIt();
    md.use(marpPreviewPlugin);
    return md;
}

describe('marpPreviewPlugin', () => {
    it('renders a Marp deck as slides with its theme CSS', () => {
        const html = preview().render(DECK);
        expect(html.startsWith('<style id="scimax-marp-style">')).toBe(true);
        expect(html.match(/<svg data-marpit-svg/g)).toHaveLength(2);
        expect(html).toContain('gaia');
    });

    it('adds source lines for scroll sync and double-click', () => {
        const html = preview().render(DECK);
        expect(html).toMatch(/<h1[^>]*data-line="5"/);
        expect(html).toMatch(/<h2[^>]*data-line="9"/);
        expect(html).toContain('code-line');
    });

    it('leaves other Markdown alone', () => {
        const text = '# Hello\n\n---\n\ntext\n';
        expect(preview().render(text)).toBe(new MarkdownIt().render(text));
    });

    it('works when VS Code parses and renders separately', () => {
        const md = preview();
        const tokens = md.parse(DECK, {});
        const html = md.renderer.render(tokens, md.options, {});
        expect(html).toContain('scimax-marp-style');
    });
});
