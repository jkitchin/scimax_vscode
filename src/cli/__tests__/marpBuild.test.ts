/**
 * Tests for `scimax marp build`: which decks get the presenter tools.
 */

import { describe, it, expect } from 'vitest';
import { deckWantsPresenter } from '../commands/marp';

const deck = (frontMatter: string) => `---\nmarp: true\n${frontMatter}---\n\n# Slide\n`;

describe('deckWantsPresenter', () => {
    it('adds presenter tools when the deck does not say', () => {
        expect(deckWantsPresenter(deck(''), false)).toBe(true);
        expect(deckWantsPresenter('# No front matter\n', false)).toBe(true);
    });

    it('follows presenter: in the front matter', () => {
        expect(deckWantsPresenter(deck('presenter: true\n'), false)).toBe(true);
        expect(deckWantsPresenter(deck('presenter: offline\n'), false)).toBe(true);
        expect(deckWantsPresenter(deck('presenter: false\n'), false)).toBe(false);
        expect(deckWantsPresenter(deck('presenter: no\n'), false)).toBe(false);
    });

    it('leaves them out with --plain', () => {
        expect(deckWantsPresenter(deck('presenter: true\n'), true)).toBe(false);
    });
});
