/**
 * The Files menu (F12 f) and its file commands.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => ({ window: {}, workspace: {}, commands: {}, env: {} }));

import { fileMenu } from '../fileMenu';
import { mainMenu } from '../mainMenu';
import { scimaxMenus } from '../index';
import { validateNewFileName } from '../../../files/fileCommands';

const items = fileMenu.groups.flatMap(g => g.items);

describe('Files menu', () => {
    it('is f in the main menu and registered', () => {
        const entry = mainMenu.groups.flatMap(g => g.items).find(i => i.key === 'f');
        expect(entry?.action).toBe('scimax.files');
        expect(entry?.exit).toBe('submenu');
        expect(scimaxMenus.map(m => m.id)).toContain('scimax.files');
    });

    it('has no duplicate keys in the main menu or the Files menu', () => {
        const mainKeys = mainMenu.groups.flatMap(g => g.items).map(i => i.key);
        expect(new Set(mainKeys).size).toBe(mainKeys.length);
        const keys = items.map(i => i.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('runs only scimax commands that package.json declares', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../package.json'), 'utf-8'));
        const declared = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
        for (const item of items) {
            const action = String(item.action);
            if (action.startsWith('scimax.')) {
                expect(declared.has(action), action).toBe(true);
            }
        }
    });
});

describe('validateNewFileName', () => {
    it('accepts a new name or a relative path', () => {
        expect(validateNewFileName('b.org', 'a.org')).toBeUndefined();
        expect(validateNewFileName('archive/a.org', 'a.org')).toBeUndefined();
        expect(validateNewFileName('../a.org', 'a.org')).toBeUndefined();
    });

    it('rejects empty, unchanged and dot names', () => {
        expect(validateNewFileName('  ', 'a.org')).toBeDefined();
        expect(validateNewFileName('a.org ', 'a.org')).toBeDefined();
        expect(validateNewFileName('.', 'a.org')).toBeDefined();
        expect(validateNewFileName('..', 'a.org')).toBeDefined();
    });
});
