import { describe, it, expect } from 'vitest';
import { slideStarts } from '../slideRenderer';
import { parseDeck } from '../slideModel';
import {
    customThemeCss, ensureStyleBlock, frontMatterValue, imageMarkdown, LAYOUTS, layoutSnippet,
    setFrontMatterValue, setSlideDirective, slideDirectiveValue, validThemeName, yamlScalar,
} from '../marpAuthoring';
import { themeNames } from '../marpDirectives';

const DECK = ['---', 'marp: true', 'theme: gaia', '---', '', '# A', '', '---', '', '# B', ''];
const slidesOf = (lines: string[]) => parseDeck(lines.join('\n'), slideStarts(lines.join('\n'))).slides;

describe('front matter', () => {
    it('reads values', () => {
        expect(frontMatterValue(DECK, 'theme')).toBe('gaia');
        expect(frontMatterValue(DECK, 'size')).toBeUndefined();
        expect(frontMatterValue(['---', 'title: "A: B"', '---'], 'title')).toBe('A: B');
    });

    it('replaces, adds and removes keys', () => {
        expect(setFrontMatterValue(DECK, 'theme', 'uncover').slice(0, 4)).toEqual(['---', 'marp: true', 'theme: uncover', '---']);
        expect(setFrontMatterValue(DECK, 'size', '4:3').slice(0, 5)).toEqual(['---', 'marp: true', 'theme: gaia', 'size: 4:3', '---']);
        expect(setFrontMatterValue(DECK, 'theme', undefined).slice(0, 3)).toEqual(['---', 'marp: true', '---']);
    });

    it('removes a block value with its indented lines', () => {
        const lines = ['---', 'marp: true', 'style: |', '  section { color: red; }', '---'];
        expect(setFrontMatterValue(lines, 'style', undefined)).toEqual(['---', 'marp: true', '---']);
    });

    it('adds front matter when there is none', () => {
        expect(setFrontMatterValue(['# A'], 'theme', 'gaia')).toEqual(['---', 'marp: true', 'theme: gaia', '---', '', '# A']);
    });

    it('quotes values YAML would misread', () => {
        expect(yamlScalar('My talk')).toBe('My talk');
        expect(yamlScalar('Part 1: Intro')).toBe('"Part 1: Intro"');
        expect(yamlScalar('#1 result')).toBe('"#1 result"');
        expect(yamlScalar('')).toBe('""');
    });

    it('adds a style block', () => {
        const { lines, cursorLine } = ensureStyleBlock(DECK);
        expect(lines.slice(0, 7)).toEqual(['---', 'marp: true', 'theme: gaia', 'style: |', '  section {', '    ', '  }']);
        expect(cursorLine).toBe(5);
        expect(ensureStyleBlock(lines).cursorLine).toBe(4);
    });
});

describe('slide directives', () => {
    it('adds a directive at the top of the slide', () => {
        const slide = slidesOf(DECK)[1];
        const out = setSlideDirective(DECK, slide, 'class', 'lead');
        expect(out.slice(7, 11)).toEqual(['---', '', '<!-- _class: lead -->', '# B']);
        expect(slideDirectiveValue(out, slidesOf(out)[1], 'class')).toBe('lead');
    });

    it('adds a directive to slide 1 below the front matter', () => {
        const out = setSlideDirective(DECK, slidesOf(DECK)[0], 'paginate', 'false');
        expect(out.slice(3, 7)).toEqual(['---', '', '<!-- _paginate: false -->', '# A']);
    });

    it('replaces and removes an existing directive', () => {
        const once = setSlideDirective(DECK, slidesOf(DECK)[1], 'class', 'lead');
        const twice = setSlideDirective(once, slidesOf(once)[1], 'class', 'invert');
        expect(twice.filter(l => l.includes('_class'))).toEqual(['<!-- _class: invert -->']);
        const removed = setSlideDirective(twice, slidesOf(twice)[1], 'class', undefined);
        expect(removed).toEqual(DECK);
    });
});

describe('images', () => {
    it('builds Marp image syntax', () => {
        expect(imageMarkdown('fig.png', 'inline')).toBe('![](fig.png)');
        expect(imageMarkdown('fig.png', 'inlineWidth', 'none', 300)).toBe('![w:300](fig.png)');
        expect(imageMarkdown('fig.png', 'bgRight', 'sepia')).toBe('![bg right:40% sepia](fig.png)');
        expect(imageMarkdown('my fig.png', 'bgContain')).toBe('![bg contain](my%20fig.png)');
    });
});

describe('layouts', () => {
    it('makes a snippet for every layout', () => {
        for (const name of Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]) {
            expect(layoutSnippet(name, 'pic.png', '2026-09-28').length).toBeGreaterThan(0);
        }
        expect(layoutSnippet('imageRight', 'a$b.png')).toContain('![bg right:40%](a\\$b.png)');
        expect(layoutSnippet('title', 'x', '2026-09-28')).toContain('${4:2026-09-28}');
    });
});

describe('themes', () => {
    it('validates names', () => {
        expect(validThemeName('my-talk')).toBeUndefined();
        expect(validThemeName('gaia')).toContain('built-in');
        expect(validThemeName('9lives')).toBeDefined();
    });

    it('writes a theme that names itself and imports its base', () => {
        const css = customThemeCss('my-talk', 'gaia');
        expect(themeNames(css)).toEqual(['my-talk']);
        expect(css).toContain("@import 'gaia';");
    });
});

describe('MARP_HEADER_SNIPPET', () => {
    it('is front matter with marp: true and theme and paginate choices', async () => {
        const { MARP_HEADER_SNIPPET } = await import('../marpAuthoring');
        const lines = MARP_HEADER_SNIPPET.split('\n');
        expect(lines.slice(0, 2)).toEqual(['---', 'marp: true']);
        expect(lines[2]).toBe('theme: ${1|default,gaia,uncover|}');
        expect(lines[4]).toBe('---');
    });
});
