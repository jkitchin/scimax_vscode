/**
 * Speed Command Metadata Functions
 *
 * Set tags, effort, properties, and priority.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { extractTags, formatTags, removeTagsFromLine, similarTags } from './utils';
import { getDatabase } from '../../database/lazyDb';
import { getPropCaseInsensitive } from '../../database/scimaxDbCore';

/** Property names offered even when not yet used anywhere. */
const COMMON_PROPERTIES = [
    'ID', 'CUSTOM_ID', 'CATEGORY', 'EFFORT', 'ASSIGNEE', 'DEPENDS', 'ORDERED',
    'CREATED', 'COLUMNS', 'LOGGING', 'EXPORT_FILE_NAME', 'NICK', 'EMAIL', 'ROLE',
    'ADDRESS', 'PHONE', 'URL',
];

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fuzzy-pick from `items` while also allowing a brand-new value: as the user
 * types something not in the list, a "<value> (new)" entry appears at the top.
 * Returns the picked/typed string, or undefined if cancelled.
 */
function pickOrCreate(items: string[], placeHolder: string): Promise<string | undefined> {
    return new Promise(resolve => {
        const qp = vscode.window.createQuickPick();
        qp.placeholder = placeHolder;
        qp.matchOnDescription = true;
        const base = items.map(label => ({ label }));
        qp.items = base;
        let done = false;
        qp.onDidChangeValue(v => {
            const val = v.trim();
            qp.items = val && !items.some(i => i.toLowerCase() === val.toLowerCase())
                ? [{ label: val, description: 'new' }, ...base]
                : base;
        });
        qp.onDidAccept(() => {
            const sel = qp.selectedItems[0];
            const value = (sel ? sel.label : qp.value).trim();
            done = true;
            qp.hide();
            resolve(value || undefined);
        });
        qp.onDidHide(() => { if (!done) resolve(undefined); qp.dispose(); });
        qp.show();
    });
}

/** Property names already used in this file, plus common defaults and (best-effort) the index. */
async function collectPropertyNames(document: vscode.TextDocument): Promise<string[]> {
    const names = new Set<string>(COMMON_PROPERTIES);
    const re = /^\s*:([A-Za-z][A-Za-z0-9_-]*):\s/gm;
    const skip = new Set(['PROPERTIES', 'END', 'LOGBOOK', 'CLOCK', 'RESULTS']);
    let m: RegExpExecArray | null;
    const text = document.getText();
    while ((m = re.exec(text)) !== null) {
        if (!skip.has(m[1].toUpperCase())) names.add(m[1]);
    }
    try {
        const db = await getDatabase();
        if (db) {
            const rows = await db.searchHeadings('', { limit: 2000 });
            for (const h of rows) {
                try { for (const k of Object.keys(JSON.parse(h.properties || '{}'))) names.add(k); } catch { /* ignore */ }
            }
        }
    } catch { /* index optional */ }
    return [...names].sort((a, b) => a.localeCompare(b));
}

/** Existing values for `name` in this file, plus (best-effort) across the index. */
async function collectPropertyValues(document: vscode.TextDocument, name: string): Promise<string[]> {
    const values = new Set<string>();
    const re = new RegExp(`^\\s*:${escapeRegExp(name)}:\\s*(.+?)\\s*$`, 'gim');
    let m: RegExpExecArray | null;
    const text = document.getText();
    while ((m = re.exec(text)) !== null) values.add(m[1]);
    try {
        const db = await getDatabase();
        if (db) {
            const rows = await db.searchByProperty(name);
            for (const h of rows) {
                try {
                    const v = getPropCaseInsensitive(JSON.parse(h.properties || '{}'), name);
                    if (v) values.add(v);
                } catch { /* ignore */ }
            }
        }
    } catch { /* index optional */ }
    return [...values].sort((a, b) => a.localeCompare(b));
}

/**
 * Tags known for this document (headings and #+TAGS lines) merged with every
 * heading tag in the index, with index usage counts where available.
 */
async function collectTags(document: vscode.TextDocument): Promise<Map<string, number | undefined>> {
    const tags = new Map<string, number | undefined>();
    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        if (/^\*+\s/.test(text)) {
            for (const t of extractTags(text)) tags.set(t, undefined);
        } else {
            const m = text.match(/^\s*#\+(?:FILE)?TAGS:\s*(.+)$/i);
            if (m) {
                for (const t of m[1].split(/[\s:{}]+/)) {
                    const name = t.replace(/\(.\)$/, ''); // drop fast-select keys like work(w)
                    if (/^[\w@#%]+$/.test(name)) tags.set(name, undefined);
                }
            }
        }
    }
    try {
        const db = await getDatabase();
        if (db) {
            for (const { tag, count } of await db.getAllTags()) tags.set(tag, count);
        }
    } catch { /* index optional */ }
    return tags;
}

interface TagItem extends vscode.QuickPickItem { tag: string; isNew?: boolean }

/**
 * Multi-select picker over known tags. Typing a tag that doesn't exist yet
 * offers it as a new entry and warns about similar existing tags.
 */
function pickTags(known: Map<string, number | undefined>, current: string[]): Promise<string[] | undefined> {
    return new Promise(resolve => {
        const qp = vscode.window.createQuickPick<TagItem>();
        qp.canSelectMany = true;
        qp.placeholder = 'Check tags to apply; type to filter or to add a new tag';
        const names = [...new Set([...known.keys(), ...current])]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const base: TagItem[] = names.map(tag => {
            const count = known.get(tag);
            return {
                label: tag,
                description: count === undefined ? undefined : `${count} heading${count === 1 ? '' : 's'}`,
                tag
            };
        });
        const added: TagItem[] = [];
        qp.items = base;
        qp.selectedItems = base.filter(i => current.includes(i.tag));

        const newItemFor = (value: string): TagItem | undefined => {
            const tag = value.trim().replace(/^:+|:+$/g, '');
            if (!/^[\w@#%]+$/.test(tag) || names.includes(tag) || added.some(a => a.tag === tag)) return undefined;
            const similar = similarTags(tag, names);
            return {
                label: tag,
                description: 'new tag',
                detail: similar.length ? `$(warning) similar to existing: ${similar.map(t => `:${t}:`).join(' ')}` : undefined,
                tag,
                isNew: true
            };
        };

        qp.onDidChangeValue(v => {
            const selected = qp.selectedItems;
            // A checked new tag must survive further typing
            for (const s of selected) {
                if (s.isNew && !added.some(a => a.tag === s.tag)) added.push(s);
            }
            const candidate = newItemFor(v);
            qp.items = candidate ? [candidate, ...added, ...base] : [...added, ...base];
            qp.selectedItems = qp.items.filter(i => selected.some(s => s.tag === i.tag));
        });

        let done = false;
        qp.onDidAccept(() => {
            const result = new Set(qp.selectedItems.map(i => i.tag));
            // Enter with a new tag typed but not checked: take it too
            const candidate = newItemFor(qp.value);
            if (candidate) result.add(candidate.tag);
            done = true;
            qp.hide();
            // Keep the heading's existing order, append newcomers
            resolve([...current.filter(t => result.has(t)), ...[...result].filter(t => !current.includes(t))]);
        });
        qp.onDidHide(() => { if (!done) resolve(undefined); qp.dispose(); });
        qp.show();
    });
}

/**
 * Set tags on the current heading
 */
export async function setTags(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading we're on
    const headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const line = document.lineAt(headingLine);
    const currentTags = extractTags(line.text);

    const newTags = await pickTags(await collectTags(document), currentTags);
    if (newTags === undefined) return; // Cancelled

    // Remove existing tags from line
    let newLineText = removeTagsFromLine(line.text);

    // Add new tags if any
    if (newTags.length > 0) {
        // Ensure proper spacing before tags (align to column 77 like Emacs)
        const tagStr = formatTags(newTags);
        const targetCol = 77;
        const currentLen = newLineText.trimEnd().length;

        if (currentLen < targetCol - tagStr.length) {
            // Add spaces to align
            const spaces = ' '.repeat(targetCol - tagStr.length - currentLen);
            newLineText = newLineText.trimEnd() + spaces + tagStr;
        } else {
            // Just add single space
            newLineText = newLineText.trimEnd() + ' ' + tagStr;
        }
    }

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLineText);
    });
}

/**
 * Find or create PROPERTIES drawer for a heading
 */
async function ensurePropertiesDrawer(
    editor: vscode.TextEditor,
    headingLine: number
): Promise<{ startLine: number; endLine: number }> {
    const document = editor.document;

    // Search for existing :PROPERTIES: drawer
    let propertiesStart = -1;
    let propertiesEnd = -1;

    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();

        // Hit next heading
        if (getHeadingLevel(document, i) > 0) break;

        // Skip planning lines
        if (/^(SCHEDULED|DEADLINE|CLOSED):/.test(line)) continue;

        if (line === ':PROPERTIES:') {
            propertiesStart = i;
        } else if (propertiesStart >= 0 && line === ':END:') {
            propertiesEnd = i;
            break;
        } else if (propertiesStart < 0 && line && !line.startsWith(':')) {
            // Hit content before finding properties drawer
            break;
        }
    }

    if (propertiesStart >= 0 && propertiesEnd >= 0) {
        return { startLine: propertiesStart, endLine: propertiesEnd };
    }

    // Create new properties drawer
    // Find insertion point (after heading and planning lines)
    let insertLine = headingLine + 1;
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();
        const level = getHeadingLevel(document, i);
        if (level > 0) break;

        if (/^(SCHEDULED|DEADLINE|CLOSED):/.test(line)) {
            insertLine = i + 1;
        } else {
            break;
        }
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(
            new vscode.Position(insertLine, 0),
            ':PROPERTIES:\n:END:\n'
        );
    });

    return { startLine: insertLine, endLine: insertLine + 1 };
}

/**
 * Set effort property on current heading
 */
export async function setEffort(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    const headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    // Common effort estimates
    const options: (vscode.QuickPickItem & { value: string })[] = [
        { label: '0:15', description: '15 minutes', value: '0:15' },
        { label: '0:30', description: '30 minutes', value: '0:30' },
        { label: '1:00', description: '1 hour', value: '1:00' },
        { label: '2:00', description: '2 hours', value: '2:00' },
        { label: '4:00', description: '4 hours (half day)', value: '4:00' },
        { label: '8:00', description: '8 hours (full day)', value: '8:00' },
        { label: 'Custom...', description: 'Enter custom effort', value: '' },
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Set effort estimate'
    });

    if (!selected) return;

    let effort = selected.value;
    if (!effort) {
        const custom = await vscode.window.showInputBox({
            prompt: 'Enter effort (H:MM format)',
            placeHolder: '1:30',
            validateInput: (value) => {
                if (!value) return null;
                if (!/^\d+:\d{2}$/.test(value)) {
                    return 'Use H:MM format (e.g., 1:30)';
                }
                return null;
            }
        });
        if (!custom) return;
        effort = custom;
    }

    await setPropertyValue(editor, headingLine, 'Effort', effort);
    vscode.window.showInformationMessage(`Effort: ${effort}`);
}

/**
 * Set any property on current heading
 */
export async function setProperty(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;

    // Find the enclosing heading (works from anywhere in the entry, not only
    // when the cursor sits on the heading line).
    let headingLine = -1;
    for (let i = editor.selection.active.line; i >= 0; i--) {
        if (getHeadingLevel(document, i) > 0) { headingLine = i; break; }
    }
    if (headingLine < 0) {
        vscode.window.showInformationMessage('Not under a heading');
        return;
    }

    // Property name — fuzzy pick from existing properties, or type a new one.
    const names = await collectPropertyNames(document);
    const propertyName = await pickOrCreate(names, 'Property name (fuzzy-match existing, or type a new one)');
    if (!propertyName) return;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(propertyName)) {
        vscode.window.showErrorMessage('Property name must start with a letter and contain only letters, numbers, _ or -.');
        return;
    }

    // Value — offer existing values for this property, or type a new one.
    const values = await collectPropertyValues(document, propertyName);
    const propertyValue = await pickOrCreate(values, `Value for :${propertyName}: (pick existing or type a new one)`);
    if (propertyValue === undefined) return;

    await setPropertyValue(editor, headingLine, propertyName, propertyValue);
    vscode.window.showInformationMessage(`Set :${propertyName}: ${propertyValue}`);
}

/**
 * Set a property value in the properties drawer
 */
export async function setPropertyValue(
    editor: vscode.TextEditor,
    headingLine: number,
    propertyName: string,
    value: string
): Promise<void> {
    // Ensure properties drawer exists
    const drawer = await ensurePropertiesDrawer(editor, headingLine);

    // Re-read document after potential edit
    const docAfter = editor.document;

    // Search for existing property
    const propPattern = new RegExp(`^\\s*:${propertyName}:\\s*(.*)$`, 'i');
    let existingLine = -1;

    for (let i = drawer.startLine + 1; i < drawer.endLine; i++) {
        const line = docAfter.lineAt(i).text;
        if (propPattern.test(line)) {
            existingLine = i;
            break;
        }
    }

    if (existingLine >= 0) {
        // Update existing property
        const line = docAfter.lineAt(existingLine);
        const newText = `:${propertyName}: ${value}`;
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newText);
        });
    } else {
        // Insert new property before :END:
        const endLine = drawer.endLine;
        await editor.edit(editBuilder => {
            editBuilder.insert(
                new vscode.Position(endLine, 0),
                `:${propertyName}: ${value}\n`
            );
        });
    }
}

/**
 * Set priority on current heading
 */
export async function setPriority(priority: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    const headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const line = document.lineAt(headingLine);
    let lineText = line.text;

    // Check for existing priority
    const priorityMatch = lineText.match(/\[#[A-Z]\]/);

    if (priority === '') {
        // Remove priority
        if (priorityMatch) {
            lineText = lineText.replace(/\s*\[#[A-Z]\]\s*/, ' ');
        }
    } else {
        const newPriority = `[#${priority}]`;
        if (priorityMatch) {
            // Replace existing priority
            lineText = lineText.replace(/\[#[A-Z]\]/, newPriority);
        } else {
            // Insert priority after TODO keyword or after stars
            const headingMatch = lineText.match(/^(\*+)\s+(TODO|DONE|NEXT|WAITING|HOLD|SOMEDAY|CANCELLED|CANCELED)?\s*/);
            if (headingMatch) {
                const insertPos = headingMatch[0].length;
                lineText = lineText.slice(0, insertPos) + newPriority + ' ' + lineText.slice(insertPos);
            }
        }
    }

    // Clean up extra spaces
    lineText = lineText.replace(/  +/g, ' ');

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, lineText);
    });

    if (priority) {
        vscode.window.showInformationMessage(`Priority: [#${priority}]`);
    } else {
        vscode.window.showInformationMessage('Priority removed');
    }
}
