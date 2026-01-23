/**
 * Position tracking for org-mode parser
 * Maps character offsets to line/column positions for editor integration
 */

import type {
    OrgNode,
    OrgElement,
    OrgObject,
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    ParagraphElement,
    TableElement,
    PlainListElement,
    DrawerElement,
    PropertyDrawerElement,
    FootnoteDefinitionElement,
} from './orgElementTypes';

// =============================================================================
// Position Types
// =============================================================================

/**
 * Source location with line and column
 */
export interface SourceLocation {
    /** Line number (0-indexed) */
    line: number;
    /** Column number (0-indexed) */
    column: number;
    /** Character offset (0-indexed) */
    offset: number;
}

/**
 * Position span from start to end
 */
export interface SourcePosition {
    /** Start position */
    start: SourceLocation;
    /** End position */
    end: SourceLocation;
}

// =============================================================================
// Position Tracker
// =============================================================================

/**
 * Tracks line/column positions from character offsets
 */
export class PositionTracker {
    /** Line start offsets (index i = character offset where line i starts) */
    private lineStarts: number[] = [0];
    /** Source text */
    private text: string;

    constructor(text: string) {
        this.text = text;
        this.buildLineIndex();
    }

    /**
     * Build index of line start positions
     */
    private buildLineIndex(): void {
        for (let i = 0; i < this.text.length; i++) {
            if (this.text[i] === '\n') {
                this.lineStarts.push(i + 1);
            }
        }
    }

    /**
     * Get line number for a character offset (0-indexed)
     */
    getLine(offset: number): number {
        // Binary search for the line
        let low = 0;
        let high = this.lineStarts.length - 1;

        while (low < high) {
            const mid = Math.floor((low + high + 1) / 2);
            if (this.lineStarts[mid] <= offset) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return low;
    }

    /**
     * Get column number for a character offset (0-indexed)
     */
    getColumn(offset: number): number {
        const line = this.getLine(offset);
        return offset - this.lineStarts[line];
    }

    /**
     * Get full source location for a character offset
     */
    getLocation(offset: number): SourceLocation {
        const line = this.getLine(offset);
        const column = offset - this.lineStarts[line];
        return { line, column, offset };
    }

    /**
     * Get source position for a range
     */
    getPosition(startOffset: number, endOffset: number): SourcePosition {
        return {
            start: this.getLocation(startOffset),
            end: this.getLocation(endOffset),
        };
    }

    /**
     * Get character offset for a line/column position
     */
    getOffset(line: number, column: number): number {
        if (line < 0 || line >= this.lineStarts.length) {
            return -1;
        }
        return this.lineStarts[line] + column;
    }

    /**
     * Get the line start offset for a given line number
     */
    getLineStart(line: number): number {
        if (line < 0 || line >= this.lineStarts.length) {
            return -1;
        }
        return this.lineStarts[line];
    }

    /**
     * Get the line end offset for a given line number (points to newline or end of text)
     */
    getLineEnd(line: number): number {
        if (line < 0 || line >= this.lineStarts.length) {
            return -1;
        }
        if (line === this.lineStarts.length - 1) {
            return this.text.length;
        }
        return this.lineStarts[line + 1] - 1;
    }

    /**
     * Get total number of lines
     */
    get lineCount(): number {
        return this.lineStarts.length;
    }

    /**
     * Get text content of a specific line
     */
    getLineText(line: number): string {
        const start = this.getLineStart(line);
        const end = this.getLineEnd(line);
        if (start === -1 || end === -1) return '';
        return this.text.slice(start, end);
    }
}

// =============================================================================
// Position Attachment
// =============================================================================

/**
 * Extended node with position information
 */
export interface PositionedNode {
    /** Source position (line/column) */
    position?: SourcePosition;
}

/**
 * Add position information to a single node
 */
function addPositionToNode(node: OrgNode & PositionedNode, tracker: PositionTracker): void {
    if (node.range) {
        node.position = tracker.getPosition(node.range.start, node.range.end);
    }
}

/**
 * Recursively add position information to all nodes in an element tree
 */
function addPositionsToElement(element: OrgElement & PositionedNode, tracker: PositionTracker): void {
    addPositionToNode(element, tracker);

    // Handle children based on element type
    if ('children' in element && Array.isArray(element.children)) {
        for (const child of element.children) {
            if (isElement(child)) {
                addPositionsToElement(child as OrgElement & PositionedNode, tracker);
            } else if (isObject(child)) {
                addPositionsToObject(child as OrgObject & PositionedNode, tracker);
            }
        }
    }

    // Handle section in headlines
    if (element.type === 'headline') {
        const headline = element as HeadlineElement & PositionedNode;
        if (headline.section) {
            addPositionsToElement(headline.section as SectionElement & PositionedNode, tracker);
        }
        if (headline.planning) {
            addPositionsToElement(headline.planning as OrgElement & PositionedNode, tracker);
        }
    }
}

/**
 * Recursively add position information to all objects
 */
function addPositionsToObject(obj: OrgObject & PositionedNode, tracker: PositionTracker): void {
    addPositionToNode(obj, tracker);

    if ('children' in obj && Array.isArray(obj.children)) {
        for (const child of obj.children) {
            addPositionsToObject(child as OrgObject & PositionedNode, tracker);
        }
    }
}

/**
 * Type guard for elements
 */
function isElement(node: unknown): node is OrgElement {
    if (!node || typeof node !== 'object') return false;
    const n = node as OrgElement;
    return 'type' in n && 'range' in n && typeof n.type === 'string';
}

/**
 * Type guard for objects
 */
function isObject(node: unknown): node is OrgObject {
    return isElement(node as OrgElement);
}

/**
 * Add position information to an entire document
 */
export function addPositionsToDocument(
    doc: OrgDocumentNode & { position?: SourcePosition },
    text: string
): void {
    const tracker = new PositionTracker(text);

    // Add position to document root
    doc.position = tracker.getPosition(0, text.length);

    // Add to top-level section
    if (doc.section) {
        addPositionsToElement(doc.section as SectionElement & PositionedNode, tracker);
    }

    // Add to all headlines
    for (const headline of doc.children) {
        addPositionsToElement(headline as HeadlineElement & PositionedNode, tracker);
    }
}

/**
 * Add positions to an array of objects (e.g., parsed inline content)
 */
export function addPositionsToObjects(
    objects: OrgObject[],
    text: string,
    baseOffset = 0
): void {
    const tracker = new PositionTracker(text);

    for (const obj of objects) {
        // Adjust range if baseOffset is provided
        const positioned = obj as OrgObject & PositionedNode;
        if (positioned.range) {
            positioned.position = tracker.getPosition(
                positioned.range.start - baseOffset,
                positioned.range.end - baseOffset
            );
        }
        if ('children' in positioned && Array.isArray(positioned.children)) {
            for (const child of positioned.children) {
                addPositionsToObject(child as OrgObject & PositionedNode, tracker);
            }
        }
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Find the node at a given position
 */
export function findNodeAtPosition<T extends OrgNode & PositionedNode>(
    nodes: T[],
    line: number,
    column: number
): T | null {
    for (const node of nodes) {
        if (!node.position) continue;

        const { start, end } = node.position;

        // Check if position is within this node
        if (
            (line > start.line || (line === start.line && column >= start.column)) &&
            (line < end.line || (line === end.line && column < end.column))
        ) {
            // Check children for more specific match
            if ('children' in node && Array.isArray(node.children)) {
                const childMatch = findNodeAtPosition(
                    node.children as (OrgNode & PositionedNode)[],
                    line,
                    column
                );
                if (childMatch) return childMatch as T;
            }
            return node;
        }
    }
    return null;
}

/**
 * Find all nodes in a line range
 */
export function findNodesInRange<T extends OrgNode & PositionedNode>(
    nodes: T[],
    startLine: number,
    endLine: number
): T[] {
    const results: T[] = [];

    for (const node of nodes) {
        if (!node.position) continue;

        const { start, end } = node.position;

        // Check if node overlaps with range
        if (start.line <= endLine && end.line >= startLine) {
            results.push(node);

            // Also check children
            if ('children' in node && Array.isArray(node.children)) {
                results.push(
                    ...findNodesInRange(
                        node.children as (OrgNode & PositionedNode)[] as T[],
                        startLine,
                        endLine
                    )
                );
            }
        }
    }

    return results;
}

/**
 * Get the path from root to a node at position
 */
export function getNodePath<T extends OrgNode & PositionedNode>(
    nodes: T[],
    line: number,
    column: number,
    path: T[] = []
): T[] {
    for (const node of nodes) {
        if (!node.position) continue;

        const { start, end } = node.position;

        if (
            (line > start.line || (line === start.line && column >= start.column)) &&
            (line < end.line || (line === end.line && column < end.column))
        ) {
            path.push(node);

            if ('children' in node && Array.isArray(node.children)) {
                return getNodePath(
                    node.children as (OrgNode & PositionedNode)[] as T[],
                    line,
                    column,
                    path
                );
            }
        }
    }

    return path;
}

/**
 * Format a source location as "line:column"
 */
export function formatLocation(loc: SourceLocation): string {
    return `${loc.line + 1}:${loc.column + 1}`;
}

/**
 * Format a source position as "start-end"
 */
export function formatPosition(pos: SourcePosition): string {
    return `${formatLocation(pos.start)}-${formatLocation(pos.end)}`;
}

