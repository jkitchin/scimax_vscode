import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { bundledThemeFiles, isBundledThemeFile, SCIMAX_THEMES } from '../bundledThemes';
import { themeNames } from '../marpDirectives';
import { renderDeck } from '../slideRenderer';

describe('bundled themes', () => {
    it('finds a CSS file for each theme, declaring that theme', () => {
        const files = bundledThemeFiles();
        expect(files).toHaveLength(SCIMAX_THEMES.length);
        files.forEach((file, i) => {
            expect(themeNames(fs.readFileSync(file, 'utf8'))).toContain(SCIMAX_THEMES[i]);
            expect(isBundledThemeFile(file)).toBe(true);
        });
        expect(isBundledThemeFile('/elsewhere/scimax.css')).toBe(false);
    });

    it('renders a deck with theme: scimax', () => {
        const css = fs.readFileSync(bundledThemeFiles()[0], 'utf8');
        const deck = renderDeck('---\nmarp: true\ntheme: scimax\n---\n\n# <!-- fit --> Hi\n', { themes: [css] });
        expect(deck.css).toContain('--sx-blue');
        // @auto-scaling makes fitted headings scale
        expect(deck.html).toContain('data-auto-scaling');
    });

    it.each([
        ['steampunk', '--sp-brass'],
        ['cyberpunk', '--cp-magenta'],
        ['steel', '--st-molten'],
        ['steelpunk', '--sk-hazard'],
    ])('renders a deck with theme: %s', (name, variable) => {
        const css = bundledThemeFiles().map(file => fs.readFileSync(file, 'utf8'));
        const deck = renderDeck(`---\nmarp: true\ntheme: ${name}\npaginate: true\n---\n\n<!-- _class: lead -->\n# <!-- fit --> Hi\n\n---\n\n<!-- _class: invert -->\n## Part\n`, { themes: css });
        expect(deck.css).toContain(variable);
        expect(deck.html).toContain('data-auto-scaling');
    });

    it('labels code blocks with their language, the same way in every theme', () => {
        const block = (css: string) => {
            const m = css.match(/\/\* scimax: code language label[\s\S]*?end scimax: code language label \*\//);
            return m ? m[0] : null;
        };
        const blocks = bundledThemeFiles().map(file => block(fs.readFileSync(file, 'utf8')));
        expect(blocks[0]).not.toBeNull();
        blocks.forEach(b => expect(b).toBe(blocks[0]));

        const css = fs.readFileSync(bundledThemeFiles()[0], 'utf8');
        const deck = renderDeck('---\nmarp: true\ntheme: scimax\n---\n\n```sql\nSELECT 1;\n```\n', { themes: [css] });
        expect(deck.html).toContain('class="language-sql"');
        expect(deck.css).toMatch(/code\.language-sql\)::after\s*\{\s*content:\s*"SQL"/);
    });
});
