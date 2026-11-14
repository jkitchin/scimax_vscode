import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    version: '1.90.0',
    ThemeIcon: class { constructor(public id: string) {} },
}));

import { vscodeAtLeast, setPanelThemeIcon } from '../webviewIcon';

describe('vscodeAtLeast', () => {
    it('compares the minor version numerically', () => {
        expect(vscodeAtLeast(108, '1.108.0')).toBe(true);
        expect(vscodeAtLeast(108, '1.109.2')).toBe(true);
        expect(vscodeAtLeast(108, '1.90.0')).toBe(false);
        expect(vscodeAtLeast(108, '1.107.1')).toBe(false);
    });

    it('ignores pre-release suffixes', () => {
        expect(vscodeAtLeast(108, '1.108.0-insider')).toBe(true);
    });
});

describe('setPanelThemeIcon', () => {
    it('leaves the default icon on VS Code versions before 1.108', () => {
        const panel = {} as { iconPath?: unknown };
        setPanelThemeIcon(panel as never, 'database');
        expect(panel.iconPath).toBeUndefined();
    });
});
