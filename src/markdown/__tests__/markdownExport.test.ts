import { describe, it, expect } from 'vitest';
import { defaultMainFont, frontMatterHasKey, missingCharacters, pdfArgs } from '../markdownExport';

describe('defaultMainFont', () => {
    it('uses Arial Unicode MS on macOS', () => {
        expect(defaultMainFont('darwin')).toBe('Arial Unicode MS');
    });

    it('keeps the pandoc default elsewhere', () => {
        expect(defaultMainFont('linux')).toBe('');
        expect(defaultMainFont('win32')).toBe('');
    });
});

describe('frontMatterHasKey', () => {
    it('finds a top-level key in the front matter', () => {
        expect(frontMatterHasKey('---\ntitle: A\nmainfont: Georgia\n---\n\nText', 'mainfont')).toBe(true);
    });

    it('accepts ... as the closing fence and CRLF line endings', () => {
        expect(frontMatterHasKey('---\r\nmainfont: Georgia\r\n...\r\nText', 'mainfont')).toBe(true);
    });

    it('ignores the key outside the front matter', () => {
        expect(frontMatterHasKey('# Title\n\nmainfont: Georgia\n', 'mainfont')).toBe(false);
        expect(frontMatterHasKey('---\ntitle: A\n---\n\nmainfont: Georgia\n', 'mainfont')).toBe(false);
    });

    it('ignores nested keys and other keys that start the same way', () => {
        expect(frontMatterHasKey('---\nfonts:\n  mainfont: Georgia\n---\n', 'mainfont')).toBe(false);
        expect(frontMatterHasKey('---\nmainfontoptions: Scale=1\n---\n', 'mainfont')).toBe(false);
    });
});

describe('pdfArgs', () => {
    const text = 'C′ → σ';

    it('defaults the font by platform', () => {
        expect(pdfArgs(text, { engine: 'xelatex', mainFont: '' }, 'darwin'))
            .toEqual(['--pdf-engine=xelatex', '-V', 'mainfont=Arial Unicode MS']);
        expect(pdfArgs(text, { engine: 'xelatex', mainFont: '' }, 'linux'))
            .toEqual(['--pdf-engine=xelatex']);
    });

    it('uses the configured font', () => {
        expect(pdfArgs(text, { engine: 'lualatex', mainFont: ' Georgia ' }, 'linux'))
            .toEqual(['--pdf-engine=lualatex', '-V', 'mainfont=Georgia']);
    });

    it('passes no font to pdflatex', () => {
        expect(pdfArgs(text, { engine: 'pdflatex', mainFont: 'Georgia' }, 'darwin'))
            .toEqual(['--pdf-engine=pdflatex']);
    });

    it('lets a front matter mainfont take precedence', () => {
        const content = `---\nmainfont: Palatino\n---\n\n${text}`;
        expect(pdfArgs(content, { engine: 'xelatex', mainFont: 'Georgia' }, 'darwin'))
            .toEqual(['--pdf-engine=xelatex']);
    });
});

describe('missingCharacters', () => {
    it('lists each missing character once, in order', () => {
        const stderr = [
            '[WARNING] Missing character: There is no ′ (U+2032) (U+2032) in font [lmroman10-regular]:mapping=t',
            '[WARNING] Missing character: There is no → (U+2192) (U+2192) in font [lmroman10-regular]:mapping=t',
            '[WARNING] Missing character: There is no ′ (U+2032) (U+2032) in font [lmroman10-regular]:mapping=t',
        ].join('\n');
        expect(missingCharacters(stderr)).toEqual(['′', '→']);
    });

    it('returns nothing for clean output', () => {
        expect(missingCharacters('')).toEqual([]);
    });
});
