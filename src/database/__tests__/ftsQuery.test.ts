import { describe, it, expect } from 'vitest';
import { normalizeFtsQuery } from '../ftsQuery';

describe('normalizeFtsQuery', () => {
    it('quotes words FTS5 would read as syntax', () => {
        expect(normalizeFtsQuery('kitchin-2025-beyon-fourt')).toBe('"kitchin-2025-beyon-fourt"');
        expect(normalizeFtsQuery('cite:&key')).toBe('"cite:&key"');
        expect(normalizeFtsQuery('c++')).toBe('"c++"');
    });

    it('leaves plain words and operators alone', () => {
        expect(normalizeFtsQuery('neural network')).toBe('neural network');
        expect(normalizeFtsQuery('python AND NOT java')).toBe('python AND NOT java');
        expect(normalizeFtsQuery('café')).toBe('café');
    });

    it('keeps phrases, prefixes, initial tokens and column filters', () => {
        expect(normalizeFtsQuery('"machine learning"')).toBe('"machine learning"');
        expect(normalizeFtsQuery('optim*')).toBe('optim*');
        expect(normalizeFtsQuery('^intro')).toBe('^intro');
        expect(normalizeFtsQuery('title:notes')).toBe('title:notes');
        expect(normalizeFtsQuery('title:e-mail')).toBe('title:"e-mail"');
    });

    it('keeps NEAR groups and parentheses', () => {
        expect(normalizeFtsQuery('NEAR(neural network, 5)')).toBe('NEAR(neural network, 5)');
        expect(normalizeFtsQuery('(a OR b) AND c')).toBe('(a OR b) AND c');
    });

    it('accepts a space after a column name', () => {
        expect(normalizeFtsQuery('title: introduction')).toBe('title:introduction');
        expect(normalizeFtsQuery('title:')).toBe('title');
        expect(normalizeFtsQuery('title: (a OR b)')).toBe('title:(a OR b)');
    });

    it('repairs half-typed input', () => {
        expect(normalizeFtsQuery('(paren')).toBe('(paren)');
        expect(normalizeFtsQuery('a) b')).toBe('a b');
        expect(normalizeFtsQuery('neural AND')).toBe('neural');
        expect(normalizeFtsQuery('OR neural')).toBe('neural');
        expect(normalizeFtsQuery('NEAR(')).toBe('');
    });

    it('closes an unterminated phrase and escapes quotes', () => {
        expect(normalizeFtsQuery('"machine learn')).toBe('"machine learn"');
        expect(normalizeFtsQuery('say"hi')).toBe('say "hi"');
    });
});
