import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
    class Position { constructor(public line: number, public character: number) {} }
    class Range { constructor(public start: Position, public end: Position) {} }
    class SnippetString { constructor(public value: string) {} }
    class CompletionItem {
        insertText?: SnippetString;
        range?: Range;
        constructor(public label: string, public kind?: number) {}
    }
    class CompletionList {
        constructor(public items: CompletionItem[], public isIncomplete = false) {}
    }
    return {
        Position, Range, SnippetString, CompletionItem, CompletionList,
        CompletionItemKind: { Snippet: 1, Keyword: 2, Text: 3, Property: 4, Value: 5, Reference: 6, EnumMember: 7 },
        languages: { registerCompletionItemProvider: vi.fn() },
    };
});

import * as vscode from 'vscode';
import { OrgCompletionProvider } from '../completionProvider';

/** Ask the provider for completions with the cursor at the end of the last line. */
function complete(text: string) {
    const lines = text.split('\n');
    const document = {
        lineAt: (n: number) => ({ text: lines[n] }),
        getText: () => text,
        uri: { toString: () => 'file:///test.org' },
    } as unknown as vscode.TextDocument;
    const position = new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    const result = new OrgCompletionProvider().provideCompletionItems(
        document, position, {} as vscode.CancellationToken, {} as vscode.CompletionContext
    );
    return Array.isArray(result) ? { items: result, isIncomplete: false } : result;
}

const inserts = (items: vscode.CompletionItem[]) =>
    items.map(i => (i.insertText as vscode.SnippetString | undefined)?.value);

describe('line-start shortcuts', () => {
    it('offers ti -> #+TITLE: from the first letter, so VS Code keeps it after "i"', () => {
        const result = complete('t');
        expect(inserts(result.items)).toContain('#+TITLE: $0');
        expect(result.isIncomplete).toBe(true);
    });

    it('still offers it for the full prefix, replacing the typed text', () => {
        const result = complete('  ti');
        const item = result.items.find(i => i.label === 'ti')!;
        expect((item.insertText as vscode.SnippetString).value).toBe('#+TITLE: $0');
        const range = item.range as vscode.Range;
        expect(range.start.character).toBe(2);
        expect(range.end.character).toBe(4);
    });

    it('offers nothing once the word no longer matches a shortcut', () => {
        const result = complete('tim');
        expect(result.items.some(i => i.label === 'ti')).toBe(false);
        expect(result.isIncomplete).toBe(false);
    });

    it('offers Python snippets from a partial prefix inside a Python block', () => {
        const result = complete('#+BEGIN_SRC python\npl');
        expect(result.items.map(i => i.label)).toEqual(expect.arrayContaining(['plt', 'pl']));
        expect(result.isIncomplete).toBe(true);
    });

    it('does not offer Python snippets outside a Python block', () => {
        const result = complete('pl');
        expect(result.items.some(i => i.label === 'plt')).toBe(false);
    });
});
