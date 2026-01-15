/**
 * Org-mode AST Serialization
 * Converts parsed AST back to org-mode text format
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
    LinkObject,
    BoldObject,
    ItalicObject,
    UnderlineObject,
    StrikeThroughObject,
    CodeObject,
    VerbatimObject,
    PlainTextObject,
    EntityObject,
    LatexFragmentObject,
    SubscriptObject,
    SuperscriptObject,
    TableCellObject,
    FootnoteReferenceObject,
    StatisticsCookieObject,
    TargetObject,
    RadioTargetObject,
    LineBreakObject,
    InlineBabelCallObject,
    InlineSrcBlockObject,
    ExportSnippetObject,
    MacroObject,
} from './orgElementTypes';

// =============================================================================
// Serialization Options
// =============================================================================

export interface SerializeOptions {
    /** Preserve original whitespace/blank lines where possible */
    preserveWhitespace?: boolean;
    /** Number of blank lines between top-level elements (default: 1) */
    blankLinesBetweenElements?: number;
}

const DEFAULT_OPTIONS: Required<SerializeOptions> = {
    preserveWhitespace: true,
    blankLinesBetweenElements: 1,
};

// =============================================================================
// Main Serialization Functions
// =============================================================================

/**
 * Serialize an org document AST back to org text
 */
export function serialize(doc: OrgDocumentNode, options?: SerializeOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const parts: string[] = [];

    // Serialize document keywords
    for (const [key, value] of Object.entries(doc.keywords)) {
        parts.push(`#+${key}: ${value}`);
    }

    // Serialize keyword lists (#+LATEX_HEADER, etc.)
    for (const [key, values] of Object.entries(doc.keywordLists)) {
        for (const value of values) {
            parts.push(`#+${key}: ${value}`);
        }
    }

    // Serialize document properties
    for (const [key, value] of Object.entries(doc.properties)) {
        parts.push(`#+PROPERTY: ${key} ${value}`);
    }

    // Add blank line after preamble keywords if there are any
    if (parts.length > 0) {
        parts.push('');
    }

    // Serialize pre-headline section
    if (doc.section) {
        parts.push(serializeSection(doc.section, opts));
    }

    // Serialize headlines
    for (const headline of doc.children) {
        parts.push(serializeHeadline(headline, opts));
    }

    return parts.join('\n').trimEnd() + '\n';
}

/**
 * Serialize a single headline and its contents
 */
export function serializeHeadline(headline: HeadlineElement, options?: SerializeOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const parts: string[] = [];

    // Build headline line
    const stars = '*'.repeat(headline.properties.level);
    let headlineParts: string[] = [stars];

    // TODO keyword
    if (headline.properties.todoKeyword) {
        headlineParts.push(headline.properties.todoKeyword);
    }

    // Priority
    if (headline.properties.priority) {
        headlineParts.push(`[#${headline.properties.priority}]`);
    }

    // COMMENT prefix
    if (headline.properties.commentedp) {
        headlineParts.push('COMMENT');
    }

    // Title
    headlineParts.push(headline.properties.rawValue);

    // Tags
    if (headline.properties.tags.length > 0) {
        const tagStr = ':' + headline.properties.tags.join(':') + ':';
        headlineParts.push(tagStr);
    }

    parts.push(headlineParts.join(' '));

    // Planning line
    if (headline.planning) {
        parts.push(serializePlanning(headline.planning));
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
        const sectionContent = serializeSection(headline.section, opts);
        if (sectionContent) {
            parts.push(sectionContent);
        }
    }

    // Child headlines
    for (const child of headline.children) {
        parts.push(serializeHeadline(child, opts));
    }

    return parts.join('\n');
}

/**
 * Serialize a section (content between headlines)
 */
export function serializeSection(section: SectionElement, options?: SerializeOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const parts: string[] = [];

    for (const element of section.children) {
        parts.push(serializeElement(element, opts));
    }

    return parts.join('\n');
}

/**
 * Serialize any element
 */
export function serializeElement(element: OrgElement, options?: SerializeOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    switch (element.type) {
        case 'paragraph':
            return serializeParagraph(element as ParagraphElement);
        case 'src-block':
            return serializeSrcBlock(element as SrcBlockElement);
        case 'example-block':
            return serializeExampleBlock(element as ExampleBlockElement);
        case 'export-block':
            return serializeExportBlock(element as ExportBlockElement);
        case 'quote-block':
            return serializeQuoteBlock(element as QuoteBlockElement, opts);
        case 'center-block':
            return serializeCenterBlock(element as CenterBlockElement, opts);
        case 'special-block':
            return serializeSpecialBlock(element as SpecialBlockElement, opts);
        case 'verse-block':
            return serializeVerseBlock(element as VerseBlockElement);
        case 'comment-block':
            return serializeCommentBlock(element as CommentBlockElement);
        case 'keyword':
            return serializeKeyword(element as KeywordElement);
        case 'comment':
            return serializeComment(element as CommentElement);
        case 'horizontal-rule':
            return serializeHorizontalRule();
        case 'fixed-width':
            return serializeFixedWidth(element as FixedWidthElement);
        case 'drawer':
            return serializeDrawer(element as DrawerElement, opts);
        case 'property-drawer':
            return serializePropertyDrawer(element as PropertyDrawerElement);
        case 'babel-call':
            return serializeBabelCall(element as BabelCallElement);
        case 'latex-environment':
            return serializeLatexEnvironment(element as LatexEnvironmentElement);
        case 'footnote-definition':
            return serializeFootnoteDefinition(element as FootnoteDefinitionElement, opts);
        case 'dynamic-block':
            return serializeDynamicBlock(element as DynamicBlockElement, opts);
        case 'inlinetask':
            return serializeInlinetask(element as InlinetaskElement, opts);
        case 'diary-sexp':
            return serializeDiarySexp(element as DiarySexpElement);
        case 'planning':
            return serializePlanning(element as PlanningElement);
        case 'clock':
            return serializeClock(element as ClockElement);
        case 'table':
            return serializeTable(element as TableElement);
        case 'plain-list':
            return serializeList(element as PlainListElement, opts);
        default:
            // Fallback for unknown elements
            return '';
    }
}

// =============================================================================
// Element Serializers
// =============================================================================

function serializeParagraph(para: ParagraphElement): string {
    return serializeObjects(para.children);
}

function serializeSrcBlock(block: SrcBlockElement): string {
    const parts: string[] = [];
    let beginLine = `#+BEGIN_SRC ${block.properties.language}`;
    if (block.properties.parameters) {
        beginLine += ` ${block.properties.parameters}`;
    }
    parts.push(beginLine);
    parts.push(block.properties.value);
    parts.push('#+END_SRC');
    return parts.join('\n');
}

function serializeExampleBlock(block: ExampleBlockElement): string {
    const parts: string[] = [];
    let beginLine = '#+BEGIN_EXAMPLE';
    if (block.properties.switches) {
        beginLine += ` ${block.properties.switches}`;
    }
    parts.push(beginLine);
    parts.push(block.properties.value);
    parts.push('#+END_EXAMPLE');
    return parts.join('\n');
}

function serializeExportBlock(block: ExportBlockElement): string {
    return [
        `#+BEGIN_EXPORT ${block.properties.backend}`,
        block.properties.value,
        '#+END_EXPORT',
    ].join('\n');
}

function serializeQuoteBlock(block: QuoteBlockElement, opts: Required<SerializeOptions>): string {
    const content = block.children.map(el => serializeElement(el, opts)).join('\n');
    return ['#+BEGIN_QUOTE', content, '#+END_QUOTE'].join('\n');
}

function serializeCenterBlock(block: CenterBlockElement, opts: Required<SerializeOptions>): string {
    const content = block.children.map(el => serializeElement(el, opts)).join('\n');
    return ['#+BEGIN_CENTER', content, '#+END_CENTER'].join('\n');
}

function serializeSpecialBlock(block: SpecialBlockElement, opts: Required<SerializeOptions>): string {
    const content = block.children.map(el => serializeElement(el, opts)).join('\n');
    return [
        `#+BEGIN_${block.properties.blockType}`,
        content,
        `#+END_${block.properties.blockType}`,
    ].join('\n');
}

function serializeVerseBlock(block: VerseBlockElement): string {
    return ['#+BEGIN_VERSE', block.properties.value, '#+END_VERSE'].join('\n');
}

function serializeCommentBlock(block: CommentBlockElement): string {
    return ['#+BEGIN_COMMENT', block.properties.value, '#+END_COMMENT'].join('\n');
}

function serializeKeyword(keyword: KeywordElement): string {
    return `#+${keyword.properties.key}: ${keyword.properties.value}`;
}

function serializeComment(comment: CommentElement): string {
    return `# ${comment.properties.value}`;
}

function serializeHorizontalRule(): string {
    return '-----';
}

function serializeFixedWidth(element: FixedWidthElement): string {
    return element.properties.value
        .split('\n')
        .map(line => `: ${line}`)
        .join('\n');
}

function serializeDrawer(drawer: DrawerElement, opts: Required<SerializeOptions>): string {
    const content = drawer.children.map(el => serializeElement(el, opts)).join('\n');
    return [`:${drawer.properties.name}:`, content, ':END:'].join('\n');
}

function serializePropertyDrawer(drawer: PropertyDrawerElement): string {
    const parts = [':PROPERTIES:'];
    for (const prop of drawer.children) {
        if (prop.type === 'node-property') {
            const nodeProp = prop as NodePropertyElement;
            parts.push(`:${nodeProp.properties.key}: ${nodeProp.properties.value}`);
        }
    }
    parts.push(':END:');
    return parts.join('\n');
}

function serializeBabelCall(call: BabelCallElement): string {
    let result = `#+CALL: ${call.properties.call}`;
    if (call.properties.insideHeader) {
        result += `[${call.properties.insideHeader}]`;
    }
    result += `(${call.properties.arguments || ''})`;
    if (call.properties.endHeader) {
        result += `[${call.properties.endHeader}]`;
    }
    return result;
}

function serializeLatexEnvironment(env: LatexEnvironmentElement): string {
    return env.properties.value;
}

function serializeFootnoteDefinition(
    fn: FootnoteDefinitionElement,
    opts: Required<SerializeOptions>
): string {
    const content = fn.children.map(el => serializeElement(el, opts)).join('\n');
    return `[fn:${fn.properties.label}] ${content}`;
}

function serializeDynamicBlock(
    block: DynamicBlockElement,
    opts: Required<SerializeOptions>
): string {
    let beginLine = `#+BEGIN: ${block.properties.name}`;
    if (block.properties.arguments) {
        beginLine += ` ${block.properties.arguments}`;
    }
    const content = block.children.map(el => serializeElement(el, opts)).join('\n');
    return [beginLine, content, '#+END:'].join('\n');
}

function serializeInlinetask(task: InlinetaskElement, opts: Required<SerializeOptions>): string {
    const parts: string[] = [];
    const stars = '*'.repeat(task.properties.level);
    let headlineParts: string[] = [stars];

    if (task.properties.todoKeyword) {
        headlineParts.push(task.properties.todoKeyword);
    }
    if (task.properties.priority) {
        headlineParts.push(`[#${task.properties.priority}]`);
    }
    headlineParts.push(task.properties.rawValue);
    if (task.properties.tags.length > 0) {
        headlineParts.push(':' + task.properties.tags.join(':') + ':');
    }

    parts.push(headlineParts.join(' '));

    if (task.children.length > 0) {
        for (const child of task.children) {
            parts.push(serializeElement(child, opts));
        }
        parts.push(stars + ' END');
    }

    return parts.join('\n');
}

function serializeDiarySexp(sexp: DiarySexpElement): string {
    return `%%(${sexp.properties.value})`;
}

function serializePlanning(planning: PlanningElement): string {
    const parts: string[] = [];

    if (planning.properties.closed) {
        parts.push(`CLOSED: ${serializeTimestamp(planning.properties.closed)}`);
    }
    if (planning.properties.deadline) {
        parts.push(`DEADLINE: ${serializeTimestamp(planning.properties.deadline)}`);
    }
    if (planning.properties.scheduled) {
        parts.push(`SCHEDULED: ${serializeTimestamp(planning.properties.scheduled)}`);
    }

    return parts.join(' ');
}

function serializeClock(clock: ClockElement): string {
    let result = `CLOCK: ${serializeTimestamp(clock.properties.start)}`;
    if (clock.properties.end) {
        result += `--${serializeTimestamp(clock.properties.end)}`;
    }
    if (clock.properties.duration) {
        result += ` =>  ${clock.properties.duration}`;
    }
    return result;
}

function serializeTable(table: TableElement): string {
    if (table.properties.tableType === 'table.el' && table.properties.value) {
        return table.properties.value;
    }

    const rows: string[] = [];
    for (const row of table.children) {
        if (row.properties.rowType === 'rule') {
            rows.push('|---');
        } else {
            const cells = row.children.map(cell => {
                if (cell.children && cell.children.length > 0) {
                    return serializeObjects(cell.children);
                }
                return cell.properties.value;
            });
            rows.push('| ' + cells.join(' | ') + ' |');
        }
    }
    return rows.join('\n');
}

function serializeList(list: PlainListElement, opts: Required<SerializeOptions>): string {
    return list.children.map(item => serializeListItem(item, opts, 0)).join('\n');
}

function serializeListItem(
    item: ItemElement,
    opts: Required<SerializeOptions>,
    indent: number
): string {
    const parts: string[] = [];
    const indentStr = ' '.repeat(indent);
    let bulletLine = indentStr + item.properties.bullet;

    // Checkbox
    if (item.properties.checkbox) {
        const checkboxMap = { on: '[X]', off: '[ ]', trans: '[-]' };
        bulletLine += ' ' + checkboxMap[item.properties.checkbox];
    }

    // Tag (for descriptive lists)
    if (item.properties.tag && item.properties.tag.length > 0) {
        bulletLine += ' ' + serializeObjects(item.properties.tag) + ' ::';
    }

    // Content
    const contentParts: string[] = [];
    for (const child of item.children) {
        if (child.type === 'plain-list') {
            contentParts.push(
                (child as PlainListElement).children
                    .map(i => serializeListItem(i, opts, indent + 2))
                    .join('\n')
            );
        } else {
            contentParts.push(serializeElement(child, opts));
        }
    }

    if (contentParts.length > 0) {
        const firstContent = contentParts[0];
        bulletLine += ' ' + firstContent.split('\n')[0];
        const rest = firstContent.split('\n').slice(1);
        if (rest.length > 0) {
            parts.push(bulletLine);
            parts.push(...rest.map(l => indentStr + '  ' + l));
        } else {
            parts.push(bulletLine);
        }
        for (const content of contentParts.slice(1)) {
            parts.push(content);
        }
    } else {
        parts.push(bulletLine);
    }

    return parts.join('\n');
}

// =============================================================================
// Object Serializers
// =============================================================================

/**
 * Serialize an array of org objects to text
 */
export function serializeObjects(objects: OrgObject[]): string {
    return objects.map(obj => serializeObject(obj)).join('');
}

/**
 * Serialize a single org object
 */
export function serializeObject(obj: OrgObject): string {
    switch (obj.type) {
        case 'plain-text':
            return (obj as PlainTextObject).properties.value;
        case 'bold':
            return '*' + serializeObjects((obj as BoldObject).children) + '*';
        case 'italic':
            return '/' + serializeObjects((obj as ItalicObject).children) + '/';
        case 'underline':
            return '_' + serializeObjects((obj as UnderlineObject).children) + '_';
        case 'strike-through':
            return '+' + serializeObjects((obj as StrikeThroughObject).children) + '+';
        case 'code':
            return '=' + (obj as CodeObject).properties.value + '=';
        case 'verbatim':
            return '~' + (obj as VerbatimObject).properties.value + '~';
        case 'link':
            return serializeLink(obj as LinkObject);
        case 'timestamp':
            return serializeTimestamp(obj as TimestampObject);
        case 'entity':
            return serializeEntity(obj as EntityObject);
        case 'latex-fragment':
            return (obj as LatexFragmentObject).properties.value;
        case 'subscript':
            return '_' + (obj as SubscriptObject).properties.usesBraces
                ? '{' + serializeObjects((obj as SubscriptObject).children) + '}'
                : serializeObjects((obj as SubscriptObject).children);
        case 'superscript':
            return '^' + (obj as SuperscriptObject).properties.usesBraces
                ? '{' + serializeObjects((obj as SuperscriptObject).children) + '}'
                : serializeObjects((obj as SuperscriptObject).children);
        case 'footnote-reference':
            return serializeFootnoteReference(obj as FootnoteReferenceObject);
        case 'statistics-cookie':
            return (obj as StatisticsCookieObject).properties.value;
        case 'target':
            return '<<' + (obj as TargetObject).properties.value + '>>';
        case 'radio-target':
            return '<<<' + serializeObjects((obj as RadioTargetObject).children) + '>>>';
        case 'line-break':
            return '\\\\\n';
        case 'inline-babel-call':
            return serializeInlineBabelCall(obj as InlineBabelCallObject);
        case 'inline-src-block':
            return serializeInlineSrcBlock(obj as InlineSrcBlockObject);
        case 'export-snippet':
            return serializeExportSnippet(obj as ExportSnippetObject);
        case 'macro':
            return serializeMacro(obj as MacroObject);
        case 'table-cell':
            return (obj as TableCellObject).properties.value;
        default:
            return '';
    }
}

function serializeLink(link: LinkObject): string {
    const { linkType, path, format } = link.properties;

    if (format === 'plain') {
        return path;
    }

    if (format === 'angle') {
        return `<${path}>`;
    }

    // Bracket format
    let linkPath = path;
    if (linkType !== 'fuzzy' && linkType !== 'internal') {
        linkPath = `${linkType}:${path}`;
    }

    if (link.children && link.children.length > 0) {
        const description = serializeObjects(link.children);
        return `[[${linkPath}][${description}]]`;
    }

    return `[[${linkPath}]]`;
}

function serializeTimestamp(ts: TimestampObject): string {
    // If we have the raw value, use it
    if (ts.properties.rawValue) {
        return ts.properties.rawValue;
    }

    // Otherwise reconstruct
    const isActive = ts.properties.timestampType === 'active' ||
        ts.properties.timestampType === 'active-range';
    const open = isActive ? '<' : '[';
    const close = isActive ? '>' : ']';

    const { yearStart, monthStart, dayStart, hourStart, minuteStart } = ts.properties;
    let date = `${yearStart}-${String(monthStart).padStart(2, '0')}-${String(dayStart).padStart(2, '0')}`;

    if (hourStart !== undefined && minuteStart !== undefined) {
        date += ` ${String(hourStart).padStart(2, '0')}:${String(minuteStart).padStart(2, '0')}`;
    }

    // Handle repeaters
    if (ts.properties.repeaterType && ts.properties.repeaterValue && ts.properties.repeaterUnit) {
        date += ` ${ts.properties.repeaterType}${ts.properties.repeaterValue}${ts.properties.repeaterUnit}`;
    }

    // Handle warnings
    if (ts.properties.warningType && ts.properties.warningValue && ts.properties.warningUnit) {
        date += ` ${ts.properties.warningType}${ts.properties.warningValue}${ts.properties.warningUnit}`;
    }

    return open + date + close;
}

function serializeEntity(entity: EntityObject): string {
    return '\\' + entity.properties.name + (entity.properties.usesBrackets ? '{}' : '');
}

function serializeFootnoteReference(fn: FootnoteReferenceObject): string {
    if (fn.properties.referenceType === 'inline' && fn.children) {
        return `[fn:: ${serializeObjects(fn.children)}]`;
    }
    return `[fn:${fn.properties.label || ''}]`;
}

function serializeInlineBabelCall(call: InlineBabelCallObject): string {
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

function serializeInlineSrcBlock(block: InlineSrcBlockObject): string {
    let result = `src_${block.properties.language}`;
    if (block.properties.parameters) {
        result += `[${block.properties.parameters}]`;
    }
    result += `{${block.properties.value}}`;
    return result;
}

function serializeExportSnippet(snippet: ExportSnippetObject): string {
    return `@@${snippet.properties.backend}:${snippet.properties.value}@@`;
}

function serializeMacro(macro: MacroObject): string {
    if (macro.properties.args.length > 0) {
        return `{{{${macro.properties.key}(${macro.properties.args.join(',')})}}}`;
    }
    return `{{{${macro.properties.key}}}}`;
}
