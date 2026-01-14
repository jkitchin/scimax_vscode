/**
 * Tests for org-mode element parsers and interpreter
 */

import { describe, it, expect } from 'vitest';
import {
    parseTable,
    getTableAlignments,
    isTableLine,
    parsePlanningLine,
    isPlanningLine,
    parseClockLine,
    isClockLine,
    parseDrawer,
    parsePropertiesDrawer,
    isDrawerStart,
    isDrawerEnd,
    parseList,
    isListItemLine,
    parseKeyword,
    parseHorizontalRule,
    parseFixedWidth,
    isFixedWidthLine,
    parseComment,
    isCommentLine,
} from '../orgElements';
import {
    interpret,
    interpretElement,
    interpretObject,
} from '../orgInterpreter';
import type {
    OrgDocumentNode,
    HeadlineElement,
    ParagraphElement,
    SrcBlockElement,
    TableElement,
    PlainListElement,
    BoldObject,
    LinkObject,
    TimestampObject,
    PlainTextObject,
} from '../orgElementTypes';

// =============================================================================
// Helper Functions
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

// =============================================================================
// Table Parser Tests
// =============================================================================

describe('Table Parser', () => {
    describe('parseTable', () => {
        it('parses simple table', () => {
            const lines = [
                '| Name  | Age |',
                '|-------|-----|',
                '| Alice | 30  |',
            ];
            const table = parseTable(lines, 0);

            expect(table.type).toBe('table');
            expect(table.properties.tableType).toBe('org');
            expect(table.children.length).toBe(3);
        });

        it('identifies header and data rows', () => {
            const lines = [
                '| A | B |',
                '|---|---|',
                '| 1 | 2 |',
            ];
            const table = parseTable(lines, 0);

            expect(table.children[0].properties.rowType).toBe('standard');
            expect(table.children[1].properties.rowType).toBe('rule');
            expect(table.children[2].properties.rowType).toBe('standard');
        });

        it('parses cell contents', () => {
            const lines = ['| hello | world |'];
            const table = parseTable(lines, 0, { parseCellContents: true });

            const row = table.children[0];
            expect(row.children.length).toBe(2);
            expect(row.children[0].properties.value).toBe('hello');
            expect(row.children[1].properties.value).toBe('world');
        });

        it('handles empty cells', () => {
            const lines = ['| a |   | c |'];
            const table = parseTable(lines, 0);

            const row = table.children[0];
            expect(row.children.length).toBe(3);
            expect(row.children[1].properties.value).toBe('');
        });
    });

    describe('getTableAlignments', () => {
        it('extracts alignment cookies', () => {
            const lines = [
                '| <l> | <c> | <r> |',
                '|-----|-----|-----|',
                '| a   | b   | c   |',
            ];
            const table = parseTable(lines, 0);
            const alignments = getTableAlignments(table);

            expect(alignments[0]).toBe('l');
            expect(alignments[1]).toBe('c');
            expect(alignments[2]).toBe('r');
        });
    });

    describe('isTableLine', () => {
        it('recognizes table lines', () => {
            expect(isTableLine('| a | b |')).toBe(true);
            expect(isTableLine('|---|---|')).toBe(true);
            expect(isTableLine('  | indented |')).toBe(true);
        });

        it('rejects non-table lines', () => {
            expect(isTableLine('not a table')).toBe(false);
            expect(isTableLine('* heading')).toBe(false);
        });
    });
});

// =============================================================================
// Planning Line Tests
// =============================================================================

describe('Planning Line Parser', () => {
    describe('parsePlanningLine', () => {
        it('parses SCHEDULED timestamp', () => {
            const line = 'SCHEDULED: <2024-03-15 Fri>';
            const planning = parsePlanningLine(line, 0, 0);

            expect(planning).not.toBeNull();
            expect(planning!.properties.scheduled).toBeDefined();
            expect(planning!.properties.scheduled!.properties.yearStart).toBe(2024);
            expect(planning!.properties.scheduled!.properties.monthStart).toBe(3);
            expect(planning!.properties.scheduled!.properties.dayStart).toBe(15);
        });

        it('parses DEADLINE timestamp', () => {
            const line = 'DEADLINE: <2024-03-20 Wed>';
            const planning = parsePlanningLine(line, 0, 0);

            expect(planning).not.toBeNull();
            expect(planning!.properties.deadline).toBeDefined();
        });

        it('parses CLOSED timestamp', () => {
            const line = 'CLOSED: [2024-03-10 Sun 14:30]';
            const planning = parsePlanningLine(line, 0, 0);

            expect(planning).not.toBeNull();
            expect(planning!.properties.closed).toBeDefined();
            expect(planning!.properties.closed!.properties.hourStart).toBe(14);
            expect(planning!.properties.closed!.properties.minuteStart).toBe(30);
        });

        it('parses multiple planning keywords', () => {
            const line = 'SCHEDULED: <2024-03-15 Fri> DEADLINE: <2024-03-20 Wed>';
            const planning = parsePlanningLine(line, 0, 0);

            expect(planning).not.toBeNull();
            expect(planning!.properties.scheduled).toBeDefined();
            expect(planning!.properties.deadline).toBeDefined();
        });

        it('parses timestamp with repeater', () => {
            const line = 'SCHEDULED: <2024-03-15 Fri +1w>';
            const planning = parsePlanningLine(line, 0, 0);

            expect(planning).not.toBeNull();
            const ts = planning!.properties.scheduled!;
            expect(ts.properties.repeaterType).toBe('+');
            expect(ts.properties.repeaterValue).toBe(1);
            expect(ts.properties.repeaterUnit).toBe('w');
        });
    });

    describe('isPlanningLine', () => {
        it('recognizes planning lines', () => {
            expect(isPlanningLine('SCHEDULED: <2024-03-15 Fri>')).toBe(true);
            expect(isPlanningLine('DEADLINE: <2024-03-15 Fri>')).toBe(true);
            expect(isPlanningLine('CLOSED: [2024-03-15 Fri]')).toBe(true);
        });

        it('rejects non-planning lines', () => {
            expect(isPlanningLine('* heading')).toBe(false);
            expect(isPlanningLine('regular text')).toBe(false);
        });
    });
});

// =============================================================================
// Clock Line Tests
// =============================================================================

describe('Clock Line Parser', () => {
    describe('parseClockLine', () => {
        it('parses running clock', () => {
            const line = 'CLOCK: [2024-03-15 Fri 09:00]';
            const clock = parseClockLine(line, 0, 0);

            expect(clock).not.toBeNull();
            expect(clock!.properties.status).toBe('running');
            expect(clock!.properties.start.properties.hourStart).toBe(9);
        });

        it('parses closed clock with duration', () => {
            const line = 'CLOCK: [2024-03-15 Fri 09:00]--[2024-03-15 Fri 10:30] =>  1:30';
            const clock = parseClockLine(line, 0, 0);

            expect(clock).not.toBeNull();
            expect(clock!.properties.status).toBe('closed');
            expect(clock!.properties.end).toBeDefined();
            expect(clock!.properties.duration).toBe('1:30');
        });
    });

    describe('isClockLine', () => {
        it('recognizes clock lines', () => {
            expect(isClockLine('CLOCK: [2024-03-15 Fri 09:00]')).toBe(true);
            expect(isClockLine('  CLOCK: [2024-03-15 Fri 09:00]')).toBe(true);
        });

        it('rejects non-clock lines', () => {
            expect(isClockLine('not a clock')).toBe(false);
        });
    });
});

// =============================================================================
// Drawer Tests
// =============================================================================

describe('Drawer Parser', () => {
    describe('parsePropertiesDrawer', () => {
        it('parses properties drawer', () => {
            const lines = [
                ':PROPERTIES:',
                ':ID: abc123',
                ':CUSTOM_ID: my-section',
                ':END:',
            ];
            const drawer = parsePropertiesDrawer(lines, 0, 0);

            expect(drawer).not.toBeNull();
            expect(drawer!.children.length).toBe(2);
            expect(drawer!.children[0].properties.key).toBe('ID');
            expect(drawer!.children[0].properties.value).toBe('abc123');
        });
    });

    describe('isDrawerStart/isDrawerEnd', () => {
        it('recognizes drawer boundaries', () => {
            expect(isDrawerStart(':PROPERTIES:')).toBe(true);
            expect(isDrawerStart(':LOGBOOK:')).toBe(true);
            expect(isDrawerEnd(':END:')).toBe(true);
        });

        it('rejects non-drawer lines', () => {
            expect(isDrawerStart('not a drawer')).toBe(false);
            expect(isDrawerEnd('not an end')).toBe(false);
        });
    });
});

// =============================================================================
// List Parser Tests
// =============================================================================

describe('List Parser', () => {
    describe('parseList', () => {
        it('parses unordered list', () => {
            const lines = [
                '- item 1',
                '- item 2',
            ];
            const list = parseList(lines, 0, 0);

            expect(list).not.toBeNull();
            expect(list!.properties.listType).toBe('unordered');
            expect(list!.children.length).toBe(2);
        });

        it('parses ordered list', () => {
            const lines = [
                '1. first',
                '2. second',
            ];
            const list = parseList(lines, 0, 0);

            expect(list).not.toBeNull();
            expect(list!.properties.listType).toBe('ordered');
        });

        it('parses list with checkboxes', () => {
            const lines = [
                '- [X] done task',
                '- [ ] todo task',
                '- [-] partial task',
            ];
            const list = parseList(lines, 0, 0);

            expect(list).not.toBeNull();
            expect(list!.children[0].properties.checkbox).toBe('on');
            expect(list!.children[1].properties.checkbox).toBe('off');
            expect(list!.children[2].properties.checkbox).toBe('trans');
        });
    });

    describe('isListItemLine', () => {
        it('recognizes list item lines', () => {
            expect(isListItemLine('- item')).toBe(true);
            expect(isListItemLine('+ item')).toBe(true);
            expect(isListItemLine('* item')).toBe(true);
            expect(isListItemLine('1. item')).toBe(true);
            expect(isListItemLine('1) item')).toBe(true);
        });

        it('rejects non-list lines', () => {
            expect(isListItemLine('not a list')).toBe(false);
            expect(isListItemLine('** heading')).toBe(false);
        });
    });
});

// =============================================================================
// Other Element Tests
// =============================================================================

describe('Other Element Parsers', () => {
    describe('parseKeyword', () => {
        it('parses keyword line', () => {
            const kw = parseKeyword('#+TITLE: My Document', 0, 0);

            expect(kw).not.toBeNull();
            expect(kw!.properties.key).toBe('TITLE');
            expect(kw!.properties.value).toBe('My Document');
        });
    });

    describe('parseHorizontalRule', () => {
        it('parses horizontal rule', () => {
            const hr = parseHorizontalRule('-----', 0, 0);
            expect(hr).not.toBeNull();
            expect(hr!.type).toBe('horizontal-rule');
        });

        it('requires at least 5 dashes', () => {
            expect(parseHorizontalRule('----', 0, 0)).toBeNull();
            expect(parseHorizontalRule('------', 0, 0)).not.toBeNull();
        });
    });

    describe('parseComment', () => {
        it('parses comment line', () => {
            const comment = parseComment('# This is a comment', 0, 0);

            expect(comment).not.toBeNull();
            expect(comment!.properties.value).toBe('This is a comment');
        });

        it('handles empty comment', () => {
            const comment = parseComment('#', 0, 0);
            expect(comment).not.toBeNull();
        });
    });

    describe('isFixedWidthLine', () => {
        it('recognizes fixed-width lines', () => {
            expect(isFixedWidthLine(': fixed width')).toBe(true);
            expect(isFixedWidthLine(':')).toBe(true);
        });

        it('rejects non-fixed-width lines', () => {
            expect(isFixedWidthLine('not fixed')).toBe(false);
        });
    });
});

// =============================================================================
// Interpreter Tests
// =============================================================================

describe('Interpreter', () => {
    describe('interpretObject', () => {
        it('interprets bold', () => {
            const bold: BoldObject = {
                type: 'bold',
                range: createRange(0, 10),
                postBlank: 0,
                children: [createPlainText('hello')],
            };
            expect(interpretObject(bold)).toBe('*hello*');
        });

        it('interprets link with description', () => {
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
            expect(interpretObject(link)).toBe('[[https://example.com][Example]]');
        });

        it('interprets link without description', () => {
            const link: LinkObject = {
                type: 'link',
                range: createRange(0, 20),
                postBlank: 0,
                properties: {
                    linkType: 'https',
                    path: 'https://example.com',
                    format: 'bracket',
                    rawLink: 'https://example.com',
                },
            };
            expect(interpretObject(link)).toBe('[[https://example.com]]');
        });

        it('interprets timestamp', () => {
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
            const result = interpretObject(ts);
            expect(result).toContain('2024-03-15');
            expect(result).toContain('Fri');
        });

        it('interprets code', () => {
            const code = {
                type: 'code' as const,
                range: createRange(0, 10),
                postBlank: 0,
                properties: { value: 'foo()' },
            };
            expect(interpretObject(code)).toBe('=foo()=');
        });

        it('interprets subscript', () => {
            const sub = {
                type: 'subscript' as const,
                range: createRange(0, 3),
                postBlank: 0,
                properties: { usesBraces: false },
                children: [createPlainText('2')],
            };
            expect(interpretObject(sub)).toBe('_2');
        });

        it('interprets subscript with braces', () => {
            const sub = {
                type: 'subscript' as const,
                range: createRange(0, 5),
                postBlank: 0,
                properties: { usesBraces: true },
                children: [createPlainText('abc')],
            };
            expect(interpretObject(sub)).toBe('_{abc}');
        });
    });

    describe('interpretElement', () => {
        it('interprets paragraph', () => {
            const para: ParagraphElement = {
                type: 'paragraph',
                range: createRange(0, 20),
                postBlank: 0,
                children: [createPlainText('Hello, world!')],
            };
            expect(interpretElement(para)).toBe('Hello, world!');
        });

        it('interprets source block', () => {
            const block: SrcBlockElement = {
                type: 'src-block',
                range: createRange(0, 50),
                postBlank: 0,
                properties: {
                    language: 'python',
                    value: 'print("hello")',
                    headers: {},
                    lineNumber: 1,
                    endLineNumber: 3,
                },
            };
            const result = interpretElement(block);
            expect(result).toContain('#+BEGIN_SRC python');
            expect(result).toContain('print("hello")');
            expect(result).toContain('#+END_SRC');
        });

        it('interprets horizontal rule', () => {
            const hr = {
                type: 'horizontal-rule' as const,
                range: createRange(0, 5),
                postBlank: 0,
            };
            expect(interpretElement(hr)).toBe('-----');
        });
    });

    describe('interpret (full document)', () => {
        it('interprets simple document', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: { TITLE: 'Test Document' },
                keywordLists: {},
                children: [
                    {
                        type: 'headline',
                        range: createRange(0, 50),
                        postBlank: 0,
                        properties: {
                            level: 1,
                            rawValue: 'Introduction',
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
            const result = interpret(doc);
            expect(result).toContain('#+TITLE: Test Document');
            expect(result).toContain('* Introduction');
        });

        it('interprets headline with TODO and tags', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: {},
                keywordLists: {},
                children: [
                    {
                        type: 'headline',
                        range: createRange(0, 50),
                        postBlank: 0,
                        properties: {
                            level: 2,
                            rawValue: 'Task',
                            todoKeyword: 'TODO',
                            tags: ['urgent', 'work'],
                            archivedp: false,
                            commentedp: false,
                            footnoteSection: false,
                            lineNumber: 1,
                        },
                        children: [],
                    } as HeadlineElement,
                ],
            };
            const result = interpret(doc);
            expect(result).toContain('** TODO Task');
            expect(result).toContain(':urgent:work:');
        });

        it('interprets headline with priority', () => {
            const doc: OrgDocumentNode = {
                type: 'org-data',
                properties: {},
                keywords: {},
                keywordLists: {},
                children: [
                    {
                        type: 'headline',
                        range: createRange(0, 50),
                        postBlank: 0,
                        properties: {
                            level: 1,
                            rawValue: 'Important',
                            priority: 'A',
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
            const result = interpret(doc);
            expect(result).toContain('* [#A] Important');
        });
    });
});

// =============================================================================
// Round-trip Tests
// =============================================================================

describe('Round-trip', () => {
    it('preserves emphasis markers', () => {
        const bold: BoldObject = {
            type: 'bold',
            range: createRange(0, 10),
            postBlank: 0,
            children: [createPlainText('text')],
        };
        expect(interpretObject(bold)).toBe('*text*');
    });

    it('preserves nested emphasis', () => {
        const boldItalic: BoldObject = {
            type: 'bold',
            range: createRange(0, 15),
            postBlank: 0,
            children: [
                {
                    type: 'italic',
                    range: createRange(1, 10),
                    postBlank: 0,
                    children: [createPlainText('nested')],
                },
            ],
        };
        expect(interpretObject(boldItalic)).toBe('*/nested/*');
    });

    it('preserves footnote reference', () => {
        const fn = {
            type: 'footnote-reference' as const,
            range: createRange(0, 10),
            postBlank: 0,
            properties: {
                label: '1',
                referenceType: 'standard' as const,
            },
        };
        expect(interpretObject(fn)).toBe('[fn:1]');
    });

    it('preserves inline footnote', () => {
        const fn = {
            type: 'footnote-reference' as const,
            range: createRange(0, 20),
            postBlank: 0,
            properties: {
                label: 'note',
                referenceType: 'inline' as const,
            },
            children: [createPlainText('definition')],
        };
        expect(interpretObject(fn)).toBe('[fn:note:definition]');
    });

    it('preserves macro call', () => {
        const macro = {
            type: 'macro' as const,
            range: createRange(0, 15),
            postBlank: 0,
            properties: {
                key: 'date',
                args: ['%Y-%m-%d'],
            },
        };
        expect(interpretObject(macro)).toBe('{{{date(%Y-%m-%d)}}}');
    });

    it('preserves export snippet', () => {
        const snippet = {
            type: 'export-snippet' as const,
            range: createRange(0, 20),
            postBlank: 0,
            properties: {
                backend: 'html',
                value: '<br />',
            },
        };
        expect(interpretObject(snippet)).toBe('@@html:<br />@@');
    });
});
