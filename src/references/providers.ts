import * as vscode from 'vscode';
import { ReferenceManager } from './referenceManager';
import { formatCitation, formatAuthors, formatCitationLink } from './bibtexParser';

/**
 * Hover provider for citation links
 * Shows reference details on hover
 */
export class CitationHoverProvider implements vscode.HoverProvider {
    constructor(private manager: ReferenceManager) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line).text;

        // Find citation at position
        const key = this.findCitationKeyAtPosition(line, position.character);
        if (!key) return null;

        const entry = this.manager.getEntry(key);
        if (!entry) return null;

        // Build hover content
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Title and authors
        markdown.appendMarkdown(`### ${entry.title || 'Untitled'}\n\n`);
        markdown.appendMarkdown(`**${formatAuthors(entry.author)}** (${entry.year || 'n.d.'})\n\n`);

        // Publication info
        if (entry.journal) {
            markdown.appendMarkdown(`*${entry.journal}*`);
            if (entry.volume) {
                markdown.appendMarkdown(`, ${entry.volume}`);
                if (entry.number) {
                    markdown.appendMarkdown(`(${entry.number})`);
                }
            }
            if (entry.pages) {
                markdown.appendMarkdown(`, pp. ${entry.pages}`);
            }
            markdown.appendMarkdown('\n\n');
        } else if (entry.booktitle) {
            markdown.appendMarkdown(`In *${entry.booktitle}*\n\n`);
        }

        // Abstract (truncated)
        if (entry.abstract) {
            const abstract = entry.abstract.length > 300
                ? entry.abstract.substring(0, 300) + '...'
                : entry.abstract;
            markdown.appendMarkdown(`> ${abstract}\n\n`);
        }

        // Links
        if (entry.doi) {
            markdown.appendMarkdown(`[DOI](https://doi.org/${entry.doi}) | `);
        }
        if (entry.url) {
            markdown.appendMarkdown(`[URL](${entry.url}) | `);
        }
        markdown.appendMarkdown(`[Actions](command:scimax.ref.showDetails?${encodeURIComponent(JSON.stringify(key))})`);

        return new vscode.Hover(markdown);
    }

    /**
     * Find citation key at cursor position
     */
    private findCitationKeyAtPosition(line: string, position: number): string | null {
        // Patterns to match citations
        const patterns = [
            // org-mode: cite:key, citet:key, citep:key
            /(?:cite[pt]?|citeauthor|citeyear):([a-zA-Z0-9_:-]+)/g,
            // Markdown/Pandoc: @key or [@key]
            /@([a-zA-Z0-9_:-]+)/g,
            // LaTeX: \cite{key}
            /\\cite[pt]?\{([a-zA-Z0-9_:-]+)\}/g
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
                const start = match.index;
                const end = start + match[0].length;
                if (position >= start && position <= end) {
                    return match[1];
                }
            }
        }

        return null;
    }
}

/**
 * Completion provider for citations
 * Triggers after cite:, @, etc.
 */
export class CitationCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private manager: ReferenceManager) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const linePrefix = document.lineAt(position.line).text.substring(0, position.character);

        // Check if we're in a citation context
        const isCiteContext =
            /cite[pt]?:[\w-]*$/.test(linePrefix) ||
            /citeauthor:[\w-]*$/.test(linePrefix) ||
            /citeyear:[\w-]*$/.test(linePrefix) ||
            /@[\w-]*$/.test(linePrefix) ||
            /\\cite[pt]?\{[\w-]*$/.test(linePrefix);

        if (!isCiteContext) {
            return null;
        }

        const entries = this.manager.getAllEntries();
        const items: vscode.CompletionItem[] = [];

        for (const entry of entries) {
            const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Reference);

            // Description
            item.detail = `${formatAuthors(entry.author)} (${entry.year || 'n.d.'})`;
            item.documentation = new vscode.MarkdownString(formatCitation(entry, 'full'));

            // Sort by key
            item.sortText = entry.key;

            // Filter text includes author and year for better matching
            item.filterText = `${entry.key} ${entry.author} ${entry.year} ${entry.title}`;

            items.push(item);
        }

        return items;
    }
}

/**
 * Definition provider for citations
 * Jump to entry in bibliography file
 */
export class CitationDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private manager: ReferenceManager) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | null> {
        const line = document.lineAt(position.line).text;
        const key = this.findCitationKeyAtPosition(line, position.character);

        if (!key) return null;

        const entry = this.manager.getEntry(key);
        if (!entry) return null;

        // Get source file
        const sourceFile = (entry as any)._sourceFile;
        if (!sourceFile) return null;

        // Find the entry in the file
        const fs = await import('fs');
        const content = fs.readFileSync(sourceFile, 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`{${key},`) || lines[i].includes(`{${key}`)) {
                return new vscode.Location(
                    vscode.Uri.file(sourceFile),
                    new vscode.Position(i, 0)
                );
            }
        }

        return null;
    }

    private findCitationKeyAtPosition(line: string, position: number): string | null {
        const patterns = [
            /(?:cite[pt]?|citeauthor|citeyear):([a-zA-Z0-9_:-]+)/g,
            /@([a-zA-Z0-9_:-]+)/g,
            /\\cite[pt]?\{([a-zA-Z0-9_:-]+)\}/g
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
                const start = match.index;
                const end = start + match[0].length;
                if (position >= start && position <= end) {
                    return match[1];
                }
            }
        }

        return null;
    }
}

/**
 * Code lens provider for bibliography files
 * Shows citation count for each entry
 */
export class BibliographyCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(private manager: ReferenceManager) {
        // Refresh code lenses when entries change
        manager.onDidUpdateEntries(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        if (!document.fileName.endsWith('.bib')) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];
        const lines = document.getText().split('\n');

        // Find entry definitions
        const entryRegex = /@\w+\s*\{\s*([^,\s]+)/;

        for (let i = 0; i < lines.length; i++) {
            const match = entryRegex.exec(lines[i]);
            if (match) {
                const key = match[1];
                const range = new vscode.Range(i, 0, i, lines[i].length);

                // Find citations command
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(search) Find citations',
                    command: 'scimax.ref.findCitationsForKey',
                    arguments: [key]
                }));

                // Copy key command
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(clippy) Copy key',
                    command: 'scimax.ref.copyKey',
                    arguments: [key]
                }));
            }
        }

        return codeLenses;
    }
}

/**
 * Document link provider for citation links
 * Makes citations clickable
 */
export class CitationLinkProvider implements vscode.DocumentLinkProvider {
    constructor(private manager: ReferenceManager) {}

    provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();

        // Patterns to match
        const patterns = [
            { regex: /(?:cite[pt]?|citeauthor|citeyear):([a-zA-Z0-9_:-]+)/g, group: 1 },
            { regex: /\[@([a-zA-Z0-9_:-]+)/g, group: 1 }
        ];

        for (const { regex, group } of patterns) {
            let match;
            while ((match = regex.exec(text)) !== null) {
                const key = match[group];
                const entry = this.manager.getEntry(key);

                if (entry) {
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    const range = new vscode.Range(startPos, endPos);

                    const link = new vscode.DocumentLink(range);
                    link.tooltip = `${formatAuthors(entry.author)} (${entry.year}): ${entry.title}`;

                    links.push(link);
                }
            }
        }

        return links;
    }
}

/**
 * Tree data provider for references sidebar
 */
export class ReferenceTreeProvider implements vscode.TreeDataProvider<ReferenceTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ReferenceTreeItem | undefined | null | void> =
        new vscode.EventEmitter<ReferenceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private manager: ReferenceManager) {
        manager.onDidUpdateEntries(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ReferenceTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ReferenceTreeItem): vscode.ProviderResult<ReferenceTreeItem[]> {
        if (!element) {
            // Root level - group by type
            const entries = this.manager.getAllEntries();
            const byType = new Map<string, number>();

            for (const entry of entries) {
                byType.set(entry.type, (byType.get(entry.type) || 0) + 1);
            }

            const items: ReferenceTreeItem[] = [];

            // Sort by count
            const sorted = Array.from(byType.entries()).sort((a, b) => b[1] - a[1]);

            for (const [type, count] of sorted) {
                items.push(new ReferenceTreeItem(
                    `${type} (${count})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'type',
                    type
                ));
            }

            return items;
        }

        if (element.contextValue === 'type') {
            // Show entries of this type
            const entries = this.manager.getAllEntries()
                .filter(e => e.type === element.entryType)
                .sort((a, b) => {
                    // Sort by year descending, then by key
                    const yearDiff = (parseInt(b.year || '0') - parseInt(a.year || '0'));
                    if (yearDiff !== 0) return yearDiff;
                    return a.key.localeCompare(b.key);
                });

            return entries.map(entry => {
                const item = new ReferenceTreeItem(
                    entry.key,
                    vscode.TreeItemCollapsibleState.None,
                    'entry',
                    undefined,
                    entry
                );

                item.description = `${formatAuthors(entry.author, 1)} (${entry.year || 'n.d.'})`;
                item.tooltip = formatCitation(entry, 'short');
                item.command = {
                    command: 'scimax.ref.showDetails',
                    title: 'Show Details',
                    arguments: [entry.key]
                };

                return item;
            });
        }

        return [];
    }
}

class ReferenceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly entryType?: string,
        public readonly entry?: any
    ) {
        super(label, collapsibleState);

        if (contextValue === 'type') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            this.iconPath = new vscode.ThemeIcon('book');
        }
    }
}
