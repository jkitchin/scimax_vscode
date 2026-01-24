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
    /** Document email (from #+EMAIL) */
    email?: string;
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

    // =========================================================================
    // OPTIONS keyword flags (#+OPTIONS: key:value ...)
    // =========================================================================

    /** Include author in output (author:t/nil) */
    includeAuthor?: boolean;
    /** Include date in output (date:t/nil) */
    includeDate?: boolean;
    /** Include email in output (email:t/nil) */
    includeEmail?: boolean;
    /** Include tags in headlines (tags:t/nil/not-in-toc) */
    includeTags?: boolean | 'not-in-toc';
    /** Include TODO keywords in headlines (todo:t/nil) */
    includeTodo?: boolean;
    /** Include priority cookies in headlines (pri:t/nil) */
    includePriority?: boolean;
    /** Include timestamps (<:t/nil or timestamp:t/nil) */
    includeTimestamps?: boolean;
    /** Include creator string in postamble (creator:t/nil) */
    includeCreator?: boolean;
    /** Include footnotes (f:t/nil) */
    includeFootnotes?: boolean;
    /** Include planning info - SCHEDULED, DEADLINE (p:t/nil) */
    includePlanning?: boolean;
    /** Include CLOCK entries (c:t/nil) */
    includeClocks?: boolean;
    /** Include drawers (d:t/nil/("drawer1" "drawer2")) */
    includeDrawers?: boolean | string[];
    /** Include tables (|:t/nil) */
    includeTables?: boolean;
    /** Subscript/superscript handling (^:t/nil/{}) */
    subscripts?: boolean | 'braces';
    /** Include fixed-width sections (::t/nil) */
    fixedWidth?: boolean;
    /** Export file name override (#+EXPORT_FILE_NAME:) */
    exportFileName?: string;
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
    // OPTIONS keyword defaults (matching org-mode defaults)
    includeAuthor: true,
    includeDate: true,
    includeEmail: false,
    includeTags: true,
    includeTodo: true,
    includePriority: false,
    includeTimestamps: true,
    includeCreator: false,
    includeFootnotes: true,
    includePlanning: false,
    includeClocks: false,
    includeDrawers: false,
    includeTables: true,
    subscripts: true,
    fixedWidth: true,
    excludeTags: ['noexport'],
};

// =============================================================================
// OPTIONS Keyword Parsing
// =============================================================================

/**
 * Parse #+OPTIONS: keyword line into export options
 *
 * Supported flags:
 * - toc:t/nil/N - Table of contents (t=yes, nil=no, N=depth)
 * - num:t/nil - Section numbering
 * - H:N - Headline level limit
 * - author:t/nil - Include author
 * - date:t/nil - Include date
 * - email:t/nil - Include email
 * - tags:t/nil/not-in-toc - Include tags
 * - todo:t/nil - Include TODO keywords
 * - pri:t/nil - Include priority cookies
 * - <:t/nil or timestamp:t/nil - Include timestamps
 * - creator:t/nil - Include creator
 * - f:t/nil - Include footnotes
 * - p:t/nil - Include planning info
 * - c:t/nil - Include clocks
 * - d:t/nil/("drawer1" "drawer2") - Include drawers
 * - |:t/nil - Include tables
 * - ^:t/nil/{} - Subscript/superscript handling
 * - ::t/nil - Fixed-width sections
 * - \n:t/nil - Preserve line breaks
 */
export function parseOptionsKeyword(optionsLine: string): Partial<ExportOptions> {
    const opts: Partial<ExportOptions> = {};

    if (!optionsLine || !optionsLine.trim()) {
        return opts;
    }

    // Split on whitespace while preserving quoted strings for drawer lists
    const pairs = optionsLine.match(/\S+:\S+|d:\([^)]*\)/g) || [];

    for (const pair of pairs) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx === -1) continue;

        const key = pair.substring(0, colonIdx);
        const value = pair.substring(colonIdx + 1);

        // Helper to parse boolean value
        const toBool = (v: string): boolean =>
            v === 't' || v === 'true' || v === 'yes' || v === '1';

        switch (key) {
            // Table of contents
            case 'toc':
                if (value === 'nil' || value === 'false' || value === 'no') {
                    opts.toc = false;
                } else if (value === 't' || value === 'true' || value === 'yes') {
                    opts.toc = true;
                } else {
                    const depth = parseInt(value, 10);
                    opts.toc = !isNaN(depth) ? depth : true;
                }
                break;

            // Section numbering
            case 'num':
                opts.sectionNumbers = toBool(value);
                break;

            // Headline level limit
            case 'H':
                opts.headlineLevel = parseInt(value, 10) || 0;
                break;

            // Author
            case 'author':
                opts.includeAuthor = toBool(value);
                break;

            // Date
            case 'date':
                opts.includeDate = toBool(value);
                break;

            // Email
            case 'email':
                opts.includeEmail = toBool(value);
                break;

            // Tags
            case 'tags':
                if (value === 'not-in-toc') {
                    opts.includeTags = 'not-in-toc';
                } else {
                    opts.includeTags = toBool(value);
                }
                break;

            // TODO keywords
            case 'todo':
                opts.includeTodo = toBool(value);
                break;

            // Priority
            case 'pri':
                opts.includePriority = toBool(value);
                break;

            // Timestamps (< or timestamp)
            case '<':
            case 'timestamp':
                opts.includeTimestamps = toBool(value);
                break;

            // Creator
            case 'creator':
                opts.includeCreator = toBool(value);
                break;

            // Footnotes
            case 'f':
                opts.includeFootnotes = toBool(value);
                break;

            // Planning info
            case 'p':
                opts.includePlanning = toBool(value);
                break;

            // Clocks
            case 'c':
                opts.includeClocks = toBool(value);
                break;

            // Drawers
            case 'd':
                if (value === 'nil' || value === 'false' || value === 'no') {
                    opts.includeDrawers = false;
                } else if (value === 't' || value === 'true' || value === 'yes') {
                    opts.includeDrawers = true;
                } else if (value.startsWith('(') && value.endsWith(')')) {
                    // Parse drawer list like ("LOGBOOK" "PROPERTIES")
                    const drawerList = value.slice(1, -1)
                        .split(/\s+/)
                        .map(d => d.replace(/"/g, ''))
                        .filter(Boolean);
                    opts.includeDrawers = drawerList.length > 0 ? drawerList : false;
                }
                break;

            // Tables
            case '|':
                opts.includeTables = toBool(value);
                break;

            // Subscripts/superscripts
            case '^':
                if (value === '{}') {
                    opts.subscripts = 'braces';
                } else {
                    opts.subscripts = toBool(value);
                }
                break;

            // Fixed-width
            case ':':
                opts.fixedWidth = toBool(value);
                break;

            // Preserve line breaks
            case '\\n':
                opts.preserveBreaks = toBool(value);
                break;
        }
    }

    return opts;
}

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
    /** Skip next results block (based on :exports header of previous src block) */
    skipNextResults?: boolean;
    /** Current element's affiliated keywords (for image captions, etc.) */
    currentAffiliated?: AffiliatedKeywords;
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
// Editmark Processing
// =============================================================================

/**
 * Editmark export mode configuration
 */
export type EditmarkExportMode = 'show' | 'accept' | 'reject' | 'hide';

/**
 * Editmark patterns for matching in text
 */
const EDITMARK_PATTERNS = {
    // Universal format: @@+text+@@ @@-text-@@ @@>text<@@ @@~old|new~@@
    insertion: /@@\+([^+]*)\+@@/g,
    deletion: /@@-([^-]*)-@@/g,
    comment: /@@>([^<]*)<@@/g,
    typo: /@@~([^|]*)\|([^~]*)~@@/g,

    // CriticMarkup format: {++text++} {--text--} {>>text<<} {~~old~>new~~}
    insertionCritic: /\{\+\+([^+]*)\+\+\}/g,
    deletionCritic: /\{--([^-]*)--\}/g,
    commentCritic: /\{>>([^<]*)<<\}/g,
    typoCritic: /\{~~([^~]*)~>([^~]*)~~\}/g,

    // Bare format: @@text@@ (fallback - treated as insertion/highlight)
    // Must not start with +, -, >, ~ to avoid matching partial delimited forms
    bare: /@@(?![+\->~])([^@]+)@@/g,
};

/**
 * Check if text contains any editmarks
 * Note: We reset lastIndex before each .test() because global regexes maintain state
 */
export function hasEditmarks(text: string): boolean {
    // Reset lastIndex for all patterns before testing (global regexes maintain state)
    EDITMARK_PATTERNS.insertion.lastIndex = 0;
    EDITMARK_PATTERNS.deletion.lastIndex = 0;
    EDITMARK_PATTERNS.comment.lastIndex = 0;
    EDITMARK_PATTERNS.typo.lastIndex = 0;
    EDITMARK_PATTERNS.insertionCritic.lastIndex = 0;
    EDITMARK_PATTERNS.deletionCritic.lastIndex = 0;
    EDITMARK_PATTERNS.commentCritic.lastIndex = 0;
    EDITMARK_PATTERNS.typoCritic.lastIndex = 0;
    EDITMARK_PATTERNS.bare.lastIndex = 0;

    return (
        EDITMARK_PATTERNS.insertion.test(text) ||
        EDITMARK_PATTERNS.deletion.test(text) ||
        EDITMARK_PATTERNS.comment.test(text) ||
        EDITMARK_PATTERNS.typo.test(text) ||
        EDITMARK_PATTERNS.insertionCritic.test(text) ||
        EDITMARK_PATTERNS.deletionCritic.test(text) ||
        EDITMARK_PATTERNS.commentCritic.test(text) ||
        EDITMARK_PATTERNS.typoCritic.test(text) ||
        EDITMARK_PATTERNS.bare.test(text)
    );
}

/**
 * Helper to escape HTML special characters
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape text that's outside of HTML tags.
 * After editmark processing, we have a mix of HTML tags and raw text.
 * This function escapes only the raw text portions.
 */
function escapeNonEditmarkText(text: string): string {
    // Match HTML tags (our editmark tags) vs raw text
    // This regex captures text outside of < > pairs
    const parts: string[] = [];
    let lastIndex = 0;
    const tagRegex = /<[^>]+>/g;
    let match;

    while ((match = tagRegex.exec(text)) !== null) {
        // Escape text before this tag
        if (match.index > lastIndex) {
            parts.push(escapeHtml(text.slice(lastIndex, match.index)));
        }
        // Keep the tag as-is
        parts.push(match[0]);
        lastIndex = tagRegex.lastIndex;
    }

    // Escape remaining text after last tag
    if (lastIndex < text.length) {
        parts.push(escapeHtml(text.slice(lastIndex)));
    }

    return parts.join('');
}

/**
 * Process editmarks in text for HTML export
 *
 * IMPORTANT: This function expects RAW (unescaped) text as input.
 * It will HTML-escape the content inside editmarks and any remaining text.
 * The editmark delimiters contain special characters (>, <) that would be
 * escaped if we processed after HTML escaping.
 */
export function processEditmarksHtml(text: string, mode: EditmarkExportMode = 'show'): string {
    if (mode === 'hide') {
        // Remove all editmarks, then escape remaining text
        let result = text;
        result = result.replace(EDITMARK_PATTERNS.insertion, '');
        result = result.replace(EDITMARK_PATTERNS.deletion, '');
        result = result.replace(EDITMARK_PATTERNS.comment, '');
        result = result.replace(EDITMARK_PATTERNS.typo, '');
        result = result.replace(EDITMARK_PATTERNS.insertionCritic, '');
        result = result.replace(EDITMARK_PATTERNS.deletionCritic, '');
        result = result.replace(EDITMARK_PATTERNS.commentCritic, '');
        result = result.replace(EDITMARK_PATTERNS.typoCritic, '');
        // Bare format (must be last)
        result = result.replace(EDITMARK_PATTERNS.bare, '');
        return escapeHtml(result);
    }

    if (mode === 'accept') {
        // Accept all changes, then escape
        let result = text;
        // Insertions: keep the inserted text
        result = result.replace(EDITMARK_PATTERNS.insertion, '$1');
        result = result.replace(EDITMARK_PATTERNS.insertionCritic, '$1');
        // Deletions: remove entirely
        result = result.replace(EDITMARK_PATTERNS.deletion, '');
        result = result.replace(EDITMARK_PATTERNS.deletionCritic, '');
        // Comments: remove
        result = result.replace(EDITMARK_PATTERNS.comment, '');
        result = result.replace(EDITMARK_PATTERNS.commentCritic, '');
        // Typos: keep the new text
        result = result.replace(EDITMARK_PATTERNS.typo, '$2');
        result = result.replace(EDITMARK_PATTERNS.typoCritic, '$2');
        // Bare format: keep the text (treated as insertion)
        result = result.replace(EDITMARK_PATTERNS.bare, '$1');
        return escapeHtml(result);
    }

    if (mode === 'reject') {
        // Reject all changes, then escape
        let result = text;
        // Insertions: remove
        result = result.replace(EDITMARK_PATTERNS.insertion, '');
        result = result.replace(EDITMARK_PATTERNS.insertionCritic, '');
        // Deletions: keep the deleted text
        result = result.replace(EDITMARK_PATTERNS.deletion, '$1');
        result = result.replace(EDITMARK_PATTERNS.deletionCritic, '$1');
        // Comments: remove
        result = result.replace(EDITMARK_PATTERNS.comment, '');
        result = result.replace(EDITMARK_PATTERNS.commentCritic, '');
        // Typos: keep the old text
        result = result.replace(EDITMARK_PATTERNS.typo, '$1');
        result = result.replace(EDITMARK_PATTERNS.typoCritic, '$1');
        // Bare format: remove (treated as insertion being rejected)
        result = result.replace(EDITMARK_PATTERNS.bare, '');
        return escapeHtml(result);
    }

    // mode === 'show': Render with visual markup
    // We need to escape content inside editmarks while preserving the HTML tags
    let result = text;

    // Insertions: <ins class="editmark-ins">text</ins>
    result = result.replace(EDITMARK_PATTERNS.insertion, (_, content) =>
        `<ins class="editmark-ins">${escapeHtml(content)}</ins>`);
    result = result.replace(EDITMARK_PATTERNS.insertionCritic, (_, content) =>
        `<ins class="editmark-ins">${escapeHtml(content)}</ins>`);

    // Deletions: <del class="editmark-del">text</del>
    result = result.replace(EDITMARK_PATTERNS.deletion, (_, content) =>
        `<del class="editmark-del">${escapeHtml(content)}</del>`);
    result = result.replace(EDITMARK_PATTERNS.deletionCritic, (_, content) =>
        `<del class="editmark-del">${escapeHtml(content)}</del>`);

    // Comments: <mark class="editmark-comment">text</mark>
    result = result.replace(EDITMARK_PATTERNS.comment, (_, content) =>
        `<mark class="editmark-comment">${escapeHtml(content)}</mark>`);
    result = result.replace(EDITMARK_PATTERNS.commentCritic, (_, content) =>
        `<mark class="editmark-comment">${escapeHtml(content)}</mark>`);

    // Typos: <span class="editmark-typo"><del>old</del><ins>new</ins></span>
    result = result.replace(EDITMARK_PATTERNS.typo, (_, oldText, newText) =>
        `<span class="editmark-typo"><del>${escapeHtml(oldText)}</del><ins>${escapeHtml(newText)}</ins></span>`);
    result = result.replace(EDITMARK_PATTERNS.typoCritic, (_, oldText, newText) =>
        `<span class="editmark-typo"><del>${escapeHtml(oldText)}</del><ins>${escapeHtml(newText)}</ins></span>`);

    // Bare format: @@text@@ rendered as insertion (must be LAST to avoid matching delimited forms)
    result = result.replace(EDITMARK_PATTERNS.bare, (_, content) =>
        `<ins class="editmark-ins">${escapeHtml(content)}</ins>`);

    // Escape any remaining text that's outside HTML tags
    return escapeNonEditmarkText(result);
}

/**
 * Process editmarks in text for LaTeX export
 */
export function processEditmarksLatex(text: string, mode: EditmarkExportMode = 'show'): string {
    if (mode === 'hide') {
        let result = text;
        result = result.replace(EDITMARK_PATTERNS.insertion, '');
        result = result.replace(EDITMARK_PATTERNS.deletion, '');
        result = result.replace(EDITMARK_PATTERNS.comment, '');
        result = result.replace(EDITMARK_PATTERNS.typo, '');
        result = result.replace(EDITMARK_PATTERNS.insertionCritic, '');
        result = result.replace(EDITMARK_PATTERNS.deletionCritic, '');
        result = result.replace(EDITMARK_PATTERNS.commentCritic, '');
        result = result.replace(EDITMARK_PATTERNS.typoCritic, '');
        // Bare format (must be last)
        result = result.replace(EDITMARK_PATTERNS.bare, '');
        return result;
    }

    if (mode === 'accept') {
        let result = text;
        result = result.replace(EDITMARK_PATTERNS.insertion, '$1');
        result = result.replace(EDITMARK_PATTERNS.insertionCritic, '$1');
        result = result.replace(EDITMARK_PATTERNS.deletion, '');
        result = result.replace(EDITMARK_PATTERNS.deletionCritic, '');
        result = result.replace(EDITMARK_PATTERNS.comment, '');
        result = result.replace(EDITMARK_PATTERNS.commentCritic, '');
        result = result.replace(EDITMARK_PATTERNS.typo, '$2');
        result = result.replace(EDITMARK_PATTERNS.typoCritic, '$2');
        // Bare format: keep the text (treated as insertion)
        result = result.replace(EDITMARK_PATTERNS.bare, '$1');
        return result;
    }

    if (mode === 'reject') {
        let result = text;
        result = result.replace(EDITMARK_PATTERNS.insertion, '');
        result = result.replace(EDITMARK_PATTERNS.insertionCritic, '');
        result = result.replace(EDITMARK_PATTERNS.deletion, '$1');
        result = result.replace(EDITMARK_PATTERNS.deletionCritic, '$1');
        result = result.replace(EDITMARK_PATTERNS.comment, '');
        result = result.replace(EDITMARK_PATTERNS.commentCritic, '');
        result = result.replace(EDITMARK_PATTERNS.typo, '$1');
        result = result.replace(EDITMARK_PATTERNS.typoCritic, '$1');
        // Bare format: remove (treated as insertion being rejected)
        result = result.replace(EDITMARK_PATTERNS.bare, '');
        return result;
    }

    // mode === 'show': Render with LaTeX markup
    let result = text;

    // Insertions: \editins{text}
    result = result.replace(EDITMARK_PATTERNS.insertion, '\\editins{$1}');
    result = result.replace(EDITMARK_PATTERNS.insertionCritic, '\\editins{$1}');

    // Deletions: \editdel{text}
    result = result.replace(EDITMARK_PATTERNS.deletion, '\\editdel{$1}');
    result = result.replace(EDITMARK_PATTERNS.deletionCritic, '\\editdel{$1}');

    // Comments: \editcomment{text}
    result = result.replace(EDITMARK_PATTERNS.comment, '\\editcomment{$1}');
    result = result.replace(EDITMARK_PATTERNS.commentCritic, '\\editcomment{$1}');

    // Typos: \edittypo{old}{new}
    result = result.replace(EDITMARK_PATTERNS.typo, '\\edittypo{$1}{$2}');
    result = result.replace(EDITMARK_PATTERNS.typoCritic, '\\edittypo{$1}{$2}');

    // Bare format: @@text@@ rendered as insertion (must be LAST)
    result = result.replace(EDITMARK_PATTERNS.bare, '\\editins{$1}');

    return result;
}

/**
 * CSS styles for editmarks in HTML export
 */
export const EDITMARK_CSS = `
/* Editmark Styles */
.editmark-ins {
    background-color: #d4edda;
    color: #155724;
    text-decoration: none;
    padding: 0 2px;
    border-radius: 2px;
}
.editmark-del {
    background-color: #f8d7da;
    color: #721c24;
    text-decoration: line-through;
    padding: 0 2px;
    border-radius: 2px;
}
.editmark-comment {
    background-color: #fff3cd;
    color: #856404;
    font-style: italic;
    padding: 0 2px;
    border-radius: 2px;
}
.editmark-typo {
    padding: 0 2px;
}
.editmark-typo del {
    background-color: #f8d7da;
    color: #721c24;
    text-decoration: line-through;
    margin-right: 2px;
}
.editmark-typo ins {
    background-color: #d4edda;
    color: #155724;
    text-decoration: none;
}
`;

/**
 * LaTeX preamble for editmarks
 */
export const EDITMARK_LATEX_PREAMBLE = `
% Editmark commands
\\usepackage{xcolor}
\\usepackage{ulem}
\\normalem  % Prevent ulem from changing \\emph
\\newcommand{\\editins}[1]{\\textcolor{green!40!black}{\\uline{#1}}}
\\newcommand{\\editdel}[1]{\\textcolor{red!70!black}{\\sout{#1}}}
\\newcommand{\\editcomment}[1]{\\textcolor{orange!80!black}{[\\textit{#1}]}}
\\newcommand{\\edittypo}[2]{\\textcolor{gray}{\\sout{#1}}\\editins{#2}}
`;

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
    options?: { toc?: boolean; standalone?: boolean; syntexEnabled?: boolean; editmarkMode?: EditmarkExportMode }
): string {
    const lines = orgText.split('\n');
    const latexLines: string[] = [];
    const opts = { toc: false, standalone: true, syntexEnabled: false, editmarkMode: 'show' as EditmarkExportMode, ...options };

    // Check if document contains editmarks (for preamble)
    const documentHasEditmarks = hasEditmarks(orgText);

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

        // Add editmark preamble if needed and mode is 'show'
        if (documentHasEditmarks && opts.editmarkMode === 'show') {
            latexLines.push(EDITMARK_LATEX_PREAMBLE);
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

        // Process editmarks
        processedLine = processEditmarksLatex(processedLine, opts.editmarkMode);

        latexLines.push(processedLine);
    }

    if (opts.standalone) {
        latexLines.push('');
        latexLines.push('\\end{document}');
    }

    return latexLines.join('\n');
}
