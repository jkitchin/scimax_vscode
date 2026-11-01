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
import {
    alignTable, nextCell, insertRowBelow, insertRowAbove, deleteRow, moveRowUp, moveRowDown,
    insertSeparator, insertColumnLeft, insertColumnRight, deleteColumn, moveColumnLeft, moveColumnRight,
} from '../tableProvider';

function makeEditor(text: string, line: number, ch: number, languageId = 'markdown') {
    let lines = text.split('\n');
    const document: any = {
        languageId,
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
            }, delete: (r: any) => {
                // Whole-line deletes only (start.line .. end.line, character 0)
                lines.splice(r.start.line, r.end.line - r.start.line);
            } });
            return true;
        },
    };
    state.editor = editor;
    return { editor, text: () => lines.join('\n') };
}

const pos = (e: any) => [e.selection.active.line, e.selection.active.character];

const GFM = [
    '| Left | Center | Right | None |',
    '|:-----|:---:|------:|---|',
    '| a | b | c | d |',
    '| eeee | ffffffff | g | h |',
].join('\n');

describe('GFM delimiter row alignment', () => {
    it('keeps alignment colons when realigning and pads cells by alignment', async () => {
        const t = makeEditor(GFM, 2, 2);
        expect(await alignTable()).toBe(true);
        expect(t.text()).toBe([
            '| Left |  Center  | Right | None |',
            '|:-----|:--------:|------:|------|',
            '| a    |    b     |     c | d    |',
            '| eeee | ffffffff |     g | h    |',
        ].join('\n'));
    });

    it('keeps colons through Tab, and for quarto documents', async () => {
        const t = makeEditor(GFM, 2, 2, 'quarto');
        expect(await nextCell()).toBe(true);
        expect(t.text().split('\n')[1]).toBe('|:-----|:--------:|------:|------|');
    });

    it('handles a spaced delimiter row', async () => {
        const t = makeEditor('| a | b |\n| :-- | --: |\n| x | y |', 0, 2);
        expect(await alignTable()).toBe(true);
        expect(t.text()).toBe('| a | b |\n|:--|--:|\n| x | y |');
    });

    it('moves alignment with a column moved right and left', async () => {
        const t = makeEditor(GFM, 2, 2);
        expect(await moveColumnRight()).toBe(true);
        expect(t.text().split('\n')[1]).toBe('|:--------:|:-----|------:|------|');
        const t2 = makeEditor(GFM, 2, 14);
        expect(await moveColumnLeft()).toBe(true);
        expect(t2.text().split('\n')[1]).toBe('|:-----|:--------:|------|------:|');
    });

    it('gives an inserted column no alignment and keeps the others', async () => {
        const t = makeEditor(GFM, 2, 2);
        expect(await insertColumnRight()).toBe(true);
        const lines = t.text().split('\n');
        expect(lines[1]).toBe('|:-----|-----|:--------:|------:|------|');
        const t2 = makeEditor(GFM, 2, 2);
        expect(await insertColumnLeft()).toBe(true);
        expect(t2.text().split('\n')[1]).toBe('|-----|:-----|:--------:|------:|------|');
    });

    it('drops the alignment of a deleted column', async () => {
        const t = makeEditor(GFM, 2, 2);
        expect(await deleteColumn()).toBe(true);
        expect(t.text().split('\n')[1]).toBe('|:--------:|------:|------|');
    });

    it('leaves org separators unchanged', async () => {
        const t = makeEditor('| a | b |\n|---+---|\n| x | y |', 0, 2, 'org');
        expect(await alignTable()).toBe(true);
        expect(t.text()).toBe('| a | b |\n|---+---|\n| x | y |');
    });
});

describe('GFM header row structure', () => {
    const T = '| h1 | h2 |\n|----|----|\n| a  | b  |\n| c  | d  |';

    it('inserts below the delimiter when inserting below the header', async () => {
        const t = makeEditor(T, 0, 2);
        expect(await insertRowBelow()).toBe(true);
        expect(t.text().split('\n')).toEqual(['| h1 | h2 |', '|----|----|', '|    |    |', '| a  | b  |', '| c  | d  |']);
        expect(pos(t.editor)[0]).toBe(2);
    });

    it('inserts below the header in org as before', async () => {
        const t = makeEditor('| h1 | h2 |\n|----+----|\n| a  | b  |', 0, 2, 'org');
        expect(await insertRowBelow()).toBe(true);
        expect(t.text().split('\n')[1]).toBe('|    |    |');
    });

    it('inserts above the delimiter as the first body row', async () => {
        const t = makeEditor(T, 1, 2);
        expect(await insertRowAbove()).toBe(true);
        expect(t.text().split('\n')).toEqual(['| h1 | h2 |', '|----|----|', '|    |    |', '| a  | b  |', '| c  | d  |']);
        expect(pos(t.editor)[0]).toBe(2);
    });

    it('inserts above the first body row after the delimiter', async () => {
        const t = makeEditor(T, 2, 2);
        expect(await insertRowAbove()).toBe(true);
        expect(t.text().split('\n').slice(0, 3)).toEqual(['| h1 | h2 |', '|----|----|', '|    |    |']);
    });

    it('refuses to insert above the header', async () => {
        const t = makeEditor(T, 0, 2);
        expect(await insertRowAbove()).toBe(false);
        expect(t.text()).toBe(T);
    });

    it('refuses to delete the header or delimiter row', async () => {
        for (const line of [0, 1]) {
            const t = makeEditor(T, line, 2);
            expect(await deleteRow()).toBe(false);
            expect(t.text()).toBe(T);
        }
        const t = makeEditor(T, 2, 2);
        expect(await deleteRow()).toBe(true);
        expect(t.text()).toBe('| h1 | h2 |\n|----|----|\n| c  | d  |');
    });

    it('moves rows across the delimiter by swapping with the header', async () => {
        const t = makeEditor(T, 2, 2);
        expect(await moveRowUp()).toBe(true);
        expect(t.text()).toBe('| a  | b  |\n|----|----|\n| h1 | h2 |\n| c  | d  |');
        expect(pos(t.editor)[0]).toBe(0);
        expect(await moveRowDown()).toBe(true);
        expect(t.text()).toBe(T);
        expect(pos(t.editor)[0]).toBe(2);
    });

    it('refuses to move the delimiter row', async () => {
        const t = makeEditor(T, 1, 2);
        expect(await moveRowUp()).toBe(false);
        expect(await moveRowDown()).toBe(false);
        expect(t.text()).toBe(T);
    });

    it('moves body rows normally', async () => {
        const t = makeEditor(T, 3, 2);
        expect(await moveRowUp()).toBe(true);
        expect(t.text()).toBe('| h1 | h2 |\n|----|----|\n| c  | d  |\n| a  | b  |');
    });
});

describe('GFM insert separator', () => {
    it('is a no-op when the table already has a delimiter row', async () => {
        const T = '| h1 | h2 |\n|----|----|\n| a  | b  |';
        const t = makeEditor(T, 2, 2);
        expect(await insertSeparator()).toBe(false);
        expect(t.text()).toBe(T);
        expect((vscode as any).window.showInformationMessage).toHaveBeenCalled();
    });

    it('creates the delimiter under the header of a header-only table', async () => {
        const t = makeEditor('| h1 | h2 |', 0, 2);
        expect(await insertSeparator()).toBe(true);
        expect(t.text().split('\n').slice(0, 2)).toEqual(['| h1 | h2 |', '|----|----|']);
    });

    it('still inserts an hline in org', async () => {
        const t = makeEditor('| a |\n| b |\n| c |', 1, 2, 'org');
        expect(await insertSeparator()).toBe(true);
        expect(t.text()).toBe('| a |\n| b |\n|---|\n| c |');
    });
});
