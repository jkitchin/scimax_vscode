import { describe, it, expect } from 'vitest';
import { KillRing } from '../killRing';

describe('KillRing', () => {
    it('stores entries newest first and yanks the head', () => {
        const ring = new KillRing();
        ring.push('a');
        ring.push('b');
        expect(ring.entries()).toEqual(['b', 'a']);
        expect(ring.current()).toBe('b');
    });

    it('ignores empty kills', () => {
        const ring = new KillRing();
        ring.push('');
        expect(ring.length).toBe(0);
        expect(ring.current()).toBeUndefined();
    });

    it('appends and prepends onto the head entry', () => {
        const ring = new KillRing();
        ring.push('one\n');
        ring.push('two\n', 'append');
        ring.push('zero ', 'prepend');
        expect(ring.entries()).toEqual(['zero one\ntwo\n']);
    });

    it('treats append on an empty ring as a new entry', () => {
        const ring = new KillRing();
        ring.push('x', 'append');
        expect(ring.entries()).toEqual(['x']);
    });

    it('drops the oldest entries beyond the max size', () => {
        const ring = new KillRing(() => 3);
        for (const t of ['a', 'b', 'c', 'd']) ring.push(t);
        expect(ring.entries()).toEqual(['d', 'c', 'b']);
    });

    it('rotates toward older entries and wraps around', () => {
        const ring = new KillRing();
        for (const t of ['a', 'b', 'c']) ring.push(t);
        expect(ring.rotate()).toBe('b');
        expect(ring.rotate()).toBe('a');
        expect(ring.rotate()).toBe('c');
        expect(ring.rotate(-1)).toBe('a');
    });

    it('resets the yank pointer to the head on a new kill', () => {
        const ring = new KillRing();
        ring.push('a');
        ring.push('b');
        ring.rotate();
        expect(ring.current()).toBe('a');
        ring.push('c');
        expect(ring.current()).toBe('c');
    });

    it('keeps the pointer on the same entry when removing an earlier one', () => {
        const ring = new KillRing();
        for (const t of ['a', 'b', 'c']) ring.push(t);
        ring.setPointer(2);
        ring.remove(0);
        expect(ring.current()).toBe('a');
        ring.remove(1);
        expect(ring.current()).toBe('b');
    });

    it('clears everything', () => {
        const ring = new KillRing();
        ring.push('a');
        ring.clear();
        expect(ring.length).toBe(0);
        expect(ring.rotate()).toBeUndefined();
    });
});
