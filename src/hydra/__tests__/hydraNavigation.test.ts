/**
 * HydraManager navigation with VS Code's asynchronous QuickPick.onDidHide:
 * hiding a menu to open its submenu must not be taken for Escape (which goes
 * back to the parent), or C-c C-e l reopens the export menu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeQuickPick {
    title: string;
    items: unknown[];
    value: string;
    visible: boolean;
    disposed: boolean;
    changeValue?: (v: string) => Promise<void> | void;
    hideHandler?: () => Promise<void> | void;
}

const pickers: FakeQuickPick[] = [];
const executed: string[] = [];

vi.mock('vscode', () => ({
    window: {
        createQuickPick: () => {
            const qp: FakeQuickPick & Record<string, unknown> = {
                title: '', items: [], value: '', visible: false, disposed: false,
                placeholder: '', matchOnDescription: false, matchOnDetail: false, selectedItems: [],
                onDidChangeValue: (fn: (v: string) => void) => { qp.changeValue = fn; },
                onDidAccept: () => undefined,
                onDidHide: (fn: () => void) => { qp.hideHandler = fn; },
                show: () => { qp.visible = true; },
                // Like VS Code, the hide event arrives later, not inside hide().
                hide: () => {
                    if (!qp.visible) return;
                    qp.visible = false;
                    setTimeout(() => { void qp.hideHandler?.(); }, 0);
                },
                dispose: () => { qp.disposed = true; },
            };
            pickers.push(qp);
            return qp;
        },
        showErrorMessage: vi.fn(),
    },
    commands: {
        executeCommand: vi.fn(async (cmd: string) => { executed.push(cmd); }),
    },
    workspace: {
        getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
        onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    EventEmitter: class { event = () => undefined; fire() { /* noop */ } dispose() { /* noop */ } },
    QuickPickItemKind: { Separator: -1, Default: 0 },
}));

import { HydraManager } from '../hydraManager';

const flush = () => new Promise(resolve => setTimeout(resolve, 5));

function makeManager(): HydraManager {
    const manager = new HydraManager({ subscriptions: [] } as never);
    manager.registerMenus([
        {
            id: 'top', title: 'Export',
            groups: [{ items: [{ key: 'l', label: 'LaTeX', exit: 'submenu', action: 'top.latex' }] }],
        },
        {
            id: 'top.latex', title: 'LaTeX Export', parent: 'top',
            groups: [{ items: [{ key: 'o', label: 'PDF and open', exit: 'exit', action: 'export.pdfOpen' }] }],
        },
    ]);
    return manager;
}

const visibleTitles = () => pickers.filter(p => p.visible && !p.disposed).map(p => p.title);

describe('HydraManager submenu navigation', () => {
    beforeEach(() => { pickers.length = 0; executed.length = 0; });

    it('opening a submenu does not bounce back to the parent', async () => {
        const manager = makeManager();
        await manager.show('top');
        await pickers[0].changeValue!('l');
        await flush();
        expect(visibleTitles()).toEqual(['LaTeX Export']);
    });

    it('C-c C-e l o runs the export and leaves no menu open', async () => {
        const manager = makeManager();
        await manager.show('top');
        await pickers[0].changeValue!('l');
        await flush();
        const latex = pickers.find(p => p.title === 'LaTeX Export' && p.visible)!;
        await latex.changeValue!('o');
        await flush();
        expect(executed).toEqual(['export.pdfOpen']);
        expect(visibleTitles()).toEqual([]);
    });

    it('Escape in a submenu still goes back to the parent', async () => {
        const manager = makeManager();
        await manager.show('top');
        await pickers[0].changeValue!('l');
        await flush();
        const latex = pickers.find(p => p.title === 'LaTeX Export' && p.visible)!;
        // The user dismisses the picker: VS Code hides it and reports onDidHide.
        latex.visible = false;
        await latex.hideHandler!();
        await flush();
        expect(visibleTitles()).toEqual(['Export']);
    });
});
