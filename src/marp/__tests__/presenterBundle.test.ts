/**
 * Tests for the Marp presenter tools: inlining a deck's local files, adding
 * the presenter scripts, the self-copy used to save with ink, and the
 * engine that marks ```python run cells.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import {
    addPresenterScripts, bundlePresenterDeck, hasRunCells, inlineDeck, isLocalRef,
    PresenterAssets, presenterAssets, presenterRequested, scriptSafe,
} from '../presenterBundle';
import { buildMarpArgs } from '../marpExport';
import { DIRECTIVES } from '../marpDirectives';

const MEDIA = path.resolve(__dirname, '../../../media/marpPresent');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let dir: string;
let assets: PresenterAssets;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presenter-bundle-'));
    fs.mkdirSync(path.join(dir, 'img'));
    fs.mkdirSync(path.join(dir, 'widget'));
    fs.writeFileSync(path.join(dir, 'img', 'a b.png'), PNG);
    fs.writeFileSync(path.join(dir, 'img', 'bg.png'), PNG);
    fs.writeFileSync(path.join(dir, 'style.css'), '.x { background: url(img/bg.png); }');
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("</script>");');
    fs.writeFileSync(path.join(dir, 'widget', 'w.png'), PNG);
    fs.writeFileSync(path.join(dir, 'widget', 'page.html'), '<html><body><img src="w.png"></body></html>');

    // Small stand-ins for the vendored scripts, with the same first-line marks.
    const fake = path.join(dir, 'assets');
    fs.mkdirSync(fake);
    assets = {
        presenter: path.join(fake, 'presenter.js'),
        marked: path.join(fake, 'marked.js'),
        pycells: path.join(fake, 'pycells.js'),
        codemirror: path.join(fake, 'codemirror.js'),
    };
    fs.writeFileSync(assets.presenter, '/* marp-present: presenter tools for Marp HTML decks */ window.P = 1;');
    fs.writeFileSync(assets.marked, 'var marked = {};');
    fs.writeFileSync(assets.pycells, '/* marp-present: live, editable Python cells in Marp slides */ window.C = 1;');
    fs.writeFileSync(assets.codemirror, 'var CM = {};');
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

const page = (body: string, head = '') => `<!DOCTYPE html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;

describe('isLocalRef / scriptSafe', () => {
    it('recognizes local references', () => {
        expect(isLocalRef('img/a.png')).toBe(true);
        expect(isLocalRef('../a.png')).toBe(true);
        expect(isLocalRef('https://x.org/a.png')).toBe(false);
        expect(isLocalRef('data:image/png;base64,AA')).toBe(false);
        expect(isLocalRef('//cdn/a.png')).toBe(false);
        expect(isLocalRef('#x')).toBe(false);
        expect(isLocalRef('')).toBe(false);
    });

    it('keeps script content from closing its element', () => {
        expect(scriptSafe('a</script>b</SCRIPT>')).toBe('a<\\/script>b<\\/SCRIPT>');
    });
});

describe('inlineDeck', () => {
    it('inlines images, CSS url(), stylesheets, scripts and iframes', async () => {
        const html = page(
            '<img src="img/a%20b.png"><section style="background-image:url(&quot;img/bg.png&quot;)"></section>'
            + '<iframe class="w" src="widget/page.html"></iframe><script src="app.js"></script>',
            '<link rel="stylesheet" href="style.css">'
        );
        const { html: out, report } = await inlineDeck(html, dir);
        expect(out).not.toContain('img/a%20b.png');
        expect(out).toContain('<img src="data:image/png;base64,');
        expect(out).toContain('url(&quot;data:image/png;base64,');
        expect(out).toMatch(/<style>\.x \{ background: url\(data:image\/png;base64,[^)]+\); \}<\/style>/);
        expect(out).toContain('<iframe class="w" srcdoc="&lt;html&gt;&lt;body&gt;&lt;img src=&quot;data:image/png;base64,');
        expect(out).toContain('<script>console.log("<\\/script>");</script>');
        expect(report.counts.iframes).toBe(1);
        expect(report.counts.stylesheets).toBe(1);
        expect(report.counts.scripts).toBe(1);
        expect(report.missing).toEqual([]);
    });

    it('leaves remote and data URLs alone and lists remote ones', async () => {
        const html = page('<img src="https://x.org/a.png"><img src="data:image/png;base64,AA">');
        const { html: out, report } = await inlineDeck(html, dir);
        expect(out).toBe(html);
        expect(report.external).toEqual(['https://x.org/a.png']);
    });

    it('does not rewrite inside inline scripts', async () => {
        const html = page('<script>const s = "<img src=\\"img/bg.png\\">"; const u = "url(img/bg.png)";</script>');
        const { html: out } = await inlineDeck(html, dir);
        expect(out).toBe(html);
    });

    it('reports missing files and keeps the reference', async () => {
        const html = page('<img src="nope.png">');
        const { html: out, report } = await inlineDeck(html, dir);
        expect(out).toBe(html);
        expect(report.missing[0]).toContain('nope.png');
    });

    it('inlines KaTeX fonts through fetchFont, once per URL', async () => {
        const font = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Regular.woff2';
        const css = `@font-face{font-family:A;src:url(${font}) format("woff2"),url(x.woff) format("woff")}`
            + `@font-face{font-family:B;src:url(${font}) format("woff2")}`;
        const fetched: string[] = [];
        const { html: out, report } = await inlineDeck(page('', `<style>${css}</style>`), dir, {
            fetchFont: async url => { fetched.push(url); return Buffer.from('font'); },
        });
        expect(fetched).toEqual([font]);
        expect(out).toContain(`src:url(data:font/woff2;base64,${Buffer.from('font').toString('base64')}) format("woff2")}`);
        expect(out).not.toContain('x.woff');
        expect(report.counts.fonts).toBe(2);
    });
});

describe('addPresenterScripts', () => {
    it('adds the presenter tools, and the cell runner only with run cells', () => {
        const plain = addPresenterScripts(page('<p>x</p>'), assets);
        expect(plain).toContain('window.P = 1');
        expect(plain).toContain('var marked');
        expect(plain).not.toContain('window.C = 1');
        expect(plain.indexOf('window.P')).toBeLessThan(plain.indexOf('</body>'));

        const cells = addPresenterScripts(page('<pre data-run="auto"><code>1</code></pre>'), assets);
        expect(hasRunCells(cells)).toBe(true);
        expect(cells).toContain('window.C = 1');
        expect(cells).toContain('var CM');
    });

    it('does not add the scripts twice', () => {
        const once = addPresenterScripts(page('<pre data-run=""></pre>'), assets);
        expect(addPresenterScripts(once, assets)).toBe(once);
    });
});

describe('bundlePresenterDeck', () => {
    it('embeds the source, an ink block and a copy of itself', async () => {
        const md = '---\nmarp: true\n---\n\n# Hi </script>\n';
        const { html } = await bundlePresenterDeck(page('<img src="img/bg.png">'), { baseDir: dir, markdown: md, assets });
        expect(html).toContain('window.__MARP_SOURCE__ = "---\\nmarp: true\\n---\\n\\n# Hi <\\/script>\\n";');
        expect(html).toContain('<script type="application/json" id="marp-ink-data">{}</script>');

        const self = /<script type="text\/plain" id="marp-self">([^<]+)<\/script>/.exec(html);
        expect(self).not.toBeNull();
        const copy = Buffer.from(self![1], 'base64').toString('utf8');
        // The copy is the page with an empty self block, which presenter.js fills when saving.
        expect(copy).toBe(html.replace(self![1], ''));
        expect(copy).toContain('window.P = 1');
        expect(copy).toContain('data:image/png;base64,');
    });

    it('keeps non-ASCII text intact in the copy', async () => {
        const { html } = await bundlePresenterDeck(page('<p>µ → ∞</p>'), { baseDir: dir, assets });
        const b64 = /id="marp-self">([^<]+)</.exec(html)![1];
        expect(Buffer.from(b64, 'base64').toString('utf8')).toContain('<p>µ → ∞</p>');
    });

    it('rejects a deck that already has the tools, and pages that are not decks', async () => {
        const { html } = await bundlePresenterDeck(page('<p>x</p>'), { baseDir: dir, assets });
        await expect(bundlePresenterDeck(html, { baseDir: dir, assets })).rejects.toThrow(/already/);
        await expect(bundlePresenterDeck('<p>x</p>', { baseDir: dir, assets })).rejects.toThrow(/Marp HTML deck/);
    });
});

describe('presenter settings', () => {
    it('reads presenter: true', () => {
        expect(presenterRequested('true')).toBe(true);
        expect(presenterRequested(' yes ')).toBe(true);
        expect(presenterRequested('false')).toBe(false);
        expect(presenterRequested(undefined)).toBe(false);
    });

    it('has a presenter directive', () => {
        const spec = DIRECTIVES.find(d => d.name === 'presenter');
        expect(spec?.scope).toBe('global');
    });

    it('passes the engine to Marp CLI', () => {
        const args = buildMarpArgs('/d/deck.md', '/d/deck.html', 'html', { engine: '/ext/engine.cjs', themeFiles: ['/t.css'] });
        expect(args).toContain('--engine');
        expect(args[args.indexOf('--engine') + 1]).toBe('/ext/engine.cjs');
        expect(args.slice(-2)).toEqual(['--', '/d/deck.md']);
        expect(buildMarpArgs('/d/deck.md', '/d/deck.pdf', 'pdf')).not.toContain('--engine');
    });

    it('vendors the scripts the bundler injects', () => {
        for (const file of Object.values(presenterAssets(MEDIA))) {
            expect(fs.existsSync(file)).toBe(true);
        }
        expect(fs.readFileSync(path.join(MEDIA, 'presenter.js'), 'utf8')).toContain('marp-present: presenter tools');
        expect(fs.readFileSync(path.join(MEDIA, 'pycells.js'), 'utf8')).toContain('marp-present: live, editable Python cells');
    });
});

describe('engine.cjs', () => {
    const require = createRequire(__filename);
    const engine = require(path.join(MEDIA, 'engine.cjs'));
    const { Marp } = require('@marp-team/marp-core');
    const render = (md: string) => engine({ marp: new Marp() }).render(`---\nmarp: true\n---\n\n${md}`).html as string;

    it('marks run cells with their flags', () => {
        expect(render('```python run\n1\n```')).toContain('<pre data-run=""');
        expect(render('```python run auto\n1\n```')).toContain('<pre data-run="auto"');
        expect(render('```py run hidden\n1\n```')).toMatch(/<pre data-run="hidden" style="display:none"/);
    });

    it('leaves other code blocks alone', () => {
        expect(render('```python\n1\n```')).not.toContain('data-run');
        expect(render('```js run\n1\n```')).not.toContain('data-run');
    });
});
