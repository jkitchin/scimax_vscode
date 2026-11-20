import { describe, it, expect, vi, beforeEach } from 'vitest';

let editorSetting = 'scimax';
const executeCommand = vi.fn();
vi.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: () => editorSetting }) },
    commands: { executeCommand: (...a: unknown[]) => executeCommand(...a) },
}));

import { isViewable, openViewable, previewEditorFor } from '../openViewable';

describe('previewEditorFor', () => {
    beforeEach(() => { editorSetting = 'scimax'; executeCommand.mockReset(); });

    it('shows drawings in the drawing editor and images in the image preview', () => {
        expect(previewEditorFor('/a/map.excalidraw.svg')).toBe('scimax.excalidraw');
        expect(previewEditorFor('/a/map.excalidraw')).toBe('scimax.excalidraw');
        expect(previewEditorFor('/a/map.excalidraw.json')).toBe('scimax.excalidraw');
        expect(previewEditorFor('/a/map.excalidraw.png')).toBe('editor.excalidraw');
        expect(previewEditorFor('/a/plot.SVG')).toBe('imagePreview.previewEditor');
        expect(previewEditorFor('/a/photo.jpeg')).toBe('imagePreview.previewEditor');
        expect(previewEditorFor('/a/notes.org')).toBeUndefined();
        expect(isViewable('/a/data.json')).toBe(false);
    });

    it('follows scimax.excalidraw.editor', () => {
        editorSetting = 'pomdtr';
        expect(previewEditorFor('/a/map.excalidraw.svg')).toBe('editor.excalidraw');
    });

    it('falls back to the image preview when a drawing editor is missing', async () => {
        editorSetting = 'pomdtr';
        executeCommand.mockImplementation(async (cmd: string, _uri: unknown, id: string) => {
            if (cmd === 'vscode.openWith' && id === 'editor.excalidraw') throw new Error('no such editor');
        });
        const uri = { fsPath: '/a/map.excalidraw.svg' };
        await openViewable(uri as never);
        expect(executeCommand.mock.calls.map(c => c[2])).toEqual(['editor.excalidraw', 'imagePreview.previewEditor']);
    });
});
