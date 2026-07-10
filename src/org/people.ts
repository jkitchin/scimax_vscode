/**
 * People database + assignee autocomplete.
 *
 * A "person" is simply an org heading tagged :person: with contact properties:
 *
 *   * John Kitchin                    :person:
 *     :PROPERTIES:
 *     :ID: person-jrk
 *     :EMAIL: jkitchin@andrew.cmu.edu
 *     :NICK: jrk
 *     :ROLE: PI
 *     :END:
 *
 * These headings are already indexed in the database, so people are queried
 * with the existing tag search. Tasks reference a person by handle (their :NICK:,
 * or a slug of their name) in the :ASSIGNEE: property. This module provides:
 *   - completion of assignee handles while editing an :ASSIGNEE: line,
 *   - a hover showing a person's name/email/role over an assignee handle,
 *   - a "New Person" capture command, and
 *   - handle -> person resolution for other features.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDatabase } from '../database/lazyDb';
import { getPropCaseInsensitive } from '../database/scimaxDbCore';
import { slugify, ASSIGNEE_PROPERTY } from '../parser/projectTasks';
import { getHeadingLevel } from './speedCommands/context';
import { setPropertyValue } from './speedCommands/metadata';

export const PERSON_TAG = 'person';

export interface Person {
    handle: string;      // :NICK: or slug(name)
    name: string;        // heading title
    email?: string;
    role?: string;
    id?: string;
    filePath: string;
    lineNumber: number;
}

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

/** A line like `  :ASSIGNEE: jrk ana` (the value portion, up to the cursor). */
const ASSIGNEE_LINE_RE = /^(\s*:ASSIGNEE:\s*)(.*)$/i;

// Short-lived cache so a burst of completions/hovers doesn't re-query the DB on
// every keystroke. Invalidated on save (see registerPeopleProviders).
let peopleCache: Person[] | null = null;
let peopleCacheAt = 0;
const PEOPLE_CACHE_TTL_MS = 5000;

/** Drop the cached people list (call when :person: headings may have changed). */
export function invalidatePeopleCache(): void {
    peopleCache = null;
}

/** Query all indexed :person: headings and map them to Person records (cached). */
export async function getPeople(): Promise<Person[]> {
    if (peopleCache && Date.now() - peopleCacheAt < PEOPLE_CACHE_TTL_MS) {
        return peopleCache;
    }
    const db = await getDatabase();
    if (!db) return [];
    const rows = await db.searchHeadings('', { tag: PERSON_TAG, limit: 2000 });
    const people: Person[] = [];
    for (const h of rows) {
        let props: Record<string, string> = {};
        try { props = JSON.parse(h.properties || '{}'); } catch { props = {}; }
        const name = h.title.replace(/\s+:[\w@#%:]+:\s*$/, '').trim();
        const nick = getPropCaseInsensitive(props, 'NICK');
        people.push({
            handle: (nick || slugify(name)).trim(),
            name,
            email: getPropCaseInsensitive(props, 'EMAIL'),
            role: getPropCaseInsensitive(props, 'ROLE'),
            id: getPropCaseInsensitive(props, 'ID')?.replace(/^id:/i, ''),
            filePath: h.file_path,
            lineNumber: h.line_number,
        });
    }
    peopleCache = people;
    peopleCacheAt = Date.now();
    return people;
}

/** Resolve an assignee handle to a person (by handle, then name slug). */
export async function resolvePerson(handle: string): Promise<Person | undefined> {
    const key = handle.trim().toLowerCase();
    if (!key) return undefined;
    const people = await getPeople();
    return people.find(p => p.handle.toLowerCase() === key)
        ?? people.find(p => slugify(p.name) === slugify(handle));
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

class AssigneeCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[]> {
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        if (!ASSIGNEE_LINE_RE.test(document.lineAt(position.line).text)) return [];
        // Only offer completions within the value portion (after the property key).
        const keyMatch = document.lineAt(position.line).text.match(/^(\s*:ASSIGNEE:\s*)/i);
        if (!keyMatch || position.character < keyMatch[1].length) return [];

        const people = await getPeople();
        // The token currently being typed (handles are whitespace/comma separated).
        const tokenMatch = linePrefix.match(/[^\s,]*$/);
        const tokenStart = position.character - (tokenMatch ? tokenMatch[0].length : 0);
        const replaceRange = new vscode.Range(position.line, tokenStart, position.line, position.character);

        return people.map(p => {
            const item = new vscode.CompletionItem(p.handle, vscode.CompletionItemKind.User);
            item.detail = p.name + (p.role ? ` (${p.role})` : '');
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${p.name}**\n\n`);
            if (p.email) md.appendMarkdown(`✉️ ${p.email}\n\n`);
            if (p.role) md.appendMarkdown(`Role: ${p.role}`);
            item.documentation = md;
            item.filterText = `${p.handle} ${p.name}`;
            item.insertText = p.handle;
            item.range = replaceRange;
            return item;
        });
    }
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

class AssigneeHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const line = document.lineAt(position.line).text;
        const m = line.match(ASSIGNEE_LINE_RE);
        if (!m) return undefined;
        const wordRange = document.getWordRangeAtPosition(position, /[^\s,]+/);
        if (!wordRange) return undefined;
        const handle = document.getText(wordRange);
        if (handle.toLowerCase() === 'assignee') return undefined;

        const person = await resolvePerson(handle);
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        if (!person) {
            md.appendMarkdown(`⚠️ Unknown assignee **${handle}** — no \`:person:\` heading found.`);
            return new vscode.Hover(md, wordRange);
        }
        md.appendMarkdown(`**${person.name}**\n\n`);
        if (person.email) md.appendMarkdown(`✉️ [${person.email}](mailto:${person.email})\n\n`);
        if (person.role) md.appendMarkdown(`Role: ${person.role}\n\n`);
        return new vscode.Hover(md, wordRange);
    }
}

// ---------------------------------------------------------------------------
// New Person capture
// ---------------------------------------------------------------------------

function getScimaxDir(): string {
    const dir = vscode.workspace.getConfiguration('scimax').get<string>('directory') || '';
    return dir ? dir.replace(/^~(?=$|\/)/, os.homedir()) : path.join(os.homedir(), 'scimax');
}

function resolvePeopleSetting(): string {
    const file = vscode.workspace.getConfiguration('scimax.org').get<string>('peopleFile') || '';
    if (file) return file.replace(/^~(?=$|\/)/, os.homedir());
    return path.join(getScimaxDir(), 'people.org');
}

async function newPersonCommand(): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Person name', placeHolder: 'Jane Doe' });
    if (!name) return;
    const email = await vscode.window.showInputBox({ prompt: 'Email (optional)', placeHolder: 'jane@example.com' });
    const nick = await vscode.window.showInputBox({
        prompt: 'Handle / nick (optional)',
        value: slugify(name),
    });
    const role = await vscode.window.showInputBox({ prompt: 'Role (optional)', placeHolder: 'PI, student, collaborator…' });

    const target = resolvePeopleSetting();
    const id = `person-${slugify(name)}`;
    const lines = [
        `* ${name}\t\t:${PERSON_TAG}:`,
        '  :PROPERTIES:',
        `  :ID: ${id}`,
        ...(nick ? [`  :NICK: ${nick.trim()}`] : []),
        ...(email ? [`  :EMAIL: ${email.trim()}`] : []),
        ...(role ? [`  :ROLE: ${role.trim()}`] : []),
        '  :END:',
        '',
    ];

    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const prefix = fs.existsSync(target) && fs.readFileSync(target, 'utf8').length > 0 ? '\n' : '';
        fs.appendFileSync(target, prefix + lines.join('\n') + '\n');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        await vscode.window.showTextDocument(doc);
        // Re-index so the new person is immediately available for completion.
        const db = await getDatabase();
        if (db) await db.indexFile(target);
        vscode.window.showInformationMessage(`Added person "${name}".`);
    } catch (e) {
        vscode.window.showErrorMessage(`Could not write person: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// ---------------------------------------------------------------------------
// Assign task
// ---------------------------------------------------------------------------

/** Handles already on this heading: the :ASSIGNEE: value plus any @tag on the headline. */
function currentAssignees(document: vscode.TextDocument, headingLine: number): Set<string> {
    const handles = new Set<string>();
    // @tags on the headline itself.
    const tagMatch = document.lineAt(headingLine).text.match(/:([\w@#%:]+):\s*$/);
    if (tagMatch) {
        for (const tag of tagMatch[1].split(':')) {
            if (tag.startsWith('@') && tag.length > 1) handles.add(tag.slice(1).toLowerCase());
        }
    }
    // :ASSIGNEE: value in the entry's PROPERTIES drawer (stop at the next heading).
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        if (getHeadingLevel(document, i) > 0) break;
        const m = document.lineAt(i).text.match(ASSIGNEE_LINE_RE);
        if (m) {
            for (const h of m[2].split(/[\s,]+/)) if (h) handles.add(h.toLowerCase());
            break;
        }
    }
    return handles;
}

/**
 * Assign the current task to one or more people: pick from the indexed :person:
 * headings (fuzzy match on handle, name, role, or email), then set the heading's
 * :ASSIGNEE: property to the chosen handles.
 */
async function assignTaskCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;
    if (!isOrg(document)) {
        vscode.window.showInformationMessage('Assign task: not an org file.');
        return;
    }

    // Find the enclosing heading (works from anywhere in the entry).
    let headingLine = -1;
    for (let i = editor.selection.active.line; i >= 0; i--) {
        if (getHeadingLevel(document, i) > 0) { headingLine = i; break; }
    }
    if (headingLine < 0) {
        vscode.window.showInformationMessage('Assign task: not under a heading.');
        return;
    }

    const people = await getPeople();
    if (people.length === 0) {
        const choice = await vscode.window.showInformationMessage(
            'No :person: headings are indexed. Create one first?', 'New Person');
        if (choice === 'New Person') await newPersonCommand();
        return;
    }

    const current = currentAssignees(document, headingLine);
    const items = people
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({
            label: p.handle,
            description: p.name + (p.role ? ` · ${p.role}` : ''),
            detail: p.email,
            picked: current.has(p.handle.toLowerCase()),
        }));

    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: 'Assign to… (fuzzy-match handle, name, role, or email; pick one or more)',
    });
    if (!picked) return; // cancelled

    const handles = picked.map(i => i.label).join(' ');
    await setPropertyValue(editor, headingLine, ASSIGNEE_PROPERTY, handles);
    vscode.window.showInformationMessage(
        handles ? `Assigned to ${handles}.` : 'Cleared assignee.');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPeopleProviders(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = [{ language: 'org' }, { pattern: '**/*.org' }];
    context.subscriptions.push(
        // No trigger characters: VS Code already invokes the provider as word
        // characters are typed. Registering ' '/':' as triggers would fire the
        // whole completion pipeline on every space/colon in an org file (a big
        // per-keystroke cost); the provider gates itself to :ASSIGNEE: lines.
        vscode.languages.registerCompletionItemProvider(selector, new AssigneeCompletionProvider()),
        vscode.languages.registerHoverProvider(selector, new AssigneeHoverProvider()),
        vscode.commands.registerCommand('scimax.org.newPerson', newPersonCommand),
        vscode.commands.registerCommand('scimax.org.assignTask', assignTaskCommand),
        vscode.workspace.onDidSaveTextDocument(doc => { if (isOrg(doc)) invalidatePeopleCache(); })
    );
}
