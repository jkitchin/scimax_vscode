import { describe, it, expect } from 'vitest';
import { addressListIds, displayAddress, resolveAddress, splitAddresses } from '../addressList';

describe('splitAddresses', () => {
    it('splits on commas and semicolons', () => {
        expect(splitAddresses('a@x.org, b@y.org; c@z.org ,')).toEqual(['a@x.org', 'b@y.org', 'c@z.org']);
        expect(splitAddresses(undefined)).toEqual([]);
    });

    it('keeps commas inside quoted names, angle brackets and org links', () => {
        expect(splitAddresses('"Ramirez, Ana" <ana@x.org>, Bo <bo@y.org>')).toEqual(['"Ramirez, Ana" <ana@x.org>', 'Bo <bo@y.org>']);
        expect(splitAddresses('"A \\"q, r\\"" <a@x.org>,b@y.org')).toEqual(['"A \\"q, r\\"" <a@x.org>', 'b@y.org']);
        expect(splitAddresses('[[mailto:ana@x.org][Ramirez, Ana]]; [[id:42][Bo]]')).toEqual(['[[mailto:ana@x.org][Ramirez, Ana]]', '[[id:42][Bo]]']);
    });
});

describe('resolveAddress', () => {
    it('turns mailto links into Name <address>', () => {
        expect(resolveAddress('[[mailto:ana@x.org][Ana Ramirez]]')).toBe('Ana Ramirez <ana@x.org>');
        expect(resolveAddress('[[mailto:ana@x.org][Ramirez, Ana]]')).toBe('"Ramirez, Ana" <ana@x.org>');
        expect(resolveAddress('[[mailto:ana@x.org?subject=Hi]]')).toBe('ana@x.org');
    });

    it('resolves id links through the id map, else leaves them', () => {
        const ids = new Map([['42', 'bo@y.org']]);
        expect(resolveAddress('[[id:42][Bo]]', ids)).toBe('Bo <bo@y.org>');
        expect(resolveAddress('[[id:43][Cy]]', ids)).toBe('[[id:43][Cy]]');
        expect(resolveAddress('Plain <p@x.org>', ids)).toBe('Plain <p@x.org>');
    });

    it('lists unresolved id links', () => {
        expect(addressListIds('[[id:42][Bo]], a@x.org, [[id:abc]]')).toEqual(['42', 'abc']);
    });

    it('quotes display names RFC 5322 would misread', () => {
        expect(displayAddress('J. Doe', 'j@x.org')).toBe('"J. Doe" <j@x.org>');
        expect(displayAddress('', 'j@x.org')).toBe('j@x.org');
    });
});
