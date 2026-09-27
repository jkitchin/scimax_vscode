import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require('markdown-it');
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
});
