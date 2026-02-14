/**
 * Parser for org-mode inline objects
 * Handles text emphasis, links, timestamps, entities, subscripts, superscripts, etc.
 */

import type {
    OrgObject,
    ObjectType,
    OrgRange,
    BoldObject,
    ItalicObject,
    UnderlineObject,
    StrikeThroughObject,
    CodeObject,
    VerbatimObject,
    LinkObject,
    TimestampObject,
    EntityObject,
    LatexFragmentObject,
    SubscriptObject,
    SuperscriptObject,
    StatisticsCookieObject,
    FootnoteReferenceObject,
    TargetObject,
    RadioTargetObject,
    LineBreakObject,
    PlainTextObject,
    InlineSrcBlockObject,
    InlineBabelCallObject,
    ExportSnippetObject,
    MacroObject,
} from './orgElementTypes';
import { ORG_ENTITIES, getEntity } from './orgEntities';

// =============================================================================
// Pre-compiled Regex Patterns (Performance Optimization)
// =============================================================================

// LaTeX patterns
const RE_LATEX_COMMAND = /^\\([a-zA-Z]+)(\{[^}]*\})?/;

// Entity pattern
const RE_ENTITY = /^\\([a-zA-Z]+)(\{\})?/;

// Statistics cookie
const RE_STATISTICS_COOKIE = /^\[(\d+\/\d+|\d+%)\]/;

// Timestamp patterns
const RE_TIMESTAMP_CONTENT = /^(\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2})(?:-(\d{2}):(\d{2}))?)?(?:\s+([.+]?\+\d+[hdwmy]))?(?:\s+(-\d+[hdwmy]))?/;
const RE_TIMESTAMP_RANGE = /^[<\[](\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2}))?[>\]]/;
const RE_REPEATER = /^([.+]?\+)(\d+)([hdwmy])$/;
const RE_WARNING = /^(-{1,2})(\d+)([hdwmy])$/;

// Footnote reference
const RE_FOOTNOTE_REF = /^\[fn:([^:\]]*)?(?::([^\]]*))?\]/;

// Target patterns
const RE_TARGET = /^<<([^<>\n]+)>>/;
const RE_RADIO_TARGET = /^<<<([^<>\n]+)>>>/;

// Inline src block
const RE_INLINE_SRC = /^src_([a-zA-Z0-9-]+)(?:\[([^\]]*)\])?\{([^}]*)\}/;

// Inline babel call
const RE_INLINE_BABEL = /^call_([a-zA-Z0-9_-]+)(?:\[([^\]]*)\])?\(([^)]*)\)(?:\[([^\]]*)\])?/;

// Export snippet
const RE_EXPORT_SNIPPET = /^@@([a-zA-Z0-9-]+):([^@]*)@@/;

// Macro
const RE_MACRO = /^\{\{\{([a-zA-Z][a-zA-Z0-9_-]*)(?:\(([^)]*)\))?\}\}\}/;

// Subscript/superscript
const RE_SUBSCRIPT = /^_([a-zA-Z0-9]+)/;
const RE_SUPERSCRIPT = /^\^([a-zA-Z0-9]+)/;

// Citation links (bare format: cite:key, citep:key1,key2, citet:&key1;&key2)
// Supports org-ref v2 (comma-separated) and v3 (ampersand-prefixed, semicolon-separated)
const RE_CITATION_LINK = /^(cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt|citenum):([\w&;,:-]+)/;

// Plain links (type:path format without brackets)
// Matches registered link types: ref, doi, id, file, http, https, mailto, etc.
// Path can contain: word chars, &, ;, ,, :, -, ., /, #, ?, =, %, ~
const PLAIN_LINK_TYPES = ['ref', 'doi', 'id', 'file', 'mailto', 'shell', 'elisp', 'help', 'info', 'roam', 'cmd', 'nb', 'eqref', 'pageref', 'nameref', 'autoref', 'label', 'bibliography', 'bibliographystyle', 'bibstyle'];
const RE_PLAIN_LINK = new RegExp(`^(${PLAIN_LINK_TYPES.join('|')}):([-\\w&;,:./#?=%~]+)`);

// URL-style plain links (http://, https://)
// These need special handling because URLs can have more complex paths
const RE_URL_LINK = /^(https?):\/\/([^\s\[\]<>]+)/;

// =============================================================================
// Object Parser Configuration
// =============================================================================

/**
 * Characters that can precede emphasis markers (as Set for O(1) lookup)
 */
const PRE_EMPHASIS_SET = new Set([' ', '\t', '\n', '-', '(', '{', "'", '"']);

/**
 * Characters that can follow emphasis markers (as Set for O(1) lookup)
 */
const POST_EMPHASIS_SET = new Set([' ', '\t', '\n', '-', '.', ',', ':', '!', '?', ';', "'", '"', ')', '}', '\\', '[', ']']);

// Keep regex versions for export compatibility
const PRE_EMPHASIS_CHARS = /[\s\-({'"]/;
const POST_EMPHASIS_CHARS = /[\s\-.,:!?;'")}\\[\]]/;

/**
 * Emphasis marker pairs
 */
const EMPHASIS_MARKERS: Record<string, { type: ObjectType; close: string }> = {
    '*': { type: 'bold', close: '*' },
    '/': { type: 'italic', close: '/' },
    '_': { type: 'underline', close: '_' },
    '+': { type: 'strike-through', close: '+' },
    '=': { type: 'code', close: '=' },
    '~': { type: 'verbatim', close: '~' },
};

/**
 * Characters that can start an inline object (for fast-path routing)
 */
const OBJECT_START_CHARS = new Set([
    '\\', '$', '[', '<', '@', '{', '_', '^', '*', '/', '+', '=', '~',
    's', 'c', 'C',  // src_, call_, citation types
    'r', 'd', 'i', 'f', 'm', 'e', 'n', 'p', 'a', 'l', 'h',  // plain link types: ref, doi, id, file, mailto, elisp/eqref, nb/nameref, pageref, autoref, label, help/http
]);

// =============================================================================
// Main Parser Class
// =============================================================================

export interface ParseObjectsOptions {
    /** Allowed object types (null = all allowed) */
    allowedTypes?: ObjectType[] | null;
    /** Whether to parse nested objects in emphasis */
    parseNested?: boolean;
    /** Starting offset in the original document */
    baseOffset?: number;
}

/**
 * Parse inline objects from text
 */
export function parseObjects(
    text: string,
    options: ParseObjectsOptions = {}
): OrgObject[] {
    const { allowedTypes = null, parseNested = true, baseOffset = 0 } = options;
    const objects: OrgObject[] = [];
    let pos = 0;
    let plainTextStart = 0;

    const isAllowed = (type: ObjectType): boolean => {
        return allowedTypes === null || allowedTypes.includes(type);
    };

    const addPlainText = (end: number): void => {
        if (plainTextStart < end) {
            const value = text.slice(plainTextStart, end);
            if (value) {
                objects.push(createPlainText(value, plainTextStart + baseOffset, end + baseOffset));
            }
        }
    };

    while (pos < text.length) {
        const char = text[pos];

        // Fast path: skip characters that can't start any object
        if (!OBJECT_START_CHARS.has(char)) {
            pos++;
            continue;
        }

        const prevChar = pos > 0 ? text[pos - 1] : ' ';
        let parsed: OrgObject | null = null;

        // Route based on first character for efficiency
        switch (char) {
            case '\\':
                // Line break (\\)
                if (text[pos + 1] === '\\' && isAllowed('line-break')) {
                    parsed = tryParseLineBreak(text, pos, baseOffset);
                }
                // LaTeX fragment (\(...\), \[...\], \command)
                if (!parsed && isAllowed('latex-fragment')) {
                    parsed = tryParseLatexFragment(text, pos, baseOffset);
                }
                // Entity (\alpha, \rightarrow, etc.)
                if (!parsed && isAllowed('entity')) {
                    parsed = tryParseEntity(text, pos, baseOffset);
                }
                break;

            case '$':
                // LaTeX fragment ($...$, $$...$$)
                if (isAllowed('latex-fragment')) {
                    parsed = tryParseLatexFragment(text, pos, baseOffset);
                }
                break;

            case '[':
                // Footnote reference ([fn:...]) - check before link
                if (text[pos + 1] === 'f' && text[pos + 2] === 'n' && text[pos + 3] === ':' && isAllowed('footnote-reference')) {
                    parsed = tryParseFootnoteReference(text, pos, baseOffset);
                }
                // Link ([[...]])
                if (!parsed && text[pos + 1] === '[' && isAllowed('link')) {
                    parsed = tryParseBracketLink(text, pos, baseOffset, { parseNested, allowedTypes });
                }
                // Statistics cookie ([2/5] or [40%])
                if (!parsed && isAllowed('statistics-cookie')) {
                    parsed = tryParseStatisticsCookie(text, pos, baseOffset);
                }
                // Timestamp ([...])
                if (!parsed && isAllowed('timestamp')) {
                    parsed = tryParseTimestamp(text, pos, baseOffset);
                }
                break;

            case '<':
                // Radio target (<<<...>>>)
                if (text[pos + 1] === '<' && text[pos + 2] === '<' && isAllowed('radio-target')) {
                    parsed = tryParseRadioTarget(text, pos, baseOffset, { parseNested, allowedTypes });
                }
                // Target (<<...>>)
                if (!parsed && text[pos + 1] === '<' && text[pos + 2] !== '<' && isAllowed('target')) {
                    parsed = tryParseTarget(text, pos, baseOffset);
                }
                // Timestamp (<...>)
                if (!parsed && isAllowed('timestamp')) {
                    parsed = tryParseTimestamp(text, pos, baseOffset);
                }
                break;

            case '@':
                // Export snippet (@@backend:value@@)
                if (text[pos + 1] === '@' && isAllowed('export-snippet')) {
                    parsed = tryParseExportSnippet(text, pos, baseOffset);
                }
                break;

            case '{':
                // Macro ({{{name(args)}}})
                if (text[pos + 1] === '{' && text[pos + 2] === '{' && isAllowed('macro')) {
                    parsed = tryParseMacro(text, pos, baseOffset);
                }
                break;

            case 's':
                // Inline src block (src_lang{...})
                if (text[pos + 1] === 'r' && text[pos + 2] === 'c' && text[pos + 3] === '_' && isAllowed('inline-src-block')) {
                    parsed = tryParseInlineSrcBlock(text, pos, baseOffset);
                }
                break;

            case 'c':
                // Inline babel call (call_name(...))
                if (text[pos + 1] === 'a' && text[pos + 2] === 'l' && text[pos + 3] === 'l' && text[pos + 4] === '_' && isAllowed('inline-babel-call')) {
                    parsed = tryParseInlineBabelCall(text, pos, baseOffset);
                }
                // Citation links (cite:, citep:, citet:, citeauthor:, etc.)
                if (!parsed && isAllowed('link')) {
                    parsed = tryParseCitationLink(text, pos, prevChar, baseOffset);
                }
                break;

            case 'C':
                // Capitalized citation links (Citep:, Citet:)
                if (isAllowed('link')) {
                    parsed = tryParseCitationLink(text, pos, prevChar, baseOffset);
                }
                break;

            case '_':
                // Subscript (a_b or a_{bc}) - only after word char
                if (pos > 0 && isAllowed('subscript')) {
                    parsed = tryParseSubscript(text, pos, prevChar, baseOffset, { parseNested, allowedTypes });
                }
                // Also check for underline emphasis
                if (!parsed && isAllowed('underline')) {
                    parsed = tryParseEmphasis(text, pos, char, prevChar, baseOffset, { parseNested, allowedTypes });
                }
                break;

            case '^':
                // Superscript (a^b or a^{bc})
                if (pos > 0 && isAllowed('superscript')) {
                    parsed = tryParseSuperscript(text, pos, prevChar, baseOffset, { parseNested, allowedTypes });
                }
                break;

            case '*':
            case '/':
            case '+':
            case '=':
            case '~':
                // Emphasis markers
                if (char in EMPHASIS_MARKERS) {
                    const emphasisInfo = EMPHASIS_MARKERS[char];
                    if (isAllowed(emphasisInfo.type)) {
                        parsed = tryParseEmphasis(text, pos, char, prevChar, baseOffset, { parseNested, allowedTypes });
                    }
                }
                break;

            // Plain link types (ref:, doi:, id:, file:, mailto:, etc.)
            case 'r': // ref, roam
            case 'd': // doi
            case 'i': // id, info
            case 'f': // file
            case 'm': // mailto
            case 'e': // elisp, eqref
            case 'n': // nb, nameref
            case 'p': // pageref
            case 'a': // autoref
            case 'l': // label
                if (isAllowed('link')) {
                    parsed = tryParsePlainLink(text, pos, prevChar, baseOffset);
                }
                break;

            case 'h': // help, http, https
                if (isAllowed('link')) {
                    // Try URL link first (http://, https://)
                    parsed = tryParseUrlLink(text, pos, prevChar, baseOffset);
                    // Fall back to plain link (help:)
                    if (!parsed) {
                        parsed = tryParsePlainLink(text, pos, prevChar, baseOffset);
                    }
                }
                break;
        }

        if (parsed) {
            addPlainText(pos);
            objects.push(parsed);
            pos = parsed.range.end - baseOffset;
            plainTextStart = pos;
        } else {
            pos++;
        }
    }

    // Add remaining plain text
    addPlainText(text.length);

    return objects;
}

// =============================================================================
// Individual Object Parsers
// =============================================================================

function createPlainText(value: string, start: number, end: number): PlainTextObject {
    return {
        type: 'plain-text',
        range: { start, end },
        postBlank: 0,
        properties: { value },
    };
}

function tryParseLineBreak(text: string, pos: number, baseOffset: number): LineBreakObject | null {
    if (text.slice(pos, pos + 2) === '\\\\') {
        // Check if followed by newline or end of string
        const afterSlashes = text[pos + 2];
        if (afterSlashes === '\n' || afterSlashes === undefined || afterSlashes === ' ') {
            return {
                type: 'line-break',
                range: { start: pos + baseOffset, end: pos + 2 + baseOffset },
                postBlank: 0,
            };
        }
    }
    return null;
}

function tryParseLatexFragment(text: string, pos: number, baseOffset: number): LatexFragmentObject | null {
    // Inline math: $...$
    if (text[pos] === '$' && text[pos + 1] !== '$') {
        const endPos = findClosingDelimiter(text, pos + 1, '$');
        if (endPos > pos + 1 && !text.slice(pos + 1, endPos).includes('\n')) {
            return {
                type: 'latex-fragment',
                range: { start: pos + baseOffset, end: endPos + 1 + baseOffset },
                postBlank: 0,
                properties: {
                    value: text.slice(pos, endPos + 1),
                    fragmentType: 'inline-math',
                },
            };
        }
    }

    // Display math: $$...$$
    if (text.slice(pos, pos + 2) === '$$') {
        const endPos = text.indexOf('$$', pos + 2);
        if (endPos > pos + 2) {
            return {
                type: 'latex-fragment',
                range: { start: pos + baseOffset, end: endPos + 2 + baseOffset },
                postBlank: 0,
                properties: {
                    value: text.slice(pos, endPos + 2),
                    fragmentType: 'display-math',
                },
            };
        }
    }

    // \(...\) inline math
    if (text.slice(pos, pos + 2) === '\\(') {
        const endPos = text.indexOf('\\)', pos + 2);
        if (endPos > pos + 2) {
            return {
                type: 'latex-fragment',
                range: { start: pos + baseOffset, end: endPos + 2 + baseOffset },
                postBlank: 0,
                properties: {
                    value: text.slice(pos, endPos + 2),
                    fragmentType: 'inline-math',
                },
            };
        }
    }

    // \[...\] display math
    if (text.slice(pos, pos + 2) === '\\[') {
        const endPos = text.indexOf('\\]', pos + 2);
        if (endPos > pos + 2) {
            return {
                type: 'latex-fragment',
                range: { start: pos + baseOffset, end: endPos + 2 + baseOffset },
                postBlank: 0,
                properties: {
                    value: text.slice(pos, endPos + 2),
                    fragmentType: 'display-math',
                },
            };
        }
    }

    // LaTeX command: \command or \command{arg}
    if (text[pos] === '\\') {
        const match = text.slice(pos).match(RE_LATEX_COMMAND);
        if (match && !getEntity(match[1])) {
            // Not an entity, treat as LaTeX command
            const fullMatch = match[0];
            return {
                type: 'latex-fragment',
                range: { start: pos + baseOffset, end: pos + fullMatch.length + baseOffset },
                postBlank: 0,
                properties: {
                    value: fullMatch,
                    fragmentType: 'command',
                },
            };
        }
    }

    return null;
}

function tryParseEntity(text: string, pos: number, baseOffset: number): EntityObject | null {
    if (text[pos] !== '\\') return null;

    // Match \entityname or \entityname{} - use pre-compiled pattern
    const match = text.slice(pos).match(RE_ENTITY);
    if (!match) return null;

    const entityName = match[1];
    const entity = getEntity(entityName);
    if (!entity) return null;

    const usesBrackets = match[2] === '{}';
    const fullLength = match[0].length;

    return {
        type: 'entity',
        range: { start: pos + baseOffset, end: pos + fullLength + baseOffset },
        postBlank: 0,
        properties: {
            name: entityName,
            usesBrackets,
            latex: entity.latex,
            html: entity.html,
            utf8: entity.utf8,
        },
    };
}

function tryParseStatisticsCookie(text: string, pos: number, baseOffset: number): StatisticsCookieObject | null {
    // [2/5] or [40%] - use pre-compiled pattern
    const match = text.slice(pos).match(RE_STATISTICS_COOKIE);
    if (!match) return null;

    return {
        type: 'statistics-cookie',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            value: match[0],
        },
    };
}

function tryParseTimestamp(text: string, pos: number, baseOffset: number): TimestampObject | null {
    const isActive = text[pos] === '<';
    const openBracket = isActive ? '<' : '[';
    const closeBracket = isActive ? '>' : ']';

    // Find closing bracket
    let depth = 1;
    let endPos = pos + 1;
    while (endPos < text.length && depth > 0) {
        if (text[endPos] === openBracket) depth++;
        else if (text[endPos] === closeBracket) depth--;
        endPos++;
    }

    if (depth !== 0) return null;

    const content = text.slice(pos + 1, endPos - 1);

    // Parse the timestamp content
    // Format: YYYY-MM-DD DAY [HH:MM[-HH:MM]] [REPEATER] [WARNING]
    // Use pre-compiled pattern
    const dateMatch = content.match(RE_TIMESTAMP_CONTENT);

    if (!dateMatch) return null;

    const [
        ,
        yearStr,
        monthStr,
        dayStr,
        hourStartStr,
        minuteStartStr,
        hourEndStr,
        minuteEndStr,
        repeaterStr,
        warningStr,
    ] = dateMatch;

    // Check for range timestamps: <...>--<...>
    let timestampType: TimestampObject['properties']['timestampType'] = isActive ? 'active' : 'inactive';
    let rangeEnd: { year: number; month: number; day: number; hour?: number; minute?: number } | undefined;

    // Fast check: only try range if we have '--'
    if (text[endPos] === '-' && text[endPos + 1] === '-') {
        const secondMatch = text.slice(endPos + 2).match(RE_TIMESTAMP_RANGE);
        if (secondMatch) {
            timestampType = isActive ? 'active-range' : 'inactive-range';
            rangeEnd = {
                year: parseInt(secondMatch[1], 10),
                month: parseInt(secondMatch[2], 10),
                day: parseInt(secondMatch[3], 10),
                hour: secondMatch[4] ? parseInt(secondMatch[4], 10) : undefined,
                minute: secondMatch[5] ? parseInt(secondMatch[5], 10) : undefined,
            };
            endPos += 2 + secondMatch[0].length;
        }
    }

    // Parse repeater - use pre-compiled pattern
    let repeaterType: TimestampObject['properties']['repeaterType'];
    let repeaterValue: number | undefined;
    let repeaterUnit: TimestampObject['properties']['repeaterUnit'];

    if (repeaterStr) {
        const repMatch = repeaterStr.match(RE_REPEATER);
        if (repMatch) {
            repeaterType = repMatch[1] as '+' | '++' | '.+';
            repeaterValue = parseInt(repMatch[2], 10);
            repeaterUnit = repMatch[3] as 'h' | 'd' | 'w' | 'm' | 'y';
        }
    }

    // Parse warning - use pre-compiled pattern
    let warningType: TimestampObject['properties']['warningType'];
    let warningValue: number | undefined;
    let warningUnit: TimestampObject['properties']['warningUnit'];

    if (warningStr) {
        const warnMatch = warningStr.match(RE_WARNING);
        if (warnMatch) {
            warningType = warnMatch[1] as '-' | '--';
            warningValue = parseInt(warnMatch[2], 10);
            warningUnit = warnMatch[3] as 'h' | 'd' | 'w' | 'm' | 'y';
        }
    }

    const properties: TimestampObject['properties'] = {
        timestampType,
        rawValue: text.slice(pos, endPos),
        yearStart: parseInt(yearStr, 10),
        monthStart: parseInt(monthStr, 10),
        dayStart: parseInt(dayStr, 10),
    };

    if (hourStartStr) {
        properties.hourStart = parseInt(hourStartStr, 10);
        properties.minuteStart = parseInt(minuteStartStr, 10);
    }

    if (hourEndStr) {
        // Time range within same day
        properties.hourEnd = parseInt(hourEndStr, 10);
        properties.minuteEnd = parseInt(minuteEndStr, 10);
    }

    if (rangeEnd) {
        properties.yearEnd = rangeEnd.year;
        properties.monthEnd = rangeEnd.month;
        properties.dayEnd = rangeEnd.day;
        if (rangeEnd.hour !== undefined) {
            properties.hourEnd = rangeEnd.hour;
            properties.minuteEnd = rangeEnd.minute;
        }
    }

    if (repeaterType) {
        properties.repeaterType = repeaterType;
        properties.repeaterValue = repeaterValue;
        properties.repeaterUnit = repeaterUnit;
    }

    if (warningType) {
        properties.warningType = warningType;
        properties.warningValue = warningValue;
        properties.warningUnit = warningUnit;
    }

    return {
        type: 'timestamp',
        range: { start: pos + baseOffset, end: endPos + baseOffset },
        postBlank: 0,
        properties,
    };
}

function tryParseBracketLink(
    text: string,
    pos: number,
    baseOffset: number,
    options: ParseObjectsOptions
): LinkObject | null {
    // [[link]] or [[link][description]]
    if (text.slice(pos, pos + 2) !== '[[') return null;

    // Find the end of the link path
    let linkEnd = pos + 2;
    let bracketDepth = 0;

    while (linkEnd < text.length) {
        if (text[linkEnd] === '[') bracketDepth++;
        else if (text[linkEnd] === ']') {
            if (bracketDepth === 0) break;
            bracketDepth--;
        }
        linkEnd++;
    }

    if (linkEnd >= text.length) return null;

    const linkPath = text.slice(pos + 2, linkEnd);

    // Check for description
    let description: OrgObject[] | undefined;
    let fullEnd = linkEnd + 1;

    if (text[linkEnd + 1] === '[') {
        // Has description
        const descStart = linkEnd + 2;
        let descEnd = descStart;
        bracketDepth = 0;

        while (descEnd < text.length) {
            if (text[descEnd] === '[') bracketDepth++;
            else if (text[descEnd] === ']') {
                if (bracketDepth === 0) break;
                bracketDepth--;
            }
            descEnd++;
        }

        if (descEnd < text.length && text[descEnd + 1] === ']') {
            const descText = text.slice(descStart, descEnd);
            if (options.parseNested) {
                description = parseObjects(descText, {
                    ...options,
                    baseOffset: baseOffset + descStart,
                });
            } else {
                description = [createPlainText(descText, baseOffset + descStart, baseOffset + descEnd)];
            }
            fullEnd = descEnd + 2;
        } else {
            // Malformed, just close after link
            fullEnd = linkEnd + 2;
        }
    } else if (text[linkEnd + 1] === ']') {
        fullEnd = linkEnd + 2;
    } else {
        return null; // Malformed
    }

    // Determine link type
    let linkType = 'internal';
    let path = linkPath;
    let searchOption: string | undefined;
    let application: string | undefined;

    if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
        linkType = linkPath.startsWith('https://') ? 'https' : 'http';
    } else if (linkPath.startsWith('file:')) {
        linkType = 'file';
        path = linkPath.slice(5);
        // Check for search option (file:path::search)
        const searchIdx = path.indexOf('::');
        if (searchIdx !== -1) {
            searchOption = path.slice(searchIdx + 2);
            path = path.slice(0, searchIdx);
        }
    } else if (linkPath.startsWith('id:')) {
        linkType = 'id';
        path = linkPath.slice(3);
    } else if (linkPath.includes(':')) {
        const colonIdx = linkPath.indexOf(':');
        const maybeProtocol = linkPath.slice(0, colonIdx);
        if (/^[a-z]+$/.test(maybeProtocol)) {
            linkType = maybeProtocol;
            path = linkPath.slice(colonIdx + 1);
        }
    }

    return {
        type: 'link',
        range: { start: pos + baseOffset, end: fullEnd + baseOffset },
        postBlank: 0,
        properties: {
            linkType,
            path,
            format: 'bracket',
            rawLink: linkPath,
            searchOption,
            application,
        },
        children: description,
    };
}

function tryParseFootnoteReference(
    text: string,
    pos: number,
    baseOffset: number
): FootnoteReferenceObject | null {
    // [fn:label] or [fn:label:definition] or [fn::definition]
    // Use pre-compiled pattern
    const match = text.slice(pos).match(RE_FOOTNOTE_REF);
    if (!match) return null;

    const label = match[1] || undefined;
    const definition = match[2];
    const isInline = definition !== undefined;

    const result: FootnoteReferenceObject = {
        type: 'footnote-reference',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            label,
            referenceType: isInline ? 'inline' : 'standard',
        },
    };

    if (isInline && definition) {
        // Parse the inline definition
        result.children = parseObjects(definition, {
            baseOffset: baseOffset + pos + 4 + (label?.length || 0) + 1,
        });
    }

    return result;
}

function tryParseTarget(text: string, pos: number, baseOffset: number): TargetObject | null {
    // <<target>> - use pre-compiled pattern
    const match = text.slice(pos).match(RE_TARGET);
    if (!match) return null;

    return {
        type: 'target',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            value: match[1],
        },
    };
}

function tryParseRadioTarget(
    text: string,
    pos: number,
    baseOffset: number,
    options: ParseObjectsOptions
): RadioTargetObject | null {
    // <<<radio target>>> - use pre-compiled pattern
    const match = text.slice(pos).match(RE_RADIO_TARGET);
    if (!match) return null;

    const content = match[1];
    const children = options.parseNested
        ? parseObjects(content, { ...options, baseOffset: baseOffset + pos + 3 })
        : [createPlainText(content, pos + 3 + baseOffset, pos + 3 + content.length + baseOffset)];

    return {
        type: 'radio-target',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        children,
    };
}

function tryParseInlineSrcBlock(text: string, pos: number, baseOffset: number): InlineSrcBlockObject | null {
    // src_lang{code} or src_lang[headers]{code} - use pre-compiled pattern
    const match = text.slice(pos).match(RE_INLINE_SRC);
    if (!match) return null;

    return {
        type: 'inline-src-block',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            language: match[1],
            parameters: match[2],
            value: match[3],
        },
    };
}

function tryParseInlineBabelCall(text: string, pos: number, baseOffset: number): InlineBabelCallObject | null {
    // call_name(args) or call_name[header](args)[end-header] - use pre-compiled pattern
    const match = text.slice(pos).match(RE_INLINE_BABEL);
    if (!match) return null;

    return {
        type: 'inline-babel-call',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            call: match[1],
            insideHeader: match[2],
            arguments: match[3],
            endHeader: match[4],
        },
    };
}

function tryParseExportSnippet(text: string, pos: number, baseOffset: number): ExportSnippetObject | null {
    // @@backend:value@@ - use pre-compiled pattern
    const match = text.slice(pos).match(RE_EXPORT_SNIPPET);
    if (!match) return null;

    return {
        type: 'export-snippet',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            backend: match[1],
            value: match[2],
        },
    };
}

function tryParseMacro(text: string, pos: number, baseOffset: number): MacroObject | null {
    // {{{name(args)}}} or {{{name}}} - use pre-compiled pattern
    const match = text.slice(pos).match(RE_MACRO);
    if (!match) return null;

    const args = match[2] ? match[2].split(',').map(s => s.trim()) : [];

    return {
        type: 'macro',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            key: match[1],
            args,
        },
    };
}

function tryParseCitationLink(text: string, pos: number, prevChar: string, baseOffset: number): LinkObject | null {
    // Citation links: cite:key, citep:key1,key2, citet:&key1;&key2
    // Must not be preceded by a word character (to avoid matching mid-word)
    if (prevChar && /\w/.test(prevChar)) {
        return null;
    }

    const match = text.slice(pos).match(RE_CITATION_LINK);
    if (!match) return null;

    const command = match[1];
    const path = match[2];

    return {
        type: 'link',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            linkType: command.toLowerCase(),
            path,
            format: 'plain',
            rawLink: match[0],
        },
        children: undefined,
    };
}

/**
 * Try to parse a plain link (type:path format without brackets)
 * Handles: ref:label, doi:10.xxx, id:uuid, file:path, mailto:email, etc.
 */
function tryParsePlainLink(text: string, pos: number, prevChar: string, baseOffset: number): LinkObject | null {
    // Must not be preceded by a word character (to avoid matching mid-word)
    if (prevChar && /\w/.test(prevChar)) {
        return null;
    }

    const match = text.slice(pos).match(RE_PLAIN_LINK);
    if (!match) return null;

    const linkType = match[1].toLowerCase();
    let path = match[2];

    // For file: links, extract search option if present (file:path::search)
    let searchOption: string | undefined;
    if (linkType === 'file') {
        const searchIdx = path.indexOf('::');
        if (searchIdx !== -1) {
            searchOption = path.slice(searchIdx + 2);
            path = path.slice(0, searchIdx);
        }
    }

    return {
        type: 'link',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: {
            linkType,
            path,
            format: 'plain',
            rawLink: match[0],
            searchOption,
        },
        children: undefined,
    };
}

/**
 * Try to parse a URL-style plain link (http://... or https://...)
 */
function tryParseUrlLink(text: string, pos: number, prevChar: string, baseOffset: number): LinkObject | null {
    // Must not be preceded by a word character
    if (prevChar && /\w/.test(prevChar)) {
        return null;
    }

    const match = text.slice(pos).match(RE_URL_LINK);
    if (!match) return null;

    const linkType = match[1].toLowerCase();
    const fullUrl = match[0];

    // Trim trailing punctuation that's likely not part of the URL
    let trimmed = fullUrl;
    while (trimmed.length > 0 && /[.,;:!?)]+$/.test(trimmed)) {
        // But keep if it looks like part of URL (e.g., closing paren with matching open)
        const lastChar = trimmed[trimmed.length - 1];
        if (lastChar === ')' && (trimmed.match(/\(/g) || []).length > (trimmed.match(/\)/g) || []).length - 1) {
            break; // Keep the paren, it's probably part of the URL
        }
        trimmed = trimmed.slice(0, -1);
    }

    return {
        type: 'link',
        range: { start: pos + baseOffset, end: pos + trimmed.length + baseOffset },
        postBlank: 0,
        properties: {
            linkType,
            path: trimmed,
            format: 'plain',
            rawLink: trimmed,
        },
        children: undefined,
    };
}

function tryParseSubscript(
    text: string,
    pos: number,
    prevChar: string,
    baseOffset: number,
    options: ParseObjectsOptions
): SubscriptObject | null {
    // Must follow a word character
    if (!/[a-zA-Z0-9)]/.test(prevChar)) return null;

    // _content or _{content}
    if (text[pos + 1] === '{') {
        const endBrace = findMatchingBrace(text, pos + 1);
        if (endBrace === -1) return null;

        const content = text.slice(pos + 2, endBrace);
        const children = options.parseNested
            ? parseObjects(content, { ...options, baseOffset: baseOffset + pos + 2 })
            : [createPlainText(content, pos + 2 + baseOffset, endBrace + baseOffset)];

        return {
            type: 'subscript',
            range: { start: pos + baseOffset, end: endBrace + 1 + baseOffset },
            postBlank: 0,
            properties: { usesBraces: true },
            children,
        };
    }

    // Simple subscript: _x (single character or digits) - use pre-compiled pattern
    const match = text.slice(pos).match(RE_SUBSCRIPT);
    if (!match) return null;

    return {
        type: 'subscript',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: { usesBraces: false },
        children: [createPlainText(match[1], pos + 1 + baseOffset, pos + match[0].length + baseOffset)],
    };
}

function tryParseSuperscript(
    text: string,
    pos: number,
    prevChar: string,
    baseOffset: number,
    options: ParseObjectsOptions
): SuperscriptObject | null {
    // Must follow a word character
    if (!/[a-zA-Z0-9)]/.test(prevChar)) return null;

    // ^content or ^{content}
    if (text[pos + 1] === '{') {
        const endBrace = findMatchingBrace(text, pos + 1);
        if (endBrace === -1) return null;

        const content = text.slice(pos + 2, endBrace);
        const children = options.parseNested
            ? parseObjects(content, { ...options, baseOffset: baseOffset + pos + 2 })
            : [createPlainText(content, pos + 2 + baseOffset, endBrace + baseOffset)];

        return {
            type: 'superscript',
            range: { start: pos + baseOffset, end: endBrace + 1 + baseOffset },
            postBlank: 0,
            properties: { usesBraces: true },
            children,
        };
    }

    // Simple superscript: ^x (single character or digits) - use pre-compiled pattern
    const match = text.slice(pos).match(RE_SUPERSCRIPT);
    if (!match) return null;

    return {
        type: 'superscript',
        range: { start: pos + baseOffset, end: pos + match[0].length + baseOffset },
        postBlank: 0,
        properties: { usesBraces: false },
        children: [createPlainText(match[1], pos + 1 + baseOffset, pos + match[0].length + baseOffset)],
    };
}

function tryParseEmphasis(
    text: string,
    pos: number,
    marker: string,
    prevChar: string,
    baseOffset: number,
    options: ParseObjectsOptions
): OrgObject | null {
    const emphasisInfo = EMPHASIS_MARKERS[marker];
    if (!emphasisInfo) return null;

    // Check pre-condition: must be at start or after whitespace/punctuation
    // Use Set for O(1) lookup instead of regex
    if (pos > 0 && !PRE_EMPHASIS_SET.has(prevChar)) {
        return null;
    }

    // Find closing marker
    const closePos = findEmphasisClose(text, pos + 1, marker);
    if (closePos === -1) return null;

    // Check post-condition: must be followed by whitespace/punctuation or end
    // Use Set for O(1) lookup instead of regex
    const afterClose = text[closePos + 1];
    if (afterClose && !POST_EMPHASIS_SET.has(afterClose)) {
        return null;
    }

    const content = text.slice(pos + 1, closePos);

    // For code and verbatim, don't parse nested objects
    if (emphasisInfo.type === 'code') {
        return {
            type: 'code',
            range: { start: pos + baseOffset, end: closePos + 1 + baseOffset },
            postBlank: 0,
            properties: { value: content },
        } as CodeObject;
    }

    if (emphasisInfo.type === 'verbatim') {
        return {
            type: 'verbatim',
            range: { start: pos + baseOffset, end: closePos + 1 + baseOffset },
            postBlank: 0,
            properties: { value: content },
        } as VerbatimObject;
    }

    // For other emphasis types, parse nested objects
    const children = options.parseNested
        ? parseObjects(content, { ...options, baseOffset: baseOffset + pos + 1 })
        : [createPlainText(content, pos + 1 + baseOffset, closePos + baseOffset)];

    switch (emphasisInfo.type) {
        case 'bold':
            return {
                type: 'bold',
                range: { start: pos + baseOffset, end: closePos + 1 + baseOffset },
                postBlank: 0,
                children,
            } as BoldObject;
        case 'italic':
            return {
                type: 'italic',
                range: { start: pos + baseOffset, end: closePos + 1 + baseOffset },
                postBlank: 0,
                children,
            } as ItalicObject;
        case 'underline':
            return {
                type: 'underline',
                range: { start: pos + baseOffset, end: closePos + 1 + baseOffset },
                postBlank: 0,
                children,
            } as UnderlineObject;
        case 'strike-through':
            return {
                type: 'strike-through',
                range: { start: pos + baseOffset, end: closePos + 1 + baseOffset },
                postBlank: 0,
                children,
            } as StrikeThroughObject;
    }

    return null;
}

// =============================================================================
// Helper Functions
// =============================================================================

function findClosingDelimiter(text: string, start: number, delimiter: string): number {
    let pos = start;
    while (pos < text.length) {
        if (text[pos] === delimiter) {
            return pos;
        }
        if (text[pos] === '\\') {
            pos++; // Skip escaped character
        }
        pos++;
    }
    return -1;
}

function findMatchingBrace(text: string, pos: number): number {
    if (text[pos] !== '{') return -1;

    let depth = 1;
    let i = pos + 1;

    while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
    }

    return depth === 0 ? i - 1 : -1;
}

function findEmphasisClose(text: string, start: number, marker: string): number {
    let pos = start;

    while (pos < text.length) {
        if (text[pos] === marker) {
            // Check that it's not at the start of a word
            const prevChar = pos > start ? text[pos - 1] : '';
            if (prevChar && !/\s/.test(prevChar)) {
                return pos;
            }
        }
        if (text[pos] === '\n') {
            // Emphasis cannot span multiple lines
            return -1;
        }
        pos++;
    }

    return -1;
}

// =============================================================================
// Exports
// =============================================================================

export {
    parseObjects as default,
    PRE_EMPHASIS_CHARS,
    POST_EMPHASIS_CHARS,
    EMPHASIS_MARKERS,
    createPlainText,
};
