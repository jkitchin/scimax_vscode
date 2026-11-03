/**
 * Tests for narrowToSubtree: which headings it folds, and that the cursor stays put
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
    Range: class { constructor(public startLine: number, public startChar: number, public endLine: number, public endChar: number) {} },
    TextEditorRevealType: { AtTop: 3 },
    window: { activeTextEditor: null, setStatusBarMessage: vi.fn() },
    commands: { executeCommand: vi.fn() }
}));

import { narrowToSubtree } from '../visibility';

function mockEditor(content: string, cursorLine: number) {
    const lines = content.split('\n');
    const document = {
        languageId: 'org',
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line], isEmptyOrWhitespace: lines[line].trim() === '' })
    };
    const selections = [{ active: { line: cursorLine, character: 2 } }];
    return {
        document,
        selection: selections[0],
        selections,
        revealRange: vi.fn()
    };
}

/** The lines narrowToSubtree folded, from its editor.fold call */
function foldedLines(): number[] {
    const call = vi.mocked(vscode.commands.executeCommand).mock.calls.find(c => c[0] === 'editor.fold');
    return call ? (call[1] as { selectionLines: number[] }).selectionLines : [];
}

const DOC = [
    '* One',            // 0
    'text',             // 1
    '** One.A',         // 2
    'text',             // 3
    '** One.B',         // 4
    'text',             // 5
    '*** One.B.i',      // 6
    'text',             // 7
    '** One.C',         // 8
    'text',             // 9
    '* Two',            // 10
    'text',             // 11
    '** Two.A',         // 12
    'text',             // 13
    '* Three',          // 14
].join('\n');

describe('narrowToSubtree', () => {
    beforeEach(() => {
        vi.mocked(vscode.commands.executeCommand).mockReset();
    });

    it('folds the siblings of a subheading and other top-level trees, not its parent', async () => {
        const editor = mockEditor(DOC, 5);
        (vscode.window as any).activeTextEditor = editor;
        await narrowToSubtree();
        // One.A, One.C and Two; not One (the parent) or One.B (the subtree).
        // Three has no body, so no fold region: folding it would fold its parent.
        expect(foldedLines()).toEqual([2, 8, 10]);
    });

    it('keeps the cursor where it was', async () => {
        const editor = mockEditor(DOC, 7);
        const before = editor.selections;
        (vscode.window as any).activeTextEditor = editor;
        await narrowToSubtree();
        expect(editor.selections).toBe(before);
        expect(editor.revealRange).toHaveBeenCalled();
    });

    it('folds every other top-level tree from a top-level heading', async () => {
        const editor = mockEditor(DOC, 10);
        (vscode.window as any).activeTextEditor = editor;
        await narrowToSubtree();
        expect(foldedLines()).toEqual([0]);
    });

    it('does nothing before the first heading', async () => {
        const editor = mockEditor('preamble\n* One\ntext', 0);
        (vscode.window as any).activeTextEditor = editor;
        await narrowToSubtree();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });
});
