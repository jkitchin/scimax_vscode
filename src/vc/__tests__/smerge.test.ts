/**
 * Tests for conflict-block parsing and resolution (smerge mode), and for the
 * Conflicts menu matching smerge mode's keys.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => ({ window: {}, workspace: {}, commands: {}, env: {} }));

import {
    conflictAt,
    conflictIndex,
    isConflictMarkerAt,
    isMarkerLine,
    nextConflict,
    parseConflicts,
    previousConflict,
    resolveConflict,
    sideAt,
    sideName,
} from '../smerge';
import { conflictsMenu, vcMenu } from '../../hydra/menus/vcMenu';

const text = [
    '* Results',                       // 0
    '<<<<<<< HEAD',                    // 1
    'The rate is 0.12 1/s.',           // 2
    '=======',                         // 3
    'The rate is 0.15 1/s.',           // 4
    '>>>>>>> feature',                 // 5
    'middle',                          // 6
    '<<<<<<< HEAD',                    // 7
    'mine A',                          // 8
    'mine B',                          // 9
    '||||||| merged common ancestors', // 10
    'base',                            // 11
    '=======',                         // 12
    '>>>>>>> 1a2b3c4 (Edit)',          // 13
    'end',                             // 14
];

describe('parseConflicts', () => {
    const conflicts = parseConflicts(text);

    it('finds two-way and diff3 conflict blocks with their labels', () => {
        expect(conflicts).toHaveLength(2);
        const [a, b] = conflicts;
        expect(a).toMatchObject({ start: 1, separator: 3, end: 5, mineLabel: 'HEAD', theirsLabel: 'feature' });
        expect(a.base).toBeUndefined();
        expect(a.mine).toEqual(['The rate is 0.12 1/s.']);
        expect(a.theirs).toEqual(['The rate is 0.15 1/s.']);
        expect(b).toMatchObject({ start: 7, base: 10, separator: 12, end: 13, baseLabel: 'merged common ancestors' });
        expect(b.mine).toEqual(['mine A', 'mine B']);
        expect(b.baseLines).toEqual(['base']);
        expect(b.theirs).toEqual([]);
        expect(b.theirsLabel).toBe('1a2b3c4 (Edit)');
    });

    it('skips incomplete blocks and look-alike lines', () => {
        expect(parseConflicts(['<<<<<<< HEAD', 'x', '=======', 'no end'])).toEqual([]);
        expect(parseConflicts(['<<<<<<<< eight', '=======', '>>>>>>> x'])).toEqual([]);
        expect(parseConflicts(['<<<<<<< stray', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> x'])).toHaveLength(1);
        expect(isMarkerLine('=======')).toBe(true);
        expect(isMarkerLine('>>>>>>> main\r')).toBe(true);
        expect(isMarkerLine('======== ')).toBe(false);
        expect(isMarkerLine('<<<<<<<x')).toBe(false);
    });

    it('handles CRLF lines', () => {
        const crlf = ['<<<<<<< HEAD\r', 'a\r', '=======\r', 'b\r', '>>>>>>> x\r'];
        expect(parseConflicts(crlf)[0]).toMatchObject({ start: 0, end: 4, mineLabel: 'HEAD', theirsLabel: 'x' });
    });
});

describe('resolution and navigation', () => {
    const [a, b] = parseConflicts(text);
    const conflicts = [a, b];

    it('keeps mine, theirs, both or base', () => {
        expect(resolveConflict(a, 'mine')).toEqual(['The rate is 0.12 1/s.']);
        expect(resolveConflict(a, 'theirs')).toEqual(['The rate is 0.15 1/s.']);
        expect(resolveConflict(a, 'both')).toEqual(['The rate is 0.12 1/s.', 'The rate is 0.15 1/s.']);
        expect(resolveConflict(a, 'base')).toBeUndefined();
        expect(resolveConflict(b, 'base')).toEqual(['base']);
        expect(resolveConflict(b, 'theirs')).toEqual([]);
    });

    it('works out the side at a line for RET', () => {
        expect(sideAt(a, 1)).toBe('mine');
        expect(sideAt(a, 2)).toBe('mine');
        expect(sideAt(a, 3)).toBeUndefined();
        expect(sideAt(a, 4)).toBe('theirs');
        expect(sideAt(a, 5)).toBe('theirs');
        expect(sideAt(b, 10)).toBe('base');
        expect(sideAt(b, 11)).toBe('base');
        expect(sideAt(b, 9)).toBe('mine');
    });

    it('finds the conflict at, after and before a line', () => {
        expect(conflictAt(conflicts, 4)).toBe(a);
        expect(conflictAt(conflicts, 6)).toBeUndefined();
        expect(isConflictMarkerAt(conflicts, 3)).toBe(true);
        expect(isConflictMarkerAt(conflicts, 10)).toBe(true);
        expect(isConflictMarkerAt(conflicts, 2)).toBe(false);
        expect(nextConflict(conflicts, 0)).toBe(a);
        expect(nextConflict(conflicts, 1)).toBe(b);
        expect(nextConflict(conflicts, 7)).toBeUndefined();
        expect(previousConflict(conflicts, 7)).toBe(a);
        expect(previousConflict(conflicts, 1)).toBeUndefined();
        expect(conflictIndex(conflicts, 0)).toBe(1);
        expect(conflictIndex(conflicts, 6)).toBe(2);
        expect(conflictIndex(conflicts, 14)).toBe(2);
    });

    it('names sides with their marker labels', () => {
        expect(sideName(a, 'mine')).toBe('mine (HEAD)');
        expect(sideName(a, 'theirs')).toBe('theirs (feature)');
        expect(sideName(a, 'both')).toBe('both');
    });
});

describe('smerge keys', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8'));
    const declared = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    const bindings: { command: string; key: string; when?: string }[] = pkg.contributes.keybindings;

    it('binds each menu key as a single key at a marker and after C-c ^', () => {
        const toKey = (k: string) => k === '=' ? '=' : k === k.toUpperCase() && k !== k.toLowerCase() ? `shift+${k.toLowerCase()}` : k;
        for (const item of conflictsMenu.groups.flatMap(g => g.items)) {
            const command = String(item.action);
            expect(declared.has(command), command).toBe(true);
            const speed = bindings.find(b => b.command === command && b.when?.includes('scimax.atConflictMarker'));
            const prefixed = bindings.find(b => b.command === command && b.key.startsWith('ctrl+c shift+6 '));
            expect(speed?.key, command).toBe(toKey(item.key));
            expect(prefixed?.key, command).toBe(`ctrl+c shift+6 ${toKey(item.key)}`);
        }
    });

    it('is m in the Version Control menu, and table sort yields to it', () => {
        const entry = vcMenu.groups.flatMap(g => g.items).find(i => i.key === 'm');
        expect(entry?.action).toBe('scimax.conflicts');
        const vcKeys = vcMenu.groups.flatMap(g => g.items).map(i => i.key);
        expect(new Set(vcKeys).size).toBe(vcKeys.length);
        const sort = bindings.find(b => b.command === 'scimax.table.sortByColumn' && b.key === 'ctrl+c shift+6');
        expect(sort?.when).toContain('!scimax.smergeActive');
    });
});
