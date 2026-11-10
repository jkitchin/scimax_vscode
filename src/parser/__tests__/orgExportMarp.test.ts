import { describe, it, expect } from 'vitest';
import { exportToMarp, parseHeaderArgs, yamlScalar } from '../orgExportMarp';

const org = (...lines: string[]) => lines.join('\n') + '\n';

describe('exportToMarp', () => {
    it('matches the ox-marp reference fixture (issue #77)', () => {
        // The fixture from uliw's ox-marp specification, with blank lines
        // collapsed and without the `---` that left an empty slide after the
        // title slide (headingDivider already starts one at `# Section 1`).
        const md = exportToMarp(org(
            '#+TITLE: Test Deck',
            '#+AUTHOR: Jane Doe',
            '#+STARTUP: showall',
            '#+OPTIONS: toc:nil',
            '',
            '* Section 1',
            '** Slide 1',
            '- point 1',
            '- point 2',
            '#+BEGIN_SRC jupyter-python :python "python run"',
            'print("interactive")',
            '#+END_SRC',
            '',
            '*** Subsection Fragment',
            '- item A',
            '**** Step 1',
            '#+BEGIN_SRC python',
            'val = 1',
            '#+END_SRC',
        ));
        expect(md).toBe(org(
            '---',
            'marp: true',
            'theme: default',
            'title: Test Deck',
            'author: Jane Doe',
            'paginate: true',
            'math: katex',
            'presenter: true',
            'headingDivider: 2',
            '---',
            '',
            '<!-- _class: lead -->',
            '<!-- _paginate: false -->',
            '',
            '# Test Deck',
            '',
            '### Jane Doe',
            '',
            '# Section 1',
            '',
            '## Slide 1',
            '',
            '* point 1',
            '* point 2',
            '',
            '    ```python run',
            '    print("interactive")',
            '    ```',
            '',
            '<div data-marpit-fragment>',
            '',
            '### Subsection Fragment',
            '',
            '* item A',
            '',
            '* **Step 1:**',
            '',
            '    ```python',
            '    val = 1',
            '    ```',
            '',
            '</div>',
        ));
    });

    it('takes front matter from MARP_ keywords and drops org-only ones', () => {
        const md = exportToMarp(org(
            '#+TITLE: Kinetics: a tour',
            '#+DATE: <2026-11-08 Sun>',
            '#+MARP_THEME: scimax',
            '#+MARP_PAGINATE: nil',
            '#+MARP_PRESENTER: offline',
            '#+MARP_HEADING_DIVIDER: 1',
            '#+MARP_TIMER: 20',
            '#+MARP_SIZE: 4:3',
            '#+MARP_FRONT_MATTER: transition: fade',
            '#+STARTUP: overview',
            '#+LATEX_HEADER: \\usepackage{x}',
            '',
            '* A',
        ));
        const front = md.split('\n---\n')[0];
        expect(front).toContain('theme: scimax');
        expect(front).toContain('title: "Kinetics: a tour"');
        expect(front).toContain('date: 2026-11-08 Sun');
        expect(front).toContain('paginate: false');
        expect(front).toContain('presenter: offline');
        expect(front).toContain('headingDivider: 1');
        expect(front).toContain('timer: 20');
        expect(front).toContain('size: "4:3"');
        expect(front).toContain('transition: fade');
        expect(md).not.toMatch(/STARTUP|usepackage/);
    });

    it('takes defaults from options, with keywords winning', () => {
        const md = exportToMarp(org('#+MARP_THEME: gaia', '* A'), { theme: 'scimax', paginate: false, frontMatter: { footer: 'CMU' } });
        expect(md).toContain('theme: gaia');
        expect(md).toContain('paginate: false');
        expect(md).toContain('footer: CMU');
    });

    it('turns the title slide and fragments off with #+OPTIONS', () => {
        const md = exportToMarp(org(
            '#+TITLE: T',
            '#+OPTIONS: marp-title-slide:nil marp-fragments:nil',
            '* S',
            '** Slide',
            '- a',
            '1. b',
            '*** Part',
            '**** Deep',
        ));
        expect(md).not.toContain('_class: lead');
        expect(md).not.toContain('data-marpit-fragment');
        expect(md).toContain('- a\n1. b');
        expect(md).toContain('### Part');
        expect(md).toContain('- **Deep:**');
    });

    it('puts the author below the heading divider and the preamble on the title slide', () => {
        const md = exportToMarp(org(
            '#+TITLE: T',
            '#+AUTHOR: Me',
            '#+MARP_HEADING_DIVIDER: 3',
            '',
            'Carnegie Mellon University',
            '',
            '* S',
        ));
        expect(md).toContain('# T\n\n#### Me\n\nCarnegie Mellon University\n\n# S');
    });

    it('writes slide directives, fit headings and hidden slides from heading properties and tags', () => {
        const md = exportToMarp(org(
            '* Intro',
            ':PROPERTIES:',
            ':MARP_CLASS: invert',
            ':MARP_BACKGROUND_COLOR: #123',
            ':MARP_FIT: t',
            ':END:',
            '** Backup :hidden:',
            'Details --> here.',
            '** Draft :noexport:',
            'gone',
            '* COMMENT Old',
            'gone too',
        ));
        expect(md).toContain('# <!-- fit --> Intro\n\n<!-- _class: invert -->\n<!-- _backgroundColor: #123 -->');
        expect(md).toContain('<!-- scimax-hidden\n## Backup\n\nDetails -\\-> here.\nscimax-hidden -->');
        expect(md).not.toContain('gone');
        expect(md).not.toContain('PROPERTIES');
    });

    it('drops headings with #+EXCLUDE_TAGS', () => {
        const md = exportToMarp(org('#+EXCLUDE_TAGS: draft', '* Keep', '* Skip :draft:'));
        expect(md).toContain('# Keep');
        expect(md).not.toContain('Skip');
    });

    it('writes lists with checkboxes, counters, descriptions and nesting', () => {
        const md = exportToMarp(org(
            '* S',
            '- [X] done',
            '- [ ] open',
            '  continued',
            '  - nested *bold*',
            '- term :: meaning',
            '',
            '1. one',
            '2. [@5] five',
            '3. six',
        ));
        expect(md).toContain([
            '* [x] done',
            '* [ ] open',
            '    continued',
            '    * nested **bold**',
            '* **term:** meaning',
        ].join('\n'));
        expect(md).toContain('1) one\n5) five\n6) six');
    });

    it('nests code blocks and their results after a list into the last item', () => {
        const md = exportToMarp(org(
            '* S',
            '- a',
            '#+BEGIN_SRC python :exports both',
            'print(1)',
            '#+END_SRC',
            '',
            '#+RESULTS:',
            ': 1',
            '',
            'After.',
        ));
        expect(md).toContain('* a\n\n    ```python\n    print(1)\n    ```\n\n    ```\n    1\n    ```\n\nAfter.');
        expect(exportToMarp(org('* S', '- a', '#+BEGIN_SRC python', 'x', '#+END_SRC'), { nestBlocksUnderLists: false }))
            .toContain('* a\n\n```python\nx\n```');
    });

    it('maps languages and writes live cells', () => {
        const run = (header: string) => exportToMarp(org('* S', `#+BEGIN_SRC ${header}`, 'x', '#+END_SRC')).split('\n').find(l => l.startsWith('```'));
        expect(run('jupyter-python')).toBe('```python');
        expect(run('ipython :run t')).toBe('```python run');
        expect(run('python :marp-run auto')).toBe('```python run auto');
        expect(run('python :run hidden')).toBe('```python run hidden');
        expect(run('python :run nil')).toBe('```python');
        expect(run('jupyter-R')).toBe('```r');
        expect(run('jupyter-julia')).toBe('```julia');
        expect(run('emacs-lisp')).toBe('```elisp');
        const custom = exportToMarp(org('* S', '#+BEGIN_SRC hy', 'x', '#+END_SRC'), { languageMap: { hy: 'clojure' } });
        expect(custom).toContain('```clojure');
    });

    it('follows :exports for code and results, including #+PROPERTY header-args', () => {
        const block = (exportsArg: string) => org('* S', `#+BEGIN_SRC python ${exportsArg}`, 'code()', '#+END_SRC', '', '#+RESULTS:', ': out');
        expect(exportToMarp(block(''))).toContain('code()');
        expect(exportToMarp(block(''))).not.toContain('out');
        expect(exportToMarp(block(':exports both'))).toMatch(/code\(\)[\s\S]*out/);
        expect(exportToMarp(block(':exports results'))).not.toContain('code()');
        expect(exportToMarp(block(':exports results'))).toContain('out');
        expect(exportToMarp(block(':exports none'))).not.toMatch(/code\(\)|out/);
        const byProperty = exportToMarp('#+PROPERTY: header-args:python :exports results\n' + block(''));
        expect(byProperty).not.toContain('code()');
        expect(byProperty).toContain('out');
    });

    it('writes images with #+ATTR_MARP options', () => {
        const md = exportToMarp(org(
            '* S',
            '#+ATTR_MARP: :bg left:40% :sepia',
            '[[file:fig.png]]',
            '',
            '#+ATTR_MARP: :width 300px :alt A plot',
            '#+CAPTION: The plot.',
            '[[./plot.svg]]',
            '',
            '#+ATTR_HTML: :width 200',
            '[[https://example.com/a.jpg]]',
        ));
        expect(md).toContain('![bg left:40% sepia](fig.png)');
        expect(md).toContain('![A plot w:300px](./plot.svg)\n\n*The plot.*');
        expect(md).toContain('![w:200](https://example.com/a.jpg)');
    });

    it('writes speaker notes, countdowns and other special blocks', () => {
        const md = exportToMarp(org(
            '* S',
            '#+BEGIN_NOTES',
            'Say *this* --> slowly.',
            '#+END_NOTES',
            '#+begin_countdown 3:00',
            'Discuss with your neighbour.',
            '#+end_countdown',
            '#+begin_columns',
            'Left',
            '#+end_columns',
        ));
        expect(md).toContain('<!--\nSay **this** -\\-> slowly.\n-->');
        expect(md).toContain('```countdown 3:00\nDiscuss with your neighbour.\n```');
        expect(md).toContain('<div class="columns">\n\nLeft\n\n</div>');
    });

    it('passes marp, md and html export blocks and snippets through, and drops others', () => {
        const md = exportToMarp(org(
            '* S',
            '#+BEGIN_EXPORT marp',
            '<!-- _backgroundColor: #123456 -->',
            '#+END_EXPORT',
            '#+BEGIN_EXPORT latex',
            '\\dropped',
            '#+END_EXPORT',
            'A @@html:<b>b</b>@@ c @@latex:\\no@@',
        ));
        expect(md).toContain('<!-- _backgroundColor: #123456 -->');
        expect(md).toContain('A <b>b</b> c\n');
        expect(md).not.toMatch(/dropped|\\no/);
    });

    it('writes math, markup, entities and links', () => {
        const md = exportToMarp(org(
            '* S',
            'Rate $k$ and \\(y\\) and \\alpha, H_{2}O, x^2, /it/ _u_ +s+ =v= ~c~.',
            'Display \\[x^2\\] here.',
            '\\begin{align}',
            'a &= b',
            '\\end{align}',
            'See [[https://example.com][example]], https://plain.org, [[doi:10.1/x][paper]] and [[*S][the slide]].',
        ));
        expect(md).toContain('Rate $k$ and $y$ and α, H<sub>2</sub>O, x<sup>2</sup>, *it* <u>u</u> ~~s~~ `v` `c`.');
        expect(md).toContain('Display\n$$\nx^2\n$$\nhere.');
        expect(md).toContain('$$\n\\begin{align}\na &= b\n\\end{align}\n$$');
        expect(md).toContain('[example](https://example.com)');
        expect(md).toContain('<https://plain.org>');
        expect(md).toContain('[paper](https://doi.org/10.1/x)');
        expect(md).toContain('the slide');
        expect(md).not.toContain('[the slide]');
    });

    it('writes citations for the slide citation plugin and the bibliography in front matter', () => {
        const md = exportToMarp(org(
            '* S',
            'Shown by cite:&smith-2020;&jones-2021 and citet:doe-2019.',
            '',
            'bibliography:refs.bib',
        ));
        expect(md).toContain('[@smith-2020; @jones-2021]');
        expect(md).toContain('@doe-2019');
        expect(md).toContain('bibliography: refs.bib');
        expect(md).not.toContain('](refs.bib)');
    });

    it('writes tables and turns ----- into a slide break', () => {
        const md = exportToMarp(org('* S', '| a | b\\vert{} |', '|---+---|', '| 1 | x |', '', '-----', '', 'Next'));
        expect(md).toContain('| a | b');
        expect(md).toContain('|---|---|\n| 1 | x |');
        expect(md).toContain('\n---\n\nNext');
    });
});

describe('Marp export helpers', () => {
    it('parses header arguments', () => {
        const args = parseHeaderArgs(':python "python run" :run t :exports both :flag');
        expect(args.get('python')).toBe('python run');
        expect(args.get('run')).toBe('t');
        expect(args.get('exports')).toBe('both');
        expect(args.get('flag')).toBe('');
    });

    it('quotes YAML only when needed', () => {
        expect(yamlScalar('Test Deck')).toBe('Test Deck');
        expect(yamlScalar('a: b')).toBe('"a: b"');
        expect(yamlScalar('yes')).toBe('"yes"');
        expect(yamlScalar('2026')).toBe('"2026"');
        expect(yamlScalar('#tag')).toBe('"#tag"');
        expect(yamlScalar(true)).toBe('true');
    });
});

describe('Org → Marp media links', () => {
    it('plays bare movie, sound and YouTube links on the slide', () => {
        const md = exportToMarp(org(
            '* Media',
            '[[file:media/talk.mp4]]',
            '',
            '[[./media/clip.m4a]]',
            '',
            '[[https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s]]',
            '',
            '[[https://youtu.be/dQw4w9WgXcQ][the video]]',
        ));
        expect(md).toContain('<video src="media/talk.mp4" controls></video>');
        expect(md).toContain('<audio src="./media/clip.m4a" controls></audio>');
        expect(md).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90" width="768" height="432" allowfullscreen></iframe>');
        expect(md).toContain('[the video](https://youtu.be/dQw4w9WgXcQ)');
    });

    it('keeps the deck a marp: link points to', () => {
        const md = exportToMarp(org('* S', 'See [[marp:talks/group.md::5][the group deck]].'));
        expect(md).toContain('[the group deck](talks/group.md)');
    });
});
