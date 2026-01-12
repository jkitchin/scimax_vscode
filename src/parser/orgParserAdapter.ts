/**
 * Adapter for extracting legacy-format data from the unified parser
 * Provides compatibility between new AST and existing database/features
 */

import { parseOrg } from './orgParserUnified';
import type {
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    SrcBlockElement,
    LinkObject,
    TimestampObject,
    KeywordElement,
    DrawerElement,
    OrgElement,
    OrgObject,
} from './orgElementTypes';

/**
 * Legacy heading format for database compatibility
 */
export interface LegacyHeading {
    level: number;
    title: string;
    todoState?: string;
    priority?: string;
    tags: string[];
    lineNumber: number;
    properties: Record<string, string>;
    children: LegacyHeading[];
}

/**
 * Legacy source block format for database compatibility
 */
export interface LegacySourceBlock {
    language: string;
    content: string;
    headers: Record<string, string>;
    lineNumber: number;
    endLineNumber: number;
    name?: string;
}

/**
 * Legacy link format for database compatibility
 */
export interface LegacyLink {
    type: string;
    target: string;
    description?: string;
    lineNumber: number;
}

/**
 * Legacy timestamp format for database compatibility
 */
export interface LegacyTimestamp {
    type: 'active' | 'inactive' | 'scheduled' | 'deadline' | 'closed';
    date: string;
    time?: string;
    repeater?: string;
    lineNumber: number;
}

/**
 * Legacy document format for database compatibility
 */
export interface LegacyDocument {
    headings: LegacyHeading[];
    sourceBlocks: LegacySourceBlock[];
    links: LegacyLink[];
    timestamps: LegacyTimestamp[];
    properties: Record<string, string>;
    keywords: Record<string, string>;
}

/**
 * Parse content using unified parser and convert to legacy format
 */
export function parseToLegacyFormat(content: string): LegacyDocument {
    const doc = parseOrg(content, { addPositions: true });
    return extractLegacyDocument(doc, content);
}

/**
 * Extract legacy document format from unified parser AST
 */
export function extractLegacyDocument(doc: OrgDocumentNode, content: string): LegacyDocument {
    const lines = content.split('\n');
    const result: LegacyDocument = {
        headings: [],
        sourceBlocks: [],
        links: [],
        timestamps: [],
        properties: {},
        keywords: {},
    };

    // Extract data from the document
    extractFromNode(doc, result, lines);

    return result;
}

/**
 * Extract data from a node and its children
 */
function extractFromNode(
    node: OrgDocumentNode | OrgElement | OrgObject,
    result: LegacyDocument,
    lines: string[]
): void {
    if (!node) return;

    switch (node.type) {
        case 'org-document':
            const docNode = node as OrgDocumentNode;
            if (docNode.children) {
                for (const child of docNode.children) {
                    extractFromNode(child, result, lines);
                }
            }
            break;

        case 'section':
            const section = node as SectionElement;
            if (section.children) {
                for (const child of section.children) {
                    extractFromNode(child, result, lines);
                }
            }
            break;

        case 'headline':
            const headline = node as HeadlineElement;
            const legacyHeading = extractHeadline(headline, result, lines);
            result.headings.push(legacyHeading);
            break;

        case 'src-block':
            const srcBlock = node as SrcBlockElement;
            result.sourceBlocks.push(extractSourceBlock(srcBlock));
            break;

        case 'keyword':
            const keyword = node as KeywordElement;
            if (keyword.properties?.key && keyword.properties?.value) {
                result.keywords[keyword.properties.key.toUpperCase()] = keyword.properties.value;
            }
            break;

        case 'link':
            const link = node as LinkObject;
            result.links.push(extractLink(link));
            break;

        case 'timestamp':
            const timestamp = node as TimestampObject;
            result.timestamps.push(extractTimestamp(timestamp));
            break;

        default:
            // Check for children in any element
            if ('children' in node && Array.isArray((node as any).children)) {
                for (const child of (node as any).children) {
                    extractFromNode(child, result, lines);
                }
            }
    }
}

/**
 * Extract headline in legacy format
 */
function extractHeadline(
    headline: HeadlineElement,
    result: LegacyDocument,
    lines: string[]
): LegacyHeading {
    const props = headline.properties || {};
    const lineNumber = headline.position?.start?.line ?? 0;

    // Extract properties from property drawer
    const properties: Record<string, string> = {};
    if (headline.children) {
        for (const child of headline.children) {
            if (child.type === 'section') {
                const section = child as SectionElement;
                if (section.children) {
                    for (const sectionChild of section.children) {
                        if (sectionChild.type === 'drawer' &&
                            (sectionChild as DrawerElement).properties?.name === 'PROPERTIES') {
                            const drawer = sectionChild as DrawerElement;
                            if (drawer.children) {
                                for (const propLine of drawer.children) {
                                    if (propLine.type === 'node-property') {
                                        const propProps = (propLine as any).properties || {};
                                        if (propProps.key && propProps.value !== undefined) {
                                            properties[propProps.key] = propProps.value;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    const legacyHeading: LegacyHeading = {
        level: props.level || 1,
        title: props.title || '',
        todoState: props.todoKeyword,
        priority: props.priority,
        tags: props.tags || [],
        lineNumber: lineNumber + 1, // Convert to 1-indexed
        properties,
        children: [],
    };

    // Process children headlines
    if (headline.children) {
        for (const child of headline.children) {
            if (child.type === 'headline') {
                const childHeading = extractHeadline(child as HeadlineElement, result, lines);
                legacyHeading.children.push(childHeading);
            } else {
                // Extract other elements (links, timestamps, etc.)
                extractFromNode(child, result, lines);
            }
        }
    }

    return legacyHeading;
}

/**
 * Extract source block in legacy format
 */
function extractSourceBlock(block: SrcBlockElement): LegacySourceBlock {
    const props = block.properties || {};
    const startLine = block.position?.start?.line ?? 0;
    const endLine = block.position?.end?.line ?? startLine;

    // Parse headers from parameters string
    const headers: Record<string, string> = {};
    if (props.parameters) {
        const paramPattern = /:(\S+)\s+([^:]+?)(?=\s+:|$)/g;
        let match;
        while ((match = paramPattern.exec(props.parameters)) !== null) {
            headers[match[1]] = match[2].trim();
        }
    }

    return {
        language: props.language || '',
        content: props.value || '',
        headers,
        lineNumber: startLine + 1, // Convert to 1-indexed
        endLineNumber: endLine + 1,
        name: props.name,
    };
}

/**
 * Extract link in legacy format
 */
function extractLink(link: LinkObject): LegacyLink {
    const props = link.properties || {};
    const lineNumber = link.position?.start?.line ?? 0;

    // Determine link type from path
    let linkType = 'internal';
    let target = props.path || '';

    if (target.match(/^https?:/)) {
        linkType = target.startsWith('https:') ? 'https' : 'http';
    } else if (target.match(/^file:/)) {
        linkType = 'file';
        target = target.replace(/^file:/, '');
    } else if (target.match(/^mailto:/)) {
        linkType = 'mailto';
    } else if (target.match(/^doi:/)) {
        linkType = 'doi';
    } else if (target.match(/^cite:/)) {
        linkType = 'cite';
    } else if (target.match(/^id:/)) {
        linkType = 'id';
    } else if (target.match(/^\//)) {
        linkType = 'file';
    } else if (target.match(/^\.\//)) {
        linkType = 'file';
    }

    // Extract description from children
    let description: string | undefined;
    if (link.children && link.children.length > 0) {
        description = link.children
            .map((child: any) => {
                if (child.type === 'plain-text') {
                    return child.properties?.value || '';
                }
                return '';
            })
            .join('');
    }

    return {
        type: linkType,
        target,
        description: description || undefined,
        lineNumber: lineNumber + 1, // Convert to 1-indexed
    };
}

/**
 * Extract timestamp in legacy format
 */
function extractTimestamp(timestamp: TimestampObject): LegacyTimestamp {
    const props = timestamp.properties || {};
    const lineNumber = timestamp.position?.start?.line ?? 0;

    // Determine timestamp type
    let type: LegacyTimestamp['type'] = props.active ? 'active' : 'inactive';

    // Format date
    const year = props.year || new Date().getFullYear();
    const month = String(props.month || 1).padStart(2, '0');
    const day = String(props.day || 1).padStart(2, '0');
    const date = `${year}-${month}-${day}`;

    // Format time if present
    let time: string | undefined;
    if (props.hour !== undefined && props.minute !== undefined) {
        time = `${String(props.hour).padStart(2, '0')}:${String(props.minute).padStart(2, '0')}`;
    }

    // Format repeater if present
    let repeater: string | undefined;
    if (props.repeaterType && props.repeaterValue && props.repeaterUnit) {
        repeater = `${props.repeaterType}${props.repeaterValue}${props.repeaterUnit}`;
    }

    return {
        type,
        date,
        time,
        repeater,
        lineNumber: lineNumber + 1, // Convert to 1-indexed
    };
}

/**
 * Flatten headings into a list (for database indexing)
 */
export function flattenHeadings(headings: LegacyHeading[]): LegacyHeading[] {
    const result: LegacyHeading[] = [];

    function flatten(heading: LegacyHeading): void {
        result.push(heading);
        for (const child of heading.children) {
            flatten(child);
        }
    }

    for (const heading of headings) {
        flatten(heading);
    }

    return result;
}

/**
 * Unified parser adapter that provides the same interface as OrgParser
 * for backwards compatibility
 */
export class UnifiedParserAdapter {
    /**
     * Parse org content and return legacy format document
     */
    public parse(content: string): LegacyDocument {
        return parseToLegacyFormat(content);
    }

    /**
     * Flatten headings from a document
     */
    public flattenHeadings(doc: LegacyDocument): LegacyHeading[] {
        return flattenHeadings(doc.headings);
    }
}
