/**
 * Org-mode #+INCLUDE: directive processor
 *
 * Supports the following syntax:
 *   #+INCLUDE: "filename"
 *   #+INCLUDE: "filename" src lang
 *   #+INCLUDE: "filename" example
 *   #+INCLUDE: "filename" quote
 *   #+INCLUDE: "filename" export format
 *   #+INCLUDE: "filename" :lines "start-end"
 *   #+INCLUDE: "filename" :minlevel N
 *   #+INCLUDE: "filename" :only-contents t
 *
 * Options can be combined:
 *   #+INCLUDE: "code.py" src python :lines "10-20"
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed #+INCLUDE: directive
 */
export interface IncludeDirective {
    /** Original line text */
    raw: string;
    /** File path to include (relative or absolute) */
    file: string;
    /** Block type: src, example, quote, export, or none (raw include) */
    blockType?: 'src' | 'example' | 'quote' | 'export';
    /** Language for src blocks */
    language?: string;
    /** Export format for export blocks */
    exportFormat?: string;
    /** Line range to include (1-indexed, inclusive) */
    lines?: { start?: number; end?: number };
    /** Minimum headline level (shift headlines to this level) */
    minLevel?: number;
    /** Only include contents (strip first headline) */
    onlyContents?: boolean;
    /** Line number in source document */
    lineNumber: number;
}

/**
 * Result of processing an include
 */
export interface IncludeResult {
    /** Whether the include was successful */
    success: boolean;
    /** Processed content (or error message) */
    content: string;
    /** Original directive */
    directive: IncludeDirective;
    /** Resolved file path */
    resolvedPath?: string;
    /** Error message if failed */
    error?: string;
}

/**
 * Options for include processing
 */
export interface IncludeOptions {
    /** Base directory for resolving relative paths */
    basePath: string;
    /** Maximum include depth to prevent infinite recursion */
    maxDepth?: number;
    /** Current depth (for recursion tracking) */
    currentDepth?: number;
    /** Whether to recursively process includes in included files */
    recursive?: boolean;
    /** File encoding (default: utf-8) */
    encoding?: BufferEncoding;
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Pattern for matching #+INCLUDE: directives
 * Groups: file, rest (block type, options)
 * Uses multiline flag for hasIncludes() to work with multi-line content
 */
const INCLUDE_PATTERN = /^#\+INCLUDE:\s*"([^"]+)"(.*)$/im;

/**
 * Parse a #+INCLUDE: line into structured directive
 */
export function parseIncludeDirective(line: string, lineNumber: number): IncludeDirective | null {
    const match = line.match(INCLUDE_PATTERN);
    if (!match) {
        return null;
    }

    const [, file, rest] = match;
    const directive: IncludeDirective = {
        raw: line,
        file,
        lineNumber,
    };

    // Parse the rest of the line for block type and options
    const restTrimmed = rest.trim();
    if (restTrimmed) {
        parseIncludeOptions(restTrimmed, directive);
    }

    return directive;
}

/**
 * Parse options from the include line
 */
function parseIncludeOptions(optionsStr: string, directive: IncludeDirective): void {
    // Tokenize the options string
    const tokens = tokenizeOptions(optionsStr);
    let i = 0;

    while (i < tokens.length) {
        const token = tokens[i];

        // Block type keywords
        if (token === 'src' && i + 1 < tokens.length && !tokens[i + 1].startsWith(':')) {
            directive.blockType = 'src';
            directive.language = tokens[i + 1];
            i += 2;
            continue;
        }

        if (token === 'example') {
            directive.blockType = 'example';
            i++;
            continue;
        }

        if (token === 'quote') {
            directive.blockType = 'quote';
            i++;
            continue;
        }

        if (token === 'export' && i + 1 < tokens.length) {
            directive.blockType = 'export';
            directive.exportFormat = tokens[i + 1];
            i += 2;
            continue;
        }

        // Options with :keyword value format
        if (token === ':lines' && i + 1 < tokens.length) {
            directive.lines = parseLineRange(tokens[i + 1]);
            i += 2;
            continue;
        }

        if (token === ':minlevel' && i + 1 < tokens.length) {
            const level = parseInt(tokens[i + 1], 10);
            if (!isNaN(level) && level > 0) {
                directive.minLevel = level;
            }
            i += 2;
            continue;
        }

        if (token === ':only-contents') {
            // Check for explicit t/nil value
            if (i + 1 < tokens.length && (tokens[i + 1] === 't' || tokens[i + 1] === 'nil')) {
                directive.onlyContents = tokens[i + 1] === 't';
                i += 2;
            } else {
                directive.onlyContents = true;
                i++;
            }
            continue;
        }

        i++;
    }
}

/**
 * Tokenize options string, handling quoted strings
 */
function tokenizeOptions(str: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];

        if (char === '"') {
            if (inQuotes) {
                // End of quoted string
                tokens.push(current);
                current = '';
                inQuotes = false;
            } else {
                // Start of quoted string
                if (current) {
                    tokens.push(current);
                    current = '';
                }
                inQuotes = true;
            }
        } else if (char === ' ' && !inQuotes) {
            if (current) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }

    if (current) {
        tokens.push(current);
    }

    return tokens;
}

/**
 * Parse a line range string like "10-20" or "-5" or "10-"
 */
function parseLineRange(str: string): { start?: number; end?: number } {
    const range: { start?: number; end?: number } = {};

    // Remove quotes if present
    const cleaned = str.replace(/"/g, '');

    if (cleaned.includes('-')) {
        const [startStr, endStr] = cleaned.split('-');
        if (startStr) {
            const start = parseInt(startStr, 10);
            if (!isNaN(start)) range.start = start;
        }
        if (endStr) {
            const end = parseInt(endStr, 10);
            if (!isNaN(end)) range.end = end;
        }
    } else {
        // Single line number
        const num = parseInt(cleaned, 10);
        if (!isNaN(num)) {
            range.start = num;
            range.end = num;
        }
    }

    return range;
}

// =============================================================================
// File Processing
// =============================================================================

/**
 * Process an include directive and return the content
 */
export function processInclude(
    directive: IncludeDirective,
    options: IncludeOptions
): IncludeResult {
    const maxDepth = options.maxDepth ?? 10;
    const currentDepth = options.currentDepth ?? 0;

    // Check recursion depth
    if (currentDepth >= maxDepth) {
        return {
            success: false,
            content: `[INCLUDE ERROR: Maximum include depth (${maxDepth}) exceeded]`,
            directive,
            error: `Maximum include depth (${maxDepth}) exceeded`,
        };
    }

    // Resolve file path
    const resolvedPath = resolveIncludePath(directive.file, options.basePath);

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
        return {
            success: false,
            content: `[INCLUDE ERROR: File not found: ${directive.file}]`,
            directive,
            resolvedPath,
            error: `File not found: ${resolvedPath}`,
        };
    }

    try {
        // Read file content
        let content = fs.readFileSync(resolvedPath, options.encoding ?? 'utf-8');

        // Apply line range filter
        if (directive.lines) {
            content = applyLineRange(content, directive.lines);
        }

        // Apply minlevel transformation
        if (directive.minLevel) {
            content = applyMinLevel(content, directive.minLevel);
        }

        // Apply only-contents transformation
        if (directive.onlyContents) {
            content = applyOnlyContents(content);
        }

        // Recursively process includes in included content
        if (options.recursive !== false) {
            content = processIncludes(content, {
                ...options,
                basePath: path.dirname(resolvedPath),
                currentDepth: currentDepth + 1,
            });
        }

        // Wrap in block if specified
        content = wrapInBlock(content, directive);

        return {
            success: true,
            content,
            directive,
            resolvedPath,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            content: `[INCLUDE ERROR: ${errorMessage}]`,
            directive,
            resolvedPath,
            error: errorMessage,
        };
    }
}

/**
 * Resolve include path relative to base path
 */
function resolveIncludePath(filePath: string, basePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    return path.resolve(basePath, filePath);
}

/**
 * Apply line range filter to content
 */
function applyLineRange(
    content: string,
    range: { start?: number; end?: number }
): string {
    const lines = content.split('\n');
    const start = (range.start ?? 1) - 1; // Convert to 0-indexed
    const end = range.end ?? lines.length;

    return lines.slice(start, end).join('\n');
}

/**
 * Apply minlevel transformation - shift all headlines to minimum level
 */
function applyMinLevel(content: string, minLevel: number): string {
    const lines = content.split('\n');
    let currentMinLevel: number | null = null;

    // First pass: find the minimum headline level in the content
    for (const line of lines) {
        const match = line.match(/^(\*+)\s/);
        if (match) {
            const level = match[1].length;
            if (currentMinLevel === null || level < currentMinLevel) {
                currentMinLevel = level;
            }
        }
    }

    if (currentMinLevel === null) {
        // No headlines found
        return content;
    }

    // Calculate level shift
    const shift = minLevel - currentMinLevel;
    if (shift === 0) {
        return content;
    }

    // Second pass: adjust headline levels
    return lines.map(line => {
        const match = line.match(/^(\*+)(\s.*)/);
        if (match) {
            const newLevel = Math.max(1, match[1].length + shift);
            return '*'.repeat(newLevel) + match[2];
        }
        return line;
    }).join('\n');
}

/**
 * Apply only-contents transformation - remove first headline, keep rest
 */
function applyOnlyContents(content: string): string {
    const lines = content.split('\n');
    let foundFirst = false;
    let firstLevel = 0;
    const result: string[] = [];

    for (const line of lines) {
        const match = line.match(/^(\*+)\s/);

        if (!foundFirst) {
            if (match) {
                // Found first headline - skip it
                foundFirst = true;
                firstLevel = match[1].length;
            }
            // Skip lines before first headline too
            continue;
        }

        // After first headline, include everything until a headline of same/lower level
        if (match && match[1].length <= firstLevel) {
            break;
        }

        result.push(line);
    }

    return result.join('\n');
}

/**
 * Wrap content in specified block type
 */
function wrapInBlock(content: string, directive: IncludeDirective): string {
    if (!directive.blockType) {
        return content;
    }

    switch (directive.blockType) {
        case 'src':
            return `#+BEGIN_SRC ${directive.language || ''}\n${content}\n#+END_SRC`;

        case 'example':
            return `#+BEGIN_EXAMPLE\n${content}\n#+END_EXAMPLE`;

        case 'quote':
            return `#+BEGIN_QUOTE\n${content}\n#+END_QUOTE`;

        case 'export':
            return `#+BEGIN_EXPORT ${directive.exportFormat || ''}\n${content}\n#+END_EXPORT`;

        default:
            return content;
    }
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Find all #+INCLUDE: directives in content
 */
export function findIncludes(content: string): IncludeDirective[] {
    const directives: IncludeDirective[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const directive = parseIncludeDirective(lines[i], i + 1);
        if (directive) {
            directives.push(directive);
        }
    }

    return directives;
}

/**
 * Process all #+INCLUDE: directives in content, replacing them with included content
 * This is the main entry point for include processing
 */
export function processIncludes(content: string, options: IncludeOptions): string {
    const lines = content.split('\n');
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const directive = parseIncludeDirective(lines[i], i + 1);

        if (directive) {
            const includeResult = processInclude(directive, options);
            // Replace the #+INCLUDE: line with the processed content
            result.push(includeResult.content);
        } else {
            result.push(lines[i]);
        }
    }

    return result.join('\n');
}

/**
 * Check if content has any #+INCLUDE: directives
 */
export function hasIncludes(content: string): boolean {
    return INCLUDE_PATTERN.test(content);
}
