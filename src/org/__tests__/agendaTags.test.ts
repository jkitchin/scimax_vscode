/**
 * Tests for heading tag parsing in the agenda.
 *
 * Regression: the indexer stores tags with JSON.stringify, but the agenda's
 * db->item conversion split them on commas. That rendered every tagless item
 * as `:[]:` and a tagged one as `:["taxes"]:` in the agenda buffer and tree.
 */

import { describe, it, expect } from 'vitest';
import { parseHeadingTags } from '../agendaTags';

describe('parseHeadingTags', () => {
    describe('JSON form (what the indexer writes)', () => {
        it('parses an empty array as no tags', () => {
            expect(parseHeadingTags('[]')).toEqual([]);
        });

        it('parses a single tag', () => {
            expect(parseHeadingTags('["taxes"]')).toEqual(['taxes']);
        });

        it('parses multiple tags', () => {
            expect(parseHeadingTags('["work","urgent"]')).toEqual(['work', 'urgent']);
        });

        it('trims whitespace inside tags', () => {
            expect(parseHeadingTags('[" work ", "urgent"]')).toEqual(['work', 'urgent']);
        });

        it('drops empty strings', () => {
            expect(parseHeadingTags('["work","",  "urgent"]')).toEqual(['work', 'urgent']);
        });

        it('ignores non-string array members', () => {
            expect(parseHeadingTags('["work",null,3,"urgent"]')).toEqual(['work', 'urgent']);
        });
    });

    describe('empty and missing input', () => {
        it('handles null', () => {
            expect(parseHeadingTags(null)).toEqual([]);
        });

        it('handles undefined', () => {
            expect(parseHeadingTags(undefined)).toEqual([]);
        });

        it('handles an empty string', () => {
            expect(parseHeadingTags('')).toEqual([]);
        });

        it('handles whitespace only', () => {
            expect(parseHeadingTags('   ')).toEqual([]);
        });
    });

    describe('legacy comma-separated form', () => {
        it('parses a bare single tag', () => {
            expect(parseHeadingTags('work')).toEqual(['work']);
        });

        it('parses comma-separated tags', () => {
            expect(parseHeadingTags('work,urgent')).toEqual(['work', 'urgent']);
        });

        it('trims whitespace around commas', () => {
            expect(parseHeadingTags(' work , urgent ')).toEqual(['work', 'urgent']);
        });
    });

    describe('malformed input', () => {
        it('falls back rather than dropping tags on bad JSON', () => {
            // Truncated JSON must not silently become zero tags.
            expect(parseHeadingTags('["work"')).toEqual(['["work"']);
        });

        it('handles a JSON object by falling back', () => {
            expect(parseHeadingTags('{"a":1}')).toEqual(['{"a":1}']);
        });
    });

    it('never renders the literal brackets that caused the bug', () => {
        for (const raw of ['[]', '["taxes"]', '["work","urgent"]']) {
            for (const tag of parseHeadingTags(raw)) {
                expect(tag).not.toContain('[');
                expect(tag).not.toContain(']');
                expect(tag).not.toContain('"');
            }
        }
    });
});
