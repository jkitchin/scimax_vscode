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
import { shiftTimestampRight, shiftTimestampLeft } from '../timestampProvider';

function makeEditor(text: string, languageId: string, line = 0) {
    let lines = text.split('\n');
    const offset = (p: { line: number; character: number }) =>
        lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    const splice = (range: any, s: string) => {
        const full = lines.join('\n');
        lines = (full.slice(0, offset(range.start)) + s + full.slice(offset(range.end))).split('\n');
        doc.version++;
    };
    const doc: any = {
        languageId,
        version: 1,
        get lineCount() { return lines.length; },
        getText: () => lines.join('\n'),
        lineAt: (n: number) => ({
            text: lines[n],
            range: { start: { line: n, character: 0 }, end: { line: n, character: lines[n].length } },
            rangeIncludingLineBreak: { start: { line: n, character: 0 }, end: { line: n + 1, character: 0 } },
        }),
        uri: { fsPath: '/tmp/x.md', toString: () => 'file:///tmp/x.md' },
    };
    const editor: any = {
        document: doc,
        selection: { active: { line, character: 0 } },
        edit: async (cb: any) => {
            cb({
                replace: (range: any, s: string) => splice(range, s),
                insert: (pos: any, s: string) => splice({ start: pos, end: pos }, s),
                delete: (range: any) => splice(range, ''),
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

    it('cycles # x -> # TODO x -> # DONE x (with a CLOSED line) -> # x', async () => {
        const e = makeEditor('## Write paper', 'markdown');
        state.editor = e.editor;
        await cycleTodoState();
        expect(e.text()).toBe('## TODO Write paper');
        await cycleTodoState();
        expect(e.text()).toMatch(new RegExp(`^## DONE Write paper\\nCLOSED: \\[${today} \\w{3}( \\d\\d:\\d\\d)?\\]$`));
        await cycleTodoState();
        expect(e.text()).toBe('## Write paper');
    });

    it('adds CLOSED to an existing planning line', async () => {
        const e = makeEditor('## TODO Write paper\nDEADLINE: <2026-01-09 Fri>', 'markdown');
        state.editor = e.editor;
        await cycleTodoState();
        expect(e.text().split('\n')[1]).toMatch(/^DEADLINE: <2026-01-09 Fri> CLOSED: \[|^CLOSED: \[.*\] DEADLINE: <2026-01-09 Fri>$/);
    });

    it('honors #+TODO: keywords', async () => {
        const e = makeEditor('<!-- #+TODO: TODO REVIEW | SHIPPED -->\n# TODO x #paper', 'quarto', 1);
        state.editor = e.editor;
        await cycleTodoState();
        expect(e.text().split('\n')[1]).toBe('# REVIEW x #paper');
    });

    it('ignores # lines inside fenced code', async () => {
        const e = makeEditor('```sh\n# comment\n```', 'markdown', 1);
        state.editor = e.editor;
        await cycleTodoState();
        expect(e.text().split('\n')[1]).toBe('# comment');
    });
});

describe('a repeating markdown task', () => {
    beforeEach(() => { state.editor = undefined; });

    for (const [name, cycle] of [['C-c C-t', cycleTodoState], ['Shift+Right', shiftTimestampRight]] as const) {
        it(`moves the date on and stays TODO (${name})`, async () => {
            const e = makeEditor('## TODO Water plants\nSCHEDULED: <2026-11-03 Tue +1w>\n\nbody', 'markdown');
            state.editor = e.editor;
            await cycle();
            const lines = e.text().split('\n');
            expect(lines[0]).toBe('## TODO Water plants');
            expect(lines).toContain('SCHEDULED: <2026-11-10 Tue +1w>');
            expect(e.text()).not.toMatch(/^CLOSED:/m);
        });
    }
});

describe('Shift+Right / Shift+Left on markdown headings', () => {
    beforeEach(() => { state.editor = undefined; });

    it('adds a CLOSED line when done and removes it when not', async () => {
        const e = makeEditor('## TODO Write paper\nDEADLINE: <2026-01-09 Fri>', 'markdown');
        state.editor = e.editor;
        await shiftTimestampRight();
        const lines = e.text().split('\n');
        expect(lines[0]).toBe('## DONE Write paper');
        expect(lines[1]).toMatch(new RegExp(`CLOSED: \\[${today} `));
        expect(lines[1]).toContain('DEADLINE: <2026-01-09 Fri>');
        await shiftTimestampLeft();
        expect(e.text()).toBe('## TODO Write paper\nDEADLINE: <2026-01-09 Fri>');
    });

    it('reads [TODO] and honors #+TODO: keywords', async () => {
        const e = makeEditor('<!-- #+TODO: TODO REVIEW | SHIPPED -->\n# [REVIEW] x', 'markdown', 1);
        state.editor = e.editor;
        await shiftTimestampRight();
        expect(e.text().split('\n')[1]).toBe('# SHIPPED x');
        expect(e.text().split('\n')[2]).toMatch(/^CLOSED: \[/);
    });
});
