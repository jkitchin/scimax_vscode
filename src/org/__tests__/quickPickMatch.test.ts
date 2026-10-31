import { describe, it, expect } from 'vitest';
import { acceptedItems, soleMatch } from '../quickPickMatch';

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

describe('acceptedItems', () => {
    const [john, alice, bob] = people;
    const base = { items: people, selected: [], initial: [], active: john, moved: false, value: '' };
    const labels = (items: typeof people) => items.map(i => i.label);

    it('takes the highlighted person when no box is checked', () => {
        expect(labels(acceptedItems({ ...base, active: alice, moved: true }))).toEqual(['asmith']);
    });

    it('takes the first person, highlighted on open, when nobody was assigned', () => {
        expect(labels(acceptedItems(base))).toEqual(['jkitchin']);
    });

    it('adds the highlighted person to the current assignees', () => {
        const state = { ...base, selected: [john], initial: [john], active: bob, moved: true };
        expect(labels(acceptedItems(state))).toEqual(['jkitchin', 'bsmith']);
    });

    it('keeps the current assignees on an Enter right after opening', () => {
        const state = { ...base, selected: [alice], initial: [alice], active: john };
        expect(labels(acceptedItems(state))).toEqual(['asmith']);
    });

    it('takes exactly the checked people once the checks change', () => {
        expect(labels(acceptedItems({ ...base, selected: [bob], active: alice, moved: true }))).toEqual(['bsmith']);
        // Unchecking everyone clears the assignee
        expect(acceptedItems({ ...base, initial: [alice], active: bob, moved: true })).toEqual([]);
    });

    it('takes the highlighted match, or the only match, of a typed filter', () => {
        expect(labels(acceptedItems({ ...base, selected: [bob], value: 'smith', active: alice }))).toEqual(['bsmith', 'asmith']);
        expect(labels(acceptedItems({ ...base, value: 'kitch', active: undefined }))).toEqual(['jkitchin']);
    });
});
