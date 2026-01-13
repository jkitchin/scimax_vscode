/**
 * Document Symbol Provider for org-mode
 * Uses a fast, lightweight headline-only parser for performance
 */

import * as vscode from 'vscode';

// =============================================================================
// Lightweight Headline Structure (no full AST needed)
// =============================================================================

interface LightHeadline {
    level: number;
    title: string;
    todoKeyword?: string;
    todoType?: 'todo' | 'done';
    priority?: string;
    tags: string[];
    lineNumber: number;
    endLineNumber: number;
    children: LightHeadline[];
}

interface LightBlock {
    type: 'src-block' | 'table' | 'drawer';
    name?: string;
    language?: string;
    lineNumber: number;
    endLineNumber: number;
}

// Simple cache for parsed documents
interface CacheEntry {
    version: number;
    symbols: vscode.DocumentSymbol[];
}

const parseCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 10;

// TODO keywords (could be made configurable)
const TODO_KEYWORDS = new Set(['TODO', 'NEXT', 'WAITING', 'HOLD', 'SOMEDAY']);
const DONE_KEYWORDS = new Set(['DONE', 'CANCELLED', 'CANCELED']);

/**
 * Fast, lightweight parser that only extracts headlines and blocks
 * Much faster than full AST parsing for document symbols
 */
function parseLightweight(lines: string[]): { headlines: LightHeadline[]; blocks: LightBlock[] } {
    const rootHeadlines: LightHeadline[] = [];
    const blocks: LightBlock[] = [];
    const headlineStack: LightHeadline[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        // Check for headline
        const headlineMatch = line.match(/^(\*+)\s+(.*)$/);
        if (headlineMatch) {
            const level = headlineMatch[1].length;
            const headline = parseHeadlineLine(headlineMatch[2], level, i);

            // Find end of this headline (next headline of same or higher level)
            let endLine = i + 1;
            while (endLine < lines.length) {
                const nextMatch = lines[endLine].match(/^(\*+)\s/);
                if (nextMatch && nextMatch[1].length <= level) {
                    break;
                }
                endLine++;
            }
            headline.endLineNumber = endLine - 1;

            // Build hierarchy
            while (headlineStack.length > 0 && headlineStack[headlineStack.length - 1].level >= level) {
                headlineStack.pop();
            }

            if (headlineStack.length === 0) {
                rootHeadlines.push(headline);
            } else {
                headlineStack[headlineStack.length - 1].children.push(headline);
            }
            headlineStack.push(headline);
            i++;
            continue;
        }

        // Check for source block (fast check)
        if (line.match(/^#\+BEGIN_SRC/i)) {
            const langMatch = line.match(/^#\+BEGIN_SRC\s+(\S+)/i);
            const nameMatch = lines[i - 1]?.match(/^#\+NAME:\s*(.+)$/i);
            let endLine = i + 1;
            while (endLine < lines.length && !lines[endLine].match(/^#\+END_SRC/i)) {
                endLine++;
            }
            blocks.push({
                type: 'src-block',
                language: langMatch?.[1] || 'code',
                name: nameMatch?.[1],
                lineNumber: i,
                endLineNumber: endLine,
            });
            i = endLine + 1;
            continue;
        }

        // Check for table (fast check)
        if (line.match(/^\s*\|/)) {
            const startLine = i;
            while (i < lines.length && lines[i].match(/^\s*\|/)) {
                i++;
            }
            blocks.push({
                type: 'table',
                lineNumber: startLine,
                endLineNumber: i - 1,
            });
            continue;
        }

        // Check for drawer (fast check)
        const drawerMatch = line.match(/^:(\w+):\s*$/);
        if (drawerMatch && drawerMatch[1] !== 'END' && drawerMatch[1] !== 'PROPERTIES') {
            const startLine = i;
            i++;
            while (i < lines.length && lines[i].trim() !== ':END:') {
                i++;
            }
            blocks.push({
                type: 'drawer',
                name: drawerMatch[1],
                lineNumber: startLine,
                endLineNumber: i,
            });
            i++;
            continue;
        }

        i++;
    }

    return { headlines: rootHeadlines, blocks };
}

/**
 * Parse a single headline line (very fast)
 */
function parseHeadlineLine(text: string, level: number, lineNumber: number): LightHeadline {
    let title = text;
    let todoKeyword: string | undefined;
    let todoType: 'todo' | 'done' | undefined;
    let priority: string | undefined;
    const tags: string[] = [];

    // Extract TODO keyword (first word)
    const todoMatch = title.match(/^(\S+)\s+/);
    if (todoMatch) {
        const word = todoMatch[1];
        if (TODO_KEYWORDS.has(word)) {
            todoKeyword = word;
            todoType = 'todo';
            title = title.slice(todoMatch[0].length);
        } else if (DONE_KEYWORDS.has(word)) {
            todoKeyword = word;
            todoType = 'done';
            title = title.slice(todoMatch[0].length);
        }
    }

    // Extract priority [#A]
    const priorityMatch = title.match(/^\[#([A-Z])\]\s+/);
    if (priorityMatch) {
        priority = priorityMatch[1];
        title = title.slice(priorityMatch[0].length);
    }

    // Extract tags :tag1:tag2:
    const tagMatch = title.match(/\s+:([^:\s]+(?::[^:\s]+)*):$/);
    if (tagMatch) {
        tags.push(...tagMatch[1].split(':'));
        title = title.slice(0, -tagMatch[0].length);
    }

    return {
        level,
        title: title.trim(),
        todoKeyword,
        todoType,
        priority,
        tags,
        lineNumber,
        endLineNumber: lineNumber,
        children: [],
    };
}

/**
 * Document symbol provider for org-mode files
 * Shows headlines, source blocks, tables, etc. in the outline view
 */
export class OrgDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] {
        const cacheKey = document.uri.toString();
        const cached = parseCache.get(cacheKey);

        // Return cached symbols if document hasn't changed
        if (cached && cached.version === document.version) {
            return cached.symbols;
        }

        const symbols: vscode.DocumentSymbol[] = [];

        try {
            // Use fast lightweight parser - only extracts headlines and blocks
            const lines = document.getText().split('\n');
            const { headlines, blocks } = parseLightweight(lines);

            if (token.isCancellationRequested) {
                return symbols;
            }

            // Check for document title in first few lines
            for (let i = 0; i < Math.min(20, lines.length); i++) {
                const titleMatch = lines[i].match(/^#\+TITLE:\s*(.+)$/i);
                if (titleMatch) {
                    symbols.push(new vscode.DocumentSymbol(
                        `📄 ${titleMatch[1]}`,
                        'Document title',
                        vscode.SymbolKind.File,
                        new vscode.Range(i, 0, i, lines[i].length),
                        new vscode.Range(i, 0, i, lines[i].length)
                    ));
                    break;
                }
            }

            // Add headlines
            for (const headline of headlines) {
                const symbol = this.createLightHeadlineSymbol(headline, document);
                if (symbol) {
                    symbols.push(symbol);
                }
            }

            // Add top-level blocks (before first headline)
            const firstHeadlineLine = headlines.length > 0 ? headlines[0].lineNumber : lines.length;
            for (const block of blocks) {
                if (block.lineNumber < firstHeadlineLine) {
                    const symbol = this.createBlockSymbol(block, document);
                    if (symbol) {
                        symbols.push(symbol);
                    }
                }
            }

            // Cache the result
            if (parseCache.size >= MAX_CACHE_SIZE) {
                const firstKey = parseCache.keys().next().value;
                if (firstKey) {
                    parseCache.delete(firstKey);
                }
            }
            parseCache.set(cacheKey, { version: document.version, symbols });

        } catch (error) {
            console.error('Error parsing document for symbols:', error);
        }

        return symbols;
    }

    /**
     * Create symbol from lightweight headline
     */
    private createLightHeadlineSymbol(
        headline: LightHeadline,
        document: vscode.TextDocument
    ): vscode.DocumentSymbol | null {
        const startLine = headline.lineNumber;
        const endLine = headline.endLineNumber;

        // Build symbol name
        let name = headline.title;
        if (headline.todoKeyword) {
            const prefix = headline.todoType === 'done' ? '✓' : '☐';
            name = `${prefix} ${name}`;
        }

        // Build detail string
        const details: string[] = [];
        if (headline.tags.length > 0) {
            details.push(`:${headline.tags.join(':')}:`);
        }
        if (headline.priority) {
            details.push(`[#${headline.priority}]`);
        }

        const range = new vscode.Range(startLine, 0, endLine,
            endLine < document.lineCount ? document.lineAt(endLine).text.length : 0);
        const selectionRange = new vscode.Range(startLine, 0, startLine,
            document.lineAt(startLine).text.length);

        const symbol = new vscode.DocumentSymbol(
            name,
            details.join(' '),
            this.getHeadlineSymbolKind(headline),
            range,
            selectionRange
        );

        // Add children recursively
        for (const child of headline.children) {
            const childSymbol = this.createLightHeadlineSymbol(child, document);
            if (childSymbol) {
                symbol.children.push(childSymbol);
            }
        }

        return symbol;
    }

    /**
     * Create symbol from lightweight block
     */
    private createBlockSymbol(
        block: LightBlock,
        document: vscode.TextDocument
    ): vscode.DocumentSymbol | null {
        const startLine = block.lineNumber;
        const endLine = block.endLineNumber;

        const range = new vscode.Range(startLine, 0, endLine,
            endLine < document.lineCount ? document.lineAt(endLine).text.length : 0);
        const selectionRange = new vscode.Range(startLine, 0, startLine,
            document.lineAt(startLine).text.length);

        switch (block.type) {
            case 'src-block':
                return new vscode.DocumentSymbol(
                    `⟨${block.name || block.language}⟩`,
                    `Source block (${block.language})`,
                    vscode.SymbolKind.Function,
                    range,
                    selectionRange
                );
            case 'table':
                return new vscode.DocumentSymbol(
                    '📊 Table',
                    `${endLine - startLine + 1} rows`,
                    vscode.SymbolKind.Struct,
                    range,
                    selectionRange
                );
            case 'drawer':
                return new vscode.DocumentSymbol(
                    `📦 :${block.name}:`,
                    'Drawer',
                    vscode.SymbolKind.Namespace,
                    range,
                    selectionRange
                );
        }
        return null;
    }

    /**
     * Get symbol kind based on headline properties
     */
    private getHeadlineSymbolKind(headline: LightHeadline): vscode.SymbolKind {
        if (headline.todoKeyword) {
            return headline.todoType === 'done'
                ? vscode.SymbolKind.Event
                : vscode.SymbolKind.Key;
        }
        switch (headline.level) {
            case 1: return vscode.SymbolKind.Class;
            case 2: return vscode.SymbolKind.Method;
            case 3: return vscode.SymbolKind.Function;
            case 4: return vscode.SymbolKind.Variable;
            default: return vscode.SymbolKind.Field;
        }
    }
}

/**
 * Register the document symbol provider
 */
export function registerDocumentSymbolProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: 'org', scheme: 'file' },
            new OrgDocumentSymbolProvider()
        )
    );
}
