import { describe, it, expect } from 'vitest';
import { findBracketLinkAt, formatBracketLink } from '../bracketLink';

describe('findBracketLinkAt', () => {
    const line = 'see [[file:a.org][the notes]] and [[https://x.org]]';

    it('finds the link around the cursor, including its edges', () => {
        expect(findBracketLinkAt(line, 4)).toEqual({ start: 4, end: 29, target: 'file:a.org', description: 'the notes' });
        expect(findBracketLinkAt(line, 29)?.target).toBe('file:a.org');
        expect(findBracketLinkAt(line, 40)).toEqual({ start: 34, end: 51, target: 'https://x.org', description: undefined });
    });

    it('returns null off a link', () => {
        expect(findBracketLinkAt(line, 2)).toBeNull();
        expect(findBracketLinkAt(line, 31)).toBeNull();
    });

    it('keeps escaped brackets in the target', () => {
        expect(findBracketLinkAt('[[a\\]b][d]]', 3)?.target).toBe('a\\]b');
    });
});

describe('formatBracketLink', () => {
    it('drops an empty description', () => {
        expect(formatBracketLink('x', '')).toBe('[[x]]');
        expect(formatBracketLink('x', 'y')).toBe('[[x][y]]');
    });
});
