import { describe, it, expect } from 'vitest';
import { hashtagsInLine, findHashtags, hashtagAt, extractHashtagTags, hashtagPrefixBefore, isValidHashtag } from '../hashtags';

const tags = (text: string) => hashtagsInLine(text).map(h => h.tag);

describe('hashtagsInLine', () => {
    it('finds hashtags in body text with their columns', () => {
        expect(hashtagsInLine('I see them. #orgmode.')).toEqual([
            { line: 0, start: 12, end: 20, tag: 'orgmode' },
        ]);
    });

    it('allows digits, underscores and inner hyphens', () => {
        expect(tags('#web-dev #py3 #snake_case')).toEqual(['web-dev', 'py3', 'snake_case']);
    });

    it('drops a trailing hyphen', () => {
        expect(tags('#draft- and more')).toEqual(['draft']);
    });

    it('accepts a tag after an opening parenthesis', () => {
        expect(tags('(see #ideas)')).toEqual(['ideas']);
    });

    it('ignores URL fragments, priority cookies and numbers', () => {
        expect(tags('see page.html#section and [#A] and issue #42')).toEqual([]);
    });

    it('ignores comment, keyword and Markdown heading lines', () => {
        expect(tags('# a comment with #tag')).toEqual([]);
        expect(tags('#')).toEqual([]);
        expect(tags('#+TITLE: #notatag')).toEqual([]);
        expect(tags('## Heading #notatag')).toEqual([]);
    });

    it('finds a tag that starts the line (not an org comment)', () => {
        expect(tags('#idea for later')).toEqual(['idea']);
        expect(tags('  #indented tag')).toEqual(['indented']);
    });
});

describe('findHashtags', () => {
    it('skips src, example and export blocks and Markdown fences', () => {
        const lines = [
            'before #one',
            '#+BEGIN_SRC c',
            'x = 1; #include',
            '#+END_SRC',
            '#+begin_example',
            'an #example',
            '#+end_example',
            '```',
            'code #fenced',
            '```',
            'after #two',
        ];
        expect(findHashtags(lines).map(h => [h.line, h.tag])).toEqual([[0, 'one'], [10, 'two']]);
    });

    it('keeps hashtags in quote blocks', () => {
        expect(findHashtags(['#+begin_quote', 'a #quoted tag', '#+end_quote']).map(h => h.tag)).toEqual(['quoted']);
    });
});

describe('hashtagAt', () => {
    const lines = ['text #alpha here', '#+begin_src', 'in #code', '#+end_src'];

    it('returns the hashtag under the column, including its edges', () => {
        expect(hashtagAt(lines, 0, 5)?.tag).toBe('alpha');
        expect(hashtagAt(lines, 0, 11)?.tag).toBe('alpha');
        expect(hashtagAt(lines, 0, 2)).toBeUndefined();
    });

    it('returns nothing inside a code block', () => {
        expect(hashtagAt(lines, 2, 4)).toBeUndefined();
    });
});

describe('extractHashtagTags', () => {
    it('returns distinct lowercased tags', () => {
        expect(extractHashtagTags('#OrgMode and #orgmode, #Emacs').sort()).toEqual(['emacs', 'orgmode']);
    });
});

describe('Markdown hashtags', () => {
    const md = { markdown: true };

    it('finds hashtags in heading text, not the # marks', () => {
        expect(hashtagsInLine('## Plan #paper #draft', 0, md).map(h => h.tag)).toEqual(['paper', 'draft']);
        expect(hashtagsInLine('# Title', 0, md)).toEqual([]);
        // The same line in org is a comment.
        expect(hashtagsInLine('## Plan #paper')).toEqual([]);
    });

    it('finds body hashtags and skips code fences', () => {
        const lines = ['Text #idea', '```', '#notatag', '```', '#start of line'];
        expect(findHashtags(lines, md).map(h => [h.line, h.tag])).toEqual([[0, 'idea'], [4, 'start']]);
    });

    it('extracts tags with Markdown rules', () => {
        expect(extractHashtagTags('# Notes #Paper\n', md)).toEqual(['paper']);
    });
});

describe('hashtagPrefixBefore', () => {
    it('matches # and a partly typed tag where a hashtag can start', () => {
        expect(hashtagPrefixBefore('#')).toEqual({ start: 0, prefix: '' });
        expect(hashtagPrefixBefore('see #pa')).toEqual({ start: 4, prefix: 'pa' });
        expect(hashtagPrefixBefore('(#x-y')).toEqual({ start: 1, prefix: 'x-y' });
    });

    it('does not match other uses of #', () => {
        expect(hashtagPrefixBefore('##')).toBeUndefined();
        expect(hashtagPrefixBefore('[#')).toBeUndefined();
        expect(hashtagPrefixBefore('page#sec')).toBeUndefined();
        expect(hashtagPrefixBefore('#+')).toBeUndefined();
        expect(hashtagPrefixBefore('# ')).toBeUndefined();
        expect(hashtagPrefixBefore('#1')).toBeUndefined();
    });
});

describe('isValidHashtag', () => {
    it('accepts what the highlighter colours as a hashtag', () => {
        expect(isValidHashtag('paper')).toBe(true);
        expect(isValidHashtag('a-b_2')).toBe(true);
        expect(isValidHashtag('2x')).toBe(false);
        expect(isValidHashtag('ends-')).toBe(false);
        expect(isValidHashtag('two words')).toBe(false);
    });
});
