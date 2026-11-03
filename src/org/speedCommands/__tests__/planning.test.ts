import { describe, it, expect, vi } from 'vitest';

let handler: ((message: any) => void) | undefined;
vi.mock('vscode', () => ({
    ViewColumn: { Active: -1 },
    window: {
        createWebviewPanel: () => ({
            webview: { html: '', onDidReceiveMessage: (f: any) => { handler = f; }, postMessage: () => {} },
            onDidDispose: () => {},
            dispose: () => {},
        }),
    },
}));

import { parsePlanningTimestamp } from '../planning';
import { showCalendarDatePicker } from '../../calendarDatePicker';

describe('parsePlanningTimestamp', () => {
    it('reads the date of a plain deadline', () => {
        const t = parsePlanningTimestamp('DEADLINE: <2026-11-05 Thu>', 'DEADLINE');
        expect(t?.date).toEqual(new Date(2026, 10, 5));
        expect(t?.rest).toBe('');
    });

    it('keeps the time, repeater and warning', () => {
        const t = parsePlanningTimestamp('SCHEDULED: <2026-11-01 Sun> DEADLINE: <2026-11-05 Thu 10:00 +1w -2d>', 'DEADLINE');
        expect(t?.date).toEqual(new Date(2026, 10, 5));
        expect(t?.rest).toBe(' 10:00 +1w -2d');
    });

    it('finds the right keyword on a shared planning line', () => {
        const t = parsePlanningTimestamp('DEADLINE: <2026-11-05 Thu> SCHEDULED: <2026-11-01 Sun>', 'SCHEDULED');
        expect(t?.date).toEqual(new Date(2026, 10, 1));
    });

    it('accepts a timestamp without a day name', () => {
        expect(parsePlanningTimestamp('DEADLINE: <2026-11-05 09:30>', 'DEADLINE')?.rest).toBe(' 09:30');
    });

    it('returns undefined when the keyword is missing', () => {
        expect(parsePlanningTimestamp('SCHEDULED: <2026-11-01 Sun>', 'DEADLINE')).toBeUndefined();
    });
});

describe('showCalendarDatePicker initialDate', () => {
    const uri = {} as any;

    it('Enter selects the initial date', async () => {
        const picked = showCalendarDatePicker(uri, 'Set DEADLINE', { initialDate: new Date(2027, 1, 14) });
        handler!({ command: 'selectCursor' });
        expect(await picked).toEqual(new Date(2027, 1, 14));
    });

    it('starts on today without one', async () => {
        const picked = showCalendarDatePicker(uri, 'Set DEADLINE');
        handler!({ command: 'selectCursor' });
        const d = await picked, now = new Date();
        expect(d).toEqual(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    });
});
