import { describe, it, expect } from 'vitest';
import { soleMatch } from '../quickPickMatch';

const people = [
    { label: 'jkitchin', description: 'John Kitchin · PI', detail: 'jkitchin@andrew.cmu.edu' },
    { label: 'asmith', description: 'Alice Smith · student', detail: 'asmith@example.com' },
    { label: 'bsmith', description: 'Bob Smith', detail: 'bsmith@example.com' },
];

describe('soleMatch', () => {
    it('returns the one item a filter leaves', () => {
        expect(soleMatch(people, 'kitch')?.label).toBe('jkitchin');
        expect(soleMatch(people, 'Alice')?.label).toBe('asmith');
    });

    it('returns nothing when several items match', () => {
        expect(soleMatch(people, 'smith')).toBeUndefined();
    });

    it('returns nothing with no filter typed', () => {
        expect(soleMatch(people, '  ')).toBeUndefined();
    });

    it('falls back to in-order matching when no substring matches', () => {
        expect(soleMatch(people, 'jkn')?.label).toBe('jkitchin');
        expect(soleMatch(people, 'bob s')?.label).toBe('bsmith');
    });

    it('prefers a single substring match over looser matches', () => {
        // "student" is a substring of one item only, even though other
        // items contain s..t..u in order.
        expect(soleMatch(people, 'student')?.label).toBe('asmith');
    });
});
