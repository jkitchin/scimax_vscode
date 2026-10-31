import { describe, it, expect } from 'vitest';
import { entrySnippet, escapeMarkdown, outlinePath, renderSnippetLine, renderSnippetMarkdown, relocateHeading } from '../agendaHover';

const cmd = (ref: { line: number; column: number }) => `command:x?${ref.line}:${ref.column}`;

describe('agenda hover snippet', () => {
    it('escapes markdown in plain text', () => {
        expect(escapeMarkdown('a *b* [c]')).toBe('a \\*b\\* \\[c\\]');
    });

    it('opens web links directly', () => {
        const out = renderSnippetLine('/f.org', { text: 'see [[https://example.com][Example]]', line: 3 }, cmd);
        expect(out).toBe('see [Example](<https://example.com>)');
    });

    it('links bare URLs', () => {
        const out = renderSnippetLine('/f.org', { text: 'at https://example.com/a now', line: 3 }, cmd);
        expect(out).toBe('at [https://example\\.com/a](<https://example.com/a>) now');
    });

    it('routes other links through the command with their source position', () => {
        const out = renderSnippetLine('/f.org', { text: 'x [[file:notes.org][Notes]] cite:key1', line: 7 }, cmd);
        expect(out).toBe('x [Notes](<command:x?7:2>) [cite:key1](<command:x?7:28>)');
    });

    it('bolds the heading and keeps line and paragraph breaks', () => {
        const out = renderSnippetMarkdown(
            '/f.org',
            [
                { text: '* TODO Task', line: 1 },
                { text: 'one', line: 2 },
                { text: '  two', line: 3 },
                { text: '', line: 4 },
                { text: 'three', line: 5 },
                { text: '', line: 6 },
            ],
            cmd
        );
        expect(out).toBe('**\\* TODO Task**  \none  \n&nbsp;&nbsp;two\n\nthree');
    });
});

describe('entry context', () => {
    const lines = [
        '* Projects  :work:',
        '** Grant renewal',
        'Notes on the grant.',
        '*** TODO Write budget  :admin:',
        'SCHEDULED: <2026-10-26 Mon>',
        ':PROPERTIES:',
        ':EFFORT: 2h',
        ':END:',
        'Ask the office for last year.',
        '*** TODO Next one',
        '* Other',
    ];

    it('takes the heading and its body, without the property drawer', () => {
        expect(entrySnippet(lines, 4, 10)!.map(l => l.text)).toEqual([
            '*** TODO Write budget  :admin:',
            'SCHEDULED: <2026-10-26 Mon>',
            'Ask the office for last year.',
        ]);
        expect(entrySnippet(lines, 4, 1)!.map(l => l.line)).toEqual([4, 5]);
        expect(entrySnippet(lines, 99, 10)).toBeUndefined();
    });

    it('lists the headings above, outermost first, without tags', () => {
        expect(outlinePath(lines, 4)).toEqual(['Projects', 'Grant renewal']);
        expect(outlinePath(lines, 10)).toEqual(['Projects', 'Grant renewal']);
        expect(outlinePath(lines, 1)).toEqual([]);
        expect(outlinePath(lines, 3)).toEqual([]);
    });
});

describe('relocateHeading', () => {
    const lines = [
        '* Talk',
        'Some new text typed since the save',
        '** TODO Finish this talk',
        'DEADLINE: <2026-11-01 Sun>',
        '** TODO Publish to YouTube :video:',
    ];

    it('keeps a line whose heading still has the title', () => {
        expect(relocateHeading(lines, 3, 'Finish this talk')).toBe(3);
    });

    it('finds a heading that moved', () => {
        // Indexed before line 2 was added
        expect(relocateHeading(lines, 2, 'Finish this talk')).toBe(3);
        expect(relocateHeading(lines, 4, 'Publish to YouTube')).toBe(5);
    });

    it('takes the nearest heading with the title', () => {
        const twice = ['* A', '** TODO x', '* B', '* C', '** TODO x'];
        expect(relocateHeading(twice, 4, 'x')).toBe(5);
        expect(relocateHeading(twice, 3, 'x')).toBe(2);
    });

    it('keeps the line when no heading has the title, or there is no title', () => {
        expect(relocateHeading(lines, 2, 'Gone')).toBe(2);
        expect(relocateHeading(lines, 2, undefined)).toBe(2);
    });
});
