/**
 * Dired reloads its listing when its tab becomes active again, or when VS
 * Code regains focus with dired active, unless scimax.dired.autoRefresh is off.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Listener = (event: any) => void;
const h = vi.hoisted(() => ({
    viewState: [] as ((e: any) => void)[],
    windowState: [] as ((e: any) => void)[],
    config: {} as Record<string, unknown>,
    refresh: (() => {}) as any,
    panel: undefined as any,
}));

vi.mock('vscode', () => {
    const subscribe = (list: Listener[]) => (listener: Listener) => {
        list.push(listener);
        return { dispose: () => list.splice(list.indexOf(listener), 1) };
    };
    return {
        ViewColumn: { Active: -1 },
        Uri: { file: (p: string) => ({ fsPath: p }), joinPath: () => ({}) },
        workspace: {
            getConfiguration: () => ({ get: (key: string, d: unknown) => key in h.config ? h.config[key] : d }),
        },
        window: {
            onDidChangeWindowState: subscribe(h.windowState),
            createWebviewPanel: () => {
                h.panel = {
                    active: true,
                    webview: { html: '', onDidReceiveMessage: () => ({ dispose() {} }), postMessage: vi.fn(), asWebviewUri: (u: unknown) => u, cspSource: '' },
                    onDidDispose: () => ({ dispose() {} }),
                    onDidChangeViewState: subscribe(h.viewState),
                    reveal: vi.fn(),
                };
                return h.panel;
            },
        },
    };
});

vi.mock('../diredManager', () => ({
    DiredManager: class {
        refresh = h.refresh;
        onStateChange() { return { dispose() {} }; }
        getState() { return { currentDirectory: '/tmp', entries: [], selectedIndex: 0 }; }
    },
}));
vi.mock('../../files/openDocs', () => ({ closeTabsUnder: vi.fn(), saveDirtyDocsUnder: vi.fn() }));

import { DiredPanel } from '../diredPanel';

describe('dired auto refresh', () => {
    beforeEach(() => {
        h.refresh = vi.fn(() => Promise.resolve());
        h.config = {};
        h.viewState.length = 0;
        h.windowState.length = 0;
        DiredPanel.currentPanel = undefined;
        DiredPanel.createOrShow({} as any);
    });

    const setActive = (active: boolean) => {
        h.panel.active = active;
        h.viewState.forEach((l) => l({ webviewPanel: h.panel }));
    };

    it('reloads when the dired tab becomes active again, not on other view changes', () => {
        setActive(true);            // already active: no reload
        expect(h.refresh).not.toHaveBeenCalled();
        setActive(false);
        expect(h.refresh).not.toHaveBeenCalled();
        setActive(true);
        expect(h.refresh).toHaveBeenCalledTimes(1);
    });

    it('reloads when VS Code regains focus with dired active', () => {
        h.windowState.forEach((l) => l({ focused: true }));
        expect(h.refresh).toHaveBeenCalledTimes(1);
        h.panel.active = false;
        h.windowState.forEach((l) => l({ focused: true }));
        h.windowState.forEach((l) => l({ focused: false }));
        expect(h.refresh).toHaveBeenCalledTimes(1);
    });

    it('does nothing when scimax.dired.autoRefresh is off', () => {
        h.config.autoRefresh = false;
        setActive(false);
        setActive(true);
        h.windowState.forEach((l) => l({ focused: true }));
        expect(h.refresh).not.toHaveBeenCalled();
    });
});
