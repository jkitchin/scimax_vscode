import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { slideStarts } from '../slideRenderer';
import {
    buildMarpArgs, buildPandocPptxArgs, cleanImageAlt, describeMarpFailure, isDirectiveComment,
    localFilesWereBlocked, marpErrorText, marpOutputPath, marpToPandocMarkdown,
} from '../marpExport';

const DECK = path.join('/talks', 'deck.md');

describe('marpOutputPath', () => {
    it('names the output after the deck', () => {
        expect(marpOutputPath(DECK, 'pdf')).toBe(path.join('/talks', 'deck.pdf'));
        expect(marpOutputPath(DECK, 'pdfNotes')).toBe(path.join('/talks', 'deck-notes.pdf'));
        expect(marpOutputPath(DECK, 'pptx')).toBe(path.join('/talks', 'deck.pptx'));
        expect(marpOutputPath(DECK, 'pptxEditable')).toBe(path.join('/talks', 'deck-editable.pptx'));
        expect(marpOutputPath(DECK, 'images')).toBe(path.join('/talks', 'deck.png'));
        expect(marpOutputPath(DECK, 'notes')).toBe(path.join('/talks', 'deck-notes.txt'));
    });
});

describe('buildMarpArgs', () => {
    it('builds PDF arguments', () => {
        expect(buildMarpArgs(DECK, '/talks/deck.pdf', 'pdf')).toEqual(
            ['--no-stdin', '--pdf', '--pdf-outlines', '-o', '/talks/deck.pdf', '--', DECK]
        );
    });

    it('adds editable PowerPoint flags', () => {
        const args = buildMarpArgs(DECK, '/talks/deck-editable.pptx', 'pptxEditable');
        expect(args.slice(0, 3)).toEqual(['--no-stdin', '--pptx', '--pptx-editable']);
    });

    it('passes options through', () => {
        const args = buildMarpArgs(DECK, '/o.pdf', 'pdf', {
            allowLocalFiles: true, enableHtml: true, themeFiles: ['/t/a.css', '/t/b.css'], browserPath: '/bin/chrome',
        });
        expect(args).toContain('--allow-local-files');
        expect(args).toContain('--html');
        expect(args.slice(args.indexOf('--theme-set'), args.indexOf('--theme-set') + 3)).toEqual(['--theme-set', '/t/a.css', '/t/b.css']);
        expect(args.slice(args.indexOf('--browser-path'), args.indexOf('--browser-path') + 2)).toEqual(['--browser-path', '/bin/chrome']);
        expect(args.slice(-2)).toEqual(['--', DECK]);
    });

    it('leaves browser options off for HTML and notes', () => {
        for (const format of ['html', 'notes'] as const) {
            const args = buildMarpArgs(DECK, '/o', format, { allowLocalFiles: true, browserPath: '/bin/chrome' });
            expect(args).not.toContain('--allow-local-files');
            expect(args).not.toContain('--browser-path');
        }
    });
});

describe('Marp CLI failures', () => {
    const libreOfficeOutput = [
        '[  INFO ] Converting 1 markdown...',
        '[ ERROR ] Failed converting Markdown. (LibreOffice soffice binary could not be',
        '          found.)',
    ].join('\n');

    it('joins wrapped error lines', () => {
        expect(marpErrorText(libreOfficeOutput)).toBe(
            'Failed converting Markdown. (LibreOffice soffice binary could not be found.)'
        );
    });

    it('recognizes a missing LibreOffice', () => {
        expect(describeMarpFailure(5, libreOfficeOutput).kind).toBe('libreoffice');
        expect(describeMarpFailure(1, libreOfficeOutput).kind).toBe('libreoffice');
    });

    it('recognizes a missing browser by exit code', () => {
        expect(describeMarpFailure(2, '[ ERROR ] whatever').kind).toBe('browser');
    });

    it('reports other errors with their message', () => {
        const failure = describeMarpFailure(1, '[ ERROR ] Something broke.');
        expect(failure).toEqual({ kind: 'other', message: 'Marp export failed: Something broke.' });
    });

    it('detects blocked local files', () => {
        expect(localFilesWereBlocked('[  WARN ] 1 local file was blocked by security reason.')).toBe(true);
        expect(localFilesWereBlocked('[  INFO ] deck.md => deck.pdf')).toBe(false);
    });
});

describe('marpToPandocMarkdown', () => {
    const FM = '---\nmarp: true\n---\n';
    const convert = (text: string) => marpToPandocMarkdown(text, slideStarts(text));

    it('keeps the front matter and separates slides with ---', () => {
        expect(convert(FM + '\n# A\n\n---\n\n# B\n')).toBe(FM + '\n# A\n\n---\n\n# B\n');
    });

    it('writes headingDivider slides out with explicit separators', () => {
        const text = '---\nmarp: true\nheadingDivider: 2\n---\n\n# A\n\ntext\n\n## B\n\nmore\n';
        expect(convert(text)).toBe('---\nmarp: true\nheadingDivider: 2\n---\n\n# A\n\ntext\n\n---\n\n## B\n\nmore\n');
    });

    it('turns presenter notes into Pandoc notes after the content', () => {
        expect(convert(FM + '\n# A\n\n<!-- Say hello -->\n\ntext\n')).toBe(
            FM + '\n# A\n\ntext\n\n::: notes\nSay hello\n:::\n'
        );
    });

    it('keeps multi-line notes', () => {
        expect(convert(FM + '<!--\nline one\nline two\n-->\n')).toContain('::: notes\nline one\nline two\n:::');
    });

    it('drops directive comments', () => {
        expect(convert(FM + '<!-- _class: lead -->\n# A\n')).toBe(FM + '\n# A\n');
        expect(convert(FM + '<!--\npaginate: true\n_footer: x\n-->\n# A\n')).toBe(FM + '\n# A\n');
    });

    it('drops hidden slides', () => {
        const text = FM + '\n# A\n\n<!-- scimax-hidden\n# Secret\n<!-- note -\\->\nscimax-hidden -->\n\n---\n\n# B\n';
        const out = convert(text);
        expect(out).not.toContain('Secret');
        expect(out).toBe(FM + '\n# A\n\n---\n\n# B\n');
    });

    it('leaves code blocks alone', () => {
        const code = '```html\n<!-- not a note -->\n![bg](x.png)\n```';
        expect(convert(FM + '\n' + code + '\n')).toBe(FM + '\n' + code + '\n');
    });

    it('puts text and pictures of one slide in two columns', () => {
        const out = convert(FM + '\n## Two\n\n![bg right w:300 A cat](cat.png)\n\n- a\n- b\n\n<!-- note -->\n');
        expect(out).toBe(FM + [
            '', '## Two', '', ':::: columns', '::: column', '- a', '- b', ':::',
            '::: column', '![A cat](cat.png)', ':::', '::::', '', '::: notes', 'note', ':::', '',
        ].join('\n'));
    });

    it('puts pictures first for bg left', () => {
        const out = convert(FM + '\n![bg left](cat.png)\n\ntext\n');
        expect(out.indexOf('cat.png')).toBeLessThan(out.indexOf('text'));
        expect(out).toContain(':::: columns');
    });

    it('leaves a picture-only slide as it is', () => {
        expect(convert(FM + '\n# Pic\n\n![bg](cat.png)\n')).toBe(FM + '\n# Pic\n\n![](cat.png)\n');
    });

    it('cleans Marp image keywords', () => {
        expect(cleanImageAlt('bg contain')).toBe('');
        expect(cleanImageAlt('bg left:40% w:300 A cat')).toBe('A cat');
        expect(cleanImageAlt('Figure 1')).toBe('Figure 1');
    });

    it('recognizes directive comments', () => {
        expect(isDirectiveComment(' _class: lead ')).toBe(true);
        expect(isDirectiveComment('theme: gaia\npaginate: true')).toBe(true);
        expect(isDirectiveComment('Note: remember this')).toBe(false);
        expect(isDirectiveComment('')).toBe(false);
    });
});

describe('buildPandocPptxArgs', () => {
    it('writes pptx with an optional reference doc', () => {
        expect(buildPandocPptxArgs('/o.pptx', '/talks')).toEqual(
            ['--from', 'markdown', '--to', 'pptx', '--slide-level=0', '--resource-path', '/talks', '--output', '/o.pptx']
        );
        expect(buildPandocPptxArgs('/o.pptx', '/talks', '/t.pptx').slice(-2)).toEqual(['--reference-doc', '/t.pptx']);
    });
});
