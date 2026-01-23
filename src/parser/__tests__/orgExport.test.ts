/**
 * Tests for org-mode export backends (HTML and LaTeX)
 */

import { describe, it, expect } from 'vitest';
import { HtmlExportBackend, exportToHtml } from '../orgExportHtml';
import { LatexExportBackend, exportToLatex } from '../orgExportLatex';
import { parseOrg } from '../orgParserUnified';
import type { BibEntry } from '../../references/bibtexParser';
import {
    createExportState,
    escapeString,
    generateId,
    timestampToIso,
    expandMacro,
    BUILTIN_MACROS,
} from '../orgExport';
import type {
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    ParagraphElement,
    SrcBlockElement,
    TableElement,
    TableRowElement,
    PlainListElement,
    ItemElement,
    BoldObject,
    ItalicObject,
    LinkObject,
    CodeObject,
    PlainTextObject,
    EntityObject,
    TimestampObject,
    LatexFragmentObject,
    TableCellObject,
} from '../orgElementTypes';

// =============================================================================
// Test Helpers
// =============================================================================

function createRange(start: number, end: number) {
    return { start, end };
}

function createPlainText(value: string, start = 0): PlainTextObject {
    return {
        type: 'plain-text',
        range: createRange(start, start + value.length),
        postBlank: 0,
        properties: { value },
    };
}

function createSimpleDocument(content: string): OrgDocumentNode {
    return {
        type: 'org-data',
        properties: {},
        keywords: { TITLE: 'Test Document' },
        keywordLists: {},
        children: [],
        section: {
            type: 'section',
            range: createRange(0, content.length),
            postBlank: 0,
            children: [
                {
                    type: 'paragraph',
                    range: createRange(0, content.length),
                    postBlank: 0,
                    children: [createPlainText(content)],
                } as ParagraphElement,
            ],
        },
    };
}

// =============================================================================
// Export Utilities Tests
// =============================================================================

describe('Export Utilities', () => {
    describe('escapeString', () => {
        it('escapes HTML special characters', () => {
            expect(escapeString('<script>alert("xss")</script>', 'html'))
                .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        });

        it('escapes ampersands in HTML', () => {
            expect(escapeString('Tom & Jerry', 'html')).toBe('Tom &amp; Jerry');
        });

        it('escapes LaTeX special characters', () => {
            expect(escapeString('100% of $50', 'latex')).toBe('100\\% of \\$50');
        });

        it('escapes backslashes in LaTeX', () => {
            expect(escapeString('path\\to\\file', 'latex'))
                .toBe('path\\textbackslash{}to\\textbackslash{}file');
        });

        it('escapes underscores and hashes in LaTeX', () => {
            expect(escapeString('foo_bar #tag', 'latex')).toBe('foo\\_bar \\#tag');
        });
    });

    describe('generateId', () => {
        it('generates slug from text', () => {
            expect(generateId('Hello World')).toBe('org-hello-world');
        });

        it('handles special characters', () => {
            expect(generateId("What's this?")).toBe('org-what-s-this');
        });

        it('uses custom prefix', () => {
            expect(generateId('Section One', 'sec')).toBe('sec-section-one');
        });

        it('truncates long text', () => {
            const longText = 'a'.repeat(100);
            const id = generateId(longText);
            expect(id.length).toBeLessThanOrEqual(60);
        });
    });

    describe('timestampToIso', () => {
        it('converts date-only timestamp', () => {
            const ts: TimestampObject = {
                type: 'timestamp',
                range: createRange(0, 10),
                postBlank: 0,
                properties: {
                    timestampType: 'active',
                    rawValue: '<2024-03-15 Fri>',
                    yearStart: 2024,
                    monthStart: 3,
                    dayStart: 15,
                },
            };
            expect(timestampToIso(ts)).toBe('2024-03-15');
        });

        it('converts timestamp with time', () => {
            const ts: TimestampObject = {
                type: 'timestamp',
                range: createRange(0, 20),
                postBlank: 0,
                properties: {
                    timestampType: 'active',
                    rawValue: '<2024-03-15 Fri 14:30>',
                    yearStart: 2024,
                    monthStart: 3,
                    dayStart: 15,
                    hourStart: 14,
                    minuteStart: 30,
                },
            };
            expect(timestampToIso(ts)).toBe('2024-03-15T14:30');
        });
    });

    describe('expandMacro', () => {
        it('expands string macro with arguments', () => {
            const macros = { greeting: 'Hello, $1!' };
            expect(expandMacro('greeting', ['World'], macros)).toBe('Hello, World!');
        });

        it('expands function macro', () => {
            const macros = { sum: (a: string, b: string) => String(parseInt(a) + parseInt(b)) };
            expect(expandMacro('sum', ['2', '3'], macros)).toBe('5');
        });

        it('returns raw macro if not found', () => {
            expect(expandMacro('unknown', ['arg'], {})).toBe('{{{unknown(arg)}}}');
        });

        it('expands built-in date macro', () => {
            const result = expandMacro('date', [], BUILTIN_MACROS);
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('createExportState', () => {
        it('creates state with default options', () => {
            const state = createExportState();
            expect(state.footnotes.size).toBe(0);
            expect(state.options.language).toBe('en');
            expect(state.options.sectionNumbers).toBe(true);
        });

        it('merges custom options', () => {
            const state = createExportState({ language: 'de', toc: true });
            expect(state.options.language).toBe('de');
            expect(state.options.toc).toBe(true);
        });
    });
});

// =============================================================================
// HTML Export Tests
// =============================================================================

describe('HTML Export', () => {
    const backend = new HtmlExportBackend();

    describe('Object Export', () => {
        it('exports bold text', () => {
            const state = createExportState();
            const bold: BoldObject = {
                type: 'bold',
                range: createRange(0, 10),
                postBlank: 0,
                children: [createPlainText('hello')],
            };
            expect(backend.exportObject(bold, state)).toBe('<strong>hello</strong>');
        });

        it('exports italic text', () => {
            const state = createExportState();
            const italic: ItalicObject = {
                type: 'italic',
                range: createRange(0, 10),
                postBlank: 0,
                children: [createPlainText('emphasized')],
            };
            expect(backend.exportObject(italic, state)).toBe('<em>emphasized</em>');
        });

        it('exports code', () => {
            const state = createExportState();
            const code: CodeObject = {
                type: 'code',
                range: createRange(0, 10),
                postBlank: 0,
                properties: { value: 'console.log()' },
            };
            expect(backend.exportObject(code, state)).toBe('<code>console.log()</code>');
        });

        it('escapes HTML in code', () => {
            const state = createExportState();
            const code: CodeObject = {
                type: 'code',
                range: createRange(0, 10),
                postBlank: 0,
                properties: { value: '<div>' },
            };
            expect(backend.exportObject(code, state)).toBe('<code>&lt;div&gt;</code>');
        });

        it('exports links', () => {
            const state = createExportState();
            const link: LinkObject = {
                type: 'link',
                range: createRange(0, 30),
                postBlank: 0,
                properties: {
                    linkType: 'https',
                    path: 'https://example.com',
                    format: 'bracket',
                    rawLink: 'https://example.com',
                },
                children: [createPlainText('Example')],
            };
            expect(backend.exportObject(link, state))
                .toBe('<a href="https://example.com">Example</a>');
        });

        it('exports image links as img tags', () => {
            const state = createExportState();
            const link: LinkObject = {
                type: 'link',
                range: createRange(0, 30),
                postBlank: 0,
                properties: {
                    linkType: 'file',
                    path: 'image.png',
                    format: 'bracket',
                },
                children: [createPlainText('Alt text')],
            };
            expect(backend.exportObject(link, state))
                .toBe('<img src="image.png" alt="Alt text" />');
        });

        it('exports entities as HTML', () => {
            const state = createExportState();
            const entity: EntityObject = {
                type: 'entity',
                range: createRange(0, 6),
                postBlank: 0,
                properties: {
                    name: 'alpha',
                    usesBrackets: false,
                    latex: '\\alpha',
                    html: '&alpha;',
                    utf8: 'α',
                },
            };
            expect(backend.exportObject(entity, state)).toBe('&alpha;');
        });

        it('exports timestamps', () => {
            const state = createExportState({ timestamps: true });
            const ts: TimestampObject = {
                type: 'timestamp',
                range: createRange(0, 16),
                postBlank: 0,
                properties: {
                    timestampType: 'active',
                    rawValue: '<2024-03-15 Fri>',
                    yearStart: 2024,
                    monthStart: 3,
                    dayStart: 15,
                },
            };
            const result = backend.exportObject(ts, state);
            expect(result).toContain('datetime="2024-03-15"');
            expect(result).toContain('&lt;2024-03-15 Fri&gt;');
        });

        it('exports LaTeX fragments for MathJax', () => {
            const state = createExportState();
            const fragment: LatexFragmentObject = {
                type: 'latex-fragment',
                range: createRange(0, 10),
                postBlank: 0,
                properties: {
                    value: '$x^2$',
                    fragmentType: 'inline-math',
                },
            };
            expect(backend.exportObject(fragment, state)).toBe('\\(x^2\\)');
        });

        it('exports subscripts', () => {
            const state = createExportState();
            const sub = {
                type: 'subscript' as const,
                range: createRange(0, 3),
                postBlank: 0,
                properties: { usesBraces: false },
                children: [createPlainText('2')],
            };
            expect(backend.exportObject(sub, state)).toBe('<sub>2</sub>');
        });

        it('exports superscripts', () => {
            const state = createExportState();
            const sup = {
                type: 'superscript' as const,
                range: createRange(0, 3),
                postBlank: 0,
                properties: { usesBraces: false },
                children: [createPlainText('2')],
            };
            expect(backend.exportObject(sup, state)).toBe('<sup>2</sup>');
        });

        it('exports line breaks', () => {
            const state = createExportState();
            const br = {
                type: 'line-break' as const,
                range: createRange(0, 2),
                postBlank: 0,
            };
            expect(backend.exportObject(br, state)).toBe('<br />\n');
        });
    });

    describe('Element Export', () => {
        it('exports paragraphs', () => {
            const state = createExportState();
            const para: ParagraphElement = {
                type: 'paragraph',
                range: createRange(0, 20),
                postBlank: 0,
                children: [createPlainText('Hello, world!')],
            };
            expect(backend.exportElement(para, state)).toBe('<p>Hello, world!</p>\n');
        });

        it('exports source blocks with syntax highlighting classes', () => {
            const state = createExportState();
            const srcBlock: SrcBlockElement = {
                type: 'src-block',
                range: createRange(0, 50),
                postBlank: 0,
                properties: {
                    language: 'python',
                    value: 'print("Hello")',
                    headers: {},
                    lineNumber: 1,
                    endLineNumber: 3,
                },
            };
            const result = backend.exportElement(srcBlock, state);
            expect(result).toContain('class="src src-python"');
            expect(result).toContain('language-python');
            expect(result).toContain('print(&quot;Hello&quot;)');
        });

        it('exports source blocks with caption', () => {
            const state = createExportState();
            const srcBlock: SrcBlockElement = {
                type: 'src-block',
                range: createRange(0, 50),
                postBlank: 0,
                affiliated: {
                    caption: 'Example code',
                    attr: {},
                },
                properties: {
                    language: 'javascript',
                    value: 'console.log("test")',
                    headers: {},
                    lineNumber: 1,
                    endLineNumber: 3,
                },
            };
            const result = backend.exportElement(srcBlock, state);
            expect(result).toContain('org-src-caption');
            expect(result).toContain('Example code');
        });

        it('exports horizontal rules', () => {
            const state = createExportState();
            const hr = {
                type: 'horizontal-rule' as const,
                range: createRange(0, 5),
                postBlank: 0,
            };
            expect(backend.exportElement(hr, state)).toBe('<hr />\n');
        });

        it('exports quote blocks', () => {
            const state = createExportState();
            const quote = {
                type: 'quote-block' as const,
                range: createRange(0, 50),
                postBlank: 0,
                children: [
                    {
                        type: 'paragraph' as const,
                        range: createRange(0, 20),
                        postBlank: 0,
                        children: [createPlainText('A wise quote')],
                    } as ParagraphElement,
                ],
            };
            const result = backend.exportElement(quote, state);
            expect(result).toContain('<blockquote>');
            expect(result).toContain('A wise quote');
            expect(result).toContain('</blockquote>');
        });
    });

    describe('Table Export', () => {
        it('exports simple table', () => {
            const state = createExportState();
            const table: TableElement = {
                type: 'table',
                range: createRange(0, 100),
                postBlank: 0,
                properties: { tableType: 'org' },
                children: [
                    {
                        type: 'table-row',
                        range: createRange(0, 20),
                        postBlank: 0,
                        properties: { rowType: 'standard' },
                        children: [
                            { type: 'table-cell', range: createRange(0, 5), postBlank: 0, properties: { value: 'Name' } },
                            { type: 'table-cell', range: createRange(5, 10), postBlank: 0, properties: { value: 'Age' } },
                        ] as TableCellObject[],
                    } as TableRowElement,
                    {
                        type: 'table-row',
                        range: createRange(20, 25),
                        postBlank: 0,
                        properties: { rowType: 'rule' },
                        children: [],
                    } as TableRowElement,
                    {
                        type: 'table-row',
                        range: createRange(25, 50),
                        postBlank: 0,
                        properties: { rowType: 'standard' },
                        children: [
                            { type: 'table-cell', range: createRange(25, 30), postBlank: 0, properties: { value: 'Alice' } },
                            { type: 'table-cell', range: createRange(30, 35), postBlank: 0, properties: { value: '30' } },
                        ] as TableCellObject[],
                    } as TableRowElement,
                ],
            };
            const result = backend.exportElement(table, state);
            expect(result).toContain('<table class="org-table">');
            expect(result).toContain('<thead>');
            expect(result).toContain('<th>Name</th>');
            expect(result).toContain('<tbody>');
            expect(result).toContain('<td>Alice</td>');
        });
    });

    describe('List Export', () => {
        it('exports unordered list', () => {
            const state = createExportState();
            const list: PlainListElement = {
                type: 'plain-list',
                range: createRange(0, 50),
                postBlank: 0,
                properties: { listType: 'unordered' },
                children: [
                    {
                        type: 'item',
                        range: createRange(0, 20),
                        postBlank: 0,
                        properties: { bullet: '-' },
                        children: [
                            { type: 'paragraph', range: createRange(2, 10), postBlank: 0, children: [createPlainText('Item 1')] } as ParagraphElement,
                        ],
                    } as ItemElement,
                ],
            };
            const result = backend.exportElement(list, state);
            expect(result).toContain('<ul>');
            expect(result).toContain('<li>');
            expect(result).toContain('Item 1');
        });

        it('exports ordered list', () => {
            const state = createExportState();
            const list: PlainListElement = {
                type: 'plain-list',
                range: createRange(0, 50),
                postBlank: 0,
                properties: { listType: 'ordered' },
                children: [
                    {
                        type: 'item',
                        range: createRange(0, 20),
                        postBlank: 0,
                        properties: { bullet: '1.' },
                        children: [
                            { type: 'paragraph', range: createRange(3, 15), postBlank: 0, children: [createPlainText('First item')] } as ParagraphElement,
                        ],
                    } as ItemElement,
                ],
            };
            const result = backend.exportElement(list, state);
            expect(result).toContain('<ol>');
        });

        it('exports list with checkboxes', () => {
            const state = createExportState();
            const list: PlainListElement = {
                type: 'plain-list',
                range: createRange(0, 50),
                postBlank: 0,
                properties: { listType: 'unordered' },
                children: [
                    {
                        type: 'item',
                        range: createRange(0, 20),
                        postBlank: 0,
                        properties: { bullet: '-', checkbox: 'on' },
                        children: [
                            { type: 'paragraph', range: createRange(6, 16), postBlank: 0, children: [createPlainText('Done task')] } as ParagraphElement,
                        ],
                    } as ItemElement,
                ],
            };
            const result = backend.exportElement(list, state);
            expect(result).toContain('type="checkbox"');
            expect(result).toContain('checked');
        });
    });

    describe('Document Export', () => {
        it('exports complete document with wrapper', () => {
            const doc = createSimpleDocument('Hello, world!');
            const result = exportToHtml(doc, { title: 'Test' });

            expect(result).toContain('<!DOCTYPE html>');
            expect(result).toContain('<html lang="en">');
            expect(result).toContain('<title>Test</title>');
            expect(result).toContain('Hello, world!');
        });

        it('exports body only when specified', () => {
            const doc = createSimpleDocument('Content only');
            const result = exportToHtml(doc, { bodyOnly: true });

            expect(result).not.toContain('<!DOCTYPE html>');
            expect(result).toContain('Content only');
        });

        it('includes MathJax when enabled', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToHtml(doc, { mathJax: true });

            expect(result).toContain('mathjax');
        });
    });

    describe('Citation Export', () => {
        // Sample BibTeX entries for testing
        const sampleBibEntries: BibEntry[] = [
            {
                type: 'article',
                key: 'smith-2020',
                title: 'A Study of Something Important',
                author: 'Smith, John and Doe, Jane',
                year: '2020',
                journal: 'Journal of Important Studies',
                fields: {} as Record<string, string>,
                raw: '@article{smith-2020, author={Smith, John}, title={Test}, year={2020}}',
            },
            {
                type: 'book',
                key: 'jones-2021',
                title: 'The Complete Guide',
                author: 'Jones, Bob',
                year: '2021',
                fields: { publisher: 'Academic Press' } as Record<string, string>,
                raw: '@book{jones-2021, author={Jones, Bob}, title={Guide}, year={2021}}',
            },
        ];

        it('exports citation links with citation processor', () => {
            // Create a document with a citation link
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { TITLE: 'Test Document' },
                keywordLists: {},
                children: [],
                section: {
                    type: 'section',
                    range: createRange(0, 50),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: createRange(0, 50),
                            postBlank: 0,
                            children: [
                                createPlainText('See '),
                                {
                                    type: 'link',
                                    range: createRange(4, 20),
                                    postBlank: 0,
                                    properties: {
                                        linkType: 'cite',
                                        path: 'smith-2020',
                                        rawLink: 'cite:smith-2020',
                                    },
                                } as LinkObject,
                                createPlainText(' for details.'),
                            ],
                        } as ParagraphElement,
                    ],
                },
            };

            const result = exportToHtml(doc, {
                bibEntries: sampleBibEntries,
                bodyOnly: true,
            });

            // Should contain formatted citation
            expect(result).toContain('citation');
            expect(result).toContain('Smith');
        });

        it('generates bibliography when citations are present', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { TITLE: 'Test Document' },
                keywordLists: {},
                children: [],
                section: {
                    type: 'section',
                    range: createRange(0, 50),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: createRange(0, 50),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'link',
                                    range: createRange(0, 20),
                                    postBlank: 0,
                                    properties: {
                                        linkType: 'cite',
                                        path: 'smith-2020',
                                        rawLink: 'cite:smith-2020',
                                    },
                                } as LinkObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
            };

            const result = exportToHtml(doc, {
                bibEntries: sampleBibEntries,
                bibliography: true,
                bodyOnly: true,
            });

            // Should contain bibliography section
            expect(result).toContain('bibliography');
            expect(result).toContain('References');
        });

        it('handles multiple citation types (citep, citet)', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { TITLE: 'Test' },
                keywordLists: {},
                children: [],
                section: {
                    type: 'section',
                    range: createRange(0, 100),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: createRange(0, 100),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'link',
                                    range: createRange(0, 25),
                                    postBlank: 0,
                                    properties: {
                                        linkType: 'citep',
                                        path: 'smith-2020',
                                        rawLink: 'citep:smith-2020',
                                    },
                                } as LinkObject,
                                createPlainText(' and '),
                                {
                                    type: 'link',
                                    range: createRange(30, 55),
                                    postBlank: 0,
                                    properties: {
                                        linkType: 'citet',
                                        path: 'jones-2021',
                                        rawLink: 'citet:jones-2021',
                                    },
                                } as LinkObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
            };

            const result = exportToHtml(doc, {
                bibEntries: sampleBibEntries,
                bodyOnly: true,
            });

            expect(result).toContain('Smith');
            expect(result).toContain('Jones');
        });

        it('shows missing citation placeholder for unknown keys', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { TITLE: 'Test' },
                keywordLists: {},
                children: [],
                section: {
                    type: 'section',
                    range: createRange(0, 50),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: createRange(0, 50),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'link',
                                    range: createRange(0, 25),
                                    postBlank: 0,
                                    properties: {
                                        linkType: 'cite',
                                        path: 'nonexistent-key',
                                        rawLink: 'cite:nonexistent-key',
                                    },
                                } as LinkObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
            };

            const result = exportToHtml(doc, {
                bibEntries: sampleBibEntries,
                bodyOnly: true,
            });

            // Should show fallback with the key
            expect(result).toContain('nonexistent-key');
        });

        it('does not generate bibliography when disabled', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { TITLE: 'Test' },
                keywordLists: {},
                children: [],
                section: {
                    type: 'section',
                    range: createRange(0, 50),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: createRange(0, 50),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'link',
                                    range: createRange(0, 20),
                                    postBlank: 0,
                                    properties: {
                                        linkType: 'cite',
                                        path: 'smith-2020',
                                        rawLink: 'cite:smith-2020',
                                    },
                                } as LinkObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
            };

            const result = exportToHtml(doc, {
                bibEntries: sampleBibEntries,
                bibliography: false,
                bodyOnly: true,
            });

            // Should NOT contain bibliography section
            expect(result).not.toContain('<section class="bibliography">');
        });

        it('works without citation processor (fallback)', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { TITLE: 'Test' },
                keywordLists: {},
                children: [],
                section: {
                    type: 'section',
                    range: createRange(0, 50),
                    postBlank: 0,
                    children: [
                        {
                            type: 'paragraph',
                            range: createRange(0, 50),
                            postBlank: 0,
                            children: [
                                {
                                    type: 'link',
                                    range: createRange(0, 20),
                                    postBlank: 0,
                                    properties: {
                                        linkType: 'cite',
                                        path: 'some-key',
                                        rawLink: 'cite:some-key',
                                    },
                                } as LinkObject,
                            ],
                        } as ParagraphElement,
                    ],
                },
            };

            // No bibEntries provided - should use fallback
            const result = exportToHtml(doc, { bodyOnly: true });

            // Should show the key in a citation span
            expect(result).toContain('some-key');
            expect(result).toContain('citation');
        });
    });
});

// =============================================================================
// LaTeX Export Tests
// =============================================================================

describe('LaTeX Export', () => {
    const backend = new LatexExportBackend();

    describe('Object Export', () => {
        it('exports bold text', () => {
            const state = createExportState();
            const bold: BoldObject = {
                type: 'bold',
                range: createRange(0, 10),
                postBlank: 0,
                children: [createPlainText('hello')],
            };
            expect(backend.exportObject(bold, state)).toBe('\\textbf{hello}');
        });

        it('exports italic text', () => {
            const state = createExportState();
            const italic: ItalicObject = {
                type: 'italic',
                range: createRange(0, 10),
                postBlank: 0,
                children: [createPlainText('emphasized')],
            };
            expect(backend.exportObject(italic, state)).toBe('\\textit{emphasized}');
        });

        it('exports code with verb', () => {
            const state = createExportState();
            const code: CodeObject = {
                type: 'code',
                range: createRange(0, 10),
                postBlank: 0,
                properties: { value: 'foo()' },
            };
            expect(backend.exportObject(code, state)).toBe('\\verb|foo()|');
        });

        it('finds alternative delimiter for verb', () => {
            const state = createExportState();
            const code: CodeObject = {
                type: 'code',
                range: createRange(0, 10),
                postBlank: 0,
                properties: { value: 'a|b' },
            };
            const result = backend.exportObject(code, state);
            expect(result).toContain('\\verb');
            expect(result).not.toContain('\\verb|');
        });

        it('exports hyperlinks', () => {
            const state = createExportState();
            const link: LinkObject = {
                type: 'link',
                range: createRange(0, 30),
                postBlank: 0,
                properties: {
                    linkType: 'https',
                    path: 'https://example.com',
                    format: 'bracket',
                    rawLink: 'https://example.com',
                },
                children: [createPlainText('Example')],
            };
            expect(backend.exportObject(link, state))
                .toBe('\\href{https://example.com}{Example}');
        });

        it('exports URL without description', () => {
            const state = createExportState();
            const link: LinkObject = {
                type: 'link',
                range: createRange(0, 30),
                postBlank: 0,
                properties: {
                    linkType: 'https',
                    path: 'https://example.com',
                    format: 'bracket',
                    rawLink: 'https://example.com',
                },
            };
            expect(backend.exportObject(link, state)).toBe('\\url{https://example.com}');
        });

        it('exports entities as LaTeX', () => {
            const state = createExportState();
            const entity: EntityObject = {
                type: 'entity',
                range: createRange(0, 6),
                postBlank: 0,
                properties: {
                    name: 'alpha',
                    usesBrackets: false,
                    latex: '\\alpha',
                    html: '&alpha;',
                    utf8: 'α',
                },
            };
            expect(backend.exportObject(entity, state)).toBe('\\alpha');
        });

        it('exports LaTeX fragments as-is', () => {
            const state = createExportState();
            const fragment: LatexFragmentObject = {
                type: 'latex-fragment',
                range: createRange(0, 10),
                postBlank: 0,
                properties: {
                    value: '$x^2 + y^2$',
                    fragmentType: 'inline-math',
                },
            };
            expect(backend.exportObject(fragment, state)).toBe('$x^2 + y^2$');
        });

        it('exports subscripts', () => {
            const state = createExportState();
            const sub = {
                type: 'subscript' as const,
                range: createRange(0, 3),
                postBlank: 0,
                properties: { usesBraces: false },
                children: [createPlainText('2')],
            };
            expect(backend.exportObject(sub, state)).toBe('\\textsubscript{2}');
        });

        it('exports line breaks', () => {
            const state = createExportState();
            const br = {
                type: 'line-break' as const,
                range: createRange(0, 2),
                postBlank: 0,
            };
            expect(backend.exportObject(br, state)).toBe('\\\\\n');
        });

        it('escapes special characters in plain text', () => {
            const state = createExportState();
            const text: PlainTextObject = {
                type: 'plain-text',
                range: createRange(0, 20),
                postBlank: 0,
                properties: { value: '100% of $50 & more' },
            };
            const result = backend.exportObject(text, state);
            expect(result).toBe('100\\% of \\$50 \\& more');
        });
    });

    describe('Element Export', () => {
        it('exports paragraphs', () => {
            const state = createExportState();
            const para: ParagraphElement = {
                type: 'paragraph',
                range: createRange(0, 20),
                postBlank: 0,
                children: [createPlainText('Hello, world!')],
            };
            expect(backend.exportElement(para, state)).toBe('Hello, world!\n');
        });

        it('exports source blocks with listings', () => {
            const state = createExportState({ listings: true, minted: false } as any);
            const srcBlock: SrcBlockElement = {
                type: 'src-block',
                range: createRange(0, 50),
                postBlank: 0,
                properties: {
                    language: 'python',
                    value: 'print("Hello")',
                    headers: {},
                    lineNumber: 1,
                    endLineNumber: 3,
                },
            };
            const result = backend.exportElement(srcBlock, state);
            expect(result).toContain('\\begin{lstlisting}');
            expect(result).toContain('[language=Python]');
            expect(result).toContain('print("Hello")');
            expect(result).toContain('\\end{lstlisting}');
        });

        it('exports horizontal rules', () => {
            const state = createExportState();
            const hr = {
                type: 'horizontal-rule' as const,
                range: createRange(0, 5),
                postBlank: 0,
            };
            expect(backend.exportElement(hr, state)).toContain('\\rule');
        });

        it('exports quote blocks', () => {
            const state = createExportState();
            const quote = {
                type: 'quote-block' as const,
                range: createRange(0, 50),
                postBlank: 0,
                children: [
                    {
                        type: 'paragraph' as const,
                        range: createRange(0, 20),
                        postBlank: 0,
                        children: [createPlainText('A wise quote')],
                    } as ParagraphElement,
                ],
            };
            const result = backend.exportElement(quote, state);
            expect(result).toContain('\\begin{quote}');
            expect(result).toContain('A wise quote');
            expect(result).toContain('\\end{quote}');
        });

        it('exports LaTeX environments as-is', () => {
            const state = createExportState();
            const env = {
                type: 'latex-environment' as const,
                range: createRange(0, 50),
                postBlank: 0,
                properties: {
                    name: 'equation',
                    value: '\\begin{equation}\nx^2 + y^2 = z^2\n\\end{equation}',
                },
            };
            const result = backend.exportElement(env, state);
            expect(result).toContain('\\begin{equation}');
            expect(result).toContain('x^2 + y^2 = z^2');
        });
    });

    describe('Table Export', () => {
        it('exports simple table with booktabs', () => {
            const state = createExportState({ booktabs: true } as any);
            const table: TableElement = {
                type: 'table',
                range: createRange(0, 100),
                postBlank: 0,
                properties: { tableType: 'org' },
                children: [
                    {
                        type: 'table-row',
                        range: createRange(0, 20),
                        postBlank: 0,
                        properties: { rowType: 'standard' },
                        children: [
                            { type: 'table-cell', range: createRange(0, 5), postBlank: 0, properties: { value: 'A' } },
                            { type: 'table-cell', range: createRange(5, 10), postBlank: 0, properties: { value: 'B' } },
                        ] as TableCellObject[],
                    } as TableRowElement,
                    {
                        type: 'table-row',
                        range: createRange(20, 25),
                        postBlank: 0,
                        properties: { rowType: 'rule' },
                        children: [],
                    } as TableRowElement,
                    {
                        type: 'table-row',
                        range: createRange(25, 50),
                        postBlank: 0,
                        properties: { rowType: 'standard' },
                        children: [
                            { type: 'table-cell', range: createRange(25, 30), postBlank: 0, properties: { value: '1' } },
                            { type: 'table-cell', range: createRange(30, 35), postBlank: 0, properties: { value: '2' } },
                        ] as TableCellObject[],
                    } as TableRowElement,
                ],
            };
            const result = backend.exportElement(table, state);
            expect(result).toContain('\\begin{tabular}');
            expect(result).toContain('\\toprule');
            expect(result).toContain('A & B');
            expect(result).toContain('\\midrule');
            expect(result).toContain('1 & 2');
            expect(result).toContain('\\bottomrule');
        });
    });

    describe('List Export', () => {
        it('exports itemize list', () => {
            const state = createExportState();
            const list: PlainListElement = {
                type: 'plain-list',
                range: createRange(0, 50),
                postBlank: 0,
                properties: { listType: 'unordered' },
                children: [
                    {
                        type: 'item',
                        range: createRange(0, 20),
                        postBlank: 0,
                        properties: { bullet: '-' },
                        children: [
                            { type: 'paragraph', range: createRange(2, 10), postBlank: 0, children: [createPlainText('Item 1')] } as ParagraphElement,
                        ],
                    } as ItemElement,
                ],
            };
            const result = backend.exportElement(list, state);
            expect(result).toContain('\\begin{itemize}');
            expect(result).toContain('\\item');
            expect(result).toContain('Item 1');
            expect(result).toContain('\\end{itemize}');
        });

        it('exports enumerate list', () => {
            const state = createExportState();
            const list: PlainListElement = {
                type: 'plain-list',
                range: createRange(0, 50),
                postBlank: 0,
                properties: { listType: 'ordered' },
                children: [
                    {
                        type: 'item',
                        range: createRange(0, 20),
                        postBlank: 0,
                        properties: { bullet: '1.' },
                        children: [
                            { type: 'paragraph', range: createRange(3, 15), postBlank: 0, children: [createPlainText('First')] } as ParagraphElement,
                        ],
                    } as ItemElement,
                ],
            };
            const result = backend.exportElement(list, state);
            expect(result).toContain('\\begin{enumerate}');
        });

        it('exports description list', () => {
            const state = createExportState();
            const list: PlainListElement = {
                type: 'plain-list',
                range: createRange(0, 50),
                postBlank: 0,
                properties: { listType: 'descriptive' },
                children: [
                    {
                        type: 'item',
                        range: createRange(0, 30),
                        postBlank: 0,
                        properties: { bullet: '-', tag: [createPlainText('Term')] },
                        children: [
                            { type: 'paragraph', range: createRange(10, 25), postBlank: 0, children: [createPlainText('Definition')] } as ParagraphElement,
                        ],
                    } as ItemElement,
                ],
            };
            const result = backend.exportElement(list, state);
            expect(result).toContain('\\begin{description}');
            expect(result).toContain('\\item[Term]');
        });
    });

    describe('Document Export', () => {
        it('exports complete document', () => {
            const doc = createSimpleDocument('Hello, world!');
            const result = exportToLatex(doc, { title: 'Test Doc', author: 'Author' });

            expect(result).toContain('\\documentclass');
            expect(result).toContain('\\title{Test Doc}');
            expect(result).toContain('\\author{Author}');
            expect(result).toContain('\\begin{document}');
            expect(result).toContain('\\maketitle');
            expect(result).toContain('Hello, world!');
            expect(result).toContain('\\end{document}');
        });

        it('includes standard packages', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToLatex(doc);

            expect(result).toContain('\\usepackage[utf8]{inputenc}');
            expect(result).toContain('\\usepackage{graphicx}');
            expect(result).toContain('\\usepackage{amsmath}');
        });

        it('includes hyperref when enabled', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToLatex(doc, { hyperref: true });

            expect(result).toContain('\\usepackage');
            expect(result).toContain('hyperref');
        });

        it('includes booktabs when enabled', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToLatex(doc, { booktabs: true });

            expect(result).toContain('\\usepackage{booktabs}');
        });

        it('includes table of contents when enabled', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToLatex(doc, { toc: true });

            expect(result).toContain('\\tableofcontents');
        });

        it('uses LATEX_CLASS from document keywords', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { LATEX_CLASS: 'report' },
                keywordLists: {},
                children: [],
            };
            const result = exportToLatex(doc);

            expect(result).toContain('\\documentclass');
            expect(result).toContain('{report}');
        });

        it('parses LATEX_CLASS_OPTIONS from document keywords', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: {
                    LATEX_CLASS: 'article',
                    LATEX_CLASS_OPTIONS: '[12pt,twocolumn]',
                },
                keywordLists: {},
                children: [],
            };
            const result = exportToLatex(doc);

            expect(result).toContain('\\documentclass[12pt,twocolumn]{article}');
        });

        it('includes LATEX_HEADER lines in preamble', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: {},
                keywordLists: {
                    LATEX_HEADER: [
                        '\\usepackage{setspace}',
                        '\\doublespacing',
                    ],
                },
                children: [],
            };
            const result = exportToLatex(doc);

            expect(result).toContain('\\usepackage{setspace}');
            expect(result).toContain('\\doublespacing');
        });

        it('combines all LaTeX keywords correctly', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: {
                    TITLE: 'My Report',
                    AUTHOR: 'Test Author',
                    LATEX_CLASS: 'report',
                    LATEX_CLASS_OPTIONS: '[12pt]',
                },
                keywordLists: {
                    LATEX_HEADER: [
                        '\\usepackage{setspace}',
                        '\\doublespacing',
                    ],
                },
                children: [],
            };
            const result = exportToLatex(doc);

            expect(result).toContain('\\documentclass[12pt]{report}');
            expect(result).toContain('\\usepackage{setspace}');
            expect(result).toContain('\\doublespacing');
            expect(result).toContain('\\title{My Report}');
            expect(result).toContain('\\author{Test Author}');
        });

        it('parses and exports LaTeX keywords end-to-end', () => {
            const orgContent = `#+TITLE: My Document
#+AUTHOR: John Doe
#+LATEX_CLASS: article
#+LATEX_CLASS_OPTIONS: [12pt]
#+LATEX_HEADER: \\usepackage{setspace}
#+LATEX_HEADER: \\doublespacing

* Introduction

Some content here.
`;
            const doc = parseOrg(orgContent);
            const result = exportToLatex(doc);

            expect(result).toContain('\\documentclass[12pt]{article}');
            expect(result).toContain('\\usepackage{setspace}');
            expect(result).toContain('\\doublespacing');
            expect(result).toContain('\\title{My Document}');
            expect(result).toContain('\\author{John Doe}');
            expect(result).toContain('\\section{Introduction}');
        });
    });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Export Integration', () => {
    it('exports nested markup correctly to HTML', () => {
        const doc: OrgDocumentNode = {
            type: 'org-data',
            properties: {},
            keywords: {},
            keywordLists: {},
            children: [],
            section: {
                type: 'section',
                range: createRange(0, 50),
                postBlank: 0,
                children: [
                    {
                        type: 'paragraph',
                        range: createRange(0, 50),
                        postBlank: 0,
                        children: [
                            {
                                type: 'bold',
                                range: createRange(0, 20),
                                postBlank: 0,
                                children: [
                                    createPlainText('bold '),
                                    {
                                        type: 'italic',
                                        range: createRange(6, 15),
                                        postBlank: 0,
                                        children: [createPlainText('and italic')],
                                    } as ItalicObject,
                                ],
                            } as BoldObject,
                        ],
                    } as ParagraphElement,
                ],
            },
        };

        const html = exportToHtml(doc, { bodyOnly: true });
        expect(html).toContain('<strong>bold <em>and italic</em></strong>');
    });

    it('exports headline hierarchy correctly', () => {
        const doc: OrgDocumentNode = {
            type: 'org-data',
            properties: {},
            keywords: { TITLE: 'Test' },
            keywordLists: {},
            children: [
                {
                    type: 'headline',
                    range: createRange(0, 100),
                    postBlank: 0,
                    properties: {
                        level: 1,
                        rawValue: 'Chapter 1',
                        tags: [],
                        archivedp: false,
                        commentedp: false,
                        footnoteSection: false,
                        lineNumber: 1,
                    },
                    children: [
                        {
                            type: 'headline',
                            range: createRange(20, 80),
                            postBlank: 0,
                            properties: {
                                level: 2,
                                rawValue: 'Section 1.1',
                                tags: [],
                                archivedp: false,
                                commentedp: false,
                                footnoteSection: false,
                                lineNumber: 5,
                            },
                            children: [],
                        } as HeadlineElement,
                    ],
                } as HeadlineElement,
            ],
        };

        const html = exportToHtml(doc, { bodyOnly: true });
        expect(html).toContain('<h1');
        expect(html).toContain('Chapter 1');
        expect(html).toContain('<h2');
        expect(html).toContain('Section 1.1');

        const latex = exportToLatex(doc);
        expect(latex).toContain('\\section{Chapter 1}');
        expect(latex).toContain('\\subsection{Section 1.1}');
    });
});
