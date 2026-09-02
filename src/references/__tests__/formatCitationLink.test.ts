/**
 * Tests for citation insertion formatting, including the plain vs bracketed
 * org-ref link style (issue #55: round-tripping with Emacs org-ref/scimax).
 */

import { describe, it, expect } from 'vitest';
import { formatCitationLink } from '../bibtexParser';

describe('formatCitationLink', () => {
    describe('org-ref v3', () => {
        it('inserts a plain link by default', () => {
            expect(formatCitationLink('key', 'cite', 'org')).toBe('cite:&key');
        });

        it('inserts a bracketed link when asked', () => {
            expect(formatCitationLink('key', 'cite', 'org', undefined, undefined, 'org-ref-v3', 'bracketed'))
                .toBe('[[cite:&key]]');
            expect(formatCitationLink('key', 'citep', 'org', undefined, undefined, 'org-ref-v3', 'bracketed'))
                .toBe('[[citep:&key]]');
        });

        it('always brackets a citation carrying notes, which contain spaces', () => {
            expect(formatCitationLink('key', 'citep', 'org', undefined, 'p. 5'))
                .toBe('[[citep:&key p. 5]]');
            expect(formatCitationLink('key', 'citep', 'org', 'see', 'p. 5'))
                .toBe('[[citep:see;&key p. 5]]');
        });

        it('keeps a prenote-only citation in the configured link style', () => {
            expect(formatCitationLink('key', 'citep', 'org', 'see'))
                .toBe('citep:see;&key');
            expect(formatCitationLink('key', 'citep', 'org', 'see', undefined, 'org-ref-v3', 'bracketed'))
                .toBe('[[citep:see;&key]]');
        });
    });

    describe('org-ref v2', () => {
        it('honors the link style', () => {
            expect(formatCitationLink('key', 'cite', 'org', undefined, undefined, 'org-ref-v2'))
                .toBe('cite:key');
            expect(formatCitationLink('key', 'cite', 'org', undefined, undefined, 'org-ref-v2', 'bracketed'))
                .toBe('[[cite:key]]');
        });
    });

    describe('org-cite', () => {
        it('ignores the link style - it has its own brackets', () => {
            expect(formatCitationLink('key', 'cite', 'org', undefined, undefined, 'org-cite', 'bracketed'))
                .toBe('[cite:@key]');
            expect(formatCitationLink('key', 'citet', 'org', undefined, undefined, 'org-cite', 'bracketed'))
                .toBe('[cite/t:@key]');
            expect(formatCitationLink('key', 'citeauthor', 'org', undefined, undefined, 'org-cite'))
                .toBe('[cite/a:@key]');
        });
    });

    describe('other formats', () => {
        it('is unaffected in LaTeX and Markdown', () => {
            expect(formatCitationLink('key', 'citep', 'latex', undefined, undefined, 'org-ref-v3', 'bracketed'))
                .toBe('\\citep{key}');
            expect(formatCitationLink('key', 'cite', 'markdown', undefined, undefined, 'org-ref-v3', 'bracketed'))
                .toBe('[@key]');
        });
    });
});
