import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require('markdown-it');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marpPreviewPlugin } from '../marpPreviewPlugin';
import { mystPreviewPlugin } from '../../markdown/mystPreview';
import { useSlideCitations } from '../slideCitations';

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

    it('renders citations in a deck with the extend hook', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-cite-'));
        try {
            fs.writeFileSync(path.join(dir, 'refs.bib'),
                '@book{boyd2004convex,\n  author = {Boyd, Stephen and Vandenberghe, Lieven},\n  title = {Convex Optimization},\n  year = {2004}\n}\n');
            const md = new MarkdownIt();
            md.use(mystPreviewPlugin).use(marpPreviewPlugin, { extend: (m: any) => useSlideCitations(m) });
            const deck = '---\nmarp: true\nbibliography: refs.bib\n---\n\n# Title\n\nSee [@boyd2004convex] and @boyd2004convex.\n';
            const html = md.render(deck, { currentDocument: { fsPath: path.join(dir, 'deck.md') } });
            expect(html).toContain('scimax-marp-style');
            expect(html).toContain('(<span class="scimax-cite"');
            expect(html).toContain('Boyd and Vandenberghe, 2004');
            expect(html).toContain('Boyd and Vandenberghe (2004)');
            expect(html).not.toContain('[@boyd2004convex]');
            expect(html).toMatch(/scimax-slide-refs.*Convex Optimization/s);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
