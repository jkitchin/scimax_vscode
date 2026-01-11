import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ReferenceManager } from './referenceManager';
import { formatCitation, formatAuthors, formatCitationLink, parseBibTeX } from './bibtexParser';

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
        if (!entry) {
            // Show hover for unknown citation
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`### Citation: ${key}\n\n`);
            markdown.appendMarkdown(`*Not found in bibliography*\n\n`);
            markdown.appendMarkdown(`[Search Google Scholar](https://scholar.google.com/scholar?q=${encodeURIComponent(key)}) | `);
            markdown.appendMarkdown(`[Add from DOI](command:scimax.ref.fetchFromDOI)`);
            return new vscode.Hover(markdown);
        }

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
        // Patterns to match citations (order matters - more specific first)
        const patterns = [
            // org-ref style: cite:key, citep:key, citet:key, etc.
            /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:-]+)/g,
            // org-mode 9.5+ citation: [cite:@key] or [cite/style:@key]
            /\[cite(?:\/[^\]]*)?:@([a-zA-Z0-9_:-]+)[^\]]*\]/g,
            // Pandoc/markdown: [@key]
            /\[@([a-zA-Z0-9_:-]+)\]/g,
            // Pandoc/markdown: @key (standalone)
            /(?:^|[^\\w@])@([a-zA-Z][a-zA-Z0-9_:-]*)/g,
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
 * Hover provider for bibliography file references
 * Shows bib file info on hover over #+BIBLIOGRAPHY: or bibliography: links
 */
export class BibliographyHoverProvider implements vscode.HoverProvider {
    constructor(private manager: ReferenceManager) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line).text;

        // Match bibliography references
        // #+BIBLIOGRAPHY: path/to/file.bib
        // bibliography:path/to/file.bib
        const patterns = [
            /^#\+BIBLIOGRAPHY:\s*(.+\.bib)\s*$/i,
            /bibliography:([^\s]+\.bib)/i
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(line);
            if (match) {
                const bibPath = match[1].trim();
                const start = line.indexOf(bibPath);
                const end = start + bibPath.length;

                // Check if cursor is on the path
                if (position.character >= start && position.character <= end) {
                    return this.createBibHover(bibPath, document);
                }
            }
        }

        return null;
    }

    private async createBibHover(bibPath: string, document: vscode.TextDocument): Promise<vscode.Hover | null> {
        // Resolve the path relative to the document
        let resolvedPath = bibPath;
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';

        if (bibPath.startsWith('~')) {
            resolvedPath = bibPath.replace('~', homeDir);
        } else if (!path.isAbsolute(bibPath)) {
            const docDir = path.dirname(document.uri.fsPath);
            resolvedPath = path.resolve(docDir, bibPath);
        }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            markdown.appendMarkdown(`### Bibliography: ${bibPath}\n\n`);
            markdown.appendMarkdown(`**File not found**\n\n`);
            markdown.appendMarkdown(`Expected path: \`${resolvedPath}\`\n\n`);
            markdown.appendMarkdown(`[Create file](command:scimax.ref.createBibFile?${encodeURIComponent(JSON.stringify(resolvedPath))})`);
            return new vscode.Hover(markdown);
        }

        try {
            // Read and parse the bib file
            const content = fs.readFileSync(resolvedPath, 'utf8');
            const parseResult = parseBibTeX(content);
            const entries = parseResult.entries;

            // Count entry types
            const typeCounts = new Map<string, number>();
            const years = new Set<string>();
            const recentEntries: { key: string; author: string; year: string; title: string }[] = [];

            for (const entry of entries) {
                typeCounts.set(entry.type, (typeCounts.get(entry.type) || 0) + 1);
                if (entry.year) {
                    years.add(entry.year);
                }
            }

            // Get 3 most recent entries (by position in file, assuming recent at end)
            const lastEntries = entries.slice(-3).reverse();
            for (const entry of lastEntries) {
                recentEntries.push({
                    key: entry.key,
                    author: formatAuthors(entry.author, 1),
                    year: entry.year || 'n.d.',
                    title: entry.title?.slice(0, 50) + (entry.title && entry.title.length > 50 ? '...' : '') || ''
                });
            }

            // Get file stats
            const stats = fs.statSync(resolvedPath);
            const modifiedDate = stats.mtime.toLocaleDateString();

            // Build hover content
            markdown.appendMarkdown(`### Bibliography: ${path.basename(bibPath)}\n\n`);
            markdown.appendMarkdown(`**${entries.length} entries**`);

            if (years.size > 0) {
                const sortedYears = Array.from(years).sort();
                markdown.appendMarkdown(` (${sortedYears[0]}–${sortedYears[sortedYears.length - 1]})`);
            }
            markdown.appendMarkdown(`\n\n`);

            // Entry type breakdown
            if (typeCounts.size > 0) {
                const typeList = Array.from(typeCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join(', ');
                markdown.appendMarkdown(`*Types:* ${typeList}\n\n`);
            }

            // Recent entries
            if (recentEntries.length > 0) {
                markdown.appendMarkdown(`**Recent entries:**\n`);
                for (const entry of recentEntries) {
                    markdown.appendMarkdown(`- \`${entry.key}\` ${entry.author} (${entry.year})\n`);
                }
                markdown.appendMarkdown(`\n`);
            }

            // File info
            markdown.appendMarkdown(`---\n`);
            markdown.appendMarkdown(`*Path:* \`${resolvedPath}\`\n\n`);
            markdown.appendMarkdown(`*Modified:* ${modifiedDate}\n\n`);

            // Actions
            markdown.appendMarkdown(`[Open file](${vscode.Uri.file(resolvedPath).toString()}) | `);
            markdown.appendMarkdown(`[Search entries](command:scimax.ref.searchReferences)`);

            return new vscode.Hover(markdown);
        } catch (error) {
            markdown.appendMarkdown(`### Bibliography: ${bibPath}\n\n`);
            markdown.appendMarkdown(`**Error reading file**\n\n`);
            markdown.appendMarkdown(`${error}`);
            return new vscode.Hover(markdown);
        }
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
        // Patterns to match citations (order matters - more specific first)
        const patterns = [
            // org-ref style: cite:key, citep:key, citet:key, etc.
            /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:-]+)/g,
            // org-mode 9.5+ citation: [cite:@key] or [cite/style:@key]
            /\[cite(?:\/[^\]]*)?:@([a-zA-Z0-9_:-]+)[^\]]*\]/g,
            // Pandoc/markdown: [@key]
            /\[@([a-zA-Z0-9_:-]+)\]/g,
            // Pandoc/markdown: @key (standalone)
            /(?:^|[^\\w@])@([a-zA-Z][a-zA-Z0-9_:-]*)/g,
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
 * Makes citations clickable - opens action menu
 */
export class CitationLinkProvider implements vscode.DocumentLinkProvider {
    constructor(private manager: ReferenceManager) {}

    provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();

        // Patterns to match various citation formats
        const patterns = [
            // org-ref style: cite:key, citep:key, citet:key, etc.
            { regex: /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:-]+)/g, group: 1 },
            // org-mode 9.5+ citation: [cite:@key] or [cite/style:@key]
            { regex: /\[cite(?:\/[^\]]*)?:@([a-zA-Z0-9_:-]+)[^\]]*\]/g, group: 1 },
            // Pandoc/markdown: [@key] or @key
            { regex: /\[@([a-zA-Z0-9_:-]+)\]/g, group: 1 },
            { regex: /(?<![\\w@])@([a-zA-Z][a-zA-Z0-9_:-]*)/g, group: 1 },
            // LaTeX: \cite{key}
            { regex: /\\cite[pt]?\{([a-zA-Z0-9_:-]+)\}/g, group: 1 }
        ];

        for (const { regex, group } of patterns) {
            let match;
            while ((match = regex.exec(text)) !== null) {
                const key = match[group];
                const entry = this.manager.getEntry(key);

                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const range = new vscode.Range(startPos, endPos);

                const link = new vscode.DocumentLink(range);

                if (entry) {
                    link.tooltip = `Click for actions: ${formatAuthors(entry.author)} (${entry.year})`;
                } else {
                    link.tooltip = `Citation: ${key} (not in bibliography - click to search)`;
                }

                // Set target to command that shows action menu
                link.target = vscode.Uri.parse(
                    `command:scimax.ref.citeAction?${encodeURIComponent(JSON.stringify(key))}`
                );

                links.push(link);
            }
        }

        return links;
    }
}

/**
 * Register the cite action command
 */
export function registerCiteActionCommand(
    context: vscode.ExtensionContext,
    manager: ReferenceManager
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.citeAction', async (key: string) => {
            const entry = manager.getEntry(key);

            if (!entry) {
                // Handle unknown citation - offer search options
                const items: (vscode.QuickPickItem & { action: string })[] = [
                    {
                        label: '$(search) Search Google Scholar',
                        description: `Search for "${key}"`,
                        action: 'scholar'
                    },
                    {
                        label: '$(link-external) Search CrossRef',
                        description: 'Search CrossRef database',
                        action: 'crossref'
                    },
                    {
                        label: '$(add) Add from DOI',
                        description: 'Fetch BibTeX entry from a DOI',
                        action: 'doi'
                    },
                    {
                        label: '$(clippy) Copy Key',
                        description: key,
                        action: 'copy'
                    }
                ];

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Citation "${key}" not found in bibliography`
                });

                if (!selected) return;

                switch (selected.action) {
                    case 'scholar':
                        await vscode.env.openExternal(
                            vscode.Uri.parse(`https://scholar.google.com/scholar?q=${encodeURIComponent(key)}`)
                        );
                        break;
                    case 'crossref':
                        await vscode.env.openExternal(
                            vscode.Uri.parse(`https://search.crossref.org/?q=${encodeURIComponent(key)}&from_ui=yes`)
                        );
                        break;
                    case 'doi':
                        await vscode.commands.executeCommand('scimax.ref.fetchFromDOI');
                        break;
                    case 'copy':
                        await vscode.env.clipboard.writeText(key);
                        vscode.window.showInformationMessage(`Copied: ${key}`);
                        break;
                }
                return;
            }

            // Build action items for known entry
            const items: (vscode.QuickPickItem & { action: string })[] = [
                {
                    label: '$(book) Open BibTeX Entry',
                    description: 'Jump to entry in .bib file',
                    action: 'bib'
                }
            ];

            if (entry.doi) {
                items.push({
                    label: '$(link-external) Open DOI',
                    description: `https://doi.org/${entry.doi}`,
                    action: 'doi'
                });
            }

            if (entry.url) {
                items.push({
                    label: '$(globe) Open URL',
                    description: entry.url,
                    action: 'url'
                });
            }

            const pdfPath = manager.getPdfPath(entry);
            if (pdfPath) {
                items.push({
                    label: '$(file-pdf) Open PDF',
                    description: pdfPath,
                    action: 'pdf'
                });
            }

            items.push({
                label: '$(note) Open/Create Notes',
                description: 'Open notes file for this reference',
                action: 'notes'
            });

            items.push({
                label: '$(clippy) Copy Citation Key',
                description: key,
                action: 'copy'
            });

            items.push({
                label: '$(copy) Copy BibTeX',
                description: 'Copy full BibTeX entry to clipboard',
                action: 'copyBib'
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${key}: ${entry.title?.slice(0, 60)}...`
            });

            if (!selected) return;

            switch (selected.action) {
                case 'bib':
                    await openBibEntry(entry, manager);
                    break;
                case 'doi':
                    await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${entry.doi}`));
                    break;
                case 'url':
                    await vscode.env.openExternal(vscode.Uri.parse(entry.url!));
                    break;
                case 'pdf':
                    await manager.openPdf(entry);
                    break;
                case 'notes':
                    await manager.openNotes(entry);
                    break;
                case 'copy':
                    await vscode.env.clipboard.writeText(key);
                    vscode.window.showInformationMessage(`Copied: ${key}`);
                    break;
                case 'copyBib':
                    const { entryToBibTeX } = await import('./bibtexParser');
                    await vscode.env.clipboard.writeText(entryToBibTeX(entry));
                    vscode.window.showInformationMessage('BibTeX copied to clipboard');
                    break;
            }
        })
    );
}

/**
 * Open bib file at entry location
 */
async function openBibEntry(entry: any, manager: ReferenceManager): Promise<void> {
    const sourceFile = entry._sourceFile;
    if (!sourceFile) {
        vscode.window.showWarningMessage('Source .bib file not found for this entry');
        return;
    }

    const fs = await import('fs');
    const content = fs.readFileSync(sourceFile, 'utf8');
    const lines = content.split('\n');

    // Find the entry
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`{${entry.key},`) || lines[i].includes(`{${entry.key}`)) {
            const doc = await vscode.workspace.openTextDocument(sourceFile);
            const editor = await vscode.window.showTextDocument(doc);
            const position = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            return;
        }
    }

    // Fallback: just open the file
    const doc = await vscode.workspace.openTextDocument(sourceFile);
    await vscode.window.showTextDocument(doc);
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
