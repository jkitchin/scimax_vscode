import { describe, it, expect } from 'vitest';
import { redoOps, undoOps, type LineChange } from '../lineChanges';

// The file before and after a drag that shifted one SCHEDULED line and
// inserted a new one under an undated heading.
const before = ['* TODO A', 'SCHEDULED: <2026-10-05 Mon>', '* TODO B', 'Body'];
const after = ['* TODO A', 'SCHEDULED: <2026-10-07 Wed>', '* TODO B', 'SCHEDULED: <2026-10-09 Fri>', 'Body'];
const changes: LineChange[] = [
    { file: 'f.org', line: 1, before: before[1], after: after[1] },
    { file: 'f.org', line: 3, after: after[3] },
];

describe('undoOps', () => {
    it('restores replaced lines and deletes inserted ones', () => {
        expect(undoOps(after, changes)).toEqual([
            { kind: 'replace', line: 1, text: before[1] },
            { kind: 'delete', line: 3 },
        ]);
    });

    it('refuses when a line was edited since', () => {
        const edited = [...after];
        edited[3] = 'SCHEDULED: <2026-10-10 Sat>';
        expect(undoOps(edited, changes)).toBeUndefined();
    });
});

describe('redoOps', () => {
    it('reapplies the changes in the numbering of the file before them', () => {
        const moved: LineChange[] = [
            { file: 'f.org', line: 1, after: 'SCHEDULED: <2026-10-09 Fri>' },
            { file: 'f.org', line: 3, before: 'DEADLINE: <2026-10-12 Mon>', after: 'DEADLINE: <2026-10-14 Wed>' },
        ];
        const lines = ['* TODO A', '* TODO B', 'DEADLINE: <2026-10-12 Mon>'];
        expect(redoOps(lines, moved)).toEqual([
            { kind: 'insert', line: 1, text: 'SCHEDULED: <2026-10-09 Fri>' },
            { kind: 'replace', line: 2, text: 'DEADLINE: <2026-10-14 Wed>' },
        ]);
    });

    it('round-trips with undoOps and refuses after an edit', () => {
        expect(redoOps(before, changes)).toEqual([
            { kind: 'replace', line: 1, text: after[1] },
            { kind: 'insert', line: 3, text: after[3] },
        ]);
        expect(redoOps(['* TODO A', 'SCHEDULED: <2026-10-06 Tue>', '* TODO B', 'Body'], changes)).toBeUndefined();
    });
});
