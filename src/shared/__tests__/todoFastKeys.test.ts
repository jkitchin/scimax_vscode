/**
 * Tests for org-style fast TODO keys (STATE(k)) and per-sequence cycling.
 */

import { describe, it, expect } from 'vitest';
import {
    parseTodoKeywordToken,
    parseTodoKeywordLine,
    parseTodoKeywords,
    nextTodoStateInWorkflow,
    previousTodoStateInWorkflow,
    hasFastTodoKeys,
    DEFAULT_TODO_WORKFLOW,
} from '../todoKeywords';
import { OrgParser } from '../../parser/orgParser';

const JCIM = [
    '#+TODO: INVITED(i) AGREED(a) | REVIEWED(r) DECLINED(d) NORESPONSE(n)',
    '#+TODO: TODO(t) INREVIEW(v) DECIDE(e@/!) | ACCEPTED(A!) REJECTED(R) WITHDRAWN(!)',
    '',
    '* TODO paper',
].join('\n');

describe('parseTodoKeywordToken', () => {
    it('splits state and key', () => {
        expect(parseTodoKeywordToken('TODO(t)')).toEqual({ state: 'TODO', key: 't' });
    });
    it('ignores logging specs after the key', () => {
        expect(parseTodoKeywordToken('WAIT(w@/!)')).toEqual({ state: 'WAIT', key: 'w' });
    });
    it('treats a logging-only spec as no key', () => {
        expect(parseTodoKeywordToken('DONE(!)')).toEqual({ state: 'DONE' });
        expect(parseTodoKeywordToken('DONE(@/!)')).toEqual({ state: 'DONE' });
    });
    it('leaves plain keywords alone', () => {
        expect(parseTodoKeywordToken('DONE')).toEqual({ state: 'DONE' });
    });
});

describe('fast keys in #+TODO lines', () => {
    it('strips suffixes from state names', () => {
        const w = parseTodoKeywordLine('#+TODO: TODO(t) NEXT(n) | DONE(d!) CANCELLED(c@)')!;
        expect(w.activeStates).toEqual(['TODO', 'NEXT']);
        expect(w.doneStates).toEqual(['DONE', 'CANCELLED']);
        expect(w.fastKeys).toEqual({ TODO: 't', NEXT: 'n', DONE: 'd', CANCELLED: 'c' });
    });

    it('merges keys and keeps each line as a sequence', () => {
        const w = parseTodoKeywords(JCIM)!;
        expect(w.sequences).toEqual([
            ['INVITED', 'AGREED', 'REVIEWED', 'DECLINED', 'NORESPONSE'],
            ['TODO', 'INREVIEW', 'DECIDE', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
        ]);
        expect(w.fastKeys!.INVITED).toBe('i');
        expect(w.fastKeys!.ACCEPTED).toBe('A');
        expect(w.fastKeys!.WITHDRAWN).toBeUndefined();
        expect(hasFastTodoKeys(w)).toBe(true);
    });

    it('reports no fast keys for plain lines and the default', () => {
        expect(hasFastTodoKeys(parseTodoKeywords('#+TODO: A B | C')!)).toBe(false);
        expect(hasFastTodoKeys(DEFAULT_TODO_WORKFLOW)).toBe(false);
    });

    it('legacy OrgParser recognises the stripped keyword', () => {
        const doc = new OrgParser().parse(JCIM.replace('* TODO paper', '* INVITED Jane Doe'));
        expect(doc.headings[0].todoState).toBe('INVITED');
        expect(doc.headings[0].title).toBe('Jane Doe');
    });
});

describe('per-sequence cycling', () => {
    const w = parseTodoKeywords(JCIM)!;

    it('starts the first sequence from no keyword', () => {
        expect(nextTodoStateInWorkflow(undefined, w)).toBe('INVITED');
    });
    it('stays within the current sequence', () => {
        expect(nextTodoStateInWorkflow('AGREED', w)).toBe('REVIEWED');
        expect(nextTodoStateInWorkflow('DECIDE', w)).toBe('ACCEPTED');
    });
    it('returns to no keyword after the last state of a sequence', () => {
        expect(nextTodoStateInWorkflow('NORESPONSE', w)).toBe('');
        expect(nextTodoStateInWorkflow('WITHDRAWN', w)).toBe('');
    });
    it('cycles backward within the sequence', () => {
        expect(previousTodoStateInWorkflow('INREVIEW', w)).toBe('TODO');
        expect(previousTodoStateInWorkflow('TODO', w)).toBe('');
        expect(previousTodoStateInWorkflow(undefined, w)).toBe('NORESPONSE');
    });
    it('treats a workflow without sequences as one sequence', () => {
        const flat = { allStates: ['A', 'B'], activeStates: ['A'], doneStates: ['B'] };
        expect(nextTodoStateInWorkflow('A', flat)).toBe('B');
        expect(nextTodoStateInWorkflow('B', flat)).toBe('');
    });
});
