/**
 * Tests for table row parsing — focused on pipe handling inside markup,
 * escapes, and LaTeX math fragments.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    window: {
        createTextEditorDecorationType: vi.fn(() => ({})),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    },
    workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
    languages: { registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })) },
    Range: class {},
    Position: class {},
    Selection: class {},
    EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
}));

import { parseRow } from '../tableProvider';

describe('parseRow', () => {
    it('splits a simple row on pipes', () => {
        expect(parseRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
    });

    it('treats escaped pipes as literal', () => {
        expect(parseRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
    });

    it('keeps pipes inside \\(...\\) inline math', () => {
        expect(parseRow('| Max \\(|P_{seq} - P_{sim}|\\) (bar) | 0.014 |'))
            .toEqual(['Max \\(|P_{seq} - P_{sim}|\\) (bar)', '0.014']);
    });

    it('keeps pipes inside \\[...\\] display math', () => {
        expect(parseRow('| label | \\[a | b\\] | end |'))
            .toEqual(['label', '\\[a | b\\]', 'end']);
    });

    it('falls back to splitting when math is not closed', () => {
        // Unclosed \( should not swallow the rest of the row
        expect(parseRow('| \\(x | y | z |'))
            .toEqual(['\\(x', 'y', 'z']);
    });

    it('keeps pipes inside $...$ inline math', () => {
        expect(parseRow('| label | $|a|b|$ | end |'))
            .toEqual(['label', '$|a|b|$', 'end']);
    });

    it('keeps pipes inside $$...$$ display math', () => {
        expect(parseRow('| x | $$a|b$$ | y |'))
            .toEqual(['x', '$$a|b$$', 'y']);
    });

    it('does not treat a lone $ (like "Profit ($)") as math', () => {
        // Single $ with no closing partner stays literal so the column
        // header "Profit ($)" still splits normally.
        expect(parseRow('| Profit ($) | 10462901 |'))
            .toEqual(['Profit ($)', '10462901']);
    });

    it('does not treat $5 and $6$ as math (border rules)', () => {
        // "$5 and $6" — first $ followed by '5' is fine, but closing-$
        // candidate is preceded by space → fails FORBIDDEN_LAST. Should split.
        expect(parseRow('| $5 and $6 | next |'))
            .toEqual(['$5 and $6', 'next']);
    });
});
