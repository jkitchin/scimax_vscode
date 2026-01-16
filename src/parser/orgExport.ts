/**
 * Core org-mode export framework
 * Provides the infrastructure for exporting org documents to various formats
 */

import type {
    OrgElement,
    OrgObject,
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    ParagraphElement,
    SrcBlockElement,
    ExampleBlockElement,
    QuoteBlockElement,
    CenterBlockElement,
    SpecialBlockElement,
    VerseBlockElement,
    LatexEnvironmentElement,
    TableElement,
    TableRowElement,
    PlainListElement,
    ItemElement,
    DrawerElement,
    KeywordElement,
    HorizontalRuleElement,
    CommentBlockElement,
    FixedWidthElement,
    FootnoteDefinitionElement,
    ExportBlockElement,
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
    FootnoteReferenceObject,
    StatisticsCookieObject,
    TargetObject,
    RadioTargetObject,
    LineBreakObject,
    PlainTextObject,
    InlineSrcBlockObject,
    InlineBabelCallObject,
    ExportSnippetObject,
    MacroObject,
    TableCellObject,
    AffiliatedKeywords,
} from './orgElementTypes';

// =============================================================================
// Export Options
// =============================================================================

/**
 * Common export options for all backends
 */
export interface ExportOptions {
    /** Document title (from #+TITLE or first headline) */
    title?: string;
    /** Document author (from #+AUTHOR) */
    author?: string;
    /** Document date (from #+DATE) */
    date?: string;
    /** Document language (from #+LANGUAGE, default: en) */
    language?: string;

    /** Export scope: full document, subtree, or visible */
    scope?: 'full' | 'subtree' | 'visible';
    /** Headline levels to include (0 = all) */
    headlineLevel?: number;
    /** Whether to include table of contents */
    toc?: boolean | number;
    /** Whether to number sections */
    sectionNumbers?: boolean;
    /** Whether to preserve line breaks in paragraphs */
    preserveBreaks?: boolean;

    /** Footnote handling */
    footnotes?: 'separate' | 'inline' | 'none';
    /** Whether to expand macros */
    expandMacros?: boolean;
    /** Whether to include timestamp exports */
    timestamps?: boolean;

    /** TODO keyword configuration */
    todoKeywords?: {
        todo: string[];
        done: string[];
    };

    /** Tags to exclude from export */
    excludeTags?: string[];
    /** Tags to select for export */
    selectTags?: string[];

    /** Custom macro definitions */
    macros?: Record<string, string | ((...args: string[]) => string)>;

    /** Export backend name (for backend-specific filtering) */
    backend?: string;
}

/**
 * Default export options
 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
    language: 'en',
    scope: 'full',
    headlineLevel: 0,
    toc: false,
    sectionNumbers: true,
    preserveBreaks: false,
    footnotes: 'separate',
    expandMacros: true,
    timestamps: true,
    todoKeywords: {
        todo: ['TODO', 'NEXT', 'WAITING'],
        done: ['DONE', 'CANCELLED'],
    },
};

// =============================================================================
// Export State
// =============================================================================

/**
 * State maintained during export
 */
export interface ExportState {
    /** Current headline level offset */
    headlineOffset: number;
    /** Collected footnotes */
    footnotes: Map<string, { definition?: OrgElement[]; references: number }>;
    /** Current footnote counter */
    footnoteCounter: number;
    /** Collected targets for internal links */
    targets: Map<string, string>;
    /** Radio targets for automatic linking */
    radioTargets: Map<string, string>;
    /** Table of contents entries */
    tocEntries: TocEntry[];
    /** Custom IDs from headlines */
    customIds: Map<string, string>;
    /** Section numbering state */
    sectionNumbers: number[];
    /** Options for the export */
    options: ExportOptions;
}

/**
 * Table of contents entry
 */
export interface TocEntry {
    level: number;
    title: string;
    id: string;
    numberLabel?: string;
}

/**
 * Create initial export state
 */
export function createExportState(options: Partial<ExportOptions> = {}): ExportState {
    return {
        headlineOffset: 0,
        footnotes: new Map(),
        footnoteCounter: 0,
        targets: new Map(),
        radioTargets: new Map(),
        tocEntries: [],
        customIds: new Map(),
        sectionNumbers: [],
        options: { ...DEFAULT_EXPORT_OPTIONS, ...options },
    };
}

// =============================================================================
// Export Backend Interface
// =============================================================================

/**
 * Interface for export backends (HTML, LaTeX, etc.)
 */
export interface ExportBackend {
    /** Backend name (e.g., 'html', 'latex') */
    name: string;

    /** Export a complete document */
    exportDocument(doc: OrgDocumentNode, options?: Partial<ExportOptions>): string;

    /** Export a single element */
    exportElement(element: OrgElement, state: ExportState): string;

    /** Export a single object (inline element) */
    exportObject(object: OrgObject, state: ExportState): string;

    /** Export affiliated keywords (caption, name, attributes) */
    exportAffiliatedKeywords?(affiliated: AffiliatedKeywords, state: ExportState): string;
}

// =============================================================================
// Export Dispatcher
// =============================================================================

/**
 * Dispatch element export to the appropriate handler
 */
export function dispatchElement(
    element: OrgElement,
    backend: ExportBackend,
    state: ExportState
): string {
    return backend.exportElement(element, state);
}

/**
 * Dispatch object export to the appropriate handler
 */
export function dispatchObject(
    object: OrgObject,
    backend: ExportBackend,
    state: ExportState
): string {
    return backend.exportObject(object, state);
}

/**
 * Export a list of elements
 */
export function exportElements(
    elements: OrgElement[],
    backend: ExportBackend,
    state: ExportState
): string {
    return elements.map(el => backend.exportElement(el, state)).join('');
}

/**
 * Export a list of objects
 */
export function exportObjects(
    objects: OrgObject[],
    backend: ExportBackend,
    state: ExportState
): string {
    return objects.map(obj => backend.exportObject(obj, state)).join('');
}

// =============================================================================
// Pre-processing Utilities
// =============================================================================

/**
 * Collect all targets and custom IDs from the document
 */
export function collectTargets(doc: OrgDocumentNode, state: ExportState): void {
    const processHeadline = (headline: HeadlineElement) => {
        // Generate an ID for this headline - must match exportHeadline
        const id = headline.properties.customId ||
            headline.properties.id ||
            generateId(headline.properties.rawValue);

        if (headline.properties.customId) {
            state.customIds.set(headline.properties.customId, id);
        }

        // Add to TOC if toc is enabled
        if (state.options.toc) {
            state.tocEntries.push({
                level: headline.properties.level,
                title: headline.properties.rawValue,
                id,
            });
        }

        // Process children
        headline.children.forEach((child) => processHeadline(child));
    };

    doc.children.forEach((headline) => processHeadline(headline));
}

/**
 * Collect all footnote definitions from the document
 */
export function collectFootnotes(doc: OrgDocumentNode, state: ExportState): void {
    const processElement = (element: OrgElement) => {
        if (element.type === 'footnote-definition') {
            const def = element as FootnoteDefinitionElement;
            const existing = state.footnotes.get(def.properties.label);
            if (existing) {
                existing.definition = def.children;
            } else {
                state.footnotes.set(def.properties.label, {
                    definition: def.children,
                    references: 0,
                });
            }
        }

        // Recursively process children
        if ('children' in element && Array.isArray(element.children)) {
            element.children.forEach(child => {
                if (isElement(child)) {
                    processElement(child);
                }
            });
        }
    };

    // Process section
    if (doc.section) {
        doc.section.children.forEach(processElement);
    }

    // Process headlines
    const processHeadline = (headline: HeadlineElement) => {
        if (headline.section) {
            headline.section.children.forEach(processElement);
        }
        headline.children.forEach(processHeadline);
    };

    doc.children.forEach(processHeadline);
}

// =============================================================================
// Type Guards
// =============================================================================

function isElement(node: unknown): node is OrgElement {
    return (
        typeof node === 'object' &&
        node !== null &&
        'type' in node &&
        'range' in node
    );
}

// =============================================================================
// Section Numbering
// =============================================================================

/**
 * Generate section number for a headline
 */
export function generateSectionNumber(level: number, state: ExportState): string {
    // Adjust the section numbers array to match the current level
    while (state.sectionNumbers.length < level) {
        state.sectionNumbers.push(0);
    }
    while (state.sectionNumbers.length > level) {
        state.sectionNumbers.pop();
    }

    // Increment the current level
    state.sectionNumbers[level - 1] = (state.sectionNumbers[level - 1] || 0) + 1;

    // Reset lower levels
    for (let i = level; i < state.sectionNumbers.length; i++) {
        state.sectionNumbers[i] = 0;
    }

    return state.sectionNumbers.slice(0, level).join('.');
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Escape special characters for the target format
 */
export function escapeString(str: string, format: 'html' | 'latex'): string {
    if (format === 'html') {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    } else if (format === 'latex') {
        // Use a placeholder for backslashes first to avoid double escaping
        const BACKSLASH_PLACEHOLDER = '\x00BACKSLASH\x00';
        return str
            .replace(/\\/g, BACKSLASH_PLACEHOLDER)
            .replace(/[&%$#_{}]/g, '\\$&')
            .replace(/\^/g, '\\textasciicircum{}')
            .replace(/~/g, '\\textasciitilde{}')
            .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\textbackslash{}');
    }
    return str;
}

/**
 * Convert org-mode timestamp to ISO date string
 */
export function timestampToIso(ts: TimestampObject): string {
    const { yearStart, monthStart, dayStart, hourStart, minuteStart } = ts.properties;
    const dateStr = `${yearStart}-${String(monthStart).padStart(2, '0')}-${String(dayStart).padStart(2, '0')}`;

    if (hourStart !== undefined && minuteStart !== undefined) {
        return `${dateStr}T${String(hourStart).padStart(2, '0')}:${String(minuteStart).padStart(2, '0')}`;
    }

    return dateStr;
}

/**
 * Generate a unique ID from text
 */
export function generateId(text: string, prefix = 'org'): string {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);

    return `${prefix}-${slug || 'section'}`;
}

/**
 * Expand a macro with given arguments
 */
export function expandMacro(
    key: string,
    args: string[],
    macros: Record<string, string | ((...args: string[]) => string)>
): string {
    const macro = macros[key];
    if (!macro) {
        return `{{{${key}(${args.join(',')})}}}`;
    }

    if (typeof macro === 'function') {
        return macro(...args);
    }

    // Replace $1, $2, etc. with arguments
    let result = macro;
    args.forEach((arg, i) => {
        result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), arg);
    });

    return result;
}

/**
 * Check if an element should be exported based on tags
 */
export function shouldExport(
    element: HeadlineElement,
    options: ExportOptions
): boolean {
    const tags = element.properties.tags;

    // Check for exclusion
    if (options.excludeTags && options.excludeTags.length > 0) {
        if (tags.some(tag => options.excludeTags!.includes(tag))) {
            return false;
        }
    }

    // Check for selection (if specified, only export matching)
    if (options.selectTags && options.selectTags.length > 0) {
        if (!tags.some(tag => options.selectTags!.includes(tag))) {
            return false;
        }
    }

    return true;
}

// =============================================================================
// Built-in Macros
// =============================================================================

/**
 * Standard org-mode macros
 */
export const BUILTIN_MACROS: Record<string, string | ((...args: string[]) => string)> = {
    // Date/time macros
    'date': () => new Date().toISOString().split('T')[0],
    'time': () => new Date().toTimeString().split(' ')[0],
    'modification-time': (format = '%Y-%m-%d') => {
        // Simplified - would need file info for real implementation
        return new Date().toISOString().split('T')[0];
    },

    // Property access (simplified)
    'property': (prop: string) => `[PROPERTY:${prop}]`,

    // Input prompt (not applicable in static export)
    'input': (prompt: string) => `[INPUT:${prompt}]`,

    // Include (placeholder - needs file reading)
    'include': (file: string) => `[INCLUDE:${file}]`,
};

// =============================================================================
// Export API
// =============================================================================

/**
 * Export a document using the specified backend
 */
export function exportDocument(
    doc: OrgDocumentNode,
    backend: ExportBackend,
    options?: Partial<ExportOptions>
): string {
    return backend.exportDocument(doc, options);
}

/**
 * Export a partial document (e.g., a subtree)
 */
export function exportSubtree(
    headline: HeadlineElement,
    backend: ExportBackend,
    options?: Partial<ExportOptions>
): string {
    const state = createExportState({ ...options, scope: 'subtree' });
    return backend.exportElement(headline, state);
}

/**
 * Simple export to LaTeX for live preview
 * This is a simplified conversion that wraps org content in a LaTeX document
 */
export function exportToLatex(
    orgText: string,
    options?: { toc?: boolean; standalone?: boolean; syntexEnabled?: boolean }
): string {
    const lines = orgText.split('\n');
    const latexLines: string[] = [];
    const opts = { toc: false, standalone: true, syntexEnabled: false, ...options };

    // Extract document settings
    let title = '';
    let author = '';
    let documentClass = 'article';
    const packages: string[] = [];
    const headerLines: string[] = [];

    for (const line of lines) {
        const titleMatch = line.match(/^#\+TITLE:\s*(.*)$/i);
        const authorMatch = line.match(/^#\+AUTHOR:\s*(.*)$/i);
        const classMatch = line.match(/^#\+LATEX_CLASS:\s*(.*)$/i);
        const headerMatch = line.match(/^#\+LATEX_HEADER:\s*(.*)$/i);

        if (titleMatch) title = titleMatch[1];
        else if (authorMatch) author = authorMatch[1];
        else if (classMatch) documentClass = classMatch[1];
        else if (headerMatch) headerLines.push(headerMatch[1]);
    }

    if (opts.standalone) {
        latexLines.push(`\\documentclass{${documentClass}}`);
        latexLines.push('\\usepackage[utf8]{inputenc}');
        latexLines.push('\\usepackage{amsmath,amssymb,amsfonts}');
        latexLines.push('\\usepackage{graphicx}');
        latexLines.push('\\usepackage[linktocpage,pdfstartview=FitH,colorlinks,');
        latexLines.push('  linkcolor=blue,anchorcolor=blue,citecolor=blue,');
        latexLines.push('  filecolor=blue,menucolor=blue,urlcolor=blue]{hyperref}');

        for (const header of headerLines) {
            latexLines.push(header);
        }

        if (opts.syntexEnabled) {
            latexLines.push('% SyncTeX enabled');
        }

        latexLines.push('');
        if (title) latexLines.push(`\\title{${escapeString(title, 'latex')}}`);
        if (author) latexLines.push(`\\author{${escapeString(author, 'latex')}}`);
        latexLines.push('\\begin{document}');
        if (title) latexLines.push('\\maketitle');
        if (opts.toc) latexLines.push('\\tableofcontents');
        latexLines.push('');
    }

    // Process content
    let inSrcBlock = false;
    let srcBlockLang = '';
    const srcBlockContent: string[] = [];

    for (const line of lines) {
        // Skip org-mode keywords
        if (/^#\+(TITLE|AUTHOR|DATE|OPTIONS|LATEX_CLASS|LATEX_HEADER|PROPERTY|STARTUP):/i.test(line)) {
            continue;
        }

        // Handle headings
        const headingMatch = line.match(/^(\*+)\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2]
                .replace(/\s*:\w+:$/g, '') // Remove tags
                .replace(/^\s*(TODO|DONE|WAITING|CANCELLED)\s+/i, ''); // Remove TODO keywords

            const sectionCmd = level === 1 ? 'section' :
                               level === 2 ? 'subsection' :
                               level === 3 ? 'subsubsection' :
                               'paragraph';
            latexLines.push(`\\${sectionCmd}{${escapeString(text, 'latex')}}`);
            continue;
        }

        // Handle source blocks
        if (/^#\+BEGIN_SRC\s+(\w+)/i.test(line)) {
            const match = line.match(/^#\+BEGIN_SRC\s+(\w+)/i);
            srcBlockLang = match ? match[1] : 'text';
            inSrcBlock = true;
            continue;
        }
        if (/^#\+END_SRC/i.test(line)) {
            latexLines.push('\\begin{verbatim}');
            latexLines.push(...srcBlockContent);
            latexLines.push('\\end{verbatim}');
            srcBlockContent.length = 0;
            inSrcBlock = false;
            continue;
        }
        if (inSrcBlock) {
            srcBlockContent.push(line);
            continue;
        }

        // Handle other blocks
        if (/^#\+BEGIN_(QUOTE|VERSE)/i.test(line)) {
            latexLines.push('\\begin{quote}');
            continue;
        }
        if (/^#\+END_(QUOTE|VERSE)/i.test(line)) {
            latexLines.push('\\end{quote}');
            continue;
        }

        // Handle LaTeX fragments (keep as-is)
        if (/^\s*\\begin\{/.test(line) || /^\s*\\end\{/.test(line) ||
            /^\\\[/.test(line) || /^\\\]/.test(line)) {
            latexLines.push(line);
            continue;
        }

        // Handle inline math - keep $ and \( \) as-is
        // Handle regular text with markup conversion
        let processedLine = line;

        // Bold: *text* -> \textbf{text}
        processedLine = processedLine.replace(/\*([^*]+)\*/g, '\\textbf{$1}');

        // Italic: /text/ -> \textit{text} (but not in URLs)
        processedLine = processedLine.replace(/(?<![:/])\/([^/]+)\//g, '\\textit{$1}');

        // Underline: _text_ -> \underline{text}
        processedLine = processedLine.replace(/_([^_]+)_/g, '\\underline{$1}');

        // Code: =text= or ~text~ -> \texttt{text}
        processedLine = processedLine.replace(/[=~]([^=~]+)[=~]/g, '\\texttt{$1}');

        // Links: [[url][desc]] -> \href{url}{desc}
        processedLine = processedLine.replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, '\\href{$1}{$2}');
        processedLine = processedLine.replace(/\[\[([^\]]+)\]\]/g, '\\url{$1}');

        latexLines.push(processedLine);
    }

    if (opts.standalone) {
        latexLines.push('');
        latexLines.push('\\end{document}');
    }

    return latexLines.join('\n');
}
