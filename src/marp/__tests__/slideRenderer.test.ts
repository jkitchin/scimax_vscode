import { describe, it, expect } from 'vitest';
import { isMarpText, renderDeck, slideStarts } from '../slideRenderer';

const DECK = '---\nmarp: true\nheadingDivider: 2\n---\n\n# One\n\n## Two\n\n```\n---\n```\n\n---\n\nThree\n';

describe('isMarpText', () => {
    it('detects marp: true in the front matter', () => {
        expect(isMarpText(DECK)).toBe(true);
    });

    it('ignores decks without it', () => {
        expect(isMarpText('---\ntitle: x\n---\n# Hi')).toBe(false);
        expect(isMarpText('# Hi\n\nmarp: true')).toBe(false);
        expect(isMarpText('---\ntitle: x\n---\nmarp: true')).toBe(false);
    });
});

describe('slideStarts', () => {
    it('uses Marp slide boundaries', () => {
        expect(slideStarts(DECK)).toEqual([0, 7, 13]);
    });
});

describe('renderDeck', () => {
    it('renders one svg per slide', () => {
        const deck = renderDeck(DECK);
        expect(deck.html.match(/<svg data-marpit-svg/g)).toHaveLength(3);
        expect(deck.css.length).toBeGreaterThan(0);
    });
});
