/**
 * Document Symbol Provider for org-mode
 * Provides outline symbols using the unified parser
 */

import * as vscode from 'vscode';
import { parseOrg } from '../parser/orgParserUnified';
import type {
    OrgDocumentNode,
    HeadlineElement,
    SrcBlockElement,
    TableElement,
    PlainListElement,
} from '../parser/orgElementTypes';

/**
 * Document symbol provider for org-mode files
 * Shows headlines, source blocks, tables, etc. in the outline view
 */
export class OrgDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];

        try {
            // Parse the document
            const content = document.getText();
            const doc = parseOrg(content, { addPositions: true });

            if (token.isCancellationRequested) {
                return symbols;
            }

            // Add document-level keywords as properties
            if (doc.keywords['TITLE']) {
                const titleSymbol = new vscode.DocumentSymbol(
                    `📄 ${doc.keywords['TITLE']}`,
                    'Document title',
                    vscode.SymbolKind.File,
                    new vscode.Range(0, 0, 0, 0),
                    new vscode.Range(0, 0, 0, 0)
                );
                symbols.push(titleSymbol);
            }

            // Add headlines
            for (const headline of doc.children) {
                const headlineSymbol = this.createHeadlineSymbol(headline, document);
                if (headlineSymbol) {
                    symbols.push(headlineSymbol);
                }
            }

            // Add section elements (source blocks, tables at document level)
            if (doc.section) {
                this.addSectionSymbols(doc.section.children, symbols, document);
            }

        } catch (error) {
            console.error('Error parsing document for symbols:', error);
        }

        return symbols;
    }

    /**
     * Create a document symbol for a headline
     */
    private createHeadlineSymbol(
        headline: HeadlineElement,
        document: vscode.TextDocument
    ): vscode.DocumentSymbol | null {
        if (!headline.position) return null;

        const startPos = new vscode.Position(
            headline.position.start.line,
            headline.position.start.column
        );
        const endPos = new vscode.Position(
            headline.position.end.line,
            headline.position.end.column
        );

        // Build symbol name
        let name = headline.properties.rawValue;
        const prefix = this.getHeadlinePrefix(headline);
        if (prefix) {
            name = `${prefix} ${name}`;
        }

        // Build detail string
        const details: string[] = [];
        if (headline.properties.tags.length > 0) {
            details.push(`:${headline.properties.tags.join(':')}:`);
        }
        if (headline.properties.priority) {
            details.push(`[#${headline.properties.priority}]`);
        }

        const symbol = new vscode.DocumentSymbol(
            name,
            details.join(' '),
            this.getHeadlineSymbolKind(headline),
            new vscode.Range(startPos, endPos),
            new vscode.Range(startPos, startPos) // Selection range is just the headline line
        );

        // Add children (sub-headlines)
        for (const child of headline.children) {
            const childSymbol = this.createHeadlineSymbol(child, document);
            if (childSymbol) {
                symbol.children.push(childSymbol);
            }
        }

        // Add section elements (source blocks, tables within this headline)
        if (headline.section) {
            this.addSectionSymbols(headline.section.children, symbol.children, document);
        }

        return symbol;
    }

    /**
     * Get prefix for headline (TODO state, etc.)
     */
    private getHeadlinePrefix(headline: HeadlineElement): string {
        const parts: string[] = [];

        if (headline.properties.todoKeyword) {
            if (headline.properties.todoType === 'done') {
                parts.push('✓');
            } else {
                parts.push('☐');
            }
        }

        return parts.join(' ');
    }

    /**
     * Get appropriate symbol kind for headline
     */
    private getHeadlineSymbolKind(headline: HeadlineElement): vscode.SymbolKind {
        if (headline.properties.todoKeyword) {
            return headline.properties.todoType === 'done'
                ? vscode.SymbolKind.Event
                : vscode.SymbolKind.Key;
        }

        // Use different kinds based on level for visual distinction
        switch (headline.properties.level) {
            case 1: return vscode.SymbolKind.Class;
            case 2: return vscode.SymbolKind.Method;
            case 3: return vscode.SymbolKind.Function;
            case 4: return vscode.SymbolKind.Variable;
            default: return vscode.SymbolKind.Field;
        }
    }

    /**
     * Add section element symbols (source blocks, tables, etc.)
     */
    private addSectionSymbols(
        elements: any[],
        symbols: vscode.DocumentSymbol[],
        document: vscode.TextDocument
    ): void {
        for (const element of elements) {
            if (!element.position) continue;

            const startPos = new vscode.Position(
                element.position.start.line,
                element.position.start.column
            );
            const endPos = new vscode.Position(
                element.position.end.line,
                element.position.end.column
            );

            let symbol: vscode.DocumentSymbol | null = null;

            switch (element.type) {
                case 'src-block': {
                    const srcBlock = element as SrcBlockElement;
                    const lang = srcBlock.properties.language || 'code';
                    const name = srcBlock.properties.headers?.['name'] || lang;
                    symbol = new vscode.DocumentSymbol(
                        `⟨${name}⟩`,
                        `Source block (${lang})`,
                        vscode.SymbolKind.Function,
                        new vscode.Range(startPos, endPos),
                        new vscode.Range(startPos, startPos)
                    );
                    break;
                }

                case 'table': {
                    const table = element as TableElement;
                    const rowCount = table.children?.length || 0;
                    symbol = new vscode.DocumentSymbol(
                        '📊 Table',
                        `${rowCount} rows`,
                        vscode.SymbolKind.Struct,
                        new vscode.Range(startPos, endPos),
                        new vscode.Range(startPos, startPos)
                    );
                    break;
                }

                case 'plain-list': {
                    const list = element as PlainListElement;
                    const itemCount = list.children?.length || 0;
                    const listType = list.properties.listType || 'unordered';
                    symbol = new vscode.DocumentSymbol(
                        `📝 List (${listType})`,
                        `${itemCount} items`,
                        vscode.SymbolKind.Array,
                        new vscode.Range(startPos, endPos),
                        new vscode.Range(startPos, startPos)
                    );
                    break;
                }

                case 'drawer': {
                    symbol = new vscode.DocumentSymbol(
                        `📦 :${element.properties?.name || 'DRAWER'}:`,
                        'Drawer',
                        vscode.SymbolKind.Namespace,
                        new vscode.Range(startPos, endPos),
                        new vscode.Range(startPos, startPos)
                    );
                    break;
                }

                case 'latex-environment': {
                    symbol = new vscode.DocumentSymbol(
                        `∑ ${element.properties?.name || 'LaTeX'}`,
                        'LaTeX environment',
                        vscode.SymbolKind.Operator,
                        new vscode.Range(startPos, endPos),
                        new vscode.Range(startPos, startPos)
                    );
                    break;
                }

                case 'footnote-definition': {
                    symbol = new vscode.DocumentSymbol(
                        `[fn:${element.properties?.label || '?'}]`,
                        'Footnote',
                        vscode.SymbolKind.String,
                        new vscode.Range(startPos, endPos),
                        new vscode.Range(startPos, startPos)
                    );
                    break;
                }
            }

            if (symbol) {
                symbols.push(symbol);
            }
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
