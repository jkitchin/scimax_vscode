import { describe, it, expect, vi } from 'vitest';
const state: any = { editor: undefined };
vi.mock('vscode', () => {
    class Position { constructor(public line: number, public character: number) {} }
    class Range { start: any; end: any; constructor(a: any, b: any, c?: any, d?: any) {
        if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } }
    class Selection extends Range { active: any; constructor(a: any, b: any) { super(a, b); this.active = b; } }
    return {
        window: {
            createTextEditorDecorationType: vi.fn(() => ({ dispose() {} })),
            showInformationMessage: vi.fn(), showWarningMessage: vi.fn(),
            get activeTextEditor() { return state.editor; },
            onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
            onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
        },
        workspace: { getConfiguration: vi.fn(() => ({ get: (_k: string, d: any) => d })), onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })) },
        commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
        languages: { registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })) },
        Range, Position, Selection,
        EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
    };
});
import * as vscode from 'vscode';
import { alignTable, nextCell } from '../tableProvider';

function makeEditor(text: string, line: number, ch: number) {
    let lines = text.split('\n');
    const document: any = {
        languageId: 'org',
        get lineCount() { return lines.length; },
        lineAt: (n: number) => ({ text: lines[n] }),
        getText: () => lines.join('\n'),
    };
    const editor: any = {
        document,
        selection: new (vscode as any).Selection(new (vscode as any).Position(line, ch), new (vscode as any).Position(line, ch)),
        selections: [],
        setDecorations: () => {},
        edit: async (cb: any) => {
            cb({ replace: (r: any, t: string) => {
                const before = lines.slice(0, r.start.line); const after = lines.slice(r.end.line + 1);
                const head = lines[r.start.line].slice(0, r.start.character); const tail = lines[r.end.line].slice(r.end.character);
                lines = [...before, ...(head + t + tail).split('\n'), ...after];
            }, insert: (p: any, t: string) => {
                const l = lines[p.line] ?? ''; const s = l.slice(0, p.character) + t + l.slice(p.character);
                lines.splice(p.line, p.line < lines.length ? 1 : 0, ...s.split('\n'));
            } });
            return true;
        },
    };
    state.editor = editor;
    return { editor, text: () => lines.join('\n') };
}

const pos = (e: any) => [e.selection.active.line, e.selection.active.character];

describe('table Tab and alignment', () => {
    it('treats a row without its closing | as part of the table', async () => {
        const t = makeEditor('| a | bbbbb |\n| new', 1, 5);
        expect(await nextCell()).toBe(true);
        expect(t.text()).toBe('| a   | bbbbb |\n| new |       |');
        expect(pos(t.editor)).toEqual([1, 8]);
    });

    it('expands a |- separator when aligning', async () => {
        const t = makeEditor('| a | bbbbb |\n|-\n| ccc | d |', 0, 2);
        expect(await alignTable()).toBe(true);
        expect(t.text()).toBe('| a   | bbbbb |\n|-----+-------|\n| ccc | d     |');
    });

    it('moves to the next cell when aligning shifts the cells left', async () => {
        // Cursor after "b"; aligning removes the padding in the first cell
        const t = makeEditor('| a        | b | c |\n| x | y | z |', 0, 14);
        expect(await nextCell()).toBe(true);
        expect(t.text().split('\n')[0]).toBe('| a | b | c |');
        expect(pos(t.editor)).toEqual([0, 10]);
    });

    it('goes to the next row from the last cell', async () => {
        const t = makeEditor('| a | b |\n| c | d |', 0, 7);
        expect(await nextCell()).toBe(true);
        expect(pos(t.editor)).toEqual([1, 2]);
    });
});

describe('table alignment with descriptive links', () => {
    it('measures links as displayed, so the collapsed table lines up', async () => {
        // [[cmd:x]] displays as "cmd:x" (5 wide), the same as "hello"
        const t = makeEditor('| [[cmd:x]] | a |\n| hello | b |', 0, 2);
        expect(await alignTable()).toBe(true);
        expect(t.text()).toBe('| [[cmd:x]] | a |\n| hello | b |');
    });

    it('measures a described link by its description', async () => {
        const t = makeEditor('| [[https://example.com][ex]] | a |\n| abcd | b |', 0, 2);
        expect(await alignTable()).toBe(true);
        expect(t.text().split('\n')[1]).toBe('| abcd | b |');
        expect(t.text().split('\n')[0]).toBe('| [[https://example.com][ex]]   | a |');
    });
});
