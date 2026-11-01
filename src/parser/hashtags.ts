/**
 * Hashtags (#tag) in body text.
 *
 * One definition shared by the highlighter, the database indexer, the hover,
 * the link provider and the occurrence search, so a word coloured as a
 * hashtag is also the one that is indexed and found.
 *
 * A hashtag is `#` followed by a letter and then letters, digits, `_` or `-`
 * (not ending in `-`), at the start of a line or after whitespace or `(`.
 * That leaves out URL fragments (page.html#sec), priority cookies ([#A]),
 * numbers (#1) and `#+KEYWORD` lines. Comment lines (`# text` or a bare `#`,
 * as org defines them), keyword lines (`#+...`), Markdown headings
 * (`## text`) and the bodies of src, example and export blocks and Markdown
 * code fences have no hashtags. A line starting with `#tag` is not a comment
 * in org, so its tag counts.
 *
 * In Markdown (`{ markdown: true }`) a `# text` line is a heading, not a
 * comment, so the hashtags in a heading's text count (`## Plan #paper`).
 */

export interface HashtagOptions {
    /** Markdown rules: `#` lines are headings whose text can hold hashtags. */
    markdown?: boolean;
}

export interface HashtagMatch {
    /** 0-based line number */
    line: number;
    /** Column of the `#` */
    start: number;
    /** Column after the last character */
    end: number;
    /** The tag as written, without `#` */
    tag: string;
}

const HASHTAG_REGEX = /(?<![^\s(])#([A-Za-z](?:[\w-]*\w)?)/g;
const BLOCK_BEGIN = /^\s*#\+begin_(src|example|export)\b/i;
const BLOCK_END = /^\s*#\+end_(src|example|export)\b/i;
const FENCE = /^\s*(```|~~~)/;
const NO_HASHTAG_LINE = /^\s*(#+(\s|$)|#\+)/;

const MARKDOWN_HEADING = /^ {0,3}#{1,6}(?=\s|$)/;

/** Hashtags in one line of text, ignoring block context. */
export function hashtagsInLine(text: string, line = 0, options: HashtagOptions = {}): HashtagMatch[] {
    let offset = 0;
    if (options.markdown) {
        // Scan a heading's text, after its # marks.
        const heading = MARKDOWN_HEADING.exec(text);
        if (heading) offset = heading[0].length;
        else if (/^\s*#\+/.test(text)) return [];
    } else if (NO_HASHTAG_LINE.test(text)) {
        return [];
    }
    const body = text.slice(offset);
    const matches: HashtagMatch[] = [];
    HASHTAG_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HASHTAG_REGEX.exec(body)) !== null) {
        matches.push({ line, start: offset + m.index, end: offset + m.index + m[0].length, tag: m[1] });
    }
    return matches;
}

/** Hashtags in a document, skipping code blocks and fences. */
export function findHashtags(lines: string[], options: HashtagOptions = {}): HashtagMatch[] {
    const matches: HashtagMatch[] = [];
    let inBlock = false;
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (inBlock) {
            if (BLOCK_END.test(text)) inBlock = false;
            continue;
        }
        if (inFence) {
            if (FENCE.test(text)) inFence = false;
            continue;
        }
        if (BLOCK_BEGIN.test(text)) {
            inBlock = true;
            continue;
        }
        if (FENCE.test(text)) {
            inFence = true;
            continue;
        }
        matches.push(...hashtagsInLine(text, i, options));
    }
    return matches;
}

/** The hashtag covering (line, column), or undefined. */
export function hashtagAt(lines: string[], line: number, column: number, options: HashtagOptions = {}): HashtagMatch | undefined {
    if (line < 0 || line >= lines.length) return undefined;
    // Cheap line check first; the block scan only runs on a hit.
    const onLine = hashtagsInLine(lines[line], line, options).find(h => column >= h.start && column <= h.end);
    if (!onLine) return undefined;
    return findHashtags(lines, options).find(h => h.line === line && h.start === onLine.start);
}

/** Distinct hashtags in content, lowercased, as the database stores them. */
export function extractHashtagTags(content: string, options: HashtagOptions = {}): string[] {
    return Array.from(new Set(findHashtags(content.split('\n'), options).map(h => h.tag.toLowerCase())));
}

/**
 * A hashtag being typed: the text before the cursor ends in `#` or `#ta`
 * where a hashtag can start. `start` is the column of the `#`, `prefix` the
 * part typed after it. Undefined anywhere else, including `##`, `[#A]`,
 * `page#sec` and `#+KEY`.
 */
export function hashtagPrefixBefore(textBeforeCursor: string): { start: number; prefix: string } | undefined {
    const m = /(?:^|[\s(])#([A-Za-z][\w-]*)?$/.exec(textBeforeCursor);
    if (!m) return undefined;
    const prefix = m[1] ?? '';
    return { start: textBeforeCursor.length - prefix.length - 1, prefix };
}

/** True for text that can follow `#` as a whole hashtag. */
export function isValidHashtag(tag: string): boolean {
    return /^[A-Za-z](?:[\w-]*\w)?$/.test(tag);
}
