/**
 * Tests for org-mode position tracking
 */

import { describe, it, expect } from 'vitest';
import {
    PositionTracker,
    addPositionsToDocument,
    addPositionsToObjects,
    findNodeAtPosition,
    findNodesInRange,
    getNodePath,
    formatLocation,
    formatPosition,
    type SourceLocation,
    type SourcePosition,
} from '../orgPosition';
import { parseObjects } from '../orgObjects';
import type { OrgDocumentNode, HeadlineElement, SectionElement, ParagraphElement, OrgObject } from '../orgElementTypes';

describe('PositionTracker', () => {
    describe('basic line tracking', () => {
        it('handles single line text', () => {
            const tracker = new PositionTracker('hello world');
            expect(tracker.lineCount).toBe(1);
            expect(tracker.getLine(0)).toBe(0);
            expect(tracker.getLine(5)).toBe(0);
            expect(tracker.getColumn(0)).toBe(0);
            expect(tracker.getColumn(5)).toBe(5);
        });

        it('handles multi-line text', () => {
            const tracker = new PositionTracker('hello\nworld\n!');
            expect(tracker.lineCount).toBe(3);
            expect(tracker.getLine(0)).toBe(0);
            expect(tracker.getLine(5)).toBe(0); // at newline
            expect(tracker.getLine(6)).toBe(1); // 'w' in world
            expect(tracker.getLine(11)).toBe(1); // at second newline
            expect(tracker.getLine(12)).toBe(2); // '!'
        });

        it('calculates columns correctly', () => {
            const tracker = new PositionTracker('abc\ndefgh\ni');
            expect(tracker.getColumn(0)).toBe(0); // 'a'
            expect(tracker.getColumn(2)).toBe(2); // 'c'
            expect(tracker.getColumn(4)).toBe(0); // 'd'
            expect(tracker.getColumn(8)).toBe(4); // 'h'
            expect(tracker.getColumn(10)).toBe(0); // 'i'
        });

        it('handles empty text', () => {
            const tracker = new PositionTracker('');
            expect(tracker.lineCount).toBe(1);
            expect(tracker.getLine(0)).toBe(0);
        });

        it('handles text ending with newline', () => {
            const tracker = new PositionTracker('hello\n');
            expect(tracker.lineCount).toBe(2);
            expect(tracker.getLine(5)).toBe(0);
            expect(tracker.getLine(6)).toBe(1);
        });
    });

    describe('getLocation', () => {
        it('returns full location info', () => {
            const tracker = new PositionTracker('abc\ndefgh\ni');
            const loc = tracker.getLocation(6);
            expect(loc).toEqual({ line: 1, column: 2, offset: 6 });
        });
    });

    describe('getPosition', () => {
        it('returns position for a range', () => {
            const tracker = new PositionTracker('abc\ndefgh\ni');
            const pos = tracker.getPosition(4, 9);
            expect(pos.start).toEqual({ line: 1, column: 0, offset: 4 });
            expect(pos.end).toEqual({ line: 1, column: 5, offset: 9 });
        });

        it('handles range spanning multiple lines', () => {
            const tracker = new PositionTracker('abc\ndefgh\ni');
            const pos = tracker.getPosition(2, 10);
            expect(pos.start.line).toBe(0);
            expect(pos.end.line).toBe(2);
        });
    });

    describe('getOffset', () => {
        it('converts line/column to offset', () => {
            const tracker = new PositionTracker('abc\ndefgh\ni');
            expect(tracker.getOffset(0, 0)).toBe(0);
            expect(tracker.getOffset(0, 2)).toBe(2);
            expect(tracker.getOffset(1, 0)).toBe(4);
            expect(tracker.getOffset(1, 3)).toBe(7);
            expect(tracker.getOffset(2, 0)).toBe(10);
        });

        it('returns -1 for invalid line', () => {
            const tracker = new PositionTracker('abc\ndefgh');
            expect(tracker.getOffset(-1, 0)).toBe(-1);
            expect(tracker.getOffset(5, 0)).toBe(-1);
        });
    });

    describe('getLineStart/getLineEnd', () => {
        it('returns line boundaries', () => {
            const tracker = new PositionTracker('abc\ndefgh\ni');
            expect(tracker.getLineStart(0)).toBe(0);
            expect(tracker.getLineEnd(0)).toBe(3);
            expect(tracker.getLineStart(1)).toBe(4);
            expect(tracker.getLineEnd(1)).toBe(9);
            expect(tracker.getLineStart(2)).toBe(10);
            expect(tracker.getLineEnd(2)).toBe(11);
        });
    });

    describe('getLineText', () => {
        it('returns line content', () => {
            const tracker = new PositionTracker('abc\ndefgh\ni');
            expect(tracker.getLineText(0)).toBe('abc');
            expect(tracker.getLineText(1)).toBe('defgh');
            expect(tracker.getLineText(2)).toBe('i');
        });

        it('returns empty for invalid line', () => {
            const tracker = new PositionTracker('abc');
            expect(tracker.getLineText(-1)).toBe('');
            expect(tracker.getLineText(5)).toBe('');
        });
    });
});

describe('addPositionsToObjects', () => {
    it('adds positions to parsed objects', () => {
        const text = '*bold* and /italic/';
        const objects = parseObjects(text);

        addPositionsToObjects(objects, text);

        // Check bold
        const bold = objects[0];
        expect(bold.type).toBe('bold');
        expect(bold.position).toBeDefined();
        expect(bold.position!.start).toEqual({ line: 0, column: 0, offset: 0 });
        expect(bold.position!.end).toEqual({ line: 0, column: 6, offset: 6 });

        // Check plain text " and "
        const plainText = objects[1];
        expect(plainText.type).toBe('plain-text');
        expect(plainText.position!.start.column).toBe(6);
        expect(plainText.position!.end.column).toBe(11);

        // Check italic
        const italic = objects[2];
        expect(italic.type).toBe('italic');
        expect(italic.position!.start.column).toBe(11);
        expect(italic.position!.end.column).toBe(19);
    });

    it('handles multi-line text', () => {
        const text = 'line one\n*bold on line two*';
        const objects = parseObjects(text);

        addPositionsToObjects(objects, text);

        // Find the bold object
        const bold = objects.find(o => o.type === 'bold');
        expect(bold).toBeDefined();
        expect(bold!.position!.start.line).toBe(1);
        expect(bold!.position!.start.column).toBe(0);
    });

    it('adds positions to nested objects', () => {
        const text = '*bold with /italic/*';
        const objects = parseObjects(text);

        addPositionsToObjects(objects, text);

        const bold = objects[0];
        expect(bold.type).toBe('bold');
        expect(bold.children).toBeDefined();

        // The nested italic should also have position
        const italic = bold.children?.find(c => c.type === 'italic');
        expect(italic).toBeDefined();
        expect(italic!.position).toBeDefined();
    });
});

describe('addPositionsToDocument', () => {
    it('adds positions to document and children', () => {
        // Create a mock document
        const text = '* Headline 1\nSome content\n* Headline 2';
        const doc: OrgDocumentNode = {
            type: 'org-data',
            properties: {},
            keywords: {},
            children: [
                {
                    type: 'headline',
                    properties: {
                        level: 1,
                        rawValue: 'Headline 1',
                        tags: [],
                        archivedp: false,
                        commentedp: false,
                        footnoteSection: false,
                        lineNumber: 1,
                    },
                    range: { start: 0, end: 12 },
                    postBlank: 0,
                    children: [],
                    section: {
                        type: 'section',
                        range: { start: 13, end: 25 },
                        postBlank: 0,
                        children: [],
                    },
                } as HeadlineElement,
                {
                    type: 'headline',
                    properties: {
                        level: 1,
                        rawValue: 'Headline 2',
                        tags: [],
                        archivedp: false,
                        commentedp: false,
                        footnoteSection: false,
                        lineNumber: 3,
                    },
                    range: { start: 26, end: 38 },
                    postBlank: 0,
                    children: [],
                } as HeadlineElement,
            ],
        };

        addPositionsToDocument(doc, text);

        // Check document position
        expect(doc.position).toBeDefined();
        expect(doc.position!.start).toEqual({ line: 0, column: 0, offset: 0 });
        expect(doc.position!.end.offset).toBe(text.length);

        // Check headline positions
        expect(doc.children[0].position).toBeDefined();
        expect(doc.children[0].position!.start.line).toBe(0);

        expect(doc.children[1].position).toBeDefined();
        expect(doc.children[1].position!.start.line).toBe(2);

        // Check section position
        expect(doc.children[0].section?.position).toBeDefined();
        expect(doc.children[0].section?.position!.start.line).toBe(1);
    });
});

describe('findNodeAtPosition', () => {
    it('finds node at specific line/column', () => {
        const text = '*bold* and /italic/';
        const objects = parseObjects(text);
        addPositionsToObjects(objects, text);

        // Find at column 2 (inside bold content - finds the nested plain-text)
        const node = findNodeAtPosition(objects, 0, 2);
        expect(node).toBeDefined();
        // The most specific match is the plain-text inside bold
        expect(node!.type).toBe('plain-text');

        // Find at column 14 (inside italic content)
        const node2 = findNodeAtPosition(objects, 0, 14);
        expect(node2).toBeDefined();
        // The most specific match is the plain-text inside italic
        expect(node2!.type).toBe('plain-text');

        // Find at column 8 (inside plain text " and ")
        const node3 = findNodeAtPosition(objects, 0, 8);
        expect(node3).toBeDefined();
        expect(node3!.type).toBe('plain-text');
    });

    it('returns null for position outside nodes', () => {
        const text = '*bold*';
        const objects = parseObjects(text);
        addPositionsToObjects(objects, text);

        const node = findNodeAtPosition(objects, 5, 0);
        expect(node).toBeNull();
    });

    it('finds nested nodes with path', () => {
        const text = '*bold /italic/*';
        const objects = parseObjects(text);
        addPositionsToObjects(objects, text);

        // Position inside the nested italic - use getNodePath to see full path
        const path = getNodePath(objects, 0, 8);
        expect(path.length).toBeGreaterThanOrEqual(2);
        // Path should contain bold -> italic -> plain-text
        const types = path.map(n => n.type);
        expect(types).toContain('bold');
        expect(types).toContain('italic');
    });
});

describe('findNodesInRange', () => {
    it('finds all nodes in line range', () => {
        const text = 'line one *bold*\nline two /italic/\nline three';
        const objects = parseObjects(text);
        addPositionsToObjects(objects, text);

        // Find nodes in lines 0-1
        const nodes = findNodesInRange(objects, 0, 1);
        expect(nodes.length).toBeGreaterThan(0);

        // Should include bold and italic
        const types = nodes.map(n => n.type);
        expect(types).toContain('bold');
        expect(types).toContain('italic');
    });

    it('returns empty for range with no nodes', () => {
        const text = '*bold*';
        const objects = parseObjects(text);
        addPositionsToObjects(objects, text);

        const nodes = findNodesInRange(objects, 5, 10);
        expect(nodes).toHaveLength(0);
    });
});

describe('getNodePath', () => {
    it('returns path from root to node', () => {
        const text = '*bold /italic/*';
        const objects = parseObjects(text);
        addPositionsToObjects(objects, text);

        const path = getNodePath(objects, 0, 8);
        expect(path.length).toBeGreaterThanOrEqual(1);

        // Path should include bold (outer) and italic (inner)
        const types = path.map(n => n.type);
        expect(types).toContain('bold');
        expect(types).toContain('italic');
    });
});

describe('formatLocation', () => {
    it('formats location as line:column (1-indexed)', () => {
        const loc: SourceLocation = { line: 0, column: 5, offset: 5 };
        expect(formatLocation(loc)).toBe('1:6');
    });

    it('handles multi-digit line/column', () => {
        const loc: SourceLocation = { line: 99, column: 42, offset: 1000 };
        expect(formatLocation(loc)).toBe('100:43');
    });
});

describe('formatPosition', () => {
    it('formats position as start-end', () => {
        const pos: SourcePosition = {
            start: { line: 0, column: 0, offset: 0 },
            end: { line: 0, column: 10, offset: 10 },
        };
        expect(formatPosition(pos)).toBe('1:1-1:11');
    });

    it('handles multi-line positions', () => {
        const pos: SourcePosition = {
            start: { line: 0, column: 5, offset: 5 },
            end: { line: 2, column: 3, offset: 20 },
        };
        expect(formatPosition(pos)).toBe('1:6-3:4');
    });
});

describe('edge cases', () => {
    it('handles empty text', () => {
        const tracker = new PositionTracker('');
        expect(tracker.getLocation(0)).toEqual({ line: 0, column: 0, offset: 0 });
    });

    it('handles text with only newlines', () => {
        const tracker = new PositionTracker('\n\n\n');
        expect(tracker.lineCount).toBe(4);
        expect(tracker.getLine(0)).toBe(0);
        expect(tracker.getLine(1)).toBe(1);
        expect(tracker.getLine(2)).toBe(2);
        expect(tracker.getLine(3)).toBe(3);
    });

    it('handles tabs in text', () => {
        const tracker = new PositionTracker('a\tb\tc');
        expect(tracker.getColumn(0)).toBe(0); // 'a'
        expect(tracker.getColumn(1)).toBe(1); // tab
        expect(tracker.getColumn(2)).toBe(2); // 'b'
        // Note: tabs are counted as single characters
    });

    it('handles unicode characters', () => {
        const tracker = new PositionTracker('αβγ\nδεζ');
        expect(tracker.lineCount).toBe(2);
        expect(tracker.getLine(3)).toBe(0); // at γ
        expect(tracker.getLine(4)).toBe(1); // at δ
    });

    it('handles very long lines', () => {
        const longLine = 'x'.repeat(10000);
        const tracker = new PositionTracker(longLine);
        expect(tracker.getColumn(9999)).toBe(9999);
        expect(tracker.getLine(9999)).toBe(0);
    });

    it('handles many short lines', () => {
        const manyLines = Array(1000).fill('a').join('\n');
        const tracker = new PositionTracker(manyLines);
        expect(tracker.lineCount).toBe(1000);
        expect(tracker.getLine(1998)).toBe(999); // last character
    });
});
