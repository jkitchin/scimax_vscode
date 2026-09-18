import { describe, it, expect } from 'vitest';
import { similarTags } from '../utils';

describe('similarTags', () => {
    const existing = ['groupmeeting', 'work', 'research', 'Work', 'ml'];

    it('flags plurals and small typos', () => {
        expect(similarTags('groupmeetings', existing)).toEqual(['groupmeeting']);
        expect(similarTags('grupmeeting', existing)).toEqual(['groupmeeting']);
        expect(similarTags('reserch', existing)).toEqual(['research']);
    });

    it('flags case-only differences', () => {
        expect(similarTags('WORK', existing)).toEqual(['work', 'Work']);
    });

    it('is strict for short tags', () => {
        expect(similarTags('ai', existing)).toEqual([]);
        expect(similarTags('wok', existing)).toEqual(['work', 'Work']);
    });

    it('ignores unrelated tags', () => {
        expect(similarTags('teaching', existing)).toEqual([]);
    });
});
