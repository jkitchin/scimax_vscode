import { describe, it, expect } from 'vitest';
import { alignTablesInText } from '../tableCore';

describe('alignTablesInText', () => {
    it('aligns every org table and counts them', () => {
        const text = '* H\n| a | bbb |\n|-\n| 1 | 2 |\n\ntext\n\n| x | y |\n| 10 | 2 |\n';
        const result = alignTablesInText(text, 'org');
        expect(result.text).toBe(
            '* H\n| a | bbb |\n|---+-----|\n| 1 | 2   |\n\ntext\n\n| x  | y |\n| 10 | 2 |\n'
        );
        expect(result).toMatchObject({ tables: 2, changed: 2 });
    });

    it('reports nothing changed for an aligned table', () => {
        const text = '| x  | y |\n|----+---|\n| 10 | 2 |';
        expect(alignTablesInText(text, 'org')).toEqual({ text, tables: 1, changed: 0 });
    });

    it('uses GFM separators and keeps alignment colons for markdown', () => {
        const text = '| a | b |\n|:-|-:|\n| 100 | 2 |';
        expect(alignTablesInText(text, 'markdown').text).toBe(
            '| a   | b |\n|:----|--:|\n| 100 | 2 |'
        );
    });

    it('measures links by their description unless told not to', () => {
        const text = '| [[https://x.org][ab]] |\n| abcd |';
        expect(alignTablesInText(text, 'org').text).toBe('| [[https://x.org][ab]]   |\n| abcd |');
        expect(alignTablesInText(text, 'org', { collapseLinks: false }).text).toBe(
            '| [[https://x.org][ab]] |\n| abcd                  |'
        );
    });

    it('leaves tables inside blocks alone', () => {
        const org = '#+begin_src text\n| a | bb |\n#+end_src\n| c | d |';
        expect(alignTablesInText(org, 'org')).toMatchObject({ text: org, tables: 1, changed: 0 });
        const md = '```\n| a | bb |\n|-|-|\n```';
        expect(alignTablesInText(md, 'markdown')).toMatchObject({ text: md, tables: 0 });
    });

    it('aligns only the table at the given line', () => {
        const text = '| a | bb |\n\n| c | dd |';
        expect(alignTablesInText(text, 'org', { line: 2 })).toEqual({
            text: '| a | bb |\n\n| c | dd |', tables: 1, changed: 0,
        });
        expect(alignTablesInText('| a |\n| bbb |\n\n| c |\n| ddd |', 'org', { line: 3 }).text)
            .toBe('| a |\n| bbb |\n\n| c   |\n| ddd |');
    });

    it('preserves CRLF line endings', () => {
        expect(alignTablesInText('| a |\r\n| bbb |\r\n', 'org').text).toBe('| a   |\r\n| bbb |\r\n');
    });
});
