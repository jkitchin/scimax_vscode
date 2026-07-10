/**
 * Tests for zotero formatCitation (issue #47 audit, item E1).
 *
 * Bug: the LaTeX branch read a nonexistent setting `scimax.ref.latexCiteStyle`
 * and so always emitted \cite{}, ignoring the user's configured citation
 * style. The fix reads the registered `scimax.ref.defaultCiteStyle`. These
 * tests pin the style/syntax behavior across languages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const configValues: Record<string, string | undefined> = {};

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: vi.fn((section?: string) => ({
            get: vi.fn((key: string, defaultValue?: any) => {
                const full = `${section}.${key}`;
                return full in configValues ? configValues[full] : defaultValue;
            }),
        })),
    },
}));

import { formatCitation } from '../commands';

describe('zotero formatCitation', () => {
    beforeEach(() => {
        for (const k of Object.keys(configValues)) delete configValues[k];
    });

    it('LaTeX: honors defaultCiteStyle (regression for E1)', () => {
        configValues['scimax.ref.defaultCiteStyle'] = 'citet';
        expect(formatCitation(['a', 'b'], 'latex')).toBe('\\citet{a,b}');
    });

    it('LaTeX: falls back to \\cite when defaultCiteStyle is unset', () => {
        expect(formatCitation(['a'], 'latex')).toBe('\\cite{a}');
    });

    it('LaTeX: uses citep when configured', () => {
        configValues['scimax.ref.defaultCiteStyle'] = 'citep';
        expect(formatCitation(['x'], 'latex')).toBe('\\citep{x}');
    });

    it('Markdown: emits pandoc-style [@a; @b]', () => {
        expect(formatCitation(['a', 'b'], 'markdown')).toBe('[@a; @b]');
    });

    it('Org v3 (default): emits cite:&a;&b', () => {
        expect(formatCitation(['a', 'b'], 'org')).toBe('cite:&a;&b');
    });

    it('Org v3: honors defaultCiteStyle', () => {
        configValues['scimax.ref.defaultCiteStyle'] = 'citet';
        expect(formatCitation(['a', 'b'], 'org')).toBe('citet:&a;&b');
    });

    it('Org v2: emits comma-separated bare keys', () => {
        configValues['scimax.ref.citationSyntax'] = 'org-ref-v2';
        expect(formatCitation(['a', 'b'], 'org')).toBe('cite:a,b');
    });
});
