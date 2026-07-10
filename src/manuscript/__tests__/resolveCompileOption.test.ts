/**
 * Tests for resolveCompileOption (issue #47 audit, item D3).
 *
 * The scimax.manuscript.autoCompile setting was registered but ignored — the
 * flatten command always prompted. The mapping from the setting (+ whether the
 * .bbl is stale) to a compile decision is now a pure function; these tests
 * cover all combinations.
 */

import { describe, it, expect } from 'vitest';
import { resolveCompileOption } from '../types';

describe('resolveCompileOption', () => {
    it('always -> compile unconditionally, regardless of staleness', () => {
        expect(resolveCompileOption('always', true)).toBe(true);
        expect(resolveCompileOption('always', false)).toBe(true);
    });

    it('never -> never compile, regardless of staleness', () => {
        expect(resolveCompileOption('never', true)).toBe(false);
        expect(resolveCompileOption('never', false)).toBe(false);
    });

    it('if-needed -> defer to the flattener, no prompt', () => {
        expect(resolveCompileOption('if-needed', true)).toBe('if-needed');
        expect(resolveCompileOption('if-needed', false)).toBe('if-needed');
    });

    it('ask -> prompt only when the .bbl is stale', () => {
        expect(resolveCompileOption('ask', true)).toBe('prompt');
        expect(resolveCompileOption('ask', false)).toBe('if-needed');
    });

    it('unknown/unset value behaves like ask', () => {
        expect(resolveCompileOption('bogus', true)).toBe('prompt');
        expect(resolveCompileOption('bogus', false)).toBe('if-needed');
    });
});
