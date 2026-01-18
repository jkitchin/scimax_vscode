/**
 * Tests for the org-mode AST serialization module
 */

import { describe, it, expect } from 'vitest';
import {
    serialize,
    serializeHeadline,
    serializeSection,
    serializeElement,
    serializeObjects,
    serializeObject,
} from '../orgSerialize';
import { parseOrg } from '../orgParserUnified';
import type {
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    SrcBlockElement,
    ExampleBlockElement,
    ExportBlockElement,
    QuoteBlockElement,
    CenterBlockElement,
    SpecialBlockElement,
    VerseBlockElement,
    CommentBlockElement,
    KeywordElement,
    CommentElement,
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
    ParagraphElement,
    PlainTextObject,
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
    InlineBabelCallObject,
    InlineSrcBlockObject,
    ExportSnippetObject,
    MacroObject,
    TableCellObject,
    OrgRange,
} from '../orgElementTypes';

// Helper to create a minimal range for test elements
function makeRange(start = 0, end = 0): OrgRange {
    return { start, end };
}

describe('orgSerialize', () => {
    // =========================================================================
    // serialize() - Main document serialization
    // =========================================================================
    describe('serialize()', () => {
        it('serializes empty document', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                keywords: {},
                keywordLists: {},
                properties: {},
                children: [],
            };

            const result = serialize(doc);
            expect(result).toBe('\n');
        });

        it('serializes document with keywords', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                keywords: {
                    TITLE: 'Test Document',
                    AUTHOR: 'Test Author',
                },
                keywordLists: {},
                properties: {},
                children: [],
            };

            const result = serialize(doc);
            expect(result).toContain('#+TITLE: Test Document');
            expect(result).toContain('#+AUTHOR: Test Author');
        });

        it('serializes document with keyword lists', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                keywords: {},
                keywordLists: {
                    LATEX_HEADER: [
                        '\\usepackage{amsmath}',
                        '\\usepackage{graphicx}',
                    ],
                },
                properties: {},
                children: [],
            };

            const result = serialize(doc);
            expect(result).toContain('#+LATEX_HEADER: \\usepackage{amsmath}');
            expect(result).toContain('#+LATEX_HEADER: \\usepackage{graphicx}');
        });

        it('serializes document with properties', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                keywords: {},
                keywordLists: {},
                properties: {
                    'header-args': ':results output',
                    ID: 'my-doc-id',
                },
                children: [],
            };

            const result = serialize(doc);
            expect(result).toContain('#+PROPERTY: header-args :results output');
            expect(result).toContain('#+PROPERTY: ID my-doc-id');
        });

        it('serializes document with pre-headline section', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                keywords: {},
                keywordLists: {},
                properties: {},
                section: {
                    type: 'section',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'Introduction text.' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
                children: [],
            };

            const result = serialize(doc);
            expect(result).toContain('Introduction text.');
        });

        it('serializes document with headlines', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                keywords: {},
                keywordLists: {},
                properties: {},
                children: [
                    {
                        type: 'headline',
                        range: makeRange(),
                        postBlank: 0,
                        properties: {
                            level: 1,
                            rawValue: 'First Headline',
                            tags: [],
                            archivedp: false,
                            commentedp: false,
                            footnoteSection: false,
                            lineNumber: 1,
                        },
                        children: [],
                    } as HeadlineElement,
                ],
            };

            const result = serialize(doc);
            expect(result).toContain('* First Headline');
        });
    });

    // =========================================================================
    // serializeHeadline() - Headline serialization
    // =========================================================================
    describe('serializeHeadline()', () => {
        it('serializes simple headline', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Simple Headline',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('* Simple Headline');
        });

        it('serializes headline with multiple levels', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 3,
                    rawValue: 'Level 3 Headline',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('*** Level 3 Headline');
        });

        it('serializes headline with TODO keyword', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Task to do',
                    todoKeyword: 'TODO',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('* TODO Task to do');
        });

        it('serializes headline with DONE keyword', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Completed task',
                    todoKeyword: 'DONE',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('* DONE Completed task');
        });

        it('serializes headline with priority', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'High priority',
                    priority: 'A',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('* [#A] High priority');
        });

        it('serializes headline with COMMENT prefix', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Commented headline',
                    tags: [],
                    archivedp: false,
                    commentedp: true,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('* COMMENT Commented headline');
        });

        it('serializes headline with tags', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Tagged headline',
                    tags: ['work', 'urgent'],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('* Tagged headline :work:urgent:');
        });

        it('serializes headline with TODO, priority, and tags', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 2,
                    rawValue: 'Complex headline',
                    todoKeyword: 'TODO',
                    priority: 'B',
                    tags: ['project', 'review'],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toBe('** TODO [#B] Complex headline :project:review:');
        });

        it('serializes headline with planning line', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Scheduled task',
                    todoKeyword: 'TODO',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                planning: {
                    type: 'planning',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        scheduled: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'active',
                                rawValue: '<2024-01-15 Mon>',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 15,
                            },
                        } as TimestampObject,
                    },
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toContain('* TODO Scheduled task');
            expect(result).toContain('SCHEDULED: <2024-01-15 Mon>');
        });

        it('serializes headline with properties drawer', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'With properties',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                propertiesDrawer: {
                    CUSTOM_ID: 'my-id',
                    CATEGORY: 'work',
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toContain(':PROPERTIES:');
            expect(result).toContain(':CUSTOM_ID: my-id');
            expect(result).toContain(':CATEGORY: work');
            expect(result).toContain(':END:');
        });

        it('serializes headline with nested children', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Parent',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                children: [
                    {
                        type: 'headline',
                        range: makeRange(),
                        postBlank: 0,
                        properties: {
                            level: 2,
                            rawValue: 'Child',
                            tags: [],
                            archivedp: false,
                            commentedp: false,
                            footnoteSection: false,
                            lineNumber: 2,
                        },
                        children: [],
                    } as HeadlineElement,
                ],
            };

            const result = serializeHeadline(headline);
            expect(result).toContain('* Parent');
            expect(result).toContain('** Child');
        });

        it('serializes headline with section content', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'With content',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                section: {
                    type: 'section',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'Body text.' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
                children: [],
            };

            const result = serializeHeadline(headline);
            expect(result).toContain('* With content');
            expect(result).toContain('Body text.');
        });
    });

    // =========================================================================
    // serializeSection() - Section serialization
    // =========================================================================
    describe('serializeSection()', () => {
        it('serializes empty section', () => {
            const section: SectionElement = {
                type: 'section',
                range: makeRange(),
                postBlank: 0,
                children: [],
            };

            const result = serializeSection(section);
            expect(result).toBe('');
        });

        it('serializes section with paragraph', () => {
            const section: SectionElement = {
                type: 'section',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'paragraph',
                        range: makeRange(),
                        postBlank: 0,
                        children: [
                            {
                                type: 'plain-text',
                                range: makeRange(),
                                postBlank: 0,
                                properties: { value: 'Hello world.' },
                            } as PlainTextObject,
                        ],
                    } as ParagraphElement,
                ],
            };

            const result = serializeSection(section);
            expect(result).toBe('Hello world.');
        });

        it('serializes section with multiple elements', () => {
            const section: SectionElement = {
                type: 'section',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'paragraph',
                        range: makeRange(),
                        postBlank: 0,
                        children: [
                            {
                                type: 'plain-text',
                                range: makeRange(),
                                postBlank: 0,
                                properties: { value: 'First paragraph.' },
                            } as PlainTextObject,
                        ],
                    } as ParagraphElement,
                    {
                        type: 'horizontal-rule',
                        range: makeRange(),
                        postBlank: 0,
                    } as HorizontalRuleElement,
                    {
                        type: 'paragraph',
                        range: makeRange(),
                        postBlank: 0,
                        children: [
                            {
                                type: 'plain-text',
                                range: makeRange(),
                                postBlank: 0,
                                properties: { value: 'Second paragraph.' },
                            } as PlainTextObject,
                        ],
                    } as ParagraphElement,
                ],
            };

            const result = serializeSection(section);
            expect(result).toContain('First paragraph.');
            expect(result).toContain('-----');
            expect(result).toContain('Second paragraph.');
        });
    });

    // =========================================================================
    // serializeElement() - Element serialization
    // =========================================================================
    describe('serializeElement()', () => {
        describe('source block', () => {
            it('serializes simple source block', () => {
                const block: SrcBlockElement = {
                    type: 'src-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        language: 'python',
                        value: 'print("Hello")',
                        headers: {},
                        lineNumber: 1,
                        endLineNumber: 3,
                    },
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_SRC python\nprint("Hello")\n#+END_SRC');
            });

            it('serializes source block with parameters', () => {
                const block: SrcBlockElement = {
                    type: 'src-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        language: 'python',
                        value: 'print(x)',
                        parameters: ':results output :var x=5',
                        headers: { results: 'output', var: 'x=5' },
                        lineNumber: 1,
                        endLineNumber: 3,
                    },
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_SRC python :results output :var x=5\nprint(x)\n#+END_SRC');
            });
        });

        describe('example block', () => {
            it('serializes simple example block', () => {
                const block: ExampleBlockElement = {
                    type: 'example-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'Example text',
                    },
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_EXAMPLE\nExample text\n#+END_EXAMPLE');
            });

            it('serializes example block with switches', () => {
                const block: ExampleBlockElement = {
                    type: 'example-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'Line 1\nLine 2',
                        switches: '-n 10',
                    },
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_EXAMPLE -n 10\nLine 1\nLine 2\n#+END_EXAMPLE');
            });
        });

        describe('export block', () => {
            it('serializes export block', () => {
                const block: ExportBlockElement = {
                    type: 'export-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        backend: 'html',
                        value: '<div>content</div>',
                    },
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_EXPORT html\n<div>content</div>\n#+END_EXPORT');
            });
        });

        describe('quote block', () => {
            it('serializes quote block', () => {
                const block: QuoteBlockElement = {
                    type: 'quote-block',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'A famous quote.' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_QUOTE\nA famous quote.\n#+END_QUOTE');
            });
        });

        describe('center block', () => {
            it('serializes center block', () => {
                const block: CenterBlockElement = {
                    type: 'center-block',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'Centered content' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_CENTER\nCentered content\n#+END_CENTER');
            });
        });

        describe('special block', () => {
            it('serializes special block', () => {
                const block: SpecialBlockElement = {
                    type: 'special-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        blockType: 'WARNING',
                    },
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'Warning message!' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_WARNING\nWarning message!\n#+END_WARNING');
            });
        });

        describe('verse block', () => {
            it('serializes verse block', () => {
                const block: VerseBlockElement = {
                    type: 'verse-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'Line 1\n  Line 2\nLine 3',
                    },
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_VERSE\nLine 1\n  Line 2\nLine 3\n#+END_VERSE');
            });
        });

        describe('comment block', () => {
            it('serializes comment block', () => {
                const block: CommentBlockElement = {
                    type: 'comment-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'This is a comment',
                    },
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN_COMMENT\nThis is a comment\n#+END_COMMENT');
            });
        });

        describe('keyword', () => {
            it('serializes keyword', () => {
                const keyword: KeywordElement = {
                    type: 'keyword',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        key: 'TITLE',
                        value: 'My Document',
                    },
                };

                const result = serializeElement(keyword);
                expect(result).toBe('#+TITLE: My Document');
            });
        });

        describe('comment', () => {
            it('serializes comment', () => {
                const comment: CommentElement = {
                    type: 'comment',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'A comment line',
                    },
                };

                const result = serializeElement(comment);
                expect(result).toBe('# A comment line');
            });
        });

        describe('horizontal rule', () => {
            it('serializes horizontal rule', () => {
                const hr: HorizontalRuleElement = {
                    type: 'horizontal-rule',
                    range: makeRange(),
                    postBlank: 0,
                };

                const result = serializeElement(hr);
                expect(result).toBe('-----');
            });
        });

        describe('fixed width', () => {
            it('serializes single-line fixed width', () => {
                const fixed: FixedWidthElement = {
                    type: 'fixed-width',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'Fixed text',
                    },
                };

                const result = serializeElement(fixed);
                expect(result).toBe(': Fixed text');
            });

            it('serializes multi-line fixed width', () => {
                const fixed: FixedWidthElement = {
                    type: 'fixed-width',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'Line 1\nLine 2\nLine 3',
                    },
                };

                const result = serializeElement(fixed);
                expect(result).toBe(': Line 1\n: Line 2\n: Line 3');
            });
        });

        describe('drawer', () => {
            it('serializes drawer', () => {
                const drawer: DrawerElement = {
                    type: 'drawer',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        name: 'LOGBOOK',
                    },
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: '- Note taken' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                };

                const result = serializeElement(drawer);
                expect(result).toBe(':LOGBOOK:\n- Note taken\n:END:');
            });
        });

        describe('property drawer', () => {
            it('serializes property drawer', () => {
                const drawer: PropertyDrawerElement = {
                    type: 'property-drawer',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'node-property',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                key: 'ID',
                                value: '12345',
                            },
                        } as NodePropertyElement,
                        {
                            type: 'node-property',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                key: 'CATEGORY',
                                value: 'work',
                            },
                        } as NodePropertyElement,
                    ],
                };

                const result = serializeElement(drawer);
                expect(result).toContain(':PROPERTIES:');
                expect(result).toContain(':ID: 12345');
                expect(result).toContain(':CATEGORY: work');
                expect(result).toContain(':END:');
            });
        });

        describe('babel call', () => {
            it('serializes simple babel call', () => {
                const call: BabelCallElement = {
                    type: 'babel-call',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        call: 'my-block',
                    },
                };

                const result = serializeElement(call);
                expect(result).toBe('#+CALL: my-block()');
            });

            it('serializes babel call with arguments', () => {
                const call: BabelCallElement = {
                    type: 'babel-call',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        call: 'my-block',
                        arguments: 'x=1, y=2',
                    },
                };

                const result = serializeElement(call);
                expect(result).toBe('#+CALL: my-block(x=1, y=2)');
            });

            it('serializes babel call with all headers', () => {
                const call: BabelCallElement = {
                    type: 'babel-call',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        call: 'my-block',
                        insideHeader: ':results output',
                        arguments: 'x=1',
                        endHeader: ':exports results',
                    },
                };

                const result = serializeElement(call);
                expect(result).toBe('#+CALL: my-block[:results output](x=1)[:exports results]');
            });
        });

        describe('latex environment', () => {
            it('serializes latex environment', () => {
                const env: LatexEnvironmentElement = {
                    type: 'latex-environment',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        name: 'equation',
                        value: '\\begin{equation}\nE = mc^2\n\\end{equation}',
                    },
                };

                const result = serializeElement(env);
                expect(result).toBe('\\begin{equation}\nE = mc^2\n\\end{equation}');
            });
        });

        describe('footnote definition', () => {
            it('serializes footnote definition', () => {
                const fn: FootnoteDefinitionElement = {
                    type: 'footnote-definition',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        label: '1',
                    },
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'Footnote content.' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                };

                const result = serializeElement(fn);
                expect(result).toBe('[fn:1] Footnote content.');
            });
        });

        describe('dynamic block', () => {
            it('serializes dynamic block', () => {
                const block: DynamicBlockElement = {
                    type: 'dynamic-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        name: 'clocktable',
                        arguments: ':maxlevel 2',
                    },
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: '| Headline | Time |' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                };

                const result = serializeElement(block);
                expect(result).toContain('#+BEGIN: clocktable :maxlevel 2');
                expect(result).toContain('| Headline | Time |');
                expect(result).toContain('#+END:');
            });

            it('serializes dynamic block without arguments', () => {
                const block: DynamicBlockElement = {
                    type: 'dynamic-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        name: 'columnview',
                    },
                    children: [],
                };

                const result = serializeElement(block);
                expect(result).toBe('#+BEGIN: columnview\n\n#+END:');
            });
        });

        describe('inlinetask', () => {
            it('serializes simple inlinetask', () => {
                const task: InlinetaskElement = {
                    type: 'inlinetask',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        level: 15,
                        rawValue: 'Inline task',
                        tags: [],
                    },
                    children: [],
                };

                const result = serializeElement(task);
                expect(result).toBe('*************** Inline task');
            });

            it('serializes inlinetask with TODO and priority', () => {
                const task: InlinetaskElement = {
                    type: 'inlinetask',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        level: 15,
                        rawValue: 'Priority task',
                        todoKeyword: 'TODO',
                        priority: 'A',
                        tags: ['urgent'],
                    },
                    children: [],
                };

                const result = serializeElement(task);
                expect(result).toBe('*************** TODO [#A] Priority task :urgent:');
            });

            it('serializes inlinetask with content', () => {
                const task: InlinetaskElement = {
                    type: 'inlinetask',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        level: 15,
                        rawValue: 'Task with content',
                        tags: [],
                    },
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'Task body.' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                };

                const result = serializeElement(task);
                expect(result).toContain('*************** Task with content');
                expect(result).toContain('Task body.');
                expect(result).toContain('*************** END');
            });
        });

        describe('diary sexp', () => {
            it('serializes diary sexp', () => {
                const sexp: DiarySexpElement = {
                    type: 'diary-sexp',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        value: 'diary-anniversary 1 15 1990',
                    },
                };

                const result = serializeElement(sexp);
                expect(result).toBe('%%(diary-anniversary 1 15 1990)');
            });
        });

        describe('planning', () => {
            it('serializes planning with scheduled', () => {
                const planning: PlanningElement = {
                    type: 'planning',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        scheduled: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'active',
                                rawValue: '<2024-01-15>',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 15,
                            },
                        } as TimestampObject,
                    },
                };

                const result = serializeElement(planning);
                expect(result).toBe('SCHEDULED: <2024-01-15>');
            });

            it('serializes planning with deadline', () => {
                const planning: PlanningElement = {
                    type: 'planning',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        deadline: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'active',
                                rawValue: '<2024-01-20>',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 20,
                            },
                        } as TimestampObject,
                    },
                };

                const result = serializeElement(planning);
                expect(result).toBe('DEADLINE: <2024-01-20>');
            });

            it('serializes planning with closed', () => {
                const planning: PlanningElement = {
                    type: 'planning',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        closed: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'inactive',
                                rawValue: '[2024-01-14]',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 14,
                            },
                        } as TimestampObject,
                    },
                };

                const result = serializeElement(planning);
                expect(result).toBe('CLOSED: [2024-01-14]');
            });

            it('serializes planning with all fields', () => {
                const planning: PlanningElement = {
                    type: 'planning',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        closed: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'inactive',
                                rawValue: '[2024-01-14]',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 14,
                            },
                        } as TimestampObject,
                        deadline: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'active',
                                rawValue: '<2024-01-20>',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 20,
                            },
                        } as TimestampObject,
                        scheduled: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'active',
                                rawValue: '<2024-01-15>',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 15,
                            },
                        } as TimestampObject,
                    },
                };

                const result = serializeElement(planning);
                expect(result).toContain('CLOSED: [2024-01-14]');
                expect(result).toContain('DEADLINE: <2024-01-20>');
                expect(result).toContain('SCHEDULED: <2024-01-15>');
            });
        });

        describe('clock', () => {
            it('serializes running clock', () => {
                const clock: ClockElement = {
                    type: 'clock',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        status: 'running',
                        start: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'inactive',
                                rawValue: '[2024-01-15 10:00]',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 15,
                                hourStart: 10,
                                minuteStart: 0,
                            },
                        } as TimestampObject,
                    },
                };

                const result = serializeElement(clock);
                expect(result).toBe('CLOCK: [2024-01-15 10:00]');
            });

            it('serializes closed clock with duration', () => {
                const clock: ClockElement = {
                    type: 'clock',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        status: 'closed',
                        start: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'inactive',
                                rawValue: '[2024-01-15 10:00]',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 15,
                                hourStart: 10,
                                minuteStart: 0,
                            },
                        } as TimestampObject,
                        end: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'inactive',
                                rawValue: '[2024-01-15 11:30]',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 15,
                                hourStart: 11,
                                minuteStart: 30,
                            },
                        } as TimestampObject,
                        duration: '1:30',
                    },
                };

                const result = serializeElement(clock);
                expect(result).toBe('CLOCK: [2024-01-15 10:00]--[2024-01-15 11:30] =>  1:30');
            });
        });

        describe('table', () => {
            it('serializes simple table', () => {
                const table: TableElement = {
                    type: 'table',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        tableType: 'org',
                    },
                    children: [
                        {
                            type: 'table-row',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { rowType: 'standard' },
                            children: [
                                {
                                    type: 'table-cell',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'A' },
                                } as TableCellObject,
                                {
                                    type: 'table-cell',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'B' },
                                } as TableCellObject,
                            ],
                        } as TableRowElement,
                        {
                            type: 'table-row',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { rowType: 'rule' },
                            children: [],
                        } as TableRowElement,
                        {
                            type: 'table-row',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { rowType: 'standard' },
                            children: [
                                {
                                    type: 'table-cell',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: '1' },
                                } as TableCellObject,
                                {
                                    type: 'table-cell',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: '2' },
                                } as TableCellObject,
                            ],
                        } as TableRowElement,
                    ],
                };

                const result = serializeElement(table);
                expect(result).toContain('| A | B |');
                expect(result).toContain('|---');
                expect(result).toContain('| 1 | 2 |');
            });

            it('serializes table.el table', () => {
                const tableValue = '+----+----+\n| A  | B  |\n+----+----+';
                const table: TableElement = {
                    type: 'table',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        tableType: 'table.el',
                        value: tableValue,
                    },
                    children: [],
                };

                const result = serializeElement(table);
                expect(result).toBe(tableValue);
            });
        });

        describe('plain list', () => {
            it('serializes unordered list', () => {
                const list: PlainListElement = {
                    type: 'plain-list',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        listType: 'unordered',
                    },
                    children: [
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '-',
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'Item 1' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '-',
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'Item 2' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                    ],
                };

                const result = serializeElement(list);
                expect(result).toContain('- Item 1');
                expect(result).toContain('- Item 2');
            });

            it('serializes ordered list', () => {
                const list: PlainListElement = {
                    type: 'plain-list',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        listType: 'ordered',
                    },
                    children: [
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '1.',
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'First' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '2.',
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'Second' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                    ],
                };

                const result = serializeElement(list);
                expect(result).toContain('1. First');
                expect(result).toContain('2. Second');
            });

            it('serializes list with checkboxes', () => {
                const list: PlainListElement = {
                    type: 'plain-list',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        listType: 'unordered',
                    },
                    children: [
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '-',
                                checkbox: 'on',
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'Done item' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '-',
                                checkbox: 'off',
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'Pending item' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '-',
                                checkbox: 'trans',
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'Partial item' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                    ],
                };

                const result = serializeElement(list);
                expect(result).toContain('- [X] Done item');
                expect(result).toContain('- [ ] Pending item');
                expect(result).toContain('- [-] Partial item');
            });

            it('serializes descriptive list', () => {
                const list: PlainListElement = {
                    type: 'plain-list',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        listType: 'descriptive',
                    },
                    children: [
                        {
                            type: 'item',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                bullet: '-',
                                tag: [
                                    {
                                        type: 'plain-text',
                                        range: makeRange(),
                                        postBlank: 0,
                                        properties: { value: 'Term' },
                                    } as PlainTextObject,
                                ],
                            },
                            children: [
                                {
                                    type: 'paragraph',
                                    range: makeRange(),
                                    postBlank: 0,
                                    children: [
                                        {
                                            type: 'plain-text',
                                            range: makeRange(),
                                            postBlank: 0,
                                            properties: { value: 'Definition' },
                                        } as PlainTextObject,
                                    ],
                                } as ParagraphElement,
                            ],
                        } as ItemElement,
                    ],
                };

                const result = serializeElement(list);
                expect(result).toContain('- Term :: Definition');
            });
        });
    });

    // =========================================================================
    // serializeObject() - Object serialization
    // =========================================================================
    describe('serializeObject()', () => {
        it('serializes plain text', () => {
            const obj: PlainTextObject = {
                type: 'plain-text',
                range: makeRange(),
                postBlank: 0,
                properties: { value: 'Hello world' },
            };

            const result = serializeObject(obj);
            expect(result).toBe('Hello world');
        });

        it('serializes bold', () => {
            const obj: BoldObject = {
                type: 'bold',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'plain-text',
                        range: makeRange(),
                        postBlank: 0,
                        properties: { value: 'bold text' },
                    } as PlainTextObject,
                ],
            };

            const result = serializeObject(obj);
            expect(result).toBe('*bold text*');
        });

        it('serializes italic', () => {
            const obj: ItalicObject = {
                type: 'italic',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'plain-text',
                        range: makeRange(),
                        postBlank: 0,
                        properties: { value: 'italic text' },
                    } as PlainTextObject,
                ],
            };

            const result = serializeObject(obj);
            expect(result).toBe('/italic text/');
        });

        it('serializes underline', () => {
            const obj: UnderlineObject = {
                type: 'underline',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'plain-text',
                        range: makeRange(),
                        postBlank: 0,
                        properties: { value: 'underlined' },
                    } as PlainTextObject,
                ],
            };

            const result = serializeObject(obj);
            expect(result).toBe('_underlined_');
        });

        it('serializes strike-through', () => {
            const obj: StrikeThroughObject = {
                type: 'strike-through',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'plain-text',
                        range: makeRange(),
                        postBlank: 0,
                        properties: { value: 'deleted' },
                    } as PlainTextObject,
                ],
            };

            const result = serializeObject(obj);
            expect(result).toBe('+deleted+');
        });

        it('serializes code', () => {
            const obj: CodeObject = {
                type: 'code',
                range: makeRange(),
                postBlank: 0,
                properties: { value: 'code' },
            };

            const result = serializeObject(obj);
            expect(result).toBe('=code=');
        });

        it('serializes verbatim', () => {
            const obj: VerbatimObject = {
                type: 'verbatim',
                range: makeRange(),
                postBlank: 0,
                properties: { value: 'verbatim' },
            };

            const result = serializeObject(obj);
            expect(result).toBe('~verbatim~');
        });

        it('serializes nested markup', () => {
            const obj: BoldObject = {
                type: 'bold',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'italic',
                        range: makeRange(),
                        postBlank: 0,
                        children: [
                            {
                                type: 'plain-text',
                                range: makeRange(),
                                postBlank: 0,
                                properties: { value: 'bold italic' },
                            } as PlainTextObject,
                        ],
                    } as ItalicObject,
                ],
            };

            const result = serializeObject(obj);
            expect(result).toBe('*/bold italic/*');
        });

        describe('link', () => {
            it('serializes plain link', () => {
                const link: LinkObject = {
                    type: 'link',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        linkType: 'http',
                        path: 'https://example.com',
                        format: 'plain',
                    },
                };

                const result = serializeObject(link);
                expect(result).toBe('https://example.com');
            });

            it('serializes angle link', () => {
                const link: LinkObject = {
                    type: 'link',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        linkType: 'http',
                        path: 'https://example.com',
                        format: 'angle',
                    },
                };

                const result = serializeObject(link);
                expect(result).toBe('<https://example.com>');
            });

            it('serializes bracket link without description', () => {
                const link: LinkObject = {
                    type: 'link',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        linkType: 'https',
                        path: 'example.com',
                        format: 'bracket',
                    },
                };

                const result = serializeObject(link);
                expect(result).toBe('[[https:example.com]]');
            });

            it('serializes bracket link with description', () => {
                const link: LinkObject = {
                    type: 'link',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        linkType: 'https',
                        path: 'example.com',
                        format: 'bracket',
                    },
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: 'Example Site' },
                        } as PlainTextObject,
                    ],
                };

                const result = serializeObject(link);
                expect(result).toBe('[[https:example.com][Example Site]]');
            });

            it('serializes fuzzy link', () => {
                const link: LinkObject = {
                    type: 'link',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        linkType: 'fuzzy',
                        path: 'Some Headline',
                        format: 'bracket',
                    },
                };

                const result = serializeObject(link);
                expect(result).toBe('[[Some Headline]]');
            });

            it('serializes file link', () => {
                const link: LinkObject = {
                    type: 'link',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        linkType: 'file',
                        path: './image.png',
                        format: 'bracket',
                    },
                };

                const result = serializeObject(link);
                expect(result).toBe('[[file:./image.png]]');
            });
        });

        describe('timestamp', () => {
            it('serializes timestamp with raw value', () => {
                const ts: TimestampObject = {
                    type: 'timestamp',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        timestampType: 'active',
                        rawValue: '<2024-01-15 Mon 10:00>',
                        yearStart: 2024,
                        monthStart: 1,
                        dayStart: 15,
                        hourStart: 10,
                        minuteStart: 0,
                    },
                };

                const result = serializeObject(ts);
                expect(result).toBe('<2024-01-15 Mon 10:00>');
            });

            it('serializes active timestamp without raw value', () => {
                const ts: TimestampObject = {
                    type: 'timestamp',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        timestampType: 'active',
                        rawValue: '',
                        yearStart: 2024,
                        monthStart: 1,
                        dayStart: 15,
                    },
                };

                const result = serializeObject(ts);
                expect(result).toBe('<2024-01-15>');
            });

            it('serializes inactive timestamp', () => {
                const ts: TimestampObject = {
                    type: 'timestamp',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        timestampType: 'inactive',
                        rawValue: '',
                        yearStart: 2024,
                        monthStart: 1,
                        dayStart: 15,
                    },
                };

                const result = serializeObject(ts);
                expect(result).toBe('[2024-01-15]');
            });

            it('serializes timestamp with time', () => {
                const ts: TimestampObject = {
                    type: 'timestamp',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        timestampType: 'active',
                        rawValue: '',
                        yearStart: 2024,
                        monthStart: 1,
                        dayStart: 15,
                        hourStart: 10,
                        minuteStart: 30,
                    },
                };

                const result = serializeObject(ts);
                expect(result).toBe('<2024-01-15 10:30>');
            });

            it('serializes timestamp with repeater', () => {
                const ts: TimestampObject = {
                    type: 'timestamp',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        timestampType: 'active',
                        rawValue: '',
                        yearStart: 2024,
                        monthStart: 1,
                        dayStart: 15,
                        repeaterType: '+',
                        repeaterValue: 1,
                        repeaterUnit: 'w',
                    },
                };

                const result = serializeObject(ts);
                expect(result).toBe('<2024-01-15 +1w>');
            });

            it('serializes timestamp with warning', () => {
                const ts: TimestampObject = {
                    type: 'timestamp',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        timestampType: 'active',
                        rawValue: '',
                        yearStart: 2024,
                        monthStart: 1,
                        dayStart: 15,
                        warningType: '-',
                        warningValue: 3,
                        warningUnit: 'd',
                    },
                };

                const result = serializeObject(ts);
                expect(result).toBe('<2024-01-15 -3d>');
            });
        });

        describe('entity', () => {
            it('serializes entity without brackets', () => {
                const entity: EntityObject = {
                    type: 'entity',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        name: 'alpha',
                        usesBrackets: false,
                        latex: '\\alpha',
                        html: '&alpha;',
                        utf8: 'α',
                    },
                };

                const result = serializeObject(entity);
                expect(result).toBe('\\alpha');
            });

            it('serializes entity with brackets', () => {
                const entity: EntityObject = {
                    type: 'entity',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        name: 'alpha',
                        usesBrackets: true,
                        latex: '\\alpha',
                        html: '&alpha;',
                        utf8: 'α',
                    },
                };

                const result = serializeObject(entity);
                expect(result).toBe('\\alpha{}');
            });
        });

        it('serializes latex fragment', () => {
            const frag: LatexFragmentObject = {
                type: 'latex-fragment',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    value: '$E=mc^2$',
                    fragmentType: 'inline-math',
                },
            };

            const result = serializeObject(frag);
            expect(result).toBe('$E=mc^2$');
        });

        describe('subscript', () => {
            it('serializes subscript without braces', () => {
                const sub: SubscriptObject = {
                    type: 'subscript',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { usesBraces: false },
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: '1' },
                        } as PlainTextObject,
                    ],
                };

                const result = serializeObject(sub);
                expect(result).toBe('_1');
            });

            it('serializes subscript with braces', () => {
                const sub: SubscriptObject = {
                    type: 'subscript',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { usesBraces: true },
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: 'index' },
                        } as PlainTextObject,
                    ],
                };

                const result = serializeObject(sub);
                expect(result).toBe('_{index}');
            });
        });

        describe('superscript', () => {
            it('serializes superscript without braces', () => {
                const sup: SuperscriptObject = {
                    type: 'superscript',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { usesBraces: false },
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: '2' },
                        } as PlainTextObject,
                    ],
                };

                const result = serializeObject(sup);
                expect(result).toBe('^2');
            });

            it('serializes superscript with braces', () => {
                const sup: SuperscriptObject = {
                    type: 'superscript',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { usesBraces: true },
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: 'exp' },
                        } as PlainTextObject,
                    ],
                };

                const result = serializeObject(sup);
                expect(result).toBe('^{exp}');
            });
        });

        describe('footnote reference', () => {
            it('serializes standard footnote reference', () => {
                const fn: FootnoteReferenceObject = {
                    type: 'footnote-reference',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        label: '1',
                        referenceType: 'standard',
                    },
                };

                const result = serializeObject(fn);
                expect(result).toBe('[fn:1]');
            });

            it('serializes inline footnote', () => {
                const fn: FootnoteReferenceObject = {
                    type: 'footnote-reference',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        referenceType: 'inline',
                    },
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: 'Inline footnote content' },
                        } as PlainTextObject,
                    ],
                };

                const result = serializeObject(fn);
                expect(result).toBe('[fn:: Inline footnote content]');
            });

            it('serializes anonymous footnote reference', () => {
                const fn: FootnoteReferenceObject = {
                    type: 'footnote-reference',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        referenceType: 'standard',
                    },
                };

                const result = serializeObject(fn);
                expect(result).toBe('[fn:]');
            });
        });

        it('serializes statistics cookie', () => {
            const cookie: StatisticsCookieObject = {
                type: 'statistics-cookie',
                range: makeRange(),
                postBlank: 0,
                properties: { value: '[2/5]' },
            };

            const result = serializeObject(cookie);
            expect(result).toBe('[2/5]');
        });

        it('serializes target', () => {
            const target: TargetObject = {
                type: 'target',
                range: makeRange(),
                postBlank: 0,
                properties: { value: 'my-target' },
            };

            const result = serializeObject(target);
            expect(result).toBe('<<my-target>>');
        });

        it('serializes radio target', () => {
            const radio: RadioTargetObject = {
                type: 'radio-target',
                range: makeRange(),
                postBlank: 0,
                children: [
                    {
                        type: 'plain-text',
                        range: makeRange(),
                        postBlank: 0,
                        properties: { value: 'radio text' },
                    } as PlainTextObject,
                ],
            };

            const result = serializeObject(radio);
            expect(result).toBe('<<<radio text>>>');
        });

        it('serializes line break', () => {
            const lb: LineBreakObject = {
                type: 'line-break',
                range: makeRange(),
                postBlank: 0,
            };

            const result = serializeObject(lb);
            expect(result).toBe('\\\\\n');
        });

        describe('inline babel call', () => {
            it('serializes simple inline babel call', () => {
                const call: InlineBabelCallObject = {
                    type: 'inline-babel-call',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        call: 'my-block',
                    },
                };

                const result = serializeObject(call);
                expect(result).toBe('call_my-block()');
            });

            it('serializes inline babel call with all options', () => {
                const call: InlineBabelCallObject = {
                    type: 'inline-babel-call',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        call: 'my-block',
                        insideHeader: ':results output',
                        arguments: 'x=1',
                        endHeader: ':exports results',
                    },
                };

                const result = serializeObject(call);
                expect(result).toBe('call_my-block[:results output](x=1)[:exports results]');
            });
        });

        describe('inline src block', () => {
            it('serializes simple inline src block', () => {
                const block: InlineSrcBlockObject = {
                    type: 'inline-src-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        language: 'python',
                        value: '1+1',
                    },
                };

                const result = serializeObject(block);
                expect(result).toBe('src_python{1+1}');
            });

            it('serializes inline src block with parameters', () => {
                const block: InlineSrcBlockObject = {
                    type: 'inline-src-block',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        language: 'python',
                        value: '1+1',
                        parameters: ':results value',
                    },
                };

                const result = serializeObject(block);
                expect(result).toBe('src_python[:results value]{1+1}');
            });
        });

        it('serializes export snippet', () => {
            const snippet: ExportSnippetObject = {
                type: 'export-snippet',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    backend: 'html',
                    value: '<br/>',
                },
            };

            const result = serializeObject(snippet);
            expect(result).toBe('@@html:<br/>@@');
        });

        describe('macro', () => {
            it('serializes macro without args', () => {
                const macro: MacroObject = {
                    type: 'macro',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        key: 'author',
                        args: [],
                    },
                };

                const result = serializeObject(macro);
                expect(result).toBe('{{{author}}}');
            });

            it('serializes macro with args', () => {
                const macro: MacroObject = {
                    type: 'macro',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        key: 'color',
                        args: ['red', 'text'],
                    },
                };

                const result = serializeObject(macro);
                expect(result).toBe('{{{color(red,text)}}}');
            });
        });

        it('serializes table cell', () => {
            const cell: TableCellObject = {
                type: 'table-cell',
                range: makeRange(),
                postBlank: 0,
                properties: { value: 'Cell content' },
            };

            const result = serializeObject(cell);
            expect(result).toBe('Cell content');
        });
    });

    // =========================================================================
    // serializeObjects() - Multiple object serialization
    // =========================================================================
    describe('serializeObjects()', () => {
        it('serializes empty array', () => {
            const result = serializeObjects([]);
            expect(result).toBe('');
        });

        it('serializes multiple plain text objects', () => {
            const objects = [
                {
                    type: 'plain-text',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { value: 'Hello ' },
                } as PlainTextObject,
                {
                    type: 'plain-text',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { value: 'world' },
                } as PlainTextObject,
            ];

            const result = serializeObjects(objects);
            expect(result).toBe('Hello world');
        });

        it('serializes mixed objects', () => {
            const objects = [
                {
                    type: 'plain-text',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { value: 'This is ' },
                } as PlainTextObject,
                {
                    type: 'bold',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: 'bold' },
                        } as PlainTextObject,
                    ],
                } as BoldObject,
                {
                    type: 'plain-text',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { value: ' and ' },
                } as PlainTextObject,
                {
                    type: 'italic',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'plain-text',
                            range: makeRange(),
                            postBlank: 0,
                            properties: { value: 'italic' },
                        } as PlainTextObject,
                    ],
                } as ItalicObject,
                {
                    type: 'plain-text',
                    range: makeRange(),
                    postBlank: 0,
                    properties: { value: ' text.' },
                } as PlainTextObject,
            ];

            const result = serializeObjects(objects);
            expect(result).toBe('This is *bold* and /italic/ text.');
        });
    });

    // =========================================================================
    // Roundtrip tests - parse then serialize
    // =========================================================================
    describe('roundtrip (parse -> serialize)', () => {
        it('roundtrips simple headline', () => {
            const original = '* Simple Headline\n';
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized.trim()).toBe(original.trim());
        });

        it('roundtrips headline with TODO and priority', () => {
            const original = '* TODO [#A] Important Task\n';
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized).toContain('* TODO [#A] Important Task');
        });

        it('roundtrips headline with tags', () => {
            const original = '* Headline :tag1:tag2:\n';
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized).toContain('* Headline :tag1:tag2:');
        });

        it('roundtrips source block', () => {
            const original = `#+BEGIN_SRC python
print("Hello")
#+END_SRC
`;
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized).toContain('#+BEGIN_SRC python');
            expect(serialized).toContain('print("Hello")');
            expect(serialized).toContain('#+END_SRC');
        });

        it('roundtrips document with keywords', () => {
            const original = `#+TITLE: Test Document
#+AUTHOR: Test Author
`;
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized).toContain('#+TITLE: Test Document');
            expect(serialized).toContain('#+AUTHOR: Test Author');
        });

        it('roundtrips nested headlines', () => {
            const original = `* Level 1
** Level 2
*** Level 3
`;
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized).toContain('* Level 1');
            expect(serialized).toContain('** Level 2');
            expect(serialized).toContain('*** Level 3');
        });

        it('roundtrips planning line', () => {
            const original = `* TODO Task
SCHEDULED: <2024-01-15 Mon>
`;
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized).toContain('* TODO Task');
            expect(serialized).toContain('SCHEDULED:');
            // The timestamp format may differ slightly, so just check it contains the date
            expect(serialized).toContain('2024');
        });

        it('roundtrips properties drawer', () => {
            const original = `* Headline
:PROPERTIES:
:CUSTOM_ID: my-id
:END:
`;
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            expect(serialized).toContain(':PROPERTIES:');
            expect(serialized).toContain(':CUSTOM_ID: my-id');
            expect(serialized).toContain(':END:');
        });

        it('roundtrips complex document', () => {
            const original = `#+TITLE: Complex Document
#+AUTHOR: Test

* TODO [#A] First Task :work:urgent:
SCHEDULED: <2024-01-15 Mon>
:PROPERTIES:
:ID: task-001
:END:

This is the body with *bold* text.

#+BEGIN_SRC python
print("Hello")
#+END_SRC

** DONE Subtask
CLOSED: [2024-01-14 Sun]

* Second Section :notes:

- Item 1
- Item 2
`;
            const doc = parseOrg(original);
            const serialized = serialize(doc);

            // Verify key elements are preserved
            expect(serialized).toContain('#+TITLE: Complex Document');
            expect(serialized).toContain('* TODO [#A] First Task :work:urgent:');
            expect(serialized).toContain(':PROPERTIES:');
            expect(serialized).toContain(':ID: task-001');
            expect(serialized).toContain('#+BEGIN_SRC python');
            expect(serialized).toContain('** DONE Subtask');
            expect(serialized).toContain('* Second Section :notes:');
        });
    });

    // =========================================================================
    // Edge cases
    // =========================================================================
    describe('edge cases', () => {
        it('handles unknown element types gracefully', () => {
            const unknownElement = {
                type: 'unknown-type',
                range: makeRange(),
                postBlank: 0,
            } as any;

            const result = serializeElement(unknownElement);
            expect(result).toBe('');
        });

        it('handles unknown object types gracefully', () => {
            const unknownObject = {
                type: 'unknown-object',
                range: makeRange(),
                postBlank: 0,
            } as any;

            const result = serializeObject(unknownObject);
            expect(result).toBe('');
        });

        it('handles empty properties drawer', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 1,
                    rawValue: 'Headline',
                    tags: [],
                    archivedp: false,
                    commentedp: false,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                propertiesDrawer: {},
                children: [],
            };

            const result = serializeHeadline(headline);
            // Empty properties drawer should not be serialized
            expect(result).not.toContain(':PROPERTIES:');
        });

        it('handles headline with all features combined', () => {
            const headline: HeadlineElement = {
                type: 'headline',
                range: makeRange(),
                postBlank: 0,
                properties: {
                    level: 2,
                    rawValue: 'Full Feature Headline',
                    todoKeyword: 'TODO',
                    priority: 'A',
                    tags: ['tag1', 'tag2', 'tag3'],
                    archivedp: false,
                    commentedp: true,
                    footnoteSection: false,
                    lineNumber: 1,
                },
                planning: {
                    type: 'planning',
                    range: makeRange(),
                    postBlank: 0,
                    properties: {
                        scheduled: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'active',
                                rawValue: '<2024-01-15>',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 15,
                            },
                        } as TimestampObject,
                        deadline: {
                            type: 'timestamp',
                            range: makeRange(),
                            postBlank: 0,
                            properties: {
                                timestampType: 'active',
                                rawValue: '<2024-01-20>',
                                yearStart: 2024,
                                monthStart: 1,
                                dayStart: 20,
                            },
                        } as TimestampObject,
                    },
                },
                propertiesDrawer: {
                    ID: 'unique-id',
                    CATEGORY: 'test',
                },
                section: {
                    type: 'section',
                    range: makeRange(),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: makeRange(),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'plain-text',
                                    range: makeRange(),
                                    postBlank: 0,
                                    properties: { value: 'Body content.' },
                                } as PlainTextObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
                children: [
                    {
                        type: 'headline',
                        range: makeRange(),
                        postBlank: 0,
                        properties: {
                            level: 3,
                            rawValue: 'Child Headline',
                            tags: [],
                            archivedp: false,
                            commentedp: false,
                            footnoteSection: false,
                            lineNumber: 10,
                        },
                        children: [],
                    } as HeadlineElement,
                ],
            };

            const result = serializeHeadline(headline);

            expect(result).toContain('** TODO [#A] COMMENT Full Feature Headline :tag1:tag2:tag3:');
            expect(result).toContain('SCHEDULED:');
            expect(result).toContain('DEADLINE:');
            expect(result).toContain(':PROPERTIES:');
            expect(result).toContain(':ID: unique-id');
            expect(result).toContain(':CATEGORY: test');
            expect(result).toContain(':END:');
            expect(result).toContain('Body content.');
            expect(result).toContain('*** Child Headline');
        });
    });
});
