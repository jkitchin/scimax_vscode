/**
 * scimax.ref.findCitations: every place a BibTeX key is cited.
 *
 * Files searched: indexed files whose text contains the key (from the
 * database, so files outside the workspace count), the workspace's org,
 * Markdown and TeX files, and open editors (whose unsaved text is used).
 * Each candidate is read and its citations parsed (./citationUsages.ts), so
 * a key that only appears in prose is not counted.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getDatabase } from '../database/lazyDb';
import { findCitationAtPosition, findReferenceIndexAtPosition } from './citationParser';
import { findKeyUsages, bibtexKeyAtLine, KeyUsage } from './citationUsages';
import type { ReferenceManager } from './referenceManager';

const CITING_EXTENSIONS = /\.(org|md|markdown|qmd|rmd|tex)$/i;
const MAX_READ_BYTES = 10 * 1024 * 1024;

export interface CitationUsage extends KeyUsage {
    filePath: string;
    text: string;
}

function linesOf(text: string): string[] {
    return text.split(/\r?\n/);
}

/** The citation key at the cursor, or the BibTeX entry the cursor is in. */
export function citationKeyAtCursor(editor: vscode.TextEditor | undefined): string | undefined {
    if (!editor) return undefined;
    const doc = editor.document;
    const pos = editor.selection.active;
    if (doc.languageId === 'bibtex' || doc.fileName.endsWith('.bib')) {
        return bibtexKeyAtLine(linesOf(doc.getText()), pos.line);
    }
    const line = doc.lineAt(pos.line).text;
    const citation = findCitationAtPosition(line, pos.character);
    if (!citation || citation.references.length === 0) return undefined;
    const index = findReferenceIndexAtPosition(citation, line, pos.character);
    return citation.references[index >= 0 ? index : 0]?.key;
}

async function candidateFiles(key: string): Promise<string[]> {
    const files = new Set<string>();
    try {
        const db = await getDatabase();
        if (db) {
            for (const f of await db.findFilesContaining(key)) {
                if (CITING_EXTENSIONS.test(f)) files.add(f);
            }
        }
    } catch {
        // No database: the workspace and open editors are still searched.
    }
    const workspaceFiles = await vscode.workspace.findFiles(
        '**/*.{org,md,markdown,qmd,rmd,tex}',
        '{**/node_modules/**,**/.git/**}'
    );
    for (const uri of workspaceFiles) files.add(uri.fsPath);
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file' && CITING_EXTENSIONS.test(doc.fileName)) files.add(doc.uri.fsPath);
    }
    return [...files];
}

async function readText(filePath: string): Promise<string | undefined> {
    const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === filePath);
    if (open) return open.getText();
    try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > MAX_READ_BYTES) return undefined;
        return await fs.promises.readFile(filePath, 'utf8');
    } catch {
        return undefined;
    }
}

/** Every citation of `key`, files sorted by path, lines in order. */
export async function findCitationUsages(key: string, token?: vscode.CancellationToken): Promise<CitationUsage[]> {
    const lowerKey = key.toLowerCase();
    const usages: CitationUsage[] = [];
    const files = (await candidateFiles(key)).sort();
    for (const filePath of files) {
        if (token?.isCancellationRequested) break;
        const text = await readText(filePath);
        if (!text || !text.toLowerCase().includes(lowerKey)) continue;
        const lines = linesOf(text);
        for (const u of findKeyUsages(lines, key, filePath)) {
            usages.push({ ...u, filePath, text: lines[u.line] });
        }
    }
    return usages;
}

async function reveal(u: CitationUsage): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(u.filePath);
    const editor = await vscode.window.showTextDocument(doc);
    const range = new vscode.Range(u.line, u.start, u.line, u.end);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** List every citation of `key`, grouped by file, and jump to the one picked. */
export async function showCitationUsages(key: string): Promise<void> {
    const usages = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Finding citations of ${key}...`, cancellable: true },
        (_progress, token) => findCitationUsages(key, token)
    );
    if (usages.length === 0) {
        vscode.window.showInformationMessage(`No citations of ${key} found`);
        return;
    }

    const fileCount = new Set(usages.map(u => u.filePath)).size;
    const home = process.env.HOME || '';
    const shortDir = (f: string) => {
        const dir = path.dirname(f);
        return home && dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
    };

    type Item = vscode.QuickPickItem & { usage?: CitationUsage };
    const items: Item[] = [];
    let lastFile = '';
    for (const u of usages) {
        if (u.filePath !== lastFile) {
            items.push({ label: `${path.basename(u.filePath)}  ${shortDir(u.filePath)}`, kind: vscode.QuickPickItemKind.Separator });
            lastFile = u.filePath;
        }
        items.push({
            label: u.text.trim(),
            description: `${path.basename(u.filePath)}:${u.line + 1}`,
            usage: u,
        });
    }

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${key}: cited ${usages.length} time${usages.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`,
        matchOnDescription: true,
    });
    if (picked?.usage) await reveal(picked.usage);
}

/**
 * The command: a key argument, else the citation (or BibTeX entry) at the
 * cursor, else a key picked from the loaded bibliographies.
 */
export async function findCitationsCommand(manager: ReferenceManager, key?: unknown): Promise<void> {
    let citeKey = typeof key === 'string' && key ? key : citationKeyAtCursor(vscode.window.activeTextEditor);
    if (!citeKey) {
        const items = manager.getAllEntries().map(entry => manager.formatForQuickPick(entry));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select reference to find citations',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        citeKey = selected?.entry.key;
    }
    if (citeKey) await showCitationUsages(citeKey);
}
