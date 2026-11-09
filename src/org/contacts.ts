/**
 * Contacts: every indexed heading with an :EMAIL: property (or a :person:
 * tag) is a contact, like scimax-contacts in Emacs.
 *
 *   * Ana Ramirez                                   :person:
 *     :PROPERTIES:
 *     :EMAIL: ana@example.edu
 *     :END:
 *
 * `scimax.contacts` (C-c C) fuzzy-picks one or more contacts, then acts on
 * them: insert their addresses (bare or `Name <address>`), email them,
 * insert a link, copy, or, for one contact, go to it, add a dated note under
 * it, or insert/copy any of its properties.
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import { HeadingRecord, getPropCaseInsensitive } from '../database/scimaxDbCore';
import { ensureHeadingId } from './dependencyCommands';
import { inactiveTimestamp } from './emailHeading';
import { composeEmail } from './mail';
import { PERSON_TAG, pickMany } from './people';

export interface Contact {
    name: string;
    /** The :EMAIL: value as written (may hold several addresses). */
    email?: string;
    props: Record<string, string>;
    tags: string[];
    filePath: string;
    /** 1-based, as stored in the database. */
    lineNumber: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** A heading title without its trailing :tags:. */
export function stripTags(title: string): string {
    return title.replace(/\s+:[\w@#%:]+:\s*$/, '').trim();
}

/** The first address in an :EMAIL: value ("a@x.org, b@y.org" or "a@x.org b@y.org"). */
export function firstAddress(email: string | undefined): string {
    if (!email) return '';
    const angle = email.match(/<([^>\s]+@[^>\s]+)>/);
    if (angle) return angle[1];
    return email.split(/[\s,;]+/).find(s => s.includes('@')) ?? email.trim();
}

/** `Name <address>`, quoting the name when it holds characters RFC 5322 would misread. */
export function nameAddress(name: string, email: string | undefined): string {
    const address = firstAddress(email);
    if (!address) return name;
    const display = /[,;:<>()[\]@"\\.]/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : name;
    return `${display} <${address}>`;
}

/** Build contacts from heading rows, keeping one per heading. */
export function toContacts(rows: HeadingRecord[]): Contact[] {
    const seen = new Set<string>();
    const contacts: Contact[] = [];
    for (const h of rows) {
        const key = `${h.file_path}:${h.line_number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let props: Record<string, string> = {};
        try { props = JSON.parse(h.properties || '{}'); } catch { props = {}; }
        let tags: string[] = [];
        try { tags = JSON.parse(h.tags || '[]'); } catch { tags = []; }
        const email = getPropCaseInsensitive(props, 'EMAIL')?.trim() || undefined;
        if (!email && !tags.includes(PERSON_TAG)) continue;
        contacts.push({ name: stripTags(h.title), email, props, tags, filePath: h.file_path, lineNumber: h.line_number });
    }
    return contacts.sort((a, b) => a.name.localeCompare(b.name));
}

const ORG_HEADING = /^\*+\s/;
const MD_HEADING = /^#{1,6}\s/;

/**
 * Where a note goes under the heading at `headingLine` (0-based): a new line
 * at the end of the heading's own text, before its first subheading or the
 * next heading, after any trailing blank lines are skipped back over.
 * Returns the 0-based line to insert before.
 */
export function noteInsertLine(lines: string[], headingLine: number, markdown: boolean): number {
    const heading = markdown ? MD_HEADING : ORG_HEADING;
    let fence = false;
    let end = lines.length;
    for (let i = headingLine + 1; i < lines.length; i++) {
        if (markdown && /^\s*(```|~~~)/.test(lines[i])) fence = !fence;
        if (!fence && heading.test(lines[i])) { end = i; break; }
    }
    while (end > headingLine + 1 && lines[end - 1].trim() === '') end--;
    return end;
}

/** The note line itself: a list item starting with an inactive timestamp. */
export function noteLine(date: Date): string {
    return `- ${inactiveTimestamp(date)} `;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** All indexed contacts: headings with an :EMAIL: property or a :person: tag. */
export async function getContacts(): Promise<Contact[] | undefined> {
    const db = await getDatabase();
    if (!db) return undefined;
    const [withEmail, people] = await Promise.all([
        db.searchByProperty('EMAIL') as Promise<HeadingRecord[]>,
        db.searchHeadings('', { tag: PERSON_TAG, limit: 5000 }) as Promise<HeadingRecord[]>,
    ]);
    return toContacts([...withEmail, ...people]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function insertText(editor: vscode.TextEditor, text: string): Promise<void> {
    await editor.edit(eb => {
        for (const sel of editor.selections) eb.replace(sel, text);
    });
}

/** Open the contact's file at its heading. The line is checked against the title, in case the index is stale. */
async function openContact(c: Contact): Promise<{ editor: vscode.TextEditor; line: number }> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(c.filePath));
    const editor = await vscode.window.showTextDocument(doc);
    let line = Math.min(Math.max(0, c.lineNumber - 1), doc.lineCount - 1);
    const isHeadingFor = (n: number) => {
        const text = doc.lineAt(n).text;
        return (ORG_HEADING.test(text) || MD_HEADING.test(text)) && stripTags(text.replace(/^(\*+|#+)\s+/, '')).endsWith(c.name);
    };
    if (!isHeadingFor(line)) {
        for (let n = 0; n < doc.lineCount; n++) {
            if (isHeadingFor(n)) { line = n; break; }
        }
    }
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return { editor, line };
}

async function addNote(c: Contact): Promise<void> {
    const { editor, line } = await openContact(c);
    const doc = editor.document;
    const lines = doc.getText().split(/\r?\n/);
    const markdown = doc.languageId !== 'org' && !doc.fileName.endsWith('.org');
    await vscode.commands.executeCommand('editor.unfold', { selectionLines: [line] });
    const at = noteInsertLine(lines, line, markdown);
    const text = noteLine(new Date());
    // Insert as a new line after line `at - 1`, so the note follows the last text line.
    const prev = new vscode.Position(at - 1, lines[at - 1].length);
    await editor.edit(eb => eb.insert(prev, '\n' + text));
    const cursor = new vscode.Position(at, text.length);
    editor.selection = new vscode.Selection(cursor, cursor);
    editor.revealRange(new vscode.Range(cursor, cursor), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** An `[[id:…][Name]]` link (org) or `[Name](mailto:…)` (Markdown) to the contact. */
async function linkFor(c: Contact, markdown: boolean): Promise<string> {
    if (markdown) {
        const address = firstAddress(c.email);
        return address ? `[${c.name}](mailto:${address})` : c.name;
    }
    let id = getPropCaseInsensitive(c.props, 'ID')?.replace(/^id:/i, '');
    if (!id) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(c.filePath));
        id = await ensureHeadingId(doc, Math.max(0, c.lineNumber - 1));
        if (doc.isDirty) await doc.save();
    }
    return id ? `[[id:${id}][${c.name}]]` : c.name;
}

interface ActionItem extends vscode.QuickPickItem { run: () => Promise<unknown>; }

function buildActions(picked: Contact[], editor: vscode.TextEditor | undefined): ActionItem[] {
    const withEmail = picked.filter(c => c.email);
    const addresses = withEmail.map(c => firstAddress(c.email));
    const named = withEmail.map(c => nameAddress(c.name, c.email));
    const one = picked.length === 1 ? picked[0] : undefined;
    const markdown = !!editor && editor.document.languageId !== 'org' && !editor.document.fileName.endsWith('.org');
    const actions: ActionItem[] = [];

    if (editor && addresses.length) {
        actions.push({ label: '$(mail) Insert email address', detail: addresses.join(', '), run: () => insertText(editor, addresses.join(', ')) });
        actions.push({ label: '$(person) Insert Name <address>', detail: named.join(', '), run: () => insertText(editor, named.join(', ')) });
    }
    if (addresses.length) {
        actions.push({ label: '$(send) Email', detail: named.join(', '), run: () => composeEmail({ to: named.join(', ') }) });
    }
    if (one) {
        actions.push({ label: '$(note) Add a note', detail: 'A dated list item at the end of the contact\'s entry', run: () => addNote(one) });
        actions.push({
            label: '$(go-to-file) Go to contact',
            detail: `${vscode.workspace.asRelativePath(one.filePath)}:${one.lineNumber}`,
            run: () => openContact(one),
        });
    }
    if (editor) {
        actions.push({
            label: '$(link) Insert link',
            detail: markdown ? '[Name](mailto:address)' : '[[id:…][Name]]',
            run: async () => {
                const links: string[] = [];
                for (const c of picked) links.push(await linkFor(c, markdown));
                await insertText(editor, links.join(', '));
            },
        });
    }
    if (addresses.length) {
        actions.push({
            label: '$(clippy) Copy email address',
            detail: addresses.join(', '),
            run: async () => { await vscode.env.clipboard.writeText(addresses.join(', ')); vscode.window.showInformationMessage('Copied.'); },
        });
    }
    if (one) {
        const keys = Object.keys(one.props).filter(k => k.toUpperCase() !== 'ID');
        const chooseField = async () => (await vscode.window.showQuickPick(
            keys.map(k => ({ label: `:${k}:`, description: one.props[k], key: k })),
            { placeHolder: 'Which property?' }
        ))?.key;
        if (keys.length && editor) {
            actions.push({
                label: '$(insert) Insert property…', detail: 'Phone, address, or any other property',
                run: async () => { const k = await chooseField(); if (k) await insertText(editor, one.props[k]); },
            });
        }
        if (keys.length) {
            actions.push({
                label: '$(clippy) Copy property…',
                run: async () => {
                    const k = await chooseField();
                    if (k) { await vscode.env.clipboard.writeText(one.props[k]); vscode.window.showInformationMessage(`Copied :${k}:`); }
                },
            });
        }
        const address = getPropCaseInsensitive(one.props, 'ADDRESS');
        if (address) {
            actions.push({
                label: '$(location) Open in Maps', detail: address,
                run: async () => { await vscode.env.openExternal(vscode.Uri.parse(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`)); },
            });
        }
    }
    return actions;
}

async function contactsCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const contacts = await getContacts();
    if (!contacts) {
        vscode.window.showWarningMessage('Database not available: run "Scimax: Sync Files" first.');
        return;
    }

    type Item = vscode.QuickPickItem & { contact?: Contact; create?: boolean };
    const items: Item[] = contacts.map(c => ({
        label: c.name,
        description: c.email ?? '',
        detail: `${vscode.workspace.asRelativePath(c.filePath)}:${c.lineNumber}`,
        contact: c,
    }));
    items.push({ label: '$(add) New contact…', alwaysShow: true, create: true });

    const picked = await pickMany(items, contacts.length
        ? `Contacts (${contacts.length}): type to filter, Enter to choose; Space checks several`
        : 'No contacts yet: headings with an :EMAIL: property or a :person: tag');
    if (!picked || picked.length === 0) return;
    if (picked.some(i => i.create)) {
        await vscode.commands.executeCommand('scimax.org.newPerson');
        return;
    }
    const chosen = picked.map(i => i.contact!).filter(Boolean);
    const actions = buildActions(chosen, editor);
    const title = chosen.length === 1 ? chosen[0].name : `${chosen.length} contacts`;
    const action = await vscode.window.showQuickPick(actions, { placeHolder: `${title}: choose an action` });
    if (!action) return;
    // Insert actions act on the editor that was active when the command started
    if (editor && action.label.includes('Insert')) {
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    }
    await action.run();
}

export function registerContactCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.contacts', contactsCommand)
    );
}
