import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory files standing in for VS Code's documents
const files = new Map<string, string>();
const showWarningMessage = vi.fn();

vi.mock('vscode', () => {
    class Position { constructor(public line: number, public character: number) {} }
    class Range { constructor(public start: Position, public end: Position) {} }
    class WorkspaceEdit {
        edits: Array<{ uri: { fsPath: string }; text: string }> = [];
        replace(uri: { fsPath: string }, _range: Range, text: string) { this.edits.push({ uri, text }); }
        get size() { return this.edits.length; }
    }
    const docFor = (fsPath: string) => ({
        uri: { fsPath },
        getText: () => files.get(fsPath) ?? '',
        positionAt: (n: number) => new Position(0, n),
        save: async () => true,
    });
    return {
        Position, Range, WorkspaceEdit,
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: {
            openTextDocument: async (u: { fsPath: string } | string) => {
                const p = typeof u === 'string' ? u : u.fsPath;
                if (!files.has(p)) throw new Error('no file');
                return docFor(p);
            },
            applyEdit: async (edit: WorkspaceEdit) => {
                for (const e of edit.edits) files.set(e.uri.fsPath, e.text);
                return true;
            },
        },
        window: {
            showWarningMessage: (...args: unknown[]) => showWarningMessage(...args),
            showErrorMessage: vi.fn(),
            showInformationMessage: vi.fn(),
            setStatusBarMessage: vi.fn(),
        },
        commands: { registerCommand: vi.fn() },
    };
});

// The editing command itself: cycle TODO -> DONE on the file
vi.mock('../agendaDocumentProvider', () => ({
    currentHeadingLine: () => 1,
    runOnSourceHeading: async (item: { file: string }, command: string) => {
        const text = files.get(item.file)!;
        if (command === 'scimax.org.cycleTodo') {
            files.set(item.file, text.replace('* TODO', '* DONE'));
        }
        return true;
    },
}));

import { registerTaskHost, runOnTask, undoTaskAction, clearTaskUndo } from '../taskActions';

const VIEW = 'test.view';
const FILE = '/notes/tasks.org';
const ORIGINAL = '* TODO Write report\n';

describe('agenda task undo', () => {
    let reload: ReturnType<typeof vi.fn<() => Promise<void>>>;

    beforeEach(() => {
        files.clear();
        files.set(FILE, ORIGINAL);
        clearTaskUndo(VIEW);
        showWarningMessage.mockReset();
        reload = vi.fn<() => Promise<void>>(async () => undefined);
        registerTaskHost(VIEW, { reveal: () => undefined, reload });
    });

    it('undoes a TODO cycle and redoes it', async () => {
        await runOnTask({ view: VIEW, filePath: FILE, line: 1 }, 'scimax.org.cycleTodo');
        expect(files.get(FILE)).toBe('* DONE Write report\n');

        expect(await undoTaskAction(VIEW)).toBe(true);
        expect(files.get(FILE)).toBe(ORIGINAL);
        expect(reload).toHaveBeenCalled();

        expect(await undoTaskAction(VIEW, true)).toBe(true);
        expect(files.get(FILE)).toBe('* DONE Write report\n');
    });

    it('reports nothing to undo on an empty stack', async () => {
        expect(await undoTaskAction(VIEW)).toBe(false);
        expect(files.get(FILE)).toBe(ORIGINAL);
    });

    it('asks before overwriting edits made since, and keeps the entry if declined', async () => {
        await runOnTask({ view: VIEW, filePath: FILE, line: 1 }, 'scimax.org.cycleTodo');
        files.set(FILE, '* DONE Write report\nmore text\n');

        showWarningMessage.mockResolvedValueOnce(undefined);
        expect(await undoTaskAction(VIEW)).toBe(false);
        expect(files.get(FILE)).toBe('* DONE Write report\nmore text\n');

        showWarningMessage.mockResolvedValueOnce('Undo Anyway');
        expect(await undoTaskAction(VIEW)).toBe(true);
        expect(files.get(FILE)).toBe(ORIGINAL);
    });

    it('does not record refile, which edits another file too', async () => {
        await runOnTask({ view: VIEW, filePath: FILE, line: 1 }, 'scimax.org.refile');
        expect(await undoTaskAction(VIEW)).toBe(false);
    });

    it('a new action clears the redo stack', async () => {
        await runOnTask({ view: VIEW, filePath: FILE, line: 1 }, 'scimax.org.cycleTodo');
        await undoTaskAction(VIEW);
        await runOnTask({ view: VIEW, filePath: FILE, line: 1 }, 'scimax.org.cycleTodo');
        expect(await undoTaskAction(VIEW, true)).toBe(false);
    });
});
