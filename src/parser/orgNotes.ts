/**
 * Dialog notes ("footnotes for dialog").
 *
 * A note is an ordinary org footnote whose label carries a prefix (default
 * `note-`). The reference [fn:note-<slug>] marks the passage; the body is a
 * footnote definition collected under a `* Notes` section. Notes reuse all of
 * org's footnote machinery (parsing, reference/definition jump, hover, and the
 * undefined/unreferenced-footnote lint that gives orphan detection for free).
 *
 * The only thing that distinguishes them is export: dialog notes are meta, not
 * content, so they are stripped from exported documents (see stripNoteFootnotes).
 */
import { OrgDocumentNode } from './orgElementTypes';

export const NOTE_LABEL_PREFIX = 'note-';
export const NOTES_HEADING = 'Notes';

export type NoteType = 'note' | 'decision' | 'question';

export interface NoteReference {
    label: string;
    line: number;       // 0-indexed
    startChar: number;
    endChar: number;
}

export interface NoteDefinition {
    label: string;
    line: number;       // 0-indexed
    type: NoteType;
    author?: string;
    date?: string;
    state?: string;
    body: string;       // first body line / summary
}

export function isNoteLabel(label: string | undefined | null, prefix: string = NOTE_LABEL_PREFIX): boolean {
    return !!label && label.startsWith(prefix);
}

/** Build a legal footnote label for a note from a slug (footnote labels allow word chars, - and _). */
export function makeNoteLabel(slug: string, prefix: string = NOTE_LABEL_PREFIX): string {
    const clean = slug.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const base = clean || 'note';
    return base.startsWith(prefix) ? base : prefix + base;
}

/** Find all note references [fn:note-...] in document text. */
export function findNoteReferences(text: string, prefix: string = NOTE_LABEL_PREFIX): NoteReference[] {
    const refs: NoteReference[] = [];
    const lines = text.split('\n');
    const re = new RegExp(`\\[fn:(${escapeRe(prefix)}[\\w-]+)\\]`, 'g');
    for (let i = 0; i < lines.length; i++) {
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(lines[i])) !== null) {
            refs.push({ label: m[1], line: i, startChar: m.index, endChar: m.index + m[0].length });
        }
    }
    return refs;
}

/** Parse the metadata line of a note body: "Decision · alice · 2026-06-28 · open". */
export function parseNoteMeta(firstLine: string): { type: NoteType; author?: string; date?: string; state?: string; rest: string } {
    const parts = firstLine.split('·').map(p => p.trim()).filter(Boolean);
    let type: NoteType = 'note';
    let author: string | undefined;
    let date: string | undefined;
    let state: string | undefined;
    if (parts.length > 0) {
        const t = parts[0].toLowerCase();
        if (t === 'decision' || t === 'question' || t === 'note') type = t as NoteType;
    }
    for (const p of parts.slice(1)) {
        if (/^\d{4}-\d{2}-\d{2}/.test(p)) date = p;
        else if (/^(open|resolved|closed)$/i.test(p)) state = p.toLowerCase();
        else if (!author) author = p;
    }
    return { type, author, date, state, rest: firstLine };
}

/** Find all note definitions [fn:note-...] ... in document text. */
export function findNoteDefinitions(text: string, prefix: string = NOTE_LABEL_PREFIX): NoteDefinition[] {
    const defs: NoteDefinition[] = [];
    const lines = text.split('\n');
    const re = new RegExp(`^\\[fn:(${escapeRe(prefix)}[\\w-]+)\\]\\s*(.*)$`);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (m) {
            const meta = parseNoteMeta(m[2]);
            defs.push({ label: m[1], line: i, type: meta.type, author: meta.author, date: meta.date, state: meta.state, body: m[2] });
        }
    }
    return defs;
}

/** Build the text of a note definition for insertion under the Notes section. */
export function buildNoteDefinition(
    label: string,
    type: NoteType,
    body: string,
    author?: string,
    date?: string
): string {
    const meta = [capitalize(type), author, date, 'open'].filter(Boolean).join(' · ');
    const indentedBody = body.split('\n').map(l => '  ' + l).join('\n');
    return `[fn:${label}] ${meta}\n${indentedBody}`;
}

/**
 * Remove note footnotes (references and definitions whose label has the prefix)
 * from an export AST so dialog notes never appear in exported documents. Mutates
 * the document in place (export parses a fresh AST, so this is safe).
 */
export function stripNoteFootnotes(doc: OrgDocumentNode, prefix: string = NOTE_LABEL_PREFIX): OrgDocumentNode {
    const keep = (node: any): boolean => {
        if (!node || typeof node !== 'object') return true;
        if ((node.type === 'footnote-definition' || node.type === 'footnote-reference') &&
            isNoteLabel(node.properties?.label, prefix)) {
            return false;
        }
        return true;
    };

    const walk = (node: any): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node.children)) {
            node.children = node.children.filter(keep);
            node.children.forEach(walk);
        }
        if (node.section && typeof node.section === 'object') {
            walk(node.section);
        }
    };

    walk(doc);
    return doc;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
