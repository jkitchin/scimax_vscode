/**
 * Fast Export Parser for org-mode
 * Uses regex-based parsing instead of character-by-character for better performance
 * Optimized for export operations (HTML, LaTeX, Markdown, PDF)
 */

import type {
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    OrgElement,
    OrgObject,
    ParagraphElement,
    SrcBlockElement,
    ExampleBlockElement,
    QuoteBlockElement,
    ExportBlockElement,
    KeywordElement,
    TableElement,
    TableRowElement,
    TableCellObject,
    PlainListElement,
    ItemElement,
    FixedWidthElement,
    CommentElement,
    DrawerElement,
    FootnoteDefinitionElement,
    PlanningElement,
    TimestampObject,
    BoldObject,
    ItalicObject,
    UnderlineObject,
    StrikeThroughObject,
    CodeObject,
    VerbatimObject,
    LinkObject,
    PlainTextObject,
    LatexFragmentObject,
    OrgRange,
} from './orgElementTypes';

import { createPlainText } from './orgObjects';

// =============================================================================
// Fast Inline Object Parser (Regex-based)
// =============================================================================

// Pre-compiled regex patterns to avoid re-creation on each call
// Using simpler patterns without lookbehind/lookahead to prevent catastrophic backtracking
const LINK_PATTERN = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g;
// Citation pattern: cite:key1,key2 but not trailing comma (cite:key, should be cite:key)
const CITATION_PATTERN = /(cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:-]+(?:,[a-zA-Z0-9_:-]+)*)/g;
const REF_PATTERN = /(ref|eqref|pageref|nameref|autoref|cref|Cref|label):([a-zA-Z0-9_:-]+)/g;
const DOI_PATTERN = /doi:(10\.\d{4,9}\/[^\s<>\[\](){}]+)/g;
const BIBLIOGRAPHY_PATTERN = /bibliography:([^\s<>\[\](){}]+)/g;
const BIBSTYLE_PATTERN = /bibstyle:([^\s<>\[\](){}]+)/g;

// Simplified markup patterns - use non-greedy matching with length limits
// These are more permissive but much faster and won't cause backtracking
const BOLD_PATTERN = /\*([^\s*](?:[^*]{0,500}[^\s*])?)\*/g;
const ITALIC_PATTERN = /\/([^\s/](?:[^/]{0,500}[^\s/])?)\/(?![a-zA-Z])/g;
const UNDERLINE_PATTERN = /_([^\s_](?:[^_]{0,500}[^\s_])?)_(?![a-zA-Z])/g;
const STRIKE_PATTERN = /\+([^\s+](?:[^+]{0,500}[^\s+])?)\+(?![a-zA-Z0-9])/g;
const CODE_PATTERN = /=([^\s=](?:[^=]{0,500}[^\s=])?)=/g;
const VERBATIM_PATTERN = /~([^\s~](?:[^~]{0,500}[^\s~])?)~/g;
// Emacs-style command markup: `command'
const COMMAND_PATTERN = /`([^`'\n]+)'/g;

// LaTeX math patterns
// Display math: $$...$$ or \[...\]
const DISPLAY_MATH_PATTERN = /\$\$([^$]+)\$\$|\\\[([^\]]+)\\\]/g;
// Inline math: $...$ (not $$) or \(...\)
const INLINE_MATH_PATTERN = /(?<!\$)\$([^$\n]+)\$(?!\$)|\\\(([^)]+)\\\)/g;
// Line break: \\ (two backslashes)
const LINE_BREAK_PATTERN = /\\\\(?:\s|$)/g;

// Macro pattern: {{{macro(args)}}} or {{{macro}}}
const MACRO_PATTERN = /\{\{\{([a-zA-Z0-9_-]+)(?:\(([^)]*)\))?\}\}\}/g;

// Export snippet pattern: @@backend:value@@
const EXPORT_SNIPPET_PATTERN = /@@([a-zA-Z]+):([^@]+)@@/g;

// Target pattern: <<target>> - creates a named anchor
const TARGET_PATTERN = /<<([^<>\n]+)>>/g;

// Radio target pattern: <<<target>>> - creates a clickable anchor
const RADIO_TARGET_PATTERN = /<<<([^<>\n]+)>>>/g;

// Footnote reference pattern: [fn:label] or [fn:label:inline definition] or [fn::inline definition]
const FOOTNOTE_REF_PATTERN = /\[fn:([a-zA-Z0-9_-]*):?([^\]]*)\]/g;

// Org-cite pattern: [cite:@key] or [cite/style:@key] or [cite:@key1;@key2]
// Captures: [1]=style (optional), [2]=full citation content (keys with optional prefix/suffix)
const ORG_CITE_PATTERN = /\[cite(?:\/([a-zA-Z]+))?:([^\]]+)\]/g;

// Planning line patterns
const RE_PLANNING_LINE = /^\s*(SCHEDULED|DEADLINE|CLOSED):/;
const RE_SCHEDULED = /SCHEDULED:\s*(<[^>]+>|\[[^\]]+\])/;
const RE_DEADLINE = /DEADLINE:\s*(<[^>]+>|\[[^\]]+\])/;
const RE_CLOSED = /CLOSED:\s*(\[[^\]]+\])/;

/**
 * Parse inline objects using regex patterns - much faster than character-by-character
 */
export function parseObjectsFast(text: string): OrgObject[] {
    // Fast path: if text is very short or has no special characters, return as plain text
    if (text.length === 0) {
        return [];
    }

    if (text.length < 3 || !/[*/_+=~\[\]:$\\]/.test(text)) {
        return [createPlainText(text, 0, text.length)];
    }

    const objects: OrgObject[] = [];

    interface MatchInfo {
        start: number;
        end: number;
        object: OrgObject;
    }

    const allMatches: MatchInfo[] = [];

    // Helper to run a pattern and collect matches
    const collectMatches = (
        pattern: RegExp,
        handler: (m: RegExpExecArray) => OrgObject | null
    ) => {
        pattern.lastIndex = 0;
        let match;
        let iterations = 0;
        const maxIterations = 10000; // Safety limit

        while ((match = pattern.exec(text)) !== null && iterations++ < maxIterations) {
            const obj = handler(match);
            if (obj) {
                allMatches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    object: obj,
                });
            }
            // Prevent infinite loops on zero-length matches
            if (match[0].length === 0) {
                pattern.lastIndex++;
            }
        }
    };

    // Links (highest priority)
    collectMatches(LINK_PATTERN, (m) => {
        const linkType = detectLinkType(m[1]);
        // Strip protocol prefix from path for file links
        let path = m[1];
        if (linkType === 'file' && path.startsWith('file:')) {
            path = path.slice(5); // Remove 'file:' prefix
        }
        return {
            type: 'link' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            properties: {
                linkType,
                path,
                format: 'bracket' as const,
                rawLink: m[0],
            },
            children: m[2] ? [createPlainText(m[2], m.index! + m[1].length + 3, m.index! + m[1].length + 3 + m[2].length)] : undefined,
        };
    });

    // Citations
    collectMatches(CITATION_PATTERN, (m) => ({
        type: 'link' as const,
        range: { start: m.index!, end: m.index! + m[0].length },
        postBlank: 0,
        properties: {
            linkType: m[1].toLowerCase(),
            path: m[2],
            format: 'plain' as const,
            rawLink: m[0],
        },
    }));

    // Cross-references
    collectMatches(REF_PATTERN, (m) => ({
        type: 'link' as const,
        range: { start: m.index!, end: m.index! + m[0].length },
        postBlank: 0,
        properties: {
            linkType: m[1],
            path: m[2],
            format: 'plain' as const,
            rawLink: m[0],
        },
    }));

    // DOI links
    collectMatches(DOI_PATTERN, (m) => ({
        type: 'link' as const,
        range: { start: m.index!, end: m.index! + m[0].length },
        postBlank: 0,
        properties: {
            linkType: 'doi',
            path: m[1],
            format: 'plain' as const,
            rawLink: m[0],
        },
    }));

    // Bibliography links
    collectMatches(BIBLIOGRAPHY_PATTERN, (m) => ({
        type: 'link' as const,
        range: { start: m.index!, end: m.index! + m[0].length },
        postBlank: 0,
        properties: {
            linkType: 'bibliography',
            path: m[1],
            format: 'plain' as const,
            rawLink: m[0],
        },
    }));

    // Bibliography style links
    collectMatches(BIBSTYLE_PATTERN, (m) => ({
        type: 'link' as const,
        range: { start: m.index!, end: m.index! + m[0].length },
        postBlank: 0,
        properties: {
            linkType: 'bibstyle',
            path: m[1],
            format: 'plain' as const,
            rawLink: m[0],
        },
    }));

    // Text markup (only if text contains the marker characters)
    // Recursively parse children to support nested markup like */bold italic/*
    if (text.includes('*')) {
        collectMatches(BOLD_PATTERN, (m) => ({
            type: 'bold' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            children: parseObjectsFast(m[1]),
        }));
    }

    if (text.includes('/')) {
        collectMatches(ITALIC_PATTERN, (m) => ({
            type: 'italic' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            children: parseObjectsFast(m[1]),
        }));
    }

    if (text.includes('_')) {
        collectMatches(UNDERLINE_PATTERN, (m) => ({
            type: 'underline' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            children: parseObjectsFast(m[1]),
        }));
    }

    if (text.includes('+')) {
        collectMatches(STRIKE_PATTERN, (m) => ({
            type: 'strike-through' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            children: parseObjectsFast(m[1]),
        }));
    }

    if (text.includes('=')) {
        collectMatches(CODE_PATTERN, (m) => ({
            type: 'verbatim' as const,  // =text= is verbatim in org-mode
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            properties: { value: m[1] },
        }));
    }

    if (text.includes('~')) {
        collectMatches(VERBATIM_PATTERN, (m) => ({
            type: 'code' as const,  // ~text~ is code in org-mode
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            properties: { value: m[1] },
        }));
    }

    // Emacs-style command markup: `command'
    if (text.includes('`') && text.includes("'")) {
        collectMatches(COMMAND_PATTERN, (m) => ({
            type: 'command' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            properties: { value: m[1] },
        }));
    }

    // LaTeX math (higher priority, check first)
    if (text.includes('$') || text.includes('\\')) {
        // Display math first ($$...$$ or \[...\]) - has higher priority
        collectMatches(DISPLAY_MATH_PATTERN, (m) => {
            // m[1] is from $$...$$ pattern, m[2] is from \[...\] pattern
            const content = m[1] || m[2];
            const isDoubleDollar = m[0].startsWith('$$');
            return {
                type: 'latex-fragment' as const,
                range: { start: m.index!, end: m.index! + m[0].length },
                postBlank: 0,
                properties: {
                    value: m[0],
                    fragmentType: 'display-math' as const,
                },
            };
        });

        // Inline math ($...$ or \(...\))
        collectMatches(INLINE_MATH_PATTERN, (m) => {
            // m[1] is from $...$ pattern, m[2] is from \(...\) pattern
            const content = m[1] || m[2];
            return {
                type: 'latex-fragment' as const,
                range: { start: m.index!, end: m.index! + m[0].length },
                postBlank: 0,
                properties: {
                    value: m[0],
                    fragmentType: 'inline-math' as const,
                },
            };
        });

        // Line breaks (\\)
        collectMatches(LINE_BREAK_PATTERN, (m) => ({
            type: 'line-break' as const,
            range: { start: m.index!, end: m.index! + 2 }, // Only the \\ part, not trailing whitespace
            postBlank: 0,
        }));
    }

    // Macros: {{{macro(args)}}}
    if (text.includes('{{{')) {
        collectMatches(MACRO_PATTERN, (m) => {
            const key = m[1];
            const argsStr = m[2] || '';
            const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
            return {
                type: 'macro' as const,
                range: { start: m.index!, end: m.index! + m[0].length },
                postBlank: 0,
                properties: {
                    key,
                    args,
                    value: m[0],
                },
            };
        });
    }

    // Export snippets: @@backend:value@@
    if (text.includes('@@')) {
        collectMatches(EXPORT_SNIPPET_PATTERN, (m) => ({
            type: 'export-snippet' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            properties: {
                backend: m[1],
                value: m[2],
            },
        }));
    }

    // Footnote references: [fn:label] or [fn:label:definition] or [fn::definition]
    if (text.includes('[fn:')) {
        collectMatches(FOOTNOTE_REF_PATTERN, (m) => {
            const label = m[1] || undefined;
            const inlineContent = m[2] || undefined;

            // Determine if this is an inline footnote
            const isInline = inlineContent !== undefined && inlineContent.length > 0;

            const obj: any = {
                type: 'footnote-reference' as const,
                range: { start: m.index!, end: m.index! + m[0].length },
                postBlank: 0,
                properties: {
                    label: label || undefined,
                    referenceType: isInline ? 'inline' : 'standard',
                },
            };

            // For inline footnotes, parse the content as children
            if (isInline) {
                obj.children = [createPlainText(inlineContent, m.index! + 4 + (label?.length || 0) + 1, m.index! + m[0].length - 1)];
            }

            return obj;
        });
    }

    // Org-cite citations: [cite:@key] or [cite/style:@key] or [cite:@key1;@key2]
    if (text.includes('[cite')) {
        collectMatches(ORG_CITE_PATTERN, (m) => {
            const style = m[1] || undefined;  // e.g., 't' for textual, 'a' for author
            const content = m[2];  // e.g., '@key1;@key2' or 'see @key p. 5'

            // Parse the citation keys from the content
            // Keys are prefixed with @ and separated by ;
            const keys: string[] = [];
            const keyMatches = content.matchAll(/@([a-zA-Z0-9_:-]+)/g);
            for (const keyMatch of keyMatches) {
                keys.push(keyMatch[1]);
            }

            return {
                type: 'citation' as const,
                range: { start: m.index!, end: m.index! + m[0].length },
                postBlank: 0,
                properties: {
                    style: style || 'default',
                    prefix: undefined,  // Could parse prefix before first @
                    suffix: undefined,  // Could parse suffix after last key
                    keys,
                    rawValue: m[0],
                },
            };
        });
    }

    // Targets: <<target>> and <<<radio-target>>>
    if (text.includes('<<')) {
        // Radio targets first (<<<...>>>) since they're longer
        collectMatches(RADIO_TARGET_PATTERN, (m) => ({
            type: 'radio-target' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            children: [createPlainText(m[1], m.index! + 3, m.index! + 3 + m[1].length)],
        }));

        // Regular targets (<<...>>)
        collectMatches(TARGET_PATTERN, (m) => ({
            type: 'target' as const,
            range: { start: m.index!, end: m.index! + m[0].length },
            postBlank: 0,
            properties: { value: m[1] },
        }));
    }

    // If no matches found, return text as single plain text object
    if (allMatches.length === 0) {
        return [createPlainText(text, 0, text.length)];
    }

    // Sort by start position
    allMatches.sort((a, b) => a.start - b.start);

    // Build result, filling gaps with plain text
    let pos = 0;
    for (const m of allMatches) {
        // Skip overlapping matches
        if (m.start < pos) continue;

        // Add plain text before this match
        if (m.start > pos) {
            objects.push(createPlainText(text.slice(pos, m.start), pos, m.start));
        }

        objects.push(m.object);
        pos = m.end;
    }

    // Add remaining text
    if (pos < text.length) {
        objects.push(createPlainText(text.slice(pos), pos, text.length));
    }

    return objects;
}

function detectLinkType(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return 'http';
    if (path.startsWith('file:')) return 'file';
    if (path.startsWith('doi:')) return 'doi';
    if (path.startsWith('cite:')) return 'cite';
    if (path.startsWith('#')) return 'custom-id';
    if (path.startsWith('*')) return 'headline';
    if (path.match(/^\.\//)) return 'file';
    return 'fuzzy';
}

// =============================================================================
// Fast Document Parser
// =============================================================================

interface FastParserState {
    lines: string[];
    lineIndex: number;
    keywords: Record<string, string>;
}

/**
 * Fast export parser - optimized for generating export output
 */
export function parseOrgFast(content: string): OrgDocumentNode {
    const lines = content.split('\n');
    const state: FastParserState = {
        lines,
        lineIndex: 0,
        keywords: {},
    };

    const doc: OrgDocumentNode = {
        type: 'org-data',
        properties: {},
        keywords: {},
        keywordLists: {},
        children: [],
    };

    // Keywords that can appear multiple times and should be collected as arrays
    const MULTI_VALUE_KEYWORDS = new Set([
        'LATEX_HEADER',
        'LATEX_HEADER_EXTRA',
        'HTML_HEAD',
        'HTML_HEAD_EXTRA',
        'MACRO',
    ]);

    // First pass: extract document keywords from the top
    while (state.lineIndex < lines.length) {
        const line = lines[state.lineIndex];
        const keywordMatch = line.match(/^#\+(\w+):\s*(.*)$/i);
        if (keywordMatch) {
            const key = keywordMatch[1].toUpperCase();
            const value = keywordMatch[2];

            if (MULTI_VALUE_KEYWORDS.has(key)) {
                // Collect multi-value keywords into arrays
                if (!doc.keywordLists[key]) {
                    doc.keywordLists[key] = [];
                }
                doc.keywordLists[key].push(value);
            } else {
                state.keywords[key] = value;
                doc.keywords[key] = value;
            }
            state.lineIndex++;
        } else if (line.trim() === '' || line.match(/^#\s/)) {
            state.lineIndex++;
        } else {
            break;
        }
    }

    // Parse preamble (content before first headline)
    const preambleElements = parseSection(state, 0);
    if (preambleElements.length > 0) {
        doc.section = {
            type: 'section',
            range: { start: 0, end: 0 },
            postBlank: 0,
            children: preambleElements,
        };
    }

    // Parse headlines
    while (state.lineIndex < lines.length) {
        const headline = parseHeadline(state);
        if (headline) {
            doc.children.push(headline);
        } else {
            state.lineIndex++;
        }
    }

    return doc;
}

function parseHeadline(state: FastParserState): HeadlineElement | null {
    const line = state.lines[state.lineIndex];
    const match = line.match(/^(\*+)\s+(?:(TODO|DONE|NEXT|WAITING|HOLD|SOMEDAY|CANCELLED|CANCELED)\s+)?(?:\[#([A-Z])\]\s+)?(.+?)(?:\s+:([:\w]+):)?$/);

    if (!match) return null;

    const level = match[1].length;
    const todoKeyword = match[2] || null;
    const priority = match[3] || null;
    const rawTitle = match[4];
    const tagString = match[5];
    const tags = tagString ? tagString.split(':').filter(t => t) : [];

    const startLine = state.lineIndex;
    state.lineIndex++;

    // Check for planning line immediately after headline
    let planning: PlanningElement | undefined;
    if (state.lineIndex < state.lines.length) {
        const planningLine = state.lines[state.lineIndex];
        if (RE_PLANNING_LINE.test(planningLine)) {
            const parsed = parsePlanningLine(planningLine);
            if (parsed) {
                planning = parsed;
                state.lineIndex++;
            }
        }
    }

    // Find the end of this headline's content
    let endLine = state.lineIndex;
    while (endLine < state.lines.length) {
        const nextLine = state.lines[endLine];
        const headlineMatch = nextLine.match(/^(\*+)\s+/);
        if (headlineMatch && headlineMatch[1].length <= level) {
            break;
        }
        endLine++;
    }

    // Parse section content
    const sectionElements = parseSection(state, level);

    // Parse child headlines
    const children: HeadlineElement[] = [];
    while (state.lineIndex < endLine) {
        const child = parseHeadline(state);
        if (child) {
            children.push(child);
        } else {
            // If parseHeadline returns null, advance to avoid infinite loop
            state.lineIndex++;
        }
    }

    const headline: HeadlineElement = {
        type: 'headline',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            level,
            rawValue: rawTitle,
            title: parseObjectsFast(rawTitle),
            todoKeyword: todoKeyword || undefined,
            todoType: todoKeyword ? (todoKeyword === 'DONE' || todoKeyword === 'CANCELLED' || todoKeyword === 'CANCELED' ? 'done' : 'todo') : undefined,
            priority: priority || undefined,
            tags,
            archivedp: tags.includes('ARCHIVE'),
            commentedp: false,
            footnoteSection: false,
            lineNumber: startLine + 1,
        },
        planning,
        section: sectionElements.length > 0 ? {
            type: 'section',
            range: { start: 0, end: 0 },
            postBlank: 0,
            children: sectionElements,
        } : undefined,
        children,
    };

    return headline;
}

function parseSection(state: FastParserState, parentLevel: number): OrgElement[] {
    const elements: OrgElement[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];

        // Check for any headline - we stop at headlines and let the caller handle them
        const headlineMatch = line.match(/^(\*+)\s+/);
        if (headlineMatch) {
            // Stop at headlines at same level or lower (fewer or equal asterisks)
            // Also stop at child headlines (more asterisks) - they're parsed separately
            if (headlineMatch[1].length <= parentLevel || parentLevel === 0) {
                break;
            }
            // Child headline - stop section parsing, let parseHeadline handle it
            break;
        }

        // Try to parse different element types
        const element = parseElement(state);
        if (element) {
            elements.push(element);
        } else {
            state.lineIndex++;
        }
    }

    return elements;
}

function parseElement(state: FastParserState): OrgElement | null {
    const line = state.lines[state.lineIndex];

    // Empty line
    if (line.trim() === '') {
        return null;
    }

    // Keyword
    const keywordMatch = line.match(/^#\+(\w+):\s*(.*)$/i);
    if (keywordMatch && !keywordMatch[1].toUpperCase().startsWith('BEGIN')) {
        state.lineIndex++;
        return {
            type: 'keyword',
            range: { start: 0, end: 0 },
            postBlank: 0,
            properties: {
                key: keywordMatch[1].toUpperCase(),
                value: keywordMatch[2],
            },
        } as KeywordElement;
    }

    // Source block
    if (line.match(/^#\+BEGIN_SRC\s*/i)) {
        return parseSrcBlock(state);
    }

    // Example block
    if (line.match(/^#\+BEGIN_EXAMPLE/i)) {
        return parseSimpleBlock(state, 'example-block', 'EXAMPLE');
    }

    // Quote block
    if (line.match(/^#\+BEGIN_QUOTE/i)) {
        return parseSimpleBlock(state, 'quote-block', 'QUOTE');
    }

    // Verse block
    if (line.match(/^#\+BEGIN_VERSE/i)) {
        return parseSimpleBlock(state, 'verse-block', 'VERSE');
    }

    // Center block
    if (line.match(/^#\+BEGIN_CENTER/i)) {
        return parseSimpleBlock(state, 'center-block', 'CENTER');
    }

    // Export block
    if (line.match(/^#\+BEGIN_EXPORT\s+(\w+)/i)) {
        return parseExportBlock(state);
    }

    // Table
    if (line.match(/^\s*\|/)) {
        return parseTable(state);
    }

    // List item
    if (line.match(/^\s*[-+*]\s+/) || line.match(/^\s*\d+[.)]\s+/)) {
        return parseList(state);
    }

    // Property drawer
    if (line.match(/^:PROPERTIES:/i)) {
        return parsePropertyDrawer(state);
    }

    // Regular drawer (but not :END: which closes drawers/blocks)
    if (line.match(/^:(\w+):\s*$/) && !line.match(/^:END:/i)) {
        return parseDrawer(state);
    }

    // Horizontal rule
    if (line.match(/^-{5,}\s*$/)) {
        state.lineIndex++;
        return {
            type: 'horizontal-rule',
            range: { start: 0, end: 0 },
            postBlank: 0,
        };
    }

    // Fixed width
    if (line.match(/^:\s/)) {
        return parseFixedWidth(state);
    }

    // Comment
    if (line.match(/^#\s/) || line === '#') {
        state.lineIndex++;
        return {
            type: 'comment',
            range: { start: 0, end: 0 },
            postBlank: 0,
            properties: { value: line.slice(2) || '' },
        } as CommentElement;
    }

    // Results block
    if (line.match(/^#\+RESULTS:/i)) {
        return parseResults(state);
    }

    // Footnote definition: [fn:label] content
    const footnoteMatch = line.match(/^\[fn:([a-zA-Z0-9_-]+)\]\s*(.*)/);
    if (footnoteMatch) {
        return parseFootnoteDefinition(state);
    }

    // Paragraph (default)
    return parseParagraph(state);
}

function parseSrcBlock(state: FastParserState): SrcBlockElement | null {
    const startLine = state.lines[state.lineIndex];
    const match = startLine.match(/^#\+BEGIN_SRC\s*(\S*)\s*(.*)?$/i);
    if (!match) return null;

    const language = match[1] || '';
    const parameters = match[2] || '';

    state.lineIndex++;
    const codeLines: string[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        if (line.match(/^#\+END_SRC/i)) {
            state.lineIndex++;
            break;
        }
        codeLines.push(line);
        state.lineIndex++;
    }

    return {
        type: 'src-block',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            language,
            value: codeLines.join('\n'),
            parameters,
            headers: {},
            lineNumber: 0,
            endLineNumber: 0,
            preserveIndent: false,
        },
    } as SrcBlockElement;
}

function parseSimpleBlock(state: FastParserState, type: 'example-block' | 'quote-block' | 'verse-block' | 'center-block', blockName: string): OrgElement | null {
    state.lineIndex++;
    const contentLines: string[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        if (line.match(new RegExp(`^#\\+END_${blockName}`, 'i'))) {
            state.lineIndex++;
            break;
        }
        contentLines.push(line);
        state.lineIndex++;
    }

    if (type === 'example-block') {
        return {
            type: 'example-block',
            range: { start: 0, end: 0 },
            postBlank: 0,
            properties: {
                value: contentLines.join('\n'),
            },
        } as ExampleBlockElement;
    } else {
        // Quote/verse/center blocks contain parsed content
        return {
            type: type,
            range: { start: 0, end: 0 },
            postBlank: 0,
            children: contentLines.map(line => ({
                type: 'paragraph' as const,
                range: { start: 0, end: 0 },
                postBlank: 0,
                children: parseObjectsFast(line),
            })),
        } as QuoteBlockElement;
    }
}

function parseExportBlock(state: FastParserState): OrgElement | null {
    const startLine = state.lines[state.lineIndex];
    const match = startLine.match(/^#\+BEGIN_EXPORT\s+(\w+)/i);
    if (!match) return null;

    const backend = match[1].toLowerCase();
    state.lineIndex++;
    const contentLines: string[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        if (line.match(/^#\+END_EXPORT/i)) {
            state.lineIndex++;
            break;
        }
        contentLines.push(line);
        state.lineIndex++;
    }

    return {
        type: 'export-block',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            backend,
            value: contentLines.join('\n'),
        },
    } as ExportBlockElement;
}

function parseTable(state: FastParserState): TableElement {
    const rows: TableRowElement[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        if (!line.match(/^\s*\|/)) break;

        if (line.match(/^\s*\|[-+]+\|?\s*$/)) {
            // Separator row
            rows.push({
                type: 'table-row',
                range: { start: 0, end: 0 },
                postBlank: 0,
                properties: { rowType: 'rule' },
                children: [],
            });
        } else {
            // Data row
            const cells: TableCellObject[] = line.split('|').slice(1, -1).map(cell => ({
                type: 'table-cell' as const,
                range: { start: 0, end: 0 } as OrgRange,
                postBlank: 0,
                properties: { value: cell.trim() },
                children: parseObjectsFast(cell.trim()),
            }));
            rows.push({
                type: 'table-row',
                range: { start: 0, end: 0 },
                postBlank: 0,
                properties: { rowType: 'standard' },
                children: cells,
            });
        }
        state.lineIndex++;
    }

    return {
        type: 'table',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: { tableType: 'org' },
        children: rows,
    };
}

function parseList(state: FastParserState): PlainListElement {
    const items: ItemElement[] = [];
    const firstLine = state.lines[state.lineIndex];
    const listType = firstLine.match(/^\s*\d+[.)]/) ? 'ordered' : 'unordered';
    const baseIndent = firstLine.match(/^(\s*)/)?.[1].length || 0;

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        const indent = line.match(/^(\s*)/)?.[1].length || 0;

        // Check if still in list
        if (line.trim() === '') {
            state.lineIndex++;
            continue;
        }

        // Stop at headlines (unindented asterisks followed by space are headlines, not list items)
        if (line.match(/^\*+\s+/)) break;

        if (indent < baseIndent) break;

        const itemMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+(?:\[([ Xx-])\]\s+)?(.*)$/);
        if (itemMatch && indent === baseIndent) {
            const checkbox = itemMatch[3] ? (itemMatch[3] === 'X' || itemMatch[3] === 'x' ? 'on' : itemMatch[3] === '-' ? 'trans' : 'off') as 'on' | 'off' | 'trans' : undefined;
            const content = itemMatch[4];

            items.push({
                type: 'item',
                range: { start: 0, end: 0 },
                postBlank: 0,
                properties: {
                    bullet: itemMatch[2],
                    counter: undefined,
                    checkbox,
                    tag: undefined,
                },
                children: [{
                    type: 'paragraph',
                    range: { start: 0, end: 0 },
                    postBlank: 0,
                    children: parseObjectsFast(content),
                }],
            });
            state.lineIndex++;
        } else if (indent > baseIndent) {
            // Continuation of previous item or nested list
            state.lineIndex++;
        } else {
            break;
        }
    }

    return {
        type: 'plain-list',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: { listType: listType as 'ordered' | 'unordered' | 'descriptive' },
        children: items,
    };
}

function parsePropertyDrawer(state: FastParserState): OrgElement {
    const properties: Record<string, string> = {};
    state.lineIndex++;

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        if (line.match(/^:END:/i)) {
            state.lineIndex++;
            break;
        }
        const propMatch = line.match(/^:(\w+):\s*(.*)$/);
        if (propMatch) {
            properties[propMatch[1].toUpperCase()] = propMatch[2];
        }
        state.lineIndex++;
    }

    return {
        type: 'property-drawer',
        range: { start: 0, end: 0 },
        postBlank: 0,
        children: Object.entries(properties).map(([key, value]) => ({
            type: 'node-property' as const,
            range: { start: 0, end: 0 } as OrgRange,
            postBlank: 0,
            key,
            value,
        })),
    };
}

function parseDrawer(state: FastParserState): OrgElement {
    const startLine = state.lines[state.lineIndex];
    const nameMatch = startLine.match(/^:(\w+):/);
    const name = nameMatch ? nameMatch[1] : 'DRAWER';

    state.lineIndex++;
    const contentLines: string[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        if (line.match(/^:END:/i)) {
            state.lineIndex++;
            break;
        }
        contentLines.push(line);
        state.lineIndex++;
    }

    return {
        type: 'drawer',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: { name },
        children: contentLines.map(line => ({
            type: 'paragraph' as const,
            range: { start: 0, end: 0 },
            postBlank: 0,
            children: parseObjectsFast(line),
        })),
    } as DrawerElement;
}

function parseFixedWidth(state: FastParserState): OrgElement {
    const lines: string[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];
        if (!line.match(/^:\s?/)) break;
        lines.push(line.slice(2) || '');
        state.lineIndex++;
    }

    return {
        type: 'fixed-width',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: { value: lines.join('\n') },
    } as FixedWidthElement;
}

function parseResults(state: FastParserState): OrgElement {
    state.lineIndex++;
    const contentLines: string[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];

        // Results can be: colon-prefixed lines, a drawer, or until blank/next element
        if (line.match(/^:\s?/)) {
            contentLines.push(line.slice(2) || '');
            state.lineIndex++;
        } else if (line.match(/^#\+BEGIN_/i)) {
            // Result in a block - skip the whole block
            state.lineIndex++;
            while (state.lineIndex < state.lines.length) {
                if (state.lines[state.lineIndex].match(/^#\+END_/i)) {
                    state.lineIndex++;
                    break;
                }
                contentLines.push(state.lines[state.lineIndex]);
                state.lineIndex++;
            }
        } else if (line.trim() === '' || line.match(/^[*#]/)) {
            break;
        } else {
            contentLines.push(line);
            state.lineIndex++;
        }
    }

    return {
        type: 'fixed-width',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: { value: contentLines.join('\n') },
    } as FixedWidthElement;
}

/**
 * Parse a planning line (SCHEDULED, DEADLINE, CLOSED)
 */
function parsePlanningLine(line: string): PlanningElement | null {
    const props: PlanningElement['properties'] = {};

    // Parse SCHEDULED
    const scheduledMatch = line.match(RE_SCHEDULED);
    if (scheduledMatch) {
        props.scheduled = parseTimestampString(scheduledMatch[1]);
    }

    // Parse DEADLINE
    const deadlineMatch = line.match(RE_DEADLINE);
    if (deadlineMatch) {
        props.deadline = parseTimestampString(deadlineMatch[1]);
    }

    // Parse CLOSED
    const closedMatch = line.match(RE_CLOSED);
    if (closedMatch) {
        props.closed = parseTimestampString(closedMatch[1]);
    }

    // Return null if no planning info found
    if (!props.scheduled && !props.deadline && !props.closed) {
        return null;
    }

    return {
        type: 'planning',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: props,
    };
}

/**
 * Parse a timestamp string into a TimestampObject
 */
function parseTimestampString(ts: string): TimestampObject | undefined {
    if (!ts) return undefined;

    const isActive = ts.startsWith('<');
    // Match: <2024-01-15 Mon 10:00-11:00 +1w>
    const match = ts.match(/^[<\[](\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2}))?(?:-(\d{2}):(\d{2}))?(?:\s+([.+]+\d+[hdwmy]))?[>\]]/);

    if (!match) return undefined;

    const yearStart = parseInt(match[1], 10);
    const monthStart = parseInt(match[2], 10);
    const dayStart = parseInt(match[3], 10);
    const hourStart = match[4] ? parseInt(match[4], 10) : undefined;
    const minuteStart = match[5] ? parseInt(match[5], 10) : undefined;
    const hourEnd = match[6] ? parseInt(match[6], 10) : undefined;
    const minuteEnd = match[7] ? parseInt(match[7], 10) : undefined;
    const repeater = match[8] || undefined;

    return {
        type: 'timestamp',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            timestampType: isActive ? 'active' : 'inactive',
            rawValue: ts,
            yearStart,
            monthStart,
            dayStart,
            hourStart,
            minuteStart,
            hourEnd,
            minuteEnd,
            repeaterType: repeater ? (repeater.startsWith('.+') ? '.+' : repeater.startsWith('++') ? '++' : '+') as '+' | '++' | '.+' : undefined,
            repeaterValue: repeater ? parseInt(repeater.replace(/^[.+]+/, ''), 10) : undefined,
            repeaterUnit: repeater ? repeater.slice(-1) as 'h' | 'd' | 'w' | 'm' | 'y' : undefined,
        },
    };
}

function parseFootnoteDefinition(state: FastParserState): FootnoteDefinitionElement | null {
    const line = state.lines[state.lineIndex];
    const match = line.match(/^\[fn:([a-zA-Z0-9_-]+)\]\s*(.*)/);
    if (!match) return null;

    const label = match[1];
    const firstLineContent = match[2] || '';
    state.lineIndex++;

    // Collect continuation lines (indented or blank lines followed by indented)
    const contentLines: string[] = [firstLineContent];
    while (state.lineIndex < state.lines.length) {
        const nextLine = state.lines[state.lineIndex];

        // Stop at blank line followed by non-indented content
        if (nextLine.trim() === '') {
            // Look ahead to see if there's more indented content
            if (state.lineIndex + 1 < state.lines.length) {
                const afterBlank = state.lines[state.lineIndex + 1];
                if (!afterBlank.match(/^\s+/)) {
                    break;
                }
            } else {
                break;
            }
            contentLines.push('');
            state.lineIndex++;
        } else if (nextLine.match(/^\s+/)) {
            // Indented continuation line
            contentLines.push(nextLine.trim());
            state.lineIndex++;
        } else {
            // Non-indented, non-empty line - end of footnote
            break;
        }
    }

    const content = contentLines.join(' ').trim();

    // Create a paragraph element containing the footnote content
    const paragraph: ParagraphElement = {
        type: 'paragraph',
        range: { start: 0, end: 0 },
        postBlank: 0,
        children: parseObjectsFast(content),
    };

    return {
        type: 'footnote-definition',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            label,
        },
        children: [paragraph],
    } as FootnoteDefinitionElement;
}

function parseParagraph(state: FastParserState): ParagraphElement | null {
    const lines: string[] = [];

    while (state.lineIndex < state.lines.length) {
        const line = state.lines[state.lineIndex];

        // End of paragraph conditions
        if (line.trim() === '') break;
        if (line.match(/^[*#:|\-]/)) break;
        if (line.match(/^\s*[-+*]\s+/) || line.match(/^\s*\d+[.)]\s+/)) break;

        lines.push(line);
        state.lineIndex++;
    }

    // If no lines were consumed, return null to signal no paragraph was found
    // This prevents infinite loops when we encounter lines that can't be parsed as paragraphs
    if (lines.length === 0) {
        return null;
    }

    const text = lines.join('\n');

    return {
        type: 'paragraph',
        range: { start: 0, end: 0 },
        postBlank: 0,
        children: parseObjectsFast(text),
    };
}
