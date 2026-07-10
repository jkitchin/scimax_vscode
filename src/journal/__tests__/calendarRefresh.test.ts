/**
 * Tests for JournalCalendarProvider.refresh() (issue #47 audit, item B2).
 *
 * scimax.journal.refresh was declared in package.json but never registered;
 * the fix registers it to call this provider's refresh(). Because the command
 * can be invoked from the palette before the calendar view has ever been
 * opened, refresh() must be a safe no-op when no webview is attached.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    commands: { executeCommand: vi.fn() },
    window: {},
    workspace: {},
}));

import { JournalCalendarProvider } from '../calendarView';

function makeManager() {
    return {
        getAllEntries: vi.fn(() => []),
        getBasicStats: vi.fn(() => ({ streak: 0, entryCount: 0 })),
        getConfig: vi.fn(() => ({ weekStartsOn: 'sunday' })),
    } as any;
}

describe('JournalCalendarProvider.refresh', () => {
    it('is a safe no-op when the view was never opened', () => {
        const provider = new JournalCalendarProvider(makeManager(), {} as any);
        // No resolveWebviewView() has run, so _view is undefined.
        expect(() => provider.refresh()).not.toThrow();
    });

    it('re-renders the webview html when a view is attached', () => {
        const manager = makeManager();
        const provider = new JournalCalendarProvider(manager, {} as any);

        // Minimal fake WebviewView to attach via resolveWebviewView.
        const webview: any = {
            options: {},
            set html(v: string) {
                this._html = v;
            },
            get html() {
                return this._html;
            },
            onDidReceiveMessage: vi.fn(),
        };
        const view: any = { webview };

        provider.resolveWebviewView(view, {} as any, {} as any);
        webview._html = '';

        provider.refresh();

        expect(typeof webview.html).toBe('string');
        expect(webview.html.length).toBeGreaterThan(0);
        expect(manager.getAllEntries).toHaveBeenCalled();
    });
});
