/**
 * Org bracket links, [[target]] and [[target][description]], found by column
 * in a line of text. No vscode imports, so it can be tested directly.
 */

const BRACKET_LINK_PATTERN = /\[\[((?:[^\]\\]|\\.)+)\](?:\[([^\]]+)\])?\]/g;

export interface BracketLink {
    /** Column of the opening [[ */
    start: number;
    /** Column just past the closing ]] */
    end: number;
    target: string;
    description?: string;
}

/**
 * The bracket link containing column `col`, counting both edges, so a cursor
 * just before [[ or just after ]] is on the link.
 */
export function findBracketLinkAt(line: string, col: number): BracketLink | null {
    const re = new RegExp(BRACKET_LINK_PATTERN.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (col >= start && col <= end) {
            return { start, end, target: m[1], description: m[2] };
        }
    }
    return null;
}

export function formatBracketLink(target: string, description?: string): string {
    return description ? `[[${target}][${description}]]` : `[[${target}]]`;
}
