/**
 * Unified citation parser supporting multiple citation syntaxes:
 * - org-ref v2: cite:key1,key2
 * - org-ref v3: cite:&key1;&key2 (with optional pre/post notes)
 * - org-cite: [cite:@key1;@key2] (with optional style and notes)
 * - LaTeX: \cite{key1,key2}
 */

import {
    CitationSyntax,
    CitationCommand,
    CitationReference,
    ParsedCitation,
    ALL_CITATION_COMMANDS,
    ORG_CITE_STYLE_MAP,
    CITATION_PATTERN_CONFIG,
} from './citationTypes';

/**
 * Regular expressions for matching citations
 */
const PATTERNS = {
    // org-cite: [cite:@key] or [cite/style:prefix;@key suffix;]
    'org-cite': /\[cite(?:\/([a-zA-Z]+))?:([^\]]+)\]/g,

    // LaTeX: \cite{key} or \citep[pre][post]{key}
    'latex': /\\(cite[a-z]*)\*?(?:\[([^\]]*)\])?(?:\[([^\]]*)\])?\{([^}]+)\}/g,

    // org-ref (v2 or v3) - we'll distinguish based on content
    // Matches cite:... up to end of citation (space + word boundary or end of line)
    'org-ref': new RegExp(
        `(${ALL_CITATION_COMMANDS.join('|')}):([^\\s\\[\\]]+(?:\\s+[^\\s\\[\\]]+)*)`,
        'g'
    ),
};

/**
 * Parse all citations from a line of text
 */
export function parseCitationsFromLine(line: string): ParsedCitation[] {
    const citations: ParsedCitation[] = [];

    // org-cite (most specific due to brackets)
    citations.push(...parseOrgCiteCitations(line));

    // LaTeX
    citations.push(...parseLatexCitations(line));

    // org-ref (v2 and v3) - skip positions already matched
    const matchedRanges = citations.map(c => c.range);
    citations.push(...parseOrgRefCitations(line, matchedRanges));

    // Sort by position
    citations.sort((a, b) => a.range.start - b.range.start);

    return citations;
}

/**
 * Parse org-ref citations (both v2 and v3)
 * v2: cite:key1,key2 (comma-separated, no prefix)
 * v3: cite:&key1;&key2 (semicolon-separated, & prefix)
 */
function parseOrgRefCitations(
    line: string,
    excludeRanges: Array<{ start: number; end: number }> = []
): ParsedCitation[] {
    const citations: ParsedCitation[] = [];

    // Find all citation command starts
    const commandPattern = new RegExp(
        `(${ALL_CITATION_COMMANDS.join('|')}):`,
        'g'
    );

    let commandMatch;
    while ((commandMatch = commandPattern.exec(line)) !== null) {
        const start = commandMatch.index;

        // Skip if within an excluded range
        if (excludeRanges.some(r => start >= r.start && start < r.end)) {
            continue;
        }

        const command = commandMatch[1] as CitationCommand;
        const contentStart = start + commandMatch[0].length;
        const remainingLine = line.slice(contentStart);

        // Determine if this is v3 (starts with & or has prefix before &) or v2
        // v3 must have & appearing before any comma or significant word boundary
        // v2: cite:key1,key2 - starts with alphanumeric, uses commas
        // v3: cite:&key or cite:prefix;&key - has & before keys

        // First, try to match v2 pattern (simple keys without &)
        const v2Match = remainingLine.match(/^([a-zA-Z0-9_][a-zA-Z0-9_:,-]*)(?!\S*&)/);

        // Check if the match contains & (which would make it v3)
        const hasAmpersand = v2Match && v2Match[1].includes('&');

        // Also check if line starts with & directly (v3 without prefix)
        const startsWithAmpersand = /^&/.test(remainingLine);

        // Check if there's an & before the next space-separated word
        // This handles "cite:prefix;&key" vs "cite:key and cite:&other"
        const firstSegment = remainingLine.split(/\s+/)[0];
        const segmentHasAmpersand = firstSegment.includes('&');

        let content: string;
        let end: number;

        if (startsWithAmpersand || segmentHasAmpersand || hasAmpersand) {
            // v3 citation
            // Find where this citation ends - look for patterns that indicate end
            // v3 content includes everything with & keys and any trailing suffix after last ;
            let v3Content = '';

            // Strategy: Take content until we hit a boundary that indicates end of citation
            // Boundaries: double space, next citation command, [, \, end of line
            // But include single-space separated words if they look like part of the citation

            // Find potential end points
            const nextCiteMatch = remainingLine.match(/\s+(cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt|citenum):/i);
            const nextBracket = remainingLine.indexOf('[');
            const nextBackslash = remainingLine.indexOf('\\');
            const doubleSpace = remainingLine.search(/\s{2,}/);

            // Find the minimum positive boundary
            const boundaries: number[] = [
                nextCiteMatch?.index ?? -1,
                nextBracket,
                nextBackslash,
                doubleSpace,
            ].filter((b): b is number => b > 0);

            let endPos = boundaries.length > 0 ? Math.min(...boundaries) : remainingLine.length;

            // Take content up to the boundary
            v3Content = remainingLine.slice(0, endPos);

            // Clean up: remove trailing punctuation and standalone "and", "or" connectors at the end
            v3Content = v3Content.replace(/\s+(and|or)\s*$/i, '');
            v3Content = v3Content.replace(/[.!?]+$/, '');  // Keep ; and , as they might be part of citation
            v3Content = v3Content.trim();

            if (v3Content) {
                end = contentStart + v3Content.length;
                const parsed = parseNotesAndKeys(v3Content, '&', ';');

                if (parsed.references.length > 0) {
                    citations.push({
                        syntax: 'org-ref-v3',
                        command,
                        references: parsed.references,
                        commonPrefix: parsed.commonPrefix,
                        commonSuffix: parsed.commonSuffix,
                        raw: line.slice(start, end),
                        range: { start, end },
                    });
                }
            }
        } else if (v2Match) {
            // v2: simple comma-separated keys
            content = v2Match[1];
            end = contentStart + content.length;

            const keys = content.split(',').map(k => k.trim()).filter(k => k);

            if (keys.length > 0) {
                citations.push({
                    syntax: 'org-ref-v2',
                    command,
                    references: keys.map(key => ({ key })),
                    raw: line.slice(start, end),
                    range: { start, end },
                });
            }
        }
    }

    return citations;
}

/**
 * Parse org-cite citations: [cite:@key] or [cite/style:@key]
 */
function parseOrgCiteCitations(line: string): ParsedCitation[] {
    const citations: ParsedCitation[] = [];
    const regex = new RegExp(PATTERNS['org-cite'].source, 'g');
    let match;

    while ((match = regex.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const style = match[1]; // may be undefined
        const content = match[2];

        const parsed = parseNotesAndKeys(content, '@', ';');

        // Map style to command
        let command: CitationCommand | string = 'cite';
        if (style && ORG_CITE_STYLE_MAP[style]) {
            command = ORG_CITE_STYLE_MAP[style];
        }

        citations.push({
            syntax: 'org-cite',
            command,
            style,
            references: parsed.references,
            commonPrefix: parsed.commonPrefix,
            commonSuffix: parsed.commonSuffix,
            raw: match[0],
            range: { start, end },
        });
    }

    return citations;
}

/**
 * Parse LaTeX citations: \cite{key} or \citep[pre][post]{key}
 */
function parseLatexCitations(line: string): ParsedCitation[] {
    const citations: ParsedCitation[] = [];
    const regex = new RegExp(PATTERNS['latex'].source, 'g');
    let match;

    while ((match = regex.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const command = match[1] as CitationCommand;
        const pre = match[2];  // first optional bracket
        const post = match[3]; // second optional bracket
        const keysStr = match[4];

        const keys = keysStr.split(',').map(k => k.trim()).filter(k => k);

        // LaTeX citation notes:
        // \cite[post]{key} - one bracket is postnote
        // \cite[pre][post]{key} - two brackets are prenote and postnote
        let commonPrefix: string | undefined;
        let commonSuffix: string | undefined;

        if (pre !== undefined && post !== undefined) {
            commonPrefix = pre;
            commonSuffix = post;
        } else if (pre !== undefined) {
            // Single bracket is postnote in natbib
            commonSuffix = pre;
        }

        citations.push({
            syntax: 'latex',
            command,
            references: keys.map(key => ({ key })),
            commonPrefix,
            commonSuffix,
            raw: match[0],
            range: { start, end },
        });
    }

    return citations;
}

/**
 * Parse content with pre/post notes and keys
 * Used for both org-ref v3 and org-cite
 *
 * Format: common-prefix;prenote1 KEY1 postnote1;prenote2 KEY2 postnote2;common-suffix
 * Where KEY is prefixed by keyPrefix (& or @)
 */
function parseNotesAndKeys(
    content: string,
    keyPrefix: string,
    separator: string
): {
    references: CitationReference[];
    commonPrefix?: string;
    commonSuffix?: string;
} {
    const references: CitationReference[] = [];
    let commonPrefix: string | undefined;
    let commonSuffix: string | undefined;

    // Split by separator
    const parts = content.split(separator).map(p => p.trim());

    // Find which parts contain keys (have the keyPrefix)
    const partsWithKeys: number[] = [];
    parts.forEach((part, i) => {
        if (part.includes(keyPrefix)) {
            partsWithKeys.push(i);
        }
    });

    if (partsWithKeys.length === 0) {
        // No keys found, treat entire content as a single key (fallback)
        return {
            references: [{ key: content.trim() }],
        };
    }

    // Parts before first key part = common prefix
    const firstKeyPart = partsWithKeys[0];
    if (firstKeyPart > 0) {
        commonPrefix = parts.slice(0, firstKeyPart).join(separator).trim();
    }

    // Parts after last key part = common suffix
    const lastKeyPart = partsWithKeys[partsWithKeys.length - 1];
    if (lastKeyPart < parts.length - 1) {
        commonSuffix = parts.slice(lastKeyPart + 1).join(separator).trim();
    }

    // Parse each key part
    for (const i of partsWithKeys) {
        const part = parts[i];
        const ref = parseKeyWithNotes(part, keyPrefix);
        if (ref) {
            references.push(ref);
        }
    }

    return {
        references,
        commonPrefix: commonPrefix || undefined,
        commonSuffix: commonSuffix || undefined,
    };
}

/**
 * Parse a single reference with optional pre/post notes
 * Format: "prenote KEY postnote" where KEY starts with keyPrefix
 */
function parseKeyWithNotes(part: string, keyPrefix: string): CitationReference | null {
    // Find the key (starts with keyPrefix)
    const keyMatch = new RegExp(`${escapeRegex(keyPrefix)}([a-zA-Z0-9_][a-zA-Z0-9_:-]*)`).exec(part);

    if (!keyMatch) {
        return null;
    }

    const key = keyMatch[1];
    const keyStart = keyMatch.index;
    const keyEnd = keyStart + keyMatch[0].length;

    // Text before key = prefix (prenote)
    const prefix = part.slice(0, keyStart).trim() || undefined;

    // Text after key = suffix (postnote)
    const suffix = part.slice(keyEnd).trim() || undefined;

    return { key, prefix, suffix };
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find citation at a specific position in the line
 */
export function findCitationAtPosition(line: string, position: number): ParsedCitation | null {
    const citations = parseCitationsFromLine(line);

    for (const citation of citations) {
        if (position >= citation.range.start && position <= citation.range.end) {
            return citation;
        }
    }

    return null;
}

/**
 * Find which reference index the cursor is on within a citation
 */
export function findReferenceIndexAtPosition(
    citation: ParsedCitation,
    line: string,
    position: number
): number {
    const { keyPrefix } = CITATION_PATTERN_CONFIG[citation.syntax];
    const citationText = line.slice(citation.range.start, citation.range.end);
    const relativePos = position - citation.range.start;

    // Find positions of each key in the citation text
    let searchPos = 0;
    for (let i = 0; i < citation.references.length; i++) {
        const ref = citation.references[i];
        const keyPattern = keyPrefix ? `${keyPrefix}${ref.key}` : ref.key;
        const keyIndex = citationText.indexOf(keyPattern, searchPos);

        if (keyIndex === -1) continue;

        const keyEnd = keyIndex + keyPattern.length;

        // Check if cursor is before next key
        if (i === citation.references.length - 1 || relativePos <= keyEnd + 5) {
            if (relativePos >= keyIndex - 5) {
                return i;
            }
        }

        searchPos = keyEnd;
    }

    return citation.references.length - 1;
}

/**
 * Rebuild a citation string from its parsed components
 */
export function rebuildCitation(citation: ParsedCitation): string {
    const { keyPrefix, separator, hasBrackets } = CITATION_PATTERN_CONFIG[citation.syntax];

    switch (citation.syntax) {
        case 'org-ref-v2': {
            const keys = citation.references.map(r => r.key).join(',');
            return `${citation.command}:${keys}`;
        }

        case 'org-ref-v3': {
            const parts: string[] = [];
            if (citation.commonPrefix) {
                parts.push(citation.commonPrefix);
            }
            for (const ref of citation.references) {
                let refStr = `&${ref.key}`;
                if (ref.prefix) refStr = `${ref.prefix} ${refStr}`;
                if (ref.suffix) refStr = `${refStr} ${ref.suffix}`;
                parts.push(refStr);
            }
            if (citation.commonSuffix) {
                parts.push(citation.commonSuffix);
            }
            return `${citation.command}:${parts.join(';')}`;
        }

        case 'org-cite': {
            const parts: string[] = [];
            if (citation.commonPrefix) {
                parts.push(citation.commonPrefix);
            }
            for (const ref of citation.references) {
                let refStr = `@${ref.key}`;
                if (ref.prefix) refStr = `${ref.prefix} ${refStr}`;
                if (ref.suffix) refStr = `${refStr} ${ref.suffix}`;
                parts.push(refStr);
            }
            if (citation.commonSuffix) {
                parts.push(citation.commonSuffix);
            }
            const style = citation.style ? `/${citation.style}` : '';
            return `[cite${style}:${parts.join(';')}]`;
        }

        case 'latex': {
            const keys = citation.references.map(r => r.key).join(',');
            let result = `\\${citation.command}`;
            if (citation.commonPrefix && citation.commonSuffix) {
                result += `[${citation.commonPrefix}][${citation.commonSuffix}]`;
            } else if (citation.commonSuffix) {
                result += `[${citation.commonSuffix}]`;
            }
            result += `{${keys}}`;
            return result;
        }

        default:
            return citation.raw;
    }
}

/**
 * Convert a citation from one syntax to another
 */
export function convertCitationSyntax(
    citation: ParsedCitation,
    targetSyntax: CitationSyntax
): string {
    const converted: ParsedCitation = {
        ...citation,
        syntax: targetSyntax,
    };

    // Handle command mapping for org-cite
    if (targetSyntax === 'org-cite') {
        // Find the style that maps to this command
        for (const [style, cmd] of Object.entries(ORG_CITE_STYLE_MAP)) {
            if (cmd === citation.command) {
                converted.style = style;
                break;
            }
        }
    }

    return rebuildCitation(converted);
}

/**
 * Extract just the citation keys from a line (for quick lookups)
 */
export function extractCitationKeys(line: string): string[] {
    const citations = parseCitationsFromLine(line);
    const keys: string[] = [];

    for (const citation of citations) {
        for (const ref of citation.references) {
            if (!keys.includes(ref.key)) {
                keys.push(ref.key);
            }
        }
    }

    return keys;
}

/**
 * Check if a string looks like it contains any citation
 */
export function containsCitation(text: string): boolean {
    // Quick checks before running full parsing
    if (text.includes('cite:') || text.includes('[cite') || text.includes('\\cite')) {
        return parseCitationsFromLine(text).length > 0;
    }
    return false;
}

/**
 * Get the citation style/command in a normalized form
 */
export function getNormalizedStyle(citation: ParsedCitation): 'textual' | 'parenthetical' | 'author' | 'year' | 'numeric' {
    const cmd = citation.command.toLowerCase();

    if (cmd.includes('author')) return 'author';
    if (cmd.includes('year')) return 'year';
    if (cmd.includes('num')) return 'numeric';
    if (cmd === 'citet' || cmd === 'citealt') return 'textual';

    return 'parenthetical';
}
