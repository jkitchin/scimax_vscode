import { describe, it, expect } from 'vitest';
import { slideStarts } from '../slideRenderer';
import {
    assembleDeck, deleteSlides, duplicateSlides, emptySlide, insertSlides, moveSlides, moveSlidesTo,
    parseDeck, setHidden, slideAtLine, slidesFromText, slidesToText,
} from '../slideModel';

const parse = (text: string) => parseDeck(text, slideStarts(text));
const lines = (...l: string[]) => l.join('\n');

const DECK = lines(
    '---',                        // 0
    'marp: true',                 // 1
    'headingDivider: 2',          // 2
    '---',                        // 3
    '',                           // 4
    '# One',                      // 5
    '',                           // 6
    'text',                       // 7
    '',                           // 8
    '## Two',                     // 9
    '',                           // 10
    '```',                        // 11
    '---',                        // 12 (inside a fence: not a separator)
    '```',                        // 13
    '',                           // 14
    '---',                        // 15
    '',                           // 16
    '<!-- _class: lead -->',      // 17
    'Three',                      // 18
    '',                           // 19
    '***',                        // 20
    '',                           // 21
    '<!--',                       // 22
    'speaker notes',              // 23
    '-->',                        // 24
    '',                           // 25
);

const SIMPLE = lines('---', 'marp: true', '---', '', '# A', '', '---', '', '# B', '', '---', '', '# C', '');

/** Headings of the visible slides Marp would render. */
function visibleTitles(text: string): string[] {
    const deck = parse(text);
    return deck.slides.filter(s => !s.hidden).map(s => s.body.find(l => l.startsWith('#')) ?? '(empty)');
}

describe('parseDeck', () => {
    it('splits at Marp slide boundaries', () => {
        const deck = parse(DECK);
        expect(deck.preamble).toEqual(['---', 'marp: true', 'headingDivider: 2', '---']);
        expect(deck.slides.map(s => [s.startLine, s.endLine])).toEqual([[4, 8], [9, 14], [15, 19], [20, 25]]);
        expect(deck.slides.map(s => s.sep)).toEqual([null, null, '---', '***']);
        expect(deck.dividerLevels).toEqual([1, 2]);
    });

    it('targets the first content line of each slide', () => {
        // Separators and comments are skipped; a slide with only a comment
        // falls back to its first line.
        expect(parse(DECK).slides.map(s => s.contentLine)).toEqual([5, 9, 18, 20]);
    });

    it('round-trips unchanged text exactly', () => {
        for (const text of [DECK, SIMPLE, SIMPLE.replace(/\n/g, '\r\n'), '---\nmarp: true\n---', '---\nmarp: true\n---\n\n# A\n```\ncode\n```\n---\n# B']) {
            expect(assembleDeck(parse(text))).toBe(text);
        }
    });
});

describe('moveSlides', () => {
    it('moves a slide down', () => {
        const edit = moveSlides(parse(SIMPLE), [0], 1);
        const text = assembleDeck(edit.deck);
        expect(visibleTitles(text)).toEqual(['# B', '# A', '# C']);
        expect(edit.selection).toEqual([1]);
        expect(text).toBe(lines('---', 'marp: true', '---', '', '# B', '', '---', '', '# A', '', '---', '', '# C', ''));
    });

    it('moves a group and stops at the edge', () => {
        const edit = moveSlides(parse(SIMPLE), [1, 2], -1);
        expect(visibleTitles(assembleDeck(edit.deck))).toEqual(['# B', '# C', '# A']);
        expect(edit.selection).toEqual([0, 1]);
        const again = moveSlides(edit.deck, edit.selection, -1);
        expect(again.selection).toEqual([0, 1]);
    });

    it('keeps the file ending with a newline', () => {
        const text = assembleDeck(moveSlides(parse(SIMPLE), [2], -1).deck);
        expect(text.endsWith('\n')).toBe(true);
        expect(visibleTitles(text)).toEqual(['# A', '# C', '# B']);
    });

    it('moves a headingDivider slide without adding a separator', () => {
        const text = assembleDeck(moveSlides(parse(DECK), [1], -1).deck);
        expect(parse(text).slides).toHaveLength(4);
        expect(text).toContain('## Two');
        expect(text.split('\n').slice(4, 6)).toEqual(['## Two', '']);
    });
});

describe('moveSlidesTo', () => {
    it('drops a slide before another', () => {
        const edit = moveSlidesTo(parse(SIMPLE), [2], 0);
        expect(visibleTitles(assembleDeck(edit.deck))).toEqual(['# C', '# A', '# B']);
        expect(edit.selection).toEqual([0]);
    });

    it('drops at the end', () => {
        const edit = moveSlidesTo(parse(SIMPLE), [0], 3);
        expect(visibleTitles(assembleDeck(edit.deck))).toEqual(['# B', '# C', '# A']);
        expect(edit.selection).toEqual([2]);
    });

    it('moves a scattered selection as one block', () => {
        const deck = parse(SIMPLE + '\n---\n\n# D\n');
        const edit = moveSlidesTo(deck, [0, 2], 4);
        expect(visibleTitles(assembleDeck(edit.deck))).toEqual(['# B', '# D', '# A', '# C']);
        expect(edit.selection).toEqual([2, 3]);
    });

    it('leaves the deck unchanged when dropped onto itself', () => {
        const deck = parse(SIMPLE);
        expect(assembleDeck(moveSlidesTo(deck, [1], 1).deck)).toBe(SIMPLE);
        expect(assembleDeck(moveSlidesTo(deck, [1], 2).deck)).toBe(SIMPLE);
    });
});

describe('deleteSlides', () => {
    it('removes slides and selects the next one', () => {
        const edit = deleteSlides(parse(SIMPLE), [1]);
        expect(visibleTitles(assembleDeck(edit.deck))).toEqual(['# A', '# C']);
        expect(edit.selection).toEqual([1]);
    });

    it('keeps the front matter when slide 1 is deleted', () => {
        const text = assembleDeck(deleteSlides(parse(SIMPLE), [0]).deck);
        expect(text.startsWith('---\nmarp: true\n---\n')).toBe(true);
        expect(visibleTitles(text)).toEqual(['# B', '# C']);
    });

    it('leaves one empty slide when all are deleted', () => {
        const text = assembleDeck(deleteSlides(parse(SIMPLE), [0, 1, 2]).deck);
        expect(parse(text).slides).toHaveLength(1);
        expect(text.startsWith('---\nmarp: true\n---')).toBe(true);
    });
});

describe('duplicate and insert', () => {
    it('duplicates after the last selected slide', () => {
        const edit = duplicateSlides(parse(SIMPLE), [0, 1]);
        expect(visibleTitles(assembleDeck(edit.deck))).toEqual(['# A', '# B', '# A', '# B', '# C']);
        expect(edit.selection).toEqual([2, 3]);
    });

    it('inserts an empty slide', () => {
        const edit = insertSlides(parse(SIMPLE), 1, [emptySlide()]);
        const text = assembleDeck(edit.deck);
        expect(parse(text).slides).toHaveLength(4);
        expect(visibleTitles(text)).toEqual(['# A', '(empty)', '# B', '# C']);
    });

    it('inserts before the first slide', () => {
        const text = assembleDeck(insertSlides(parse(SIMPLE), 0, [emptySlide()]).deck);
        expect(parse(text).slides).toHaveLength(4);
        expect(visibleTitles(text)).toEqual(['(empty)', '# A', '# B', '# C']);
    });
});

describe('clipboard', () => {
    it('copies slides as a pasteable deck fragment', () => {
        const text = slidesToText(parse(SIMPLE), [0, 2]);
        expect(text).toBe(lines('', '# A', '', '---', '', '# C', ''));
    });

    it('pastes copied slides', () => {
        const deck = parse(SIMPLE);
        const clip = slidesToText(deck, [2]);
        const pasted = slidesFromText(clip, slideStarts(clip));
        const text = assembleDeck(insertSlides(deck, 0, pasted).deck);
        expect(visibleTitles(text)).toEqual(['# C', '# A', '# B', '# C']);
    });

    it('pastes plain text as one slide', () => {
        const pasted = slidesFromText('Just a line', slideStarts('Just a line'));
        expect(pasted).toHaveLength(1);
        const text = assembleDeck(insertSlides(parse(SIMPLE), 3, pasted).deck);
        expect(text).toContain('---\n\nJust a line');
        expect(parse(text).slides).toHaveLength(4);
    });
});

describe('hidden slides', () => {
    it('hides a slide in a comment and restores it', () => {
        const hidden = assembleDeck(setHidden(parse(SIMPLE), [1], true).deck);
        expect(hidden).toContain('<!-- scimax-hidden');
        expect(slideStarts(hidden)).toHaveLength(2);

        const deck = parse(hidden);
        expect(deck.slides.map(s => s.hidden)).toEqual([false, true, false]);
        expect(hidden.split('\n')[deck.slides[1].contentLine]).toBe('# B');

        const shown = assembleDeck(setHidden(deck, [1], false).deck);
        expect(visibleTitles(shown)).toEqual(['# A', '# B', '# C']);
    });

    it('hides the first slide without leaving an empty slide', () => {
        const hidden = assembleDeck(setHidden(parse(SIMPLE), [0], true).deck);
        expect(slideStarts(hidden)).toHaveLength(2);
        const deck = parse(hidden);
        expect(deck.slides.map(s => s.hidden)).toEqual([true, false, false]);
        expect(assembleDeck(deck)).toBe(hidden);
        expect(visibleTitles(assembleDeck(setHidden(deck, [0], false).deck))).toEqual(['# A', '# B', '# C']);
    });

    it('escapes comments inside a hidden slide', () => {
        const hidden = assembleDeck(setHidden(parse(DECK), [2], true).deck);
        expect(hidden).toContain('<!-- _class: lead -\\->');
        expect(slideStarts(hidden)).toHaveLength(3);
        const restored = assembleDeck(setHidden(parse(hidden), [2], false).deck);
        expect(restored).toContain('<!-- _class: lead -->');
        expect(slideStarts(restored)).toHaveLength(4);
    });

    it('reveals hidden slides for thumbnails', () => {
        const deck = parse(assembleDeck(setHidden(parse(SIMPLE), [0, 2], true).deck));
        expect(slideStarts(assembleDeck(deck, { revealHidden: true }))).toHaveLength(3);
    });

    it('moves a hidden slide', () => {
        const deck = parse(assembleDeck(setHidden(parse(SIMPLE), [1], true).deck));
        const moved = parse(assembleDeck(moveSlides(deck, [1], 1).deck));
        expect(moved.slides.map(s => s.hidden)).toEqual([false, false, true]);
        expect(slideStarts(assembleDeck(moved, { revealHidden: true }))).toHaveLength(3);
    });
});

describe('slideAtLine', () => {
    const slides = parse(DECK).slides;

    it('finds the slide containing a line', () => {
        expect(slideAtLine(slides, 0)).toBe(0);
        expect(slideAtLine(slides, 12)).toBe(1);
        expect(slideAtLine(slides, 15)).toBe(2);
        expect(slideAtLine(slides, 99)).toBe(3);
    });

    it('returns -1 with no slides', () => {
        expect(slideAtLine([], 3)).toBe(-1);
    });
});
