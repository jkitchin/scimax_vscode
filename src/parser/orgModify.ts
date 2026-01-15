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
    ClockElement,
    ParagraphElement,
    PlainTextObject,
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
    ClockElement,
};

export { parseOrg, serialize };

// =============================================================================
// Timestamp Types
// =============================================================================

/**
 * Options for creating a timestamp
 */
export interface TimestampOptions {
    /** Year (e.g., 2024) */
    year: number;
    /** Month (1-12) */
    month: number;
    /** Day (1-31) */
    day: number;
    /** Hour (0-23, optional) */
    hour?: number;
    /** Minute (0-59, optional) */
    minute?: number;
    /** Whether timestamp is active (default: true) */
    active?: boolean;
    /** Repeater type ('+', '++', '.+') */
    repeaterType?: '+' | '++' | '.+';
    /** Repeater value */
    repeaterValue?: number;
    /** Repeater unit ('h', 'd', 'w', 'm', 'y') */
    repeaterUnit?: 'h' | 'd' | 'w' | 'm' | 'y';
    /** Warning type ('-', '--') */
    warningType?: '-' | '--';
    /** Warning value */
    warningValue?: number;
    /** Warning unit ('h', 'd', 'w', 'm', 'y') */
    warningUnit?: 'h' | 'd' | 'w' | 'm' | 'y';
}

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

/**
 * Options for table to CSV conversion
 */
export interface TableToCSVOptions {
    /** Use first row as header (default: true) */
    useHeader?: boolean;
    /** Trim whitespace from cell values (default: true) */
    trim?: boolean;
    /** Field delimiter (default: ',') */
    delimiter?: string;
    /** Quote character for escaping (default: '"') */
    quote?: string;
    /** Line ending (default: '\n') */
    lineEnding?: string;
}

/**
 * Convert an org table to CSV format
 *
 * @param table - Table element to convert
 * @param options - Conversion options
 * @returns CSV string
 *
 * @example
 * ```typescript
 * const tables = org.getTables(doc);
 * const csv = org.tableToCSV(tables[0]);
 * // name,age
 * // Alice,30
 * // Bob,25
 *
 * // Write to file
 * import * as fs from 'fs';
 * fs.writeFileSync('data.csv', csv);
 * ```
 */
export function tableToCSV(
    table: TableElement,
    options?: TableToCSVOptions
): string {
    const opts = {
        useHeader: true,
        trim: true,
        delimiter: ',',
        quote: '"',
        lineEnding: '\n',
        ...options,
    };

    // Filter out rule rows
    const dataRows = table.children.filter(row => row.properties.rowType !== 'rule');

    if (dataRows.length === 0) {
        return '';
    }

    // Extract cell values
    function getCellValue(cell: TableCellObject): string {
        let value = cell.properties.value;
        if (cell.children && cell.children.length > 0) {
            value = serializeObjects(cell.children);
        }
        return opts.trim ? value.trim() : value;
    }

    function escapeCSVField(value: string): string {
        const needsQuoting = value.includes(opts.delimiter) ||
            value.includes(opts.quote) ||
            value.includes('\n') ||
            value.includes('\r');

        if (needsQuoting) {
            // Escape quotes by doubling them
            const escaped = value.replace(new RegExp(opts.quote, 'g'), opts.quote + opts.quote);
            return opts.quote + escaped + opts.quote;
        }
        return value;
    }

    function getRowCSV(row: TableRowElement): string {
        const cells = row.children.map(cell => escapeCSVField(getCellValue(cell)));
        return cells.join(opts.delimiter);
    }

    const lines = dataRows.map(getRowCSV);
    return lines.join(opts.lineEnding);
}

/**
 * Write table data to a CSV file
 *
 * @param filePath - Path to write the CSV file
 * @param table - Table element to convert
 * @param options - CSV conversion options
 *
 * @example
 * ```typescript
 * const tables = org.getTables(doc);
 * org.writeTableToCSV('./data.csv', tables[0]);
 * ```
 */
export function writeTableToCSV(
    filePath: string,
    table: TableElement,
    options?: TableToCSVOptions
): void {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const csv = tableToCSV(table, options);
    fs.writeFileSync(absolutePath, csv, 'utf-8');
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
// Tree Manipulation
// =============================================================================

/**
 * Create a new headline element
 *
 * @param title - Headline title text
 * @param level - Headline level (default: 1)
 * @param options - Additional headline options
 * @returns New headline element
 *
 * @example
 * ```typescript
 * const h = org.createHeadline('New Task', 2, { todoKeyword: 'TODO' });
 * org.insertHeadline(doc, h, 0);
 * ```
 */
export function createHeadline(
    title: string,
    level = 1,
    options?: {
        todoKeyword?: string;
        todoType?: 'todo' | 'done';
        priority?: string;
        tags?: string[];
        properties?: Record<string, string>;
    }
): HeadlineElement {
    const headline: HeadlineElement = {
        type: 'headline',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            level,
            rawValue: title,
            tags: options?.tags ?? [],
            archivedp: options?.tags?.includes('ARCHIVE') ?? false,
            commentedp: false,
            footnoteSection: false,
            lineNumber: 0,
            todoKeyword: options?.todoKeyword,
            todoType: options?.todoType,
            priority: options?.priority,
        },
        children: [],
    };

    if (options?.properties) {
        headline.propertiesDrawer = { ...options.properties };
    }

    return headline;
}

/**
 * Insert a headline into a document or parent headline
 *
 * @param parent - Document or parent headline
 * @param headline - Headline to insert
 * @param index - Position to insert at (default: end)
 *
 * @example
 * ```typescript
 * const newHeadline = org.createHeadline('New Section', 1);
 * org.insertHeadline(doc, newHeadline, 0); // Insert at beginning
 * ```
 */
export function insertHeadline(
    parent: OrgDocumentNode | HeadlineElement,
    headline: HeadlineElement,
    index?: number
): void {
    const children = parent.children;
    const insertIndex = index ?? children.length;

    // Adjust headline level if inserting into a headline
    if ('properties' in parent && parent.type === 'headline') {
        const parentLevel = (parent as HeadlineElement).properties.level;
        const levelDiff = parentLevel + 1 - headline.properties.level;
        if (levelDiff !== 0) {
            adjustHeadlineLevel(headline, levelDiff);
        }
    }

    children.splice(insertIndex, 0, headline);
}

/**
 * Delete a headline from its parent
 *
 * @param parent - Document or parent headline containing the headline
 * @param headline - Headline to delete (or index)
 * @returns The deleted headline, or undefined if not found
 *
 * @example
 * ```typescript
 * const deleted = org.deleteHeadline(doc, doc.children[0]);
 * ```
 */
export function deleteHeadline(
    parent: OrgDocumentNode | HeadlineElement,
    headline: HeadlineElement | number
): HeadlineElement | undefined {
    const children = parent.children;
    const index = typeof headline === 'number' ? headline : children.indexOf(headline);

    if (index >= 0 && index < children.length) {
        const [deleted] = children.splice(index, 1);
        return deleted;
    }
    return undefined;
}

/**
 * Create a deep copy of a headline
 *
 * @param headline - Headline to copy
 * @returns Deep copy of the headline
 *
 * @example
 * ```typescript
 * const copy = org.copyHeadline(doc.children[0]);
 * org.insertHeadline(doc, copy);
 * ```
 */
export function copyHeadline(headline: HeadlineElement): HeadlineElement {
    return JSON.parse(JSON.stringify(headline));
}

/**
 * Adjust headline level by a delta (positive or negative)
 */
function adjustHeadlineLevel(headline: HeadlineElement, delta: number): void {
    headline.properties.level = Math.max(1, headline.properties.level + delta);
    for (const child of headline.children) {
        adjustHeadlineLevel(child, delta);
    }
}

/**
 * Find the parent of a headline in a document
 *
 * @param doc - Document to search
 * @param headline - Headline to find parent of
 * @returns Parent headline or document, or undefined if not found
 */
export function findParent(
    doc: OrgDocumentNode,
    headline: HeadlineElement
): OrgDocumentNode | HeadlineElement | undefined {
    // Check top-level
    if (doc.children.includes(headline)) {
        return doc;
    }

    // Search recursively
    let foundParent: HeadlineElement | undefined;
    mapHeadlines(doc, (h) => {
        if (h.children.includes(headline)) {
            foundParent = h;
        }
    });
    return foundParent;
}

/**
 * Get the path from root to a headline
 *
 * @param doc - Document to search
 * @param headline - Target headline
 * @returns Array of headlines from root to target (inclusive)
 */
export function getHeadlinePath(
    doc: OrgDocumentNode,
    headline: HeadlineElement
): HeadlineElement[] {
    const path: HeadlineElement[] = [];

    function search(headlines: HeadlineElement[], target: HeadlineElement): boolean {
        for (const h of headlines) {
            if (h === target) {
                path.push(h);
                return true;
            }
            if (search(h.children, target)) {
                path.unshift(h);
                return true;
            }
        }
        return false;
    }

    search(doc.children, headline);
    return path;
}

// =============================================================================
// Timestamp Utilities
// =============================================================================

/**
 * Create a timestamp object
 *
 * @param options - Timestamp options
 * @returns TimestampObject
 *
 * @example
 * ```typescript
 * const ts = org.createTimestamp({ year: 2024, month: 3, day: 15, hour: 14, minute: 30 });
 * org.setDeadline(headline, ts);
 * ```
 */
export function createTimestamp(options: TimestampOptions): TimestampObject {
    const isActive = options.active !== false;
    const open = isActive ? '<' : '[';
    const close = isActive ? '>' : ']';

    // Build raw value string
    let rawValue = `${open}${options.year}-${String(options.month).padStart(2, '0')}-${String(options.day).padStart(2, '0')}`;

    if (options.hour !== undefined && options.minute !== undefined) {
        rawValue += ` ${String(options.hour).padStart(2, '0')}:${String(options.minute).padStart(2, '0')}`;
    }

    if (options.repeaterType && options.repeaterValue && options.repeaterUnit) {
        rawValue += ` ${options.repeaterType}${options.repeaterValue}${options.repeaterUnit}`;
    }

    if (options.warningType && options.warningValue && options.warningUnit) {
        rawValue += ` ${options.warningType}${options.warningValue}${options.warningUnit}`;
    }

    rawValue += close;

    return {
        type: 'timestamp',
        range: { start: 0, end: rawValue.length },
        postBlank: 0,
        properties: {
            timestampType: isActive ? 'active' : 'inactive',
            rawValue,
            yearStart: options.year,
            monthStart: options.month,
            dayStart: options.day,
            hourStart: options.hour,
            minuteStart: options.minute,
            repeaterType: options.repeaterType,
            repeaterValue: options.repeaterValue,
            repeaterUnit: options.repeaterUnit,
            warningType: options.warningType,
            warningValue: options.warningValue,
            warningUnit: options.warningUnit,
        },
    };
}

/**
 * Create a timestamp from a Date object
 *
 * @param date - JavaScript Date object
 * @param options - Additional options (time, active, repeater, etc.)
 * @returns TimestampObject
 *
 * @example
 * ```typescript
 * const ts = org.timestampFromDate(new Date(), { includeTime: true });
 * ```
 */
export function timestampFromDate(
    date: Date,
    options?: {
        includeTime?: boolean;
        active?: boolean;
        repeaterType?: '+' | '++' | '.+';
        repeaterValue?: number;
        repeaterUnit?: 'h' | 'd' | 'w' | 'm' | 'y';
    }
): TimestampObject {
    return createTimestamp({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: options?.includeTime ? date.getHours() : undefined,
        minute: options?.includeTime ? date.getMinutes() : undefined,
        active: options?.active,
        repeaterType: options?.repeaterType,
        repeaterValue: options?.repeaterValue,
        repeaterUnit: options?.repeaterUnit,
    });
}

/**
 * Convert a TimestampObject to a JavaScript Date
 *
 * @param ts - Timestamp object
 * @returns JavaScript Date
 */
export function timestampToDate(ts: TimestampObject): Date {
    const date = new Date(
        ts.properties.yearStart,
        ts.properties.monthStart - 1,
        ts.properties.dayStart,
        ts.properties.hourStart ?? 0,
        ts.properties.minuteStart ?? 0
    );
    return date;
}

/**
 * Set the SCHEDULED timestamp on a headline
 *
 * @param headline - Headline to modify
 * @param timestamp - Timestamp to set, or undefined to remove
 *
 * @example
 * ```typescript
 * const tomorrow = new Date();
 * tomorrow.setDate(tomorrow.getDate() + 1);
 * org.setScheduled(headline, org.timestampFromDate(tomorrow));
 * ```
 */
export function setScheduled(headline: HeadlineElement, timestamp: TimestampObject | undefined): void {
    if (!timestamp) {
        if (headline.planning) {
            headline.planning.properties.scheduled = undefined;
            cleanupPlanning(headline);
        }
        return;
    }

    ensurePlanning(headline);
    headline.planning!.properties.scheduled = timestamp;
}

/**
 * Set the DEADLINE timestamp on a headline
 *
 * @param headline - Headline to modify
 * @param timestamp - Timestamp to set, or undefined to remove
 */
export function setDeadline(headline: HeadlineElement, timestamp: TimestampObject | undefined): void {
    if (!timestamp) {
        if (headline.planning) {
            headline.planning.properties.deadline = undefined;
            cleanupPlanning(headline);
        }
        return;
    }

    ensurePlanning(headline);
    headline.planning!.properties.deadline = timestamp;
}

/**
 * Set the CLOSED timestamp on a headline
 *
 * @param headline - Headline to modify
 * @param timestamp - Timestamp to set, or undefined to remove
 */
export function setClosed(headline: HeadlineElement, timestamp: TimestampObject | undefined): void {
    if (!timestamp) {
        if (headline.planning) {
            headline.planning.properties.closed = undefined;
            cleanupPlanning(headline);
        }
        return;
    }

    ensurePlanning(headline);
    headline.planning!.properties.closed = timestamp;
}

/**
 * Get the SCHEDULED timestamp from a headline
 */
export function getScheduled(headline: HeadlineElement): TimestampObject | undefined {
    return headline.planning?.properties.scheduled;
}

/**
 * Get the DEADLINE timestamp from a headline
 */
export function getDeadline(headline: HeadlineElement): TimestampObject | undefined {
    return headline.planning?.properties.deadline;
}

/**
 * Get the CLOSED timestamp from a headline
 */
export function getClosed(headline: HeadlineElement): TimestampObject | undefined {
    return headline.planning?.properties.closed;
}

function ensurePlanning(headline: HeadlineElement): void {
    if (!headline.planning) {
        headline.planning = {
            type: 'planning',
            range: { start: 0, end: 0 },
            postBlank: 0,
            properties: {},
        };
    }
}

function cleanupPlanning(headline: HeadlineElement): void {
    if (headline.planning) {
        const props = headline.planning.properties;
        if (!props.scheduled && !props.deadline && !props.closed) {
            headline.planning = undefined;
        }
    }
}

// =============================================================================
// Link Utilities
// =============================================================================

/**
 * Get all links in a document
 *
 * @param doc - Document to search
 * @returns Array of link objects with their context
 *
 * @example
 * ```typescript
 * const links = org.getLinks(doc);
 * links.forEach(link => console.log(link.path));
 * ```
 */
export function getLinks(doc: OrgDocumentNode): LinkObject[] {
    const links: LinkObject[] = [];

    function extractFromObjects(objects: OrgObject[]): void {
        for (const obj of objects) {
            if (obj.type === 'link') {
                links.push(obj as LinkObject);
            }
            if ('children' in obj && obj.children) {
                extractFromObjects(obj.children);
            }
        }
    }

    function extractFromElements(elements: OrgElement[]): void {
        for (const element of elements) {
            if (element.type === 'paragraph') {
                const para = element as ParagraphElement;
                if (para.children) {
                    extractFromObjects(para.children);
                }
            }
            if ('children' in element && Array.isArray(element.children)) {
                extractFromElements(element.children as OrgElement[]);
            }
        }
    }

    // Search document section
    if (doc.section) {
        extractFromElements(doc.section.children);
    }

    // Search headlines
    mapHeadlines(doc, h => {
        // Search title
        if (h.properties.title) {
            extractFromObjects(h.properties.title);
        }
        // Search section
        if (h.section) {
            extractFromElements(h.section.children);
        }
    });

    return links;
}

/**
 * Get links filtered by type
 *
 * @param doc - Document to search
 * @param linkType - Link type to filter by ('http', 'https', 'file', etc.)
 * @returns Array of matching link objects
 */
export function getLinksByType(doc: OrgDocumentNode, linkType: string): LinkObject[] {
    return getLinks(doc).filter(link => link.properties.linkType === linkType);
}

/**
 * Create a link object
 *
 * @param path - Link target path
 * @param description - Optional link description
 * @param linkType - Link type (default: auto-detected)
 * @returns LinkObject
 */
export function createLink(
    path: string,
    description?: string,
    linkType?: string
): LinkObject {
    // Auto-detect link type
    let detectedType = linkType;
    if (!detectedType) {
        if (path.startsWith('https://')) detectedType = 'https';
        else if (path.startsWith('http://')) detectedType = 'http';
        else if (path.startsWith('file:')) detectedType = 'file';
        else if (path.startsWith('#')) detectedType = 'custom-id';
        else if (path.startsWith('*')) detectedType = 'fuzzy';
        else detectedType = 'fuzzy';
    }

    const link: LinkObject = {
        type: 'link',
        range: { start: 0, end: 0 },
        postBlank: 0,
        properties: {
            linkType: detectedType,
            path,
            format: 'bracket',
        },
    };

    if (description) {
        const textObj: PlainTextObject = {
            type: 'plain-text',
            range: { start: 0, end: description.length },
            postBlank: 0,
            properties: { value: description },
        };
        link.children = [textObj];
    }

    return link;
}

// =============================================================================
// Clock Utilities
// =============================================================================

/**
 * Get all clock entries from a headline
 *
 * @param headline - Headline to search
 * @returns Array of clock elements
 */
export function getClockEntries(headline: HeadlineElement): ClockElement[] {
    const clocks: ClockElement[] = [];

    if (headline.section) {
        for (const element of headline.section.children) {
            if (element.type === 'clock') {
                clocks.push(element as ClockElement);
            }
        }
    }

    return clocks;
}

/**
 * Get all clock entries from a document
 *
 * @param doc - Document to search
 * @returns Array of clock elements with their parent headlines
 */
export function getAllClockEntries(doc: OrgDocumentNode): Array<{ clock: ClockElement; headline: HeadlineElement }> {
    const entries: Array<{ clock: ClockElement; headline: HeadlineElement }> = [];

    mapHeadlines(doc, h => {
        const clocks = getClockEntries(h);
        for (const clock of clocks) {
            entries.push({ clock, headline: h });
        }
    });

    return entries;
}

/**
 * Calculate total clocked time for a headline in minutes
 *
 * @param headline - Headline to calculate
 * @param recursive - Include child headlines (default: false)
 * @returns Total time in minutes
 */
export function getTotalClockTime(headline: HeadlineElement, recursive = false): number {
    let total = 0;

    function addClockTime(h: HeadlineElement): void {
        const clocks = getClockEntries(h);
        for (const clock of clocks) {
            if (clock.properties.duration) {
                const [hours, minutes] = clock.properties.duration.split(':').map(Number);
                total += hours * 60 + minutes;
            } else if (clock.properties.start && clock.properties.end) {
                const start = timestampToDate(clock.properties.start);
                const end = timestampToDate(clock.properties.end);
                total += Math.round((end.getTime() - start.getTime()) / 60000);
            }
        }
    }

    addClockTime(headline);

    if (recursive) {
        for (const child of headline.children) {
            total += getTotalClockTime(child, true);
        }
    }

    return total;
}

/**
 * Format minutes as HH:MM string
 */
export function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, '0')}`;
}

// =============================================================================
// Property Inheritance
// =============================================================================

/**
 * Get a property value, checking inherited properties from ancestors
 *
 * @param doc - Document containing the headline
 * @param headline - Headline to get property from
 * @param key - Property key
 * @returns Property value or undefined
 *
 * @example
 * ```typescript
 * // Get CATEGORY, inheriting from parent if not set
 * const category = org.getInheritedProperty(doc, headline, 'CATEGORY');
 * ```
 */
export function getInheritedProperty(
    doc: OrgDocumentNode,
    headline: HeadlineElement,
    key: string
): string | undefined {
    // Check headline's own properties
    if (headline.propertiesDrawer?.[key]) {
        return headline.propertiesDrawer[key];
    }

    // Get path to root
    const path = getHeadlinePath(doc, headline);

    // Check ancestors from closest to root
    for (let i = path.length - 2; i >= 0; i--) {
        const value = path[i].propertiesDrawer?.[key];
        if (value) {
            return value;
        }
    }

    // Check document properties
    if (doc.properties[key]) {
        return doc.properties[key];
    }

    return undefined;
}

/**
 * Get all effective properties for a headline (including inherited)
 *
 * @param doc - Document containing the headline
 * @param headline - Headline to get properties for
 * @returns Object with all effective properties
 */
export function getEffectiveProperties(
    doc: OrgDocumentNode,
    headline: HeadlineElement
): Record<string, string> {
    const properties: Record<string, string> = {};

    // Start with document properties
    Object.assign(properties, doc.properties);

    // Get path and apply properties from root to headline
    const path = getHeadlinePath(doc, headline);
    for (const h of path) {
        if (h.propertiesDrawer) {
            Object.assign(properties, h.propertiesDrawer);
        }
    }

    return properties;
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
    tableToCSV,
    writeTableToCSV,

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

    // Tree manipulation
    createHeadline,
    insertHeadline,
    deleteHeadline,
    copyHeadline,
    findParent,
    getHeadlinePath,

    // Timestamp utilities
    createTimestamp,
    timestampFromDate,
    timestampToDate,
    setScheduled,
    setDeadline,
    setClosed,
    getScheduled,
    getDeadline,
    getClosed,

    // Link utilities
    getLinks,
    getLinksByType,
    createLink,

    // Clock utilities
    getClockEntries,
    getAllClockEntries,
    getTotalClockTime,
    formatDuration,

    // Property inheritance
    getInheritedProperty,
    getEffectiveProperties,

    // Serialization
    serializeHeadline,
    serializeElement,
    serializeObjects,
};

export default org;
