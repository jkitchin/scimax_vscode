/**
 * LaTeX export backend for org-mode documents
 * Converts org AST to LaTeX for PDF generation
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
    exportObjects,
    shouldExport,
    expandMacro,
    BUILTIN_MACROS,
    collectTargets,
    collectFootnotes,
    parseOptionsKeyword,
} from './orgExport';

// =============================================================================
// LaTeX Export Options
// =============================================================================

export interface LatexExportOptions extends ExportOptions {
    /** Document class */
    documentClass?: string;
    /** Document class options */
    classOptions?: string[];
    /** Additional packages to include */
    packages?: string[];
    /** Custom preamble content (added after auto-generated packages) */
    preamble?: string;
    /** Complete custom header (replaces entire auto-generated preamble, should include documentclass through packages) */
    customHeader?: string;
    /** Use hyperref package */
    hyperref?: boolean;
    /** Hyperref options */
    hyperrefOptions?: Record<string, string>;
    /** Use listings package for code */
    listings?: boolean;
    /** Use minted package for code */
    minted?: boolean;
    /** Default image width */
    imageWidth?: string;
    /** Float placement preference */
    floatPlacement?: string;
    /** Use booktabs for tables */
    booktabs?: boolean;
    /** Bibliography style */
    bibStyle?: string;
    /** Bibliography file */
    bibFile?: string;
    /** Section numbering depth */
    secNumDepth?: number;
    /** TOC depth */
    tocDepth?: number;
    /** Headline level to start with (1 = \section, 0 = \chapter) */
    headlineStartLevel?: number;
    /** Export only the body (no preamble/document environment) */
    bodyOnly?: boolean;
    /** Disable all default packages (user must provide all packages via LATEX_HEADER) */
    noDefaults?: boolean;
}

const DEFAULT_LATEX_OPTIONS: LatexExportOptions = {
    documentClass: 'article',
    classOptions: ['11pt', 'a4paper'],
    packages: [],
    hyperref: true,
    hyperrefOptions: {
        linktocpage: '',
        pdfstartview: 'FitH',
        colorlinks: '',
        linkcolor: 'blue',
        anchorcolor: 'blue',
        citecolor: 'blue',
        filecolor: 'blue',
        menucolor: 'blue',
        urlcolor: 'blue',
    },
    listings: false,
    minted: true,
    imageWidth: '0.8\\textwidth',
    floatPlacement: 'htbp',
    booktabs: true,
    secNumDepth: 3,
    tocDepth: 3,
    headlineStartLevel: 1,
};

// =============================================================================
// LaTeX Sectioning Commands
// =============================================================================

const LATEX_SECTIONS = [
    '\\part',
    '\\chapter',
    '\\section',
    '\\subsection',
    '\\subsubsection',
    '\\paragraph',
    '\\subparagraph',
];

// =============================================================================
// LaTeX Export Backend
// =============================================================================

export class LatexExportBackend implements ExportBackend {
    public readonly name = 'latex';

    /**
     * Export a complete document to LaTeX
     *
     * Priority for options (highest to lowest):
     * 1. Document keywords (#+LATEX_CLASS:, #+LATEX_CLASS_OPTIONS:, #+LATEX_HEADER:)
     * 2. Options parameter (from VS Code settings or explicit call)
     * 3. DEFAULT_LATEX_OPTIONS (built-in defaults)
     */
    exportDocument(doc: OrgDocumentNode, options?: Partial<LatexExportOptions>): string {
        // Document keywords have highest priority, then options, then defaults
        const documentClass = doc.keywords['LATEX_CLASS'] || options?.documentClass || DEFAULT_LATEX_OPTIONS.documentClass;

        // Parse class options from #+LATEX_CLASS_OPTIONS: [12pt,twocolumn]
        // Document keyword has highest priority
        let classOptions = options?.classOptions || DEFAULT_LATEX_OPTIONS.classOptions;
        const classOptsKeyword = doc.keywords['LATEX_CLASS_OPTIONS'];
        if (classOptsKeyword) {
            // Parse [opt1,opt2,...] format - document keyword overrides options
            const match = classOptsKeyword.match(/^\[([^\]]*)\]$/);
            if (match) {
                classOptions = match[1].split(',').map(s => s.trim()).filter(s => s);
            }
        }

        // Collect LATEX_HEADER lines and append to preamble (options preamble + document headers)
        const latexHeaders = doc.keywordLists?.['LATEX_HEADER'] || [];
        const existingPreamble = options?.preamble || '';
        const preamble = latexHeaders.length > 0
            ? (existingPreamble ? existingPreamble + '\n' : '') + latexHeaders.join('\n')
            : existingPreamble;

        // Check for LATEX_NO_DEFAULTS keyword
        const noDefaultsKeyword = doc.keywords['LATEX_NO_DEFAULTS'];
        const noDefaults = options?.noDefaults || (noDefaultsKeyword === 't' || noDefaultsKeyword === 'true');

        // Parse #+OPTIONS: keyword if present
        const optionsKeyword = doc.keywords['OPTIONS'];
        const parsedOptions = optionsKeyword ? parseOptionsKeyword(optionsKeyword) : {};

        const opts: LatexExportOptions = {
            ...DEFAULT_LATEX_OPTIONS,
            ...parsedOptions,  // OPTIONS keyword values
            ...options,        // Explicit options override OPTIONS
            documentClass,
            classOptions,
            preamble,
            noDefaults,
            backend: 'latex',
        };
        const state = createExportState(opts);

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
        const title = opts.title || doc.keywords['TITLE'] || '';
        const author = opts.author || doc.keywords['AUTHOR'] || '';
        const email = opts.email || doc.keywords['EMAIL'] || '';
        const date = opts.date || doc.keywords['DATE'] || '\\today';

        // Build content
        const content = this.exportDocumentContent(doc, state, opts);

        // If bodyOnly is requested, return just the content without preamble/document wrapper
        if (opts.bodyOnly) {
            return content;
        }

        return this.wrapInLatexDocument(content, {
            title,
            author,
            email,
            date,
            ...opts,
        }, state);
    }

    /**
     * Export document content (without preamble)
     */
    private exportDocumentContent(
        doc: OrgDocumentNode,
        state: ExportState,
        opts: LatexExportOptions
    ): string {
        const parts: string[] = [];

        // Export preamble section if present
        if (doc.section) {
            const sectionContent = this.exportSection(doc.section, state);
            if (sectionContent.trim()) {
                parts.push(sectionContent);
            }
        }

        // Export headlines
        for (const headline of doc.children) {
            if (shouldExport(headline, state.options)) {
                parts.push(this.exportHeadline(headline, state, opts));
            }
        }

        return parts.join('\n\n');
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
        const opts = state.options as LatexExportOptions;

        switch (element.type) {
            case 'headline':
                return this.exportHeadline(element as HeadlineElement, state, opts);
            case 'section':
                return this.exportSection(element as SectionElement, state);
            case 'paragraph':
                return this.exportParagraph(element as ParagraphElement, state);
            case 'src-block':
                return this.exportSrcBlock(element as SrcBlockElement, state, opts);
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
                return this.exportTable(element as TableElement, state, opts);
            case 'plain-list':
                return this.exportPlainList(element as PlainListElement, state);
            case 'drawer':
                return this.exportDrawer(element as DrawerElement, state);
            case 'keyword':
                return this.exportKeyword(element as KeywordElement, state);
            case 'horizontal-rule':
                return '\\noindent\\rule{\\textwidth}{0.4pt}\n';
            case 'comment-block':
                return ''; // Comments not exported
            case 'fixed-width':
                return this.exportFixedWidth(element as FixedWidthElement, state);
            case 'footnote-definition':
                return ''; // Handled via \footnote commands
            case 'export-block':
                return this.exportExportBlock(element as ExportBlockElement, state);
            default:
                return `% Unknown element type: ${element.type}\n`;
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
                return '\\\\\n';
            case 'plain-text':
                return escapeString((object as PlainTextObject).properties.value, 'latex');
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
                return `% Unknown object type: ${object.type}`;
        }
    }

    /**
     * Export affiliated keywords for LaTeX
     */
    exportAffiliatedKeywords(affiliated: AffiliatedKeywords, state: ExportState): string {
        // Most affiliated keywords are handled inline with the element
        // Return empty - specific elements handle their own affiliated keywords
        return '';
    }

    // =========================================================================
    // Element Exporters
    // =========================================================================

    private exportHeadline(
        headline: HeadlineElement,
        state: ExportState,
        opts: LatexExportOptions
    ): string {
        const level = headline.properties.level;
        const startLevel = opts.headlineStartLevel || 1;
        const sectionIndex = Math.min(level + startLevel, LATEX_SECTIONS.length - 1);
        const sectionCmd = LATEX_SECTIONS[sectionIndex];

        // Build title content
        let title = headline.properties.title
            ? exportObjects(headline.properties.title, this, state)
            : escapeString(headline.properties.rawValue, 'latex');

        // Add TODO keyword if present (controlled by includeTodo option)
        if (headline.properties.todoKeyword && state.options.includeTodo !== false) {
            title = `\\textbf{${headline.properties.todoKeyword}} ${title}`;
        }

        // Add priority cookie if present (controlled by includePriority option)
        if (headline.properties.priority && state.options.includePriority === true) {
            title = `[\\#${headline.properties.priority}] ${title}`;
        }

        // Add tags if present (controlled by includeTags option)
        const tags = headline.properties.tags;
        if (tags.length > 0 && state.options.includeTags !== false) {
            const tagsStr = tags.map(t => escapeString(t, 'latex')).join(':');
            title = `${title} \\hfill :${tagsStr}:`;
        }

        const parts: string[] = [];

        // Section command
        const starred = tags.includes('nonum') ? '*' : '';
        parts.push(`${sectionCmd}${starred}{${title}}`);

        // Add label for cross-references
        // Must match collectTargets() ID generation for [[*Headline]] links to work
        const label = headline.properties.customId ||
            headline.properties.id ||
            generateId(headline.properties.rawValue);
        parts.push(`\\label{${label}}`);

        // Section content
        if (headline.section) {
            parts.push(this.exportSection(headline.section, state));
        }

        // Child headlines
        for (const child of headline.children) {
            if (shouldExport(child, state.options)) {
                parts.push(this.exportHeadline(child, state, opts));
            }
        }

        return parts.join('\n');
    }

    private exportSection(section: SectionElement, state: ExportState): string {
        const parts: string[] = [];
        for (const child of section.children) {
            parts.push(this.exportElement(child, state));
        }
        return parts.join('\n\n');
    }

    private exportParagraph(paragraph: ParagraphElement, state: ExportState): string {
        // Pass affiliated keywords to child objects (for image captions)
        const previousAffiliated = state.currentAffiliated;
        state.currentAffiliated = paragraph.affiliated;

        const content = exportObjects(paragraph.children, this, state);

        // Restore previous state
        state.currentAffiliated = previousAffiliated;

        return content + '\n';
    }

    private exportSrcBlock(
        block: SrcBlockElement,
        state: ExportState,
        opts: LatexExportOptions
    ): string {
        const lang = block.properties.language || 'text';
        const code = block.properties.value;

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

        // Check for affiliated keywords
        let wrapper = '';
        let endWrapper = '';

        if (block.affiliated?.caption || block.affiliated?.name) {
            wrapper = '\\begin{figure}[' + (opts.floatPlacement || 'htbp') + ']\n';
            endWrapper = '';

            if (block.affiliated.caption) {
                const caption = Array.isArray(block.affiliated.caption)
                    ? block.affiliated.caption[1]
                    : block.affiliated.caption;
                endWrapper += `\\caption{${escapeString(caption, 'latex')}}\n`;
            }

            if (block.affiliated.name) {
                endWrapper += `\\label{${block.affiliated.name}}\n`;
            }

            endWrapper += '\\end{figure}\n';
        }

        // Use minted or listings
        let codeBlock: string;
        if (opts.minted) {
            const mintedLang = this.mapLanguageForMinted(lang);
            codeBlock = `\\begin{minted}{${mintedLang}}\n${code}\n\\end{minted}`;
        } else if (opts.listings) {
            codeBlock = `\\begin{lstlisting}[language=${this.mapLanguage(lang)}]\n${code}\n\\end{lstlisting}`;
        } else {
            // Fallback to verbatim
            codeBlock = `\\begin{verbatim}\n${code}\n\\end{verbatim}`;
        }

        return wrapper + codeBlock + endWrapper;
    }

    private exportExampleBlock(block: ExampleBlockElement, state: ExportState): string {
        return `\\begin{verbatim}\n${block.properties.value}\n\\end{verbatim}\n`;
    }

    private exportQuoteBlock(block: QuoteBlockElement, state: ExportState): string {
        const content = block.children
            .map(child => this.exportElement(child, state))
            .join('\n');
        return `\\begin{quote}\n${content}\\end{quote}\n`;
    }

    private exportCenterBlock(block: CenterBlockElement, state: ExportState): string {
        const content = block.children
            .map(child => this.exportElement(child, state))
            .join('\n');
        return `\\begin{center}\n${content}\\end{center}\n`;
    }

    private exportSpecialBlock(block: SpecialBlockElement, state: ExportState): string {
        const blockType = block.properties.blockType.toLowerCase();
        const content = block.children
            .map(child => this.exportElement(child, state))
            .join('\n');

        // Handle common special blocks
        switch (blockType) {
            case 'abstract':
                return `\\begin{abstract}\n${content}\\end{abstract}\n`;
            case 'proof':
                return `\\begin{proof}\n${content}\\end{proof}\n`;
            case 'theorem':
            case 'lemma':
            case 'corollary':
            case 'definition':
            case 'example':
            case 'remark':
                return `\\begin{${blockType}}\n${content}\\end{${blockType}}\n`;
            case 'warning':
            case 'note':
            case 'tip':
            case 'important':
            case 'caution':
                // Use a custom environment or tcolorbox if available
                return `\\begin{tcolorbox}[title=${blockType.charAt(0).toUpperCase() + blockType.slice(1)}]\n${content}\\end{tcolorbox}\n`;
            default:
                // Try to use as environment name
                return `\\begin{${blockType}}\n${content}\\end{${blockType}}\n`;
        }
    }

    private exportVerseBlock(block: VerseBlockElement, state: ExportState): string {
        const lines = block.properties.value.split('\n');
        const content = lines
            .map(line => escapeString(line, 'latex'))
            .join(' \\\\\n');
        return `\\begin{verse}\n${content}\n\\end{verse}\n`;
    }

    private exportLatexEnvironment(env: LatexEnvironmentElement, state: ExportState): string {
        // Already valid LaTeX, pass through
        return env.properties.value + '\n';
    }

    private exportTable(
        table: TableElement,
        state: ExportState,
        opts: LatexExportOptions
    ): string {
        // Skip tables if includeTables is false
        if (state.options.includeTables === false) {
            return '';
        }

        if (table.properties.tableType === 'table.el') {
            return `\\begin{verbatim}\n${table.properties.value || ''}\n\\end{verbatim}\n`;
        }

        // Determine column count
        const firstDataRow = table.children.find(r => r.properties.rowType === 'standard');
        const colCount = firstDataRow?.children.length || 1;
        const colSpec = 'l'.repeat(colCount);

        // Check for affiliated keywords
        let wrapper = '';
        let endWrapper = '';

        if (table.affiliated?.caption || table.affiliated?.name) {
            wrapper = '\\begin{table}[' + (opts.floatPlacement || 'htbp') + ']\n\\centering\n';
            endWrapper = '';

            if (table.affiliated.caption) {
                const caption = Array.isArray(table.affiliated.caption)
                    ? table.affiliated.caption[1]
                    : table.affiliated.caption;
                endWrapper += `\\caption{${escapeString(caption, 'latex')}}\n`;
            }

            if (table.affiliated.name) {
                endWrapper += `\\label{${table.affiliated.name}}\n`;
            }

            endWrapper += '\\end{table}\n';
        }

        // Apply ATTR_LATEX options
        let actualColSpec = colSpec;
        let width = '';
        if (table.affiliated?.attr?.latex) {
            const latexAttr = table.affiliated.attr.latex;
            if (latexAttr.align) {
                actualColSpec = latexAttr.align;
            }
            if (latexAttr.width) {
                width = latexAttr.width;
            }
        }

        // Build table content
        let tabular = '';
        if (opts.booktabs) {
            tabular = `\\begin{tabular}{${actualColSpec}}\n\\toprule\n`;
        } else {
            tabular = `\\begin{tabular}{${actualColSpec}}\n\\hline\n`;
        }

        let inHeader = true;

        for (const row of table.children) {
            if (row.properties.rowType === 'rule') {
                if (opts.booktabs) {
                    tabular += inHeader ? '\\midrule\n' : '\\midrule\n';
                } else {
                    tabular += '\\hline\n';
                }
                inHeader = false;
                continue;
            }

            const cells = row.children.map(cell => {
                if (cell.children) {
                    return exportObjects(cell.children, this, state);
                }
                return escapeString(cell.properties.value, 'latex');
            });

            tabular += cells.join(' & ') + ' \\\\\n';
        }

        if (opts.booktabs) {
            tabular += '\\bottomrule\n';
        } else {
            tabular += '\\hline\n';
        }

        tabular += '\\end{tabular}\n';

        return wrapper + tabular + endWrapper;
    }

    private exportPlainList(list: PlainListElement, state: ExportState): string {
        const listType = list.properties.listType;
        let envName: string;

        switch (listType) {
            case 'ordered':
                envName = 'enumerate';
                break;
            case 'descriptive':
                envName = 'description';
                break;
            default:
                envName = 'itemize';
        }

        let latex = `\\begin{${envName}}\n`;

        for (const item of list.children) {
            latex += this.exportListItem(item, state, listType);
        }

        latex += `\\end{${envName}}\n`;
        return latex;
    }

    private exportListItem(item: ItemElement, state: ExportState, listType: string): string {
        let latex = '';

        if (listType === 'descriptive' && item.properties.tag) {
            const tag = exportObjects(item.properties.tag, this, state);
            latex = `\\item[${tag}] `;
        } else {
            latex = '\\item ';
            if (item.properties.checkbox) {
                const box = item.properties.checkbox === 'on' ? '$\\boxtimes$' :
                    item.properties.checkbox === 'trans' ? '$\\boxminus$' :
                        '$\\square$';
                latex += box + ' ';
            }
        }

        // Export item content
        for (const child of item.children) {
            latex += this.exportElement(child, state);
        }

        return latex + '\n';
    }

    private exportDrawer(drawer: DrawerElement, state: ExportState): string {
        const drawerName = drawer.properties.name.toUpperCase();

        // Check includeDrawers option
        const includeDrawers = state.options.includeDrawers;

        // Skip all drawers if includeDrawers is false
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
        let content = '';
        for (const child of drawer.children) {
            content += this.exportElement(child, state);
        }

        // Wrap in a comment block or environment based on drawer type
        if (drawerName === 'LOGBOOK') {
            // LOGBOOK contains clock entries
            if (state.options.includeClocks === false) {
                return '';
            }
            return `% LOGBOOK\n${content}`;
        }

        return content;
    }

    private exportKeyword(keyword: KeywordElement, state: ExportState): string {
        // Most keywords are metadata
        if (keyword.properties.key === 'TOC') {
            return '\\tableofcontents\n';
        }
        return '';
    }

    private exportFixedWidth(element: FixedWidthElement, state: ExportState): string {
        // Check if we should skip this results block (based on :exports header)
        if (state.skipNextResults) {
            state.skipNextResults = false; // Reset the flag
            return '';
        }

        return `\\begin{verbatim}\n${element.properties.value}\n\\end{verbatim}\n`;
    }

    private exportExportBlock(block: ExportBlockElement, state: ExportState): string {
        if (block.properties.backend.toLowerCase() === 'latex') {
            return block.properties.value + '\n';
        }
        return '';
    }

    // =========================================================================
    // Object Exporters
    // =========================================================================

    private exportBold(obj: BoldObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `\\textbf{${content}}`;
    }

    private exportItalic(obj: ItalicObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `\\textit{${content}}`;
    }

    private exportUnderline(obj: UnderlineObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `\\underline{${content}}`;
    }

    private exportStrikeThrough(obj: StrikeThroughObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `\\sout{${content}}`;
    }

    private exportCode(obj: CodeObject, state: ExportState): string {
        // Use verb for inline code, handling special characters
        const value = obj.properties.value;
        // Find a delimiter not in the content
        const delimiters = '|!@#$%^&*()_+-=[]{}:;<>,.?/';
        let delimiter = '|';
        for (const d of delimiters) {
            if (!value.includes(d)) {
                delimiter = d;
                break;
            }
        }
        return `\\verb${delimiter}${value}${delimiter}`;
    }

    private exportCommand(obj: CommandObject, state: ExportState): string {
        // Emacs-style command markup `command' - export as \texttt{}
        return `\\texttt{${escapeString(obj.properties.value, 'latex')}}`;
    }

    private exportVerbatim(obj: VerbatimObject, state: ExportState): string {
        return `\\texttt{${escapeString(obj.properties.value, 'latex')}}`;
    }

    private exportLink(link: LinkObject, state: ExportState): string {
        const { linkType, path, rawLink } = link.properties;

        let description = link.children
            ? exportObjects(link.children, this, state)
            : escapeString(rawLink || path, 'latex');

        // Handle different link types
        switch (linkType) {
            case 'http':
            case 'https':
                const url = escapeString(rawLink || path, 'latex');
                if (link.children) {
                    return `\\href{${url}}{${description}}`;
                }
                return `\\url{${url}}`;

            case 'file':
                // Check if it's an image
                if (/\.(png|jpg|jpeg|gif|pdf|eps|svg)$/i.test(path)) {
                    return this.exportImage(path, link, state);
                }
                return `\\href{file:${escapeString(path, 'latex')}}{${description}}`;

            case 'id':
            case 'internal':
                return `\\hyperref[${path}]{${description}}`;

            case 'headline':
                // Link to headline: [[*Headline Text]] -> \hyperref[label]{description}
                // Remove leading * to get headline text
                const headlineText = path.startsWith('*') ? path.slice(1) : path;
                // Look up the headline's label from state.targets (populated by collectTargets)
                const headlineId = state.targets.get(headlineText) || generateId(headlineText);
                // Use headline text as description if no explicit description
                const headlineDesc = link.children
                    ? exportObjects(link.children, this, state)
                    : escapeString(headlineText, 'latex');
                return `\\hyperref[${headlineId}]{${headlineDesc}}`;

            case 'custom-id':
                // Link to custom ID: [[#custom-id]] -> \hyperref[custom-id]{description}
                const customId = path.startsWith('#') ? path.slice(1) : path;
                return `\\hyperref[${customId}]{${description}}`;

            case 'fuzzy':
                // Fuzzy link - could be to a target, headline, or other element
                // Use path as description if no explicit description
                const fuzzyDesc = link.children
                    ? exportObjects(link.children, this, state)
                    : escapeString(path, 'latex');
                // Try to find in targets first, then customIds
                if (state.targets.has(path)) {
                    return `\\hyperref[${state.targets.get(path)}]{${fuzzyDesc}}`;
                }
                if (state.customIds.has(path)) {
                    return `\\hyperref[${state.customIds.get(path)}]{${fuzzyDesc}}`;
                }
                // Generate an ID from the path and hope it matches
                const fuzzyId = generateId(path);
                return `\\hyperref[${fuzzyId}]{${fuzzyDesc}}`;

            case 'mailto':
                return `\\href{mailto:${path}}{${description}}`;

            case 'doi':
                // DOI links - use href to doi.org
                return `\\href{https://doi.org/${path}}{${description}}`;

            // Citation types - org-ref style
            case 'cite':
                return `\\cite{${path}}`;
            case 'citep':
            case 'Citep':
                return `\\citep{${path}}`;
            case 'citet':
            case 'Citet':
                return `\\citet{${path}}`;
            case 'citeauthor':
                return `\\citeauthor{${path}}`;
            case 'citeyear':
                return `\\citeyear{${path}}`;
            case 'citealp':
                return `\\citealp{${path}}`;
            case 'citealt':
                return `\\citealt{${path}}`;

            // Cross-reference types - org-ref style
            case 'ref':
                return `\\ref{${path}}`;
            case 'eqref':
                return `\\eqref{${path}}`;
            case 'pageref':
                return `\\pageref{${path}}`;
            case 'nameref':
                return `\\nameref{${path}}`;
            case 'autoref':
                return `\\autoref{${path}}`;
            case 'cref':
                return `\\cref{${path}}`;
            case 'Cref':
                return `\\Cref{${path}}`;
            case 'label':
                return `\\label{${path}}`;

            case 'bibliography':
                // bibliography:file1.bib,file2.bib -> \bibliography{file1,file2}
                // Expand ~ to home directory and remove .bib extensions
                const homeDir = process.env.HOME || process.env.USERPROFILE || '';
                const bibFiles = path.split(',').map(f => {
                    let bibPath = f.trim();
                    if (bibPath.startsWith('~')) {
                        bibPath = bibPath.replace('~', homeDir);
                    }
                    return bibPath.replace(/\.bib$/i, '');
                });
                return `\\bibliography{${bibFiles.join(',')}}`;

            case 'bibstyle':
                // bibstyle:unsrtnat -> \bibliographystyle{unsrtnat}
                return `\\bibliographystyle{${path}}`;

            default:
                // Check for cross-reference
                if (state.customIds.has(path)) {
                    return `\\ref{${path}}`;
                }
                return description;
        }
    }

    private exportImage(path: string, link: LinkObject, state: ExportState): string {
        const opts = state.options as LatexExportOptions;
        let width = opts.imageWidth || '0.8\\textwidth';
        let placement = opts.floatPlacement || 'htbp';
        let caption = '';
        let label = '';

        // Extract from affiliated keywords if available
        const affiliated = state.currentAffiliated;
        if (affiliated) {
            // Get caption - can be string or [short, long] array
            if (affiliated.caption) {
                caption = Array.isArray(affiliated.caption)
                    ? affiliated.caption[1]  // Use long caption
                    : affiliated.caption;
            }
            // Get label from #+NAME:
            if (affiliated.name) {
                label = affiliated.name;
            }
            // Check for #+ATTR_LATEX options
            if (affiliated.attr.latex) {
                if (affiliated.attr.latex.width) {
                    width = affiliated.attr.latex.width;
                }
                if (affiliated.attr.latex.placement) {
                    placement = affiliated.attr.latex.placement;
                }
            }
        }

        let latex = `\\begin{figure}[${placement}]\n`;
        latex += '\\centering\n';
        latex += `\\includegraphics[width=${width}]{${escapeString(path, 'latex')}}\n`;

        if (caption) {
            latex += `\\caption{${escapeString(caption, 'latex')}}\n`;
        }
        if (label) {
            latex += `\\label{${escapeString(label, 'latex')}}\n`;
        }

        latex += '\\end{figure}';
        return latex;
    }

    private exportTimestamp(ts: TimestampObject, state: ExportState): string {
        if (!state.options.timestamps) {
            return '';
        }
        return `\\texttt{${escapeString(ts.properties.rawValue, 'latex')}}`;
    }

    private exportEntity(entity: EntityObject, state: ExportState): string {
        // Use LaTeX representation directly
        return entity.properties.latex;
    }

    private exportLatexFragment(fragment: LatexFragmentObject, state: ExportState): string {
        // Already valid LaTeX
        return fragment.properties.value;
    }

    private exportSubscript(obj: SubscriptObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `\\textsubscript{${content}}`;
    }

    private exportSuperscript(obj: SuperscriptObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        return `\\textsuperscript{${content}}`;
    }

    private exportFootnoteReference(ref: FootnoteReferenceObject, state: ExportState): string {
        const label = ref.properties.label || String(++state.footnoteCounter);

        // Get the footnote definition
        const footnote = state.footnotes.get(label);
        if (footnote?.definition) {
            const content = footnote.definition
                .map(el => this.exportElement(el as OrgElement, state))
                .join('');
            return `\\footnote{${content.trim()}}`;
        }

        // Inline footnote
        if (ref.children) {
            const content = exportObjects(ref.children, this, state);
            return `\\footnote{${content}}`;
        }

        return `\\footnotemark[${label}]`;
    }

    private exportStatisticsCookie(obj: StatisticsCookieObject, state: ExportState): string {
        // Statistics cookies are tied to planning info - hide when p:nil
        if (state.options.includePlanning === false) {
            return '';
        }
        return `\\texttt{${escapeString(obj.properties.value, 'latex')}}`;
    }

    private exportTarget(obj: TargetObject, state: ExportState): string {
        const id = generateId(obj.properties.value);
        state.targets.set(obj.properties.value, id);
        return `\\label{${id}}`;
    }

    private exportRadioTarget(obj: RadioTargetObject, state: ExportState): string {
        const content = exportObjects(obj.children, this, state);
        const id = generateId(content);
        state.radioTargets.set(content, id);
        return `\\label{${id}}${content}`;
    }

    private exportInlineSrcBlock(obj: InlineSrcBlockObject, state: ExportState): string {
        const value = obj.properties.value;
        return `\\texttt{${escapeString(value, 'latex')}}`;
    }

    private exportInlineBabelCall(obj: InlineBabelCallObject, state: ExportState): string {
        // Inline babel calls like call_name(args) - render as code
        let result = `call\\_${escapeString(obj.properties.call, 'latex')}`;
        if (obj.properties.insideHeader) {
            result += `[${escapeString(obj.properties.insideHeader, 'latex')}]`;
        }
        result += `(${escapeString(obj.properties.arguments || '', 'latex')})`;
        if (obj.properties.endHeader) {
            result += `[${escapeString(obj.properties.endHeader, 'latex')}]`;
        }
        return `\\texttt{${result}}`;
    }

    private exportExportSnippet(obj: ExportSnippetObject, state: ExportState): string {
        if (obj.properties.backend.toLowerCase() === 'latex') {
            return obj.properties.value;
        }
        return '';
    }

    private exportMacro(obj: MacroObject, state: ExportState): string {
        if (!state.options.expandMacros) {
            return `\\{\\{\\{${obj.properties.key}(${obj.properties.args.join(',')})\\}\\}\\}`;
        }

        const macros = { ...BUILTIN_MACROS, ...state.options.macros };
        const expanded = expandMacro(obj.properties.key, obj.properties.args, macros);
        return escapeString(expanded, 'latex');
    }

    private exportTableCell(cell: TableCellObject, state: ExportState): string {
        if (cell.children) {
            return exportObjects(cell.children, this, state);
        }
        return escapeString(cell.properties.value, 'latex');
    }

    /**
     * Export org-cite citation to LaTeX
     * Converts [cite:@key] to \cite{key}, with style variants
     */
    private exportCitation(citation: any, state: ExportState): string {
        const { style, keys } = citation.properties;

        if (!keys || keys.length === 0) {
            return citation.properties.rawValue || '';
        }

        const keyStr = keys.join(',');

        // Map org-cite styles to LaTeX commands
        // See https://orgmode.org/manual/Citation-handling.html
        switch (style) {
            case 't':
            case 'text':
                return `\\citet{${keyStr}}`;
            case 'a':
            case 'author':
                return `\\citeauthor{${keyStr}}`;
            case 'na':
            case 'noauthor':
                return `\\citeyear{${keyStr}}`;
            case 'n':
            case 'nocite':
                return `\\nocite{${keyStr}}`;
            case 'p':
            case 'paren':
            default:
                return `\\cite{${keyStr}}`;
        }
    }

    // =========================================================================
    // Document Structure
    // =========================================================================

    private wrapInLatexDocument(
        content: string,
        meta: {
            title: string;
            author: string;
            date: string;
            email?: string;
        } & LatexExportOptions,
        _state: ExportState
    ): string {
        const parts: string[] = [];

        // If custom header is provided, use it instead of auto-generated preamble
        if (meta.customHeader) {
            parts.push(meta.customHeader);
            parts.push('');
        } else if (meta.noDefaults) {
            // No defaults mode: only include documentclass and user preamble
            const classOpts = meta.classOptions?.length
                ? `[${meta.classOptions.join(',')}]`
                : '';
            parts.push(`\\documentclass${classOpts}{${meta.documentClass}}`);
            parts.push('');

            // Only user-provided preamble
            if (meta.preamble) {
                parts.push('% User preamble');
                parts.push(meta.preamble);
                parts.push('');
            }
        } else {
            // Normal mode: use document class and user preamble only
            // Document class
            const classOpts = meta.classOptions?.length
                ? `[${meta.classOptions.join(',')}]`
                : '';
            parts.push(`\\documentclass${classOpts}{${meta.documentClass}}`);
            parts.push('');

            // User preamble from #+LATEX_HEADER: lines
            if (meta.preamble) {
                parts.push(meta.preamble);
                parts.push('');
            }
        }

        // Title, author, date (controlled by OPTIONS)
        if (meta.title) {
            parts.push(`\\title{${escapeString(meta.title, 'latex')}}`);
        }

        // Include author if includeAuthor is not false
        if (meta.author && meta.includeAuthor !== false) {
            let authorStr = escapeString(meta.author, 'latex');
            // Include email if includeEmail is true
            if (meta.email && meta.includeEmail === true) {
                authorStr += `\\\\\\texttt{${escapeString(meta.email, 'latex')}}`;
            }
            parts.push(`\\author{${authorStr}}`);
        }

        // Include date if includeDate is not false
        if (meta.includeDate !== false) {
            parts.push(`\\date{${meta.date}}`);
        } else {
            parts.push('\\date{}');
        }
        parts.push('');

        // Begin document
        parts.push('\\begin{document}');
        parts.push('');

        // Maketitle (only if we have title and author/date to show)
        if (meta.title) {
            parts.push('\\maketitle');
            parts.push('');
        }

        // Table of contents
        if (meta.toc) {
            parts.push('\\tableofcontents');
            parts.push('\\newpage');
            parts.push('');
        }

        // Document content
        parts.push(content);
        parts.push('');

        // Bibliography
        if (meta.bibFile) {
            parts.push('\\bibliographystyle{' + (meta.bibStyle || 'plain') + '}');
            parts.push(`\\bibliography{${meta.bibFile}}`);
            parts.push('');
        }

        // End document
        parts.push('\\end{document}');

        return parts.join('\n');
    }

    /**
     * Map org-mode language names to Pygments/minted language names
     */
    private mapLanguageForMinted(lang: string): string {
        const mapping: Record<string, string> = {
            'jupyter-python': 'python',
            'jupyter-julia': 'julia',
            'jupyter-R': 'r',
            'jupyter-r': 'r',
            'sh': 'bash',
            'shell': 'bash',
            'elisp': 'common-lisp',
            'emacs-lisp': 'common-lisp',
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
        };
        return mapping[lang] || lang.toLowerCase();
    }

    /**
     * Map org-mode language names to listings language names
     */
    private mapLanguage(lang: string): string {
        const mapping: Record<string, string> = {
            'python': 'Python',
            'py': 'Python',
            'jupyter-python': 'Python',
            'javascript': 'JavaScript',
            'js': 'JavaScript',
            'typescript': 'JavaScript',
            'ts': 'JavaScript',
            'java': 'Java',
            'c': 'C',
            'cpp': 'C++',
            'c++': 'C++',
            'csharp': 'C',
            'ruby': 'Ruby',
            'perl': 'Perl',
            'php': 'PHP',
            'sh': 'bash',
            'bash': 'bash',
            'shell': 'bash',
            'sql': 'SQL',
            'html': 'HTML',
            'xml': 'XML',
            'css': 'HTML',
            'latex': 'TeX',
            'tex': 'TeX',
            'lisp': 'Lisp',
            'elisp': 'Lisp',
            'scheme': 'Lisp',
            'haskell': 'Haskell',
            'ocaml': 'ML',
            'r': 'R',
            'jupyter-R': 'R',
            'matlab': 'Matlab',
            'fortran': 'Fortran',
            'go': 'Go',
            'rust': 'Rust',
            'julia': 'Python',  // Julia not in listings, use Python as fallback
            'jupyter-julia': 'Python',
        };

        return mapping[lang.toLowerCase()] || lang;
    }
}

// =============================================================================
// Export Function
// =============================================================================

/**
 * Export an org document to LaTeX
 */
export function exportToLatex(
    doc: OrgDocumentNode,
    options?: Partial<LatexExportOptions>
): string {
    const backend = new LatexExportBackend();
    return backend.exportDocument(doc, options);
}
