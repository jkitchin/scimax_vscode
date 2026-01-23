/**
 * Org-mode interpreter - converts AST back to org-mode text
 * Provides round-trip capability: parse -> modify -> serialize
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
    PropertyDrawerElement,
    KeywordElement,
    HorizontalRuleElement,
    CommentElement,
    CommentBlockElement,
    FixedWidthElement,
    FootnoteDefinitionElement,
    ExportBlockElement,
    BabelCallElement,
    ClockElement,
    PlanningElement,
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
import { serializeAffiliatedKeywords } from './orgAffiliatedKeywords';

// =============================================================================
// Interpreter Options
// =============================================================================

export interface InterpreterOptions {
    /** Indentation string (default: 2 spaces) */
    indent?: string;
    /** Line ending (default: \n) */
    lineEnding?: string;
    /** Preserve original formatting where possible */
    preserveFormatting?: boolean;
    /** Use UTF-8 for entities (vs LaTeX escapes) */
    useUtf8Entities?: boolean;
}

const DEFAULT_OPTIONS: InterpreterOptions = {
    indent: '  ',
    lineEnding: '\n',
    preserveFormatting: false,
    useUtf8Entities: false,
};

// =============================================================================
// Main Interpreter
// =============================================================================

/**
 * Convert an org document AST back to text
 */
export function interpret(
    doc: OrgDocumentNode,
    options?: Partial<InterpreterOptions>
): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const parts: string[] = [];

    // Document keywords
    for (const [key, value] of Object.entries(doc.keywords)) {
        parts.push(`#+${key}: ${value}`);
    }

    if (Object.keys(doc.keywords).length > 0) {
        parts.push('');
    }

    // Document properties
    if (Object.keys(doc.properties).length > 0) {
        parts.push('#+PROPERTY:');
        for (const [key, value] of Object.entries(doc.properties)) {
            parts.push(`#+PROPERTY: ${key} ${value}`);
        }
        parts.push('');
    }

    // Preamble section
    if (doc.section) {
        const sectionText = interpretSection(doc.section, opts);
        if (sectionText.trim()) {
            parts.push(sectionText);
        }
    }

    // Headlines
    for (const headline of doc.children) {
        parts.push(interpretHeadline(headline, opts));
    }

    return parts.join(opts.lineEnding!);
}

/**
 * Interpret a single element to text
 */
export function interpretElement(
    element: OrgElement,
    options?: Partial<InterpreterOptions>
): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Handle affiliated keywords
    let prefix = '';
    if (element.affiliated) {
        const affLines = serializeAffiliatedKeywords(element.affiliated);
        if (affLines.length > 0) {
            prefix = affLines.join(opts.lineEnding!) + opts.lineEnding;
        }
    }

    return prefix + interpretElementContent(element, opts);
}

/**
 * Interpret element content without affiliated keywords
 */
function interpretElementContent(
    element: OrgElement,
    opts: InterpreterOptions
): string {
    switch (element.type) {
        case 'headline':
            return interpretHeadline(element as HeadlineElement, opts);
        case 'section':
            return interpretSection(element as SectionElement, opts);
        case 'paragraph':
            return interpretParagraph(element as ParagraphElement, opts);
        case 'src-block':
            return interpretSrcBlock(element as SrcBlockElement, opts);
        case 'example-block':
            return interpretExampleBlock(element as ExampleBlockElement, opts);
        case 'quote-block':
            return interpretQuoteBlock(element as QuoteBlockElement, opts);
        case 'center-block':
            return interpretCenterBlock(element as CenterBlockElement, opts);
        case 'special-block':
            return interpretSpecialBlock(element as SpecialBlockElement, opts);
        case 'verse-block':
            return interpretVerseBlock(element as VerseBlockElement, opts);
        case 'latex-environment':
            return interpretLatexEnvironment(element as LatexEnvironmentElement, opts);
        case 'table':
            return interpretTable(element as TableElement, opts);
        case 'plain-list':
            return interpretPlainList(element as PlainListElement, opts);
        case 'drawer':
            return interpretDrawer(element as DrawerElement, opts);
        case 'property-drawer':
            return interpretPropertyDrawer(element as PropertyDrawerElement, opts);
        case 'keyword':
            return interpretKeyword(element as KeywordElement, opts);
        case 'horizontal-rule':
            return '-----';
        case 'comment':
            return interpretComment(element as CommentElement, opts);
        case 'comment-block':
            return interpretCommentBlock(element as CommentBlockElement, opts);
        case 'fixed-width':
            return interpretFixedWidth(element as FixedWidthElement, opts);
        case 'footnote-definition':
            return interpretFootnoteDefinition(element as FootnoteDefinitionElement, opts);
        case 'export-block':
            return interpretExportBlock(element as ExportBlockElement, opts);
        case 'babel-call':
            return interpretBabelCall(element as BabelCallElement, opts);
        case 'clock':
            return interpretClock(element as ClockElement, opts);
        case 'planning':
            return interpretPlanning(element as PlanningElement, opts);
        default:
            return `# Unknown element: ${element.type}`;
    }
}

/**
 * Interpret a single object to text
 */
export function interpretObject(
    object: OrgObject,
    options?: Partial<InterpreterOptions>
): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    return interpretObjectContent(object, opts);
}

/**
 * Interpret object content
 */
function interpretObjectContent(
    object: OrgObject,
    opts: InterpreterOptions
): string {
    switch (object.type) {
        case 'bold':
            return interpretBold(object as BoldObject, opts);
        case 'italic':
            return interpretItalic(object as ItalicObject, opts);
        case 'underline':
            return interpretUnderline(object as UnderlineObject, opts);
        case 'strike-through':
            return interpretStrikeThrough(object as StrikeThroughObject, opts);
        case 'code':
            return interpretCode(object as CodeObject, opts);
        case 'verbatim':
            return interpretVerbatim(object as VerbatimObject, opts);
        case 'link':
            return interpretLink(object as LinkObject, opts);
        case 'timestamp':
            return interpretTimestamp(object as TimestampObject, opts);
        case 'entity':
            return interpretEntity(object as EntityObject, opts);
        case 'latex-fragment':
            return interpretLatexFragment(object as LatexFragmentObject, opts);
        case 'subscript':
            return interpretSubscript(object as SubscriptObject, opts);
        case 'superscript':
            return interpretSuperscript(object as SuperscriptObject, opts);
        case 'footnote-reference':
            return interpretFootnoteReference(object as FootnoteReferenceObject, opts);
        case 'statistics-cookie':
            return (object as StatisticsCookieObject).properties.value;
        case 'target':
            return `<<${(object as TargetObject).properties.value}>>`;
        case 'radio-target':
            return interpretRadioTarget(object as RadioTargetObject, opts);
        case 'line-break':
            return '\\\\';
        case 'plain-text':
            return (object as PlainTextObject).properties.value;
        case 'inline-src-block':
            return interpretInlineSrcBlock(object as InlineSrcBlockObject, opts);
        case 'inline-babel-call':
            return interpretInlineBabelCall(object as InlineBabelCallObject, opts);
        case 'export-snippet':
            return interpretExportSnippet(object as ExportSnippetObject, opts);
        case 'macro':
            return interpretMacro(object as MacroObject, opts);
        case 'table-cell':
            return interpretTableCell(object as TableCellObject, opts);
        default:
            return '';
    }
}

/**
 * Interpret an array of objects
 */
function interpretObjects(objects: OrgObject[], opts: InterpreterOptions): string {
    return objects.map(obj => interpretObjectContent(obj, opts)).join('');
}

// =============================================================================
// Element Interpreters
// =============================================================================

function interpretHeadline(headline: HeadlineElement, opts: InterpreterOptions): string {
    const parts: string[] = [];

    // Stars
    const stars = '*'.repeat(headline.properties.level);

    // Build title line
    let titleLine = stars + ' ';

    // TODO keyword
    if (headline.properties.todoKeyword) {
        titleLine += headline.properties.todoKeyword + ' ';
    }

    // Priority
    if (headline.properties.priority) {
        titleLine += `[#${headline.properties.priority}] `;
    }

    // Title
    if (headline.properties.title) {
        titleLine += interpretObjects(headline.properties.title, opts);
    } else {
        titleLine += headline.properties.rawValue;
    }

    // Tags
    if (headline.properties.tags.length > 0) {
        titleLine += ' :' + headline.properties.tags.join(':') + ':';
    }

    parts.push(titleLine);

    // Planning line
    if (headline.planning) {
        parts.push(interpretPlanning(headline.planning, opts));
    }

    // Properties drawer
    if (headline.propertiesDrawer && Object.keys(headline.propertiesDrawer).length > 0) {
        parts.push(':PROPERTIES:');
        for (const [key, value] of Object.entries(headline.propertiesDrawer)) {
            parts.push(`:${key}: ${value}`);
        }
        parts.push(':END:');
    }

    // Section content
    if (headline.section) {
        const sectionText = interpretSection(headline.section, opts);
        if (sectionText) {
            parts.push(sectionText);
        }
    }

    // Child headlines
    for (const child of headline.children) {
        parts.push(interpretHeadline(child, opts));
    }

    return parts.join(opts.lineEnding!);
}

function interpretSection(section: SectionElement, opts: InterpreterOptions): string {
    const parts: string[] = [];

    for (const child of section.children) {
        parts.push(interpretElement(child, opts));
    }

    return parts.join(opts.lineEnding! + opts.lineEnding!);
}

function interpretParagraph(para: ParagraphElement, opts: InterpreterOptions): string {
    return interpretObjects(para.children, opts);
}

function interpretSrcBlock(block: SrcBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];

    let beginLine = `#+BEGIN_SRC ${block.properties.language}`;
    if (block.properties.parameters) {
        beginLine += ' ' + block.properties.parameters;
    }

    parts.push(beginLine);
    parts.push(block.properties.value);
    parts.push('#+END_SRC');

    return parts.join(opts.lineEnding!);
}

function interpretExampleBlock(block: ExampleBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];

    let beginLine = '#+BEGIN_EXAMPLE';
    if (block.properties.switches) {
        beginLine += ' ' + block.properties.switches;
    }

    parts.push(beginLine);
    parts.push(block.properties.value);
    parts.push('#+END_EXAMPLE');

    return parts.join(opts.lineEnding!);
}

function interpretQuoteBlock(block: QuoteBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push('#+BEGIN_QUOTE');

    for (const child of block.children) {
        parts.push(interpretElement(child, opts));
    }

    parts.push('#+END_QUOTE');
    return parts.join(opts.lineEnding!);
}

function interpretCenterBlock(block: CenterBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push('#+BEGIN_CENTER');

    for (const child of block.children) {
        parts.push(interpretElement(child, opts));
    }

    parts.push('#+END_CENTER');
    return parts.join(opts.lineEnding!);
}

function interpretSpecialBlock(block: SpecialBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push(`#+BEGIN_${block.properties.blockType.toUpperCase()}`);

    for (const child of block.children) {
        parts.push(interpretElement(child, opts));
    }

    parts.push(`#+END_${block.properties.blockType.toUpperCase()}`);
    return parts.join(opts.lineEnding!);
}

function interpretVerseBlock(block: VerseBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push('#+BEGIN_VERSE');
    parts.push(block.properties.value);
    parts.push('#+END_VERSE');
    return parts.join(opts.lineEnding!);
}

function interpretLatexEnvironment(env: LatexEnvironmentElement, opts: InterpreterOptions): string {
    return env.properties.value;
}

function interpretTable(table: TableElement, opts: InterpreterOptions): string {
    if (table.properties.tableType === 'table.el' && table.properties.value) {
        return table.properties.value;
    }

    const rows: string[] = [];

    for (const row of table.children) {
        rows.push(interpretTableRow(row, opts));
    }

    return rows.join(opts.lineEnding!);
}

function interpretTableRow(row: TableRowElement, opts: InterpreterOptions): string {
    if (row.properties.rowType === 'rule') {
        // Generate rule based on column count
        return '|-';
    }

    const cells = row.children.map(cell => interpretTableCell(cell, opts));
    return '| ' + cells.join(' | ') + ' |';
}

function interpretPlainList(list: PlainListElement, opts: InterpreterOptions): string {
    const items: string[] = [];

    for (const item of list.children) {
        items.push(interpretListItem(item, list.properties.listType, opts));
    }

    return items.join(opts.lineEnding!);
}

function interpretListItem(
    item: ItemElement,
    listType: string,
    opts: InterpreterOptions
): string {
    let line = item.properties.bullet + ' ';

    // Checkbox
    if (item.properties.checkbox) {
        const checkChar = item.properties.checkbox === 'on' ? 'X' :
                         item.properties.checkbox === 'trans' ? '-' : ' ';
        line += `[${checkChar}] `;
    }

    // Descriptive tag
    if (listType === 'descriptive' && item.properties.tag) {
        line += interpretObjects(item.properties.tag, opts) + ' :: ';
    }

    // Content
    for (const child of item.children) {
        line += interpretElement(child, opts);
    }

    return line;
}

function interpretDrawer(drawer: DrawerElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push(`:${drawer.properties.name}:`);

    for (const child of drawer.children) {
        parts.push(interpretElement(child, opts));
    }

    parts.push(':END:');
    return parts.join(opts.lineEnding!);
}

function interpretPropertyDrawer(drawer: PropertyDrawerElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push(':PROPERTIES:');

    for (const prop of drawer.children) {
        parts.push(`:${prop.properties.key}: ${prop.properties.value}`);
    }

    parts.push(':END:');
    return parts.join(opts.lineEnding!);
}

function interpretKeyword(keyword: KeywordElement, opts: InterpreterOptions): string {
    return `#+${keyword.properties.key}: ${keyword.properties.value}`;
}

function interpretComment(comment: CommentElement, opts: InterpreterOptions): string {
    return `# ${comment.properties.value}`;
}

function interpretCommentBlock(block: CommentBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push('#+BEGIN_COMMENT');
    parts.push(block.properties.value);
    parts.push('#+END_COMMENT');
    return parts.join(opts.lineEnding!);
}

function interpretFixedWidth(element: FixedWidthElement, opts: InterpreterOptions): string {
    return element.properties.value
        .split('\n')
        .map(line => ': ' + line)
        .join(opts.lineEnding!);
}

function interpretFootnoteDefinition(
    footnote: FootnoteDefinitionElement,
    opts: InterpreterOptions
): string {
    const parts: string[] = [];
    parts.push(`[fn:${footnote.properties.label}]`);

    for (const child of footnote.children) {
        parts.push(interpretElement(child, opts));
    }

    return parts.join(' ');
}

function interpretExportBlock(block: ExportBlockElement, opts: InterpreterOptions): string {
    const parts: string[] = [];
    parts.push(`#+BEGIN_EXPORT ${block.properties.backend}`);
    parts.push(block.properties.value);
    parts.push('#+END_EXPORT');
    return parts.join(opts.lineEnding!);
}

function interpretBabelCall(call: BabelCallElement, opts: InterpreterOptions): string {
    let line = `#+CALL: ${call.properties.call}`;

    if (call.properties.insideHeader) {
        line += `[${call.properties.insideHeader}]`;
    }

    if (call.properties.arguments) {
        line += `(${call.properties.arguments})`;
    }

    if (call.properties.endHeader) {
        line += `[${call.properties.endHeader}]`;
    }

    return line;
}

function interpretClock(clock: ClockElement, opts: InterpreterOptions): string {
    let line = 'CLOCK: ' + interpretTimestamp(clock.properties.start, opts);

    if (clock.properties.end) {
        line += '--' + interpretTimestamp(clock.properties.end, opts);
    }

    if (clock.properties.duration) {
        line += ' =>  ' + clock.properties.duration;
    }

    return line;
}

function interpretPlanning(planning: PlanningElement, opts: InterpreterOptions): string {
    const parts: string[] = [];

    if (planning.properties.scheduled) {
        parts.push('SCHEDULED: ' + interpretTimestamp(planning.properties.scheduled, opts));
    }

    if (planning.properties.deadline) {
        parts.push('DEADLINE: ' + interpretTimestamp(planning.properties.deadline, opts));
    }

    if (planning.properties.closed) {
        parts.push('CLOSED: ' + interpretTimestamp(planning.properties.closed, opts));
    }

    return parts.join(' ');
}

// =============================================================================
// Object Interpreters
// =============================================================================

function interpretBold(bold: BoldObject, opts: InterpreterOptions): string {
    return '*' + interpretObjects(bold.children, opts) + '*';
}

function interpretItalic(italic: ItalicObject, opts: InterpreterOptions): string {
    return '/' + interpretObjects(italic.children, opts) + '/';
}

function interpretUnderline(underline: UnderlineObject, opts: InterpreterOptions): string {
    return '_' + interpretObjects(underline.children, opts) + '_';
}

function interpretStrikeThrough(strike: StrikeThroughObject, opts: InterpreterOptions): string {
    return '+' + interpretObjects(strike.children, opts) + '+';
}

function interpretCode(code: CodeObject, opts: InterpreterOptions): string {
    return '=' + code.properties.value + '=';
}

function interpretVerbatim(verbatim: VerbatimObject, opts: InterpreterOptions): string {
    return '~' + verbatim.properties.value + '~';
}

function interpretLink(link: LinkObject, opts: InterpreterOptions): string {
    const { linkType, path, rawLink, format } = link.properties;

    if (format === 'plain') {
        return rawLink || path;
    }

    if (format === 'angle') {
        return `<${rawLink || path}>`;
    }

    // Bracket format
    const linkPath = rawLink || (linkType === 'internal' ? path : `${linkType}:${path}`);

    if (link.children && link.children.length > 0) {
        const desc = interpretObjects(link.children, opts);
        return `[[${linkPath}][${desc}]]`;
    }

    return `[[${linkPath}]]`;
}

function interpretTimestamp(ts: TimestampObject, opts: InterpreterOptions): string {
    // If we have the raw value, use it for accurate round-trip
    if (opts.preserveFormatting && ts.properties.rawValue) {
        return ts.properties.rawValue;
    }

    const { timestampType, yearStart, monthStart, dayStart } = ts.properties;
    const isActive = timestampType === 'active' || timestampType === 'active-range';

    const openBracket = isActive ? '<' : '[';
    const closeBracket = isActive ? '>' : ']';

    // Format date
    const year = String(yearStart);
    const month = String(monthStart).padStart(2, '0');
    const day = String(dayStart).padStart(2, '0');

    // Get day of week
    const date = new Date(yearStart, monthStart - 1, dayStart);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[date.getDay()];

    let result = `${openBracket}${year}-${month}-${day} ${dayName}`;

    // Time
    if (ts.properties.hourStart !== undefined) {
        const hour = String(ts.properties.hourStart).padStart(2, '0');
        const minute = String(ts.properties.minuteStart).padStart(2, '0');
        result += ` ${hour}:${minute}`;

        // Time range on same day
        if (ts.properties.hourEnd !== undefined && !ts.properties.yearEnd) {
            const hourEnd = String(ts.properties.hourEnd).padStart(2, '0');
            const minuteEnd = String(ts.properties.minuteEnd).padStart(2, '0');
            result += `-${hourEnd}:${minuteEnd}`;
        }
    }

    // Repeater
    if (ts.properties.repeaterType) {
        result += ` ${ts.properties.repeaterType}${ts.properties.repeaterValue}${ts.properties.repeaterUnit}`;
    }

    // Warning
    if (ts.properties.warningType) {
        result += ` ${ts.properties.warningType}${ts.properties.warningValue}${ts.properties.warningUnit}`;
    }

    result += closeBracket;

    // Date range (separate timestamps)
    if (ts.properties.yearEnd) {
        const yearEnd = String(ts.properties.yearEnd);
        const monthEnd = String(ts.properties.monthEnd).padStart(2, '0');
        const dayEnd = String(ts.properties.dayEnd).padStart(2, '0');

        const dateEnd = new Date(ts.properties.yearEnd!, ts.properties.monthEnd! - 1, ts.properties.dayEnd!);
        const dayNameEnd = dayNames[dateEnd.getDay()];

        result += `--${openBracket}${yearEnd}-${monthEnd}-${dayEnd} ${dayNameEnd}`;

        if (ts.properties.hourEnd !== undefined) {
            const hourEnd = String(ts.properties.hourEnd).padStart(2, '0');
            const minuteEnd = String(ts.properties.minuteEnd).padStart(2, '0');
            result += ` ${hourEnd}:${minuteEnd}`;
        }

        result += closeBracket;
    }

    return result;
}

function interpretEntity(entity: EntityObject, opts: InterpreterOptions): string {
    if (opts.useUtf8Entities) {
        return entity.properties.utf8;
    }

    const brackets = entity.properties.usesBrackets ? '{}' : '';
    return `\\${entity.properties.name}${brackets}`;
}

function interpretLatexFragment(fragment: LatexFragmentObject, opts: InterpreterOptions): string {
    return fragment.properties.value;
}

function interpretSubscript(sub: SubscriptObject, opts: InterpreterOptions): string {
    const content = interpretObjects(sub.children, opts);
    if (sub.properties.usesBraces) {
        return `_{${content}}`;
    }
    return `_${content}`;
}

function interpretSuperscript(sup: SuperscriptObject, opts: InterpreterOptions): string {
    const content = interpretObjects(sup.children, opts);
    if (sup.properties.usesBraces) {
        return `^{${content}}`;
    }
    return `^${content}`;
}

function interpretFootnoteReference(ref: FootnoteReferenceObject, opts: InterpreterOptions): string {
    if (ref.properties.referenceType === 'inline' && ref.children) {
        const content = interpretObjects(ref.children, opts);
        if (ref.properties.label) {
            return `[fn:${ref.properties.label}:${content}]`;
        }
        return `[fn::${content}]`;
    }

    return `[fn:${ref.properties.label || ''}]`;
}

function interpretRadioTarget(target: RadioTargetObject, opts: InterpreterOptions): string {
    return '<<<' + interpretObjects(target.children, opts) + '>>>';
}

function interpretInlineSrcBlock(block: InlineSrcBlockObject, opts: InterpreterOptions): string {
    let result = `src_${block.properties.language}`;

    if (block.properties.parameters) {
        result += `[${block.properties.parameters}]`;
    }

    result += `{${block.properties.value}}`;
    return result;
}

function interpretInlineBabelCall(call: InlineBabelCallObject, opts: InterpreterOptions): string {
    let result = `call_${call.properties.call}`;

    if (call.properties.insideHeader) {
        result += `[${call.properties.insideHeader}]`;
    }

    result += `(${call.properties.arguments || ''})`;

    if (call.properties.endHeader) {
        result += `[${call.properties.endHeader}]`;
    }

    return result;
}

function interpretExportSnippet(snippet: ExportSnippetObject, opts: InterpreterOptions): string {
    return `@@${snippet.properties.backend}:${snippet.properties.value}@@`;
}

function interpretMacro(macro: MacroObject, opts: InterpreterOptions): string {
    if (macro.properties.args.length > 0) {
        return `{{{${macro.properties.key}(${macro.properties.args.join(',')})}}}`;
    }
    return `{{{${macro.properties.key}}}}`;
}

function interpretTableCell(cell: TableCellObject, opts: InterpreterOptions): string {
    if (cell.children) {
        return interpretObjects(cell.children, opts);
    }
    return cell.properties.value;
}

// =============================================================================
// Default Export
// =============================================================================

export default interpret;
