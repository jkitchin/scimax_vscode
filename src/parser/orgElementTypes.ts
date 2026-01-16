/**
 * Org-mode element type definitions
 * Based on org-element.el taxonomy with TypeScript adaptations
 */

// =============================================================================
// Element Type Taxonomy
// =============================================================================

/**
 * Greater elements - can contain other elements
 */
export type GreaterElementType =
    | 'headline'
    | 'section'
    | 'plain-list'
    | 'item'
    | 'property-drawer'
    | 'drawer'
    | 'center-block'
    | 'quote-block'
    | 'special-block'
    | 'dynamic-block'
    | 'footnote-definition'
    | 'inlinetask';

/**
 * Lesser elements - cannot contain other elements, only objects
 */
export type LesserElementType =
    | 'babel-call'
    | 'clock'
    | 'comment'
    | 'comment-block'
    | 'diary-sexp'
    | 'example-block'
    | 'export-block'
    | 'fixed-width'
    | 'horizontal-rule'
    | 'keyword'
    | 'latex-environment'
    | 'node-property'
    | 'paragraph'
    | 'planning'
    | 'src-block'
    | 'table'
    | 'table-row'
    | 'verse-block';

/**
 * All element types
 */
export type ElementType = GreaterElementType | LesserElementType;

/**
 * Object types - inline, within text
 */
export type ObjectType =
    | 'bold'
    | 'code'
    | 'command'  // Non-standard: Emacs-style `command' markup
    | 'entity'
    | 'export-snippet'
    | 'footnote-reference'
    | 'inline-babel-call'
    | 'inline-src-block'
    | 'italic'
    | 'latex-fragment'
    | 'line-break'
    | 'link'
    | 'macro'
    | 'radio-target'
    | 'statistics-cookie'
    | 'strike-through'
    | 'subscript'
    | 'superscript'
    | 'table-cell'
    | 'target'
    | 'timestamp'
    | 'underline'
    | 'verbatim'
    | 'plain-text';

// =============================================================================
// Position and Range
// =============================================================================

/**
 * Character offset range in the document
 */
export interface OrgRange {
    /** Start character offset (0-indexed, inclusive) */
    start: number;
    /** End character offset (0-indexed, exclusive) */
    end: number;
}

/**
 * Line and column position for editor integration
 */
export interface OrgPosition {
    /** Line number (0-indexed) */
    line: number;
    /** Column number (0-indexed) */
    column: number;
}

/**
 * Source location with line, column, and offset
 */
export interface SourceLocation {
    /** Line number (0-indexed) */
    line: number;
    /** Column number (0-indexed) */
    column: number;
    /** Character offset (0-indexed) */
    offset: number;
}

/**
 * Position span from start to end
 */
export interface SourcePosition {
    /** Start position */
    start: SourceLocation;
    /** End position */
    end: SourceLocation;
}

// =============================================================================
// Affiliated Keywords
// =============================================================================

/**
 * Affiliated keywords that can be attached to elements
 * (#+CAPTION, #+NAME, #+ATTR_*, etc.)
 */
export interface AffiliatedKeywords {
    /** Caption text, or [short, long] for short caption syntax */
    caption?: string | [string, string];
    /** Name for cross-references (#+NAME:) */
    name?: string;
    /** Backend-specific attributes (#+ATTR_LATEX, #+ATTR_HTML, etc.) */
    attr: {
        latex?: Record<string, string>;
        html?: Record<string, string>;
        odt?: Record<string, string>;
        [backend: string]: Record<string, string> | undefined;
    };
    /** Results keywords for Babel */
    results?: string;
    /** Header arguments for Babel (#+HEADER:) */
    header?: string[];
    /** Plot options (#+PLOT:) */
    plot?: string;
}

// =============================================================================
// Base Node Types
// =============================================================================

/**
 * Base interface for all org nodes (elements and objects)
 */
export interface OrgNode {
    /** The type of this node */
    type: ElementType | ObjectType;
    /** Character offset range in the source document */
    range: OrgRange;
    /** Line/column position in the source document (populated by addPositionsToDocument) */
    position?: SourcePosition;
    /** Number of trailing blank lines/spaces */
    postBlank: number;
}

/**
 * Base interface for elements (greater and lesser)
 */
export interface OrgElement extends OrgNode {
    type: ElementType;
    /** Affiliated keywords attached to this element */
    affiliated?: AffiliatedKeywords;
    /** Range of the element's contents (excluding markup) */
    contentsRange?: OrgRange;
    /** Child elements or objects (for greater elements and elements with inline content) */
    children?: (OrgElement | OrgObject)[];
}

/**
 * Base interface for objects (inline elements)
 */
export interface OrgObject extends OrgNode {
    type: ObjectType;
    /** Child objects (for nested markup like *bold /italic/*) */
    children?: OrgObject[];
}

// =============================================================================
// Specific Element Types
// =============================================================================

/**
 * Headline element
 */
export interface HeadlineElement extends OrgElement {
    type: 'headline';
    properties: {
        /** Heading level (1-N) */
        level: number;
        /** Raw title text (unparsed) */
        rawValue: string;
        /** Parsed title objects */
        title?: OrgObject[];
        /** TODO keyword if present */
        todoKeyword?: string;
        /** TODO type: 'todo' or 'done' */
        todoType?: 'todo' | 'done';
        /** Priority character (A, B, C, etc.) */
        priority?: string;
        /** Tags on this headline */
        tags: string[];
        /** Archived? (has :ARCHIVE: tag) */
        archivedp: boolean;
        /** Commented? (starts with COMMENT) */
        commentedp: boolean;
        /** Footnote section? */
        footnoteSection: boolean;
        /** CUSTOM_ID property if set */
        customId?: string;
        /** ID property if set */
        id?: string;
        /** CATEGORY property if set */
        category?: string;
        /** EFFORT property if set */
        effort?: string;
        /** Line number (1-indexed) for legacy compatibility */
        lineNumber: number;
    };
    /** Planning info (SCHEDULED, DEADLINE, CLOSED) */
    planning?: PlanningElement;
    /** Properties drawer */
    propertiesDrawer?: Record<string, string>;
    /** Section content */
    section?: SectionElement;
    /** Child headlines */
    children: HeadlineElement[];
}

/**
 * Section element (content between headlines)
 */
export interface SectionElement extends OrgElement {
    type: 'section';
    /** Child elements in this section */
    children: OrgElement[];
}

/**
 * Planning element (SCHEDULED, DEADLINE, CLOSED line)
 */
export interface PlanningElement extends OrgElement {
    type: 'planning';
    properties: {
        scheduled?: TimestampObject;
        deadline?: TimestampObject;
        closed?: TimestampObject;
    };
}

/**
 * Clock element (CLOCK: line)
 */
export interface ClockElement extends OrgElement {
    type: 'clock';
    properties: {
        /** Start timestamp */
        start: TimestampObject;
        /** End timestamp (if clocked out) */
        end?: TimestampObject;
        /** Duration string (e.g., "1:30") */
        duration?: string;
        /** Status: 'running' or 'closed' */
        status: 'running' | 'closed';
    };
}

/**
 * Source block element
 */
export interface SrcBlockElement extends OrgElement {
    type: 'src-block';
    properties: {
        /** Programming language */
        language: string;
        /** Block content (code) */
        value: string;
        /** Header arguments as string */
        parameters?: string;
        /** Parsed header arguments */
        headers: Record<string, string>;
        /** Line number of #+BEGIN_SRC */
        lineNumber: number;
        /** Line number of #+END_SRC */
        endLineNumber: number;
        /** Whether to preserve indentation */
        preserveIndent?: boolean;
        /** Number of columns to remove from indentation */
        indentWidth?: number;
    };
}

/**
 * Example block element
 */
export interface ExampleBlockElement extends OrgElement {
    type: 'example-block';
    properties: {
        value: string;
        switches?: string;
    };
}

/**
 * Export block element
 */
export interface ExportBlockElement extends OrgElement {
    type: 'export-block';
    properties: {
        /** Export backend (html, latex, etc.) */
        backend: string;
        /** Block content */
        value: string;
    };
}

/**
 * Quote block element
 */
export interface QuoteBlockElement extends OrgElement {
    type: 'quote-block';
    children: OrgElement[];
}

/**
 * Center block element
 */
export interface CenterBlockElement extends OrgElement {
    type: 'center-block';
    children: OrgElement[];
}

/**
 * Special block element (#+BEGIN_foo ... #+END_foo)
 */
export interface SpecialBlockElement extends OrgElement {
    type: 'special-block';
    properties: {
        /** Block type (the 'foo' in #+BEGIN_foo) */
        blockType: string;
    };
    children: OrgElement[];
}

/**
 * Verse block element
 */
export interface VerseBlockElement extends OrgElement {
    type: 'verse-block';
    properties: {
        value: string;
    };
}

/**
 * LaTeX environment element
 */
export interface LatexEnvironmentElement extends OrgElement {
    type: 'latex-environment';
    properties: {
        /** Environment name (equation, align, etc.) */
        name: string;
        /** Full content including \begin...\end */
        value: string;
        /** Optional arguments [options] */
        options?: string;
    };
}

/**
 * Paragraph element
 */
export interface ParagraphElement extends OrgElement {
    type: 'paragraph';
    /** Parsed inline objects */
    children: OrgObject[];
}

/**
 * Table element
 */
export interface TableElement extends OrgElement {
    type: 'table';
    properties: {
        /** Table type: 'org' or 'table.el' */
        tableType: 'org' | 'table.el';
        /** For table.el tables, raw content */
        value?: string;
    };
    /** Table rows */
    children: TableRowElement[];
}

/**
 * Table row element
 */
export interface TableRowElement extends OrgElement {
    type: 'table-row';
    properties: {
        /** Row type: 'standard' (data) or 'rule' (horizontal line) */
        rowType: 'standard' | 'rule';
    };
    /** Table cells (only for standard rows) */
    children: TableCellObject[];
}

/**
 * Plain list element
 */
export interface PlainListElement extends OrgElement {
    type: 'plain-list';
    properties: {
        /** List type */
        listType: 'ordered' | 'unordered' | 'descriptive';
    };
    /** List items */
    children: ItemElement[];
}

/**
 * List item element
 */
export interface ItemElement extends OrgElement {
    type: 'item';
    properties: {
        /** Bullet or counter */
        bullet: string;
        /** Counter for ordered lists */
        counter?: number;
        /** Checkbox state */
        checkbox?: 'on' | 'off' | 'trans';
        /** Tag for descriptive lists */
        tag?: OrgObject[];
    };
    /** Item content */
    children: OrgElement[];
}

/**
 * Drawer element
 */
export interface DrawerElement extends OrgElement {
    type: 'drawer';
    properties: {
        /** Drawer name */
        name: string;
    };
    children: OrgElement[];
}

/**
 * Property drawer element
 */
export interface PropertyDrawerElement extends OrgElement {
    type: 'property-drawer';
    /** Node properties */
    children: NodePropertyElement[];
}

/**
 * Node property element (single property in drawer)
 */
export interface NodePropertyElement extends OrgElement {
    type: 'node-property';
    properties: {
        key: string;
        value: string;
    };
}

/**
 * Keyword element (#+KEY: value)
 */
export interface KeywordElement extends OrgElement {
    type: 'keyword';
    properties: {
        key: string;
        value: string;
    };
}

/**
 * Babel call element (#+CALL:)
 */
export interface BabelCallElement extends OrgElement {
    type: 'babel-call';
    properties: {
        /** Name of code block to call */
        call: string;
        /** Inside header arguments */
        insideHeader?: string;
        /** Arguments */
        arguments?: string;
        /** End header arguments */
        endHeader?: string;
    };
}

/**
 * Horizontal rule element
 */
export interface HorizontalRuleElement extends OrgElement {
    type: 'horizontal-rule';
}

/**
 * Comment element (single # line)
 */
export interface CommentElement extends OrgElement {
    type: 'comment';
    properties: {
        value: string;
    };
}

/**
 * Comment block element
 */
export interface CommentBlockElement extends OrgElement {
    type: 'comment-block';
    properties: {
        value: string;
    };
}

/**
 * Fixed width element (: prefix lines)
 */
export interface FixedWidthElement extends OrgElement {
    type: 'fixed-width';
    properties: {
        value: string;
    };
}

/**
 * Footnote definition element
 */
export interface FootnoteDefinitionElement extends OrgElement {
    type: 'footnote-definition';
    properties: {
        /** Footnote label */
        label: string;
    };
    children: OrgElement[];
}

/**
 * Dynamic block element (#+BEGIN: name params ... #+END:)
 */
export interface DynamicBlockElement extends OrgElement {
    type: 'dynamic-block';
    properties: {
        /** Block name (e.g., 'clocktable', 'columnview') */
        name: string;
        /** Arguments/parameters string */
        arguments?: string;
    };
    children: OrgElement[];
}

/**
 * Inline task element (deeply nested headline treated as inline)
 * In org-mode, headlines with level >= org-inlinetask-min-level (default 15)
 */
export interface InlinetaskElement extends OrgElement {
    type: 'inlinetask';
    properties: {
        /** Heading level (typically 15+) */
        level: number;
        /** Raw title text */
        rawValue: string;
        /** Parsed title objects */
        title?: OrgObject[];
        /** TODO keyword if present */
        todoKeyword?: string;
        /** TODO type: 'todo' or 'done' */
        todoType?: 'todo' | 'done';
        /** Priority character */
        priority?: string;
        /** Tags */
        tags: string[];
    };
    children: OrgElement[];
}

/**
 * Diary sexp element (%%(diary-sexp) in timestamp context)
 */
export interface DiarySexpElement extends OrgElement {
    type: 'diary-sexp';
    properties: {
        /** The s-expression content */
        value: string;
    };
}

// =============================================================================
// Specific Object Types
// =============================================================================

/**
 * Bold object
 */
export interface BoldObject extends OrgObject {
    type: 'bold';
    children: OrgObject[];
}

/**
 * Italic object
 */
export interface ItalicObject extends OrgObject {
    type: 'italic';
    children: OrgObject[];
}

/**
 * Underline object
 */
export interface UnderlineObject extends OrgObject {
    type: 'underline';
    children: OrgObject[];
}

/**
 * Strike-through object
 */
export interface StrikeThroughObject extends OrgObject {
    type: 'strike-through';
    children: OrgObject[];
}

/**
 * Code object (=code=)
 */
export interface CodeObject extends OrgObject {
    type: 'code';
    properties: {
        value: string;
    };
}

/**
 * Verbatim object (~verbatim~)
 */
export interface VerbatimObject extends OrgObject {
    type: 'verbatim';
    properties: {
        value: string;
    };
}

/**
 * Command object - Emacs-style `command' markup (non-standard)
 */
export interface CommandObject extends OrgObject {
    type: 'command';
    properties: {
        value: string;
    };
}

/**
 * Plain text object
 */
export interface PlainTextObject extends OrgObject {
    type: 'plain-text';
    properties: {
        value: string;
    };
}

/**
 * Link object
 */
export interface LinkObject extends OrgObject {
    type: 'link';
    properties: {
        /** Link type (http, file, id, internal, etc.) */
        linkType: string;
        /** Raw link path */
        path: string;
        /** Link format */
        format: 'plain' | 'angle' | 'bracket';
        /** Raw link text (for bracket links) */
        rawLink?: string;
        /** Application for file links */
        application?: string;
        /** Search option for file links (::search) */
        searchOption?: string;
    };
    /** Description objects (for [[link][description]]) */
    children?: OrgObject[];
}

/**
 * Timestamp object
 */
export interface TimestampObject extends OrgObject {
    type: 'timestamp';
    properties: {
        /** Timestamp type */
        timestampType: 'active' | 'inactive' | 'active-range' | 'inactive-range' | 'diary';
        /** Raw timestamp string */
        rawValue: string;
        /** Start date components */
        yearStart: number;
        monthStart: number;
        dayStart: number;
        /** Start time (optional) */
        hourStart?: number;
        minuteStart?: number;
        /** End date components (for ranges) */
        yearEnd?: number;
        monthEnd?: number;
        dayEnd?: number;
        /** End time (for ranges) */
        hourEnd?: number;
        minuteEnd?: number;
        /** Repeater info */
        repeaterType?: '+' | '++' | '.+';
        repeaterValue?: number;
        repeaterUnit?: 'h' | 'd' | 'w' | 'm' | 'y';
        /** Warning info */
        warningType?: '-' | '--';
        warningValue?: number;
        warningUnit?: 'h' | 'd' | 'w' | 'm' | 'y';
    };
}

/**
 * Entity object (\alpha, \rightarrow, etc.)
 */
export interface EntityObject extends OrgObject {
    type: 'entity';
    properties: {
        /** Entity name without backslash */
        name: string;
        /** Whether using {} brackets (\alpha{}) */
        usesBrackets: boolean;
        /** LaTeX representation */
        latex: string;
        /** HTML representation */
        html: string;
        /** UTF-8 character */
        utf8: string;
    };
}

/**
 * LaTeX fragment object (inline math, etc.)
 */
export interface LatexFragmentObject extends OrgObject {
    type: 'latex-fragment';
    properties: {
        /** Raw LaTeX content */
        value: string;
        /** Fragment type */
        fragmentType: 'inline-math' | 'display-math' | 'command';
    };
}

/**
 * Subscript object
 */
export interface SubscriptObject extends OrgObject {
    type: 'subscript';
    properties: {
        /** Whether using braces (_{braces}) */
        usesBraces: boolean;
    };
    children: OrgObject[];
}

/**
 * Superscript object
 */
export interface SuperscriptObject extends OrgObject {
    type: 'superscript';
    properties: {
        /** Whether using braces (^{braces}) */
        usesBraces: boolean;
    };
    children: OrgObject[];
}

/**
 * Table cell object
 */
export interface TableCellObject extends OrgObject {
    type: 'table-cell';
    properties: {
        /** Raw cell content */
        value: string;
    };
    /** Parsed cell content */
    children?: OrgObject[];
}

/**
 * Footnote reference object
 */
export interface FootnoteReferenceObject extends OrgObject {
    type: 'footnote-reference';
    properties: {
        /** Footnote label */
        label?: string;
        /** Reference type */
        referenceType: 'standard' | 'inline';
    };
    /** Inline definition (for inline footnotes) */
    children?: OrgObject[];
}

/**
 * Statistics cookie object ([2/5] or [40%])
 */
export interface StatisticsCookieObject extends OrgObject {
    type: 'statistics-cookie';
    properties: {
        value: string;
    };
}

/**
 * Target object (<<target>>)
 */
export interface TargetObject extends OrgObject {
    type: 'target';
    properties: {
        value: string;
    };
}

/**
 * Radio target object (<<<radio>>>)
 */
export interface RadioTargetObject extends OrgObject {
    type: 'radio-target';
    children: OrgObject[];
}

/**
 * Line break object (\\)
 */
export interface LineBreakObject extends OrgObject {
    type: 'line-break';
}

/**
 * Inline babel call object
 */
export interface InlineBabelCallObject extends OrgObject {
    type: 'inline-babel-call';
    properties: {
        call: string;
        insideHeader?: string;
        arguments?: string;
        endHeader?: string;
    };
}

/**
 * Inline source block object
 */
export interface InlineSrcBlockObject extends OrgObject {
    type: 'inline-src-block';
    properties: {
        language: string;
        value: string;
        parameters?: string;
    };
}

/**
 * Export snippet object
 */
export interface ExportSnippetObject extends OrgObject {
    type: 'export-snippet';
    properties: {
        backend: string;
        value: string;
    };
}

/**
 * Macro object
 */
export interface MacroObject extends OrgObject {
    type: 'macro';
    properties: {
        key: string;
        args: string[];
    };
}

// =============================================================================
// Document Root
// =============================================================================

/**
 * Root document node
 */
export interface OrgDocumentNode {
    type: 'org-data';
    /** Document properties from #+PROPERTY lines */
    properties: Record<string, string>;
    /** Document keywords (#+TITLE, #+AUTHOR, etc.) - single value per key */
    keywords: Record<string, string>;
    /** Document keywords that can have multiple values (#+LATEX_HEADER, etc.) */
    keywordLists: Record<string, string[]>;
    /** Top-level section (content before first headline) */
    section?: SectionElement;
    /** Top-level headlines */
    children: HeadlineElement[];
    /** Line/column position in the source document */
    position?: SourcePosition;
}

// =============================================================================
// Object Restrictions
// =============================================================================

/**
 * Which object types can appear in which contexts
 */
export const OBJECT_RESTRICTIONS: Record<string, ObjectType[]> = {
    'bold': [
        'bold', 'code', 'entity', 'export-snippet', 'inline-babel-call',
        'inline-src-block', 'italic', 'latex-fragment', 'line-break', 'link',
        'macro', 'radio-target', 'statistics-cookie', 'strike-through',
        'subscript', 'superscript', 'target', 'timestamp', 'underline', 'verbatim'
    ],
    'italic': [
        'bold', 'code', 'entity', 'export-snippet', 'inline-babel-call',
        'inline-src-block', 'italic', 'latex-fragment', 'line-break', 'link',
        'macro', 'radio-target', 'statistics-cookie', 'strike-through',
        'subscript', 'superscript', 'target', 'timestamp', 'underline', 'verbatim'
    ],
    'underline': [
        'bold', 'code', 'entity', 'export-snippet', 'inline-babel-call',
        'inline-src-block', 'italic', 'latex-fragment', 'line-break', 'link',
        'macro', 'radio-target', 'statistics-cookie', 'strike-through',
        'subscript', 'superscript', 'target', 'timestamp', 'underline', 'verbatim'
    ],
    'strike-through': [
        'bold', 'code', 'entity', 'export-snippet', 'inline-babel-call',
        'inline-src-block', 'italic', 'latex-fragment', 'line-break', 'link',
        'macro', 'radio-target', 'statistics-cookie', 'strike-through',
        'subscript', 'superscript', 'target', 'timestamp', 'underline', 'verbatim'
    ],
    'headline': [
        'bold', 'code', 'entity', 'footnote-reference', 'inline-babel-call',
        'inline-src-block', 'italic', 'latex-fragment', 'link', 'macro',
        'radio-target', 'statistics-cookie', 'strike-through', 'subscript',
        'superscript', 'target', 'timestamp', 'underline', 'verbatim'
    ],
    'paragraph': [
        'bold', 'code', 'entity', 'export-snippet', 'footnote-reference',
        'inline-babel-call', 'inline-src-block', 'italic', 'latex-fragment',
        'line-break', 'link', 'macro', 'radio-target', 'statistics-cookie',
        'strike-through', 'subscript', 'superscript', 'target', 'timestamp',
        'underline', 'verbatim'
    ],
    'link': [
        'bold', 'code', 'entity', 'export-snippet', 'inline-babel-call',
        'inline-src-block', 'italic', 'latex-fragment', 'link', 'macro',
        'statistics-cookie', 'strike-through', 'subscript', 'superscript',
        'underline', 'verbatim'
    ],
    'table-cell': [
        'bold', 'code', 'entity', 'export-snippet', 'footnote-reference',
        'inline-babel-call', 'inline-src-block', 'italic', 'latex-fragment',
        'link', 'macro', 'radio-target', 'statistics-cookie', 'strike-through',
        'subscript', 'superscript', 'target', 'timestamp', 'underline', 'verbatim'
    ],
};

// =============================================================================
// Type Guards
// =============================================================================

export function isGreaterElement(type: ElementType): type is GreaterElementType {
    return [
        'headline', 'section', 'plain-list', 'item', 'property-drawer',
        'drawer', 'center-block', 'quote-block', 'special-block', 'dynamic-block',
        'footnote-definition', 'inlinetask'
    ].includes(type);
}

export function isLesserElement(type: ElementType): type is LesserElementType {
    return !isGreaterElement(type);
}

export function isHeadline(element: OrgElement): element is HeadlineElement {
    return element.type === 'headline';
}

export function isSrcBlock(element: OrgElement): element is SrcBlockElement {
    return element.type === 'src-block';
}

export function isTable(element: OrgElement): element is TableElement {
    return element.type === 'table';
}

export function isParagraph(element: OrgElement): element is ParagraphElement {
    return element.type === 'paragraph';
}

export function isLink(obj: OrgObject): obj is LinkObject {
    return obj.type === 'link';
}

export function isTimestamp(obj: OrgObject): obj is TimestampObject {
    return obj.type === 'timestamp';
}

export function isLatexFragment(obj: OrgObject): obj is LatexFragmentObject {
    return obj.type === 'latex-fragment';
}
