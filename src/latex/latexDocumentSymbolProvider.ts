/**
 * LaTeX Document Symbol Provider
 * Provides outline/structure view for LaTeX documents
 */

import * as vscode from 'vscode';

// LaTeX section commands in order of hierarchy (lower index = higher level)
const LATEX_SECTION_HIERARCHY: string[] = [
    'part',
    'chapter',
    'section',
    'subsection',
    'subsubsection',
    'paragraph',
    'subparagraph'
];

export function getSectionLevel(sectionType: string): number {
    const index = LATEX_SECTION_HIERARCHY.indexOf(sectionType);
    return index >= 0 ? index : 2; // Default to section level
}

export function getSectionTypeAtLevel(level: number): string {
    if (level < 0) return LATEX_SECTION_HIERARCHY[0];
    if (level >= LATEX_SECTION_HIERARCHY.length) {
        return LATEX_SECTION_HIERARCHY[LATEX_SECTION_HIERARCHY.length - 1];
    }
    return LATEX_SECTION_HIERARCHY[level];
}

export interface LaTeXSection {
    type: string;
    level: number;
    title: string;
    line: number;
    starred: boolean;
    shortTitle?: string;
}

export interface LaTeXEnvironment {
    name: string;
    line: number;
    endLine: number;
    label?: string;
    caption?: string;
}

export interface LaTeXLabel {
    name: string;
    line: number;
    context?: string; // section or environment it's in
}

// Cache for parsed documents
interface CacheEntry {
    version: number;
    symbols: vscode.DocumentSymbol[];
    sections: LaTeXSection[];
    environments: LaTeXEnvironment[];
    labels: LaTeXLabel[];
}

const documentCache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 10;

/**
 * Parse a LaTeX document and extract sections, environments, and labels
 */
export function parseLatexDocument(document: vscode.TextDocument): {
    sections: LaTeXSection[];
    environments: LaTeXEnvironment[];
    labels: LaTeXLabel[];
} {
    const text = document.getText();
    const lines = text.split('\n');

    const sections: LaTeXSection[] = [];
    const environments: LaTeXEnvironment[] = [];
    const labels: LaTeXLabel[] = [];

    // Regex patterns
    const sectionPattern = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*)?\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/;
    const beginEnvPattern = /^\s*\\begin\{(\w+)\}/;
    const endEnvPattern = /^\s*\\end\{(\w+)\}/;
    const labelPattern = /\\label\{([^}]+)\}/;
    const captionPattern = /\\caption(?:\[[^\]]*\])?\{([^}]*)\}/;

    // Track open environments
    const envStack: { name: string; line: number; label?: string; caption?: string }[] = [];
    let currentSection: LaTeXSection | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for sections
        const sectionMatch = line.match(sectionPattern);
        if (sectionMatch) {
            const [, type, starred, shortTitle, title] = sectionMatch;
            currentSection = {
                type,
                level: getSectionLevel(type),
                title: title.trim(),
                line: i,
                starred: !!starred,
                shortTitle: shortTitle?.trim()
            };
            sections.push(currentSection);
        }

        // Check for begin environment
        const beginMatch = line.match(beginEnvPattern);
        if (beginMatch) {
            envStack.push({
                name: beginMatch[1],
                line: i
            });
        }

        // Check for labels
        const labelMatch = line.match(labelPattern);
        if (labelMatch) {
            const label: LaTeXLabel = {
                name: labelMatch[1],
                line: i
            };

            // Associate with current environment or section
            if (envStack.length > 0) {
                const currentEnv = envStack[envStack.length - 1];
                currentEnv.label = labelMatch[1];
                label.context = currentEnv.name;
            } else if (currentSection) {
                label.context = `${currentSection.type}: ${currentSection.title}`;
            }

            labels.push(label);
        }

        // Check for captions (in environments)
        const captionMatch = line.match(captionPattern);
        if (captionMatch && envStack.length > 0) {
            envStack[envStack.length - 1].caption = captionMatch[1].trim();
        }

        // Check for end environment
        const endMatch = line.match(endEnvPattern);
        if (endMatch && envStack.length > 0) {
            const envName = endMatch[1];
            // Find matching begin
            for (let j = envStack.length - 1; j >= 0; j--) {
                if (envStack[j].name === envName) {
                    const env = envStack.splice(j, 1)[0];
                    environments.push({
                        name: env.name,
                        line: env.line,
                        endLine: i,
                        label: env.label,
                        caption: env.caption
                    });
                    break;
                }
            }
        }
    }

    return { sections, environments, labels };
}

/**
 * Get all sections from a document (with caching)
 */
export function getSections(document: vscode.TextDocument): LaTeXSection[] {
    const cached = documentCache.get(document.uri.toString());
    if (cached && cached.version === document.version) {
        return cached.sections;
    }

    const { sections, environments, labels } = parseLatexDocument(document);

    // Update cache
    if (documentCache.size >= CACHE_LIMIT) {
        const firstKey = documentCache.keys().next().value;
        if (firstKey) {
            documentCache.delete(firstKey);
        }
    }

    documentCache.set(document.uri.toString(), {
        version: document.version,
        symbols: [], // Will be populated by symbol provider
        sections,
        environments,
        labels
    });

    return sections;
}

/**
 * Get all environments from a document
 */
export function getEnvironments(document: vscode.TextDocument): LaTeXEnvironment[] {
    const cached = documentCache.get(document.uri.toString());
    if (cached && cached.version === document.version) {
        return cached.environments;
    }

    const { sections, environments, labels } = parseLatexDocument(document);

    // Update cache
    if (documentCache.size >= CACHE_LIMIT) {
        const firstKey = documentCache.keys().next().value;
        if (firstKey) {
            documentCache.delete(firstKey);
        }
    }

    documentCache.set(document.uri.toString(), {
        version: document.version,
        symbols: [],
        sections,
        environments,
        labels
    });

    return environments;
}

/**
 * Get all labels from a document
 */
export function getLabels(document: vscode.TextDocument): LaTeXLabel[] {
    const cached = documentCache.get(document.uri.toString());
    if (cached && cached.version === document.version) {
        return cached.labels;
    }

    const { sections, environments, labels } = parseLatexDocument(document);

    // Update cache
    if (documentCache.size >= CACHE_LIMIT) {
        const firstKey = documentCache.keys().next().value;
        if (firstKey) {
            documentCache.delete(firstKey);
        }
    }

    documentCache.set(document.uri.toString(), {
        version: document.version,
        symbols: [],
        sections,
        environments,
        labels
    });

    return labels;
}

/**
 * Find the section containing a given line
 */
export function findSectionAtLine(document: vscode.TextDocument, line: number): LaTeXSection | undefined {
    const sections = getSections(document);
    let currentSection: LaTeXSection | undefined;

    for (const section of sections) {
        if (section.line <= line) {
            currentSection = section;
        } else {
            break;
        }
    }

    return currentSection;
}

/**
 * Get symbol kind for section type
 */
function getSymbolKindForSection(type: string): vscode.SymbolKind {
    switch (type) {
        case 'part':
            return vscode.SymbolKind.Module;
        case 'chapter':
            return vscode.SymbolKind.Class;
        case 'section':
            return vscode.SymbolKind.Method;
        case 'subsection':
            return vscode.SymbolKind.Function;
        case 'subsubsection':
            return vscode.SymbolKind.Field;
        case 'paragraph':
        case 'subparagraph':
            return vscode.SymbolKind.Property;
        default:
            return vscode.SymbolKind.Field;
    }
}

/**
 * Get symbol kind for environment
 */
function getSymbolKindForEnvironment(name: string): vscode.SymbolKind {
    switch (name) {
        case 'figure':
        case 'figure*':
        case 'subfigure':
            return vscode.SymbolKind.File;
        case 'table':
        case 'table*':
        case 'tabular':
        case 'tabular*':
            return vscode.SymbolKind.Struct;
        case 'equation':
        case 'equation*':
        case 'align':
        case 'align*':
        case 'gather':
        case 'gather*':
        case 'multline':
        case 'multline*':
            return vscode.SymbolKind.Constant;
        case 'theorem':
        case 'lemma':
        case 'proposition':
        case 'corollary':
        case 'definition':
        case 'proof':
            return vscode.SymbolKind.Interface;
        case 'itemize':
        case 'enumerate':
        case 'description':
            return vscode.SymbolKind.Array;
        case 'verbatim':
        case 'lstlisting':
        case 'minted':
            return vscode.SymbolKind.String;
        default:
            return vscode.SymbolKind.Object;
    }
}

export class LaTeXDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] {
        const { sections, environments, labels } = parseLatexDocument(document);
        const symbols: vscode.DocumentSymbol[] = [];

        // Build hierarchical section symbols
        const sectionStack: { symbol: vscode.DocumentSymbol; level: number }[] = [];

        for (let i = 0; i < sections.length; i++) {
            if (token.isCancellationRequested) break;

            const section = sections[i];
            const nextSection = sections[i + 1];

            // Calculate range (from this section to next section or end of document)
            const startLine = section.line;
            const endLine = nextSection ? nextSection.line - 1 : document.lineCount - 1;

            const range = new vscode.Range(
                new vscode.Position(startLine, 0),
                new vscode.Position(endLine, document.lineAt(endLine).text.length)
            );

            const selectionRange = new vscode.Range(
                new vscode.Position(startLine, 0),
                new vscode.Position(startLine, document.lineAt(startLine).text.length)
            );

            const name = section.starred ? `${section.title}*` : section.title;
            const detail = section.shortTitle ? `[${section.shortTitle}]` : undefined;

            const symbol = new vscode.DocumentSymbol(
                name,
                detail || '',
                getSymbolKindForSection(section.type),
                range,
                selectionRange
            );

            // Find parent based on level
            while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= section.level) {
                sectionStack.pop();
            }

            if (sectionStack.length > 0) {
                sectionStack[sectionStack.length - 1].symbol.children.push(symbol);
            } else {
                symbols.push(symbol);
            }

            sectionStack.push({ symbol, level: section.level });
        }

        // Add important environments (figures, tables, equations with labels)
        const importantEnvTypes = new Set([
            'figure', 'figure*', 'table', 'table*',
            'equation', 'equation*', 'align', 'align*',
            'theorem', 'lemma', 'definition', 'proof',
            'lstlisting', 'minted'
        ]);

        for (const env of environments) {
            if (token.isCancellationRequested) break;

            // Only show environments with labels/captions or important types
            if (!env.label && !env.caption && !importantEnvTypes.has(env.name)) {
                continue;
            }

            const range = new vscode.Range(
                new vscode.Position(env.line, 0),
                new vscode.Position(env.endLine, document.lineAt(env.endLine).text.length)
            );

            const selectionRange = new vscode.Range(
                new vscode.Position(env.line, 0),
                new vscode.Position(env.line, document.lineAt(env.line).text.length)
            );

            let name = env.name;
            if (env.caption) {
                // Truncate long captions
                const maxLen = 40;
                name = env.caption.length > maxLen
                    ? env.caption.substring(0, maxLen) + '...'
                    : env.caption;
            } else if (env.label) {
                name = `[${env.label}]`;
            }

            const detail = env.label ? `\\label{${env.label}}` : env.name;

            const symbol = new vscode.DocumentSymbol(
                name,
                detail,
                getSymbolKindForEnvironment(env.name),
                range,
                selectionRange
            );

            // Find which section this environment belongs to
            let added = false;
            for (let i = sectionStack.length - 1; i >= 0; i--) {
                const sectionSymbol = sectionStack[i].symbol;
                if (sectionSymbol.range.contains(range)) {
                    sectionSymbol.children.push(symbol);
                    added = true;
                    break;
                }
            }

            if (!added) {
                symbols.push(symbol);
            }
        }

        // Add labels as symbols (useful for navigation)
        for (const label of labels) {
            if (token.isCancellationRequested) break;

            const line = document.lineAt(label.line);
            const range = new vscode.Range(
                new vscode.Position(label.line, 0),
                new vscode.Position(label.line, line.text.length)
            );

            const symbol = new vscode.DocumentSymbol(
                `\\label{${label.name}}`,
                label.context || '',
                vscode.SymbolKind.Key,
                range,
                range
            );

            // Don't add to top level - labels are nested in their context
            // This keeps the outline cleaner
        }

        // Update cache with symbols
        const cached = documentCache.get(document.uri.toString());
        if (cached) {
            cached.symbols = symbols;
        }

        return symbols;
    }
}

/**
 * Clear the document cache
 */
export function clearCache(): void {
    documentCache.clear();
}
