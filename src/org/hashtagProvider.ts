/**
 * #hashtags in org and Markdown files: a hover listing the files that use the
 * tag, Ctrl/Cmd+click (and C-c C-o) to pick from every occurrence,
 * scimax.hashtag.show to do that from the command palette, completion of
 * known tags (type `#` and press Tab), and scimax.hashtag.insert (C-c #) to
 * insert one from a list.
 *
 * Other files come from the database's hashtags table; the lines in them are
 * found by reading each file (the open editor's text when it is open, so
 * unsaved edits count).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    findHashtags,
    hashtagAt,
    hashtagPrefixBefore,
    isValidHashtag,
    HashtagMatch,
    HashtagOptions,
} from '../parser/hashtags';
import { isMarkdownPath, markdownTaskTokens, MarkdownTaskTokenKind } from '../parser/markdownTasks';
import { getDatabase } from '../database/lazyDb';
import { isMarkdownLike } from '../shared/markdownLike';
import { setContextKey, trackEditorContext } from '../utils/contextKeys';
import { semanticTokensLegend } from '../highlighting/semanticTokenProvider';

const HOVER_FILE_LIMIT = 10;
const MAX_READ_BYTES = 10 * 1024 * 1024;

/** The languages hashtags work in. */
const LANGUAGES = ['org', 'markdown', 'quarto'];

function commandUri(command: string, args: unknown[]): vscode.Uri {
    return vscode.Uri.parse(`command:${command}?${encodeURIComponent(JSON.stringify(args))}`);
}

function documentLines(document: vscode.TextDocument): string[] {
    return document.getText().split(/\r?\n/);
}

/** Markdown rules for Markdown documents, org rules otherwise. */
function documentOptions(document: vscode.TextDocument): HashtagOptions {
    return { markdown: isMarkdownLike(document.languageId) };
}

function fileOptions(filePath: string): HashtagOptions {
    return { markdown: isMarkdownPath(filePath) };
}

/** Indexed files containing the tag, or [] when there is no database. */
async function filesWithHashtag(tag: string): Promise<string[]> {
    try {
        const db = await getDatabase();
        return db ? await db.findByHashtag(tag) : [];
    } catch {
        return [];
    }
}

/** Every hashtag in the database (lowercased), or [] when there is none. */
async function indexedHashtags(): Promise<string[]> {
    try {
        const db = await getDatabase();
        return db ? await db.getAllHashtags() : [];
    } catch {
        return [];
    }
}

/**
 * Known hashtags: the document's own first (as written there, most used
 * first), then the rest of the database's.
 */
async function knownHashtags(document?: vscode.TextDocument): Promise<{ tag: string; inDocument: number }[]> {
    const counts = new Map<string, { tag: string; inDocument: number }>();
    if (document) {
        for (const h of findHashtags(documentLines(document), documentOptions(document))) {
            const key = h.tag.toLowerCase();
            const entry = counts.get(key);
            if (entry) entry.inDocument++;
            else counts.set(key, { tag: h.tag, inDocument: 1 });
        }
    }
    const local = [...counts.values()].sort((a, b) => b.inDocument - a.inDocument || a.tag.localeCompare(b.tag));
    const others = (await indexedHashtags()).filter(t => !counts.has(t.toLowerCase())).map(tag => ({ tag, inDocument: 0 }));
    return [...local, ...others];
}

/** The text of a file: its open editor's if open, else from disk. */
async function readLines(filePath: string): Promise<string[] | undefined> {
    const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === filePath);
    if (open) return documentLines(open);
    try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > MAX_READ_BYTES) return undefined;
        return (await fs.promises.readFile(filePath, 'utf8')).split(/\r?\n/);
    } catch {
        return undefined;
    }
}

function sameTag(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

interface Occurrence {
    filePath: string;
    match: HashtagMatch;
    text: string;
}

/** Every occurrence of the tag: the given file first, then indexed files. */
async function findOccurrences(tag: string, currentFile?: string): Promise<Occurrence[]> {
    const files = await filesWithHashtag(tag);
    const ordered = currentFile ? [currentFile, ...files.filter(f => f !== currentFile)] : files;
    const result: Occurrence[] = [];
    for (const filePath of ordered) {
        const lines = await readLines(filePath);
        if (!lines) continue;
        for (const match of findHashtags(lines, fileOptions(filePath))) {
            if (sameTag(match.tag, tag)) {
                result.push({ filePath, match, text: lines[match.line] });
            }
        }
    }
    return result;
}

async function revealOccurrence(filePath: string, line: number, start: number, end: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc);
    const range = new vscode.Range(line, start, line, end);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Pick from every occurrence of a hashtag. With no tag, use the hashtag at
 * the cursor, or fall back to choosing one from the database.
 */
export async function showHashtagOccurrences(tag?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (typeof tag !== 'string' || !tag) {
        const here = hashtagAtCursor();
        if (!here) {
            await vscode.commands.executeCommand('scimax.db.searchHashtags');
            return;
        }
        tag = here.tag;
    }

    const currentFile = editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    const occurrences = await findOccurrences(tag, currentFile);
    if (occurrences.length === 0) {
        vscode.window.showInformationMessage(`No occurrences of #${tag} found`);
        return;
    }

    const fileCount = new Set(occurrences.map(o => o.filePath)).size;
    type Item = vscode.QuickPickItem & { occurrence?: Occurrence };
    const items: Item[] = [];
    let lastFile = '';
    for (const o of occurrences) {
        if (o.filePath !== lastFile) {
            items.push({ label: path.basename(o.filePath), kind: vscode.QuickPickItemKind.Separator });
            lastFile = o.filePath;
        }
        items.push({
            label: o.text.trim() || `#${o.match.tag}`,
            description: `${path.basename(o.filePath)}:${o.match.line + 1}`,
            detail: o.filePath === currentFile ? undefined : path.dirname(o.filePath),
            occurrence: o,
        });
    }

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `#${tag}: ${occurrences.length} occurrence${occurrences.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    const o = picked?.occurrence;
    if (o) await revealOccurrence(o.filePath, o.match.line, o.match.start, o.match.end);
}

/** Open a file at the first occurrence of a hashtag (hover links). */
async function openFileAtHashtag(filePath: string, tag: string): Promise<void> {
    const lines = await readLines(filePath);
    const first = lines && findHashtags(lines, fileOptions(filePath)).find(m => sameTag(m.tag, tag));
    if (first) {
        await revealOccurrence(filePath, first.line, first.start, first.end);
    } else {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(filePath));
    }
}

export class HashtagHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        const lines = documentLines(document);
        const options = documentOptions(document);
        const here = hashtagAt(lines, position.line, position.character, options);
        if (!here) return null;

        const tag = here.tag;
        const inThisFile = findHashtags(lines, options).filter(m => sameTag(m.tag, tag)).length;
        const thisPath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
        const others = (await filesWithHashtag(tag)).filter(f => f !== thisPath);

        const md = new vscode.MarkdownString();
        md.isTrusted = { enabledCommands: ['scimax.hashtag.show', 'scimax.hashtag.openFile'] };
        md.appendMarkdown(`**#${tag}**: ${inThisFile} in this file`);
        md.appendMarkdown(others.length
            ? `, used in ${others.length} other file${others.length === 1 ? '' : 's'}\n\n`
            : ', in no other indexed file\n\n');
        for (const f of others.slice(0, HOVER_FILE_LIMIT)) {
            const link = commandUri('scimax.hashtag.openFile', [f, tag]);
            md.appendMarkdown(`- [${path.basename(f)}](${link}) — ${path.dirname(f)}\n`);
        }
        if (others.length > HOVER_FILE_LIMIT) {
            md.appendMarkdown(`- …and ${others.length - HOVER_FILE_LIMIT} more\n`);
        }
        md.appendMarkdown(`\n[Show all occurrences](${commandUri('scimax.hashtag.show', [tag])}) (Ctrl/Cmd+click the tag)`);
        return new vscode.Hover(md, new vscode.Range(here.line, here.start, here.line, here.end));
    }
}

export class HashtagLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        return findHashtags(documentLines(document), documentOptions(document)).map(h => {
            const link = new vscode.DocumentLink(
                new vscode.Range(h.line, h.start, h.line, h.end),
                commandUri('scimax.hashtag.show', [h.tag])
            );
            link.tooltip = `Show every #${h.tag}`;
            return link;
        });
    }
}

/**
 * Hashtag and task colouring in Markdown. Org files get theirs from the org
 * grammar and semantic token provider; Markdown has no provider of its own,
 * so this one sends the hashtags and the task parts of headings (TODO
 * keyword, priority, tags, planning line), with the org token types, so
 * they take org's colours.
 */
export class MarkdownHashtagTokenProvider implements vscode.DocumentSemanticTokensProvider {
    provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
        const types = semanticTokensLegend.tokenTypes;
        const mods = semanticTokensLegend.tokenModifiers;
        const typeOf: Record<MarkdownTaskTokenKind, [string, string?]> = {
            todo: ['orgTodo'],
            done: ['orgDone', 'done'],
            priority: ['orgPriority'],
            tag: ['orgTag'],
            planning: ['orgPlanning'],
            timestamp: ['orgTimestamp', 'active'],
            inactiveTimestamp: ['orgTimestamp', 'inactive'],
        };
        const all: [number, number, number, number, number][] = [];
        const hashtag = types.indexOf('orgHashtag');
        for (const h of findHashtags(documentLines(document), { markdown: true })) {
            all.push([h.line, h.start, h.end - h.start, hashtag, 0]);
        }
        for (const t of markdownTaskTokens(document.getText())) {
            const [type, mod] = typeOf[t.kind];
            all.push([t.line, t.start, t.length, types.indexOf(type), mod ? 1 << mods.indexOf(mod) : 0]);
        }
        all.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
        for (const t of all) builder.push(...t);
        return builder.build();
    }
}

/**
 * Completion of known hashtags after `#`. Shown by Tab after `#` or a
 * partly typed tag (scimax.hashtag.complete), by Ctrl+Space, and as you type
 * where quick suggestions are on.
 */
export class HashtagCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[] | undefined> {
        const before = document.lineAt(position.line).text.slice(0, position.character);
        const typed = hashtagPrefixBefore(before);
        if (!typed) return undefined;
        // `#` at the start of a Markdown line followed by a space is a heading,
        // and in org a comment; only a tag right after `#` is completed.
        const range = new vscode.Range(position.line, typed.start, position.line, position.character);
        const known = await knownHashtags(document);
        return known.map(({ tag, inDocument }, i) => {
            const item = new vscode.CompletionItem(`#${tag}`, vscode.CompletionItemKind.Keyword);
            item.insertText = `#${tag}`;
            item.filterText = `#${tag}`;
            item.range = range;
            item.sortText = String(i).padStart(6, '0');
            item.detail = inDocument ? `${inDocument} in this file` : 'hashtag in other files';
            return item;
        });
    }
}

/** The hashtag at the cursor in the active editor, if any. */
export function hashtagAtCursor(): HashtagMatch | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const pos = editor.selection.active;
    return hashtagAt(documentLines(editor.document), pos.line, pos.character, documentOptions(editor.document));
}

/**
 * Insert a hashtag chosen from the known ones, or a new one typed in the
 * picker. A space goes before it when needed, so it reads as a hashtag.
 */
export async function insertHashtag(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;
    const known = await knownHashtags(document);

    type Item = vscode.QuickPickItem & { tag: string };
    const quickPick = vscode.window.createQuickPick<Item>();
    const knownItems: Item[] = known.map(({ tag, inDocument }) => ({
        label: `#${tag}`,
        description: inDocument ? `${inDocument} in this file` : undefined,
        tag,
    }));
    quickPick.items = knownItems;
    quickPick.placeholder = 'Hashtag to insert (type a new one to create it)';
    quickPick.onDidChangeValue(value => {
        const tag = value.trim().replace(/^#/, '');
        const exists = known.some(k => sameTag(k.tag, tag));
        quickPick.items = tag && isValidHashtag(tag) && !exists
            ? [{ label: `#${tag}`, description: 'new hashtag', tag, alwaysShow: true }, ...knownItems]
            : knownItems;
    });

    const tag = await new Promise<string | undefined>(resolve => {
        quickPick.onDidAccept(() => {
            const chosen = quickPick.selectedItems[0]?.tag ?? quickPick.value.trim().replace(/^#/, '');
            resolve(chosen);
            quickPick.hide();
        });
        quickPick.onDidHide(() => resolve(undefined));
        quickPick.show();
    });
    quickPick.dispose();
    if (!tag) return;
    if (!isValidHashtag(tag)) {
        vscode.window.showWarningMessage(`#${tag} is not a hashtag: start with a letter, then letters, digits, _ or -`);
        return;
    }

    await editor.edit(edit => {
        for (const selection of editor.selections) {
            const pos = selection.active;
            const lineText = document.lineAt(pos.line).text;
            const prev = lineText.slice(0, pos.character);
            const typed = hashtagPrefixBefore(prev);
            if (typed && selection.isEmpty) {
                // Finish a `#ta` already typed.
                edit.replace(new vscode.Range(pos.line, typed.start, pos.line, pos.character), `#${tag}`);
            } else {
                const space = prev === '' || /[\s(]$/.test(prev) ? '' : ' ';
                edit.replace(selection, `${space}#${tag}`);
            }
        }
    });
}

/** Tab completes a hashtag when the text before the cursor is `#` or `#ta`. */
function updateHashtagContext(editor: vscode.TextEditor | undefined): void {
    let after = false;
    if (editor && LANGUAGES.includes(editor.document.languageId) && editor.selection.isEmpty) {
        const pos = editor.selection.active;
        const before = editor.document.lineAt(pos.line).text.slice(0, pos.character);
        after = hashtagPrefixBefore(before) !== undefined;
    }
    setContextKey('scimax.afterHashtagPrefix', after);
}

export function registerHashtagProvider(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = LANGUAGES.map(language => ({ language, scheme: 'file' }));
    const markdown: vscode.DocumentSelector = ['markdown', 'quarto'].map(language => ({ language, scheme: 'file' }));
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(selector, new HashtagHoverProvider()),
        vscode.languages.registerDocumentLinkProvider(selector, new HashtagLinkProvider()),
        vscode.languages.registerCompletionItemProvider(selector, new HashtagCompletionProvider()),
        vscode.languages.registerDocumentSemanticTokensProvider(markdown, new MarkdownHashtagTokenProvider(), semanticTokensLegend),
        vscode.commands.registerCommand('scimax.hashtag.show', (tag?: string) => showHashtagOccurrences(tag)),
        vscode.commands.registerCommand('scimax.hashtag.openFile', (filePath: string, tag: string) => openFileAtHashtag(filePath, tag)),
        vscode.commands.registerCommand('scimax.hashtag.insert', insertHashtag),
        vscode.commands.registerCommand('scimax.hashtag.complete', () => vscode.commands.executeCommand('editor.action.triggerSuggest')),
    );
    trackEditorContext(context, updateHashtagContext);
}
