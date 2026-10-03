/**
 * addDependencyBetween and removeDependencies: the edits the project view's
 * "Depends On..." and "Remove Dependency..." make, against an in-memory
 * workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Doc {
    uri: { fsPath: string };
    lines: string[];
    isDirty: boolean;
    saved: number;
}

const docs = new Map<string, Doc>();

function textDocument(doc: Doc) {
    return {
        uri: doc.uri,
        get lineCount() { return doc.lines.length; },
        get isDirty() { return doc.isDirty; },
        lineAt: (i: number) => ({
            text: doc.lines[i],
            range: { start: { line: i }, end: { line: i } },
            rangeIncludingLineBreak: { start: { line: i }, end: { line: i + 1 } },
        }),
        getText: () => doc.lines.join('\n'),
        save: async () => { doc.isDirty = false; doc.saved++; return true; },
    };
}
const handles = new Map<string, ReturnType<typeof textDocument>>();

type Op = { file: string; line: number; text: string; replace: boolean; remove?: boolean };

vi.mock('vscode', () => ({
    window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
    workspace: {
        getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
        openTextDocument: async (uri: { fsPath: string }) => handles.get(uri.fsPath),
        applyEdit: async (edit: { ops: Op[] }) => {
            // Apply bottom-up so earlier line numbers stay valid.
            for (const op of [...edit.ops].sort((a, b) => b.line - a.line)) {
                const doc = docs.get(op.file)!;
                if (op.remove) {
                    doc.lines.splice(op.line, 1);
                } else {
                    const lines = op.text.replace(/\n$/, '').split('\n');
                    doc.lines.splice(op.line, op.replace ? 1 : 0, ...lines);
                }
                doc.isDirty = true;
            }
            return true;
        },
    },
    commands: { registerCommand: vi.fn() },
    Uri: { file: (p: string) => ({ fsPath: p }) },
    Position: class { constructor(public line: number, public character: number) {} },
    WorkspaceEdit: class {
        ops: Op[] = [];
        insert(uri: { fsPath: string }, pos: { line: number }, text: string) {
            this.ops.push({ file: uri.fsPath, line: pos.line, text, replace: false });
        }
        replace(uri: { fsPath: string }, range: { start: { line: number } }, text: string) {
            this.ops.push({ file: uri.fsPath, line: range.start.line, text, replace: true });
        }
        delete(uri: { fsPath: string }, range: { start: { line: number } }) {
            this.ops.push({ file: uri.fsPath, line: range.start.line, text: '', replace: true, remove: true });
        }
    },
}));

vi.mock('../../database/lazyDb', () => ({ getDatabase: async () => undefined }));

import { addDependencyBetween, removeDependencies } from '../dependencyCommands';

function addFile(file: string, text: string): Doc {
    const doc: Doc = { uri: { fsPath: file }, lines: text.split('\n'), isDirty: false, saved: 0 };
    docs.set(file, doc);
    handles.set(file, textDocument(doc));
    return doc;
}

describe('addDependencyBetween', () => {
    beforeEach(() => { docs.clear(); handles.clear(); });

    it('adds :DEPENDS: below a later task when the target is above it in the same file', async () => {
        const doc = addFile('/p/a.org', ['* TODO Design', '* TODO Build'].join('\n'));
        const added = await addDependencyBetween({ file: '/p/a.org', line: 2 }, { file: '/p/a.org', line: 1 });
        expect(added).toBe(true);
        expect(doc.lines).toEqual([
            '* TODO Design',
            ':PROPERTIES:',
            ':ID: design',
            ':END:',
            '* TODO Build',
            ':PROPERTIES:',
            ':ID: build',
            ':DEPENDS: id:design',
            ':END:',
        ]);
        expect(doc.isDirty).toBe(false);
    });

    it('appends to an existing :DEPENDS: in another file and saves both', async () => {
        const a = addFile('/p/a.org', ['* TODO Write', ':PROPERTIES:', ':ID: write', ':DEPENDS: id:outline', ':END:'].join('\n'));
        const b = addFile('/p/b.org', ['* DONE Data'].join('\n'));
        expect(await addDependencyBetween({ file: '/p/a.org', line: 1 }, { file: '/p/b.org', line: 1 })).toBe(true);
        expect(a.lines[3]).toBe(':DEPENDS: id:outline id:data');
        expect(b.lines).toEqual(['* DONE Data', ':PROPERTIES:', ':ID: data', ':END:']);
        expect(a.saved).toBe(1);
        expect(b.saved).toBe(1);
    });

    it('reports an existing dependency without duplicating it', async () => {
        const a = addFile('/p/a.org', ['* TODO Write', ':PROPERTIES:', ':ID: write', ':DEPENDS: id:data', ':END:', '* Data', ':PROPERTIES:', ':ID: data', ':END:'].join('\n'));
        expect(await addDependencyBetween({ file: '/p/a.org', line: 1 }, { file: '/p/a.org', line: 6 })).toBe(false);
        expect(a.lines[3]).toBe(':DEPENDS: id:data');
    });
});

describe('removeDependencies', () => {
    beforeEach(() => { docs.clear(); handles.clear(); });

    it('keeps the other dependencies', async () => {
        const a = addFile('/p/a.org', ['* TODO Write', ':PROPERTIES:', ':ID: write', ':DEPENDS: id:outline id:data', ':END:'].join('\n'));
        expect(await removeDependencies({ file: '/p/a.org', line: 1 }, ['outline'])).toBe(true);
        expect(a.lines[3]).toBe(':DEPENDS: id:data');
        expect(a.saved).toBe(1);
    });

    it('deletes the property when none are left', async () => {
        const a = addFile('/p/a.org', ['* TODO Write', ':PROPERTIES:', ':ID: write', ':DEPENDS: id:outline id:data', ':END:', 'Body'].join('\n'));
        expect(await removeDependencies({ file: '/p/a.org', line: 1 }, ['outline', 'data'])).toBe(true);
        expect(a.lines).toEqual(['* TODO Write', ':PROPERTIES:', ':ID: write', ':END:', 'Body']);
    });

    it('does nothing for an id that is not a dependency', async () => {
        const a = addFile('/p/a.org', ['* TODO Write', ':PROPERTIES:', ':DEPENDS: id:data', ':END:'].join('\n'));
        expect(await removeDependencies({ file: '/p/a.org', line: 1 }, ['other'])).toBe(false);
        expect(a.lines[2]).toBe(':DEPENDS: id:data');
        expect(a.saved).toBe(0);
    });
});
