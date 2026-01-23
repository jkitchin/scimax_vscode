/**
 * Unified citation types for supporting multiple citation syntaxes:
 * - org-ref v2 (legacy): cite:key1,key2
 * - org-ref v3 (current): cite:&key1;&key2
 * - org-cite (org 9.5+): [cite:@key1;@key2]
 * - LaTeX: \cite{key1,key2}
 */

/**
 * Citation syntax variants
 */
export type CitationSyntax = 'org-ref-v2' | 'org-ref-v3' | 'org-cite' | 'latex';

/**
 * Citation command types (maps to natbib/biblatex commands)
 */
export type CitationCommand =
    | 'cite'
    | 'citet'
    | 'citep'
    | 'citeauthor'
    | 'citeyear'
    | 'citealp'
    | 'citealt'
    | 'citenum'
    | 'Cite'
    | 'Citet'
    | 'Citep'
    | 'Citeauthor'
    | 'Citeyear';

/**
 * A single reference within a citation (may have individual pre/post notes)
 */
export interface CitationReference {
    /** The BibTeX key */
    key: string;
    /** Prenote for this specific reference (e.g., "see" in "see Smith") */
    prefix?: string;
    /** Postnote for this specific reference (e.g., "p. 42") */
    suffix?: string;
}

/**
 * A fully parsed citation with all metadata
 */
export interface ParsedCitation {
    /** Which syntax variant was detected */
    syntax: CitationSyntax;
    /** The citation command (cite, citet, citep, etc.) */
    command: CitationCommand | string;
    /** Style variant for org-cite (t, p, a, etc.) */
    style?: string;
    /** Individual references with their notes */
    references: CitationReference[];
    /** Common prefix for the entire citation */
    commonPrefix?: string;
    /** Common suffix for the entire citation */
    commonSuffix?: string;
    /** Original raw text of the citation */
    raw: string;
    /** Position in the source text */
    range: {
        start: number;
        end: number;
    };
}

/**
 * Maps org-cite style suffixes to org-ref/natbib commands
 */
export const ORG_CITE_STYLE_MAP: Record<string, CitationCommand> = {
    // Basic styles
    't': 'citet',           // textual: Author (Year)
    'text': 'citet',
    'p': 'citep',           // parenthetical: (Author, Year)
    'paren': 'citep',

    // Author/year only
    'a': 'citeauthor',      // author only
    'author': 'citeauthor',
    'y': 'citeyear',        // year only
    'year': 'citeyear',

    // Alternative formats
    'na': 'citealp',        // no author parentheses: Author, Year
    'noauthor': 'citealp',
    'n': 'citenum',         // numeric
    'num': 'citenum',

    // Capitalized variants (for sentence start)
    'ct': 'Citet',
    'cp': 'Citep',
    'ca': 'Citeauthor',
};

/**
 * Maps org-ref commands to citation styles for export
 */
export const COMMAND_TO_STYLE: Record<string, 'textual' | 'parenthetical' | 'author' | 'year' | 'numeric'> = {
    'cite': 'parenthetical',
    'citep': 'parenthetical',
    'Citep': 'parenthetical',
    'citet': 'textual',
    'Citet': 'textual',
    'citeauthor': 'author',
    'Citeauthor': 'author',
    'citeyear': 'year',
    'Citeyear': 'year',
    'citenum': 'numeric',
    'citealp': 'parenthetical',  // author list, parenthetical (no outer parens)
    'citealt': 'textual',        // author list, textual
};

/**
 * Default citation commands for each syntax when inserting new citations
 */
export const DEFAULT_COMMANDS: Record<CitationSyntax, string> = {
    'org-ref-v2': 'cite',
    'org-ref-v3': 'cite',
    'org-cite': 'cite',
    'latex': 'cite',
};

/**
 * Configuration for citation pattern matching
 */
export interface CitationPatternConfig {
    /** Key prefix character (empty, &, or @) */
    keyPrefix: string;
    /** Separator between keys/references */
    separator: string;
    /** Whether this syntax supports pre/post notes */
    hasNotes: boolean;
    /** Whether citations are wrapped in brackets */
    hasBrackets: boolean;
}

/**
 * Pattern configurations for each syntax
 */
export const CITATION_PATTERN_CONFIG: Record<CitationSyntax, CitationPatternConfig> = {
    'org-ref-v2': {
        keyPrefix: '',
        separator: ',',
        hasNotes: false,
        hasBrackets: false,
    },
    'org-ref-v3': {
        keyPrefix: '&',
        separator: ';',
        hasNotes: true,
        hasBrackets: false,
    },
    'org-cite': {
        keyPrefix: '@',
        separator: ';',
        hasNotes: true,
        hasBrackets: true,
    },
    'latex': {
        keyPrefix: '',
        separator: ',',
        hasNotes: true,
        hasBrackets: false,
    },
};

/**
 * All supported citation commands (for regex matching)
 */
export const ALL_CITATION_COMMANDS = [
    'cite',
    'citet',
    'citep',
    'citeauthor',
    'citeyear',
    'citealp',
    'citealt',
    'citenum',
    'Cite',
    'Citet',
    'Citep',
    'Citeauthor',
    'Citeyear',
];

/**
 * Check if a command is a capitalized variant (for sentence-initial use)
 */
export function isCapitalizedCommand(command: string): boolean {
    return /^[A-Z]/.test(command);
}

/**
 * Get the base command (lowercase) for a potentially capitalized command
 */
export function getBaseCommand(command: string): string {
    return command.toLowerCase();
}

/**
 * Check if two citations are equivalent (same keys, possibly different syntax)
 */
export function citationsEqual(a: ParsedCitation, b: ParsedCitation): boolean {
    if (a.references.length !== b.references.length) return false;
    return a.references.every((ref, i) => ref.key === b.references[i].key);
}
