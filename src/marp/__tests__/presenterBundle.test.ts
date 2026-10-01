/**
 * Tests for the Marp presenter tools: inlining a deck's local files, adding
 * the presenter scripts, the self-copy used to save with ink, offline
 * Python, and the engine that marks ```python run cells.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import {
    addPresenterScripts, bundlePresenterDeck, hasRunCells, inlineDeck, isLocalRef,
    parseTimer, planOfflinePython, PresenterAssets, presenterAssets, presenterOffline, presenterRequested,
    offlineIssues, pyodideBaseUrl, PyodideLock, pythonImports, runCellAt, runCellCode, runCells, scriptSafe,
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
        timer: path.join(fake, 'timer.js'),
        show: path.join(fake, 'showtools.js'),
        edit: path.join(fake, 'editor.js'),
    };
    fs.writeFileSync(assets.edit, '/* marp-present: slide editing */ window.E = 1;');
    fs.writeFileSync(assets.show, '/* marp-present: show tools for Marp HTML decks */ window.W = 1;');
    fs.writeFileSync(assets.timer, '/* marp-present: talk timer */ window.T = 1;');
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
        expect(plain).toContain('window.W = 1');
        // the editor comes before the presenter tools, so it sees keys first while editing
        expect(plain.indexOf('window.E = 1')).toBeGreaterThan(-1);
        expect(plain.indexOf('window.E = 1')).toBeLessThan(plain.indexOf('window.P = 1'));
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

describe('talk timer', () => {
    it('reads the length of the talk', () => {
        expect(parseTimer('20')).toBe(1200);
        expect(parseTimer('7.5')).toBe(450);
        expect(parseTimer('20m')).toBe(1200);
        expect(parseTimer('20 min')).toBe(1200);
        expect(parseTimer('90s')).toBe(90);
        expect(parseTimer('1h30m')).toBe(5400);
        expect(parseTimer('1h 5m 30s')).toBe(3930);
        expect(parseTimer('45:00')).toBe(2700);
        expect(parseTimer('1:05:00')).toBe(3900);
        expect(parseTimer('"25"')).toBe(1500);
        expect(parseTimer(' 2H ')).toBe(7200);
    });

    it('ignores a missing, zero or unreadable time', () => {
        for (const value of [undefined, '', '0', '0:00', 'soon', '20 parsecs', 'h', '-5', '1:2:3:4']) {
            expect(parseTimer(value)).toBeUndefined();
        }
    });

    it('adds the timer script only when asked, once', () => {
        expect(addPresenterScripts(page('<p>x</p>'), assets)).not.toContain('window.T = 1');
        const once = addPresenterScripts(page('<p>x</p>'), assets, true);
        expect(once).toContain('window.T = 1');
        expect(addPresenterScripts(once, assets, true)).toBe(once);
    });

    it('puts the length in the bundled deck', async () => {
        const { html, report } = await bundlePresenterDeck(page('<p>x</p>'), { baseDir: dir, assets, timer: 1200 });
        expect(html).toContain('<script>window.__MARP_TIMER__ = 1200;</script>');
        expect(html.indexOf('__MARP_TIMER__')).toBeLessThan(html.indexOf('</head>'));
        expect(html).toContain('window.T = 1');
        expect(report.counts.timer).toBe(1);

        const plain = await bundlePresenterDeck(page('<p>x</p>'), { baseDir: dir, assets });
        expect(plain.html).not.toContain('__MARP_TIMER__');
        expect(plain.html).not.toContain('window.T = 1');
    });

    it('is a deck directive', () => {
        expect(DIRECTIVES.find(d => d.name === 'timer')?.scope).toBe('global');
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

describe('offline Python', () => {
    const lock: PyodideLock = {
        packages: {
            micropip: { file_name: 'micropip.whl', imports: ['micropip'], depends: ['packaging'] },
            packaging: { file_name: 'packaging.whl', imports: ['packaging'] },
            numpy: { file_name: 'numpy.whl', imports: ['numpy'] },
            matplotlib: { file_name: 'mpl.whl', imports: ['matplotlib', 'mpl_toolkits'], depends: ['numpy', 'pillow'] },
            pillow: { file_name: 'pillow.whl', imports: ['PIL'] },
            'scikit-learn': { file_name: 'sklearn.whl', imports: ['sklearn'], depends: ['numpy'] },
            scipy: { file_name: 'scipy.whl', imports: ['scipy'], depends: ['numpy'] },
        },
    };

    it('finds the code of run cells only', () => {
        const md = '```python run hidden\nimport numpy\n```\n\n```python\nimport scipy\n```\n\n~~~py run auto\nx = 1\n~~~\n\n```js run\nimport x\n```\n';
        expect(runCellCode(md)).toEqual(['import numpy\n', 'x = 1\n']);
    });

    it('reads top-level module names from import statements', () => {
        const code = 'import numpy as np, os.path\nfrom matplotlib.pyplot import plot\n    import sklearn.linear_model\nx = "import nope"\nfrom . import y\n';
        expect(pythonImports(code).sort()).toEqual(['matplotlib', 'numpy', 'os', 'sklearn']);
    });

    it('embeds Pyodide, micropip and the imported packages with their dependencies', () => {
        const md = '```python run\nimport matplotlib.pyplot as plt\nfrom sklearn import svm\nimport math\n```\n';
        const plan = planOfflinePython(md, lock);
        expect(plan.packages).toEqual(['matplotlib', 'micropip', 'numpy', 'packaging', 'pillow', 'scikit-learn']);
        expect(plan.files).toContain('pyodide.asm.wasm');
        expect(plan.files).toContain('pyodide-lock.json');
        expect(plan.files).toContain('sklearn.whl');
        expect(plan.files).not.toContain('scipy.whl');
        expect(plan.other).toEqual(['math']);
        expect(plan.pip).toBe(false);
    });

    it('notices %pip, which needs a network', () => {
        expect(planOfflinePython('```python run\n%pip install lmfit\n```\n', lock).pip).toBe(true);
    });

    it('reads the Pyodide release from pycells.js', () => {
        const base = pyodideBaseUrl(fs.readFileSync(path.join(MEDIA, 'pycells.js'), 'utf8'));
        expect(base).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v[\d.]+\/full\/$/);
    });

    it('puts the files in <head>, outside the copy used for saving', async () => {
        const pyodide = { 'pyodide.asm.wasm': Buffer.from([0, 97, 115, 109]), 'numpy.whl': Buffer.from('PK') };
        const { html, report } = await bundlePresenterDeck(page('<pre data-run=""></pre>'), { baseDir: dir, assets, pyodide });
        const block = /<script type="application\/json" id="marp-pyodide">([^<]*)<\/script>/.exec(html);
        expect(block).not.toBeNull();
        expect(html.indexOf('id="marp-pyodide"')).toBeLessThan(html.indexOf('</head>'));
        expect(JSON.parse(block![1])).toEqual({ 'pyodide.asm.wasm': 'AGFzbQ==', 'numpy.whl': 'UEs=' });
        expect(report.counts['offline Python files']).toBe(2);

        const copy = Buffer.from(/id="marp-self">([^<]+)</.exec(html)![1], 'base64').toString('utf8');
        expect(copy).toContain('<script type="application/json" id="marp-pyodide"></script>');
        expect(copy).not.toContain('AGFzbQ==');
        await expect(bundlePresenterDeck(html, { baseDir: dir, assets })).rejects.toThrow(/already/);
    });

    it('does not embed Python in a deck without run cells', async () => {
        const { html } = await bundlePresenterDeck(page('<p>x</p>'), { baseDir: dir, assets, pyodide: { 'a': Buffer.from('x') } });
        expect(html).not.toContain('marp-pyodide');
    });

    it('reads presenter: offline', () => {
        expect(presenterRequested('offline')).toBe(true);
        expect(presenterOffline('offline')).toBe(true);
        expect(presenterOffline('true')).toBe(false);
        expect(DIRECTIVES.find(d => d.name === 'presenter')!.values).toContain('offline');
    });

    it('the vendored scripts handle the embedded block', () => {
        expect(fs.readFileSync(path.join(MEDIA, 'pycells.js'), 'utf8')).toContain('getElementById("marp-pyodide")');
        expect(fs.readFileSync(path.join(MEDIA, 'presenter.js'), 'utf8')).toContain('TAG("application/json", "pyodide")');
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
        expect(fs.readFileSync(path.join(MEDIA, 'timer.js'), 'utf8')).toContain('marp-present: talk timer');
        expect(fs.readFileSync(path.join(MEDIA, 'showtools.js'), 'utf8')).toContain('marp-present: show tools');
        expect(fs.readFileSync(path.join(MEDIA, 'editor.js'), 'utf8')).toContain('marp-present: slide editing');
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

    it('renders countdown fences as a countdown box', () => {
        const html = render('```countdown 2:30\nTalk to your *neighbour*\nthen vote\n```');
        expect(html).toContain('<div class="marp-countdown" data-seconds="150"');
        expect(html).toContain('⏱ 2:30');
        expect(html).toContain('Talk to your <em>neighbour</em><br>then vote');
        expect(render('```countdown 10\n```')).toContain('data-seconds="600"');
        expect(render('```countdown 90s\n```')).toContain('⏱ 1:30');
        expect(render('```countdown\n```')).toContain('data-seconds="300"');   // 5 minutes if no time is given
        expect(render('```countdown 1\n<script>x</script>\n```')).not.toContain('<script>x');
    });

    it('reads countdown times', () => {
        const cases: Array<[string, number]> = [['3', 180], ['2.5', 150], ['3m', 180], ['90s', 90], ['1m30s', 90], ['3:00', 180], ['1:05:00', 3900], ['soon', 0]];
        for (const [text, secs] of cases) {
            expect(engine.seconds(text)).toBe(secs);
        }
    });

    it('leaves other code blocks alone', () => {
        expect(render('```python\n1\n```')).not.toContain('data-run');
        expect(render('```js run\n1\n```')).not.toContain('data-run');
    });
});

describe('runCells', () => {
    const deck = [
        '---',                 // 0
        'marp: true',          // 1
        'presenter: true',     // 2
        '---',                 // 3
        '',                    // 4
        '```python run hidden', // 5
        'import numpy as np',  // 6
        '```',                 // 7
        '',                    // 8
        '---',                 // 9
        '',                    // 10
        '```python',           // 11
        'not_run = 1',         // 12
        '```',                 // 13
        '',                    // 14
        '````python run auto', // 15
        'x = 1',               // 16
        '```',                 // 17
        'y = 2',               // 18
        '````',                // 19
    ].join('\n');

    it('finds run cells with their lines and flags', () => {
        const cells = runCells(deck);
        expect(cells.map(c => [c.startLine, c.endLine])).toEqual([[5, 7], [15, 19]]);
        expect(cells[0].flags).toEqual(['run', 'hidden']);
        expect(cells[1].code).toBe('x = 1\n```\ny = 2\n');
    });

    it('gives the same lines with CRLF line ends', () => {
        expect(runCells(deck.replace(/\n/g, '\r\n')).map(c => c.startLine)).toEqual([5, 15]);
    });

    it('finds the cell at a line, fences included', () => {
        expect(runCellAt(deck, 5)?.startLine).toBe(5);
        expect(runCellAt(deck, 7)?.startLine).toBe(5);
        expect(runCellAt(deck, 18)?.startLine).toBe(15);
        expect(runCellAt(deck, 8)).toBeUndefined();
        expect(runCellAt(deck, 12)).toBeUndefined();
    });
});

describe('offlineIssues', () => {
    const md = (presenter: string, ...body: string[]) =>
        ['---', 'marp: true', 'theme: gaia', `presenter: ${presenter}`, '---', '', ...body].join('\n');

    it('says an online deck with Python cells needs a connection', () => {
        const issues = offlineIssues({ markdown: md('true', '```python run', 'print(1)', '```') });
        expect(issues).toHaveLength(1);
        expect(issues[0].line).toBe(3);
        expect(issues[0].message).toContain('presenter: offline');
    });

    it('has nothing to say about an online deck without cells', () => {
        expect(offlineIssues({ markdown: md('true', '# Hi') })).toEqual([]);
    });

    it('points at %pip lines and imports that are not Pyodide packages', () => {
        const markdown = md('offline', '```python run', 'import numpy, os', '%pip install pycse', 'from pycse import regress', '```');
        const issues = offlineIssues({ markdown, plan: { packages: ['numpy'], files: [], other: ['os', 'pycse'], pip: true } });
        expect(issues.map(i => i.line)).toEqual([8, 9]);
        expect(issues[0].message).toContain('%pip install pycse');
        expect(issues[1].message).toContain('pycse is not a Pyodide package');
    });

    it('reports a Python error at the presenter line', () => {
        const issues = offlineIssues({ markdown: md('offline'), pythonError: 'no network' });
        expect(issues).toEqual([{ line: 3, message: expect.stringContaining('no network') }]);
    });

    it('places missing files and web URLs on their lines, others on the theme line', () => {
        const markdown = md('true', '![](img/gone.png)', '![](https://example.com/a.png)');
        const issues = offlineIssues({
            markdown,
            report: {
                counts: {},
                missing: ['img/gone.png (relative to /talks)'],
                external: ['https://example.com/a.png', 'https://fonts.googleapis.com/css'],
            },
        });
        expect(issues.map(i => i.line)).toEqual([6, 7, 2]);
        expect(issues[2].message).toContain('theme');
    });
});
