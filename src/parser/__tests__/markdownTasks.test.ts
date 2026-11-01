import { describe, it, expect } from 'vitest';
import { parseMarkdownHeadings, markdownToOrgOutline, markdownTodoKeywords, markdownTaskTokens } from '../markdownTasks';

const DOC = `Intro text

## TODO [#A] Write the intro #paper #draft
SCHEDULED: <2026-11-03 Tue> DEADLINE: <2026-11-07 Fri>

Body.

### [DONE] Outline :writing:
CLOSED: [2026-10-30 Fri 10:00]

\`\`\`python
# TODO not a heading
\`\`\`

# Notes
`;

describe('parseMarkdownHeadings', () => {
    const hs = parseMarkdownHeadings(DOC);

    it('reads keywords, priority, tags and planning', () => {
        expect(hs).toHaveLength(3);
        expect(hs[0]).toMatchObject({
            level: 2, title: 'Write the intro', lineNumber: 3, todoState: 'TODO', todoType: 'todo',
            priority: 'A', tags: ['paper', 'draft'], scheduled: '2026-11-03 Tue', deadline: '2026-11-07 Fri',
        });
        expect(hs[1]).toMatchObject({ title: 'Outline', todoState: 'DONE', todoType: 'done', tags: ['writing'], closed: '2026-10-30 Fri 10:00' });
        expect(hs[2]).toMatchObject({ title: 'Notes', todoState: null, scheduled: null });
    });

    it('records the offset of each heading', () => {
        expect(DOC.slice(hs[0].beginPos).startsWith('## TODO')).toBe(true);
    });

    it('does not take an ordinary first word as a keyword', () => {
        expect(parseMarkdownHeadings('# Today is fine')[0]).toMatchObject({ todoState: null, title: 'Today is fine' });
    });

    it('reads #+TODO keywords, also in an HTML comment', () => {
        const doc = '<!-- #+TODO: DRAFT(d) REVIEW | PUBLISHED -->\n# DRAFT Post\n# PUBLISHED Old\n';
        const kw = markdownTodoKeywords(doc);
        expect(kw.active.has('DRAFT')).toBe(true);
        const h = parseMarkdownHeadings(doc);
        expect(h[0]).toMatchObject({ todoState: 'DRAFT', todoType: 'todo', title: 'Post' });
        expect(h[1]).toMatchObject({ todoState: 'PUBLISHED', todoType: 'done' });
    });
});

describe('markdownToOrgOutline', () => {
    it('keeps line numbers and writes org headings', () => {
        const org = markdownToOrgOutline(DOC).split('\n');
        expect(org.length).toBe(DOC.split('\n').length);
        expect(org[0]).toMatch(/^#\+TODO: /);
        expect(org[2]).toBe('** TODO [#A] Write the intro :paper:draft:');
        expect(org[3]).toBe('SCHEDULED: <2026-11-03 Tue> DEADLINE: <2026-11-07 Fri>');
        expect(org[7]).toBe('*** DONE Outline :writing:');
        expect(org[11]).toBe('');
        expect(org[14]).toBe('* Notes');
    });
});

describe('agenda helpers on Markdown files', () => {
    it('finds the entry and outline of a # heading', async () => {
        const { entrySnippet, outlinePath, relocateHeading } = await import('../../org/agendaHover');
        const lines = ['# Project', '## TODO Task', 'SCHEDULED: <2026-11-03 Tue>', 'body', '## Next'];
        expect(entrySnippet(lines, 2, 10, true)?.map(l => l.text)).toEqual(['## TODO Task', 'SCHEDULED: <2026-11-03 Tue>', 'body']);
        expect(outlinePath(lines, 2, true)).toEqual(['Project']);
        expect(relocateHeading(lines, 4, 'Task', true)).toBe(2);
    });
});

describe('markdownTaskTokens', () => {
    const text = (content: string, t: { line: number; start: number; length: number }) =>
        content.split('\n')[t.line].slice(t.start, t.start + t.length);

    it('colours the keyword, priority, tags and planning line', () => {
        const md = '## TODO [#A] Write it :work:\nSCHEDULED: <2026-11-03 Tue> CLOSED: [2026-11-01 Sun 10:00]\n## [DONE] Old\n## TODOS are not keywords';
        const toks = markdownTaskTokens(md);
        expect(toks.map(t => [t.kind, text(md, t)])).toEqual([
            ['todo', 'TODO'],
            ['priority', '[#A]'],
            ['tag', ':work:'],
            ['planning', 'SCHEDULED:'],
            ['timestamp', '<2026-11-03 Tue>'],
            ['planning', 'CLOSED:'],
            ['inactiveTimestamp', '[2026-11-01 Sun 10:00]'],
            ['done', '[DONE]'],
        ]);
    });

    it('uses declared keywords and skips fenced code and stray planning lines', () => {
        const md = '<!-- #+TODO: REVIEW | OK -->\n# REVIEW draft\n```\n# TODO code\n```\nDEADLINE: <2026-11-03 Tue>';
        expect(markdownTaskTokens(md).map(t => [t.kind, text(md, t)])).toEqual([['todo', 'REVIEW']]);
    });
});

