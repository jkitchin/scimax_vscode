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

    describe('source blocks end at #+END_SRC even if the embedded code is unfinished', () => {
        it('closes a python block containing an unclosed triple-quoted string', async () => {
            const tokens = await tokenizeOrg(
                '#+BEGIN_SRC python\n' +
                's = """unclosed\n' +
                '#+END_SRC\n' +
                'after the block'
            );
            expect(hasScopeFor(tokens, 'unclosed', /string\.quoted\.multi\.python/)).toBe(true);
            expect(hasScopeFor(tokens, '#+END_SRC', /keyword\.control\.block\.end\.org/)).toBe(true);
            const after = tokens.filter(t => t.line === 3);
            expect(after.every(t => !t.scopes.some(s => /python|meta\.embedded/.test(s)))).toBe(true);
        });

        it('closes a latex block whose $ opens math that never closes', async () => {
            const tokens = await tokenizeOrg(
                '#+BEGIN_SRC latex\n' +
                '$0\n' +
                '#+END_SRC\n' +
                '1. Select text in the editor'
            );
            expect(hasScopeFor(tokens, '#+END_SRC', /keyword\.control\.block\.end\.org/)).toBe(true);
            const after = tokens.filter(t => t.line === 3);
            expect(after.every(t => !t.scopes.some(s => /tex|meta\.embedded/.test(s)))).toBe(true);
        });
    });

    describe('latex environments and fragments end even if the TeX inside is unfinished', () => {
        // The stub text.tex.latex opens math at "$" and only closes at the next
        // "$", so a stray "$" inside swallows the org closer unless the grammar
        // guards against it.
        const notTex = (tokens: Awaited<ReturnType<typeof tokenizeOrg>>, line: number) =>
            tokens.filter(t => t.line === line).every(t => !t.scopes.some(s => /tex|markup\.math/.test(s)));

        it('closes a \\begin{equation} environment containing a stray $', async () => {
            const tokens = await tokenizeOrg('\\begin{equation}\nx = $y\n\\end{equation}\nafter the math');
            expect(hasScopeFor(tokens, '\\end{', /keyword\.control\.end\.latex\.org/)).toBe(true);
            expect(notTex(tokens, 3)).toBe(true);
        });

        it('closes the outer environment after a nested \\end{cases}', async () => {
            const tokens = await tokenizeOrg(
                '\\begin{align}\n\\begin{cases}\na\n\\end{cases}\nb = $c\n\\end{align}\nafter the math'
            );
            expect(notTex(tokens, 6)).toBe(true);
        });

        it('still runs the TeX grammar on interior lines of an environment', async () => {
            const tokens = await tokenizeOrg('\\begin{equation}\nx = $y$\n\\end{equation}');
            expect(hasScopeFor(tokens, 'y', /meta\.math\.block\.tex/)).toBe(true);
        });

        it('closes a multi-line \\[ fragment containing a stray $', async () => {
            const tokens = await tokenizeOrg('\\[\na $ b\n\\]\nafter the math');
            expect(notTex(tokens, 3)).toBe(true);
        });

        it('closes a multi-line \\( fragment containing a stray $', async () => {
            const tokens = await tokenizeOrg('text \\(\na $ b\n\\) more\nafter the math');
            expect(notTex(tokens, 3)).toBe(true);
        });

        it('closes a multi-line $$ fragment containing a stray $', async () => {
            const tokens = await tokenizeOrg('$$\na $ b\n$$\nafter the math');
            expect(notTex(tokens, 3)).toBe(true);
        });

        it('closes a one-line \\( fragment containing a stray $', async () => {
            const tokens = await tokenizeOrg('see \\( a $ b \\) here\nafter the math');
            expect(hasScopeFor(tokens, ' here', /markup\.math/)).toBe(false);
            expect(notTex(tokens, 1)).toBe(true);
        });

        it('still colors TeX commands in a one-line fragment', async () => {
            const tokens = await tokenizeOrg('see \\( \\alpha + 1 \\) here');
            expect(hasScopeFor(tokens, 'alpha', /support\.function/)).toBe(true);
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

    describe('multi-line emphasis cannot run away past one line break', () => {
        it('does not strike a paragraph after a signed number like (+0.56, damping)', async () => {
            // From a real document: "+0.56" is a sign, not a strikethrough
            // opener. Previously the multi-line rule opened here and struck
            // every following line until a blank line.
            const tokens = await tokenizeOrg(
                'bounds are [-5, 0], which clip the required factor (+0.56, damping)\n' +
                'to zero, reducing the iteration to direct substitution, which\n' +
                'diverges into complex pressures. Setting =accel_max = 0.9= fixed it.'
            );
            expect(hasScopeFor(tokens, '0.56', /markup\.strikethrough/)).toBe(false);
            expect(hasScopeFor(tokens, 'to zero', /markup\.strikethrough/)).toBe(false);
            expect(hasScopeFor(tokens, 'diverges', /markup\.strikethrough/)).toBe(false);
        });

        it('does not strike plus-minus notation like (+-1).', async () => {
            // "+-1" is plus-minus notation, not a strikethrough opener. The
            // unclosed + used to strike the rest of its line ("-1).").
            const tokens = await tokenizeOrg(
                'the count can be off by one (+-1).\n' +
                'and the next line stays plain'
            );
            expect(hasScopeFor(tokens, '-1', /markup\.strikethrough/)).toBe(false);
            expect(hasScopeFor(tokens, 'next line', /markup\.strikethrough/)).toBe(false);
        });

        it('does not strike a (+/-0.5) tolerance', async () => {
            const tokens = await tokenizeOrg('a tolerance of (+/-0.5) on the reading\nsecond line plain');
            expect(hasScopeFor(tokens, '0.5', /markup\.strikethrough/)).toBe(false);
            expect(hasScopeFor(tokens, 'on the reading', /markup\.strikethrough/)).toBe(false);
        });

        it('still strikes a closed same-line +-1+ span', async () => {
            // Emacs fontifies a properly closed span even when the content
            // leads with a sign; only the multi-line fallback is restricted.
            const tokens = await tokenizeOrg('inline +-1+ stays struck');
            expect(hasScopeFor(tokens, '-1', /markup\.strikethrough/)).toBe(true);
        });

        it('stops an unclosed +strike opener at the first line break', async () => {
            const tokens = await tokenizeOrg(
                'a stray +opener with no closer at all\n' +
                'second line must stay plain\n' +
                'third line also plain'
            );
            for (const lineNo of [1, 2]) {
                const lineTokens = tokens.filter(t => t.line === lineNo);
                expect(lineTokens.every(t => !t.scopes.some(s => /markup\.strikethrough/.test(s)))).toBe(true);
            }
        });

        it('still strikes a +phrase+ closed on the next line (hard-wrapped prose)', async () => {
            const tokens = await tokenizeOrg('this is +struck text that\nwraps here+ then plain again');
            expect(hasScopeFor(tokens, 'struck text that', /markup\.strikethrough/)).toBe(true);
            expect(hasScopeFor(tokens, 'wraps here', /markup\.strikethrough/)).toBe(true);
            expect(hasScopeFor(tokens, 'then plain again', /markup\.strikethrough/)).toBe(false);
        });

        it('stops an unclosed italic opener like /usr/local at the first line break', async () => {
            const tokens = await tokenizeOrg(
                'the binaries live in /usr/local on most systems\n' +
                'and the second line stays plain'
            );
            const secondLine = tokens.filter(t => t.line === 1);
            expect(secondLine.every(t => !t.scopes.some(s => /markup\.italic/.test(s)))).toBe(true);
        });

        it('stops an unclosed _underline opener at the first line break', async () => {
            const tokens = await tokenizeOrg(
                'an identifier like _internal with no closer\n' +
                'next line stays plain'
            );
            const secondLine = tokens.filter(t => t.line === 1);
            expect(secondLine.every(t => !t.scopes.some(s => /markup\.underline/.test(s)))).toBe(true);
        });

        it('stops an unclosed *bold opener at the first line break', async () => {
            const tokens = await tokenizeOrg(
                'a stray *asterisk with no closer\n' +
                'next line stays plain\n' +
                'and the one after that'
            );
            for (const lineNo of [1, 2]) {
                const lineTokens = tokens.filter(t => t.line === lineNo);
                expect(lineTokens.every(t => !t.scopes.some(s => /markup\.bold/.test(s)))).toBe(true);
            }
        });
    });

    it('sanity: a closed multi-line bold reports only bold markup scopes', async () => {
        const tokens = await tokenizeOrg('this is *bold* text');
        expect(markupScopesFor(tokens, 'bold')).toContain('markup.bold.content.org');
    });
});
