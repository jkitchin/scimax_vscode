import { describe, it, expect } from 'vitest';

import { priorityCycleEdit } from '../priorityCookie';

function apply(line: string, edit: { start: number; end: number; text: string } | null): string | null {
    return edit ? line.slice(0, edit.start) + edit.text + line.slice(edit.end) : null;
}

const STATES = new Set(['TODO', 'DONE']);

describe('priorityCycleEdit', () => {
    it('inserts a cookie after the TODO keyword', () => {
        expect(apply('* TODO Title', priorityCycleEdit('* TODO Title', false, STATES, 'up'))).toBe('* TODO [#C] Title');
        expect(apply('** Title', priorityCycleEdit('** Title', false, STATES, 'down'))).toBe('** [#A] Title');
    });

    it('honors custom workflow keywords', () => {
        const states = new Set(['WIP', 'DONE']);
        expect(apply('* WIP Draft', priorityCycleEdit('* WIP Draft', false, states, 'up'))).toBe('* WIP [#C] Draft');
    });

    it('works on Markdown headings', () => {
        expect(apply('## TODO Task', priorityCycleEdit('## TODO Task', true, STATES, 'up'))).toBe('## TODO [#C] Task');
    });

    it('replaces and removes an existing cookie', () => {
        expect(apply('* TODO [#B] x', priorityCycleEdit('* TODO [#B] x', false, STATES, 'up'))).toBe('* TODO [#A] x');
        expect(apply('* TODO [#A] x', priorityCycleEdit('* TODO [#A] x', false, STATES, 'up'))).toBe('* TODO x');
    });

    it('returns null off a heading', () => {
        expect(priorityCycleEdit('plain text', false, STATES, 'up')).toBeNull();
        expect(priorityCycleEdit('# comment', false, STATES, 'up')).toBeNull();
    });
});
