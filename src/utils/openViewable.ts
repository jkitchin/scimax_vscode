/**
 * Open a file the way a person following a link expects to see it: an
 * Excalidraw drawing in a drawing editor and an image (SVG included) in VS
 * Code's image preview, rather than as SVG/JSON text. Other files open in
 * their default editor.
 *
 * Also the commands that switch an SVG or drawing between its text and its
 * preview (Cmd+Shift+V / Ctrl+Shift+V, like Markdown's preview).
 */
import * as path from 'path';
import * as vscode from 'vscode';

const DRAWING_RE = /\.excalidraw(\.json|\.svg)?$/i;
const EXCALIDRAW_PNG_RE = /\.excalidraw\.png$/i;
const IMAGE_RE = /\.(svg|png|jpe?g|gif|webp|bmp|ico|avif)$/i;

/** VS Code's built-in image preview (the media-preview extension). */
const IMAGE_PREVIEW = 'imagePreview.previewEditor';
const SCIMAX_EXCALIDRAW = 'scimax.excalidraw';
const POMDTR_EXCALIDRAW = 'editor.excalidraw';

/** The editor that previews this file, or undefined if it has none. */
export function previewEditorFor(filePath: string): string | undefined {
    if (EXCALIDRAW_PNG_RE.test(filePath)) return POMDTR_EXCALIDRAW;
    if (DRAWING_RE.test(filePath)) {
        const choice = vscode.workspace.getConfiguration('scimax.excalidraw').get<string>('editor', 'scimax');
        return choice === 'pomdtr' ? POMDTR_EXCALIDRAW : SCIMAX_EXCALIDRAW;
    }
    if (IMAGE_RE.test(filePath)) return IMAGE_PREVIEW;
    return undefined;
}

/** True when following a link to this file should show a preview, not text. */
export function isViewable(filePath: string): boolean {
    return previewEditorFor(filePath) !== undefined;
}

/**
 * Open `uri` in its preview editor. Falls back to the image preview for a
 * drawing whose editor is not installed, and to VS Code's default otherwise.
 */
export async function openViewable(uri: vscode.Uri, viewColumn?: vscode.ViewColumn): Promise<void> {
    const editor = previewEditorFor(uri.fsPath);
    const tries = editor ? [editor] : [];
    if (editor && editor !== IMAGE_PREVIEW && IMAGE_RE.test(uri.fsPath)) tries.push(IMAGE_PREVIEW);
    for (const id of tries) {
        try {
            await vscode.commands.executeCommand('vscode.openWith', uri, id, viewColumn);
            return;
        } catch {
            // Editor not available (e.g. the Excalidraw extension is not installed)
        }
    }
    await vscode.commands.executeCommand('vscode.open', uri, viewColumn);
}

/** The file of the active tab, text or custom editor. */
function activeFile(): vscode.Uri | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) return input.uri;
    return vscode.window.activeTextEditor?.document.uri;
}

/**
 * Cmd+Shift+V in an SVG or drawing's text: show it as an image / drawing in
 * place of the text, as Markdown's preview does.
 */
async function showPreview(uri?: vscode.Uri): Promise<void> {
    const target = uri instanceof vscode.Uri ? uri : activeFile();
    if (!target) return;
    if (!isViewable(target.fsPath)) {
        vscode.window.showInformationMessage(`Scimax: no preview for ${path.basename(target.fsPath)}`);
        return;
    }
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === target.toString());
    if (doc?.isDirty) await doc.save();
    await openViewable(target, vscode.ViewColumn.Active);
}

/** Back from the preview to the file's text. */
async function showSource(uri?: vscode.Uri): Promise<void> {
    const target = uri instanceof vscode.Uri ? uri : activeFile();
    if (!target) return;
    await vscode.commands.executeCommand('vscode.openWith', target, 'default', vscode.ViewColumn.Active);
}

export function registerViewableCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.file.showPreview', showPreview),
        vscode.commands.registerCommand('scimax.file.showSource', showSource),
    );
}
