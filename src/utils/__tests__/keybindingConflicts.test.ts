import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import {
    findChordPrefixConflicts,
    mayBeActiveInOrg,
    manifestKeybindings,
    parseJsonc,
    removedBindings,
    fixSnippet,
    platformKey,
} from '../keybindingConflicts';

const ours = manifestKeybindings({
    contributes: {
        keybindings: [
            { command: 'workbench.action.showCommands', key: 'alt+x', mac: 'alt+x' },
            { command: 'scimax.org.thing', key: 'ctrl+c ctrl+c' },
            { command: 'scimax.scoped', key: 'alt+q', when: 'editorLangId == org' },
        ],
    },
}, 'darwin');

const magit = {
    id: 'kahole.magit',
    name: 'magit',
    keybindings: manifestKeybindings({
        contributes: {
            keybindings: [
                { command: 'magit.status', key: 'alt+x g' },
                { command: 'magit.dispatch', key: 'alt+x ctrl+g' },
                { command: 'magit.refresh', key: 'g', when: "editorLangId == 'magit'" },
                { command: 'other.scoped', key: 'alt+q z' },
            ],
        },
    }, 'darwin'),
};

describe('findChordPrefixConflicts', () => {
    it('ignores chords that cannot be active in an org file', () => {
        const jupyter = {
            id: 'ms-toolsai.jupyter',
            name: 'Jupyter',
            keybindings: [
                { command: 'jupyter.insertCellBelow', key: 'alt+x b',
                    when: 'editorTextFocus && jupyter.hascodecells && !notebookEditorFocused' },
                { command: 'py.thing', key: 'alt+x p', when: "editorLangId == 'python'" },
                { command: 'org.thing', key: 'alt+x o', when: 'editorTextFocus && editorLangId == org' },
                { command: 'any.thing', key: 'alt+x n', when: '!terminalFocus' },
            ],
        };
        expect(findChordPrefixConflicts(ours, [jupyter]).map(c => c.chord)).toEqual(['alt+x o', 'alt+x n']);
    });


    it('reports chords that start with our global single-stroke key', () => {
        const conflicts = findChordPrefixConflicts(ours, [magit]);
        expect(conflicts.map(c => c.chord)).toEqual(['alt+x g', 'alt+x ctrl+g']);
        expect(conflicts[0]).toMatchObject({
            key: 'alt+x',
            command: 'workbench.action.showCommands',
            extensionId: 'kahole.magit',
            chordCommand: 'magit.status',
        });
    });

    it('ignores our scoped bindings and our own chords', () => {
        const conflicts = findChordPrefixConflicts(ours, [magit]);
        expect(conflicts.some(c => c.key === 'alt+q')).toBe(false);
    });

    it('does not treat a longer key as a prefix', () => {
        const other = { id: 'x', name: 'x', keybindings: [{ command: 'x.y', key: 'alt+x+shift g' }] };
        expect(findChordPrefixConflicts(ours, [other])).toEqual([]);
    });

    it('skips chords the user already removed', () => {
        const removed = removedBindings(parseJsonc(`[
            // fix for magit
            { "key": "alt+x g", "command": "-magit.status" },
            { "key": "alt+x ctrl+g", "command": "-magit.dispatch" }, /* trailing */
        ]`));
        expect(findChordPrefixConflicts(ours, [magit], removed)).toEqual([]);
    });
});

describe('platformKey', () => {
    it('prefers the platform-specific key and normalizes it', () => {
        const binding = { key: 'Ctrl+X  G', mac: 'Cmd+X G' };
        expect(platformKey(binding, 'darwin')).toBe('cmd+x g');
        expect(platformKey(binding, 'linux')).toBe('ctrl+x g');
    });
});

describe('parseJsonc', () => {
    it('keeps comment-like text inside strings', () => {
        expect(parseJsonc('{"a": "http://x//y", "b": "/* no */"} // c')).toEqual({
            a: 'http://x//y',
            b: '/* no */',
        });
    });
});

describe('fixSnippet', () => {
    it('renders removal entries for keybindings.json', () => {
        const snippet = fixSnippet(findChordPrefixConflicts(ours, [magit]));
        expect(snippet).toBe(
            '  { "key": "alt+x g", "command": "-magit.status" },\n' +
            '  { "key": "alt+x ctrl+g", "command": "-magit.dispatch" }');
    });
});

describe('mayBeActiveInOrg', () => {
    it('treats generic, negated and org-only clauses as active', () => {
        expect(mayBeActiveInOrg(undefined)).toBe(true);
        expect(mayBeActiveInOrg('editorTextFocus && !editorReadonly')).toBe(true);
        expect(mayBeActiveInOrg("resourceLangId == 'org'")).toBe(true);
        expect(mayBeActiveInOrg('jupyter.hascodecells || editorFocus')).toBe(true);
    });

    it('treats other languages and extension contexts as inactive', () => {
        expect(mayBeActiveInOrg('editorTextFocus && jupyter.hascodecells')).toBe(false);
        expect(mayBeActiveInOrg('editorLangId == markdown')).toBe(false);
        expect(mayBeActiveInOrg('terminalFocus')).toBe(false);
    });
});
