import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require('markdown-it');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mystPreviewPlugin } from '../mystPreview';

function render(src: string, enabled = true): string {
    const md = new MarkdownIt({ html: true });
    mystPreviewPlugin(md, { isEnabled: () => enabled });
    return md.render(src);
}

describe('MyST preview plugin', () => {
    it('renders a colon-fence admonition with its class colour and title', () => {
        const html = render([
            ':::{admonition} At a glance',
            ':class: tip',
            '',
            '- **Session** one',
            '- two',
            ':::',
            '',
            'After.',
        ].join('\n'));
        expect(html).toContain('class="code-line myst-admonition myst-tip tip"');
        expect(html).toContain('data-line="0"');
        expect(html).toContain('<p class="myst-admonition-title">At a glance</p>');
        expect(html).toContain('<strong>Session</strong>');
        expect(html).not.toContain(':class:');
        expect(html).toMatch(/<\/ul>\n<\/div>\n<p>After.<\/p>/);
    });

    it('titles typed admonitions by name and puts the argument in the body', () => {
        const html = render('```{warning} Mind the gap\nMore text.\n```');
        expect(html).toContain('myst-warning');
        expect(html).toContain('<p class="myst-admonition-title">Warning</p>');
        expect(html).toContain('<p>Mind the gap</p>');
        expect(html).toContain('<p>More text.</p>');
    });

    it('renders a figure as an image with alt text, width and a Markdown caption', () => {
        const html = render([
            '```{figure} figures/ad graph.png',
            ':alt: A graph [with] brackets',
            ':width: 80%',
            '',
            'The caption with $x$ and `code`.',
            '```',
        ].join('\n'));
        expect(html).toContain('<figure class="code-line myst-figure');
        expect(html).toContain('style="--myst-width:80%;"');
        expect(html).toContain('src="figures/ad%20graph.png"');
        expect(html).toContain('alt="A graph [with] brackets"');
        expect(html).toContain('<figcaption>\n<p>The caption with $x$ and <code>code</code>.</p>');
        expect(html).not.toContain(':alt:');
    });

    it('ignores an unsafe width', () => {
        const html = render('```{figure} a.png\n:width: 1px;background:red\n```');
        expect(html).not.toContain('style=');
    });

    it('hides index directives', () => {
        const html = render('```{index} automatic differentiation\n```\n```{index} single: a; b\n```\nText.');
        expect(html).toBe('<p>Text.</p>\n');
    });

    it('renders code-cell directives as highlighted fences', () => {
        const html = render('```{code-cell} python\n:tags: [hide-input]\nprint(1)\n```');
        expect(html).toContain('<code class="language-python">print(1)\n</code>');
        expect(html).not.toContain('hide-input');
    });

    it('nests directives with longer outer fences', () => {
        const html = render('::::{note}\n:::{tip}\nInner.\n:::\nOuter.\n::::');
        expect(html).toMatch(/myst-note[\s\S]*myst-tip[\s\S]*<p>Inner.<\/p>\n<\/div>\n<p>Outer.<\/p>\n<\/div>/);
    });

    it('turns a dropdown class into a details element', () => {
        const html = render(':::{admonition} Answer\n:class: dropdown\nHidden.\n:::');
        expect(html).toContain('<details class="code-line myst-admonition myst-note dropdown"');
        expect(html).toContain('<summary class="myst-admonition-title">Answer</summary>');
        expect(html).toContain('</details>');
    });

    it('labels unknown directives and still renders their body', () => {
        const html = render(':::{grid} 2\n**bold**\n:::');
        expect(html).toContain('<p class="myst-directive-name">{grid} 2</p>');
        expect(html).toContain('<strong>bold</strong>');
    });

    it('runs an unclosed directive to the end of the document', () => {
        const html = render(':::{note}\nNever closed.');
        expect(html).toContain('<p>Never closed.</p>\n</div>');
    });

    it('renders roles as their display text', () => {
        const html = render('See {ref}`general index <genindex>`, {index}`tensor`, H{sub}`2`O and {doc}`intro`.');
        expect(html).toContain('<span class="myst-role myst-role-ref" title="{ref} genindex">general index</span>');
        expect(html).toContain(', tensor,');
        expect(html).toContain('H<sub>2</sub>O');
        expect(html).toContain('title="{doc} intro">intro</span>');
    });

    it('leaves roles inside code spans alone', () => {
        const html = render('Write `` {ref}`x` `` literally.');
        expect(html).toContain('<code>{ref}`x`</code>');
    });

    it('escapes HTML in titles, arguments and roles', () => {
        const html = render(':::{frob} <script>\n:::\n\n{ref}`<b>x</b>`');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<b>');
        expect(html).toContain('{frob} &lt;script&gt;');
    });

    it('does nothing when disabled', () => {
        const html = render(':::{note}\nText\n:::', false);
        expect(html).toContain(':::{note}');
        expect(html).not.toContain('myst-');
    });

    it('fills an empty [](#label) link with the labelled section title', () => {
        const html = render([
            'We answer it at the end of [](#seci1-log).',
            '',
            '(seci1-log)=',
            '## Read the log',
        ].join('\n'));
        expect(html).toContain('<a href="#seci1-log">Read the log</a>');
        expect(html).toContain('<a id="seci1-log"></a>');
        expect(html).not.toContain('(seci1-log)=');
    });

    it('fills an empty link with a labelled directive title or figure caption', () => {
        const html = render([
            'See [](#prop-qp), [](#prop-bare) and [](#fig-x).',
            '',
            ':::{prf:proposition} QPs are LCPs',
            ':label: prop-qp',
            'Body.',
            ':::',
            '',
            ':::{prf:proposition}',
            ':label: prop-bare',
            'Body.',
            ':::',
            '',
            '```{figure} x.png',
            ':name: fig-x',
            'A caption',
            '```',
        ].join('\n'));
        expect(html).toContain('<a href="#prop-qp">QPs are LCPs</a>');
        expect(html).toContain('<a href="#prop-bare">Proposition</a>');
        expect(html).toContain('<a href="#fig-x">A caption</a>');
    });

    it('resolves targets parsed by the MyST Highlight extension\'s own myst_target rule', () => {
        // That extension's rule runs first and stores the label in `content`, with no meta.
        const md = new MarkdownIt({ html: true });
        md.block.ruler.before('hr', 'myst_target', (state: any, line: number, _end: number, silent: boolean) => {
            const m = /^\((.+)\)=\s*$/.exec(state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]));
            if (!m) return false;
            if (silent) return true;
            const token = state.push('myst_target', '', 0);
            token.content = m[1];
            token.map = [line, line + 1];
            state.line = line + 1;
            return true;
        });
        md.renderer.rules.myst_target = () => '<div class="myst-target">visible</div>';
        mystPreviewPlugin(md);
        const html = md.render('See [](#sec-a).\n\n(sec-a)=\n## Section A\n');
        expect(html).toContain('<a href="#sec-a">Section A</a>');
        expect(html).toContain('<a id="sec-a"></a>');
    });

    it('shows the label for an empty link to a target in another file, and leaves text links alone', () => {
        const html = render('See [](#elsewhere) and [Setup](#setup).');
        expect(html).toContain('<a href="#elsewhere">elsewhere</a>');
        expect(html).toContain('<a href="#setup">Setup</a>');
    });
    describe('citations and equation references', () => {
        let dir: string;
        let doc: string;
        const renderDoc = (src: string, math = false) => {
            const md = new MarkdownIt({ html: true });
            if (math) {
                // Stand-in for VS Code's math plugin: $$ blocks and inline math.
                md.block.ruler.before('fence', 'math_block', (state: any, start: number, end: number, silent: boolean) => {
                    const line = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
                    if (line(start) !== '$$') return false;
                    let close = start + 1;
                    while (close < end && !line(close).startsWith('$$')) close++;
                    if (silent) return true;
                    const token = state.push('math_block', 'math', 0);
                    token.content = state.getLines(start + 1, close, 0, true);
                    token.map = [start, close + 1];
                    state.line = close + 1;
                    return true;
                });
                md.renderer.rules.math_block = (t: any, i: number) => `<div class="math">${t[i].content}</div>`;
                md.renderer.rules.math_inline = (t: any, i: number) => `<span class="math">${t[i].content}</span>`;
            }
            mystPreviewPlugin(md);
            return md.render(src, { currentDocument: { fsPath: doc } });
        };

        beforeAll(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myst-cite-'));
            fs.writeFileSync(path.join(dir, 'myst.yml'), 'version: 1\nproject:\n  bibliography: [refs.bib]\n');
            fs.writeFileSync(path.join(dir, 'refs.bib'), [
                '@article{grant2006disciplined,',
                '  author = {Grant, Michael and Boyd, Stephen and Ye, Yinyu},',
                '  title = {Disciplined convex programming},',
                '  journal = {Global Optimization},',
                '  year = {2006}',
                '}',
                '',
                '@book{boyd2004convex,',
                '  author = {Boyd, Stephen and Vandenberghe, Lieven},',
                '  title = {Convex Optimization},',
                '  year = {2004}',
                '}',
                '',
            ].join('\n'));
            fs.mkdirSync(path.join(dir, 'content'));
            doc = path.join(dir, 'content', 'ch1.md');
        });
        afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

        it('renders [@key] as an author-year citation with the full reference as tooltip', () => {
            const html = renderDoc('Disciplined convex programming [@grant2006disciplined].');
            expect(html).toMatch(/\(<span class="scimax-cite" title="[^"]*Disciplined convex programming[^"]*">Grant et al\., 2006<\/span>\)/);
        });

        it('handles several keys, prefixes and locators', () => {
            const html = renderDoc('[see @grant2006disciplined, p. 3; @boyd2004convex]');
            expect(html).toContain('(see <span');
            expect(html).toContain('>Grant et al., 2006, p. 3</span>; <span');
            expect(html).toContain('>Boyd and Vandenberghe, 2004</span>)');
        });

        it('renders MyST cite roles and bare @key, but leaves unknown handles and e-mail alone', () => {
            const html = renderDoc('{cite:t}`boyd2004convex` and {cite:p}`grant2006disciplined`; @boyd2004convex; @nobody; a@b.org');
            expect(html).toContain('>Boyd and Vandenberghe (2004)</span>');
            expect(html).toContain('(<span class="scimax-cite"');
            expect(html).toContain('@nobody');
            expect(html).toContain('a@b.org');
        });

        it('marks a missing key', () => {
            expect(renderDoc('[@missing2020]')).toContain('scimax-cite-missing');
        });

        it('leaves links whose text starts with @ alone', () => {
            expect(renderDoc('[@handle](https://example.com)')).toContain('<a href="https://example.com">@handle</a>');
        });

        it('links {eq} to its equation, with the equation as a hover tip', () => {
            const html = renderDoc('$$\nx^2 \\le 1\n$$ (eq-a)\n\nBy {eq}`eq-a`, and {ref}`sec-b`.\n\n(sec-b)=\n## Section B\n', true);
            expect(html).toContain('<a id="eq-a"></a>');
            expect(html).toContain('<a class="myst-xref" href="#eq-a">(eq-a)<span class="myst-eq-tip"><span class="math">\\displaystyle x^2 \\le 1</span></span></a>');
            expect(html).toContain('<a class="myst-xref" href="#sec-b">Section B</a>');
        });
    });

    it('highlights code cells whose argument is a Jupyter kernel name', () => {
        expect(render('```{code-cell} ipython3\nprint(1)\n```')).toContain('language-python');
    });
});
