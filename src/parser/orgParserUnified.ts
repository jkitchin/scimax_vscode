/**
 * Unified Org-mode Parser
 * Combines all parsing modules to produce a complete AST with the new element types
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
    ExportBlockElement,
    QuoteBlockElement,
    CenterBlockElement,
    SpecialBlockElement,
    VerseBlockElement,
    KeywordElement,
    CommentElement,
    CommentBlockElement,
    HorizontalRuleElement,
    FixedWidthElement,
    DrawerElement,
    PropertyDrawerElement,
    NodePropertyElement,
    BabelCallElement,
    LatexEnvironmentElement,
    FootnoteDefinitionElement,
    DynamicBlockElement,
    InlinetaskElement,
    DiarySexpElement,
    PlanningElement,
    ClockElement,
    TableElement,
    TableRowElement,
    PlainListElement,
    ItemElement,
    TimestampObject,
    AffiliatedKeywords,
    OrgRange,
} from './orgElementTypes';
import { parseObjects } from './orgObjects';
import { parseTable, parsePlanningLine, parseClockLine, parseList } from './orgElements';
import { PositionTracker, addPositionsToDocument } from './orgPosition';
import { DEFAULT_TODO_STATES } from '../org/todoStates';

// =============================================================================
// Parser Configuration
// =============================================================================

export interface OrgParserConfig {
    /** Custom TODO keywords (default: TODO, DONE, etc.) */
    todoKeywords?: string[];
    /** Done keywords (default: DONE, CANCELLED) */
    doneKeywords?: string[];
    /** Whether to parse inline objects in paragraphs */
    parseInlineObjects?: boolean;
    /** Whether to add position information */
    addPositions?: boolean;
    /** File path for context */
    filePath?: string;
    /** Minimum level for inline tasks (default: 15 per org-mode) */
    inlinetaskMinLevel?: number;
}

// Done keywords are a subset of DEFAULT_TODO_STATES from todoStates.ts
const DEFAULT_DONE_KEYWORDS = ['DONE', 'CANCELLED', 'CANCELED'];
const DEFAULT_INLINETASK_MIN_LEVEL = 15;

// =============================================================================
// Pre-compiled Regex Patterns (Performance Optimization)
// =============================================================================

// Headline patterns
const RE_HEADLINE = /^(\*+)\s+(.*)$/;
const RE_HEADLINE_SIMPLE = /^\*+ /;
const RE_TODO_PREFIX = /^(\S+)\s+/;
const RE_PRIORITY = /^\[#([A-Z])\]\s+/;
const RE_TAGS = /\s+:([^:\s]+(?::[^:\s]+)*):$/;

// Keyword and comment patterns
const RE_KEYWORD = /^#\+(\w+):\s*(.*)$/;
const RE_BEGIN_BLOCK = /^#\+BEGIN_/i;
const RE_COMMENT_LINE = /^#\s/;
const RE_PROPERTY_VALUE = /^(\S+)\s+(.*)$/;

// Block patterns
const RE_SRC_BLOCK_START = /^#\+BEGIN_SRC(?:\s+(\S+))?(.*)$/i;
const RE_SRC_BLOCK_END = /^#\+END_SRC/i;
const RE_EXAMPLE_BLOCK = /^#\+BEGIN_EXAMPLE/i;
const RE_QUOTE_BLOCK = /^#\+BEGIN_QUOTE/i;
const RE_CENTER_BLOCK = /^#\+BEGIN_CENTER/i;
const RE_VERSE_BLOCK = /^#\+BEGIN_VERSE/i;
const RE_COMMENT_BLOCK = /^#\+BEGIN_COMMENT/i;
const RE_EXPORT_BLOCK = /^#\+BEGIN_EXPORT(?:\s+(\S+))?/i;
const RE_SPECIAL_BLOCK = /^#\+BEGIN_(\w+)/i;
const RE_LATEX_BEGIN = /^\\begin\{(\w+\*?)\}/;
const RE_DRAWER = /^:(\w+):\s*$/;

// Content patterns
const RE_HORIZONTAL_RULE = /^-{5,}\s*$/;
const RE_FIXED_WIDTH = /^:\s/;
const RE_FIXED_WIDTH_CONTENT = /^:\s?/;
const RE_TABLE = /^\s*\|/;
const RE_UNORDERED_LIST = /^\s*[-+*](?:\s|$)/;
const RE_ORDERED_LIST = /^\s*\d+[.)]\s/;
const RE_PROPERTIES_START = /^:PROPERTIES:\s*$/i;
const RE_PROPERTIES_END = /^:(PROPERTIES|END):\s*$/i;
const RE_PROPERTY_LINE = /^\s*:(\S+):\s*(.*)$/;
const RE_DRAWER_END = ':END:';

// Planning patterns
const RE_PLANNING_LINE = /^\s*(SCHEDULED|DEADLINE|CLOSED):/;
const RE_SCHEDULED = /SCHEDULED:\s*(<[^>]+>|\[[^\]]+\])/;
const RE_DEADLINE = /DEADLINE:\s*(<[^>]+>|\[[^\]]+\])/;
const RE_CLOSED = /CLOSED:\s*(<[^>]+>|\[[^\]]+\])/;
const RE_TIMESTAMP_CONTENT = /^(\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2}))?/;

// Paragraph end patterns
const RE_BLOCK_START = /^#\+BEGIN_/i;
const RE_LATEX_ENV_START = /^\\begin\{/;
const RE_KEYWORD_LINE = /^#\+\w+:/;

// Header args pattern
const RE_HEADER_ARGS = /:(\S+)\s+(\S+)/g;

// Dynamic block patterns
const RE_DYNAMIC_BLOCK_START = /^#\+BEGIN:\s*(\S+)(.*)$/i;
const RE_DYNAMIC_BLOCK_END = /^#\+END:?\s*$/i;

// Footnote definition pattern
const RE_FOOTNOTE_DEF = /^\[fn:([^\]]+)\]\s*/;

// Babel call pattern (#+CALL: name[header](args)[end-header])
const RE_BABEL_CALL = /^#\+CALL:\s*(\S+?)(?:\[([^\]]*)\])?\(([^)]*)\)(?:\[([^\]]*)\])?\s*$/i;

// Diary sexp pattern (allows optional leading whitespace)
const RE_DIARY_SEXP = /^\s*%%\((.+?)\)\s*(.*)$/;

// Clock pattern
const RE_CLOCK_LINE = /^CLOCK:\s*/;

// Affiliated keywords patterns
const RE_AFFILIATED_NAME = /^#\+NAME:\s*(.+)$/i;
const RE_AFFILIATED_CAPTION = /^#\+CAPTION(?:\[([^\]]*)\])?:\s*(.+)$/i;
const RE_AFFILIATED_ATTR = /^#\+ATTR_(\w+):\s*(.*)$/i;
const RE_AFFILIATED_HEADER = /^#\+HEADER:\s*(.*)$/i;
const RE_AFFILIATED_RESULTS = /^#\+RESULTS(?:\[([^\]]*)\])?:\s*(.*)$/i;
const RE_AFFILIATED_PLOT = /^#\+PLOT:\s*(.*)$/i;

// =============================================================================
// Unified Parser Class
// =============================================================================

export class OrgParserUnified {
    private config: Required<OrgParserConfig>;
    private todoKeywords: Set<string>;
    private doneKeywords: Set<string>;
    private allTodoKeywords: Set<string>;
    // Pre-compiled patterns for inline task END markers (performance optimization)
    private static readonly inlinetaskEndPatterns: Map<number, RegExp> = OrgParserUnified.initEndPatterns();
    // Cache for block end patterns (lazily populated)
    private static readonly blockEndPatterns: Map<string, RegExp> = new Map();
    // Cache for LaTeX environment end patterns (lazily populated)
    private static readonly latexEndPatterns: Map<string, RegExp> = new Map();

    private static initEndPatterns(): Map<number, RegExp> {
        const patterns = new Map<number, RegExp>();
        // Pre-compile patterns for levels 15-30 (common inline task levels)
        for (let level = 15; level <= 30; level++) {
            patterns.set(level, new RegExp(`^\\*{${level}}\\s+END\\s*$`));
        }
        return patterns;
    }

    private static getBlockEndPattern(blockType: string): RegExp {
        const key = blockType.toUpperCase();
        let pattern = OrgParserUnified.blockEndPatterns.get(key);
        if (!pattern) {
            pattern = new RegExp(`^#\\+END_${blockType}`, 'i');
            OrgParserUnified.blockEndPatterns.set(key, pattern);
        }
        return pattern;
    }

    private static getLatexEndPattern(envName: string): RegExp {
        let pattern = OrgParserUnified.latexEndPatterns.get(envName);
        if (!pattern) {
            // Escape special regex characters in environment name (e.g., align* -> align\*)
            const escapedName = envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            pattern = new RegExp(`^\\\\end\\{${escapedName}\\}`);
            OrgParserUnified.latexEndPatterns.set(envName, pattern);
        }
        return pattern;
    }

    constructor(config: OrgParserConfig = {}) {
        this.config = {
            todoKeywords: config.todoKeywords ?? DEFAULT_TODO_STATES,
            doneKeywords: config.doneKeywords ?? DEFAULT_DONE_KEYWORDS,
            parseInlineObjects: config.parseInlineObjects ?? true,
            addPositions: config.addPositions ?? true,
            filePath: config.filePath ?? '',
            inlinetaskMinLevel: config.inlinetaskMinLevel ?? DEFAULT_INLINETASK_MIN_LEVEL,
        };

        this.todoKeywords = new Set(this.config.todoKeywords);
        this.doneKeywords = new Set(this.config.doneKeywords);
        this.allTodoKeywords = new Set([...this.todoKeywords, ...this.doneKeywords]);
    }

    /**
     * Parse org content into a full AST
     */
    parse(content: string): OrgDocumentNode {
        const lines = content.split('\n');
        const doc: OrgDocumentNode = {
            type: 'org-data',
            properties: {},
            keywords: {},
            keywordLists: {},
            children: [],
        };

        // Pre-compute line offsets for efficient offset lookups
        const lineOffsets = this.computeLineOffsets(lines);

        let lineNum = 0;

        // Parse file-level content (before first headline)
        // Use simple character check before regex for performance
        let firstHeadlineIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i][0] === '*' && RE_HEADLINE_SIMPLE.test(lines[i])) {
                firstHeadlineIdx = i;
                break;
            }
        }
        const preambleEnd = firstHeadlineIdx === -1 ? lines.length : firstHeadlineIdx;

        if (preambleEnd > 0) {
            const preambleLines = lines.slice(0, preambleEnd);
            const { keywords, keywordLists, properties, elements } = this.parsePreamble(
                preambleLines,
                0,
                lineNum,
                lineOffsets
            );
            doc.keywords = keywords;
            doc.keywordLists = keywordLists;
            doc.properties = properties;

            if (elements.length > 0) {
                // Calculate preamble end offset efficiently
                const preambleEndOffset = firstHeadlineIdx > 0
                    ? lineOffsets[firstHeadlineIdx] - 1
                    : lineOffsets[lines.length] - 1;
                doc.section = {
                    type: 'section',
                    range: { start: 0, end: preambleEndOffset },
                    postBlank: 0,
                    children: elements,
                };
            }

            lineNum = preambleEnd;
        }

        // Parse headlines
        if (firstHeadlineIdx !== -1) {
            const headlineStack: HeadlineElement[] = [];

            while (lineNum < lines.length) {
                const line = lines[lineNum];
                const lineStart = lineOffsets[lineNum];

                // Fast check: headlines must start with '*'
                if (line[0] !== '*') {
                    lineNum++;
                    continue;
                }

                const headlineMatch = line.match(RE_HEADLINE);
                if (headlineMatch) {
                    const level = headlineMatch[1].length;

                    // Check if this is an inline task (level >= inlinetaskMinLevel)
                    if (level >= this.config.inlinetaskMinLevel) {
                        // Parse as inline task - it goes into the current headline's section
                        const inlinetaskResult = this.parseInlinetask(
                            lines,
                            lineNum,
                            lineStart,
                            level,
                            headlineMatch[2]
                        );

                        // Add to parent headline's section if there is one
                        if (headlineStack.length > 0) {
                            const parent = headlineStack[headlineStack.length - 1];
                            if (!parent.section) {
                                parent.section = {
                                    type: 'section',
                                    range: { start: lineStart, end: inlinetaskResult.endOffset - 1 },
                                    postBlank: 0,
                                    children: [],
                                };
                            }
                            parent.section.children.push(inlinetaskResult.element);
                        } else {
                            // No parent headline, add to doc section
                            if (!doc.section) {
                                doc.section = {
                                    type: 'section',
                                    range: { start: lineStart, end: inlinetaskResult.endOffset - 1 },
                                    postBlank: 0,
                                    children: [],
                                };
                            }
                            doc.section.children.push(inlinetaskResult.element);
                        }

                        lineNum = inlinetaskResult.endLine;
                        continue;
                    }

                    // Find the extent of this headline's own content (until next headline of ANY level)
                    let contentEnd = lineNum + 1;
                    while (contentEnd < lines.length) {
                        // Fast check before regex
                        if (lines[contentEnd][0] === '*' && RE_HEADLINE_SIMPLE.test(lines[contentEnd])) {
                            break; // Stop at any headline
                        }
                        contentEnd++;
                    }

                    // Calculate the end offset efficiently using pre-computed offsets
                    const endOffset = contentEnd < lines.length
                        ? lineOffsets[contentEnd] - 1
                        : lineOffsets[contentEnd];

                    const headline = this.parseHeadline(
                        lines,
                        lineNum,
                        contentEnd,
                        lineStart,
                        endOffset,
                        level,
                        headlineMatch[2],
                        lineOffsets
                    );

                    // Add to tree structure
                    while (
                        headlineStack.length > 0 &&
                        headlineStack[headlineStack.length - 1].properties.level >= level
                    ) {
                        headlineStack.pop();
                    }

                    if (headlineStack.length === 0) {
                        doc.children.push(headline);
                    } else {
                        headlineStack[headlineStack.length - 1].children.push(headline);
                    }

                    headlineStack.push(headline);
                    lineNum = contentEnd;
                } else {
                    lineNum++;
                }
            }
        }

        // Add position information if requested
        if (this.config.addPositions) {
            addPositionsToDocument(doc, content);
        }

        return doc;
    }

    /**
     * Pre-compute line offsets for O(1) offset lookups
     * Returns array where lineOffsets[i] = byte offset of line i
     */
    private computeLineOffsets(lines: string[]): number[] {
        const offsets = new Array<number>(lines.length + 1);
        let offset = 0;
        for (let i = 0; i < lines.length; i++) {
            offsets[i] = offset;
            offset += lines[i].length + 1; // +1 for newline
        }
        offsets[lines.length] = offset;
        return offsets;
    }

    /**
     * Parse file preamble (content before first headline)
     */
    // Keywords that can appear multiple times and should be collected as arrays
    private static readonly MULTI_VALUE_KEYWORDS = new Set([
        'LATEX_HEADER',
        'LATEX_HEADER_EXTRA',
        'HTML_HEAD',
        'HTML_HEAD_EXTRA',
    ]);

    private parsePreamble(
        lines: string[],
        baseOffset: number,
        baseLineNum: number,
        lineOffsets?: number[]
    ): {
        keywords: Record<string, string>;
        keywordLists: Record<string, string[]>;
        properties: Record<string, string>;
        elements: OrgElement[];
    } {
        const keywords: Record<string, string> = {};
        const keywordLists: Record<string, string[]> = {};
        const properties: Record<string, string> = {};
        const elements: OrgElement[] = [];

        let offset = baseOffset;
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const lineStart = lineOffsets ? lineOffsets[baseLineNum + i] : offset;
            const firstChar = line[0];

            // Fast path: check first character before regex matching
            if (firstChar === '#') {
                // Check for keyword vs block start
                if (line[1] === '+') {
                    // Pre-filter by checking characters 2-6 to avoid unnecessary regex matches
                    const char2 = line[2]?.toUpperCase();
                    const char3 = line[3]?.toUpperCase();

                    // Check for dynamic block (#+BEGIN: name args) - note the colon after BEGIN
                    if (char2 === 'B' && char3 === 'E' && line.slice(2, 8).toUpperCase() === 'BEGIN:') {
                        const dynamicMatch = line.match(RE_DYNAMIC_BLOCK_START);
                        if (dynamicMatch) {
                            const dynResult = this.parseDynamicBlock(lines, i, offset, dynamicMatch[1], dynamicMatch[2] || '');
                            elements.push(dynResult.element);
                            offset = dynResult.endOffset;
                            i = dynResult.endLine;
                            continue;
                        }
                    }

                    // Check for babel call (#+CALL: name[header](args)[header])
                    if (char2 === 'C' && char3 === 'A' && line.slice(2, 7).toUpperCase() === 'CALL:') {
                        const babelCall = this.parseBabelCall(line, lineStart);
                        if (babelCall) {
                            elements.push(babelCall);
                            offset += line.length + 1;
                            i++;
                            continue;
                        }
                    }

                    // Could be keyword or block start - check for BEGIN_ first
                    if (!(char2 === 'B' && char3 === 'E' && RE_BEGIN_BLOCK.test(line))) {
                        const keywordMatch = line.match(RE_KEYWORD);
                        if (keywordMatch) {
                            const key = keywordMatch[1].toUpperCase();
                            const value = keywordMatch[2];

                            if (key === 'PROPERTY') {
                                const propMatch = value.match(RE_PROPERTY_VALUE);
                                if (propMatch) {
                                    properties[propMatch[1]] = propMatch[2];
                                }
                            } else if (OrgParserUnified.MULTI_VALUE_KEYWORDS.has(key)) {
                                // Keywords that can appear multiple times
                                if (!keywordLists[key]) {
                                    keywordLists[key] = [];
                                }
                                keywordLists[key].push(value);
                            } else {
                                keywords[key] = value;
                            }

                            elements.push({
                                type: 'keyword',
                                range: { start: lineStart, end: lineStart + line.length },
                                postBlank: 0,
                                properties: { key, value },
                            } as KeywordElement);

                            offset += line.length + 1;
                            i++;
                            continue;
                        }
                    }
                } else if (line[1] === ' ' || line.length === 1) {
                    // Comment line
                    elements.push({
                        type: 'comment',
                        range: { start: lineStart, end: lineStart + line.length },
                        postBlank: 0,
                        properties: { value: line.slice(2) || '' },
                    } as CommentElement);

                    offset += line.length + 1;
                    i++;
                    continue;
                }
            }

            // Try to parse block elements (uses fast path internally)
            const blockResult = this.tryParseBlock(lines, i, offset, lineOffsets, baseLineNum);
            if (blockResult) {
                elements.push(blockResult.element);
                offset = blockResult.endOffset;
                i = blockResult.endLine;
                continue;
            }

            // Horizontal rule - fast path: must start with '-'
            if (firstChar === '-' && RE_HORIZONTAL_RULE.test(line)) {
                elements.push({
                    type: 'horizontal-rule',
                    range: { start: lineStart, end: lineStart + line.length },
                    postBlank: 0,
                } as HorizontalRuleElement);

                offset += line.length + 1;
                i++;
                continue;
            }

            // Fixed width (: prefix) - fast path
            if (firstChar === ':' && line[1] === ' ') {
                let endLine = i;
                while (endLine < lines.length && RE_FIXED_WIDTH_CONTENT.test(lines[endLine])) {
                    endLine++;
                }
                // Cache the sliced lines to avoid double slicing
                const slicedLines = lines.slice(i, endLine);
                const fixedLines = slicedLines.map((l) => l.slice(2));
                const endOffset = offset + slicedLines.reduce((s, l) => s + l.length + 1, 0) - 1;

                elements.push({
                    type: 'fixed-width',
                    range: { start: lineStart, end: endOffset },
                    postBlank: 0,
                    properties: { value: fixedLines.join('\n') },
                } as FixedWidthElement);

                for (let j = i; j < endLine; j++) {
                    offset += lines[j].length + 1;
                }
                i = endLine;
                continue;
            }

            // Table - fast path: first non-space char is '|'
            if (RE_TABLE.test(line)) {
                const tableResult = this.parseTableElement(lines, i, offset);
                if (tableResult) {
                    elements.push(tableResult.element);
                    offset = tableResult.endOffset;
                    i = tableResult.endLine;
                    continue;
                }
            }

            // List - check for list markers
            // Only call trimStart() if line starts with whitespace (optimization)
            const listFirstChar = (firstChar === ' ' || firstChar === '\t')
                ? line.trimStart()[0]
                : firstChar;
            if ((listFirstChar === '-' || listFirstChar === '+' || listFirstChar === '*' ||
                 (listFirstChar >= '0' && listFirstChar <= '9')) &&
                (RE_UNORDERED_LIST.test(line) || RE_ORDERED_LIST.test(line))) {
                const listResult = this.parseListElement(lines, i, offset);
                if (listResult) {
                    elements.push(listResult.element);
                    offset = listResult.endOffset;
                    i = listResult.endLine;
                    continue;
                }
            }

            // Footnote definition - starts with [fn:
            if (firstChar === '[' && line[1] === 'f' && line[2] === 'n' && line[3] === ':') {
                const fnResult = this.parseFootnoteDefinition(lines, i, offset);
                if (fnResult) {
                    elements.push(fnResult.element);
                    offset = fnResult.endOffset;
                    i = fnResult.endLine;
                    continue;
                }
            }

            // Diary sexp - starts with %% (may be indented)
            if (firstChar === '%' && line[1] === '%' ||
                (firstChar === ' ' || firstChar === '\t') && line.includes('%%')) {
                const diarySexp = this.parseDiarySexp(line, lineStart);
                if (diarySexp) {
                    elements.push(diarySexp);
                    offset += line.length + 1;
                    i++;
                    continue;
                }
            }

            // Clock entry - CLOCK: line (may be indented)
            // Only check if line starts with 'C' or whitespace (tryParseClockEntry handles trimming)
            if (firstChar === 'C' || firstChar === ' ' || firstChar === '\t') {
                const clockEntry = this.tryParseClockEntry(line, lineStart);
                if (clockEntry) {
                    elements.push(clockEntry);
                    offset += line.length + 1;
                    i++;
                    continue;
                }
            }

            // Blank line
            if (line.length === 0 || line.trim() === '') {
                offset += line.length + 1;
                i++;
                continue;
            }

            // Handle stray :PROPERTIES: or :END: lines in section content
            if (firstChar === ':' && RE_PROPERTIES_END.test(line)) {
                if (RE_PROPERTIES_START.test(line)) {
                    // Parse as properties drawer even though it's in section content
                    const drawerResult = this.parsePropertiesDrawer(lines, i, offset);
                    // Create a drawer element to hold the properties
                    elements.push({
                        type: 'drawer',
                        range: { start: lineStart, end: drawerResult.endOffset - 1 },
                        postBlank: 0,
                        properties: { name: 'PROPERTIES' },
                        children: [],
                    } as DrawerElement);
                    offset = drawerResult.endOffset;
                    i = drawerResult.endLine;
                    continue;
                } else {
                    // Stray :END: - skip it
                    offset += line.length + 1;
                    i++;
                    continue;
                }
            }

            // Paragraph (default)
            const paraResult = this.parseParagraph(lines, i, offset);
            elements.push(paraResult.element);
            offset = paraResult.endOffset;
            i = paraResult.endLine;
        }

        return { keywords, keywordLists, properties, elements };
    }

    /**
     * Parse a headline and its contents
     */
    private parseHeadline(
        lines: string[],
        startLine: number,
        endLine: number,
        startOffset: number,
        endOffset: number,
        level: number,
        titleLine: string,
        lineOffsets?: number[]
    ): HeadlineElement {
        // Parse the title line
        let title = titleLine;
        let todoKeyword: string | undefined;
        let todoType: 'todo' | 'done' | undefined;
        let priority: string | undefined;
        const tags: string[] = [];

        // Extract TODO keyword - use pre-compiled pattern
        const todoMatch = title.match(RE_TODO_PREFIX);
        if (todoMatch && this.allTodoKeywords.has(todoMatch[1])) {
            todoKeyword = todoMatch[1];
            todoType = this.doneKeywords.has(todoKeyword) ? 'done' : 'todo';
            title = title.slice(todoMatch[0].length);
        }

        // Extract priority - use pre-compiled pattern
        const priorityMatch = title.match(RE_PRIORITY);
        if (priorityMatch) {
            priority = priorityMatch[1];
            title = title.slice(priorityMatch[0].length);
        }

        // Extract tags - use pre-compiled pattern
        const tagMatch = title.match(RE_TAGS);
        if (tagMatch) {
            tags.push(...tagMatch[1].split(':'));
            title = title.slice(0, -tagMatch[0].length);
        }

        // Check for COMMENT prefix
        let commentedp = false;
        if (title.startsWith('COMMENT ')) {
            commentedp = true;
            title = title.slice(8);
        }

        // Parse title objects
        const titleObjects = this.config.parseInlineObjects ? parseObjects(title) : undefined;

        const headline: HeadlineElement = {
            type: 'headline',
            range: { start: startOffset, end: endOffset },
            postBlank: 0,
            properties: {
                level,
                rawValue: title.trim(),
                title: titleObjects,
                todoKeyword,
                todoType,
                priority,
                tags,
                archivedp: tags.includes('ARCHIVE'),
                commentedp,
                footnoteSection: title.toLowerCase() === 'footnotes',
                lineNumber: startLine + 1,
            },
            children: [],
        };

        // Parse content after headline (planning, properties drawer, section)
        let contentLine = startLine + 1;
        let contentOffset = lineOffsets
            ? lineOffsets[contentLine]
            : startOffset + lines[startLine].length + 1;

        // Check for planning line
        if (contentLine < endLine) {
            const planningResult = this.tryParsePlanning(lines[contentLine], contentOffset);
            if (planningResult) {
                headline.planning = planningResult;
                contentOffset = lineOffsets
                    ? lineOffsets[contentLine + 1]
                    : contentOffset + lines[contentLine].length + 1;
                contentLine++;
            }
        }

        // Check for properties drawer
        if (contentLine < endLine && lines[contentLine].trim() === ':PROPERTIES:') {
            const drawerResult = this.parsePropertiesDrawer(lines, contentLine, contentOffset);
            headline.propertiesDrawer = drawerResult.properties;

            // Extract special properties
            if (drawerResult.properties['CUSTOM_ID']) {
                headline.properties.customId = drawerResult.properties['CUSTOM_ID'];
            }
            if (drawerResult.properties['ID']) {
                headline.properties.id = drawerResult.properties['ID'];
            }
            if (drawerResult.properties['CATEGORY']) {
                headline.properties.category = drawerResult.properties['CATEGORY'];
            }
            if (drawerResult.properties['EFFORT']) {
                headline.properties.effort = drawerResult.properties['EFFORT'];
            }

            contentOffset = drawerResult.endOffset;
            contentLine = drawerResult.endLine;
        }

        // Parse section content (everything in this headline's content area)
        const sectionElements: OrgElement[] = [];

        // Parse section content - endLine is already set to stop at next headline
        if (contentLine < endLine) {
            const sectionLines = lines.slice(contentLine, endLine);
            const { elements } = this.parsePreamble(sectionLines, contentOffset, contentLine, lineOffsets);
            sectionElements.push(...elements);
        }

        if (sectionElements.length > 0) {
            // Use pre-computed offsets for section end
            const sectionEnd = lineOffsets
                ? lineOffsets[endLine]
                : contentOffset + lines.slice(contentLine, endLine).reduce((s, l) => s + l.length + 1, 0);

            headline.section = {
                type: 'section',
                range: { start: contentOffset, end: sectionEnd },
                postBlank: 0,
                children: sectionElements,
            };
        }

        return headline;
    }

    /**
     * Try to parse a block element (src, example, quote, etc.)
     */
    private tryParseBlock(
        lines: string[],
        startLine: number,
        offset: number,
        lineOffsets?: number[],
        baseLineNum?: number
    ): { element: OrgElement; endLine: number; endOffset: number } | null {
        const line = lines[startLine];

        // Fast early-exit: blocks only start with '#', '\', or ':'
        // This avoids running 10+ regex matches on every line
        const firstChar = line[0];
        if (firstChar !== '#' && firstChar !== '\\' && firstChar !== ':') {
            return null;
        }

        // Org blocks (#+BEGIN_* and #+BEGIN:)
        if (firstChar === '#') {
            // Check for dynamic block first (#+BEGIN: name args)
            const dynamicMatch = line.match(RE_DYNAMIC_BLOCK_START);
            if (dynamicMatch) {
                return this.parseDynamicBlock(lines, startLine, offset, dynamicMatch[1], dynamicMatch[2] || '');
            }

            // Check for #+BEGIN_ prefix before running specific regexes
            if (!RE_BEGIN_BLOCK.test(line)) {
                return null;
            }

            // Source block - use pre-compiled pattern
            const srcMatch = line.match(RE_SRC_BLOCK_START);
            if (srcMatch) {
                return this.parseSrcBlock(lines, startLine, offset, srcMatch[1] || '', srcMatch[2] || '');
            }

            // Example block - use pre-compiled pattern
            if (RE_EXAMPLE_BLOCK.test(line)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'example-block', 'EXAMPLE');
            }

            // Quote block - use pre-compiled pattern
            if (RE_QUOTE_BLOCK.test(line)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'quote-block', 'QUOTE');
            }

            // Center block - use pre-compiled pattern
            if (RE_CENTER_BLOCK.test(line)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'center-block', 'CENTER');
            }

            // Verse block - use pre-compiled pattern
            if (RE_VERSE_BLOCK.test(line)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'verse-block', 'VERSE');
            }

            // Comment block - use pre-compiled pattern
            if (RE_COMMENT_BLOCK.test(line)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'comment-block', 'COMMENT');
            }

            // Export block - use pre-compiled pattern
            const exportMatch = line.match(RE_EXPORT_BLOCK);
            if (exportMatch) {
                return this.parseExportBlock(lines, startLine, offset, exportMatch[1] || 'html');
            }

            // Special block (#+BEGIN_foo) - fallback for any other BEGIN block
            const specialMatch = line.match(RE_SPECIAL_BLOCK);
            if (specialMatch) {
                return this.parseSpecialBlock(lines, startLine, offset, specialMatch[1]);
            }

            return null;
        }

        // LaTeX environment
        if (firstChar === '\\') {
            const latexMatch = line.match(RE_LATEX_BEGIN);
            if (latexMatch) {
                return this.parseLatexEnvironment(lines, startLine, offset, latexMatch[1]);
            }
            return null;
        }

        // Drawer
        if (firstChar === ':') {
            const drawerMatch = line.match(RE_DRAWER);
            if (drawerMatch && drawerMatch[1].toUpperCase() !== 'PROPERTIES' && drawerMatch[1].toUpperCase() !== 'END') {
                return this.parseDrawer(lines, startLine, offset, drawerMatch[1]);
            }
            return null;
        }

        return null;
    }

    /**
     * Parse a source block
     */
    private parseSrcBlock(
        lines: string[],
        startLine: number,
        offset: number,
        language: string,
        params: string
    ): { element: SrcBlockElement; endLine: number; endOffset: number } {
        const contentLines: string[] = [];
        let i = startLine + 1;

        // Use pre-compiled pattern
        while (i < lines.length && !RE_SRC_BLOCK_END.test(lines[i])) {
            contentLines.push(lines[i]);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        // Parse header arguments
        const headers = this.parseHeaderArgs(params);

        return {
            element: {
                type: 'src-block',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: {
                    language: language.toLowerCase(),
                    value: contentLines.join('\n'),
                    parameters: params.trim() || undefined,
                    headers,
                    lineNumber: startLine + 1,
                    endLineNumber: i + 1,
                },
            },
            endLine: i + 1,
            endOffset,
        };
    }

    /**
     * Parse header arguments from string
     */
    private parseHeaderArgs(params: string): Record<string, string> {
        const headers: Record<string, string> = {};
        // Reset regex lastIndex for global patterns
        RE_HEADER_ARGS.lastIndex = 0;
        const matches = params.matchAll(RE_HEADER_ARGS);
        for (const match of matches) {
            headers[match[1]] = match[2];
        }
        return headers;
    }

    /**
     * Parse simple block types (example, quote, center, verse, comment)
     */
    private parseSimpleBlock(
        lines: string[],
        startLine: number,
        offset: number,
        blockType: string,
        endTag: string
    ): { element: OrgElement; endLine: number; endOffset: number } {
        const contentLines: string[] = [];
        let i = startLine + 1;
        // Use cached pattern for performance
        const endPattern = OrgParserUnified.getBlockEndPattern(endTag);

        while (i < lines.length && !endPattern.test(lines[i])) {
            contentLines.push(lines[i]);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        const value = contentLines.join('\n');

        if (blockType === 'example-block') {
            return {
                element: {
                    type: 'example-block',
                    range: { start: offset, end: endOffset - 1 },
                    postBlank: 0,
                    properties: { value },
                } as ExampleBlockElement,
                endLine: i + 1,
                endOffset,
            };
        }

        if (blockType === 'verse-block') {
            return {
                element: {
                    type: 'verse-block',
                    range: { start: offset, end: endOffset - 1 },
                    postBlank: 0,
                    properties: { value },
                } as VerseBlockElement,
                endLine: i + 1,
                endOffset,
            };
        }

        if (blockType === 'comment-block') {
            return {
                element: {
                    type: 'comment-block',
                    range: { start: offset, end: endOffset - 1 },
                    postBlank: 0,
                    properties: { value },
                } as CommentBlockElement,
                endLine: i + 1,
                endOffset,
            };
        }

        // quote-block and center-block can contain other elements
        const { elements } = this.parsePreamble(contentLines, offset + lines[startLine].length + 1, startLine + 1);

        if (blockType === 'quote-block') {
            return {
                element: {
                    type: 'quote-block',
                    range: { start: offset, end: endOffset - 1 },
                    postBlank: 0,
                    children: elements,
                } as QuoteBlockElement,
                endLine: i + 1,
                endOffset,
            };
        }

        return {
            element: {
                type: 'center-block',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                children: elements,
            } as CenterBlockElement,
            endLine: i + 1,
            endOffset,
        };
    }

    /**
     * Parse export block
     */
    private parseExportBlock(
        lines: string[],
        startLine: number,
        offset: number,
        backend: string
    ): { element: ExportBlockElement; endLine: number; endOffset: number } {
        const contentLines: string[] = [];
        let i = startLine + 1;

        while (i < lines.length && !lines[i].match(/^#\+END_EXPORT/i)) {
            contentLines.push(lines[i]);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        return {
            element: {
                type: 'export-block',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: {
                    backend: backend.toLowerCase(),
                    value: contentLines.join('\n'),
                },
            },
            endLine: i + 1,
            endOffset,
        };
    }

    /**
     * Parse special block (#+BEGIN_foo)
     */
    private parseSpecialBlock(
        lines: string[],
        startLine: number,
        offset: number,
        blockType: string
    ): { element: SpecialBlockElement; endLine: number; endOffset: number } {
        const contentLines: string[] = [];
        let i = startLine + 1;
        // Use cached pattern for performance
        const endPattern = OrgParserUnified.getBlockEndPattern(blockType);

        while (i < lines.length && !endPattern.test(lines[i])) {
            contentLines.push(lines[i]);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        const { elements } = this.parsePreamble(contentLines, offset + lines[startLine].length + 1, startLine + 1);

        return {
            element: {
                type: 'special-block',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: { blockType },
                children: elements,
            },
            endLine: i + 1,
            endOffset,
        };
    }

    /**
     * Parse LaTeX environment
     */
    private parseLatexEnvironment(
        lines: string[],
        startLine: number,
        offset: number,
        envName: string
    ): { element: LatexEnvironmentElement; endLine: number; endOffset: number } {
        const contentLines: string[] = [lines[startLine]];
        let i = startLine + 1;
        // Use cached pattern for performance
        const endPattern = OrgParserUnified.getLatexEndPattern(envName);

        while (i < lines.length && !endPattern.test(lines[i])) {
            contentLines.push(lines[i]);
            i++;
        }

        if (i < lines.length) {
            contentLines.push(lines[i]);
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        return {
            element: {
                type: 'latex-environment',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: {
                    name: envName,
                    value: contentLines.join('\n'),
                },
            },
            endLine: i + 1,
            endOffset,
        };
    }

    /**
     * Parse drawer
     */
    private parseDrawer(
        lines: string[],
        startLine: number,
        offset: number,
        drawerName: string
    ): { element: DrawerElement; endLine: number; endOffset: number } {
        const contentLines: string[] = [];
        let i = startLine + 1;

        while (i < lines.length && lines[i].trim() !== ':END:') {
            contentLines.push(lines[i]);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        const { elements } = this.parsePreamble(contentLines, offset + lines[startLine].length + 1, startLine + 1);

        return {
            element: {
                type: 'drawer',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: { name: drawerName },
                children: elements,
            },
            endLine: i + 1,
            endOffset,
        };
    }

    /**
     * Parse properties drawer
     */
    private parsePropertiesDrawer(
        lines: string[],
        startLine: number,
        offset: number
    ): { properties: Record<string, string>; endLine: number; endOffset: number } {
        const properties: Record<string, string> = {};
        let i = startLine + 1;

        while (i < lines.length && lines[i].trim() !== RE_DRAWER_END) {
            // Use pre-compiled pattern
            const propMatch = lines[i].match(RE_PROPERTY_LINE);
            if (propMatch) {
                properties[propMatch[1]] = propMatch[2];
            }
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        return { properties, endLine: i + 1, endOffset };
    }

    /**
     * Try to parse planning line
     */
    private tryParsePlanning(line: string, offset: number): PlanningElement | null {
        // Use pre-compiled pattern for fast early exit
        if (!RE_PLANNING_LINE.test(line)) {
            return null;
        }

        const planning: PlanningElement = {
            type: 'planning',
            range: { start: offset, end: offset + line.length },
            postBlank: 0,
            properties: {},
        };

        // Parse SCHEDULED - use pre-compiled pattern
        const scheduledMatch = line.match(RE_SCHEDULED);
        if (scheduledMatch) {
            const ts = this.parseTimestampString(scheduledMatch[1], offset + line.indexOf(scheduledMatch[1]));
            if (ts) planning.properties.scheduled = ts;
        }

        // Parse DEADLINE - use pre-compiled pattern
        const deadlineMatch = line.match(RE_DEADLINE);
        if (deadlineMatch) {
            const ts = this.parseTimestampString(deadlineMatch[1], offset + line.indexOf(deadlineMatch[1]));
            if (ts) planning.properties.deadline = ts;
        }

        // Parse CLOSED - use pre-compiled pattern
        const closedMatch = line.match(RE_CLOSED);
        if (closedMatch) {
            const ts = this.parseTimestampString(closedMatch[1], offset + line.indexOf(closedMatch[1]));
            if (ts) planning.properties.closed = ts;
        }

        return planning;
    }

    /**
     * Parse a timestamp string
     */
    private parseTimestampString(str: string, offset: number): TimestampObject | null {
        const isActive = str.startsWith('<');
        const content = str.slice(1, -1);

        // Use pre-compiled pattern
        const dateMatch = content.match(RE_TIMESTAMP_CONTENT);

        if (!dateMatch) return null;

        return {
            type: 'timestamp',
            range: { start: offset, end: offset + str.length },
            postBlank: 0,
            properties: {
                timestampType: isActive ? 'active' : 'inactive',
                rawValue: str,
                yearStart: parseInt(dateMatch[1]),
                monthStart: parseInt(dateMatch[2]),
                dayStart: parseInt(dateMatch[3]),
                hourStart: dateMatch[4] ? parseInt(dateMatch[4]) : undefined,
                minuteStart: dateMatch[5] ? parseInt(dateMatch[5]) : undefined,
            },
        };
    }

    /**
     * Parse a paragraph
     */
    private parseParagraph(
        lines: string[],
        startLine: number,
        offset: number
    ): { element: ParagraphElement; endLine: number; endOffset: number } {
        const paraLines: string[] = [];
        let i = startLine;

        // Collect paragraph lines (until blank line or block start)
        while (i < lines.length) {
            const line = lines[i];
            const firstChar = line[0];

            // Stop at blank line
            if (line.length === 0 || line.trim() === '') break;

            // Stop at headline - fast char check first
            if (firstChar === '*' && RE_HEADLINE_SIMPLE.test(line)) break;

            // Stop at block start - fast char check first
            if (firstChar === '#' && RE_BLOCK_START.test(line)) break;
            if (firstChar === '\\' && RE_LATEX_ENV_START.test(line)) break;
            if (firstChar === ':' && RE_DRAWER.test(line)) break;

            // Stop at keyword - fast char check first
            if (firstChar === '#' && RE_KEYWORD_LINE.test(line)) break;

            // Stop at table
            if (RE_TABLE.test(line)) break;

            // Stop at list item (if not continuing) - use pre-compiled patterns
            if (i > startLine && (RE_UNORDERED_LIST.test(line) || RE_ORDERED_LIST.test(line))) break;

            paraLines.push(line);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j < i; j++) {
            endOffset += lines[j].length + 1;
        }

        const text = paraLines.join('\n');
        const children = this.config.parseInlineObjects ? parseObjects(text, { baseOffset: offset }) : [];

        return {
            element: {
                type: 'paragraph',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                children,
            },
            endLine: i,
            endOffset,
        };
    }

    /**
     * Parse a table element
     */
    private parseTableElement(
        lines: string[],
        startLine: number,
        offset: number
    ): { element: TableElement; endLine: number; endOffset: number } | null {
        const tableLines: string[] = [];
        let i = startLine;

        while (i < lines.length && lines[i].match(/^\s*\|/)) {
            tableLines.push(lines[i]);
            i++;
        }

        if (tableLines.length === 0) return null;

        let endOffset = offset;
        for (let j = startLine; j < i; j++) {
            endOffset += lines[j].length + 1;
        }

        // parseTable expects array of lines
        const table = parseTable(tableLines, startLine, { baseOffset: offset });

        if (!table) return null;

        // Adjust ranges
        table.range = { start: offset, end: endOffset - 1 };

        return {
            element: table,
            endLine: i,
            endOffset,
        };
    }

    /**
     * Parse a list element
     */
    private parseListElement(
        lines: string[],
        startLine: number,
        offset: number
    ): { element: PlainListElement; endLine: number; endOffset: number } | null {
        // Find extent of list
        let i = startLine;
        const firstIndent = lines[startLine].match(/^(\s*)/)?.[1].length ?? 0;

        while (i < lines.length) {
            const line = lines[i];

            // Blank line may end list
            if (line.trim() === '') {
                // Check if next non-blank line continues list
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === '') j++;
                if (j >= lines.length) break;

                const nextIndent = lines[j].match(/^(\s*)/)?.[1].length ?? 0;
                if (nextIndent < firstIndent) break;
                if (!lines[j].match(/^\s*[-+*]\s/) && !lines[j].match(/^\s*\d+[.)]\s/)) {
                    // Check if it's a continuation
                    if (nextIndent <= firstIndent) break;
                }
            }

            // Check for end of list context
            if (line.match(/^\*+ /)) break;
            if (line.match(/^#\+/)) break;
            if (line.match(/^\s*\|/)) break;

            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j < i; j++) {
            endOffset += lines[j].length + 1;
        }

        // parseList expects array of lines
        const listLines = lines.slice(startLine, i);
        const list = parseList(listLines, startLine, offset);

        if (!list) return null;

        // Adjust ranges
        list.range = { start: offset, end: endOffset - 1 };

        return {
            element: list,
            endLine: i,
            endOffset,
        };
    }

    /**
     * Parse a dynamic block (#+BEGIN: name args ... #+END:)
     */
    private parseDynamicBlock(
        lines: string[],
        startLine: number,
        offset: number,
        blockName: string,
        args: string
    ): { element: DynamicBlockElement; endLine: number; endOffset: number } {
        const contentLines: string[] = [];
        let i = startLine + 1;

        while (i < lines.length && !RE_DYNAMIC_BLOCK_END.test(lines[i])) {
            contentLines.push(lines[i]);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j <= i && j < lines.length; j++) {
            endOffset += lines[j].length + 1;
        }

        // Parse content as elements
        const { elements } = this.parsePreamble(contentLines, offset + lines[startLine].length + 1, startLine + 1);

        return {
            element: {
                type: 'dynamic-block',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: {
                    name: blockName,
                    arguments: args.trim() || undefined,
                },
                children: elements,
            },
            endLine: i + 1,
            endOffset,
        };
    }

    /**
     * Parse a babel call (#+CALL: name[header](args)[end-header])
     */
    private parseBabelCall(
        line: string,
        offset: number
    ): BabelCallElement | null {
        const match = line.match(RE_BABEL_CALL);
        if (!match) return null;

        return {
            type: 'babel-call',
            range: { start: offset, end: offset + line.length },
            postBlank: 0,
            properties: {
                call: match[1],
                insideHeader: match[2] || undefined,
                arguments: match[3] || undefined,
                endHeader: match[4] || undefined,
            },
        };
    }

    /**
     * Parse a footnote definition ([fn:label] content)
     */
    private parseFootnoteDefinition(
        lines: string[],
        startLine: number,
        offset: number
    ): { element: FootnoteDefinitionElement; endLine: number; endOffset: number } | null {
        const line = lines[startLine];
        const match = line.match(RE_FOOTNOTE_DEF);
        if (!match) return null;

        const label = match[1];
        const firstLineContent = line.slice(match[0].length);

        // Find extent of footnote definition (continues until next footnote def, headline, or blank line)
        let i = startLine + 1;
        while (i < lines.length) {
            const nextLine = lines[i];
            // Stop at headline
            if (nextLine[0] === '*' && RE_HEADLINE_SIMPLE.test(nextLine)) break;
            // Stop at another footnote definition
            if (nextLine[0] === '[' && RE_FOOTNOTE_DEF.test(nextLine)) break;
            // Stop at blank line followed by non-indented content
            if (nextLine.trim() === '') {
                const afterBlank = lines[i + 1];
                if (!afterBlank || (afterBlank[0] !== ' ' && afterBlank[0] !== '\t')) break;
            }
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j < i; j++) {
            endOffset += lines[j].length + 1;
        }

        // Parse content
        const contentLines = [firstLineContent, ...lines.slice(startLine + 1, i)];
        const { elements } = this.parsePreamble(contentLines, offset + match[0].length, startLine);

        return {
            element: {
                type: 'footnote-definition',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: { label },
                children: elements,
            },
            endLine: i,
            endOffset,
        };
    }

    /**
     * Parse a diary sexp (%%(sexp))
     */
    private parseDiarySexp(
        line: string,
        offset: number
    ): DiarySexpElement | null {
        const match = line.match(RE_DIARY_SEXP);
        if (!match) return null;

        return {
            type: 'diary-sexp',
            range: { start: offset, end: offset + line.length },
            postBlank: 0,
            properties: {
                value: match[1],
                description: match[2]?.trim() || undefined,
            },
        };
    }

    /**
     * Parse a clock entry line
     */
    private tryParseClockEntry(line: string, offset: number): ClockElement | null {
        const trimmed = line.trim();
        if (!trimmed.startsWith('CLOCK:')) return null;
        return parseClockLine(line, 0, offset);
    }

    /**
     * Collect affiliated keywords from preceding lines
     * Returns the keywords and the number of lines consumed
     */
    private collectAffiliatedKeywords(
        lines: string[],
        startLine: number
    ): { keywords: AffiliatedKeywords; linesConsumed: number } {
        const keywords: AffiliatedKeywords = { attr: {} };
        let linesConsumed = 0;
        let i = startLine;

        while (i < lines.length) {
            const line = lines[i];

            // Fast path: affiliated keywords must start with #+
            if (line[0] !== '#' || line[1] !== '+') break;

            // Try #+NAME:
            const nameMatch = line.match(RE_AFFILIATED_NAME);
            if (nameMatch) {
                keywords.name = nameMatch[1];
                linesConsumed++;
                i++;
                continue;
            }

            // Try #+CAPTION:
            const captionMatch = line.match(RE_AFFILIATED_CAPTION);
            if (captionMatch) {
                if (captionMatch[1]) {
                    // Short caption syntax: #+CAPTION[short]: long
                    keywords.caption = [captionMatch[1], captionMatch[2]];
                } else {
                    keywords.caption = captionMatch[2];
                }
                linesConsumed++;
                i++;
                continue;
            }

            // Try #+ATTR_BACKEND:
            const attrMatch = line.match(RE_AFFILIATED_ATTR);
            if (attrMatch) {
                const backend = attrMatch[1].toLowerCase();
                if (!keywords.attr[backend]) {
                    keywords.attr[backend] = {};
                }
                // Parse attribute key-value pairs
                const attrStr = attrMatch[2];
                const attrPairs = attrStr.match(/:(\S+)\s+([^\s:]+(?:\s+[^:]+)?)/g);
                if (attrPairs) {
                    for (const pair of attrPairs) {
                        const pairMatch = pair.match(/:(\S+)\s+(.+)/);
                        if (pairMatch) {
                            keywords.attr[backend]![pairMatch[1]] = pairMatch[2].trim();
                        }
                    }
                }
                linesConsumed++;
                i++;
                continue;
            }

            // Try #+HEADER:
            const headerMatch = line.match(RE_AFFILIATED_HEADER);
            if (headerMatch) {
                if (!keywords.header) keywords.header = [];
                keywords.header.push(headerMatch[1]);
                linesConsumed++;
                i++;
                continue;
            }

            // Try #+RESULTS:
            const resultsMatch = line.match(RE_AFFILIATED_RESULTS);
            if (resultsMatch) {
                keywords.results = resultsMatch[2] || resultsMatch[1] || '';
                linesConsumed++;
                i++;
                continue;
            }

            // Try #+PLOT:
            const plotMatch = line.match(RE_AFFILIATED_PLOT);
            if (plotMatch) {
                keywords.plot = plotMatch[1];
                linesConsumed++;
                i++;
                continue;
            }

            // Not an affiliated keyword
            break;
        }

        return { keywords, linesConsumed };
    }

    /**
     * Parse an inline task (headline with level >= inlinetaskMinLevel)
     */
    private parseInlinetask(
        lines: string[],
        startLine: number,
        offset: number,
        level: number,
        titleLine: string
    ): { element: InlinetaskElement; endLine: number; endOffset: number } {
        // Parse title similar to headline
        let title = titleLine;
        let todoKeyword: string | undefined;
        let todoType: 'todo' | 'done' | undefined;
        let priority: string | undefined;
        const tags: string[] = [];

        // Extract TODO keyword
        const todoMatch = title.match(RE_TODO_PREFIX);
        if (todoMatch && this.allTodoKeywords.has(todoMatch[1])) {
            todoKeyword = todoMatch[1];
            todoType = this.doneKeywords.has(todoKeyword) ? 'done' : 'todo';
            title = title.slice(todoMatch[0].length);
        }

        // Extract priority
        const priorityMatch = title.match(RE_PRIORITY);
        if (priorityMatch) {
            priority = priorityMatch[1];
            title = title.slice(priorityMatch[0].length);
        }

        // Extract tags
        const tagMatch = title.match(RE_TAGS);
        if (tagMatch) {
            tags.push(...tagMatch[1].split(':'));
            title = title.slice(0, -tagMatch[0].length);
        }

        const titleObjects = this.config.parseInlineObjects ? parseObjects(title) : undefined;

        // Find extent (until END or next headline at same/lower level)
        let i = startLine + 1;
        const contentLines: string[] = [];

        // Use pre-compiled pattern from cache (or create one for unusual levels)
        const endPattern = OrgParserUnified.inlinetaskEndPatterns.get(level)
            ?? new RegExp(`^\\*{${level}}\\s+END\\s*$`);

        while (i < lines.length) {
            const line = lines[i];
            // Check for END marker (stars at same level followed by END)
            if (endPattern.test(line)) {
                i++;
                break;
            }
            // Check for another headline
            if (line[0] === '*' && RE_HEADLINE_SIMPLE.test(line)) {
                const headlineMatch = line.match(RE_HEADLINE);
                if (headlineMatch && headlineMatch[1].length <= level) {
                    break;
                }
            }
            contentLines.push(line);
            i++;
        }

        let endOffset = offset;
        for (let j = startLine; j < i; j++) {
            endOffset += lines[j].length + 1;
        }

        // Parse content
        const { elements } = this.parsePreamble(contentLines, offset + lines[startLine].length + 1, startLine + 1);

        return {
            element: {
                type: 'inlinetask',
                range: { start: offset, end: endOffset - 1 },
                postBlank: 0,
                properties: {
                    level,
                    rawValue: title.trim(),
                    title: titleObjects,
                    todoKeyword,
                    todoType,
                    priority,
                    tags,
                },
                children: elements,
            },
            endLine: i,
            endOffset,
        };
    }
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Parse org content with default options
 */
export function parseOrg(content: string, config?: OrgParserConfig): OrgDocumentNode {
    const parser = new OrgParserUnified(config);
    return parser.parse(content);
}

