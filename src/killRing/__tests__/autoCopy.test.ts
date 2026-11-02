import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
    enabled: true,
    handler: undefined as undefined | ((e: unknown) => void),
}));

vi.mock('vscode', () => ({
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
    EndOfLine: { LF: 1, CRLF: 2 },
    ConfigurationTarget: { Global: 1 },
    window: {
        onDidChangeTextEditorSelection: (h: (e: unknown) => void) => {
            state.handler = h;
            return { dispose() {} };
        },
        setStatusBarMessage: vi.fn(),
    },
    workspace: {
        getConfiguration: () => ({ get: () => state.enabled, update: vi.fn() }),
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
}));

const pushKill = vi.fn(async (_text: string) => {});
let head: string | undefined;
vi.mock('../commands', () => ({
    pushKill: (t: string) => pushKill(t),
    killRingHead: () => head,
}));

import { registerAutoCopy, selectedText } from '../autoCopy';

type Sel = { text: string; isEmpty: boolean };
const sel = (text: string): Sel => ({ text, isEmpty: text === '' });

function makeEditor(selections: Sel[]) {
    return {
        document: { eol: 1, getText: (s: Sel) => s.text },
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

describe('auto-copy', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        pushKill.mockClear();
        head = undefined;
        state.enabled = true;
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
});
