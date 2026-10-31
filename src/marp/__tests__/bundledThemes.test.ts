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
});
