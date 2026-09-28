import { describe, it, expect } from 'vitest';
import { slideStarts } from '../slideRenderer';
import { assembleDeck, parseDeck, setHidden } from '../slideModel';
import { slideEditPrompt } from '../claudePrompt';

const DECK = '---\nmarp: true\n---\n\n# A\n\n---\n\n# B\n\ntext\n\n---\n\n# C\n';

function prompt(text: string, indices: number[]) {
    const deck = parseDeck(text, slideStarts(text));
    return slideEditPrompt('talks/deck.md', text.split('\n'), deck.slides, indices);
}

describe('slideEditPrompt', () => {
    it('names one slide and its lines, ending where you type', () => {
        expect(prompt(DECK, [1])).toBe(
            'In the Marp slide deck talks/deck.md, edit slide 2 (lines 7-11). '
            + 'Change only that slide and keep the rest of the deck as it is. Change: '
        );
    });

    it('names several slides', () => {
        expect(prompt(DECK, [2, 0])).toContain('edit slides 1 and 3 (lines 4-5 and 13-15)');
        expect(prompt(DECK, [0, 1, 2])).toContain('slides 1, 2 and 3');
    });

    it('explains hidden slides', () => {
        const hidden = assembleDeck(setHidden(parseDeck(DECK, slideStarts(DECK)), [1], true).deck);
        expect(prompt(hidden, [1])).toContain('Slide 2 is hidden');
    });
});
