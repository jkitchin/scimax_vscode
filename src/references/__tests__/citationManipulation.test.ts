/**
 * Tests for citation manipulation helpers (transpose/sort support code).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    Disposable: class { constructor(private cb: () => void) {} dispose() { this.cb(); } },
    commands: { registerCommand: () => ({ dispose: () => undefined }) },
    window: {},
}));

import { findCitationAtPosition } from '../citationManipulation';

describe('citation manipulation - findCitationAtPosition', () => {
    it('describes a plain org-ref citation', () => {
        const line = 'See cite:&a;&b for details.';
        const info = findCitationAtPosition(line, 10)!;
        expect(info.prefix).toBe('cite:');
        expect(info.suffix).toBe('');
        expect(info.keys).toEqual(['a', 'b']);
        expect(line.slice(info.start, info.end)).toBe('cite:&a;&b');
    });

    it('describes a bracketed org-ref link (issue #55)', () => {
        const line = 'See [[citep:&a;&b]] for details.';
        const info = findCitationAtPosition(line, 12)!;
        expect(info.prefix).toBe('[[citep:');
        expect(info.suffix).toBe(']]');
        expect(info.keys).toEqual(['a', 'b']);
        expect(info.prefix + info.keys.map(k => '&' + k).join(';') + info.suffix)
            .toBe('[[citep:&a;&b]]');
        expect(line.slice(info.start, info.end)).toBe('[[citep:&a;&b]]');
    });

    it('keeps a link description in the suffix', () => {
        const info = findCitationAtPosition('[[cite:&a][see]]', 9)!;
        expect(info.prefix).toBe('[[cite:');
        expect(info.suffix).toBe('][see]]');
    });

    it('describes an org-cite citation', () => {
        const info = findCitationAtPosition('[cite/t:@a;@b]', 9)!;
        expect(info.prefix).toBe('[cite/t:');
        expect(info.suffix).toBe(']');
        expect(info.keys).toEqual(['a', 'b']);
    });
});
