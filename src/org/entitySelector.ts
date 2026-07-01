/**
 * Entity selector — org-mode as a contact / location / resource manager.
 *
 * A fuzzy picker over headings filtered by a tag or property, with actions on the
 * chosen heading: insert an `[[id:…][Title]]` link, insert/copy a field value
 * (email, address, …), open externally (mailto / maps / url), or jump to it.
 *
 * "Entity types" are pure configuration (`scimax.org.entities`), so adding a new
 * kind — Reagents, Resources, Equipment — needs no code. Contacts (`:person:`)
 * and Locations (`:location:`) ship as defaults. An ad-hoc "By tag…/By property…"
 * path selects any tag/property with zero configuration.
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import { HeadingRecord, getPropCaseInsensitive } from '../database/scimaxDbCore';
import { ensureHeadingId } from './dependencyCommands';

/** A configured (or ad-hoc) entity type: how to select and act on headings. */
export interface EntityType {
    name: string;
    /** Select headings carrying this tag. */
    tag?: string;
    /** Select headings that have this property (optionally equal to `value`). */
    property?: string;
    value?: string;
    /** Property whose value is shown in the picker line. */
    display?: string;
    /** Property holding an email (default EMAIL) → mailto action. */
    email?: string;
    /** Property holding a postal address (default ADDRESS) → maps action. */
    address?: string;
    /** Property holding a web URL → open-link action (off unless set). */
    url?: string;
}

const DEFAULT_ENTITIES: EntityType[] = [
    { name: 'Contacts', tag: 'person', display: 'EMAIL', email: 'EMAIL' },
    { name: 'Locations', tag: 'location', display: 'ADDRESS', address: 'ADDRESS' },
];

/** Built-in defaults merged with the user's `scimax.org.entities` (user wins by name). */
export function loadEntityTypes(): EntityType[] {
    const user = vscode.workspace.getConfiguration('scimax.org').get<EntityType[]>('entities', []) || [];
    const byName = new Map<string, EntityType>();
    for (const e of DEFAULT_ENTITIES) byName.set(e.name.toLowerCase(), e);
    for (const e of user) if (e && e.name) byName.set(e.name.toLowerCase(), e);
    return [...byName.values()];
}

function stripTags(title: string): string {
    return title.replace(/\s+:[\w@#%:]+:\s*$/, '').trim();
}

function parseProps(h: HeadingRecord): Record<string, string> {
    try { return JSON.parse(h.properties || '{}'); } catch { return {}; }
}

/** Google Maps search URL for a postal address. */
export function mapsUrl(address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** mailto: URL for an email address. */
export function mailtoUrl(email: string): string {
    return `mailto:${email.trim()}`;
}

/** Org link to a heading by id, with its title as the description. */
export function idLink(id: string, title: string): string {
    return `[[id:${id}][${title}]]`;
}

/** Headings matching an entity type (tag and/or property; intersect if both). */
export async function queryEntities(db: any, type: EntityType): Promise<HeadingRecord[]> {
    let results: HeadingRecord[] = [];
    if (type.tag) {
        results = await db.searchHeadings('', { tag: type.tag, limit: 2000 });
    }
    if (type.property) {
        const byProp: HeadingRecord[] = await db.searchByProperty(type.property, type.value);
        results = type.tag
            ? results.filter(r => byProp.some(p => p.id === r.id))
            : byProp;
    }
    if (!type.tag && !type.property) {
        results = await db.searchHeadings('', { limit: 2000 });
    }
    return results;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function insertAtCursor(editor: vscode.TextEditor | undefined, text: string): Promise<boolean> {
    if (!editor) {
        vscode.window.showWarningMessage('No active editor to insert into.');
        return false;
    }
    await editor.edit(eb => eb.insert(editor.selection.active, text));
    return true;
}

async function revealHeading(filePath: string, lineNumber: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const editor = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(Math.max(0, lineNumber - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/** Ensure the chosen heading has an :ID: (opening its file if needed) and return an org link. */
async function linkForHeading(h: HeadingRecord): Promise<string | undefined> {
    const props = parseProps(h);
    let id = getPropCaseInsensitive(props, 'ID')?.replace(/^id:/i, '');
    if (!id) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(h.file_path));
        id = await ensureHeadingId(doc, Math.max(0, h.line_number - 1));
        if (doc.isDirty) await doc.save();
    }
    return id ? idLink(id, stripTags(h.title)) : undefined;
}

interface ActionItem extends vscode.QuickPickItem { run: () => Promise<void>; }

function buildActions(
    h: HeadingRecord,
    type: EntityType,
    originEditor: vscode.TextEditor | undefined
): ActionItem[] {
    const props = parseProps(h);
    const title = stripTags(h.title);
    const actions: ActionItem[] = [];

    if (originEditor) {
        actions.push({
            label: '$(link) Insert link', detail: `[[id:…][${title}]]`,
            run: async () => {
                const link = await linkForHeading(h);
                if (link) await insertAtCursor(originEditor, link);
                else vscode.window.showErrorMessage('Could not assign an ID to the target heading.');
            },
        });
    }
    actions.push({
        label: '$(clippy) Copy link', detail: `[[id:…][${title}]]`,
        run: async () => {
            const link = await linkForHeading(h);
            if (link) { await vscode.env.clipboard.writeText(link); vscode.window.showInformationMessage('Link copied.'); }
        },
    });

    // Field insert/copy — the display field first (if present), then any property.
    const fieldKeys = Object.keys(props).filter(k => k.toUpperCase() !== 'ID');
    const chooseField = async (): Promise<string | undefined> => {
        const items = fieldKeys.map(k => ({ label: `:${k}:`, description: props[k], key: k }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Which field?' });
        return picked?.key;
    };
    if (fieldKeys.length) {
        if (originEditor) {
            actions.push({
                label: '$(insert) Insert field…', detail: 'insert a property value at the cursor',
                run: async () => { const k = await chooseField(); if (k) await insertAtCursor(originEditor, props[k]); },
            });
        }
        actions.push({
            label: '$(clippy) Copy field…', detail: 'copy a property value',
            run: async () => {
                const k = await chooseField();
                if (k) { await vscode.env.clipboard.writeText(props[k]); vscode.window.showInformationMessage(`Copied :${k}:`); }
            },
        });
    }

    // External openers, only when the relevant property exists.
    const email = getPropCaseInsensitive(props, type.email || 'EMAIL');
    if (email) {
        actions.push({
            label: '$(mail) Email', detail: email,
            run: async () => { await vscode.env.openExternal(vscode.Uri.parse(mailtoUrl(email))); },
        });
    }
    const address = getPropCaseInsensitive(props, type.address || 'ADDRESS');
    if (address) {
        actions.push({
            label: '$(location) Open in Maps', detail: address,
            run: async () => { await vscode.env.openExternal(vscode.Uri.parse(mapsUrl(address))); },
        });
    }
    const url = type.url ? getPropCaseInsensitive(props, type.url) : undefined;
    if (url) {
        actions.push({
            label: '$(globe) Open link', detail: url,
            run: async () => { await vscode.env.openExternal(vscode.Uri.parse(url)); },
        });
    }

    actions.push({
        label: '$(go-to-file) Go to heading',
        detail: `${vscode.workspace.asRelativePath(h.file_path)}:${h.line_number}`,
        run: async () => { await revealHeading(h.file_path, h.line_number); },
    });

    return actions;
}

// ---------------------------------------------------------------------------
// Command flow
// ---------------------------------------------------------------------------

/** Special sentinels for the ad-hoc entries in the type picker. */
const BY_TAG = ' by-tag';
const BY_PROPERTY = ' by-property';

async function chooseEntityType(db: any): Promise<EntityType | undefined> {
    const types = loadEntityTypes();
    const items: (vscode.QuickPickItem & { type?: EntityType; special?: string })[] = types.map(t => ({
        label: t.name,
        description: t.tag ? `:${t.tag}:` : t.property ? `:${t.property}:` : '',
        type: t,
    }));
    items.push({ label: '$(tag) By tag…', description: 'select any tag', special: BY_TAG });
    items.push({ label: '$(symbol-property) By property…', description: 'select by a property', special: BY_PROPERTY });

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select an entity type' });
    if (!picked) return undefined;
    if (picked.type) return picked.type;

    if (picked.special === BY_TAG) {
        const tags: string[] = await db.getAllTags();
        if (!tags.length) { vscode.window.showInformationMessage('No tags found in indexed files.'); return undefined; }
        const tag = await vscode.window.showQuickPick(tags.map(t => ({ label: `:${t}:`, tag: t })), { placeHolder: 'Select a tag' });
        return tag ? { name: tag.tag, tag: tag.tag } : undefined;
    }
    if (picked.special === BY_PROPERTY) {
        const property = await vscode.window.showInputBox({ prompt: 'Property name', placeHolder: 'e.g. EMAIL, CAS, CATEGORY' });
        if (!property) return undefined;
        const value = await vscode.window.showInputBox({ prompt: `Value for :${property}: (blank = any)` });
        return { name: property, property, value: value || undefined, display: property };
    }
    return undefined;
}

async function pickEntityCommand(): Promise<void> {
    const originEditor = vscode.window.activeTextEditor;
    const db = await getDatabase();
    if (!db) { vscode.window.showWarningMessage('Database not available — run "Scimax: Sync Files" first.'); return; }

    const type = await chooseEntityType(db);
    if (!type) return;

    const headings = await queryEntities(db, type);
    if (!headings.length) {
        vscode.window.showInformationMessage(`No headings found for ${type.name}.`);
        return;
    }

    const items = headings.map(h => {
        const props = parseProps(h);
        const displayVal = type.display ? getPropCaseInsensitive(props, type.display) : undefined;
        return {
            label: stripTags(h.title),
            description: displayVal || '',
            detail: `${vscode.workspace.asRelativePath(h.file_path)}:${h.line_number}`,
            heading: h,
        };
    });
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${type.name}: ${headings.length} — pick one`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) return;

    const actions = buildActions(picked.heading, type, originEditor);
    const action = await vscode.window.showQuickPick(actions, { placeHolder: `${picked.label} — choose an action` });
    if (action) await action.run();
}

export function registerEntitySelector(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.pickEntity', pickEntityCommand)
    );
}
