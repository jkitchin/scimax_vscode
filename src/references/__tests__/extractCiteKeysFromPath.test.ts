/**
 * Tests for extractCiteKeysFromPath (issue #47 audit, item A2).
 *
 * This helper was extracted to de-duplicate identical key-parsing logic that
 * lived in both scimaxOrg (link following) and orgLinkProvider (document
 * links). Following a cite: link used to invoke a command that did not exist;
 * the fix parses the keys and jumps to the bib entry, so the parser must be
 * correct for v2 and v3 org-ref syntaxes.
 */

import { describe, it, expect } from 'vitest';
import { extractCiteKeysFromPath } from '../citationParser';

describe('extractCiteKeysFromPath', () => {
    it('parses org-ref v3 &-prefixed keys', () => {
        expect(extractCiteKeysFromPath('&key1;&key2')).toEqual(['key1', 'key2']);
    });

    it('parses a single v3 key', () => {
        expect(extractCiteKeysFromPath('&key1')).toEqual(['key1']);
    });

    it('parses v3 with a prefix note before the key', () => {
        expect(extractCiteKeysFromPath('see;&key1')).toEqual(['key1']);
    });

    it('parses org-ref v2 comma-separated keys', () => {
        expect(extractCiteKeysFromPath('key1,key2')).toEqual(['key1', 'key2']);
    });

    it('parses a single v2 key', () => {
        expect(extractCiteKeysFromPath('key1')).toEqual(['key1']);
    });

    it('trims whitespace around v2 keys', () => {
        expect(extractCiteKeysFromPath('key1, key2 , key3')).toEqual(['key1', 'key2', 'key3']);
    });

    it('keeps keys containing colons and hyphens', () => {
        expect(extractCiteKeysFromPath('&kitchin-2015:abc')).toEqual(['kitchin-2015:abc']);
    });

    it('returns [] for an empty path', () => {
        expect(extractCiteKeysFromPath('')).toEqual([]);
    });

    it('drops empty comma segments', () => {
        expect(extractCiteKeysFromPath('key1,,key2,')).toEqual(['key1', 'key2']);
    });
});
