import * as vscode from 'vscode';

/** WebviewPanel.iconPath accepts a ThemeIcon only from VS Code 1.108. */
const THEME_ICON_MIN_MINOR = 108;

/** True when the running VS Code is at least 1.<minor> (pre-release suffixes ignored). */
export function vscodeAtLeast(minor: number, version: string = vscode.version): boolean {
    const [major, min] = version.split('.').map(part => parseInt(part, 10));
    return major > 1 || (major === 1 && min >= minor);
}

/**
 * Give a webview panel a codicon tab icon. Older VS Code versions have no
 * ThemeIcon support for panels, so there the panel keeps the default icon.
 */
export function setPanelThemeIcon(panel: vscode.WebviewPanel, id: string): void {
    if (vscodeAtLeast(THEME_ICON_MIN_MINOR)) {
        (panel as { iconPath?: unknown }).iconPath = new vscode.ThemeIcon(id);
    }
}
