/**
 * Markdown for the entry preview in an agenda item's hover.
 *
 * Kept free of the vscode module so it can be tested directly. The preview is
 * rendered as markdown rather than a code block so that links in it can be
 * clicked: web links open directly, and every other link is handed back to
 * the caller as a command link, so it is followed by the same code as C-c C-o
 * in the source file.
 */

/** A link in the entry, located in its source file. */
export interface EntryLinkRef {
    /** Source file */
    file: string;
    /** 1-based line in the source file */
    line: number;
    /** 0-based column of the link's first character */
    column: number;
}

/** One line of the entry preview, with its 1-based line in the source file. */
export interface SnippetLine {
    text: string;
    line: number;
}

/** The same link forms as getLinkAtPoint, so a followed link is the one shown. */
const LINK_PATTERN = new RegExp(
    [
        // Org bracket links: [[target]] or [[target][description]]
        /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/.source,
        // Citation links: cite:key or cite:key1,key2
        /(?<!\w)(?:cite|citep|citet|citeauthor|citeyear|Citep|Citet|citealp|citealt):[\w:-]+(?:,[\w:-]+)*/.source,
        // Bare URLs
        /https?:\/\/[^\s\]>)]+/.source,
    ].join('|'),
    'g'
);

/** Escape text so markdown shows it literally. */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

/**
 * Render one line, turning its links into markdown links. `commandLink`
 * builds the URI for a link that is not a plain web address.
 */
export function renderSnippetLine(
    file: string,
    source: SnippetLine,
    commandLink: (ref: EntryLinkRef) => string
): string {
    const { text } = source;
    let out = '';
    let last = 0;
    LINK_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LINK_PATTERN.exec(text)) !== null) {
        out += escapeMarkdown(text.slice(last, match.index));
        const target = match[1] ?? match[0];
        const label = escapeMarkdown(match[2] ?? target);
        const href = /^https?:\/\//.test(target)
            ? target
            : commandLink({ file, line: source.line, column: match.index });
        out += `[${label}](<${href.replace(/[<>]/g, encodeURIComponent)}>)`;
        last = match.index + match[0].length;
    }
    out += escapeMarkdown(text.slice(last));

    // Markdown drops leading spaces; keep the entry's indentation visible.
    return out.replace(/^ +/, spaces => '&nbsp;'.repeat(spaces.length));
}

/**
 * Render the preview: the heading in bold, then the body lines. Blank lines
 * become paragraph breaks and the rest keep their line breaks.
 */
export function renderSnippetMarkdown(
    file: string,
    lines: SnippetLine[],
    commandLink: (ref: EntryLinkRef) => string
): string {
    const paragraphs: string[][] = [[]];
    lines.forEach((source, i) => {
        if (source.text.trim() === '') {
            if (paragraphs[paragraphs.length - 1].length) paragraphs.push([]);
            return;
        }
        const rendered = renderSnippetLine(file, source, commandLink);
        paragraphs[paragraphs.length - 1].push(i === 0 ? `**${rendered}**` : rendered);
    });
    return paragraphs
        .filter(p => p.length)
        .map(p => p.join('  \n'))
        .join('\n\n');
}
