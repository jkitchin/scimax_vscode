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
    PlanningElement,
    ClockElement,
    TableElement,
    TableRowElement,
    PlainListElement,
    ItemElement,
    TimestampObject,
    OrgRange,
} from './orgElementTypes';
import { parseObjects } from './orgObjects';
import { parseTable, parsePlanningLine, parseClockLine, parseList } from './orgElements';
import { PositionTracker, addPositionsToDocument } from './orgPosition';

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
}

const DEFAULT_TODO_KEYWORDS = ['TODO', 'NEXT', 'WAITING', 'HOLD', 'SOMEDAY'];
const DEFAULT_DONE_KEYWORDS = ['DONE', 'CANCELLED', 'CANCELED'];

// =============================================================================
// Unified Parser Class
// =============================================================================

export class OrgParserUnified {
    private config: Required<OrgParserConfig>;
    private todoKeywords: Set<string>;
    private doneKeywords: Set<string>;
    private allTodoKeywords: Set<string>;

    constructor(config: OrgParserConfig = {}) {
        this.config = {
            todoKeywords: config.todoKeywords ?? DEFAULT_TODO_KEYWORDS,
            doneKeywords: config.doneKeywords ?? DEFAULT_DONE_KEYWORDS,
            parseInlineObjects: config.parseInlineObjects ?? true,
            addPositions: config.addPositions ?? true,
            filePath: config.filePath ?? '',
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
            children: [],
        };

        let offset = 0;
        let lineNum = 0;

        // Parse file-level content (before first headline)
        const firstHeadlineIdx = lines.findIndex((line) => /^\*+ /.test(line));
        const preambleEnd = firstHeadlineIdx === -1 ? lines.length : firstHeadlineIdx;

        if (preambleEnd > 0) {
            const preambleLines = lines.slice(0, preambleEnd);
            const preambleText = preambleLines.join('\n');
            const { keywords, properties, elements } = this.parsePreamble(
                preambleLines,
                offset,
                lineNum
            );
            doc.keywords = keywords;
            doc.properties = properties;

            if (elements.length > 0) {
                doc.section = {
                    type: 'section',
                    range: { start: offset, end: offset + preambleText.length },
                    postBlank: 0,
                    children: elements,
                };
            }

            offset += preambleText.length + (firstHeadlineIdx > 0 ? 1 : 0);
            lineNum = preambleEnd;
        }

        // Parse headlines
        if (firstHeadlineIdx !== -1) {
            const headlineStack: HeadlineElement[] = [];

            while (lineNum < lines.length) {
                const line = lines[lineNum];
                const lineStart = offset;

                const headlineMatch = line.match(/^(\*+)\s+(.*)$/);
                if (headlineMatch) {
                    const level = headlineMatch[1].length;

                    // Find the extent of this headline's own content (until next headline of ANY level)
                    let contentEnd = lineNum + 1;
                    while (contentEnd < lines.length) {
                        const nextMatch = lines[contentEnd].match(/^(\*+)\s/);
                        if (nextMatch) {
                            break; // Stop at any headline
                        }
                        contentEnd++;
                    }

                    // Calculate the end offset for this headline's content
                    let endOffset = lineStart;
                    for (let i = lineNum; i < contentEnd; i++) {
                        endOffset += lines[i].length + 1;
                    }
                    if (contentEnd < lines.length) {
                        endOffset -= 1;
                    }

                    const headline = this.parseHeadline(
                        lines,
                        lineNum,
                        contentEnd,
                        lineStart,
                        endOffset,
                        level,
                        headlineMatch[2]
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

                    // Only skip to end of this headline's own content, not child headlines
                    for (let i = lineNum; i < contentEnd; i++) {
                        offset += lines[i].length + 1;
                    }
                    lineNum = contentEnd;
                } else {
                    offset += line.length + 1;
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
     * Parse file preamble (content before first headline)
     */
    private parsePreamble(
        lines: string[],
        baseOffset: number,
        _baseLineNum: number
    ): {
        keywords: Record<string, string>;
        properties: Record<string, string>;
        elements: OrgElement[];
    } {
        const keywords: Record<string, string> = {};
        const properties: Record<string, string> = {};
        const elements: OrgElement[] = [];

        let offset = baseOffset;
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const lineStart = offset;

            // Keyword line (#+KEY: value)
            const keywordMatch = line.match(/^#\+(\w+):\s*(.*)$/);
            if (keywordMatch && !line.match(/^#\+BEGIN_/i)) {
                const key = keywordMatch[1].toUpperCase();
                const value = keywordMatch[2];

                if (key === 'PROPERTY') {
                    const propMatch = value.match(/^(\S+)\s+(.*)$/);
                    if (propMatch) {
                        properties[propMatch[1]] = propMatch[2];
                    }
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

            // Comment line
            if (line.match(/^#\s/) || line === '#') {
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

            // Try to parse block elements
            const blockResult = this.tryParseBlock(lines, i, offset);
            if (blockResult) {
                elements.push(blockResult.element);
                offset = blockResult.endOffset;
                i = blockResult.endLine;
                continue;
            }

            // Horizontal rule
            if (line.match(/^-{5,}\s*$/)) {
                elements.push({
                    type: 'horizontal-rule',
                    range: { start: lineStart, end: lineStart + line.length },
                    postBlank: 0,
                } as HorizontalRuleElement);

                offset += line.length + 1;
                i++;
                continue;
            }

            // Fixed width (: prefix)
            if (line.match(/^:\s/)) {
                let endLine = i;
                while (endLine < lines.length && lines[endLine].match(/^:\s?/)) {
                    endLine++;
                }
                const fixedLines = lines.slice(i, endLine).map((l) => l.slice(2));
                const endOffset = offset + lines.slice(i, endLine).reduce((s, l) => s + l.length + 1, 0) - 1;

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

            // Table
            if (line.match(/^\s*\|/)) {
                const tableResult = this.parseTableElement(lines, i, offset);
                if (tableResult) {
                    elements.push(tableResult.element);
                    offset = tableResult.endOffset;
                    i = tableResult.endLine;
                    continue;
                }
            }

            // List
            if (line.match(/^\s*[-+*](?:\s|$)/) || line.match(/^\s*\d+[.)](?:\s|$)/)) {
                const listResult = this.parseListElement(lines, i, offset);
                if (listResult) {
                    elements.push(listResult.element);
                    offset = listResult.endOffset;
                    i = listResult.endLine;
                    continue;
                }
            }

            // Blank line
            if (line.trim() === '') {
                offset += line.length + 1;
                i++;
                continue;
            }

            // Handle stray :PROPERTIES: or :END: lines in section content
            // (These can appear when PROPERTIES drawer isn't immediately after headline)
            if (line.match(/^:(PROPERTIES|END):\s*$/i)) {
                if (line.match(/^:PROPERTIES:\s*$/i)) {
                    // Parse as properties drawer even though it's in section content
                    const drawerResult = this.parsePropertiesDrawer(lines, i, offset);
                    // Create a drawer element to hold the properties
                    elements.push({
                        type: 'drawer',
                        range: { start: offset, end: drawerResult.endOffset - 1 },
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

        return { keywords, properties, elements };
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
        titleLine: string
    ): HeadlineElement {
        // Parse the title line
        let title = titleLine;
        let todoKeyword: string | undefined;
        let todoType: 'todo' | 'done' | undefined;
        let priority: string | undefined;
        const tags: string[] = [];

        // Extract TODO keyword
        const todoMatch = title.match(/^(\S+)\s+/);
        if (todoMatch && this.allTodoKeywords.has(todoMatch[1])) {
            todoKeyword = todoMatch[1];
            todoType = this.doneKeywords.has(todoKeyword) ? 'done' : 'todo';
            title = title.slice(todoMatch[0].length);
        }

        // Extract priority
        const priorityMatch = title.match(/^\[#([A-Z])\]\s+/);
        if (priorityMatch) {
            priority = priorityMatch[1];
            title = title.slice(priorityMatch[0].length);
        }

        // Extract tags
        const tagMatch = title.match(/\s+:([^:\s]+(?::[^:\s]+)*):$/);
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
        let contentOffset = startOffset + lines[startLine].length + 1;

        // Check for planning line
        if (contentLine < endLine) {
            const planningResult = this.tryParsePlanning(lines[contentLine], contentOffset);
            if (planningResult) {
                headline.planning = planningResult;
                contentOffset += lines[contentLine].length + 1;
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
            const { elements } = this.parsePreamble(sectionLines, contentOffset, contentLine);
            sectionElements.push(...elements);
        }

        if (sectionElements.length > 0) {
            let sectionEnd = contentOffset;
            for (let i = contentLine; i < endLine; i++) {
                sectionEnd += lines[i].length + 1;
            }

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
        offset: number
    ): { element: OrgElement; endLine: number; endOffset: number } | null {
        const line = lines[startLine];

        // Fast early-exit: blocks only start with '#', '\', or ':'
        // This avoids running 10+ regex matches on every line
        const firstChar = line[0];
        if (firstChar !== '#' && firstChar !== '\\' && firstChar !== ':') {
            return null;
        }

        // Org blocks (#+BEGIN_*)
        if (firstChar === '#') {
            // Check for #+BEGIN_ prefix before running specific regexes
            if (!line.match(/^#\+BEGIN_/i)) {
                return null;
            }

            // Source block
            const srcMatch = line.match(/^#\+BEGIN_SRC(?:\s+(\S+))?(.*)$/i);
            if (srcMatch) {
                return this.parseSrcBlock(lines, startLine, offset, srcMatch[1] || '', srcMatch[2] || '');
            }

            // Example block
            if (line.match(/^#\+BEGIN_EXAMPLE/i)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'example-block', 'EXAMPLE');
            }

            // Quote block
            if (line.match(/^#\+BEGIN_QUOTE/i)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'quote-block', 'QUOTE');
            }

            // Center block
            if (line.match(/^#\+BEGIN_CENTER/i)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'center-block', 'CENTER');
            }

            // Verse block
            if (line.match(/^#\+BEGIN_VERSE/i)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'verse-block', 'VERSE');
            }

            // Comment block
            if (line.match(/^#\+BEGIN_COMMENT/i)) {
                return this.parseSimpleBlock(lines, startLine, offset, 'comment-block', 'COMMENT');
            }

            // Export block
            const exportMatch = line.match(/^#\+BEGIN_EXPORT(?:\s+(\S+))?/i);
            if (exportMatch) {
                return this.parseExportBlock(lines, startLine, offset, exportMatch[1] || 'html');
            }

            // Special block (#+BEGIN_foo) - fallback for any other BEGIN block
            const specialMatch = line.match(/^#\+BEGIN_(\w+)/i);
            if (specialMatch) {
                return this.parseSpecialBlock(lines, startLine, offset, specialMatch[1]);
            }

            return null;
        }

        // LaTeX environment
        if (firstChar === '\\') {
            const latexMatch = line.match(/^\\begin\{(\w+)\}/);
            if (latexMatch) {
                return this.parseLatexEnvironment(lines, startLine, offset, latexMatch[1]);
            }
            return null;
        }

        // Drawer
        if (firstChar === ':') {
            const drawerMatch = line.match(/^:(\w+):\s*$/);
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

        while (i < lines.length && !lines[i].match(/^#\+END_SRC/i)) {
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
        const matches = params.matchAll(/:(\S+)\s+(\S+)/g);
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
        const endPattern = new RegExp(`^#\\+END_${endTag}`, 'i');

        while (i < lines.length && !lines[i].match(endPattern)) {
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
        const endPattern = new RegExp(`^#\\+END_${blockType}`, 'i');

        while (i < lines.length && !lines[i].match(endPattern)) {
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
        const endPattern = new RegExp(`^\\\\end\\{${envName}\\}`);

        while (i < lines.length && !lines[i].match(endPattern)) {
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

        while (i < lines.length && lines[i].trim() !== ':END:') {
            const propMatch = lines[i].match(/^\s*:(\S+):\s*(.*)$/);
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
        if (!line.match(/^\s*(SCHEDULED|DEADLINE|CLOSED):/)) {
            return null;
        }

        const planning: PlanningElement = {
            type: 'planning',
            range: { start: offset, end: offset + line.length },
            postBlank: 0,
            properties: {},
        };

        // Parse SCHEDULED
        const scheduledMatch = line.match(/SCHEDULED:\s*(<[^>]+>|\[[^\]]+\])/);
        if (scheduledMatch) {
            const ts = this.parseTimestampString(scheduledMatch[1], offset + line.indexOf(scheduledMatch[1]));
            if (ts) planning.properties.scheduled = ts;
        }

        // Parse DEADLINE
        const deadlineMatch = line.match(/DEADLINE:\s*(<[^>]+>|\[[^\]]+\])/);
        if (deadlineMatch) {
            const ts = this.parseTimestampString(deadlineMatch[1], offset + line.indexOf(deadlineMatch[1]));
            if (ts) planning.properties.deadline = ts;
        }

        // Parse CLOSED
        const closedMatch = line.match(/CLOSED:\s*(<[^>]+>|\[[^\]]+\])/);
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

        const dateMatch = content.match(
            /^(\d{4})-(\d{2})-(\d{2})(?:\s+\w+)?(?:\s+(\d{2}):(\d{2}))?/
        );

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

            // Stop at blank line
            if (line.trim() === '') break;

            // Stop at headline
            if (line.match(/^\*+ /)) break;

            // Stop at block start
            if (line.match(/^#\+BEGIN_/i)) break;
            if (line.match(/^\\begin\{/)) break;
            if (line.match(/^:\w+:\s*$/)) break;

            // Stop at keyword
            if (line.match(/^#\+\w+:/)) break;

            // Stop at table
            if (line.match(/^\s*\|/)) break;

            // Stop at list item (if not continuing)
            if (i > startLine && (line.match(/^\s*[-+*]\s/) || line.match(/^\s*\d+[.)]\s/))) break;

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

