/**
 * Org-mode parser for extracting structure from org files
 * Supports headings, source blocks, links, tags, properties, and timestamps
 */

export interface OrgHeading {
    level: number;
    title: string;
    todoState?: string;
    priority?: string;
    tags: string[];
    lineNumber: number;
    properties: Record<string, string>;
    children: OrgHeading[];
}

export interface OrgSourceBlock {
    language: string;
    content: string;
    headers: Record<string, string>;
    lineNumber: number;
    endLineNumber: number;
}

export interface OrgLink {
    type: string;
    target: string;
    description?: string;
    lineNumber: number;
}

export interface OrgTimestamp {
    type: 'active' | 'inactive' | 'scheduled' | 'deadline' | 'closed';
    date: string;
    time?: string;
    repeater?: string;
    lineNumber: number;
}

export interface OrgDocument {
    headings: OrgHeading[];
    sourceBlocks: OrgSourceBlock[];
    links: OrgLink[];
    timestamps: OrgTimestamp[];
    properties: Record<string, string>;
    keywords: Record<string, string>;
}

// Common TODO states
const DEFAULT_TODO_STATES = ['TODO', 'NEXT', 'WAIT', 'DONE', 'CANCELLED', 'IN-PROGRESS', 'WAITING'];

/**
 * Parse #+TODO: or #+SEQ_TODO: line to extract workflow states
 * Format: #+TODO: STATE1 STATE2 | DONE1 DONE2
 */
function parseTodoKeywordLine(line: string): string[] | null {
    const match = line.match(/^#\+(TODO|SEQ_TODO|TYP_TODO):\s*(.*)$/i);
    if (!match) {
        return null;
    }

    const statesString = match[2].trim();
    if (!statesString) {
        return null;
    }

    // Remove the | separator and parse all states
    const allStates = statesString
        .replace('|', ' ')
        .split(/\s+/)
        .filter(s => s.length > 0);

    return allStates.length > 0 ? allStates : null;
}

/**
 * Scan document for #+TODO: keywords and extract all custom states
 */
function extractTodoStatesFromContent(content: string): string[] {
    const lines = content.split('\n');
    const customStates: string[] = [];

    for (const line of lines) {
        // Stop at first heading - keywords must be before content
        if (line.match(/^\*+\s/)) {
            break;
        }

        const states = parseTodoKeywordLine(line);
        if (states) {
            customStates.push(...states);
        }
    }

    return customStates;
}

export class OrgParser {
    private todoStates: Set<string>;
    private customStatesProvided: boolean;

    constructor(customTodoStates?: string[]) {
        this.customStatesProvided = !!customTodoStates;
        this.todoStates = new Set(customTodoStates || DEFAULT_TODO_STATES);
    }

    /**
     * Parse an org document from text content
     */
    public parse(content: string): OrgDocument {
        const lines = content.split('\n');
        const document: OrgDocument = {
            headings: [],
            sourceBlocks: [],
            links: [],
            timestamps: [],
            properties: {},
            keywords: {}
        };

        // Extract custom TODO states from #+TODO: keywords if not provided via constructor
        if (!this.customStatesProvided) {
            const fileStates = extractTodoStatesFromContent(content);
            if (fileStates.length > 0) {
                // Merge file-specific states with defaults for better compatibility
                this.todoStates = new Set([...fileStates, ...DEFAULT_TODO_STATES]);
            }
        }

        let i = 0;
        const headingStack: OrgHeading[] = [];

        while (i < lines.length) {
            const line = lines[i];
            const lineNumber = i + 1; // 1-indexed

            // Parse file-level keywords (#+KEY: value)
            const keywordMatch = line.match(/^#\+(\w+):\s*(.*)$/);
            if (keywordMatch && !line.match(/^#\+BEGIN_/i)) {
                document.keywords[keywordMatch[1].toUpperCase()] = keywordMatch[2];
                i++;
                continue;
            }

            // Parse headings
            const headingMatch = line.match(/^(\*+)\s+(.*)$/);
            if (headingMatch) {
                const heading = this.parseHeading(headingMatch[1], headingMatch[2], lineNumber);

                // Parse properties drawer if present
                const propsResult = this.parsePropertiesDrawer(lines, i + 1);
                heading.properties = propsResult.properties;
                i = propsResult.endIndex;

                // Add heading to tree
                this.addHeadingToTree(heading, headingStack, document.headings);
                i++;
                continue;
            }

            // Parse source blocks
            const srcBlockStart = line.match(/^#\+BEGIN_SRC\s+(\S+)(.*)$/i);
            if (srcBlockStart) {
                const block = this.parseSourceBlock(lines, i, srcBlockStart[1], srcBlockStart[2]);
                document.sourceBlocks.push(block);
                i = block.endLineNumber;
                continue;
            }

            // Parse links in line
            const lineLinks = this.parseLinks(line, lineNumber);
            document.links.push(...lineLinks);

            // Parse timestamps in line
            const lineTimestamps = this.parseTimestamps(line, lineNumber);
            document.timestamps.push(...lineTimestamps);

            i++;
        }

        return document;
    }

    /**
     * Parse a heading line
     */
    private parseHeading(stars: string, rest: string, lineNumber: number): OrgHeading {
        const level = stars.length;
        let title = rest;
        let todoState: string | undefined;
        let priority: string | undefined;
        const tags: string[] = [];

        // Extract TODO state
        const todoMatch = rest.match(/^(\S+)\s+/);
        if (todoMatch && this.todoStates.has(todoMatch[1])) {
            todoState = todoMatch[1];
            title = rest.slice(todoMatch[0].length);
        }

        // Extract priority [#A], [#B], [#C]
        const priorityMatch = title.match(/^\[#([A-Z])\]\s+/);
        if (priorityMatch) {
            priority = priorityMatch[1];
            title = title.slice(priorityMatch[0].length);
        }

        // Extract tags :tag1:tag2:
        const tagMatch = title.match(/\s+:([^:]+(?::[^:]+)*):$/);
        if (tagMatch) {
            const tagStr = tagMatch[1];
            tags.push(...tagStr.split(':'));
            title = title.slice(0, -tagMatch[0].length);
        }

        return {
            level,
            title: title.trim(),
            todoState,
            priority,
            tags,
            lineNumber,
            properties: {},
            children: []
        };
    }

    /**
     * Parse a properties drawer
     */
    private parsePropertiesDrawer(
        lines: string[],
        startIndex: number
    ): { properties: Record<string, string>; endIndex: number } {
        const properties: Record<string, string> = {};
        let i = startIndex;

        // Skip blank lines
        while (i < lines.length && lines[i].trim() === '') {
            i++;
        }

        // Check for :PROPERTIES: drawer
        if (i < lines.length && lines[i].trim() === ':PROPERTIES:') {
            i++;
            while (i < lines.length) {
                const line = lines[i].trim();
                if (line === ':END:') {
                    i++;
                    break;
                }
                const propMatch = line.match(/^:(\S+):\s*(.*)$/);
                if (propMatch) {
                    properties[propMatch[1]] = propMatch[2];
                }
                i++;
            }
        }

        return { properties, endIndex: i - 1 };
    }

    /**
     * Parse a source block
     */
    private parseSourceBlock(
        lines: string[],
        startIndex: number,
        language: string,
        headerStr: string
    ): OrgSourceBlock {
        const headers = this.parseBlockHeaders(headerStr);
        const contentLines: string[] = [];
        let i = startIndex + 1;

        while (i < lines.length) {
            if (lines[i].match(/^#\+END_SRC$/i)) {
                break;
            }
            contentLines.push(lines[i]);
            i++;
        }

        return {
            language: language.toLowerCase(),
            content: contentLines.join('\n'),
            headers,
            lineNumber: startIndex + 1,
            endLineNumber: i + 1
        };
    }

    /**
     * Parse block header arguments
     */
    private parseBlockHeaders(headerStr: string): Record<string, string> {
        const headers: Record<string, string> = {};

        // Match :key value pairs
        const matches = headerStr.matchAll(/:(\S+)\s+(\S+)/g);
        for (const match of matches) {
            headers[match[1]] = match[2];
        }

        return headers;
    }

    /**
     * Parse links in a line
     */
    private parseLinks(line: string, lineNumber: number): OrgLink[] {
        const links: OrgLink[] = [];

        // Match [[link][description]] or [[link]]
        const linkRegex = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g;
        let match;

        while ((match = linkRegex.exec(line)) !== null) {
            const target = match[1];
            const description = match[2];

            // Determine link type
            let type = 'internal';
            if (target.startsWith('http://') || target.startsWith('https://')) {
                type = 'http';
            } else if (target.startsWith('file:')) {
                type = 'file';
            } else if (target.includes(':')) {
                type = target.split(':')[0];
            }

            links.push({
                type,
                target,
                description,
                lineNumber
            });
        }

        return links;
    }

    /**
     * Parse timestamps in a line
     */
    private parseTimestamps(line: string, lineNumber: number): OrgTimestamp[] {
        const timestamps: OrgTimestamp[] = [];

        // Active timestamp: <2024-01-15 Mon 10:00>
        const activeRegex = /<(\d{4}-\d{2}-\d{2})\s+\w+(?:\s+(\d{2}:\d{2}))?(?:\s+(\+\d+[dwmy]))?>/g;
        let match;

        while ((match = activeRegex.exec(line)) !== null) {
            let type: OrgTimestamp['type'] = 'active';

            // Check for SCHEDULED or DEADLINE prefix
            const beforeMatch = line.slice(0, match.index);
            if (beforeMatch.endsWith('SCHEDULED: ')) {
                type = 'scheduled';
            } else if (beforeMatch.endsWith('DEADLINE: ')) {
                type = 'deadline';
            } else if (beforeMatch.endsWith('CLOSED: ')) {
                type = 'closed';
            }

            timestamps.push({
                type,
                date: match[1],
                time: match[2],
                repeater: match[3],
                lineNumber
            });
        }

        // Inactive timestamp: [2024-01-15 Mon 10:00]
        const inactiveRegex = /\[(\d{4}-\d{2}-\d{2})\s+\w+(?:\s+(\d{2}:\d{2}))?\]/g;
        while ((match = inactiveRegex.exec(line)) !== null) {
            timestamps.push({
                type: 'inactive',
                date: match[1],
                time: match[2],
                lineNumber
            });
        }

        return timestamps;
    }

    /**
     * Add heading to tree structure
     */
    private addHeadingToTree(
        heading: OrgHeading,
        stack: OrgHeading[],
        roots: OrgHeading[]
    ): void {
        // Pop stack until we find parent level
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }

        if (stack.length === 0) {
            // Top-level heading
            roots.push(heading);
        } else {
            // Child of current stack top
            stack[stack.length - 1].children.push(heading);
        }

        // Push this heading onto stack
        stack.push(heading);
    }

    /**
     * Find all headings matching a predicate
     */
    public findHeadings(
        document: OrgDocument,
        predicate: (heading: OrgHeading) => boolean
    ): OrgHeading[] {
        const results: OrgHeading[] = [];

        const search = (headings: OrgHeading[]) => {
            for (const heading of headings) {
                if (predicate(heading)) {
                    results.push(heading);
                }
                search(heading.children);
            }
        };

        search(document.headings);
        return results;
    }

    /**
     * Find all TODO items
     */
    public findTodos(document: OrgDocument): OrgHeading[] {
        return this.findHeadings(document, h => h.todoState !== undefined);
    }

    /**
     * Find source blocks by language
     */
    public findSourceBlocks(document: OrgDocument, language?: string): OrgSourceBlock[] {
        if (!language) {
            return document.sourceBlocks;
        }
        return document.sourceBlocks.filter(b => b.language === language.toLowerCase());
    }

    /**
     * Flatten heading tree
     */
    public flattenHeadings(document: OrgDocument): OrgHeading[] {
        const results: OrgHeading[] = [];

        const flatten = (headings: OrgHeading[]) => {
            for (const heading of headings) {
                results.push(heading);
                flatten(heading.children);
            }
        };

        flatten(document.headings);
        return results;
    }
}

/**
 * Parse markdown code blocks (for markdown files)
 */
export function parseMarkdownCodeBlocks(content: string): OrgSourceBlock[] {
    const blocks: OrgSourceBlock[] = [];
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
        const match = lines[i].match(/^```(\w+)?(.*)$/);
        if (match) {
            const language = match[1] || 'text';
            const headerStr = match[2] || '';
            const contentLines: string[] = [];
            const startLine = i + 1;
            i++;

            while (i < lines.length && !lines[i].startsWith('```')) {
                contentLines.push(lines[i]);
                i++;
            }

            blocks.push({
                language: language.toLowerCase(),
                content: contentLines.join('\n'),
                headers: parseMarkdownBlockHeaders(headerStr),
                lineNumber: startLine,
                endLineNumber: i + 1
            });
        }
        i++;
    }

    return blocks;
}

/**
 * Parse markdown block headers (e.g., ```python :session main)
 */
function parseMarkdownBlockHeaders(headerStr: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const matches = headerStr.matchAll(/:(\S+)\s+(\S+)/g);
    for (const match of matches) {
        headers[match[1]] = match[2];
    }
    return headers;
}

/**
 * Extract hashtags from content
 */
export function extractHashtags(content: string): string[] {
    const hashtags = new Set<string>();
    const regex = /#(\w+)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
        hashtags.add(match[1].toLowerCase());
    }

    return Array.from(hashtags);
}

/**
 * Extract @mentions from content
 */
export function extractMentions(content: string): string[] {
    const mentions = new Set<string>();
    const regex = /@(\w+)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
        mentions.add(match[1].toLowerCase());
    }

    return Array.from(mentions);
}
