/**
 * Parser for org-mode affiliated keywords
 * Handles #+CAPTION, #+NAME, #+ATTR_*, #+HEADER, #+RESULTS, etc.
 */

import type { AffiliatedKeywords } from './orgElementTypes';

/**
 * List of keywords that can be affiliated with elements
 */
const AFFILIATED_KEYWORD_NAMES = new Set([
    'CAPTION',
    'DATA',
    'HEADER',
    'HEADERS',
    'LABEL',
    'NAME',
    'PLOT',
    'RESNAME',
    'RESULT',
    'RESULTS',
    'SOURCE',
    'SRCNAME',
    'TBLNAME',
]);

/**
 * Keywords that start with ATTR_ and specify backend attributes
 */
const ATTR_KEYWORD_PATTERN = /^ATTR_(\w+)$/i;

/**
 * Parse a colon-separated attribute string
 * Example: ":width 0.8 :float t :placement [H]"
 * Returns: { width: "0.8", float: "t", placement: "[H]" }
 */
export function parseColonAttributes(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!text.trim()) {
        return result;
    }

    // Handle complex values that might contain spaces (e.g., :placement [H])
    // Strategy: find all :key patterns and extract values between them
    const keyPositions: { key: string; start: number }[] = [];
    const keyPattern = /:([a-zA-Z][\w-]*)/g;
    let match;

    while ((match = keyPattern.exec(text)) !== null) {
        keyPositions.push({
            key: match[1],
            start: match.index + match[0].length,
        });
    }

    // Extract values between keys
    for (let i = 0; i < keyPositions.length; i++) {
        const current = keyPositions[i];
        const nextStart = i + 1 < keyPositions.length
            ? text.lastIndexOf(':', keyPositions[i + 1].start)
            : text.length;

        const value = text.slice(current.start, nextStart).trim();
        if (value) {
            result[current.key] = value;
        }
    }

    return result;
}

/**
 * Result of parsing a caption with potential inline label
 */
export interface CaptionParseResult {
    /** The caption text (string or [short, long] array) */
    caption: string | [string, string];
    /** Inline label if found (e.g., label:fig-name at end of caption) */
    inlineLabel?: string;
}

/**
 * Parse caption text, handling optional short caption and inline labels
 * Format: [short caption]long caption label:labelname
 * Or just: long caption label:labelname
 * Or: [short caption]long caption
 * Or just: long caption
 *
 * The inline label (org-ref style) appears at the end: label:some-label-name
 */
export function parseCaption(text: string): CaptionParseResult {
    let captionText = text;
    let inlineLabel: string | undefined;

    // Check for inline label at end of caption (org-ref style)
    // Pattern: label:labelname at the end, where labelname can contain alphanumeric, hyphen, underscore
    const labelMatch = text.match(/\s+label:([a-zA-Z0-9_:-]+)\s*$/);
    if (labelMatch) {
        inlineLabel = labelMatch[1];
        captionText = text.slice(0, labelMatch.index).trim();
    }

    // Parse short/long caption format
    const shortMatch = captionText.match(/^\[([^\]]*)\]\s*(.*)$/);
    if (shortMatch) {
        return {
            caption: [shortMatch[1], shortMatch[2]],
            inlineLabel
        };
    }

    return {
        caption: captionText,
        inlineLabel
    };
}

/**
 * Result of parsing affiliated keywords
 */
export interface AffiliatedKeywordsResult {
    /** Parsed affiliated keywords */
    affiliated: AffiliatedKeywords | undefined;
    /** Number of lines consumed (counting backwards from element) */
    consumedLines: number;
    /** Starting line index (adjusted for affiliated keywords) */
    adjustedStartLine: number;
}

/**
 * Parse affiliated keywords looking backwards from an element's start line
 *
 * @param lines - All document lines
 * @param elementStartLine - Line index where the element starts (0-indexed)
 * @returns Parsed affiliated keywords and metadata
 */
export function parseAffiliatedKeywords(
    lines: string[],
    elementStartLine: number
): AffiliatedKeywordsResult {
    const affiliated: AffiliatedKeywords = { attr: {} };
    let hasAnyKeyword = false;
    let i = elementStartLine - 1;

    // Look backwards for affiliated keywords
    while (i >= 0) {
        const line = lines[i].trim();

        // Empty lines break the affiliated keyword sequence
        if (line === '') {
            break;
        }

        // Must be a keyword line starting with #+
        if (!line.startsWith('#+')) {
            break;
        }

        // Parse the keyword
        const keywordMatch = line.match(/^#\+(\w+):\s*(.*)$/i);
        if (!keywordMatch) {
            break;
        }

        const keyword = keywordMatch[1].toUpperCase();
        const value = keywordMatch[2];

        // Check for ATTR_* keywords
        const attrMatch = keyword.match(ATTR_KEYWORD_PATTERN);
        if (attrMatch) {
            const backend = attrMatch[1].toLowerCase();
            const attrs = parseColonAttributes(value);
            // Merge with existing (later keywords take precedence)
            affiliated.attr[backend] = { ...attrs, ...affiliated.attr[backend] };
            hasAnyKeyword = true;
            i--;
            continue;
        }

        // Check for standard affiliated keywords
        if (AFFILIATED_KEYWORD_NAMES.has(keyword)) {
            switch (keyword) {
                case 'CAPTION': {
                    const captionResult = parseCaption(value);
                    affiliated.caption = captionResult.caption;
                    // Use inline label if no explicit #+NAME: or #+LABEL: is set
                    if (captionResult.inlineLabel && !affiliated.name) {
                        affiliated.name = captionResult.inlineLabel;
                    }
                    break;
                }
                case 'NAME':
                case 'LABEL':
                case 'SRCNAME':
                case 'TBLNAME':
                case 'RESNAME':
                    affiliated.name = value;
                    break;
                case 'RESULTS':
                case 'RESULT':
                    affiliated.results = value;
                    break;
                case 'HEADER':
                case 'HEADERS':
                    if (!affiliated.header) {
                        affiliated.header = [];
                    }
                    affiliated.header.unshift(value); // prepend since we're going backwards
                    break;
                case 'PLOT':
                    affiliated.plot = value;
                    break;
                // DATA, SOURCE are less common, handle if needed
            }
            hasAnyKeyword = true;
            i--;
            continue;
        }

        // Unknown keyword - stop looking
        break;
    }

    const consumedLines = elementStartLine - 1 - i;

    return {
        affiliated: hasAnyKeyword ? affiliated : undefined,
        consumedLines,
        adjustedStartLine: i + 1,
    };
}

/**
 * Check if a line is an affiliated keyword line
 */
export function isAffiliatedKeywordLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#+')) {
        return false;
    }

    const match = trimmed.match(/^#\+(\w+):/i);
    if (!match) {
        return false;
    }

    const keyword = match[1].toUpperCase();

    // Check for ATTR_*
    if (ATTR_KEYWORD_PATTERN.test(keyword)) {
        return true;
    }

    // Check for standard affiliated keywords
    return AFFILIATED_KEYWORD_NAMES.has(keyword);
}

/**
 * Serialize affiliated keywords back to org format
 */
export function serializeAffiliatedKeywords(affiliated: AffiliatedKeywords): string[] {
    const lines: string[] = [];

    // Name first
    if (affiliated.name) {
        lines.push(`#+NAME: ${affiliated.name}`);
    }

    // Caption
    if (affiliated.caption) {
        if (Array.isArray(affiliated.caption)) {
            lines.push(`#+CAPTION: [${affiliated.caption[0]}]${affiliated.caption[1]}`);
        } else {
            lines.push(`#+CAPTION: ${affiliated.caption}`);
        }
    }

    // Header arguments
    if (affiliated.header) {
        for (const header of affiliated.header) {
            lines.push(`#+HEADER: ${header}`);
        }
    }

    // Plot
    if (affiliated.plot) {
        lines.push(`#+PLOT: ${affiliated.plot}`);
    }

    // Results
    if (affiliated.results) {
        lines.push(`#+RESULTS: ${affiliated.results}`);
    }

    // Backend attributes
    for (const [backend, attrs] of Object.entries(affiliated.attr)) {
        if (attrs && Object.keys(attrs).length > 0) {
            const attrStr = Object.entries(attrs)
                .map(([key, value]) => `:${key} ${value}`)
                .join(' ');
            lines.push(`#+ATTR_${backend.toUpperCase()}: ${attrStr}`);
        }
    }

    return lines;
}
