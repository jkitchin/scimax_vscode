/**
 * Scimax: New Drawing. Create an empty Excalidraw drawing, link it at the
 * cursor of an org or Markdown file, and open it in the drawing editor.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { parseOrgHeadings } from './noteIndex';

/** File name for a drawing: `.excalidraw.svg` unless an Excalidraw extension is given. */
export function drawingFileName(input: string): string {
    const name = input.trim();
    if (/\.excalidraw(\.svg|\.json)?$/i.test(name)) return name;
    return name.replace(/\.svg$/i, '') + '.excalidraw.svg';
}

/** A file-name slug for a heading title: `REE separation train` → `ree-separation-train`. */
export function slugify(title: string): string {
    return title
        .replace(/\[\[(?:[^\]]*\]\[)?([^\]]*)\]\]/g, '$1') // org links → their text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '') || 'drawing';
}

/** The link to put in a note for a drawing at `rel` (relative, with `/`). */
export function drawingLink(rel: string, languageId: string): string {
    return languageId === 'markdown' ? `![](${rel.replace(/ /g, '%20')})` : `[[file:${rel}]]`;
}

/** Title of the org heading at or above 0-based `line`, if any. */
export function headingTitleAbove(content: string, line: number): string | undefined {
    return [...parseOrgHeadings(content, '')].reverse().find(h => h.line <= line + 1)?.title;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

export async function newDrawing(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    const inNote = !!doc && doc.uri.scheme === 'file' && (doc.languageId === 'org' || doc.languageId === 'markdown' || /\.org$/i.test(doc.fileName));

    let target: vscode.Uri;
    if (editor && doc && inNote) {
        const dir = path.dirname(doc.uri.fsPath);
        const title = doc.languageId === 'markdown' ? undefined : headingTitleAbove(doc.getText(), editor.selection.active.line);
        const suggested = `diagrams/${slugify(title ?? path.basename(doc.fileName).replace(/\.[^.]+$/, ''))}.excalidraw.svg`;
        const input = await vscode.window.showInputBox({
            title: 'New drawing',
            prompt: `File for the drawing, relative to ${path.basename(doc.fileName)}`,
            value: suggested,
            valueSelection: [suggested.indexOf('/') + 1, suggested.indexOf('.excalidraw')],
            validateInput: v => (v.trim() ? undefined : 'Enter a file name'),
        });
        if (!input) return;
        target = vscode.Uri.file(path.resolve(dir, drawingFileName(input)));
    } else {
        const base = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const picked = await vscode.window.showSaveDialog({
            title: 'New drawing',
            defaultUri: base ? vscode.Uri.file(path.join(base, 'drawing.excalidraw.svg')) : undefined,
            filters: { 'Excalidraw SVG': ['svg'], Excalidraw: ['excalidraw'] },
        });
        if (!picked) return;
        target = vscode.Uri.file(drawingFileName(picked.fsPath));
    }

    if (await exists(target)) {
        const choice = await vscode.window.showWarningMessage(
            `${path.basename(target.fsPath)} already exists.`, 'Link and Open It', 'Cancel');
        if (choice !== 'Link and Open It') return;
    } else {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
        await vscode.workspace.fs.writeFile(target, new Uint8Array()); // the editor starts an empty scene
    }

    if (editor && doc && inNote) {
        const rel = path.relative(path.dirname(doc.uri.fsPath), target.fsPath).split(path.sep).join('/');
        const link = drawingLink(rel, doc.languageId);
        const pos = editor.selection.active;
        const line = doc.lineAt(pos.line);
        await editor.edit(b => {
            if (!line.text.trim()) b.replace(line.range, link);
            else b.insert(line.range.end, `\n${link}`);
        });
    }
    await vscode.commands.executeCommand('vscode.openWith', target, 'scimax.excalidraw', vscode.ViewColumn.Beside);
}
