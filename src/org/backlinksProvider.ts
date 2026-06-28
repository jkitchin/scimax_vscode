/**
 * Object-level back-links surfaced as native references.
 *
 * Two surfaces, one resolver:
 *   - ReferenceProvider: cursor on an anchor or heading + "Find All References"
 *     (Shift+F12) shows the links that point at it in the peek / References view.
 *   - CodeLensProvider: a "← N references" lens on anchored/heading lines that
 *     opens the same peek on click. Counts are computed lazily in
 *     resolveCodeLens, so only visible lenses query the database and zero-count
 *     lenses are hidden.
 *
 * Back-links come from the database index, which refreshes on save, so results
 * reflect the last saved state.
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import { extractAnchors } from '../parser/orgAnchors';
import { getTodoStatesFromText, extractHeadingTitle } from './todoStates';

type Target =
    | { kind: 'anchor'; text: string }
    | { kind: 'heading'; title?: string; customId?: string; id?: string };

interface BacklinkRow {
    file_path: string;
    line_number: number;
    description: string | null;
    heading_title: string | null;
}

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

/** Read a heading's title, CUSTOM_ID, and ID from its line and property drawer. */
function readHeadingTarget(lines: string[], headingLine: number, todoStates: Set<string>): Target {
    // Title with the TODO keyword stripped, so [[Title]] resolves against
    // headings that carry a custom/emoji keyword (e.g. "* ⚠️ Overview").
    const title = extractHeadingTitle(lines[headingLine], todoStates);
    let customId: string | undefined;
    let id: string | undefined;
    for (let i = headingLine + 1; i < Math.min(headingLine + 30, lines.length); i++) {
        if (/^\*+\s/.test(lines[i])) break;
        const c = lines[i].match(/^\s*:CUSTOM_ID:\s*(\S+)/i);
        if (c) customId = c[1];
        const d = lines[i].match(/^\s*:ID:\s*(\S+)/i);
        if (d) id = d[1];
        if (/^\s*:END:/i.test(lines[i])) break;
    }
    return { kind: 'heading', title: title || undefined, customId, id };
}

/** Resolve the back-link target at a position: an anchor on the line, else the containing heading. */
function resolveTargetAt(document: vscode.TextDocument, position: vscode.Position): Target | undefined {
    const line = document.lineAt(position.line).text;
    const radio = line.match(/<<<([^<>]+)>>>/);
    const target = line.match(/<<([^<>]+)>>/);
    const name = line.match(/^\s*#\+NAME:\s*(.+?)\s*$/i);
    if (radio) return { kind: 'anchor', text: radio[1].trim() };
    if (target) return { kind: 'anchor', text: target[1].trim() };
    if (name) return { kind: 'anchor', text: name[1].trim() };

    const fullText = document.getText();
    const lines = fullText.split('\n');
    const todoStates = getTodoStatesFromText(fullText);
    for (let i = position.line; i >= 0; i--) {
        if (/^\*+\s+/.test(lines[i])) return readHeadingTarget(lines, i, todoStates);
    }
    return undefined;
}

async function queryBacklinks(target: Target): Promise<BacklinkRow[]> {
    const db = await getDatabase();
    if (!db) return [];
    if (target.kind === 'anchor') return db.getAnchorBacklinks(target.text);
    return db.getHeadingBacklinks({ title: target.title, customId: target.customId, id: target.id });
}

function toLocations(rows: BacklinkRow[]): vscode.Location[] {
    return rows.map(r => new vscode.Location(
        vscode.Uri.file(r.file_path),
        new vscode.Position(Math.max(0, r.line_number - 1), 0)
    ));
}

// ---------------------------------------------------------------------------
// Reference provider (Find All References / Shift+F12)
// ---------------------------------------------------------------------------

class BacklinksReferenceProvider implements vscode.ReferenceProvider {
    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        const target = resolveTargetAt(document, position);
        if (!target) return [];
        return toLocations(await queryBacklinks(target));
    }
}

// ---------------------------------------------------------------------------
// CodeLens provider ("← N references")
// ---------------------------------------------------------------------------

class BacklinkLens extends vscode.CodeLens {
    constructor(range: vscode.Range, readonly target: Target, readonly uri: vscode.Uri, readonly anchorPos: vscode.Position) {
        super(range);
    }
}

class BacklinksCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;
    refresh(): void { this._onDidChange.fire(); }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!isOrg(document)) return [];
        const text = document.getText();
        const lines = text.split('\n');
        const todoStates = getTodoStatesFromText(text);
        const lenses: BacklinkLens[] = [];

        // One candidate per anchor.
        for (const a of extractAnchors(text)) {
            const range = new vscode.Range(a.lineNumber - 1, 0, a.lineNumber - 1, 0);
            lenses.push(new BacklinkLens(range, { kind: 'anchor', text: a.text }, document.uri,
                new vscode.Position(a.lineNumber - 1, a.column)));
        }
        // One candidate per heading.
        for (let i = 0; i < lines.length; i++) {
            if (/^\*+\s+/.test(lines[i])) {
                const range = new vscode.Range(i, 0, i, 0);
                lenses.push(new BacklinkLens(range, readHeadingTarget(lines, i, todoStates), document.uri, new vscode.Position(i, 0)));
            }
        }
        return lenses;
    }

    async resolveCodeLens(codeLens: vscode.CodeLens): Promise<vscode.CodeLens> {
        const lens = codeLens as BacklinkLens;
        const rows = await queryBacklinks(lens.target);
        if (rows.length === 0) {
            // No command -> the lens is not shown.
            return lens;
        }
        const locations = toLocations(rows);
        lens.command = {
            title: `← ${rows.length} reference${rows.length === 1 ? '' : 's'}`,
            command: 'editor.action.showReferences',
            arguments: [lens.uri, lens.anchorPos, locations],
        };
        return lens;
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBacklinksProvider(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = [{ language: 'org' }, { pattern: '**/*.org' }];

    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(selector, new BacklinksReferenceProvider())
    );

    const codeLens = new BacklinksCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(selector, codeLens),
        vscode.workspace.onDidSaveTextDocument(doc => { if (isOrg(doc)) codeLens.refresh(); }),
        vscode.window.onDidChangeActiveTextEditor(() => codeLens.refresh())
    );
}
