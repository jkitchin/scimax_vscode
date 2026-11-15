import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
    enabled: true,
    notify: true,
    notices: [] as string[],
    handler: undefined as undefined | ((e: unknown) => void),
    docHandler: undefined as undefined | ((e: unknown) => void),
    commands: {} as Record<string, (...args: unknown[]) => unknown>,
    executed: [] as unknown[][],
    clipboard: 'old clip',
    activeEditor: undefined as unknown,
}));

vi.mock('vscode', () => ({
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
    EndOfLine: { LF: 1, CRLF: 2 },
    ConfigurationTarget: { Global: 1 },
    ProgressLocation: { Notification: 15 },
    window: {
        onDidChangeTextEditorSelection: (h: (e: unknown) => void) => {
            state.handler = h;
            return { dispose() {} };
        },
        setStatusBarMessage: vi.fn(),
        get activeTextEditor() { return state.activeEditor; },
        withProgress: (opts: { title: string }, task: () => Promise<void>) => {
            state.notices.push(opts.title);
            return task();
        },
    },
    env: {
        clipboard: { readText: async () => state.clipboard },
    },
    workspace: {
        onDidChangeTextDocument: (h: (e: unknown) => void) => {
            state.docHandler = h;
            return { dispose() {} };
        },
        getConfiguration: () => ({
            get: (key: string, dflt: unknown) =>
                key === 'notify' ? state.notify : key === 'enabled' ? state.enabled : dflt,
            update: vi.fn(),
        }),
    },
    commands: {
        registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
            state.commands[id] = fn;
            return { dispose() {} };
        },
        executeCommand: async (...args: unknown[]) => { state.executed.push(args); },
    },
}));

const pushKill = vi.fn(async (text: string) => { state.clipboard = text; });
const retractKill = vi.fn(async (_text: string, clip: string) => { state.clipboard = clip; return true; });
let head: string | undefined;
vi.mock('../commands', () => ({
    pushKill: (t: string) => pushKill(t),
    retractKill: (t: string, c: string) => retractKill(t, c),
    killRingHead: () => head,
}));

import { registerAutoCopy, selectedText, copyPreview } from '../autoCopy';

type Sel = { text: string; isEmpty: boolean; isEqual: (o: Sel) => boolean };
const sel = (text: string): Sel => ({ text, isEmpty: text === '', isEqual: o => o.text === text });

function makeEditor(selections: Sel[]) {
    return {
        document: { eol: 1, version: 1, getText: (s: Sel) => s.text },
        selections,
    };
}

function fire(editor: ReturnType<typeof makeEditor>, kind = 2) {
    state.handler!({ textEditor: editor, kind, selections: editor.selections });
}

describe('selectedText', () => {
    it('joins multiple selections with newlines and skips empty ones', () => {
        const editor = makeEditor([sel('a'), sel(''), sel('b')]);
        expect(selectedText(editor.document as never, editor.selections as never)).toBe('a\nb');
    });
});

describe('copyPreview', () => {
    it('collapses whitespace and shortens long text', () => {
        expect(copyPreview('  a\n\tb  ')).toBe('a b');
        const preview = copyPreview('x'.repeat(100));
        expect(preview).toHaveLength(60);
        expect(preview.endsWith('…')).toBe(true);
    });
});

describe('auto-copy', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        pushKill.mockClear();
        head = undefined;
        state.enabled = true;
        state.notify = true;
        state.notices = [];
        state.executed = [];
        state.clipboard = 'old clip';
        retractKill.mockClear();
        registerAutoCopy({ subscriptions: [] } as never);
    });
    afterEach(() => vi.useRealTimers());

    it('copies a mouse selection once it settles', async () => {
        const editor = makeEditor([sel('he')]);
        fire(editor);
        editor.selections = [sel('hello')];
        fire(editor);
        await vi.advanceTimersByTimeAsync(300);
        expect(pushKill).toHaveBeenCalledTimes(1);
        expect(pushKill).toHaveBeenCalledWith('hello');
        expect(state.notices).toEqual(['Copied: hello']);
    });

    it('can copy without the notification', async () => {
        state.notify = false;
        fire(makeEditor([sel('hello')]));
        await vi.advanceTimersByTimeAsync(300);
        expect(pushKill).toHaveBeenCalledWith('hello');
        expect(state.notices).toEqual([]);
    });

    it('ignores keyboard and command selections', async () => {
        fire(makeEditor([sel('x')]), 1);
        fire(makeEditor([sel('y')]), 3);
        await vi.advanceTimersByTimeAsync(300);
        expect(pushKill).not.toHaveBeenCalled();
    });

    it('does nothing when disabled', async () => {
        state.enabled = false;
        fire(makeEditor([sel('hello')]));
        await vi.advanceTimersByTimeAsync(300);
        expect(pushKill).not.toHaveBeenCalled();
    });

    it('skips empty, whitespace-only, and already-copied selections', async () => {
        fire(makeEditor([sel('')]));
        await vi.advanceTimersByTimeAsync(300);
        fire(makeEditor([sel('  \n')]));
        await vi.advanceTimersByTimeAsync(300);
        head = 'same';
        fire(makeEditor([sel('same')]));
        await vi.advanceTimersByTimeAsync(300);
        expect(pushKill).not.toHaveBeenCalled();
    });

    describe('undo on delete', () => {
        async function copied(text = 'hello') {
            const editor = makeEditor([sel(text)]);
            state.activeEditor = editor;
            fire(editor);
            await vi.advanceTimersByTimeAsync(300);
            expect(state.clipboard).toBe(text);
            return editor;
        }
        const contextSets = () => state.executed.filter(a => a[0] === 'setContext').map(a => a[2]);

        it('Backspace on the copied selection restores the clipboard, then deletes', async () => {
            await copied();
            expect(contextSets()).toEqual([true]);
            await state.commands['scimax.autoCopy.deleteSelection']('left');
            expect(retractKill).toHaveBeenCalledWith('hello', 'old clip');
            expect(state.clipboard).toBe('old clip');
            expect(state.executed.at(-1)).toEqual(['deleteLeft']);
            expect(contextSets()).toEqual([true, false]);
        });

        it('Delete runs deleteRight', async () => {
            await copied();
            await state.commands['scimax.autoCopy.deleteSelection']('right');
            expect(state.executed.at(-1)).toEqual(['deleteRight']);
        });

        it('typing over the copied selection undoes the copy', async () => {
            const editor = await copied();
            state.docHandler!({ document: editor.document, contentChanges: [{ text: 'x', range: sel('hello') }] });
            await vi.advanceTimersByTimeAsync(0);
            expect(retractKill).toHaveBeenCalledWith('hello', 'old clip');
        });

        it('cutting (empty replacement) or pasting the same text keeps the copy', async () => {
            let editor = await copied();
            state.docHandler!({ document: editor.document, contentChanges: [{ text: '', range: sel('hello') }] });
            editor = await copied('again');
            state.docHandler!({ document: editor.document, contentChanges: [{ text: 'again', range: sel('again') }] });
            await vi.advanceTimersByTimeAsync(0);
            expect(retractKill).not.toHaveBeenCalled();
        });

        it('moving the selection keeps the copy for good', async () => {
            const editor = await copied();
            editor.selections = [sel('')];
            fire(editor, 1);
            await state.commands['scimax.autoCopy.deleteSelection']('left');
            expect(retractKill).not.toHaveBeenCalled();
            expect(state.executed.at(-1)).toEqual(['deleteLeft']);
        });

        it('does nothing when undoOnDelete is off', async () => {
            const editor = makeEditor([sel('hello')]);
            state.activeEditor = editor;
            const get = (key: string, dflt: unknown) => (key === 'undoOnDelete' ? false : key === 'notify' ? true : key === 'enabled' ? true : dflt);
            const vscode = await import('vscode');
            const spy = vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get, update: vi.fn() } as never);
            fire(editor);
            await vi.advanceTimersByTimeAsync(300);
            spy.mockRestore();
            await state.commands['scimax.autoCopy.deleteSelection']('left');
            expect(retractKill).not.toHaveBeenCalled();
            expect(contextSets()).toEqual([]);
        });
    });
});
