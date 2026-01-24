/**
 * DOCX export backend for org-mode documents
 * Converts org AST to Microsoft Word documents
 */

import {
    Document,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    ExternalHyperlink,
    InternalHyperlink,
    Bookmark,
    ImageRun,
    FootnoteReferenceRun,
    Packer,
    BorderStyle,
    convertInchesToTwip,
    ShadingType,
    LevelFormat,
    TableOfContents,
    PageBreak,
    IDocumentOptions,
} from 'docx';

import * as fs from 'fs';
import * as path from 'path';

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
    MacroObject,
    TableCellObject,
    AffiliatedKeywords,
    ExportSnippetObject,
} from './orgElementTypes';

import type { ExportState, ExportOptions } from './orgExport';

import {
    createExportState,
    generateId,
    generateSectionNumber,
    shouldExport,
    expandMacro,
    BUILTIN_MACROS,
    collectTargets,
    collectFootnotes,
    parseOptionsKeyword,
} from './orgExport';

import {
    createDocxStyles,
    getHeadingLevel,
    DocxStyleOptions,
    DOCX_COLORS,
} from './orgExportDocxStyles';

import { highlightCode, preloadHighlighter, HighlightOptions } from './orgExportDocxHighlight';

import { CitationProcessor, CSLStyleName } from '../references/citationProcessor';
import type { BibEntry } from '../references/bibtexParser';

// =============================================================================
// DOCX Export Options
// =============================================================================

/**
 * Options specific to DOCX export
 */
export interface DocxExportOptions extends ExportOptions {
    /** Document creator name */
    creator?: string;
    /** Company name */
    company?: string;
    /** Document description */
    description?: string;

    // Styling options
    /** Base font family (default: Calibri) */
    fontFamily?: string;
    /** Base font size in points (default: 11) */
    fontSize?: number;
    /** Heading font family (default: Calibri Light) */
    headingFontFamily?: string;
    /** Code font family (default: Consolas) */
    codeFontFamily?: string;
    /** Code font size in points (default: 10) */
    codeFontSize?: number;

    // Code highlighting
    /** Shiki theme for syntax highlighting (default: github-light) */
    highlightTheme?: string;
    /** Whether to enable code highlighting (default: true) */
    enableCodeHighlight?: boolean;

    // Images
    /** Maximum image width in pixels (default: 600) */
    imageMaxWidth?: number;
    /** Base path for resolving relative image paths */
    basePath?: string;

    // Citations
    /** CSL style for citations (default: apa) */
    citationStyle?: CSLStyleName | string;
    /** Whether to generate bibliography (default: true) */
    bibliography?: boolean;
    /** BibTeX entries for citation processing */
    bibEntries?: BibEntry[];
    /** Pre-configured citation processor */
    citationProcessor?: CitationProcessor;
}

const DEFAULT_DOCX_OPTIONS: Required<
    Omit<DocxExportOptions, keyof ExportOptions | 'citationProcessor' | 'bibEntries' | 'basePath'>
> = {
    creator: 'Scimax VSCode',
    company: '',
    description: '',
    fontFamily: 'Calibri',
    fontSize: 11,
    headingFontFamily: 'Calibri Light',
    codeFontFamily: 'Consolas',
    codeFontSize: 10,
    highlightTheme: 'github-light',
    enableCodeHighlight: true,
    imageMaxWidth: 600,
    citationStyle: 'apa',
    bibliography: true,
};

// =============================================================================
// DOCX Export State
// =============================================================================

/**
 * Extended export state for DOCX
 */
interface DocxExportState extends ExportState {
    /** DOCX-specific options */
    docxOptions: DocxExportOptions;
    /** Citation processor instance */
    citationProcessor?: CitationProcessor;
    /** Citation locations for back-links */
    citationLocations: Map<string, string[]>;
    /** Counter for unique citation IDs */
    citationCounter: number;
    /** Collected bookmarks for internal links */
    bookmarks: Map<string, string>;
    /** Document footnotes */
    docxFootnotes: Map<string, { paragraphs: Paragraph[] }>;
    /** Footnote reference counter */
    footnoteRefCounter: number;
    /** Skip next results block flag */
    skipNextResults?: boolean;
    /** Base path for resolving relative paths */
    basePath: string;
}

// =============================================================================
// DOCX Export Backend
// =============================================================================

/**
 * DOCX export backend
 * Note: Unlike HTML/LaTeX backends, this returns a Promise<Buffer>
 */
export class DocxExportBackend {
    public readonly name = 'docx';

    /**
     * Export a complete document to DOCX format
     * Returns a Buffer containing the DOCX file data
     */
    async exportDocument(
        doc: OrgDocumentNode,
        options?: Partial<DocxExportOptions>
    ): Promise<Buffer> {
        // Parse #+OPTIONS: keyword if present
        const optionsKeyword = doc.keywords['OPTIONS'];
        const parsedOptions = optionsKeyword ? parseOptionsKeyword(optionsKeyword) : {};

        const opts: DocxExportOptions = {
            ...DEFAULT_DOCX_OPTIONS,
            ...parsedOptions,  // OPTIONS keyword values
            ...options,        // Explicit options override OPTIONS
            backend: 'docx',
        };

        // Create base export state
        const baseState = createExportState(opts);

        // Create DOCX-specific state
        const state: DocxExportState = {
            ...baseState,
            docxOptions: opts,
            citationLocations: new Map(),
            citationCounter: 0,
            bookmarks: new Map(),
            docxFootnotes: new Map(),
            footnoteRefCounter: 0,
            basePath: opts.basePath || process.cwd(),
        };

        // Initialize citation processor
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

        // Pre-load syntax highlighter if enabled
        if (opts.enableCodeHighlight) {
            await preloadHighlighter(opts.highlightTheme);
        }

        // Extract document metadata
        const title = opts.title || doc.keywords['TITLE'] || 'Untitled';
        const author = opts.author || doc.keywords['AUTHOR'] || '';
        const date = opts.date || doc.keywords['DATE'] || '';

        // Build document sections
        const sections = await this.buildDocumentSections(doc, state);

        // Create the Word document
        const docxDocument = this.createDocument(
            {
                title,
                author,
                date,
                creator: opts.creator,
                company: opts.company,
                description: opts.description,
            },
            sections,
            state,
            opts
        );

        // Pack to buffer
        return Packer.toBuffer(docxDocument);
    }

    /**
     * Create the DOCX Document object
     */
    private createDocument(
        meta: {
            title: string;
            author: string;
            date: string;
            creator?: string;
            company?: string;
            description?: string;
        },
        sections: Paragraph[],
        state: DocxExportState,
        opts: DocxExportOptions
    ): Document {
        // Build footnotes object for Document
        // Footnotes are passed as a Record<number, { children: Paragraph[] }>
        const footnotes: Record<number, { children: Paragraph[] }> = {};
        let footnoteId = 1;
        for (const [_label, { paragraphs }] of state.docxFootnotes) {
            footnotes[footnoteId] = {
                children: paragraphs,
            };
            footnoteId++;
        }

        // Style options
        const styleOpts: DocxStyleOptions = {
            fontFamily: opts.fontFamily,
            fontSize: opts.fontSize,
            headingFontFamily: opts.headingFontFamily,
            codeFontFamily: opts.codeFontFamily,
            codeFontSize: opts.codeFontSize,
        };

        return new Document({
            creator: meta.creator || 'Scimax VSCode',
            title: meta.title,
            description: meta.description,
            styles: createDocxStyles(styleOpts),
            numbering: this.createNumberingConfig(),
            ...(Object.keys(footnotes).length > 0 ? { footnotes } : {}),
            sections: [
                {
                    properties: {},
                    children: sections,
                },
            ],
        });
    }

    /**
     * Create numbering configuration for lists
     */
    private createNumberingConfig() {
        return {
            config: [
                {
                    reference: 'bullet-list',
                    levels: [
                        { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } },
                        { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) } } } },
                        { level: 2, format: LevelFormat.BULLET, text: '\u2013', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) } } } },
                    ],
                },
                {
                    reference: 'ordered-list',
                    levels: [
                        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } },
                        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) } } } },
                        { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) } } } },
                    ],
                },
            ],
        };
    }

    /**
     * Build all document sections (paragraphs)
     */
    private async buildDocumentSections(
        doc: OrgDocumentNode,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const sections: Paragraph[] = [];

        // Title
        const title = state.docxOptions.title || doc.keywords['TITLE'];
        if (title) {
            sections.push(
                new Paragraph({
                    children: [new TextRun({ text: title, bold: true, size: 56 })], // 28pt
                    heading: HeadingLevel.TITLE,
                    spacing: { after: 200 },
                })
            );
        }

        // Author and date
        const author = state.docxOptions.author || doc.keywords['AUTHOR'];
        const date = state.docxOptions.date || doc.keywords['DATE'];
        if (author || date) {
            const metaRuns: TextRun[] = [];
            if (author) {
                metaRuns.push(new TextRun({ text: author, italics: true }));
            }
            if (author && date) {
                metaRuns.push(new TextRun({ text: ' \u2014 ' })); // em dash
            }
            if (date) {
                metaRuns.push(new TextRun({ text: date, italics: true }));
            }
            sections.push(
                new Paragraph({
                    children: metaRuns,
                    spacing: { after: 400 },
                })
            );
        }

        // Table of contents
        if (state.options.toc) {
            sections.push(
                new Paragraph({
                    children: [new TextRun({ text: 'Table of Contents', bold: true, size: 48 })],
                    heading: HeadingLevel.HEADING_1,
                })
            );
            // Note: TableOfContents is handled differently in Word and requires
            // the document to have field codes updated when opened
            sections.push(
                new Paragraph({
                    children: [new TextRun({ text: '(Update table of contents in Word: Ctrl+A, F9)' })],
                })
            );
            sections.push(new Paragraph({ children: [new PageBreak()] }));
        }

        // Export preamble section
        if (doc.section) {
            const sectionContent = await this.exportSection(doc.section, state);
            sections.push(...sectionContent);
        }

        // Export headlines
        for (const headline of doc.children) {
            if (shouldExport(headline, state.options)) {
                const headlineContent = await this.exportHeadline(headline, state);
                sections.push(...headlineContent);
            }
        }

        // Export bibliography
        if (state.docxOptions.bibliography !== false && state.citationProcessor) {
            const bibSections = this.exportBibliography(state);
            sections.push(...bibSections);
        }

        return sections;
    }

    /**
     * Export a headline to paragraphs
     */
    private async exportHeadline(
        headline: HeadlineElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const paragraphs: Paragraph[] = [];

        // Generate bookmark ID
        const id = headline.properties.customId ||
            headline.properties.id ||
            generateId(headline.properties.rawValue);
        state.bookmarks.set(headline.properties.rawValue, id);

        // Build title runs
        const titleRuns: TextRun[] = [];

        // Add section number if enabled
        if (state.options.sectionNumbers) {
            const numberLabel = generateSectionNumber(headline.properties.level, state);
            titleRuns.push(new TextRun({ text: `${numberLabel} `, color: DOCX_COLORS.textMuted }));
        }

        // Add TODO keyword if present
        if (headline.properties.todoKeyword && state.options.includeTodo !== false) {
            const todoType = headline.properties.todoType || 'todo';
            const color = todoType === 'done' ? DOCX_COLORS.doneKeyword : DOCX_COLORS.todoKeyword;
            titleRuns.push(new TextRun({
                text: `${headline.properties.todoKeyword} `,
                bold: true,
                color,
            }));
        }

        // Add title text
        if (headline.properties.title) {
            const titleContent = await this.exportObjects(headline.properties.title, state);
            titleRuns.push(...titleContent);
        } else {
            titleRuns.push(new TextRun({ text: headline.properties.rawValue }));
        }

        // Add tags
        if (headline.properties.tags.length > 0 && state.options.includeTags !== false) {
            titleRuns.push(new TextRun({ text: '  ' }));
            for (const tag of headline.properties.tags) {
                titleRuns.push(new TextRun({
                    text: `:${tag}:`,
                    color: DOCX_COLORS.textMuted,
                    size: 18, // Smaller
                }));
            }
        }

        // Create heading paragraph with bookmark
        const headingLevel = getHeadingLevel(headline.properties.level);
        paragraphs.push(
            new Paragraph({
                children: [
                    new Bookmark({
                        id,
                        children: titleRuns,
                    }),
                ],
                heading: headingLevel,
            })
        );

        // Export section content
        if (headline.section) {
            const sectionContent = await this.exportSection(headline.section, state);
            paragraphs.push(...sectionContent);
        }

        // Export child headlines
        for (const child of headline.children) {
            if (shouldExport(child, state.options)) {
                const childContent = await this.exportHeadline(child, state);
                paragraphs.push(...childContent);
            }
        }

        return paragraphs;
    }

    /**
     * Export a section to paragraphs
     */
    private async exportSection(
        section: SectionElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const paragraphs: Paragraph[] = [];

        for (const child of section.children) {
            const elementParagraphs = await this.exportElement(child, state);
            paragraphs.push(...elementParagraphs);
        }

        return paragraphs;
    }

    /**
     * Export a single element to paragraphs
     */
    async exportElement(
        element: OrgElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        switch (element.type) {
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
            case 'table':
                return this.exportTable(element as TableElement, state);
            case 'plain-list':
                return this.exportPlainList(element as PlainListElement, state);
            case 'horizontal-rule':
                return this.exportHorizontalRule();
            case 'fixed-width':
                return this.exportFixedWidth(element as FixedWidthElement, state);
            case 'drawer':
                return this.exportDrawer(element as DrawerElement, state);
            case 'export-block':
                return this.exportExportBlock(element as ExportBlockElement, state);
            case 'keyword':
            case 'comment-block':
            case 'footnote-definition':
                // Skip these elements
                return [];
            default:
                return [];
        }
    }

    /**
     * Export a paragraph element
     */
    private async exportParagraph(
        paragraph: ParagraphElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const runs = await this.exportObjects(paragraph.children, state);

        return [
            new Paragraph({
                children: runs,
                spacing: { after: 200 },
            }),
        ];
    }

    /**
     * Export a source block with syntax highlighting
     */
    private async exportSrcBlock(
        block: SrcBlockElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const lang = block.properties.language || 'text';
        const code = block.properties.value;

        // Parse :exports header argument
        const params = block.properties.parameters || '';
        const exportsMatch = params.match(/:exports\s+(\w+)/i);
        const exports = exportsMatch ? exportsMatch[1].toLowerCase() : 'both';

        if (exports === 'none') {
            state.skipNextResults = true;
            return [];
        }

        if (exports === 'results') {
            state.skipNextResults = false;
            return [];
        }

        if (exports === 'code') {
            state.skipNextResults = true;
        } else {
            state.skipNextResults = false;
        }

        const paragraphs: Paragraph[] = [];

        // Add caption if present
        if (block.affiliated?.caption) {
            const caption = Array.isArray(block.affiliated.caption)
                ? block.affiliated.caption[1]
                : block.affiliated.caption;
            paragraphs.push(
                new Paragraph({
                    children: [new TextRun({ text: caption, italics: true })],
                    style: 'Caption',
                })
            );
        }

        // Highlight the code
        const highlightedLines = await highlightCode(code, lang, {
            theme: state.docxOptions.highlightTheme,
            fontFamily: state.docxOptions.codeFontFamily,
            fontSize: (state.docxOptions.codeFontSize || 10) * 2,
            enabled: state.docxOptions.enableCodeHighlight,
        });

        // Create a paragraph for each line
        for (const lineRuns of highlightedLines) {
            paragraphs.push(
                new Paragraph({
                    children: lineRuns,
                    style: 'CodeBlock',
                    shading: {
                        type: ShadingType.SOLID,
                        fill: DOCX_COLORS.codeBackground,
                    },
                })
            );
        }

        // Add spacing after code block
        paragraphs.push(new Paragraph({ children: [], spacing: { after: 200 } }));

        return paragraphs;
    }

    /**
     * Export an example block
     */
    private async exportExampleBlock(
        block: ExampleBlockElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const lines = block.properties.value.split('\n');
        const paragraphs: Paragraph[] = [];

        for (const line of lines) {
            paragraphs.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: line,
                            font: state.docxOptions.codeFontFamily || 'Consolas',
                            size: (state.docxOptions.codeFontSize || 10) * 2,
                        }),
                    ],
                    style: 'CodeBlock',
                    shading: {
                        type: ShadingType.SOLID,
                        fill: 'FFF9C4', // Light yellow
                    },
                })
            );
        }

        paragraphs.push(new Paragraph({ children: [], spacing: { after: 200 } }));

        return paragraphs;
    }

    /**
     * Export a quote block
     */
    private async exportQuoteBlock(
        block: QuoteBlockElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const paragraphs: Paragraph[] = [];

        for (const child of block.children) {
            if (child.type === 'paragraph') {
                const runs = await this.exportObjects((child as ParagraphElement).children, state);
                // Add italic styling to quote text
                const italicRuns = runs.map(run => new TextRun({
                    text: '',
                    italics: true,
                    color: DOCX_COLORS.textLight,
                }));
                paragraphs.push(
                    new Paragraph({
                        children: runs.map(() => new TextRun({ text: '', italics: true })),
                        style: 'Quote',
                        indent: { left: convertInchesToTwip(0.5) },
                    })
                );
                // Re-export with italic styling
                const quoteRuns: TextRun[] = [];
                for (const obj of (child as ParagraphElement).children) {
                    if (obj.type === 'plain-text') {
                        quoteRuns.push(new TextRun({
                            text: (obj as PlainTextObject).properties.value,
                            italics: true,
                            color: DOCX_COLORS.textLight,
                        }));
                    } else {
                        const objRuns = await this.exportObject(obj, state);
                        quoteRuns.push(...objRuns);
                    }
                }
                paragraphs.pop(); // Remove the placeholder
                paragraphs.push(
                    new Paragraph({
                        children: quoteRuns,
                        style: 'Quote',
                        indent: { left: convertInchesToTwip(0.5) },
                    })
                );
            } else {
                const childParas = await this.exportElement(child, state);
                paragraphs.push(...childParas);
            }
        }

        return paragraphs;
    }

    /**
     * Export a center block
     */
    private async exportCenterBlock(
        block: CenterBlockElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const paragraphs: Paragraph[] = [];

        for (const child of block.children) {
            if (child.type === 'paragraph') {
                const runs = await this.exportObjects((child as ParagraphElement).children, state);
                paragraphs.push(
                    new Paragraph({
                        children: runs,
                        alignment: AlignmentType.CENTER,
                    })
                );
            } else {
                const childParas = await this.exportElement(child, state);
                paragraphs.push(...childParas);
            }
        }

        return paragraphs;
    }

    /**
     * Export a special block (note, warning, tip, etc.)
     */
    private async exportSpecialBlock(
        block: SpecialBlockElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const blockType = block.properties.blockType.toLowerCase();
        const paragraphs: Paragraph[] = [];

        // Determine background color based on block type
        let bgColor = DOCX_COLORS.noteBackground;
        if (blockType === 'warning' || blockType === 'caution') {
            bgColor = DOCX_COLORS.warningBackground;
        } else if (blockType === 'tip') {
            bgColor = DOCX_COLORS.tipBackground;
        }

        // Add block type header
        paragraphs.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: blockType.toUpperCase(),
                        bold: true,
                        color: DOCX_COLORS.textLight,
                    }),
                ],
                shading: {
                    type: ShadingType.SOLID,
                    fill: bgColor,
                },
                indent: { left: convertInchesToTwip(0.25), right: convertInchesToTwip(0.25) },
            })
        );

        // Export content
        for (const child of block.children) {
            if (child.type === 'paragraph') {
                const runs = await this.exportObjects((child as ParagraphElement).children, state);
                paragraphs.push(
                    new Paragraph({
                        children: runs,
                        shading: {
                            type: ShadingType.SOLID,
                            fill: bgColor,
                        },
                        indent: { left: convertInchesToTwip(0.25), right: convertInchesToTwip(0.25) },
                    })
                );
            } else {
                const childParas = await this.exportElement(child, state);
                paragraphs.push(...childParas);
            }
        }

        paragraphs.push(new Paragraph({ children: [], spacing: { after: 200 } }));

        return paragraphs;
    }

    /**
     * Export a verse block (preserve line breaks)
     */
    private async exportVerseBlock(
        block: VerseBlockElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const lines = block.properties.value.split('\n');
        const paragraphs: Paragraph[] = [];

        for (const line of lines) {
            paragraphs.push(
                new Paragraph({
                    children: [new TextRun({ text: line, italics: true })],
                    indent: { left: convertInchesToTwip(0.5) },
                    spacing: { after: 0 },
                })
            );
        }

        paragraphs.push(new Paragraph({ children: [], spacing: { after: 200 } }));

        return paragraphs;
    }

    /**
     * Export a table
     */
    private async exportTable(
        table: TableElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        if (state.options.includeTables === false) {
            return [];
        }

        const paragraphs: Paragraph[] = [];

        // Add caption if present
        if (table.affiliated?.caption) {
            const caption = Array.isArray(table.affiliated.caption)
                ? table.affiliated.caption[1]
                : table.affiliated.caption;
            paragraphs.push(
                new Paragraph({
                    children: [new TextRun({ text: caption, italics: true })],
                    style: 'Caption',
                })
            );
        }

        // Separate header and body rows
        const rows: TableRowElement[] = [];
        let headerRows: TableRowElement[] = [];
        let inHeader = true;

        for (const row of table.children) {
            if (row.properties.rowType === 'rule') {
                inHeader = false;
                continue;
            }
            if (inHeader) {
                headerRows.push(row);
            } else {
                rows.push(row);
            }
        }

        // If no separator, treat all as body
        if (rows.length === 0 && headerRows.length > 0) {
            rows.push(...headerRows);
            headerRows = [];
        }

        // Build table rows
        const tableRows: TableRow[] = [];

        // Header rows
        for (const row of headerRows) {
            const cells = await this.exportTableRow(row, state, true);
            tableRows.push(
                new TableRow({
                    children: cells,
                    tableHeader: true,
                })
            );
        }

        // Body rows
        for (const row of rows) {
            const cells = await this.exportTableRow(row, state, false);
            tableRows.push(
                new TableRow({
                    children: cells,
                })
            );
        }

        // Create table
        const docxTable = new Table({
            rows: tableRows,
            width: {
                size: 100,
                type: WidthType.PERCENTAGE,
            },
        });

        paragraphs.push(docxTable as any); // Table can be used in place of Paragraph

        paragraphs.push(new Paragraph({ children: [], spacing: { after: 200 } }));

        return paragraphs;
    }

    /**
     * Export a table row
     */
    private async exportTableRow(
        row: TableRowElement,
        state: DocxExportState,
        isHeader: boolean
    ): Promise<TableCell[]> {
        const cells: TableCell[] = [];

        for (const cell of row.children) {
            const content = cell.children
                ? await this.exportObjects(cell.children, state)
                : [new TextRun({ text: cell.properties.value })];

            cells.push(
                new TableCell({
                    children: [
                        new Paragraph({
                            children: content,
                        }),
                    ],
                    shading: isHeader
                        ? { type: ShadingType.SOLID, fill: DOCX_COLORS.tableHeaderBackground }
                        : undefined,
                    borders: {
                        top: { style: BorderStyle.SINGLE, size: 1, color: DOCX_COLORS.tableBorder },
                        bottom: { style: BorderStyle.SINGLE, size: 1, color: DOCX_COLORS.tableBorder },
                        left: { style: BorderStyle.SINGLE, size: 1, color: DOCX_COLORS.tableBorder },
                        right: { style: BorderStyle.SINGLE, size: 1, color: DOCX_COLORS.tableBorder },
                    },
                })
            );
        }

        return cells;
    }

    /**
     * Export a plain list
     */
    private async exportPlainList(
        list: PlainListElement,
        state: DocxExportState,
        level: number = 0
    ): Promise<Paragraph[]> {
        const paragraphs: Paragraph[] = [];
        const listType = list.properties.listType;
        const reference = listType === 'ordered' ? 'ordered-list' : 'bullet-list';

        for (const item of list.children) {
            const itemParas = await this.exportListItem(item, state, reference, level);
            paragraphs.push(...itemParas);
        }

        return paragraphs;
    }

    /**
     * Export a list item
     */
    private async exportListItem(
        item: ItemElement,
        state: DocxExportState,
        reference: string,
        level: number
    ): Promise<Paragraph[]> {
        const paragraphs: Paragraph[] = [];
        const runs: TextRun[] = [];

        // Add checkbox if present
        if (item.properties.checkbox) {
            const checkbox =
                item.properties.checkbox === 'on'
                    ? '\u2611 ' // ☑
                    : item.properties.checkbox === 'trans'
                    ? '\u2610 ' // ☐ with dash (use regular)
                    : '\u2610 '; // ☐
            runs.push(new TextRun({ text: checkbox }));
        }

        // Export item content (first child is usually paragraph)
        for (const child of item.children) {
            if (child.type === 'paragraph') {
                const paraContent = await this.exportObjects(
                    (child as ParagraphElement).children,
                    state
                );
                runs.push(...paraContent);
            } else if (child.type === 'plain-list') {
                // Nested list - first add the current item paragraph
                if (runs.length > 0) {
                    paragraphs.push(
                        new Paragraph({
                            children: runs,
                            numbering: {
                                reference,
                                level,
                            },
                        })
                    );
                    runs.length = 0;
                }
                // Then add nested list
                const nestedParas = await this.exportPlainList(
                    child as PlainListElement,
                    state,
                    level + 1
                );
                paragraphs.push(...nestedParas);
            }
        }

        // Add remaining runs
        if (runs.length > 0) {
            paragraphs.push(
                new Paragraph({
                    children: runs,
                    numbering: {
                        reference,
                        level,
                    },
                })
            );
        }

        return paragraphs;
    }

    /**
     * Export a horizontal rule
     */
    private exportHorizontalRule(): Paragraph[] {
        return [
            new Paragraph({
                children: [],
                border: {
                    bottom: {
                        style: BorderStyle.SINGLE,
                        size: 6,
                        color: DOCX_COLORS.textMuted,
                    },
                },
                spacing: { before: 200, after: 200 },
            }),
        ];
    }

    /**
     * Export fixed width (results) block
     */
    private async exportFixedWidth(
        element: FixedWidthElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        // Check if we should skip this results block
        if (state.skipNextResults) {
            state.skipNextResults = false;
            return [];
        }

        const lines = element.properties.value.split('\n');
        const paragraphs: Paragraph[] = [];

        for (const line of lines) {
            paragraphs.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: line,
                            font: state.docxOptions.codeFontFamily || 'Consolas',
                            size: (state.docxOptions.codeFontSize || 10) * 2,
                        }),
                    ],
                    style: 'CodeBlock',
                })
            );
        }

        return paragraphs;
    }

    /**
     * Export a drawer
     */
    private async exportDrawer(
        drawer: DrawerElement,
        state: DocxExportState
    ): Promise<Paragraph[]> {
        const drawerName = drawer.properties.name.toUpperCase();

        // Skip PROPERTIES drawer
        if (drawerName === 'PROPERTIES') {
            return [];
        }

        // Check includeDrawers option
        if (state.options.includeDrawers === false) {
            return [];
        }

        if (Array.isArray(state.options.includeDrawers)) {
            if (!state.options.includeDrawers.some(d => d.toUpperCase() === drawerName)) {
                return [];
            }
        }

        // Skip LOGBOOK if clocks not included
        if (drawerName === 'LOGBOOK' && state.options.includeClocks === false) {
            return [];
        }

        const paragraphs: Paragraph[] = [];
        for (const child of drawer.children) {
            const childParas = await this.exportElement(child, state);
            paragraphs.push(...childParas);
        }

        return paragraphs;
    }

    /**
     * Export an export block (only if backend matches)
     */
    private async exportExportBlock(
        block: ExportBlockElement,
        _state: DocxExportState
    ): Promise<Paragraph[]> {
        // DOCX doesn't support raw export blocks like HTML
        // We could potentially handle docx-specific blocks in the future
        return [];
    }

    /**
     * Export bibliography section
     */
    private exportBibliography(state: DocxExportState): Paragraph[] {
        if (!state.citationProcessor) {
            return [];
        }

        const citedKeys = state.citationProcessor.getCitedKeys();
        if (citedKeys.size === 0) {
            return [];
        }

        const paragraphs: Paragraph[] = [];

        // Add heading
        paragraphs.push(
            new Paragraph({
                children: [new TextRun({ text: 'References', bold: true, size: 48 })],
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 },
            })
        );

        // Get formatted entries
        // For now, generate simple entries (could be enhanced with proper CSL)
        for (const key of citedKeys) {
            const entry = state.citationProcessor.getEntry(key);
            if (!entry) continue;

            const parts: string[] = [];

            // Authors
            if (entry.author && entry.author.length > 0) {
                const authorNames = entry.author.map(a =>
                    a.literal || `${a.family || ''}${a.given ? ', ' + a.given : ''}`
                );
                parts.push(authorNames.join('; '));
            }

            // Year
            if (entry.issued?.['date-parts']?.[0]?.[0]) {
                parts.push(`(${entry.issued['date-parts'][0][0]})`);
            }

            // Title
            if (entry.title) {
                parts.push(entry.title);
            }

            // Journal/container
            if (entry['container-title']) {
                parts.push(entry['container-title']);
            }

            paragraphs.push(
                new Paragraph({
                    children: [
                        new Bookmark({
                            id: `ref-${key}`,
                            children: [new TextRun({ text: parts.join('. ') + '.' })],
                        }),
                    ],
                    style: 'BibliographyEntry',
                })
            );
        }

        return paragraphs;
    }

    /**
     * Export an array of inline objects to TextRuns
     */
    async exportObjects(
        objects: OrgObject[],
        state: DocxExportState
    ): Promise<TextRun[]> {
        const runs: TextRun[] = [];

        for (const obj of objects) {
            const objRuns = await this.exportObject(obj, state);
            runs.push(...objRuns);
        }

        return runs;
    }

    /**
     * Export a single object to TextRuns
     */
    async exportObject(
        object: OrgObject,
        state: DocxExportState
    ): Promise<TextRun[]> {
        switch (object.type) {
            case 'plain-text':
                return [new TextRun({ text: (object as PlainTextObject).properties.value })];

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

            case 'verbatim':
                return this.exportVerbatim(object as VerbatimObject, state);

            case 'link':
                return this.exportLink(object as LinkObject, state);

            case 'subscript':
                return this.exportSubscript(object as SubscriptObject, state);

            case 'superscript':
                return this.exportSuperscript(object as SuperscriptObject, state);

            case 'entity':
                return this.exportEntity(object as EntityObject, state);

            case 'timestamp':
                return this.exportTimestamp(object as TimestampObject, state);

            case 'footnote-reference':
                return this.exportFootnoteReference(object as FootnoteReferenceObject, state);

            case 'statistics-cookie':
                return [new TextRun({
                    text: (object as StatisticsCookieObject).properties.value,
                    color: DOCX_COLORS.textMuted,
                })];

            case 'target':
                // Export as bookmark anchor
                return [];

            case 'inline-src-block':
                return this.exportInlineSrcBlock(object as InlineSrcBlockObject, state);

            case 'macro':
                return this.exportMacro(object as MacroObject, state);

            case 'export-snippet':
                return this.exportExportSnippet(object as ExportSnippetObject, state);

            case 'line-break':
                return [new TextRun({ break: 1 })];

            case 'citation':
                return this.exportCitation(object as any, state);

            default:
                return [];
        }
    }

    // Object exporters

    private async exportBold(obj: BoldObject, state: DocxExportState): Promise<TextRun[]> {
        // For nested markup, extract plain text and apply formatting
        const text = this.extractPlainText(obj.children);
        return [new TextRun({ text, bold: true })];
    }

    private async exportItalic(obj: ItalicObject, state: DocxExportState): Promise<TextRun[]> {
        const text = this.extractPlainText(obj.children);
        return [new TextRun({ text, italics: true })];
    }

    private async exportUnderline(obj: UnderlineObject, state: DocxExportState): Promise<TextRun[]> {
        const text = this.extractPlainText(obj.children);
        return [new TextRun({
            text,
            underline: { type: 'single' as any },
        })];
    }

    private async exportStrikeThrough(obj: StrikeThroughObject, state: DocxExportState): Promise<TextRun[]> {
        const text = this.extractPlainText(obj.children);
        return [new TextRun({ text, strike: true })];
    }

    /**
     * Extract plain text from nested objects
     */
    private extractPlainText(objects: OrgObject[]): string {
        let text = '';
        for (const obj of objects) {
            if (obj.type === 'plain-text') {
                text += (obj as PlainTextObject).properties.value;
            } else if (obj.children) {
                text += this.extractPlainText(obj.children);
            }
        }
        return text;
    }

    private exportCode(obj: CodeObject, state: DocxExportState): TextRun[] {
        return [
            new TextRun({
                text: obj.properties.value,
                font: state.docxOptions.codeFontFamily || 'Consolas',
                size: (state.docxOptions.codeFontSize || 10) * 2,
                shading: {
                    type: ShadingType.SOLID,
                    fill: DOCX_COLORS.codeBackground,
                },
            }),
        ];
    }

    private exportVerbatim(obj: VerbatimObject, state: DocxExportState): TextRun[] {
        return [
            new TextRun({
                text: obj.properties.value,
                font: state.docxOptions.codeFontFamily || 'Consolas',
                size: (state.docxOptions.codeFontSize || 10) * 2,
            }),
        ];
    }

    private async exportLink(obj: LinkObject, state: DocxExportState): Promise<TextRun[]> {
        const { linkType, path: linkPath, rawLink } = obj.properties;

        // Get link text
        let linkText = rawLink || linkPath;
        if (obj.children && obj.children.length > 0) {
            linkText = this.extractPlainText(obj.children);
        }

        // Handle image links
        if (/\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(linkPath)) {
            return this.exportImageLink(linkPath, state);
        }

        // Handle external links
        if (linkType === 'http' || linkType === 'https' || linkType === 'mailto') {
            const href = linkType === 'mailto' ? `mailto:${linkPath}` : linkPath;
            return [
                new ExternalHyperlink({
                    link: href,
                    children: [
                        new TextRun({
                            text: linkText,
                            color: DOCX_COLORS.link,
                            underline: { type: 'single' as any },
                        }),
                    ],
                }) as unknown as TextRun,
            ];
        }

        // Handle internal links
        const targetId = state.bookmarks.get(linkPath) || generateId(linkPath);
        return [
            new InternalHyperlink({
                anchor: targetId,
                children: [
                    new TextRun({
                        text: linkText,
                        color: DOCX_COLORS.link,
                        underline: { type: 'single' as any },
                    }),
                ],
            }) as unknown as TextRun,
        ];
    }

    private async exportImageLink(
        imagePath: string,
        state: DocxExportState
    ): Promise<TextRun[]> {
        try {
            // Resolve path
            const resolvedPath = path.isAbsolute(imagePath)
                ? imagePath
                : path.resolve(state.basePath, imagePath);

            // Read image file
            const imageBuffer = await fs.promises.readFile(resolvedPath);

            // Get image dimensions (basic estimation, could be improved with sharp)
            const maxWidth = state.docxOptions.imageMaxWidth || 600;
            const width = Math.min(maxWidth, 600);
            const height = Math.round(width * 0.75); // Assume 4:3 aspect ratio

            return [
                new ImageRun({
                    data: imageBuffer,
                    transformation: {
                        width,
                        height,
                    },
                    type: 'png', // docx will handle format detection
                }) as unknown as TextRun,
            ];
        } catch (error) {
            // Image not found - return placeholder text
            return [
                new TextRun({
                    text: `[Image: ${imagePath}]`,
                    italics: true,
                    color: DOCX_COLORS.textMuted,
                }),
            ];
        }
    }

    private async exportSubscript(obj: SubscriptObject, state: DocxExportState): Promise<TextRun[]> {
        const text = this.extractPlainText(obj.children);
        return [new TextRun({ text, subScript: true })];
    }

    private async exportSuperscript(obj: SuperscriptObject, state: DocxExportState): Promise<TextRun[]> {
        const text = this.extractPlainText(obj.children);
        return [new TextRun({ text, superScript: true })];
    }

    private exportEntity(obj: EntityObject, _state: DocxExportState): TextRun[] {
        // Use UTF-8 representation of the entity
        return [new TextRun({ text: obj.properties.utf8 })];
    }

    private exportTimestamp(obj: TimestampObject, state: DocxExportState): TextRun[] {
        if (!state.options.timestamps) {
            return [];
        }

        return [
            new TextRun({
                text: obj.properties.rawValue,
                color: DOCX_COLORS.textMuted,
                font: state.docxOptions.codeFontFamily || 'Consolas',
                size: (state.docxOptions.fontSize || 11) * 2 - 2,
            }),
        ];
    }

    private exportFootnoteReference(
        obj: FootnoteReferenceObject,
        state: DocxExportState
    ): TextRun[] {
        const label = obj.properties.label || String(++state.footnoteRefCounter);

        // Check if footnote content exists
        const footnoteInfo = state.footnotes.get(label);
        if (footnoteInfo?.definition) {
            // Create footnote paragraphs from definition
            // Note: This is a simplified version - full implementation would
            // need to properly export the footnote content
            state.docxFootnotes.set(label, {
                paragraphs: [
                    new Paragraph({
                        children: [new TextRun({ text: 'Footnote content' })],
                    }),
                ],
            });
        }

        return [
            new FootnoteReferenceRun(state.docxFootnotes.size) as unknown as TextRun,
        ];
    }

    private exportInlineSrcBlock(obj: InlineSrcBlockObject, state: DocxExportState): TextRun[] {
        return [
            new TextRun({
                text: obj.properties.value,
                font: state.docxOptions.codeFontFamily || 'Consolas',
                size: (state.docxOptions.codeFontSize || 10) * 2,
                shading: {
                    type: ShadingType.SOLID,
                    fill: DOCX_COLORS.codeBackground,
                },
            }),
        ];
    }

    private exportMacro(obj: MacroObject, state: DocxExportState): TextRun[] {
        if (!state.options.expandMacros) {
            return [new TextRun({ text: `{{{${obj.properties.key}(${obj.properties.args.join(',')})}}}` })];
        }

        const macros = { ...BUILTIN_MACROS, ...state.options.macros };
        const expanded = expandMacro(obj.properties.key, obj.properties.args, macros);
        return [new TextRun({ text: expanded })];
    }

    private exportExportSnippet(obj: ExportSnippetObject, _state: DocxExportState): TextRun[] {
        // Only include if backend matches 'docx'
        if (obj.properties.backend.toLowerCase() === 'docx') {
            return [new TextRun({ text: obj.properties.value })];
        }
        // For other backends (html, latex, etc.), return empty - do not include
        return [];
    }

    /**
     * Export org-cite citation to DOCX
     * Renders as bracketed citation keys
     */
    private exportCitation(citation: any, _state: DocxExportState): TextRun[] {
        const { keys } = citation.properties;

        if (!keys || keys.length === 0) {
            return [new TextRun({ text: citation.properties.rawValue || '' })];
        }

        // Render as [key1, key2, ...] in the document
        return [new TextRun({ text: `[${keys.join(', ')}]` })];
    }
}

// =============================================================================
// Export Function
// =============================================================================

/**
 * Export an org document to DOCX format
 */
export async function exportToDocx(
    doc: OrgDocumentNode,
    options?: Partial<DocxExportOptions>
): Promise<Buffer> {
    const backend = new DocxExportBackend();
    return backend.exportDocument(doc, options);
}
