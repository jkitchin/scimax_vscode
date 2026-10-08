import { describe, it, expect } from 'vitest';
import { escapeMarkdown, renderSnippetLine, renderSnippetMarkdown } from '../agendaHover';

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
