/**
 * Diagnostics for TODO task dependencies:
 *
 *   - dangling: a `:DEPENDS:` entry whose id resolves to no indexed heading
 *     (the target was deleted or its :ID: changed).
 *   - cycle: the heading participates in a dependency cycle (A → B → … → A),
 *     which can never be satisfied.
 *
 * Both are DB-backed (cross-file), so this runs as an async diagnostics provider
 * mirroring orphanLinkDiagnostics.ts rather than the synchronous org-lint pass.
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import { parseDepends, findDependencyCycles, DEPENDS_PROPERTY } from './dependencies';

const DEPENDS_LINE_RE = new RegExp(`^(\\s*:${DEPENDS_PROPERTY}:\\s*)(.+?)\\s*$`, 'i');
const ID_LINE_RE = /^\s*:ID:\s*(\S+)/i;

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

function dependEnabled(): boolean {
    return vscode.workspace.getConfiguration('scimax.org.depend').get<boolean>('enabled', true);
}

/** 0-based line of the heading enclosing `line` within `lines`. */
function enclosingHeadingLine(lines: string[], line: number): number {
    for (let i = line; i >= 0; i--) {
        if (/^\*+\s+/.test(lines[i])) return i;
    }
    return -1;
}

export function registerDependencyDiagnostics(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection('scimax.dependencies');
    context.subscriptions.push(collection);

    // Version of each document at its last completed scan. Editor activation
    // fires on every tab switch; skip the rescan (including the workspace-wide
    // cycle detection) when the text hasn't changed. Saves and config changes
    // force one because the database may have changed underneath us.
    const lastScanned = new Map<string, number>();

    async function refresh(doc: vscode.TextDocument, force = false): Promise<void> {
        if (!isOrg(doc)) return;
        if (!dependEnabled()) { collection.delete(doc.uri); return; }
        const key = doc.uri.toString();
        const version = doc.version;
        if (!force && lastScanned.get(key) === version) return;

        const db = await getDatabase();
        if (!db) { collection.delete(doc.uri); return; }

        const diagnostics: vscode.Diagnostic[] = [];
        const lines = doc.getText().split('\n');

        // --- Dangling dependency ids ---
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(DEPENDS_LINE_RE);
            if (!m) continue;
            const prefixLen = m[1].length;
            const valuePart = lines[i].slice(prefixLen);
            for (const id of parseDepends(m[2])) {
                let heading;
                try {
                    heading = await db.getHeadingById(id);
                } catch {
                    heading = null;
                }
                if (heading) continue;
                // Locate this id's text on the line for a precise range.
                const idx = valuePart.indexOf(id);
                const startCol = idx >= 0 ? prefixLen + idx : prefixLen;
                const endCol = idx >= 0 ? startCol + id.length : lines[i].length;
                const d = new vscode.Diagnostic(
                    new vscode.Range(i, startCol, i, endCol),
                    `Dependency target not found: no heading with :ID: "${id}". It may have been deleted or renamed.`,
                    vscode.DiagnosticSeverity.Warning
                );
                d.source = 'scimax';
                d.code = 'dependency-dangling';
                diagnostics.push(d);
            }
        }

        // --- Cycles (workspace-wide; flag headings in this file that participate) ---
        try {
            const cycles = await findDependencyCycles();
            if (cycles.length > 0) {
                const cycleIds = new Map<string, string[]>(); // id -> the cycle it's in
                for (const cycle of cycles) {
                    for (const id of cycle) if (!cycleIds.has(id)) cycleIds.set(id, cycle);
                }
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(ID_LINE_RE);
                    if (!m) continue;
                    const id = m[1].replace(/^id:/i, '');
                    const cycle = cycleIds.get(id);
                    if (!cycle) continue;
                    const headingLine = enclosingHeadingLine(lines, i);
                    const targetLine = headingLine >= 0 ? headingLine : i;
                    const d = new vscode.Diagnostic(
                        new vscode.Range(targetLine, 0, targetLine, lines[targetLine].length),
                        `Dependency cycle: ${cycle.join(' → ')} → ${cycle[0]}. These tasks can never all be satisfied.`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    d.source = 'scimax';
                    d.code = 'dependency-cycle';
                    diagnostics.push(d);
                }
            }
        } catch {
            // Cycle detection is best-effort.
        }

        collection.set(doc.uri, diagnostics);
        lastScanned.set(key, version);
    }

    const timers = new Map<string, NodeJS.Timeout>();
    function scheduleRefresh(doc: vscode.TextDocument): void {
        const key = doc.uri.toString();
        const existing = timers.get(key);
        if (existing) clearTimeout(existing);
        timers.set(key, setTimeout(() => { timers.delete(key); void refresh(doc); }, 500));
    }

    context.subscriptions.push(
        // Debounced, so rapid tab cycling coalesces into one (usually skipped) scan.
        vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) scheduleRefresh(editor.document); }),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (vscode.window.activeTextEditor?.document === e.document) scheduleRefresh(e.document);
        }),
        vscode.workspace.onDidOpenTextDocument(doc => void refresh(doc)),
        vscode.workspace.onDidSaveTextDocument(doc => void refresh(doc, true)),
        vscode.workspace.onDidCloseTextDocument(doc => {
            collection.delete(doc.uri);
            lastScanned.delete(doc.uri.toString());
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.org.depend')) {
                for (const editor of vscode.window.visibleTextEditors) void refresh(editor.document, true);
            }
        })
    );

    if (vscode.window.activeTextEditor) void refresh(vscode.window.activeTextEditor.document);
}
