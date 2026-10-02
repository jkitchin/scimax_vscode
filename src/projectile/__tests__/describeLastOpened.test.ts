import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    window: {}, workspace: {}, commands: {}, languages: {}, Uri: {},
    EventEmitter: class {}, ThemeIcon: class {}, TreeItem: class {}, ThemeColor: class {},
    TreeItemCollapsibleState: {}, QuickPickItemKind: {}, Position: class {}, Range: class {}, Selection: class {},
}));

import { describeLastOpened } from '../commands';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 2);

describe('describeLastOpened', () => {
    it('says never for projects with no timestamp', () => {
        expect(describeLastOpened(undefined, NOW)).toBe('never opened');
    });
    it('uses days, then months, then years', () => {
        expect(describeLastOpened(NOW - 3600000, NOW)).toBe('last opened today');
        expect(describeLastOpened(NOW - 1.5 * DAY, NOW)).toBe('last opened yesterday');
        expect(describeLastOpened(NOW - 12 * DAY, NOW)).toBe('last opened 12 days ago');
        expect(describeLastOpened(NOW - 120 * DAY, NOW)).toBe('last opened 4 months ago');
        expect(describeLastOpened(NOW - 1000 * DAY, NOW)).toBe('last opened 3 years ago');
    });
});
