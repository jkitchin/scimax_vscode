/**
 * Orphan link diagnostics for granular addressing.
 *
 * Flags internal "fuzzy" links ([[name]] and [[*Heading]]) whose target no
 * longer resolves to anything: not a <<target>>/<<<radio>>>/#+NAME anchor, not
 * a heading, and not even present as literal text. This is the "you deleted
 * <<foo>> but [[foo]] still points at it" case.
 *
 * Resolution intentionally mirrors scimax.org.gotoTarget so the diagnostic
 * never contradicts what following the link actually does:
 *   1. in-document anchors / headings / NAME / text search, then
 *   2. a database lookup for an anchor of that name anywhere in the workspace.
 *
 * Custom-id ([[#id]]) and id: links are left to the synchronous broken-link
 * lint checker; cross-file (file::frag) fragments are out of scope for v1.
 */
import * as vscode from 'vscode';
import { extractAnchors, normalizeAnchorText } from '../parser/orgAnchors';
import { getDatabase } from '../database/lazyDb';
import { getTodoStatesFromText, extractHeadingTitle } from './todoStates';

const SETTING_KEY = 'scimax.org.diagnostics.orphanLinks';

// Link schemes / forms handled elsewhere or not anchor references.
const EXTERNAL_SCHEME_RE = /^(https?|ftp|doi|mailto|cmd|elisp|shell|attachment|info|help|man|file|id|fn|news|telnet):/i;
const FILE_EXT_RE = /\.(org|md|markdown|png|jpe?g|gif|pdf|svg|txt|html?|csv|tsv|json|ya?ml|bib|tex)$/i;
const BLOCK_BEGIN_RE = /^[ \t]*#\+BEGIN_/i;
const BLOCK_END_RE = /^[ \t]*#\+END_/i;
const LINK_RE = /\[\[([^\]]+?)(?:\]\[[^\]]*)?\]\]/g;

export interface OrphanLink {
    /** Absolute character offset where the target text begins (after `[[`). */
    targetStartOffset: number;
    /** Length of the target text. */
    targetLength: number;
    target: string;
    message: string;
}

function normalizeHeadingTitle(title: string): string {
    // Drop trailing tags (:a:b:) and collapse whitespace.
    return title.replace(/\s+:[\w@#%:]+:\s*$/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Compute orphan links for document text. `resolveAnchorInDb` reports whether
 * an anchor with the given name exists anywhere in the workspace index; it is
 * only consulted as a last resort, so the common case makes no database calls.
 */
export async function computeOrphanLinks(
    text: string,
    resolveAnchorInDb: (name: string) => Promise<boolean>
): Promise<OrphanLink[]> {
    const lines = text.split('\n');
    const todoStates = getTodoStatesFromText(text);

    // Build the set of in-document resolution targets.
    const anchorSet = new Set(extractAnchors(text).map(a => normalizeAnchorText(a.text)));
    const headingTitles = new Set<string>();
    const customIds = new Set<string>();
    const ids = new Set<string>();
    for (const line of lines) {
        if (/^\*+\s+/.test(line)) {
            // Title with the TODO keyword (e.g. a custom/emoji keyword) stripped,
            // so [[Title]] resolves against headings like "* ⚠️ Overview".
            headingTitles.add(normalizeHeadingTitle(extractHeadingTitle(line, todoStates)));
        }
        const cid = line.match(/^[ \t]*:CUSTOM_ID:\s*(\S+)/i);
        if (cid) customIds.add(cid[1].toLowerCase());
        const id = line.match(/^[ \t]*:ID:\s*(\S+)/i);
        if (id) ids.add(id[1].toLowerCase());
    }
    // For the "does the target appear as prose" fallback, strip link markup so
    // a link's own target text does not count as resolving itself.
    const lowerTextSansLinks = text.replace(/\[\[[^\]]*(?:\]\[[^\]]*)?\]\]/g, ' ').toLowerCase();

    const orphans: OrphanLink[] = [];
    let offset = 0;
    let inBlock = false;

    for (const line of lines) {
        const lineStart = offset;
        offset += line.length + 1; // account for the newline

        if (!inBlock && BLOCK_BEGIN_RE.test(line)) { inBlock = true; continue; }
        if (inBlock) { if (BLOCK_END_RE.test(line)) inBlock = false; continue; }

        LINK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = LINK_RE.exec(line)) !== null) {
            const raw = m[1].trim();
            if (!raw) continue;
            if (EXTERNAL_SCHEME_RE.test(raw)) continue;  // external / handled elsewhere
            if (raw.startsWith('#')) continue;            // custom-id -> broken-link checker
            if (raw.includes('::')) continue;             // cross-file fragment -> v1 lenient
            if (raw.includes('/') || FILE_EXT_RE.test(raw)) continue; // file link

            const isHeadingForm = raw.startsWith('*');
            const name = isHeadingForm ? raw.slice(1).trim() : raw;
            if (!name) continue;
            const norm = normalizeAnchorText(name);

            // In-document resolution (cheap, matches the link follower).
            let resolved =
                anchorSet.has(norm) ||
                headingTitles.has(norm) ||
                customIds.has(name.toLowerCase()) ||
                ids.has(name.toLowerCase());

            // [[name]] also resolves by literal text search (as gotoTarget does);
            // [[*Heading]] is heading-only, so no text fallback.
            if (!resolved && !isHeadingForm && lowerTextSansLinks.includes(name.toLowerCase())) {
                resolved = true;
            }

            // Last resort: a cross-file anchor with this name.
            if (!resolved && !isHeadingForm) {
                resolved = await resolveAnchorInDb(name);
            }

            if (!resolved) {
                const targetStartInLine = m.index + 2; // skip the leading `[[`
                orphans.push({
                    targetStartOffset: lineStart + targetStartInLine,
                    targetLength: m[1].length,
                    target: raw,
                    message: isHeadingForm
                        ? `Unresolved heading link: "*${name}" has no matching heading in this file.`
                        : `Unresolved link: "${name}" matches no anchor (<<${name}>>), heading, or text. The target may have been deleted.`
                });
            }
        }
    }

    return orphans;
}

/**
 * Register the orphan link diagnostics provider.
 */
export function registerOrphanLinkDiagnostics(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection('scimax.orphanLinks');
    context.subscriptions.push(collection);

    const isEnabled = () =>
        vscode.workspace.getConfiguration().get<boolean>(SETTING_KEY, true);

    const isOrg = (doc: vscode.TextDocument) =>
        doc.languageId === 'org' || doc.fileName.endsWith('.org');

    async function refresh(doc: vscode.TextDocument): Promise<void> {
        if (!isOrg(doc)) return;
        if (!isEnabled()) { collection.delete(doc.uri); return; }

        const resolveAnchorInDb = async (name: string): Promise<boolean> => {
            try {
                const db = await getDatabase();
                if (!db) return true; // no DB: do not flag (avoid false positives)
                const hit = await db.resolveAnchor(name, doc.fileName);
                return hit !== null;
            } catch {
                return true; // on error, be lenient
            }
        };

        const orphans = await computeOrphanLinks(doc.getText(), resolveAnchorInDb);
        const diagnostics = orphans.map(o => {
            const range = new vscode.Range(
                doc.positionAt(o.targetStartOffset),
                doc.positionAt(o.targetStartOffset + o.targetLength)
            );
            const d = new vscode.Diagnostic(range, o.message, vscode.DiagnosticSeverity.Warning);
            d.source = 'scimax';
            d.code = 'orphan-link';
            return d;
        });
        collection.set(doc.uri, diagnostics);
    }

    // Debounced refresh on edits.
    const timers = new Map<string, NodeJS.Timeout>();
    function scheduleRefresh(doc: vscode.TextDocument): void {
        const key = doc.uri.toString();
        const existing = timers.get(key);
        if (existing) clearTimeout(existing);
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            void refresh(doc);
        }, 400));
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) void refresh(editor.document);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (vscode.window.activeTextEditor?.document === e.document) scheduleRefresh(e.document);
        }),
        vscode.workspace.onDidOpenTextDocument(doc => void refresh(doc)),
        vscode.workspace.onDidSaveTextDocument(doc => void refresh(doc)),
        vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(SETTING_KEY)) {
                for (const editor of vscode.window.visibleTextEditors) void refresh(editor.document);
            }
        })
    );

    // Initial pass over the active editor.
    if (vscode.window.activeTextEditor) void refresh(vscode.window.activeTextEditor.document);
}
