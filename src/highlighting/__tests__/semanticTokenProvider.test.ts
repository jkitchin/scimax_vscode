import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    SemanticTokensLegend: class {
        constructor(public tokenTypes: string[], public tokenModifiers: string[]) {}
    },
}));

import {
    headingLevelFromStars,
    HEADING_TOKEN_TYPES,
} from '../semanticTokenProvider';

describe('headingLevelFromStars', () => {
    it('maps single star to level 1', () => {
        expect(headingLevelFromStars('*')).toBe(1);
    });

    it('maps double star to level 2', () => {
        expect(headingLevelFromStars('**')).toBe(2);
    });

    it('maps triple star to level 3', () => {
        expect(headingLevelFromStars('***')).toBe(3);
    });

    it('maps six stars to level 6', () => {
        expect(headingLevelFromStars('******')).toBe(6);
    });

    it('caps deeper levels at 6', () => {
        expect(headingLevelFromStars('*******')).toBe(6);
        expect(headingLevelFromStars('**********')).toBe(6);
    });
});

describe('HEADING_TOKEN_TYPES', () => {
    it('exposes one token type per level, indexed level-1', () => {
        expect(HEADING_TOKEN_TYPES).toEqual([
            'orgHeading1',
            'orgHeading2',
            'orgHeading3',
            'orgHeading4',
            'orgHeading5',
            'orgHeading6',
        ]);
    });

    it('looks up the right token type for each capped level', () => {
        for (const stars of ['*', '**', '***', '****', '*****', '******']) {
            const level = headingLevelFromStars(stars);
            expect(HEADING_TOKEN_TYPES[level - 1]).toBe(`orgHeading${stars.length}`);
        }
        // Beyond level 6, both 7-star and 8-star headings resolve to orgHeading6
        expect(HEADING_TOKEN_TYPES[headingLevelFromStars('*******') - 1]).toBe('orgHeading6');
        expect(HEADING_TOKEN_TYPES[headingLevelFromStars('********') - 1]).toBe('orgHeading6');
    });
});
