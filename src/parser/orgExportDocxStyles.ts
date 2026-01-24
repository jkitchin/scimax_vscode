/**
 * Word style definitions for DOCX export
 * Defines paragraph styles, character styles, and table styles
 */

import {
    IStylesOptions,
    HeadingLevel,
    AlignmentType,
    convertInchesToTwip,
    UnderlineType,
} from 'docx';

/**
 * DOCX export style options
 */
export interface DocxStyleOptions {
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
}

const DEFAULT_STYLE_OPTIONS: Required<DocxStyleOptions> = {
    fontFamily: 'Calibri',
    fontSize: 11,
    headingFontFamily: 'Calibri Light',
    codeFontFamily: 'Consolas',
    codeFontSize: 10,
};

/**
 * Color palette for document styling
 */
export const DOCX_COLORS = {
    // Text colors
    text: '000000',
    textLight: '666666',
    textMuted: '999999',

    // Heading colors
    heading1: '2F5496',
    heading2: '2F5496',
    heading3: '1F3763',
    heading4: '1F3763',

    // Semantic colors
    link: '0563C1',
    code: '24292e',
    codeBackground: 'F6F8FA',

    // Citation colors
    citationMissing: 'C92A2A',

    // TODO keyword colors
    todoKeyword: 'C92A2A',
    doneKeyword: '2F9E44',
    waitingKeyword: 'E67700',

    // Table colors
    tableHeaderBackground: 'F0F0F0',
    tableBorder: 'CCCCCC',

    // Admonition colors
    noteBackground: 'E7F5FF',
    warningBackground: 'FFF3CD',
    tipBackground: 'D4EDDA',
};

/**
 * Create Word styles configuration for the document
 */
export function createDocxStyles(options: DocxStyleOptions = {}): IStylesOptions {
    const opts = { ...DEFAULT_STYLE_OPTIONS, ...options };

    // Font sizes in half-points (Word uses half-points internally)
    const baseFontSize = opts.fontSize * 2;
    const codeFontSize = opts.codeFontSize * 2;

    return {
        default: {
            document: {
                run: {
                    font: opts.fontFamily,
                    size: baseFontSize,
                },
                paragraph: {
                    spacing: {
                        after: 200, // 10pt after paragraphs (in twips = 1/20 pt)
                        line: 276, // 1.15 line spacing (in 240ths of a line)
                    },
                },
            },
            heading1: {
                run: {
                    font: opts.headingFontFamily,
                    size: 32 * 2, // 32pt
                    bold: true,
                    color: DOCX_COLORS.heading1,
                },
                paragraph: {
                    spacing: {
                        before: 360,
                        after: 120,
                    },
                },
            },
            heading2: {
                run: {
                    font: opts.headingFontFamily,
                    size: 26 * 2, // 26pt
                    bold: true,
                    color: DOCX_COLORS.heading2,
                },
                paragraph: {
                    spacing: {
                        before: 320,
                        after: 100,
                    },
                },
            },
            heading3: {
                run: {
                    font: opts.headingFontFamily,
                    size: 22 * 2, // 22pt
                    bold: true,
                    color: DOCX_COLORS.heading3,
                },
                paragraph: {
                    spacing: {
                        before: 280,
                        after: 80,
                    },
                },
            },
            heading4: {
                run: {
                    font: opts.headingFontFamily,
                    size: 18 * 2, // 18pt
                    bold: true,
                    color: DOCX_COLORS.heading4,
                },
                paragraph: {
                    spacing: {
                        before: 240,
                        after: 60,
                    },
                },
            },
            heading5: {
                run: {
                    font: opts.headingFontFamily,
                    size: 16 * 2, // 16pt
                    bold: true,
                    color: DOCX_COLORS.heading4,
                },
                paragraph: {
                    spacing: {
                        before: 200,
                        after: 40,
                    },
                },
            },
            heading6: {
                run: {
                    font: opts.headingFontFamily,
                    size: 14 * 2, // 14pt
                    bold: true,
                    italics: true,
                    color: DOCX_COLORS.heading4,
                },
                paragraph: {
                    spacing: {
                        before: 160,
                        after: 40,
                    },
                },
            },
            hyperlink: {
                run: {
                    color: DOCX_COLORS.link,
                    underline: {
                        type: UnderlineType.SINGLE,
                        color: DOCX_COLORS.link,
                    },
                },
            },
        },
        paragraphStyles: [
            {
                id: 'Normal',
                name: 'Normal',
                run: {
                    font: opts.fontFamily,
                    size: baseFontSize,
                },
                paragraph: {
                    spacing: {
                        after: 200,
                        line: 276,
                    },
                },
            },
            {
                id: 'Code',
                name: 'Code',
                basedOn: 'Normal',
                run: {
                    font: opts.codeFontFamily,
                    size: codeFontSize,
                },
                paragraph: {
                    spacing: {
                        after: 0,
                        line: 240, // Single line spacing
                    },
                    shading: {
                        fill: DOCX_COLORS.codeBackground,
                    },
                },
            },
            {
                id: 'CodeBlock',
                name: 'Code Block',
                basedOn: 'Code',
                paragraph: {
                    indent: {
                        left: convertInchesToTwip(0.25),
                        right: convertInchesToTwip(0.25),
                    },
                },
            },
            {
                id: 'Quote',
                name: 'Quote',
                basedOn: 'Normal',
                run: {
                    italics: true,
                    color: DOCX_COLORS.textLight,
                },
                paragraph: {
                    indent: {
                        left: convertInchesToTwip(0.5),
                    },
                },
            },
            {
                id: 'Caption',
                name: 'Caption',
                basedOn: 'Normal',
                run: {
                    size: (opts.fontSize - 1) * 2,
                    italics: true,
                    color: DOCX_COLORS.textLight,
                },
                paragraph: {
                    alignment: AlignmentType.CENTER,
                    spacing: {
                        before: 100,
                        after: 200,
                    },
                },
            },
            {
                id: 'TOCHeading',
                name: 'TOC Heading',
                basedOn: 'Normal',
                run: {
                    font: opts.headingFontFamily,
                    size: 28 * 2,
                    bold: true,
                    color: DOCX_COLORS.heading1,
                },
                paragraph: {
                    spacing: {
                        after: 200,
                    },
                },
            },
            {
                id: 'BibliographyHeading',
                name: 'Bibliography Heading',
                basedOn: 'Normal',
                run: {
                    font: opts.headingFontFamily,
                    size: 24 * 2,
                    bold: true,
                    color: DOCX_COLORS.heading2,
                },
                paragraph: {
                    spacing: {
                        before: 400,
                        after: 200,
                    },
                },
            },
            {
                id: 'BibliographyEntry',
                name: 'Bibliography Entry',
                basedOn: 'Normal',
                paragraph: {
                    indent: {
                        left: convertInchesToTwip(0.5),
                        hanging: convertInchesToTwip(0.5),
                    },
                    spacing: {
                        after: 100,
                    },
                },
            },
            {
                id: 'ListParagraph',
                name: 'List Paragraph',
                basedOn: 'Normal',
                paragraph: {
                    spacing: {
                        after: 100,
                    },
                },
            },
        ],
        characterStyles: [
            {
                id: 'InlineCode',
                name: 'Inline Code',
                run: {
                    font: opts.codeFontFamily,
                    size: codeFontSize,
                    shading: {
                        fill: DOCX_COLORS.codeBackground,
                    },
                },
            },
            {
                id: 'TodoKeyword',
                name: 'TODO Keyword',
                run: {
                    bold: true,
                    color: DOCX_COLORS.todoKeyword,
                },
            },
            {
                id: 'DoneKeyword',
                name: 'DONE Keyword',
                run: {
                    bold: true,
                    color: DOCX_COLORS.doneKeyword,
                },
            },
            {
                id: 'Tag',
                name: 'Tag',
                run: {
                    size: (opts.fontSize - 2) * 2,
                    color: DOCX_COLORS.textMuted,
                },
            },
            {
                id: 'Citation',
                name: 'Citation',
                run: {
                    color: DOCX_COLORS.text,
                },
            },
            {
                id: 'CitationMissing',
                name: 'Citation Missing',
                run: {
                    italics: true,
                    color: DOCX_COLORS.citationMissing,
                },
            },
        ],
    };
}

/**
 * Get heading level for org-mode headline level
 */
export function getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
    switch (level) {
        case 1: return HeadingLevel.HEADING_1;
        case 2: return HeadingLevel.HEADING_2;
        case 3: return HeadingLevel.HEADING_3;
        case 4: return HeadingLevel.HEADING_4;
        case 5: return HeadingLevel.HEADING_5;
        case 6:
        default: return HeadingLevel.HEADING_6;
    }
}
