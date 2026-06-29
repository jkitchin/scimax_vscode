/**
 * TextMate grammar tests for org fontification (syntaxes/org.tmLanguage.json).
 *
 * Tokenizes with the same engine VS Code uses, so these assert on the actual
 * editor highlighting behavior. Regression focus: an unclosed raw marker
 * (`~` code / `=` verbatim) used as ordinary technical notation ("~270x",
 * "n = 2") must NOT open a span that runs away across lines, while legitimate
 * single-line raw spans and multi-line *bold/italic* (which wrap in hard-wrapped
 * prose) must still highlight.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeOrg, hasScopeFor, markupScopesFor } from './grammarTestUtils';

describe('org TextMate grammar', () => {
    describe('raw markers (~ code, = verbatim) do not run away', () => {
        it('treats "~270x" (approximately) as plain text, not inline code', async () => {
            // Hard-wrapped: the ~ has no closer on its line. Previously the
            // multi-line code rule opened here and consumed everything after it.
            const tokens = await tokenizeOrg(
                'explicit Schur solve that is ~270x faster than a generic sparse\n' +
                'factorization. Despite this, we find that it is *not* the case'
            );
            expect(hasScopeFor(tokens, '270x', /markup\.inline\.raw/)).toBe(false);
        });

        it('still bolds emphasis that follows a stray ~ on a later line', async () => {
            // The runaway used to swallow this *not* into the code span.
            const tokens = await tokenizeOrg(
                'a value that is ~270x faster than before\n' +
                'and this is *not* where it wins'
            );
            expect(hasScopeFor(tokens, 'not', /markup\.bold/)).toBe(true);
        });

        it('does not open a code span at a parenthesized approx like (~10^{-15})', async () => {
            const tokens = await tokenizeOrg(
                'conserve mass to machine precision (~10^{-15}) and run faster\n' +
                'than penalty-based first-order training every time'
            );
            expect(hasScopeFor(tokens, '10^{-15}', /markup\.inline\.raw/)).toBe(false);
        });

        it('does not treat "n = 2" prose as verbatim', async () => {
            const tokens = await tokenizeOrg('we set n = 2 and then m = 3 across\nthe remaining lines of text');
            expect(hasScopeFor(tokens, '2', /markup\.raw\.verbatim/)).toBe(false);
        });
    });

    describe('single-line raw markup still works', () => {
        it('highlights ~code~ as inline raw', async () => {
            const tokens = await tokenizeOrg('use the ~printf~ function here');
            expect(hasScopeFor(tokens, 'printf', /markup\.inline\.raw/)).toBe(true);
        });

        it('highlights =verbatim= as raw verbatim', async () => {
            const tokens = await tokenizeOrg('the value =x= is set');
            expect(hasScopeFor(tokens, 'x', /markup\.raw\.verbatim/)).toBe(true);
        });
    });

    describe('multi-line emphasis (needed for hard-wrapped prose)', () => {
        it('bolds a *phrase* that wraps across a hard line break', async () => {
            const tokens = await tokenizeOrg('models *nonlinear in their\nparameters*: for models linear');
            // Both halves of the wrapped bold phrase carry the bold scope.
            expect(hasScopeFor(tokens, 'nonlinear in their', /markup\.bold/)).toBe(true);
            expect(hasScopeFor(tokens, 'parameters', /markup\.bold/)).toBe(true);
        });
    });

    describe('raw markers do NOT span line breaks (the fix)', () => {
        it('does not extend a ~ code span onto the next line', async () => {
            const tokens = await tokenizeOrg('opening ~tilde with no close here\nsecond line stays plain');
            const secondLine = tokens.filter(t => t.line === 1);
            expect(secondLine.every(t => !t.scopes.some(s => /markup\.inline\.raw/.test(s)))).toBe(true);
        });

        it('does not extend a = verbatim span onto the next line', async () => {
            const tokens = await tokenizeOrg('opening =equals with no close here\nsecond line stays plain');
            const secondLine = tokens.filter(t => t.line === 1);
            expect(secondLine.every(t => !t.scopes.some(s => /markup\.raw\.verbatim/.test(s)))).toBe(true);
        });
    });

    it('sanity: a closed multi-line bold reports only bold markup scopes', async () => {
        const tokens = await tokenizeOrg('this is *bold* text');
        expect(markupScopesFor(tokens, 'bold')).toContain('markup.bold.content.org');
    });
});
