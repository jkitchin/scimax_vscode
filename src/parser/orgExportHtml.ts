/**
 * HTML export backend for org-mode documents
 * Converts org AST to semantic HTML5
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
    CommandObject,
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

import type {
    ExportBackend,
    ExportState,
    ExportOptions,
} from './orgExport';

import {
    createExportState,
    escapeString,
    generateId,
    generateSectionNumber,
    exportObjects,
    timestampToIso,
    shouldExport,
    expandMacro,
    BUILTIN_MACROS,
    collectTargets,
    collectFootnotes,
    processEditmarksHtml,
    EDITMARK_CSS,
    type EditmarkExportMode,
    parseOptionsKeyword,
} from './orgExport';

import { CitationProcessor, CSLStyleName } from '../references/citationProcessor';
import { parseCitationsFromLine, getNormalizedStyle } from '../references/citationParser';
import type { BibEntry } from '../references/bibtexParser';
import { ALL_CITATION_COMMANDS } from '../references/citationTypes';

// Citation link types that should be processed as citations
const CITATION_LINK_TYPES = new Set(ALL_CITATION_COMMANDS.map(c => c.toLowerCase()));

// =============================================================================
// HTML Export Options
// =============================================================================

export interface HtmlExportOptions extends ExportOptions {
    /** Include full HTML document structure */
    bodyOnly?: boolean;
    /** HTML doctype */
    doctype?: string;
    /** Custom CSS to include */
    css?: string;
    /** External CSS files to link */
    cssFiles?: string[];
    /** Custom JavaScript to include */
    javascript?: string;
    /** External JS files to link */
    jsFiles?: string[];
    /** Use MathJax for LaTeX rendering */
    mathJax?: boolean;
    /** MathJax configuration URL */
    mathJaxUrl?: string;
    /** Use highlight.js for code syntax highlighting */
    highlightJs?: boolean;
    /** highlight.js CDN URL */
    highlightJsUrl?: string;
    /** HTML head content */
    headExtra?: string;
    /** Container element class */
    containerClass?: string;
    /** Whether to include postamble */
    postamble?: boolean;
    /** Whether to include preamble */
    preamble?: boolean;
    /** Custom preamble content */
    preambleContent?: string;
    /** Custom postamble content */
    postambleContent?: string;

    // Citation options
    /** CSL style for citation formatting (default: apa) */
    citationStyle?: CSLStyleName | string;
    /** Whether to generate bibliography section (default: true) */
    bibliography?: boolean;
    /** Bibliography title (default: "References") */
    bibliographyTitle?: string;
    /** BibTeX entries for citation processing */
    bibEntries?: BibEntry[];
    /** Citation processor instance (if pre-configured) */
    citationProcessor?: CitationProcessor;

    // Editmark options
    /** Editmark export mode: show, accept, reject, or hide */
    editmarkMode?: EditmarkExportMode;
}

const DEFAULT_HTML_OPTIONS: HtmlExportOptions = {
    bodyOnly: false,
    doctype: '<!DOCTYPE html>',
    mathJax: true,
    mathJaxUrl: 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js',
    highlightJs: true,
    highlightJsUrl: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0',
    containerClass: 'org-content',
    postamble: true,
    preamble: false,
    citationStyle: 'apa',
    bibliography: true,
    bibliographyTitle: 'References',
    editmarkMode: 'show',
};

/**
 * Extended export state with citation processor
 */
interface HtmlExportState extends ExportState {
    citationProcessor?: CitationProcessor;
    htmlOptions: HtmlExportOptions;
    /** Track citation locations for back-links: key -> array of citation IDs */
    citationLocations: Map<string, string[]>;
    /** Counter for generating unique citation IDs */
    citationCounter: number;
}

// =============================================================================
// HTML Export Backend
// =============================================================================

export class HtmlExportBackend implements ExportBackend {
    public readonly name = 'html';

    /**
     * Export a complete document to HTML
     */
    exportDocument(doc: OrgDocumentNode, options?: Partial<HtmlExportOptions>): string {
        // Parse #+OPTIONS: keyword if present
        const optionsKeyword = doc.keywords['OPTIONS'];
        const parsedOptions = optionsKeyword ? parseOptionsKeyword(optionsKeyword) : {};

        const opts: HtmlExportOptions = {
            ...DEFAULT_HTML_OPTIONS,
            ...parsedOptions,  // OPTIONS keyword values
            ...options,        // Explicit options override OPTIONS
            backend: 'html',
        };

        // Create base export state
        const baseState = createExportState(opts);

        // Create HTML export state with citation processor
        const state: HtmlExportState = {
            ...baseState,
            htmlOptions: opts,
            citationLocations: new Map(),
            citationCounter: 0,
        };

        // Initialize citation processor if bib entries are provided
        if (opts.citationProcessor) {
            state.citationProcessor = opts.citationProcessor;
        } else if (opts.bibEntries && opts.bibEntries.length > 0) {
            state.citationProcessor = new CitationProcessor({
                style: opts.citationStyle || 'apa',
            });
            state.citationProcessor.loadEntries(opts.bibEntries);
        }

        // Pre-process document
        collectTargets(doc, state);
        collectFootnotes(doc, state);

        // Collect document-defined macros from #+MACRO: keywords
        if (doc.keywordLists?.['MACRO']) {
            const docMacros: Record<string, string> = {};
            for (const macroDef of doc.keywordLists['MACRO']) {
                // Format: "name replacement text" or "name(args) replacement text"
                const match = macroDef.match(/^(\S+)\s+(.*)$/);
                if (match) {
                    docMacros[match[1]] = match[2];
                }
            }
            // Document macros override options macros
            state.options.macros = { ...state.options.macros, ...docMacros };
        }

        // Extract document metadata
        const title = opts.title || doc.keywords['TITLE'] || 'Untitled';
        const author = opts.author || doc.keywords['AUTHOR'] || '';
        const email = opts.email || doc.keywords['EMAIL'] || '';
        const date = opts.date || doc.keywords['DATE'] || '';
        const language = opts.language || doc.keywords['LANGUAGE'] || 'en';

        // Check for CSL style in document keywords
        if (doc.keywords['CSL_STYLE'] && state.citationProcessor) {
            state.citationProcessor.setStyle(doc.keywords['CSL_STYLE']);
        }

        // Build content
        const content = this.exportDocumentContent(doc, state);

        if (opts.bodyOnly) {
            return content;
        }

        return this.wrapInHtmlDocument(content, {
            title,
            author,
            email,
            date,
            language,
            ...opts,
        }, state);
    }

    /**
     * Export document content (without wrapper)
     */
    private exportDocumentContent(doc: OrgDocumentNode, state: HtmlExportState): string {
        const parts: string[] = [];

        // Export preamble section if present
        if (doc.section) {
            const sectionContent = this.exportSection(doc.section, state);
            if (sectionContent.trim()) {
                parts.push(`<div class="org-preamble">${sectionContent}</div>`);
            }
        }

        // Export TOC if enabled
        if (state.options.toc) {
            const toc = this.generateToc(doc, state);
            if (toc) {
                parts.push(toc);
            }
        }

        // Export headlines
        for (const headline of doc.children) {
            if (shouldExport(headline, state.options)) {
                parts.push(this.exportHeadline(headline, state));
            }
        }

        // Export footnotes
        const footnotes = this.exportFootnotes(state);
        if (footnotes) {
            parts.push(footnotes);
        }

        // Export bibliography if enabled and there are citations
        if (state.htmlOptions.bibliography !== false && state.citationProcessor) {
            const bibliography = state.citationProcessor.generateBibliography(state.citationLocations);
            if (bibliography) {
                parts.push(bibliography);
            }
        }

        return parts.join('\n');
    }

    /**
     * Export a single element
     */
    exportElement(element: OrgElement, state: ExportState): string {
        // Handle affiliated keywords
        let prefix = '';
        if (element.affiliated) {
            prefix = this.exportAffiliatedKeywords(element.affiliated, state);
        }

        const content = this.exportElementContent(element, state);
        return prefix + content;
    }

    /**
     * Export element content (without affiliated keywords)
     */
    private exportElementContent(element: OrgElement, state: ExportState): string {
        switch (element.type) {
            case 'headline':
                return this.exportHeadline(element as HeadlineElement, state);
            case 'section':
                return this.exportSection(element as SectionElement, state);
            case 'paragraph':
                return this.exportParagraph(element as ParagraphElement, state);
            case 'src-block':
                return this.exportSrcBlock(element as SrcBlockElement, state);
            case 'example-block':
                return this.exportExampleBlock(element as ExampleBlockElement, state);
            case 'quote-block':
                return this.exportQuoteBlock(element as QuoteBlockElement, state);
            case 'center-block':
                return this.exportCenterBlock(element as CenterBlockElement, state);
            case 'special-block':
                return this.exportSpecialBlock(element as SpecialBlockElement, state);
            case 'verse-block':
                return this.exportVerseBlock(element as VerseBlockElement, state);
            case 'latex-environment':
                return this.exportLatexEnvironment(element as LatexEnvironmentElement, state);
            case 'table':
                return this.exportTable(element as TableElement, state);
            case 'plain-list':
                return this.exportPlainList(element as PlainListElement, state);
            case 'drawer':
                return this.exportDrawer(element as DrawerElement, state);
            case 'keyword':
                return this.exportKeyword(element as KeywordElement, state);
            case 'horizontal-rule':
                return '<hr />\n';
            case 'comment-block':
                return ''; // Comments not exported
            case 'fixed-width':
                return this.exportFixedWidth(element as FixedWidthElement, state);
            case 'footnote-definition':
                return ''; // Handled separately
            case 'export-block':
                return this.exportExportBlock(element as ExportBlockElement, state);
            default:
                return `<!-- Unknown element type: ${element.type} -->`;
        }
    }

    /**
     * Export a single object (inline element)
     */
    exportObject(object: OrgObject, state: ExportState): string {
        switch (object.type) {
            case 'bold':
                return this.exportBold(object as BoldObject, state);
            case 'italic':
                return this.exportItalic(object as ItalicObject, state);
            case 'underline':
                return this.exportUnderline(object as UnderlineObject, state);
            case 'strike-through':
                return this.exportStrikeThrough(object as StrikeThroughObject, state);
            case 'code':
                return this.exportCode(object as CodeObject, state);
            case 'command':
                return this.exportCommand(object as CommandObject, state);
            case 'verbatim':
                return this.exportVerbatim(object as VerbatimObject, state);
            case 'link':
                return this.exportLink(object as LinkObject, state);
            case 'timestamp':
                return this.exportTimestamp(object as TimestampObject, state);
            case 'entity':
                return this.exportEntity(object as EntityObject, state);
            case 'latex-fragment':
                return this.exportLatexFragment(object as LatexFragmentObject, state);
            case 'subscript':
                return this.exportSubscript(object as SubscriptObject, state);
            case 'superscript':
                return this.exportSuperscript(object as SuperscriptObject, state);
            case 'footnote-reference':
                return this.exportFootnoteReference(object as FootnoteReferenceObject, state);
            case 'statistics-cookie':
                return this.exportStatisticsCookie(object as StatisticsCookieObject, state);
            case 'target':
                return this.exportTarget(object as TargetObject, state);
            case 'radio-target':
                return this.exportRadioTarget(object as RadioTargetObject, state);
            case 'line-break':
                return '<br />\n';
            case 'plain-text': {
                const text = (object as PlainTextObject).properties.value;
                // Process editmarks on RAW text - the function handles HTML escaping internally
                // This is important because editmark comment syntax @@>text<@@ uses > and <
                // which would be escaped to &gt; and &lt; if we escaped first
                const htmlState = state as HtmlExportState;
                const editmarkMode = htmlState.htmlOptions?.editmarkMode || 'show';
                return processEditmarksHtml(text, editmarkMode);
            }
            case 'inline-src-block':
                return this.exportInlineSrcBlock(object as InlineSrcBlockObject, state);
            case 'inline-babel-call':
                return this.exportInlineBabelCall(object as InlineBabelCallObject, state);
            case 'export-snippet':
                return this.exportExportSnippet(object as ExportSnippetObject, state);
            case 'macro':
                return this.exportMacro(object as MacroObject, state);
            case 'table-cell':
                return this.exportTableCell(object as TableCellObject, state);
            case 'citation':
                return this.exportCitation(object as any, state);
            default:
                return `<!-- Unknown object type: ${object.type} -->`;
        }
    }

    /**
     * Export affiliated keywords
     */
    exportAffiliatedKeywords(affiliated: AffiliatedKeywords, state: ExportState): string {
        // For HTML, affiliated keywords are typically handled inline with the element
        // Caption and name are handled by the element exporters
        return '';
    }

    // =========================================================================
    // Element Exporters
    // =========================================================================

    private exportHeadline(headline: HeadlineElement, state: ExportState): string {
        const level = Math.min(headline.properties.level + state.headlineOffset, 6);
        const id = headline.properties.customId ||
            headline.properties.id ||
            generateId(headline.properties.rawValue);

        // Generate section number if enabled
        let numberLabel = '';
        if (state.options.sectionNumbers) {
            numberLabel = generateSectionNumber(headline.properties.level, state);
        }

        // Build title content
        let title = escapeString(headline.properties.rawValue, 'html');
        if (headline.properties.title) {
            title = exportObjects(headline.properties.title, this, state);
        }

        // Add TODO keyword if present (controlled by includeTodo option)
        if (headline.properties.todoKeyword && state.options.includeTodo !== false) {
            const todoType = headline.properties.todoType || 'todo';
            const keyword = headline.properties.todoKeyword.toUpperCase();
            // Use specific class for each keyword for targeted styling
            title = `<span class="org-todo-keyword org-todo-${todoType} org-kw-${keyword.toLowerCase()}">${escapeString(headline.properties.todoKeyword, 'html')}</span> ${title}`;
        }

        // Add priority if present (controlled by includePriority option)
        if (headline.properties.priority && state.options.includePriority === true) {
            title = `<span class="org-priority">[#${headline.properties.priority}]</span> ${title}`;
        }

        // Add section number
        if (numberLabel) {
            title = `<span class="section-number">${numberLabel}</span> ${title}`;
        }

        // Add tags (controlled by includeTags option)
        if (headline.properties.tags.length > 0 && state.options.includeTags !== false) {
            const tagsHtml = headline.properties.tags
                .map(tag => `<span class="org-tag">${escapeString(tag, 'html')}</span>`)
                .join('');
            title += `<span class="org-tags">${tagsHtml}</span>`;
        }

        const parts: string[] = [];

        // Opening div with id
        parts.push(`<div id="${id}" class="org-section org-level-${headline.properties.level}">`);

        // Headline
        parts.push(`<h${level}>${title}</h${level}>`);

        // Section content
        if (headline.section) {
            parts.push(this.exportSection(headline.section, state));
        }

        // Child headlines
        for (const child of headline.children) {
            if (shouldExport(child, state.options)) {
                parts.push(this.exportHeadline(child, state));
            }
        }

        parts.push('</div>');

        return parts.join('\n');
    }

    private exportSection(section: SectionElement, state: ExportState): string {
        const parts: string[] = [];
        for (const child of section.children) {
            parts.push(this.exportElement(child, state));
        }
        return parts.join('\n');
    }

    private exportParagraph(paragraph: ParagraphElement, state: ExportState): string {
        const content = exportObjects(paragraph.children, this, state);
        return `<p>${content}</p>\n`;
    }

    private exportSrcBlock(block: SrcBlockElement, state: ExportState): string {
        const lang = block.properties.language || 'text';
        const code = escapeString(block.properties.value, 'html');
        const langClass = `language-${lang}`;

        // Parse :exports header argument
        const params = block.properties.parameters || '';
        const exportsMatch = params.match(/:exports\s+(\w+)/i);
        const exports = exportsMatch ? exportsMatch[1].toLowerCase() : 'both';

        // Handle :exports none - skip both code and results
        if (exports === 'none') {
            state.skipNextResults = true;
            return '';
        }

        // Handle :exports results - skip code, include results
        if (exports === 'results') {
            state.skipNextResults = false; // Don't skip results
            return '';
        }

        // Handle :exports code - include code, skip results
        if (exports === 'code') {
            state.skipNextResults = true;
        } else {
            // :exports both (default) - include both
            state.skipNextResults = false;
        }

        let wrapper = '<div class="org-src-container">\n';

        // Add caption if present
        if (block.affiliated?.caption) {
            const caption = Array.isArray(block.affiliated.caption)
                ? block.affiliated.caption[1]
                : block.affiliated.caption;
            wrapper += `<div class="org-src-caption">${escapeString(caption, 'html')}</div>\n`;
        }

        // Add name anchor if present
        if (block.affiliated?.name) {
            wrapper += `<a id="${escapeString(block.affiliated.name, 'html')}"></a>\n`;
        }

        wrapper += `<pre class="src src-${lang}"><code class="${langClass}">${code}</code></pre>\n`;
        wrapper += '</div>\n';

        return wrapper;
    }

    private exportExampleBlock(block: ExampleBlockElement, state: ExportState): string {
        const content = escapeString(block.properties.value, 'html');
        return `<pre class="example">${content}</pre>\n`;
    }

    private exportQuoteBlock(block: QuoteBlockElement, state: ExportState): string {
        const content = block.children
            .map(child => this.exportElement(child, state))
            .join('\n');
        return `<blockquote>\n${content}</blockquote>\n`;
    }

    private exportCenterBlock(block: CenterBlockElement, state: ExportState): string {
        const content = block.children
            .map(child => this.exportElement(child, state))
            .join('\n');
        return `<div class="org-center">\n${content}</div>\n`;
    }

    private exportSpecialBlock(block: SpecialBlockElement, state: ExportState): string {
        const blockType = block.properties.blockType.toLowerCase();
        const content = block.children
            .map(child => this.exportElement(child, state))
            .join('\n');

        // Handle common special blocks
        switch (blockType) {
            case 'warning':
            case 'note':
            case 'tip':
            case 'important':
            case 'caution':
                return `<div class="org-${blockType} admonition">\n${content}</div>\n`;
            default:
                return `<div class="org-special-block org-${blockType}">\n${content}</div>\n`;
        }
    }

    private exportVerseBlock(block: VerseBlockElement, state: ExportState): string {
        // Preserve line breaks in verse blocks
        const lines = block.properties.value.split('\n');
        const content = lines
            .map(line => escapeString(line, 'html'))
            .join('<br />\n');
        return `<p class="verse">\n${content}</p>\n`;
    }

    private exportLatexEnvironment(env: LatexEnvironmentElement, state: ExportState): string {
        // LaTeX environments like equation, align, etc. define their own math mode
        // Don't wrap in \[...\] - that would create invalid nested display math
        // Don't escape - MathJax needs raw LaTeX content
        const value = env.properties.value;
        return `<div class="org-latex-environment">\n${value}\n</div>\n`;
    }

    private exportTable(table: TableElement, state: ExportState): string {
        // Skip tables if includeTables is false
        if (state.options.includeTables === false) {
            return '';
        }

        if (table.properties.tableType === 'table.el') {
            // table.el tables are pre-formatted
            return `<pre class="table-el">${escapeString(table.properties.value || '', 'html')}</pre>\n`;
        }

        let html = '<table class="org-table">\n';

        // Add caption if present
        if (table.affiliated?.caption) {
            const caption = Array.isArray(table.affiliated.caption)
                ? table.affiliated.caption[1]
                : table.affiliated.caption;
            html += `<caption>${escapeString(caption, 'html')}</caption>\n`;
        }

        // Track if we're in header (before first rule)
        let inHeader = true;
        let headerRows: TableRowElement[] = [];
        let bodyRows: TableRowElement[] = [];

        for (const row of table.children) {
            if (row.properties.rowType === 'rule') {
                inHeader = false;
                continue;
            }
            if (inHeader) {
                headerRows.push(row);
            } else {
                bodyRows.push(row);
            }
        }

        // If no rule found, treat all as body
        if (bodyRows.length === 0 && headerRows.length > 0) {
            bodyRows = headerRows;
            headerRows = [];
        }

        // Export header
        if (headerRows.length > 0) {
            html += '<thead>\n';
            for (const row of headerRows) {
                html += this.exportTableRow(row, state, true);
            }
            html += '</thead>\n';
        }

        // Export body
        if (bodyRows.length > 0) {
            html += '<tbody>\n';
            for (const row of bodyRows) {
                html += this.exportTableRow(row, state, false);
            }
            html += '</tbody>\n';
        }

        html += '</table>\n';
        return html;
    }

    private exportTableRow(row: TableRowElement, state: ExportState, isHeader: boolean): string {
        const tag = isHeader ? 'th' : 'td';
        const cells = row.children
            .map(cell => {
                const content = cell.children
                    ? exportObjects(cell.children, this, state)
                    : escapeString(cell.properties.value, 'html');
                return `<${tag}>${content}</${tag}>`;
            })
            .join('');
        return `<tr>${cells}</tr>\n`;
    }

    private exportPlainList(list: PlainListElement, state: ExportState): string {
        const listType = list.properties.listType;
        const tag = listType === 'ordered' ? 'ol' : (listType === 'descriptive' ? 'dl' : 'ul');

        let html = `<${tag}>\n`;

        for (const item of list.children) {
            html += this.exportListItem(item, state, listType);
        }

        html += `</${tag}>\n`;
        return html;
    }

    private exportListItem(item: ItemElement, state: ExportState, listType: string): string {
        let html = '';

        if (listType === 'descriptive') {
            const tag = item.properties.tag
                ? exportObjects(item.properties.tag, this, state)
                : '';
            html += `<dt>${tag}</dt>\n`;
            html += '<dd>';
        } else {
            html += '<li>';
            if (item.properties.checkbox) {
                const checked = item.properties.checkbox === 'on' ? 'checked' : '';
                const indeterminate = item.properties.checkbox === 'trans' ? 'class="indeterminate"' : '';
                html += `<input type="checkbox" ${checked} ${indeterminate} disabled /> `;
            }
        }

        // Export item content
        for (const child of item.children) {
            html += this.exportElement(child, state);
        }

        if (listType === 'descriptive') {
            html += '</dd>\n';
        } else {
            html += '</li>\n';
        }

        return html;
    }

    private exportDrawer(drawer: DrawerElement, state: ExportState): string {
        const drawerName = drawer.properties.name.toUpperCase();

        // Check includeDrawers option
        const includeDrawers = state.options.includeDrawers;

        // Skip all drawers if includeDrawers is false (the default)
        if (includeDrawers === false) {
            return '';
        }

        // If includeDrawers is an array, only include listed drawers
        if (Array.isArray(includeDrawers)) {
            if (!includeDrawers.some(d => d.toUpperCase() === drawerName)) {
                return '';
            }
        }

        // Skip PROPERTIES drawer always (it's metadata)
        if (drawerName === 'PROPERTIES') {
            return '';
        }

        // Export drawer contents
        const content: string[] = [];
        for (const child of drawer.children) {
            content.push(this.exportElement(child, state));
        }

        // LOGBOOK contains clock entries - check includeClocks
        if (drawerName === 'LOGBOOK') {
            if (state.options.includeClocks === false) {
                return '';
            }
            return `<div class="org-drawer org-logbook">\n${content.join('\n')}</div>\n`;
        }

        // Wrap in a generic drawer div
        return `<div class="org-drawer org-drawer-${drawerName.toLowerCase()}">\n${content.join('\n')}</div>\n`;
    }

    private exportKeyword(keyword: KeywordElement, state: ExportState): string {
        // Most keywords are metadata, not exported
        // Handle special cases
        if (keyword.properties.key === 'TOC') {
            // Explicit TOC placement
            return '<!-- TOC placeholder -->';
        }
        return '';
    }

    private exportFixedWidth(element: FixedWidthElement, state: ExportState): string {
        // Check if we should skip this results block (based on :exports header)
        if (state.skipNextResults) {
            state.skipNextResults = false; // Reset the flag
            return '';
        }

        const content = escapeString(element.properties.value, 'html');
        return `<pre class="fixed-width">${content}</pre>\n`;
    }

    private exportExportBlock(block: ExportBlockElement, state: ExportState): string {
        // Only export if backend matches
        if (block.properties.backend.toLowerCase() === 'html') {
            return block.properties.value + '\n';
        }
        return '';
    }

    // =========================================================================
    // Object Exporters
    // =========================================================================

    private exportBold(obj: BoldObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `<strong>${content}</strong>`;
    }

    private exportItalic(obj: ItalicObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `<em>${content}</em>`;
    }

    private exportUnderline(obj: UnderlineObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `<span class="org-underline">${content}</span>`;
    }

    private exportStrikeThrough(obj: StrikeThroughObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `<del>${content}</del>`;
    }

    private exportCode(obj: CodeObject, state: ExportState): string {
        return `<code>${escapeString(obj.properties.value, 'html')}</code>`;
    }

    private exportCommand(obj: CommandObject, state: ExportState): string {
        // Emacs-style command markup `command' - export as <kbd> element
        return `<kbd>${escapeString(obj.properties.value, 'html')}</kbd>`;
    }

    private exportVerbatim(obj: VerbatimObject, state: ExportState): string {
        return `<code class="verbatim">${escapeString(obj.properties.value, 'html')}</code>`;
    }

    private exportLink(link: LinkObject, state: ExportState): string {
        const { linkType, path, rawLink } = link.properties;

        // Check if this is a citation link
        if (linkType && CITATION_LINK_TYPES.has(linkType.toLowerCase())) {
            return this.exportCitationLink(link, state as HtmlExportState);
        }

        let href = path;
        let description = link.children
            ? exportObjects(link.children, this, state)
            : escapeString(rawLink || path, 'html');

        // Handle different link types
        switch (linkType) {
            case 'http':
                // HTTP/HTTPS links - use the path directly (includes protocol)
                href = path;
                break;
            case 'file':
                // Convert file links to relative paths
                // Strip file: prefix if present, convert .org/.md to .html
                href = path
                    .replace(/^file:/, '')
                    .replace(/\.(org|md)$/i, '.html');
                break;
            case 'id':
                // Look up ID in targets
                href = `#${path}`;
                break;
            case 'custom-id':
                // Custom ID reference (starts with #)
                href = path.startsWith('#') ? path : `#${path}`;
                break;
            case 'headline':
                // Headline reference (starts with *)
                const headlineText = path.startsWith('*') ? path.slice(1) : path;
                href = `#${generateId(headlineText)}`;
                break;
            case 'internal':
                href = `#${generateId(path)}`;
                break;
            case 'mailto':
                href = `mailto:${path}`;
                break;
            case 'fuzzy':
                // Fuzzy links - could be internal target or headline
                if (state.customIds.has(path)) {
                    href = `#${state.customIds.get(path)}`;
                } else if (state.targets.has(path)) {
                    href = `#${state.targets.get(path)}`;
                } else {
                    // Assume it's a headline reference
                    href = `#${generateId(path)}`;
                }
                break;
            case 'bibliography':
            case 'bibliographystyle':
            case 'bibstyle':
                // These are metadata links, don't render in HTML output
                // Bibliography content is generated separately from bib entries
                return '';
            default:
                // Check for custom ID or use as-is
                if (state.customIds.has(path)) {
                    href = `#${state.customIds.get(path)}`;
                } else {
                    href = rawLink || path;
                }
        }

        // Handle image links
        if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(path)) {
            const alt = link.children
                ? exportObjects(link.children, this, state)
                : '';
            return `<img src="${escapeString(href, 'html')}" alt="${alt}" />`;
        }

        return `<a href="${escapeString(href, 'html')}">${description}</a>`;
    }

    /**
     * Export a citation link (cite:key, citep:key, etc.)
     * Citations link to their corresponding bibliography entries via #ref-{key}
     * Each citation gets a unique ID for back-linking from bibliography
     */
    private exportCitationLink(link: LinkObject, state: HtmlExportState): string {
        const { linkType, path, rawLink } = link.properties;
        const command = linkType?.toLowerCase() || 'cite';

        // Generate unique citation ID
        state.citationCounter++;
        const citationId = `cite-${state.citationCounter}`;

        // Parse citation keys from the path
        // For org-ref links, path contains the keys (e.g., "key1,key2" or "&key1;&key2")
        const citationText = `${command}:${path}`;
        const parsedCitations = parseCitationsFromLine(citationText);

        if (parsedCitations.length === 0) {
            // Fallback: just show the keys as a simple citation with links
            const keys = path.replace(/^&/, '').split(/[,;]/).map(k => k.replace(/^&/, '').trim());

            // Track citation locations for back-links
            for (const key of keys) {
                if (!state.citationLocations.has(key)) {
                    state.citationLocations.set(key, []);
                }
                state.citationLocations.get(key)!.push(citationId);
            }

            const linkedKeys = keys.map(k => `<a href="#ref-${k}" class="citation-link">${k}</a>`);
            return `<span class="citation" id="${citationId}">(${linkedKeys.join(', ')})</span>`;
        }

        const citation = parsedCitations[0];
        const keys = citation.references.map(r => r.key);

        // Track citation locations for back-links
        for (const key of keys) {
            if (!state.citationLocations.has(key)) {
                state.citationLocations.set(key, []);
            }
            state.citationLocations.get(key)!.push(citationId);
        }

        // If we have a citation processor, use it for proper formatting
        if (state.citationProcessor) {
            const style = getNormalizedStyle(citation);

            // Format the citation
            const formatted = state.citationProcessor.formatCitationByKeys(
                keys,
                style as 'textual' | 'parenthetical' | 'author' | 'year'
            );

            // Wrap in link to first citation's bibliography entry
            // For single citations, link the whole thing; for multiple, link to first
            const primaryKey = keys[0];
            const linkedHtml = `<a href="#ref-${primaryKey}" class="citation-link">${formatted.html}</a>`;
            return `<span class="citation" id="${citationId}" data-keys="${keys.join(',')}">${linkedHtml}</span>`;
        }

        // Fallback without citation processor: basic formatting with links
        // Determine style based on command
        let prefix = '(';
        let suffix = ')';
        if (command === 'citet' || command === 'citeauthor') {
            prefix = '';
            suffix = '';
        }

        // Make each key a link to its bibliography entry
        const linkedKeys = keys.map(k => `<a href="#ref-${k}" class="citation-link">${k}</a>`);
        return `<span class="citation citation-${command}" id="${citationId}">${prefix}${linkedKeys.join(', ')}${suffix}</span>`;
    }

    private exportTimestamp(ts: TimestampObject, state: ExportState): string {
        if (!state.options.timestamps) {
            return '';
        }

        const isoDate = timestampToIso(ts);
        const displayDate = ts.properties.rawValue;

        return `<span class="org-timestamp"><time datetime="${isoDate}">${escapeString(displayDate, 'html')}</time></span>`;
    }

    private exportEntity(entity: EntityObject, state: ExportState): string {
        // Use HTML entity
        return entity.properties.html;
    }

    private exportLatexFragment(fragment: LatexFragmentObject, state: ExportState): string {
        const value = fragment.properties.value;

        switch (fragment.properties.fragmentType) {
            case 'inline-math':
                // For MathJax: normalize to \(...\)
                // Handle both $...$ (1-char delimiters) and \(...\) (2-char delimiters)
                if (value.startsWith('$')) {
                    return `\\(${escapeString(value.slice(1, -1), 'html')}\\)`;
                } else if (value.startsWith('\\(')) {
                    return `\\(${escapeString(value.slice(2, -2), 'html')}\\)`;
                }
                return escapeString(value, 'html');
            case 'display-math':
                // For MathJax: normalize to \[...\]
                // Handle both $$...$$ and \[...\]
                if (value.startsWith('$$')) {
                    return `\\[${escapeString(value.slice(2, -2), 'html')}\\]`;
                } else if (value.startsWith('\\[')) {
                    return `\\[${escapeString(value.slice(2, -2), 'html')}\\]`;
                }
                return escapeString(value, 'html');
            case 'command':
                // LaTeX commands - keep as-is for MathJax
                return escapeString(value, 'html');
            default:
                return escapeString(value, 'html');
        }
    }

    private exportSubscript(obj: SubscriptObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `<sub>${content}</sub>`;
    }

    private exportSuperscript(obj: SuperscriptObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `<sup>${content}</sup>`;
    }

    private exportFootnoteReference(ref: FootnoteReferenceObject, state: ExportState): string {
        const label = ref.properties.label || String(++state.footnoteCounter);

        // Track the reference
        const existing = state.footnotes.get(label);
        if (existing) {
            existing.references++;
        } else {
            state.footnotes.set(label, { references: 1 });
        }

        return `<sup><a href="#fn-${label}" id="fnr-${label}" class="org-footnote-ref">[${label}]</a></sup>`;
    }

    private exportStatisticsCookie(obj: StatisticsCookieObject, state: ExportState): string {
        return `<span class="org-statistics-cookie">${escapeString(obj.properties.value, 'html')}</span>`;
    }

    private exportTarget(obj: TargetObject, state: ExportState): string {
        const id = generateId(obj.properties.value);
        state.targets.set(obj.properties.value, id);
        return `<a id="${id}"></a>`;
    }

    private exportRadioTarget(obj: RadioTargetObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        const id = generateId(content);
        state.radioTargets.set(content, id);
        return `<a id="${id}">${content}</a>`;
    }

    private exportInlineSrcBlock(obj: InlineSrcBlockObject, state: ExportState): string {
        const lang = obj.properties.language;
        const code = escapeString(obj.properties.value, 'html');
        return `<code class="src src-${lang}">${code}</code>`;
    }

    private exportInlineBabelCall(obj: InlineBabelCallObject, state: ExportState): string {
        // Inline babel calls like call_name(args) - render as code
        let result = `call_${escapeString(obj.properties.call, 'html')}`;
        if (obj.properties.insideHeader) {
            result += `[${escapeString(obj.properties.insideHeader, 'html')}]`;
        }
        result += `(${escapeString(obj.properties.arguments || '', 'html')})`;
        if (obj.properties.endHeader) {
            result += `[${escapeString(obj.properties.endHeader, 'html')}]`;
        }
        return `<code class="babel-call">${result}</code>`;
    }

    private exportExportSnippet(obj: ExportSnippetObject, state: ExportState): string {
        // Only include if backend matches
        if (obj.properties.backend.toLowerCase() === 'html') {
            return obj.properties.value;
        }
        return '';
    }

    private exportMacro(obj: MacroObject, state: ExportState): string {
        if (!state.options.expandMacros) {
            return `{{{${obj.properties.key}(${obj.properties.args.join(',')})}}}`;
        }

        const macros = { ...BUILTIN_MACROS, ...state.options.macros };
        const expanded = expandMacro(obj.properties.key, obj.properties.args, macros);
        return escapeString(expanded, 'html');
    }

    private exportTableCell(cell: TableCellObject, state: ExportState): string {
        if (cell.children) {
            return exportObjects(cell.children, this, state);
        }
        return escapeString(cell.properties.value, 'html');
    }

    /**
     * Export org-cite citation to HTML
     * Renders as citation links similar to org-ref style
     */
    private exportCitation(citation: any, state: ExportState): string {
        const htmlState = state as HtmlExportState;
        const { style, keys } = citation.properties;

        if (!keys || keys.length === 0) {
            return escapeString(citation.properties.rawValue || '', 'html');
        }

        // Render as links to bibliography entries, similar to org-ref
        const keyLinks = keys.map((key: string) => {
            htmlState.citationCounter++;
            const citationId = `cite-${htmlState.citationCounter}`;
            const escapedKey = escapeString(key, 'html');
            return `<a id="${citationId}" href="#ref-${escapedKey}" class="org-ref-reference">${escapedKey}</a>`;
        });

        // Style determines how to join multiple citations
        if (style === 't' || style === 'text') {
            // Textual: Author (year) style - join with "and"
            return keyLinks.join(' and ');
        } else {
            // Parenthetical (default): (Author, year) style - join with semicolon in brackets
            return `(${keyLinks.join('; ')})`;
        }
    }

    // =========================================================================
    // Document Structure
    // =========================================================================

    private generateToc(doc: OrgDocumentNode, state: ExportState): string {
        if (state.tocEntries.length === 0) {
            return '';
        }

        const maxLevel = typeof state.options.toc === 'number'
            ? state.options.toc
            : 3;

        let html = '<nav id="table-of-contents" class="org-toc">\n';
        html += '<h2>Table of Contents</h2>\n';
        html += '<ul>\n';

        let prevLevel = 0;

        for (const entry of state.tocEntries) {
            if (entry.level > maxLevel) continue;

            while (prevLevel < entry.level) {
                html += '<ul>\n';
                prevLevel++;
            }
            while (prevLevel > entry.level) {
                html += '</ul>\n';
                prevLevel--;
            }

            const numberLabel = entry.numberLabel ? `${entry.numberLabel} ` : '';
            html += `<li><a href="#${entry.id}">${numberLabel}${escapeString(entry.title, 'html')}</a></li>\n`;
        }

        while (prevLevel > 0) {
            html += '</ul>\n';
            prevLevel--;
        }

        html += '</ul>\n</nav>\n';
        return html;
    }

    private exportFootnotes(state: ExportState): string {
        if (state.footnotes.size === 0 || state.options.footnotes === 'none') {
            return '';
        }

        let html = '<div id="footnotes" class="org-footnotes">\n';
        html += '<h2>Footnotes</h2>\n';

        for (const [label, info] of state.footnotes) {
            html += `<div id="fn-${label}" class="org-footnote">\n`;
            html += `<a href="#fnr-${label}">[${label}]</a> `;

            if (info.definition) {
                for (const el of info.definition) {
                    html += this.exportElement(el as OrgElement, state);
                }
            }

            html += '</div>\n';
        }

        html += '</div>\n';
        return html;
    }

    private wrapInHtmlDocument(
        content: string,
        meta: {
            title: string;
            author: string;
            date: string;
            language: string;
            email?: string;
        } & HtmlExportOptions,
        state: ExportState
    ): string {
        const parts: string[] = [];

        // Doctype
        parts.push(meta.doctype || '<!DOCTYPE html>');

        // HTML open
        parts.push(`<html lang="${meta.language}">`);

        // Head
        parts.push('<head>');
        parts.push('<meta charset="utf-8" />');
        parts.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
        parts.push(`<title>${escapeString(meta.title, 'html')}</title>`);

        if (meta.author) {
            parts.push(`<meta name="author" content="${escapeString(meta.author, 'html')}" />`);
        }

        // CSS files
        if (meta.cssFiles) {
            for (const css of meta.cssFiles) {
                parts.push(`<link rel="stylesheet" href="${css}" />`);
            }
        }

        // Inline CSS
        if (meta.css) {
            parts.push(`<style>${meta.css}</style>`);
        }

        // Default styles
        parts.push(this.getDefaultStyles());

        // MathJax
        if (meta.mathJax) {
            // Configure MathJax to recognize \(...\) and \[...\] delimiters
            // In the output HTML, we need: ['\\(', '\\)'] which means in JS template literal: ['\\\\(', '\\\\)']
            parts.push('<script>MathJax={tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]]}};</script>');
            parts.push(`<script id="MathJax-script" async src="${meta.mathJaxUrl}"></script>`);
        }

        // highlight.js
        if (meta.highlightJs) {
            parts.push(`<link rel="stylesheet" href="${meta.highlightJsUrl}/styles/default.min.css" />`);
            parts.push(`<script src="${meta.highlightJsUrl}/highlight.min.js"></script>`);
            parts.push('<script>hljs.highlightAll();</script>');
        }

        // Extra head content
        if (meta.headExtra) {
            parts.push(meta.headExtra);
        }

        parts.push('</head>');

        // Body
        parts.push('<body>');

        // Preamble
        if (meta.preamble && meta.preambleContent) {
            parts.push(`<div id="preamble">${meta.preambleContent}</div>`);
        }

        // Main content
        parts.push(`<main class="${meta.containerClass || 'org-content'}">`);

        // Title header
        parts.push('<header id="title-block">');
        parts.push(`<h1 class="title">${escapeString(meta.title, 'html')}</h1>`);

        // Include author if includeAuthor is not false
        if (meta.author && meta.includeAuthor !== false) {
            let authorHtml = escapeString(meta.author, 'html');
            // Include email if includeEmail is true
            if (meta.email && meta.includeEmail === true) {
                authorHtml += ` <a href="mailto:${escapeString(meta.email, 'html')}">&lt;${escapeString(meta.email, 'html')}&gt;</a>`;
            }
            parts.push(`<p class="author">${authorHtml}</p>`);
        }

        // Include date if includeDate is not false
        if (meta.date && meta.includeDate !== false) {
            parts.push(`<p class="date">${escapeString(meta.date, 'html')}</p>`);
        }
        parts.push('</header>');

        // Document content
        parts.push(content);

        parts.push('</main>');

        // Postamble
        if (meta.postamble) {
            const postambleContent = meta.postambleContent ||
                `<p>Generated by org-mode export</p>`;
            parts.push(`<footer id="postamble">${postambleContent}</footer>`);
        }

        // JS files
        if (meta.jsFiles) {
            for (const js of meta.jsFiles) {
                parts.push(`<script src="${js}"></script>`);
            }
        }

        // Inline JS
        if (meta.javascript) {
            parts.push(`<script>${meta.javascript}</script>`);
        }

        parts.push('</body>');
        parts.push('</html>');

        return parts.join('\n');
    }

    private getDefaultStyles(): string {
        return `<style>
.org-content { max-width: 800px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; line-height: 1.6; }
.org-section { margin-bottom: 2rem; }
.org-todo-keyword { font-weight: bold; padding: 0.1em 0.4em; border-radius: 3px; margin-right: 0.3em; }
.org-todo-todo { color: #c92a2a; }
.org-todo-done { color: #2f9e44; }
.org-kw-todo { color: #c92a2a; }
.org-kw-next { color: #1971c2; }
.org-kw-waiting { color: #e67700; }
.org-kw-done { color: #2f9e44; }
.org-kw-cancelled { color: #868e96; text-decoration: line-through; }
.org-priority { color: #e67700; font-weight: bold; }
.org-tags { float: right; font-size: 0.8em; }
.org-tag { background: #e9ecef; padding: 0.2em 0.5em; border-radius: 3px; margin-left: 0.3em; }
.org-timestamp { font-family: monospace; background: #f1f3f5; padding: 0.1em 0.3em; border-radius: 3px; }
.org-src-container { margin: 1rem 0; }
.src { background: #f8f9fa; padding: 1rem; border-radius: 4px; overflow-x: auto; }
pre.example { background: #fff3bf; padding: 1rem; border-radius: 4px; }
blockquote { border-left: 4px solid #ced4da; margin: 1rem 0; padding-left: 1rem; color: #495057; }
.org-center { text-align: center; }
.verse { white-space: pre-line; font-style: italic; }
.org-table { border-collapse: collapse; margin: 1rem 0; }
.org-table th, .org-table td { border: 1px solid #dee2e6; padding: 0.5rem; }
.org-table th { background: #f8f9fa; }
.org-footnote-ref { font-size: 0.8em; }
.org-footnotes { border-top: 1px solid #dee2e6; margin-top: 2rem; padding-top: 1rem; font-size: 0.9em; }
.org-underline { text-decoration: underline; }
.org-statistics-cookie { font-family: monospace; }
.org-toc { background: #f8f9fa; padding: 1rem; border-radius: 4px; margin-bottom: 2rem; }
.org-toc ul { list-style: none; padding-left: 1rem; }
.section-number { color: #868e96; margin-right: 0.5em; }
.admonition { padding: 1rem; margin: 1rem 0; border-radius: 4px; border-left: 4px solid; }
.admonition.org-warning { background: #fff5f5; border-color: #fa5252; }
.admonition.org-note { background: #e7f5ff; border-color: #339af0; }
.admonition.org-tip { background: #ebfbee; border-color: #40c057; }
.admonition.org-important { background: #fff9db; border-color: #fab005; }
/* Citation styles */
.citation { color: inherit; }
.citation a, .citation-link { color: #1971c2; text-decoration: none; }
.citation a:hover, .citation-link:hover { text-decoration: underline; }
.citation-missing { color: #c92a2a; font-style: italic; }
.citation.textual { }
.citation.author-only { }
.citation.year-only { }
/* Bibliography styles */
.bibliography { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #dee2e6; }
.bibliography h2 { font-size: 1.5rem; margin-bottom: 1rem; }
.bibliography .csl-entry { margin-bottom: 0.75rem; padding-left: 2em; text-indent: -2em; scroll-margin-top: 2rem; }
.bibliography .csl-entry:target { background-color: #fff3bf; transition: background-color 0.3s; }
.bibliography .csl-bib-body { font-size: 0.95em; }
/* Citation back-links */
.citation-backlinks { font-size: 0.85em; color: #868e96; margin-left: 0.5em; }
.citation-backlink { color: #1971c2; text-decoration: none; margin: 0 0.1em; }
.citation-backlink:hover { text-decoration: underline; }
/* Highlight citation when navigated to */
.citation { scroll-margin-top: 2rem; }
.citation:target { background-color: #fff3bf; transition: background-color 0.3s; }
${EDITMARK_CSS}
</style>`;
    }
}

// =============================================================================
// Export Function
// =============================================================================

/**
 * Export an org document to HTML
 */
export function exportToHtml(
    doc: OrgDocumentNode,
    options?: Partial<HtmlExportOptions>
): string {
    const backend = new HtmlExportBackend();
    return backend.exportDocument(doc, options);
}
