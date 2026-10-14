import * as vscode from 'vscode';

const EXTENSION_ID = 'jkitchin.scimax-vscode';

/** Render a VS Code keybinding the way the docs and Emacs write it. */
export function formatKeybinding(key: string): string {
    return key
        .split(' ')
        .map(part => part
            .replace(/^ctrl\+/, 'C-')
            .replace(/^alt\+/, 'M-')
            .replace(/^shift\+\/$/, '?')
            .replace(/^shift\+/, 'S-'))
        .join(' ');
}

/**
 * Read our keybindings back out of our own manifest, so menus cannot drift.
 * Maps each command to its first binding, or its first binding starting with
 * `prefix` when one is given.
 */
export function contributedKeybindings(prefix?: string): Map<string, string> {
    const bound = new Map<string, string>();
    const contributed = vscode.extensions.getExtension(EXTENSION_ID)
        ?.packageJSON?.contributes?.keybindings;

    if (Array.isArray(contributed)) {
        for (const binding of contributed) {
            const command = binding?.command;
            const key = binding?.key;
            if (typeof command === 'string' && typeof key === 'string' && !bound.has(command)
                && (prefix === undefined || key.startsWith(prefix))) {
                bound.set(command, formatKeybinding(key));
            }
        }
    }

    return bound;
}
