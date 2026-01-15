/**
 * Org-mode File Modification API
 *
 * Provides utilities for programmatically reading, modifying, and writing org files.
 * Designed for use in TypeScript source blocks within org documents.
 *
 * @example
 * ```typescript
 * import { org } from 'scimax';
 *
 * const doc = org.parseFile('./notes.org');
 * org.mapHeadlines(doc, h => {
 *   if (h.todoKeyword) h.todoKeyword = 'TODO';
 * });
 * org.writeFile('./notes.org', doc);
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseOrg, OrgParserConfig } from './orgParserUnified';
import { serialize, SerializeOptions, serializeHeadline, serializeElement, serializeObjects } from './orgSerialize';
import type {
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    OrgElement,
    OrgObject,
    ElementType,
    ObjectType,
    TableElement,
    TableRowElement,
    TableCellObject,
    SrcBlockElement,
    PlainListElement,
    ItemElement,
    TimestampObject,
    LinkObject,
    PlanningElement,
} from './orgElementTypes';

// =============================================================================
// Re-export types for convenience
// =============================================================================

export type {
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    OrgElement,
    OrgObject,
    ElementType,
    ObjectType,
    TableElement,
    SrcBlockElement,
    PlainListElement,
    TimestampObject,
    LinkObject,
    PlanningElement,
};

export { parseOrg, serialize };

// =============================================================================
// File I/O
// =============================================================================

/**
 * Parse an org file from disk
 *
 * @param filePath - Path to the org file (absolute or relative to cwd)
 * @param config - Optional parser configuration
 * @returns Parsed document AST
 *
 * @example
 * ```typescript
 * const doc = org.parseFile('./notes.org');
 * console.log(doc.children.length, 'top-level headlines');
 * ```
 */
export function parseFile(filePath: string, config?: OrgParserConfig): OrgDocumentNode {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return parseOrg(content, { ...config, filePath: absolutePath });
}

/**
 * Parse org content from a string
 *
 * @param content - Org-mode text content
 * @param config - Optional parser configuration
 * @returns Parsed document AST
 *
 * @example
 * ```typescript
 * const doc = org.parse('* TODO My heading\nSome content');
 * ```
 */
export function parse(content: string, config?: OrgParserConfig): OrgDocumentNode {
    return parseOrg(content, config);
}

/**
 * Write an org document to a file
 *
 * @param filePath - Path to write to
 * @param doc - Document AST to serialize
 * @param options - Serialization options
 *
 * @example
 * ```typescript
 * const doc = org.parseFile('./notes.org');
 * // ... modify doc ...
 * org.writeFile('./notes.org', doc);
 * ```
 */
export function writeFile(
    filePath: string,
    doc: OrgDocumentNode,
    options?: SerializeOptions
): void {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const content = serialize(doc, options);
    fs.writeFileSync(absolutePath, content, 'utf-8');
}

// =============================================================================
// Headline Traversal
// =============================================================================

/**
 * Callback for headline mapping
 */
export type HeadlineCallback = (
    headline: HeadlineElement,
    parent: HeadlineElement | OrgDocumentNode,
    index: number
) => void;

/**
 * Map over all headlines in a document (depth-first)
 *
 * @param doc - Document to traverse
 * @param callback - Function to call for each headline
 *
 * @example
 * ```typescript
 * // Set all TODO items to DONE
 * org.mapHeadlines(doc, h => {
 *   if (h.properties.todoKeyword === 'TODO') {
 *     h.properties.todoKeyword = 'DONE';
 *     h.properties.todoType = 'done';
 *   }
 * });
 * ```
 */
export function mapHeadlines(doc: OrgDocumentNode, callback: HeadlineCallback): void {
    function traverse(headlines: HeadlineElement[], parent: HeadlineElement | OrgDocumentNode): void {
        for (let i = 0; i < headlines.length; i++) {
            const headline = headlines[i];
            callback(headline, parent, i);
            traverse(headline.children, headline);
        }
    }
    traverse(doc.children, doc);
}

/**
 * Filter headlines matching a predicate
 *
 * @param doc - Document to search
 * @param predicate - Function that returns true for matching headlines
 * @returns Array of matching headlines
 *
 * @example
 * ```typescript
 * const todos = org.filterHeadlines(doc, h => h.properties.todoKeyword === 'TODO');
 * console.log(`Found ${todos.length} TODO items`);
 * ```
 */
export function filterHeadlines(
    doc: OrgDocumentNode,
    predicate: (headline: HeadlineElement) => boolean
): HeadlineElement[] {
    const results: HeadlineElement[] = [];
    mapHeadlines(doc, h => {
        if (predicate(h)) {
            results.push(h);
        }
    });
    return results;
}

/**
 * Find the first headline matching a predicate
 *
 * @param doc - Document to search
 * @param predicate - Function that returns true for matching headline
 * @returns First matching headline or undefined
 */
export function findHeadline(
    doc: OrgDocumentNode,
    predicate: (headline: HeadlineElement) => boolean
): HeadlineElement | undefined {
    let found: HeadlineElement | undefined;
    try {
        mapHeadlines(doc, h => {
            if (predicate(h)) {
                found = h;
                throw new Error('Found'); // Early exit
            }
        });
    } catch (e) {
        // Expected for early exit
    }
    return found;
}

/**
 * Get all headlines as a flat array
 *
 * @param doc - Document to traverse
 * @returns Array of all headlines in document order
 */
export function getAllHeadlines(doc: OrgDocumentNode): HeadlineElement[] {
    const headlines: HeadlineElement[] = [];
    mapHeadlines(doc, h => headlines.push(h));
    return headlines;
}

// =============================================================================
// Element Traversal
// =============================================================================

/**
 * Callback for element mapping
 */
export type ElementCallback = (
    element: OrgElement,
    parent: OrgElement | SectionElement | OrgDocumentNode,
    index: number
) => void;

/**
 * Map over all elements of a specific type in a document
 *
 * @param doc - Document to traverse
 * @param elementType - Type of element to find
 * @param callback - Function to call for each matching element
 *
 * @example
 * ```typescript
 * // Find all source blocks
 * org.mapElements(doc, 'src-block', (block) => {
 *   console.log(`Found ${block.properties.language} block`);
 * });
 * ```
 */
export function mapElements(
    doc: OrgDocumentNode,
    elementType: ElementType,
    callback: ElementCallback
): void {
    function traverseElements(elements: OrgElement[], parent: OrgElement | SectionElement | OrgDocumentNode): void {
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            if (element.type === elementType) {
                callback(element, parent, i);
            }
            // Recurse into children for container elements
            if ('children' in element && Array.isArray(element.children)) {
                traverseElements(element.children as OrgElement[], element);
            }
            if ('section' in element && (element as HeadlineElement).section) {
                traverseElements((element as HeadlineElement).section!.children, (element as HeadlineElement).section!);
            }
        }
    }

    // Traverse document section
    if (doc.section) {
        traverseElements(doc.section.children, doc.section);
    }

    // Traverse headlines and their sections
    function traverseHeadlines(headlines: HeadlineElement[]): void {
        for (const headline of headlines) {
            if (elementType === 'headline') {
                callback(headline, doc, 0);
            }
            if (headline.section) {
                traverseElements(headline.section.children, headline.section);
            }
            traverseHeadlines(headline.children);
        }
    }
    traverseHeadlines(doc.children);
}

/**
 * Filter elements by type
 *
 * @param doc - Document to search
 * @param elementType - Type of element to find
 * @returns Array of matching elements
 */
export function filterElements<T extends OrgElement = OrgElement>(
    doc: OrgDocumentNode,
    elementType: ElementType
): T[] {
    const results: T[] = [];
    mapElements(doc, elementType, el => results.push(el as T));
    return results;
}

/**
 * Get all source blocks in a document
 *
 * @param doc - Document to search
 * @returns Array of source block elements
 */
export function getSrcBlocks(doc: OrgDocumentNode): SrcBlockElement[] {
    return filterElements<SrcBlockElement>(doc, 'src-block');
}

/**
 * Get all tables in a document
 *
 * @param doc - Document to search
 * @returns Array of table elements
 */
export function getTables(doc: OrgDocumentNode): TableElement[] {
    return filterElements<TableElement>(doc, 'table');
}

// =============================================================================
// Query API
// =============================================================================

/**
 * Query criteria for finding elements
 */
export interface QueryCriteria {
    /** Element type to match */
    type?: ElementType;
    /** TODO keyword to match (for headlines) */
    todoKeyword?: string | string[];
    /** Has any TODO keyword */
    hasTodo?: boolean;
    /** TODO type (todo or done) */
    todoType?: 'todo' | 'done';
    /** Tags to match (all must be present) */
    tags?: string[];
    /** Any of these tags present */
    anyTag?: string[];
    /** Headline level */
    level?: number;
    /** Minimum headline level */
    minLevel?: number;
    /** Maximum headline level */
    maxLevel?: number;
    /** Title contains (case-insensitive) */
    titleContains?: string;
    /** Has property with key */
    hasProperty?: string;
    /** Property equals value */
    property?: { key: string; value: string };
    /** Source block language */
    language?: string;
    /** Custom predicate */
    predicate?: (element: OrgElement | HeadlineElement) => boolean;
}

/**
 * Query elements matching criteria
 *
 * @param doc - Document to search
 * @param criteria - Query criteria object
 * @returns Array of matching elements
 *
 * @example
 * ```typescript
 * // Find all TODO headlines with :project: tag
 * const projects = org.query(doc, {
 *   type: 'headline',
 *   hasTodo: true,
 *   tags: ['project']
 * });
 * ```
 */
export function query(doc: OrgDocumentNode, criteria: QueryCriteria): OrgElement[] {
    const results: OrgElement[] = [];

    // If querying headlines specifically
    if (criteria.type === 'headline' || criteria.hasTodo !== undefined ||
        criteria.todoKeyword !== undefined || criteria.todoType !== undefined ||
        criteria.tags !== undefined || criteria.anyTag !== undefined ||
        criteria.level !== undefined || criteria.minLevel !== undefined ||
        criteria.maxLevel !== undefined || criteria.titleContains !== undefined) {

        mapHeadlines(doc, h => {
            if (matchesHeadlineCriteria(h, criteria)) {
                results.push(h);
            }
        });
    } else if (criteria.type) {
        // Query other element types
        mapElements(doc, criteria.type, el => {
            if (matchesElementCriteria(el, criteria)) {
                results.push(el);
            }
        });
    }

    return results;
}

function matchesHeadlineCriteria(h: HeadlineElement, criteria: QueryCriteria): boolean {
    // TODO keyword checks
    if (criteria.todoKeyword !== undefined) {
        const keywords = Array.isArray(criteria.todoKeyword) ? criteria.todoKeyword : [criteria.todoKeyword];
        if (!h.properties.todoKeyword || !keywords.includes(h.properties.todoKeyword)) {
            return false;
        }
    }

    if (criteria.hasTodo === true && !h.properties.todoKeyword) return false;
    if (criteria.hasTodo === false && h.properties.todoKeyword) return false;

    if (criteria.todoType !== undefined && h.properties.todoType !== criteria.todoType) {
        return false;
    }

    // Tag checks
    if (criteria.tags !== undefined) {
        for (const tag of criteria.tags) {
            if (!h.properties.tags.includes(tag)) return false;
        }
    }

    if (criteria.anyTag !== undefined) {
        if (!criteria.anyTag.some(tag => h.properties.tags.includes(tag))) {
            return false;
        }
    }

    // Level checks
    if (criteria.level !== undefined && h.properties.level !== criteria.level) return false;
    if (criteria.minLevel !== undefined && h.properties.level < criteria.minLevel) return false;
    if (criteria.maxLevel !== undefined && h.properties.level > criteria.maxLevel) return false;

    // Title check
    if (criteria.titleContains !== undefined) {
        if (!h.properties.rawValue.toLowerCase().includes(criteria.titleContains.toLowerCase())) {
            return false;
        }
    }

    // Property checks
    if (criteria.hasProperty !== undefined) {
        if (!h.propertiesDrawer || !(criteria.hasProperty in h.propertiesDrawer)) {
            return false;
        }
    }

    if (criteria.property !== undefined) {
        if (!h.propertiesDrawer || h.propertiesDrawer[criteria.property.key] !== criteria.property.value) {
            return false;
        }
    }

    // Custom predicate
    if (criteria.predicate !== undefined && !criteria.predicate(h)) {
        return false;
    }

    return true;
}

function matchesElementCriteria(el: OrgElement, criteria: QueryCriteria): boolean {
    // Language check for src-blocks
    if (criteria.language !== undefined && el.type === 'src-block') {
        const srcBlock = el as SrcBlockElement;
        if (srcBlock.properties.language !== criteria.language) {
            return false;
        }
    }

    // Custom predicate
    if (criteria.predicate !== undefined && !criteria.predicate(el)) {
        return false;
    }

    return true;
}

// =============================================================================
// Table Utilities
// =============================================================================

/**
 * Options for table to JSON conversion
 */
export interface TableToJSONOptions {
    /** Use first row as header for object keys (default: true) */
    useHeader?: boolean;
    /** Trim whitespace from cell values (default: true) */
    trim?: boolean;
    /** Include rule rows in output (default: false) */
    includeRules?: boolean;
}

/**
 * Convert an org table to JSON
 *
 * @param table - Table element to convert
 * @param options - Conversion options
 * @returns Array of objects (if header) or array of arrays
 *
 * @example
 * ```typescript
 * const tables = org.getTables(doc);
 * const data = org.tableToJSON(tables[0]);
 * // [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]
 * ```
 */
export function tableToJSON(
    table: TableElement,
    options?: TableToJSONOptions
): Record<string, string>[] | string[][] {
    const opts = {
        useHeader: true,
        trim: true,
        includeRules: false,
        ...options,
    };

    // Filter out rule rows unless requested
    const dataRows = table.children.filter(row => {
        if (row.properties.rowType === 'rule') {
            return opts.includeRules;
        }
        return true;
    });

    if (dataRows.length === 0) {
        return [];
    }

    // Extract cell values
    function getCellValue(cell: TableCellObject): string {
        let value = cell.properties.value;
        if (cell.children && cell.children.length > 0) {
            value = serializeObjects(cell.children);
        }
        return opts.trim ? value.trim() : value;
    }

    function getRowValues(row: TableRowElement): string[] {
        return row.children.map(getCellValue);
    }

    if (!opts.useHeader) {
        return dataRows.map(getRowValues);
    }

    // Use first row as header
    const [headerRow, ...bodyRows] = dataRows;
    const headers = getRowValues(headerRow);

    return bodyRows.map(row => {
        const values = getRowValues(row);
        const obj: Record<string, string> = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] ?? '';
        });
        return obj;
    });
}

/**
 * Convert JSON data to an org table
 *
 * @param data - Array of objects or array of arrays
 * @param options - Conversion options
 * @returns Org table as text
 *
 * @example
 * ```typescript
 * const tableText = org.jsonToTable([
 *   { name: 'Alice', age: 30 },
 *   { name: 'Bob', age: 25 }
 * ]);
 * // | name  | age |
 * // |-------|-----|
 * // | Alice | 30  |
 * // | Bob   | 25  |
 * ```
 */
export function jsonToTable(
    data: Record<string, unknown>[] | unknown[][],
    options?: { includeHeader?: boolean; separator?: boolean }
): string {
    const opts = {
        includeHeader: true,
        separator: true,
        ...options,
    };

    if (data.length === 0) {
        return '';
    }

    const rows: string[][] = [];

    // Check if it's an array of objects or array of arrays
    if (Array.isArray(data[0])) {
        // Array of arrays
        rows.push(...(data as unknown[][]).map(row => row.map(String)));
    } else {
        // Array of objects
        const objData = data as Record<string, unknown>[];
        const headers = Object.keys(objData[0]);

        if (opts.includeHeader) {
            rows.push(headers);
        }

        for (const obj of objData) {
            rows.push(headers.map(h => String(obj[h] ?? '')));
        }
    }

    // Calculate column widths
    const colWidths: number[] = [];
    for (const row of rows) {
        row.forEach((cell, i) => {
            colWidths[i] = Math.max(colWidths[i] ?? 0, cell.length);
        });
    }

    // Format rows
    const formatRow = (row: string[]) => {
        const cells = row.map((cell, i) => cell.padEnd(colWidths[i]));
        return '| ' + cells.join(' | ') + ' |';
    };

    const lines: string[] = [];

    if (opts.includeHeader && rows.length > 0) {
        lines.push(formatRow(rows[0]));
        if (opts.separator) {
            lines.push('|' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '|');
        }
        rows.slice(1).forEach(row => lines.push(formatRow(row)));
    } else {
        rows.forEach(row => lines.push(formatRow(row)));
    }

    return lines.join('\n');
}

// =============================================================================
// Modification Helpers
// =============================================================================

/**
 * Set the TODO keyword on a headline
 *
 * @param headline - Headline to modify
 * @param keyword - TODO keyword (e.g., 'TODO', 'DONE') or undefined to remove
 * @param doneKeywords - List of keywords that indicate "done" state
 */
export function setTodo(
    headline: HeadlineElement,
    keyword: string | undefined,
    doneKeywords: string[] = ['DONE', 'CANCELLED', 'CANCELED']
): void {
    headline.properties.todoKeyword = keyword;
    if (keyword) {
        headline.properties.todoType = doneKeywords.includes(keyword) ? 'done' : 'todo';
    } else {
        headline.properties.todoType = undefined;
    }
}

/**
 * Add a tag to a headline
 *
 * @param headline - Headline to modify
 * @param tag - Tag to add
 */
export function addTag(headline: HeadlineElement, tag: string): void {
    if (!headline.properties.tags.includes(tag)) {
        headline.properties.tags.push(tag);
    }
}

/**
 * Remove a tag from a headline
 *
 * @param headline - Headline to modify
 * @param tag - Tag to remove
 */
export function removeTag(headline: HeadlineElement, tag: string): void {
    const index = headline.properties.tags.indexOf(tag);
    if (index !== -1) {
        headline.properties.tags.splice(index, 1);
    }
}

/**
 * Set a property on a headline
 *
 * @param headline - Headline to modify
 * @param key - Property key
 * @param value - Property value
 */
export function setProperty(headline: HeadlineElement, key: string, value: string): void {
    if (!headline.propertiesDrawer) {
        headline.propertiesDrawer = {};
    }
    headline.propertiesDrawer[key] = value;
}

/**
 * Remove a property from a headline
 *
 * @param headline - Headline to modify
 * @param key - Property key to remove
 */
export function removeProperty(headline: HeadlineElement, key: string): void {
    if (headline.propertiesDrawer) {
        delete headline.propertiesDrawer[key];
    }
}

/**
 * Set the priority on a headline
 *
 * @param headline - Headline to modify
 * @param priority - Priority letter (A, B, C, etc.) or undefined to remove
 */
export function setPriority(headline: HeadlineElement, priority: string | undefined): void {
    headline.properties.priority = priority;
}

// =============================================================================
// Document Structure Utilities
// =============================================================================

/**
 * Sort headlines at a given level
 *
 * @param headlines - Array of headlines to sort (mutates in place)
 * @param compareFn - Comparison function
 */
export function sortHeadlines(
    headlines: HeadlineElement[],
    compareFn: (a: HeadlineElement, b: HeadlineElement) => number
): void {
    headlines.sort(compareFn);
}

/**
 * Move a headline to a new position
 *
 * @param headlines - Array containing the headline
 * @param fromIndex - Current index
 * @param toIndex - Target index
 */
export function moveHeadline(headlines: HeadlineElement[], fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= headlines.length) return;
    if (toIndex < 0 || toIndex >= headlines.length) return;

    const [headline] = headlines.splice(fromIndex, 1);
    headlines.splice(toIndex, 0, headline);
}

/**
 * Promote a headline (decrease level)
 *
 * @param headline - Headline to promote
 * @param recursive - Also promote child headlines (default: true)
 */
export function promoteHeadline(headline: HeadlineElement, recursive = true): void {
    if (headline.properties.level <= 1) return;
    headline.properties.level--;
    if (recursive) {
        for (const child of headline.children) {
            promoteHeadline(child, true);
        }
    }
}

/**
 * Demote a headline (increase level)
 *
 * @param headline - Headline to demote
 * @param recursive - Also demote child headlines (default: true)
 */
export function demoteHeadline(headline: HeadlineElement, recursive = true): void {
    headline.properties.level++;
    if (recursive) {
        for (const child of headline.children) {
            demoteHeadline(child, true);
        }
    }
}

// =============================================================================
// Convenience Export Object
// =============================================================================

/**
 * Main org modification API object
 *
 * Provides all modification functions in a single namespace for easy use
 * in source blocks.
 *
 * @example
 * ```typescript
 * import { org } from 'scimax';
 *
 * const doc = org.parseFile('./notes.org');
 * org.mapHeadlines(doc, h => {
 *   if (h.properties.todoKeyword === 'TODO') {
 *     org.setTodo(h, 'DONE');
 *   }
 * });
 * org.writeFile('./notes.org', doc);
 * ```
 */
export const org = {
    // File I/O
    parseFile,
    parse,
    writeFile,
    serialize,

    // Headline traversal
    mapHeadlines,
    filterHeadlines,
    findHeadline,
    getAllHeadlines,

    // Element traversal
    mapElements,
    filterElements,
    getSrcBlocks,
    getTables,

    // Query
    query,

    // Table utilities
    tableToJSON,
    jsonToTable,

    // Modification helpers
    setTodo,
    addTag,
    removeTag,
    setProperty,
    removeProperty,
    setPriority,

    // Structure utilities
    sortHeadlines,
    moveHeadline,
    promoteHeadline,
    demoteHeadline,

    // Serialization
    serializeHeadline,
    serializeElement,
    serializeObjects,
};

export default org;
