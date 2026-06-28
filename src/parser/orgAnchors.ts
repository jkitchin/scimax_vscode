/**
 * Org anchor extraction for granular addressing.
 *
 * An "anchor" is a stable, human-readable point that a link can target at a
 * granularity finer than a heading:
 *   - dedicated target   <<my anchor>>      (linked only via [[my anchor]])
 *   - radio target       <<<my concept>>>   (every occurrence auto-links)
 *   - affiliated name    #+NAME: my-thing   (names a block/table/element)
 *
 * The anchor lives in the text, so it travels with its content under moves and
 * disappears with it under deletes. This extractor is a deliberately simple
 * line scanner (mirroring extractHashtags) rather than an AST walk, so it is
 * robust and self-contained. The scimax database indexes the results; the text
 * remains the source of truth.
 */

export type OrgAnchorKind = 'target' | 'radio' | 'name';

export interface OrgAnchor {
    /** The anchor text (trimmed, as authored). */
    text: string;
    kind: OrgAnchorKind;
    /** 1-indexed line number. */
    lineNumber: number;
    /** 0-indexed column where the anchor starts on its line. */
    column: number;
}

// Radio target <<<text>>> (matched before dedicated targets).
const RADIO_RE = /<<<([^<>\n]+?)>>>/g;
// Dedicated target <<text>> (run over a line whose radio spans are masked out).
const TARGET_RE = /<<([^<>\n]+?)>>/g;
// Affiliated name keyword.
const NAME_RE = /^[ \t]*#\+NAME:[ \t]*(.+?)[ \t]*$/i;
// Block boundaries whose bodies should not be scanned for targets (code, etc.).
const BLOCK_BEGIN_RE = /^[ \t]*#\+BEGIN_(\w+)/i;
const BLOCK_END_RE = /^[ \t]*#\+END_(\w+)/i;

/**
 * Extract all org anchors from document content.
 */
export function extractAnchors(content: string): OrgAnchor[] {
    const anchors: OrgAnchor[] = [];
    const lines = content.split('\n');
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Track block bodies so we do not treat `<<x>>` inside code as anchors.
        if (!inBlock && BLOCK_BEGIN_RE.test(line)) {
            inBlock = true;
            continue;
        }
        if (inBlock) {
            if (BLOCK_END_RE.test(line)) inBlock = false;
            continue;
        }

        // #+NAME: affiliated keyword.
        const nameMatch = line.match(NAME_RE);
        if (nameMatch) {
            const text = nameMatch[1].trim();
            if (text) {
                anchors.push({ text, kind: 'name', lineNumber: i + 1, column: line.indexOf('#') });
            }
            continue;
        }

        // Radio targets first; mask their spans so dedicated-target scanning
        // does not double-count the inner `<<text>>` of a `<<<text>>>`.
        let masked = line;
        let m: RegExpExecArray | null;
        RADIO_RE.lastIndex = 0;
        while ((m = RADIO_RE.exec(line)) !== null) {
            const text = m[1].trim();
            if (text) {
                anchors.push({ text, kind: 'radio', lineNumber: i + 1, column: m.index });
            }
            masked =
                masked.slice(0, m.index) +
                ' '.repeat(m[0].length) +
                masked.slice(m.index + m[0].length);
        }

        // Dedicated targets over the masked line.
        TARGET_RE.lastIndex = 0;
        while ((m = TARGET_RE.exec(masked)) !== null) {
            const text = m[1].trim();
            if (text) {
                anchors.push({ text, kind: 'target', lineNumber: i + 1, column: m.index });
            }
        }
    }

    return anchors;
}

/**
 * Normalize anchor text for case-insensitive matching (org targets are
 * case-insensitive and collapse internal whitespace).
 */
export function normalizeAnchorText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build a human-readable, kebab-cased slug for a new anchor from contextual
 * text (e.g. a heading title plus nearby words). Keeps it legible per
 * Engelbart's requirement that addresses be human-interpretable.
 */
export function slugifyAnchor(...parts: string[]): string {
    const joined = parts
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return joined || 'anchor';
}
