/**
 * q closes the views C-x v l opens, and only those
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('C-x v l view keys', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8'));

    it('binds q to close the history view, scoped to it', () => {
        const declared = pkg.contributes.commands.map((c: { command: string }) => c.command);
        expect(declared).toContain('scimax.vc.logViewQuit');
        const q = pkg.contributes.keybindings.find((b: { command: string }) => b.command === 'scimax.vc.logViewQuit');
        expect(q?.key).toBe('q');
        expect(q?.when).toContain('scimax.vcLogViewActive');
        const palette = pkg.contributes.menus.commandPalette.find((m: { command: string }) => m.command === 'scimax.vc.logViewQuit');
        expect(palette?.when).toBe('scimax.vcLogViewActive');
    });

    it('marks every view C-x v l opens', () => {
        const src = fs.readFileSync(path.join(__dirname, '../vcCommands.ts'), 'utf-8');
        for (const fn of ['showFileLog', 'logSet']) {
            const body = src.slice(src.indexOf(`async function ${fn}(`)).split('\n}\n')[0];
            expect(body, fn).toMatch(/trackLogTitle\(/);
            expect(body, fn).toMatch(/trackLogDocument\(doc\.uri\)/);
        }
    });

    it('opens the Version Control menu with C-x v ? as well as C-x v m', () => {
        const keys = pkg.contributes.keybindings
            .filter((b: { command: string }) => b.command === 'scimax.hydra.vc').map((b: { key: string }) => b.key);
        expect(keys).toEqual(expect.arrayContaining(['ctrl+x v m', 'ctrl+x v shift+/']));
    });
});
