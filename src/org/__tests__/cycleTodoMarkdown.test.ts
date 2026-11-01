import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ editor: undefined as any }));

vi.mock('vscode', () => {
    class Position { constructor(public line: number, public character: number) {} }
    class Range { constructor(public start: any, public end: any) {} }
    class Selection extends Range { constructor(public anchor: any, public active: any) { super(anchor, active); } }
    const handler: ProxyHandler<any> = {
        get: (target, prop) => {
            if (prop in target) return target[prop];
            if (prop === 'then') return undefined;
            return new Proxy(function () { return new Proxy({}, handler); }, handler);
        },
        apply: () => new Proxy({}, handler),
        construct: () => new Proxy({}, handler),
        has: () => true,
    };
    const base: any = {
        Position, Range, Selection,
        window: new Proxy({
            get activeTextEditor() { return state.editor; },
            showInformationMessage: vi.fn(),
        }, handler),
        workspace: new Proxy({
            getConfiguration: () => ({ get: (_k: string, d: any) => d }),
        }, handler),
    };
    return new Proxy(base, handler);
});

import { cycleTodoState } from '../scimaxOrg';

function makeEditor(text: string, languageId: string, line = 0) {
    const lines = text.split('\n');
    const doc: any = {
        languageId,
        version: 1,
        get lineCount() { return lines.length; },
        getText: () => lines.join('\n'),
        lineAt: (n: number) => ({ text: lines[n], range: { start: { line: n, character: 0 }, end: { line: n, character: lines[n].length } } }),
        uri: { fsPath: '/tmp/x.md', toString: () => 'file:///tmp/x.md' },
    };
    const editor: any = {
        document: doc,
        selection: { active: { line, character: 0 } },
        edit: async (cb: any) => {
            cb({
                replace: (range: any, s: string) => {
                    lines[range.start.line] = s;
                    doc.version++;
                },
            });
            return true;
        },
    };
    return { editor, text: () => lines.join('\n') };
}

const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

describe('cycleTodoState on markdown headings', () => {
    beforeEach(() => { state.editor = undefined; });

    it('cycles # x -> # TODO x -> # DONE x @closed -> # x', async () => {
        const e = makeEditor('## Write paper', 'markdown');
        state.editor = e.editor;
        await cycleTodoState();
        expect(e.text()).toBe('## TODO Write paper');
        await cycleTodoState();
        expect(e.text()).toBe(`## DONE Write paper @closed(${today})`);
        await cycleTodoState();
        expect(e.text()).toBe('## Write paper');
    });

    it('honors #+TODO: keywords', async () => {
        const e = makeEditor('#+TODO: TODO REVIEW | SHIPPED\n# TODO x @due(2026-01-01)', 'quarto', 1);
        state.editor = e.editor;
        await cycleTodoState();
        expect(e.text().split('\n')[1]).toBe('# REVIEW x @due(2026-01-01)');
    });

    it('ignores # lines inside fenced code', async () => {
        const e = makeEditor('```sh\n# comment\n```', 'markdown', 1);
        state.editor = e.editor;
        await cycleTodoState();
        expect(e.text().split('\n')[1]).toBe('# comment');
    });
});
