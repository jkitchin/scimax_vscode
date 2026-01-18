import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ReferenceManager } from './referenceManager';
import { formatCitation, formatAuthors, formatCitationLink, parseBibTeX } from './bibtexParser';
import {
    fetchOpenAlexWork,
    reconstructAbstract,
    formatCitationCount,
    getOAStatusIcon,
    getOAStatusDescription,
    OpenAlexWork
} from './openalexService';

/**
 * Hover provider for citation links
 * Shows reference details on hover
 */
export class CitationHoverProvider implements vscode.HoverProvider {
    constructor(private manager: ReferenceManager) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const line = document.lineAt(position.line).text;

        // Find citation at position
        const key = this.findCitationKeyAtPosition(line, position.character);
        if (!key) return null;

        // Load document-local bibliographies first
        await this.manager.loadDocumentBibliographies(document);

        const entry = this.manager.getEntry(key);
        if (!entry) {
            // Show hover for unknown citation
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.supportHtml = true;
            markdown.appendMarkdown(`### Citation: ${key}\n\n`);
            markdown.appendMarkdown(`*Not found in bibliography*\n\n`);
            markdown.appendMarkdown(`[Search Google Scholar](https://scholar.google.com/scholar?q=${encodeURIComponent(key)}) | `);
            markdown.appendMarkdown(`[Add from DOI](command:scimax.ref.fetchFromDOI)`);
            return new vscode.Hover(markdown);
        }

        // Build hover content
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

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

        // Show source file
        const sourceFile = (entry as any)._sourceFile;
        if (sourceFile) {
            const fileName = path.basename(sourceFile);
            markdown.appendMarkdown(`\n\n---\n*Source: ${fileName}*`);
        }

        return new vscode.Hover(markdown);
    }

    /**
     * Find citation key at cursor position
     * Handles comma-separated keys like cite:key1,key2,key3
     * Also handles org-ref v3 syntax: cite:&key1 &key2
     */
    private findCitationKeyAtPosition(line: string, position: number): string | null {
        // Patterns to match citations with potentially comma-separated keys
        const patterns = [
            // org-ref v3 style: cite:&key1 &key2 (keys prefixed with &)
            { regex: /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):(&[a-zA-Z0-9_:-]+(?:\s+&[a-zA-Z0-9_:-]+)*)/g, keysGroup: 1, prefix: '&' },
            // org-ref v2 style: cite:key1,key2,key3 etc.
            { regex: /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:,-]+)/g, keysGroup: 1 },
            // org-mode 9.5+ citation: [cite:@key1;@key2] or [cite/style:@key]
            { regex: /\[cite(?:\/[^\]]*)?:([^\]]+)\]/g, keysGroup: 1, prefix: '@' },
            // Pandoc/markdown: [@key]
            { regex: /\[@([a-zA-Z0-9_:-]+)\]/g, keysGroup: 1 },
            // Pandoc/markdown: @key (standalone)
            { regex: /(?:^|[^\w@])@([a-zA-Z][a-zA-Z0-9_:-]*)/g, keysGroup: 1 },
            // LaTeX: \cite{key1,key2}
            { regex: /\\cite[pt]?\{([a-zA-Z0-9_:,-]+)\}/g, keysGroup: 1 }
        ];

        for (const { regex, keysGroup, prefix } of patterns) {
            let match;
            while ((match = regex.exec(line)) !== null) {
                const fullStart = match.index;
                const fullEnd = fullStart + match[0].length;

                // Check if cursor is within this citation
                if (position >= fullStart && position <= fullEnd) {
                    const keysStr = match[keysGroup];

                    // For org-mode 9.5+ style with @key;@key2 format
                    if (prefix === '@') {
                        const keys = keysStr.split(/[;,]/).map(k => k.trim().replace(/^@/, ''));
                        // Find which key the cursor is on
                        let keyStart = match.index + match[0].indexOf(keysStr);
                        for (const keyPart of keysStr.split(/([;,])/)) {
                            const keyEnd = keyStart + keyPart.length;
                            if (position >= keyStart && position < keyEnd) {
                                const key = keyPart.trim().replace(/^@/, '');
                                if (key && !key.match(/^[;,]$/)) {
                                    return key;
                                }
                            }
                            keyStart = keyEnd;
                        }
                        return keys[0]; // fallback to first key
                    }

                    // For org-ref v3 style with &key1 &key2 format
                    if (prefix === '&') {
                        const keys = keysStr.split(/\s+/).map(k => k.trim().replace(/^&/, ''));
                        // Find which key the cursor is on
                        let keyStart = match.index + match[0].indexOf(keysStr);
                        for (const keyPart of keysStr.split(/(\s+)/)) {
                            const keyEnd = keyStart + keyPart.length;
                            if (position >= keyStart && position < keyEnd) {
                                const key = keyPart.trim().replace(/^&/, '');
                                if (key && !key.match(/^\s*$/)) {
                                    return key;
                                }
                            }
                            keyStart = keyEnd;
                        }
                        return keys[0]; // fallback to first key
                    }

                    // For comma-separated keys (cite:key1,key2,key3)
                    const keys = keysStr.split(',');
                    if (keys.length === 1) {
                        return keys[0];
                    }

                    // Find the key at cursor position
                    // Calculate position within the keys string
                    const keysStartInLine = match.index + match[0].indexOf(keysStr);
                    let currentPos = keysStartInLine;

                    for (const key of keys) {
                        const keyEnd = currentPos + key.length;
                        if (position >= currentPos && position <= keyEnd) {
                            return key;
                        }
                        currentPos = keyEnd + 1; // +1 for the comma
                    }

                    // Fallback: return first key if position is on the prefix
                    return keys[0];
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
        const patterns: { regex: RegExp }[] = [
            { regex: /^(#\+BIBLIOGRAPHY:\s*)(.+?\.bib)\s*$/i },
            { regex: /(bibliography:)([^\s<>\[\](){}]+)/i }
        ];

        for (const { regex } of patterns) {
            const match = regex.exec(line);
            if (match) {
                const bibPath = match[2].trim();
                const end = match.index + match[0].length;

                // Check if cursor is anywhere on the link
                if (position.character >= match.index && position.character <= end) {
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

        // Try adding .bib extension if file doesn't exist
        if (!fs.existsSync(resolvedPath) && !resolvedPath.endsWith('.bib')) {
            const withBib = resolvedPath + '.bib';
            if (fs.existsSync(withBib)) {
                resolvedPath = withBib;
            }
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
 * Hover provider for cross-reference links (ref:, eqref:, etc.)
 * Shows context around the label definition
 */
export class RefHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line).text;

        // Match org-ref style links: ref:label, eqref:label, pageref:label, etc.
        const orgRefPattern = /(?<![\\w])(ref|eqref|pageref|nameref|autoref|cref|Cref):([^\s<>\[\](){}:,]+)/g;

        let match;
        while ((match = orgRefPattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (position.character >= start && position.character <= end) {
                const refType = match[1];
                const label = match[2];
                return this.createRefHover(document, refType, label);
            }
        }

        // Match LaTeX style refs: \ref{label}, \eqref{label}, \pageref{label}, etc.
        const latexRefPattern = /\\(ref|eqref|pageref|nameref|autoref|cref|Cref|vref|fref|Fref)\{([^}]+)\}/g;

        while ((match = latexRefPattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (position.character >= start && position.character <= end) {
                const refType = match[1];
                const label = match[2];
                return this.createRefHover(document, `\\${refType}`, label);
            }
        }

        return null;
    }

    private async createRefHover(
        document: vscode.TextDocument,
        refType: string,
        label: string
    ): Promise<vscode.Hover | null> {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Search for label definition in current document
        const labelInfo = await this.findLabelDefinition(document, label);

        if (labelInfo) {
            markdown.appendMarkdown(`### ${refType}:${label}\n\n`);
            markdown.appendMarkdown(`**${labelInfo.type}**`);
            if (labelInfo.file !== document.uri.fsPath) {
                markdown.appendMarkdown(` in \`${path.basename(labelInfo.file)}\``);
            }
            markdown.appendMarkdown(`\n\n`);

            // Show context
            if (labelInfo.context) {
                markdown.appendMarkdown(`> ${labelInfo.context}\n\n`);
            }

            // Show surrounding lines for more context
            if (labelInfo.surroundingLines && labelInfo.surroundingLines.length > 0) {
                markdown.appendMarkdown(`\`\`\`\n`);
                for (const contextLine of labelInfo.surroundingLines) {
                    markdown.appendMarkdown(`${contextLine}\n`);
                }
                markdown.appendMarkdown(`\`\`\`\n\n`);
            }

            // Link to definition
            const uri = vscode.Uri.file(labelInfo.file);
            const args = encodeURIComponent(JSON.stringify([uri, { selection: new vscode.Range(labelInfo.line, 0, labelInfo.line, 0) }]));
            markdown.appendMarkdown(`[Go to definition](command:vscode.open?${args})`);
        } else {
            markdown.appendMarkdown(`### ${refType}:${label}\n\n`);
            markdown.appendMarkdown(`*Label not found*\n\n`);
            markdown.appendMarkdown(`Define with: \`label:${label}\` or \`\\label{${label}}\``);
        }

        return new vscode.Hover(markdown);
    }

    private async findLabelDefinition(
        document: vscode.TextDocument,
        label: string
    ): Promise<{
        type: string;
        context: string;
        file: string;
        line: number;
        surroundingLines: string[];
    } | null> {
        // Patterns to find label definitions
        const labelPatterns = [
            // org-ref style: label:name
            { regex: new RegExp(`label:${this.escapeRegex(label)}(?=[\\s.,;:!?)]|$)`, 'i'), type: 'Label' },
            // LaTeX style: \label{name}
            { regex: new RegExp(`\\\\label\\{${this.escapeRegex(label)}\\}`, 'i'), type: 'LaTeX Label' },
            // org-mode CUSTOM_ID property
            { regex: new RegExp(`:CUSTOM_ID:\\s*${this.escapeRegex(label)}\\s*$`, 'i'), type: 'Heading (CUSTOM_ID)' },
            // org-mode #+NAME:
            { regex: new RegExp(`^\\s*#\\+NAME:\\s*${this.escapeRegex(label)}\\s*$`, 'i'), type: 'Named Element' },
            // org-mode #+LABEL: (for figures/tables)
            { regex: new RegExp(`^\\s*#\\+LABEL:\\s*${this.escapeRegex(label)}\\s*$`, 'i'), type: 'Figure/Table' }
        ];

        // Search in current document first
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const { regex, type } of labelPatterns) {
                if (regex.test(line)) {
                    // Found the label! Get context
                    const context = this.getContext(lines, i, type);
                    const surroundingLines = this.getSurroundingLines(lines, i, 2);

                    return {
                        type,
                        context,
                        file: document.uri.fsPath,
                        line: i,
                        surroundingLines
                    };
                }
            }
        }

        // Search in other org files in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const orgFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*.org'),
                    '**/node_modules/**',
                    100
                );

                for (const fileUri of orgFiles) {
                    if (fileUri.fsPath === document.uri.fsPath) continue;

                    try {
                        const content = fs.readFileSync(fileUri.fsPath, 'utf8');
                        const fileLines = content.split('\n');

                        for (let i = 0; i < fileLines.length; i++) {
                            const line = fileLines[i];
                            for (const { regex, type } of labelPatterns) {
                                if (regex.test(line)) {
                                    const context = this.getContext(fileLines, i, type);
                                    const surroundingLines = this.getSurroundingLines(fileLines, i, 2);

                                    return {
                                        type,
                                        context,
                                        file: fileUri.fsPath,
                                        line: i,
                                        surroundingLines
                                    };
                                }
                            }
                        }
                    } catch {
                        // Ignore file read errors
                    }
                }
            }
        }

        return null;
    }

    private getContext(lines: string[], labelLine: number, type: string): string {
        // Look for context based on label type

        // For CUSTOM_ID, find the heading
        if (type === 'Heading (CUSTOM_ID)') {
            // Search backwards for the heading
            for (let i = labelLine - 1; i >= 0; i--) {
                const headingMatch = lines[i].match(/^(\*+)\s+(.+)/);
                if (headingMatch) {
                    return headingMatch[2].replace(/\s*:\w+:$/, '').trim(); // Remove tags
                }
            }
        }

        // For Named Element or Figure/Table, look at next non-empty line
        if (type === 'Named Element' || type === 'Figure/Table') {
            for (let i = labelLine + 1; i < Math.min(labelLine + 5, lines.length); i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('#+')) {
                    // Check for caption
                    const captionMatch = lines.slice(labelLine, i + 1).join('\n').match(/#\+CAPTION:\s*(.+)/i);
                    if (captionMatch) {
                        return captionMatch[1].trim();
                    }
                    return line.slice(0, 100) + (line.length > 100 ? '...' : '');
                }
            }
        }

        // For LaTeX labels or org-ref labels, look at the surrounding context
        // Check if it's in an equation environment
        const surroundingText = lines.slice(Math.max(0, labelLine - 5), labelLine + 5).join('\n');

        if (surroundingText.includes('\\begin{equation}') || surroundingText.includes('\\begin{align}')) {
            return 'Equation';
        }
        if (surroundingText.includes('\\begin{figure}') || surroundingText.match(/#\+BEGIN.*figure/i)) {
            const captionMatch = surroundingText.match(/\\caption\{([^}]+)\}|#\+CAPTION:\s*(.+)/i);
            if (captionMatch) {
                return captionMatch[1] || captionMatch[2];
            }
            return 'Figure';
        }
        if (surroundingText.includes('\\begin{table}') || surroundingText.match(/#\+BEGIN.*table/i)) {
            const captionMatch = surroundingText.match(/\\caption\{([^}]+)\}|#\+CAPTION:\s*(.+)/i);
            if (captionMatch) {
                return captionMatch[1] || captionMatch[2];
            }
            return 'Table';
        }

        // Check if line itself contains a heading
        const headingMatch = lines[labelLine].match(/^(\*+)\s+(.+)/);
        if (headingMatch) {
            return headingMatch[2].replace(/\s*:\w+:$/, '').trim();
        }

        return lines[labelLine].trim().slice(0, 80);
    }

    private getSurroundingLines(lines: string[], centerLine: number, radius: number): string[] {
        const result: string[] = [];
        const start = Math.max(0, centerLine - radius);
        const end = Math.min(lines.length - 1, centerLine + radius);

        for (let i = start; i <= end; i++) {
            const prefix = i === centerLine ? '→ ' : '  ';
            result.push(prefix + lines[i]);
        }

        return result;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * DOI metadata cache for hover tooltips
 */
interface DoiMetadata {
    title: string;
    authors: string[];
    year: string;
    journal?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    publisher?: string;
    type?: string;
    abstract?: string;
    url?: string;
    fetchedAt: number;
}

const doiCache = new Map<string, DoiMetadata | null>();
const DOI_CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * Hover provider for DOI links
 * Fetches and displays metadata from CrossRef + OpenAlex
 */
export class DoiHoverProvider implements vscode.HoverProvider {
    constructor(private manager: ReferenceManager) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const line = document.lineAt(position.line).text;

        // Find DOI at position
        const doiInfo = this.findDoiAtPosition(line, position.character);
        if (!doiInfo) return null;

        const { doi } = doiInfo;

        // Check if already in bibliography
        const existingEntry = this.findEntryByDoi(doi);
        if (existingEntry) {
            // Also fetch OpenAlex for citation count
            const openAlexWork = await fetchOpenAlexWork(doi);
            return this.createExistingEntryHover(existingEntry, doi, openAlexWork);
        }

        // Check cache
        const cached = doiCache.get(doi);
        if (cached !== undefined) {
            if (cached === null) {
                return this.createNotFoundHover(doi);
            }
            if (Date.now() - cached.fetchedAt < DOI_CACHE_TTL) {
                // Also fetch OpenAlex for enhanced data
                const openAlexWork = await fetchOpenAlexWork(doi);
                return this.createMetadataHover(cached, doi, openAlexWork);
            }
        }

        // Fetch from CrossRef and OpenAlex in parallel
        try {
            const [metadata, openAlexWork] = await Promise.all([
                this.fetchDoiMetadata(doi),
                fetchOpenAlexWork(doi)
            ]);

            if (metadata) {
                doiCache.set(doi, metadata);
                return this.createMetadataHover(metadata, doi, openAlexWork);
            } else if (openAlexWork) {
                // Use OpenAlex data if CrossRef fails
                return this.createOpenAlexOnlyHover(openAlexWork, doi);
            } else {
                doiCache.set(doi, null);
                return this.createNotFoundHover(doi);
            }
        } catch (error) {
            return this.createErrorHover(doi, error);
        }
    }

    private findDoiAtPosition(line: string, position: number): { doi: string; start: number; end: number } | null {
        // Patterns to match DOI links
        const patterns = [
            // doi:10.xxx/xxx
            /doi:(10\.\d{4,9}\/[^\s<>\[\](){}]+)/gi,
            // https://doi.org/10.xxx or http://dx.doi.org/10.xxx
            /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s<>\[\](){}]+)/gi,
            // [[doi:10.xxx/xxx]] org link
            /\[\[doi:(10\.\d{4,9}\/[^\]]+)\]\]/gi,
            // Bare DOI 10.xxx/xxx (when not preceded by letter)
            /(?:^|[^\w\/])(10\.\d{4,9}\/[^\s<>\[\](){}]+)/gi
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
                const fullStart = match.index;
                const fullEnd = fullStart + match[0].length;

                if (position >= fullStart && position <= fullEnd) {
                    // Clean DOI - remove trailing punctuation
                    let doi = match[1].replace(/[.,;:)\]}>]+$/, '');
                    return { doi, start: fullStart, end: fullEnd };
                }
            }
        }

        return null;
    }

    private findEntryByDoi(doi: string): any | null {
        const entries = this.manager.getAllEntries();
        const normalizedDoi = doi.toLowerCase();
        for (const entry of entries) {
            if (entry.doi && entry.doi.toLowerCase() === normalizedDoi) {
                return entry;
            }
        }
        return null;
    }

    private createExistingEntryHover(entry: any, doi: string, openAlexWork?: OpenAlexWork | null): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        markdown.appendMarkdown(`### ${entry.title || 'Untitled'}\n\n`);
        markdown.appendMarkdown(`**${formatAuthors(entry.author)}** (${entry.year || 'n.d.'})\n\n`);

        if (entry.journal) {
            markdown.appendMarkdown(`*${entry.journal}*`);
            if (entry.volume) {
                markdown.appendMarkdown(`, ${entry.volume}`);
                if (entry.number) markdown.appendMarkdown(`(${entry.number})`);
            }
            if (entry.pages) markdown.appendMarkdown(`, pp. ${entry.pages}`);
            markdown.appendMarkdown('\n\n');
        }

        // OpenAlex metrics (citations, OA status)
        if (openAlexWork) {
            const metrics: string[] = [];
            metrics.push(`**${formatCitationCount(openAlexWork.cited_by_count)}** citations`);

            if (openAlexWork.open_access) {
                const oaIcon = getOAStatusIcon(openAlexWork.open_access.oa_status);
                metrics.push(`${oaIcon} ${getOAStatusDescription(openAlexWork.open_access.oa_status)}`);
            }

            if (openAlexWork.primary_topic) {
                metrics.push(`Topic: ${openAlexWork.primary_topic.display_name}`);
            }

            markdown.appendMarkdown(metrics.join(' | ') + '\n\n');
        }

        markdown.appendMarkdown(`[Open DOI](https://doi.org/${doi}) | `);
        markdown.appendMarkdown(`[Insert Citation](command:scimax.ref.insertCitationForKey?${encodeURIComponent(JSON.stringify(entry.key))}) | `);
        markdown.appendMarkdown(`[Actions](command:scimax.ref.showDetails?${encodeURIComponent(JSON.stringify(entry.key))})`);

        if (openAlexWork?.open_access?.oa_url) {
            markdown.appendMarkdown(` | [PDF](${openAlexWork.open_access.oa_url})`);
        }

        markdown.appendMarkdown(`\n\n---\n*In bibliography as: ${entry.key}*`);

        return new vscode.Hover(markdown);
    }

    private createMetadataHover(metadata: DoiMetadata, doi: string, openAlexWork?: OpenAlexWork | null): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        markdown.appendMarkdown(`### ${metadata.title}\n\n`);

        const authors = metadata.authors.length > 3
            ? metadata.authors.slice(0, 3).join(', ') + ' et al.'
            : metadata.authors.join(', ');
        markdown.appendMarkdown(`**${authors}** (${metadata.year})\n\n`);

        if (metadata.journal) {
            markdown.appendMarkdown(`*${metadata.journal}*`);
            if (metadata.volume) {
                markdown.appendMarkdown(`, ${metadata.volume}`);
                if (metadata.issue) markdown.appendMarkdown(`(${metadata.issue})`);
            }
            if (metadata.pages) markdown.appendMarkdown(`, pp. ${metadata.pages}`);
            markdown.appendMarkdown('\n\n');
        } else if (metadata.publisher) {
            markdown.appendMarkdown(`*${metadata.publisher}*\n\n`);
        }

        // OpenAlex metrics (citations, OA status, topics)
        if (openAlexWork) {
            const metrics: string[] = [];
            metrics.push(`**${formatCitationCount(openAlexWork.cited_by_count)}** citations`);

            if (openAlexWork.open_access) {
                const oaIcon = getOAStatusIcon(openAlexWork.open_access.oa_status);
                metrics.push(`${oaIcon} ${getOAStatusDescription(openAlexWork.open_access.oa_status)}`);
            }

            markdown.appendMarkdown(metrics.join(' | ') + '\n\n');

            // Topics
            if (openAlexWork.primary_topic) {
                const topic = openAlexWork.primary_topic;
                let topicLine = `**Topic:** ${topic.display_name}`;
                if (topic.field) {
                    topicLine += ` (${topic.field.display_name})`;
                }
                markdown.appendMarkdown(topicLine + '\n\n');
            }
        }

        // Abstract
        if (metadata.abstract) {
            const abstract = metadata.abstract.length > 250
                ? metadata.abstract.substring(0, 250) + '...'
                : metadata.abstract;
            markdown.appendMarkdown(`> ${abstract}\n\n`);
        } else if (openAlexWork?.abstract_inverted_index) {
            const abstract = reconstructAbstract(openAlexWork.abstract_inverted_index);
            if (abstract) {
                const truncated = abstract.length > 250 ? abstract.substring(0, 250) + '...' : abstract;
                markdown.appendMarkdown(`> ${truncated}\n\n`);
            }
        }

        // Actions
        markdown.appendMarkdown(`[Open DOI](https://doi.org/${doi}) | `);
        markdown.appendMarkdown(`[Add to Bibliography](command:scimax.ref.fetchFromDOI?${encodeURIComponent(JSON.stringify(doi))}) | `);
        markdown.appendMarkdown(`[Google Scholar](https://scholar.google.com/scholar?q=${encodeURIComponent(metadata.title)})`);

        if (openAlexWork?.open_access?.oa_url) {
            markdown.appendMarkdown(` | [PDF](${openAlexWork.open_access.oa_url})`);
        }

        if (openAlexWork) {
            markdown.appendMarkdown(` | [Citing Works](command:scimax.ref.showCitingWorks?${encodeURIComponent(JSON.stringify(doi))})`);
        }

        markdown.appendMarkdown(`\n\n---\n*DOI: ${doi}*`);

        return new vscode.Hover(markdown);
    }

    private createOpenAlexOnlyHover(work: OpenAlexWork, doi: string): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        markdown.appendMarkdown(`### ${work.title}\n\n`);

        // Authors
        if (work.authorships && work.authorships.length > 0) {
            const authors = work.authorships.length > 3
                ? work.authorships.slice(0, 3).map(a => a.author.display_name).join(', ') + ' et al.'
                : work.authorships.map(a => a.author.display_name).join(', ');
            markdown.appendMarkdown(`**${authors}** (${work.publication_year || 'n.d.'})\n\n`);
        }

        // Source
        if (work.primary_location?.source) {
            markdown.appendMarkdown(`*${work.primary_location.source.display_name}*`);
            if (work.biblio) {
                if (work.biblio.volume) markdown.appendMarkdown(`, ${work.biblio.volume}`);
                if (work.biblio.issue) markdown.appendMarkdown(`(${work.biblio.issue})`);
                if (work.biblio.first_page) {
                    markdown.appendMarkdown(`, pp. ${work.biblio.first_page}`);
                    if (work.biblio.last_page) markdown.appendMarkdown(`-${work.biblio.last_page}`);
                }
            }
            markdown.appendMarkdown('\n\n');
        }

        // Metrics
        const metrics: string[] = [];
        metrics.push(`**${formatCitationCount(work.cited_by_count)}** citations`);

        if (work.open_access) {
            const oaIcon = getOAStatusIcon(work.open_access.oa_status);
            metrics.push(`${oaIcon} ${getOAStatusDescription(work.open_access.oa_status)}`);
        }

        markdown.appendMarkdown(metrics.join(' | ') + '\n\n');

        // Topic
        if (work.primary_topic) {
            let topicLine = `**Topic:** ${work.primary_topic.display_name}`;
            if (work.primary_topic.field) {
                topicLine += ` (${work.primary_topic.field.display_name})`;
            }
            markdown.appendMarkdown(topicLine + '\n\n');
        }

        // Abstract
        if (work.abstract_inverted_index) {
            const abstract = reconstructAbstract(work.abstract_inverted_index);
            if (abstract) {
                const truncated = abstract.length > 250 ? abstract.substring(0, 250) + '...' : abstract;
                markdown.appendMarkdown(`> ${truncated}\n\n`);
            }
        }

        // Actions
        markdown.appendMarkdown(`[Open DOI](https://doi.org/${doi}) | `);
        markdown.appendMarkdown(`[Add to Bibliography](command:scimax.ref.fetchFromDOI?${encodeURIComponent(JSON.stringify(doi))}) | `);
        markdown.appendMarkdown(`[Google Scholar](https://scholar.google.com/scholar?q=${encodeURIComponent(work.title)})`);

        if (work.open_access?.oa_url) {
            markdown.appendMarkdown(` | [PDF](${work.open_access.oa_url})`);
        }

        markdown.appendMarkdown(` | [Citing Works](command:scimax.ref.showCitingWorks?${encodeURIComponent(JSON.stringify(doi))})`);

        markdown.appendMarkdown(`\n\n---\n*DOI: ${doi} | Source: OpenAlex*`);

        return new vscode.Hover(markdown);
    }

    private createNotFoundHover(doi: string): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        markdown.appendMarkdown(`### DOI: ${doi}\n\n`);
        markdown.appendMarkdown(`*Metadata not found on CrossRef*\n\n`);
        markdown.appendMarkdown(`[Open DOI](https://doi.org/${doi}) | `);
        markdown.appendMarkdown(`[Search CrossRef](https://search.crossref.org/?q=${encodeURIComponent(doi)})`);

        return new vscode.Hover(markdown);
    }

    private createErrorHover(doi: string, error: any): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        markdown.appendMarkdown(`### DOI: ${doi}\n\n`);
        markdown.appendMarkdown(`*Error fetching metadata*\n\n`);
        markdown.appendMarkdown(`[Open DOI](https://doi.org/${doi})`);

        return new vscode.Hover(markdown);
    }

    private async fetchDoiMetadata(doi: string): Promise<DoiMetadata | null> {
        return new Promise((resolve) => {
            const https = require('https');

            const options = {
                hostname: 'api.crossref.org',
                path: `/works/${encodeURIComponent(doi)}`,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'scimax-vscode/1.0 (https://github.com/jkitchin/scimax_vscode)'
                },
                timeout: 5000
            };

            const req = https.request(options, (res: any) => {
                let data = '';

                res.on('data', (chunk: any) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const json = JSON.parse(data);
                            const work = json.message;

                            const metadata: DoiMetadata = {
                                title: work.title?.[0] || 'Untitled',
                                authors: (work.author || []).map((a: any) =>
                                    a.given ? `${a.given} ${a.family}` : a.family || a.name || 'Unknown'
                                ),
                                year: work.published?.['date-parts']?.[0]?.[0]?.toString() ||
                                      work['published-print']?.['date-parts']?.[0]?.[0]?.toString() ||
                                      work['published-online']?.['date-parts']?.[0]?.[0]?.toString() ||
                                      'n.d.',
                                journal: work['container-title']?.[0],
                                volume: work.volume,
                                issue: work.issue,
                                pages: work.page,
                                publisher: work.publisher,
                                type: work.type,
                                abstract: work.abstract?.replace(/<[^>]*>/g, ''), // Strip HTML
                                url: work.URL,
                                fetchedAt: Date.now()
                            };

                            resolve(metadata);
                        } catch {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                });
            });

            req.on('error', () => {
                resolve(null);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });

            req.end();
        });
    }
}

/**
 * Completion provider for citations
 * Triggers after cite:, @, etc.
 */
export class CitationCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private manager: ReferenceManager) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | null> {
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

        // Load document-local bibliographies first
        await this.manager.loadDocumentBibliographies(document);

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
        // Each pattern has: regex, capture group, and optional prefix to strip
        const patterns: { regex: RegExp; group: number; prefix?: string }[] = [
            // org-ref v3 style: cite:&key (keys prefixed with &)
            { regex: /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):&([a-zA-Z0-9_:-]+)/g, group: 1 },
            // org-ref v2 style: cite:key, citep:key, citet:key, etc.
            { regex: /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:-]+)/g, group: 1 },
            // org-mode 9.5+ citation: [cite:@key] or [cite/style:@key]
            { regex: /\[cite(?:\/[^\]]*)?:@([a-zA-Z0-9_:-]+)[^\]]*\]/g, group: 1 },
            // Pandoc/markdown: [@key]
            { regex: /\[@([a-zA-Z0-9_:-]+)\]/g, group: 1 },
            // Pandoc/markdown: @key (standalone)
            { regex: /(?:^|[^\w@])@([a-zA-Z][a-zA-Z0-9_:-]*)/g, group: 1 },
            // LaTeX: \cite{key}
            { regex: /\\cite[pt]?\{([a-zA-Z0-9_:-]+)\}/g, group: 1 }
        ];

        for (const { regex, group } of patterns) {
            let match;
            while ((match = regex.exec(line)) !== null) {
                const start = match.index;
                const end = start + match[0].length;
                if (position >= start && position <= end) {
                    return match[group];
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

    async provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink[]> {
        // Load document-local bibliographies first
        await this.manager.loadDocumentBibliographies(document);

        const links: vscode.DocumentLink[] = [];
        const text = document.getText();

        // org-ref v3 style: cite:&key1 &key2 (keys prefixed with &, space-separated)
        const orgRefV3Pattern = /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):(&[a-zA-Z0-9_:-]+(?:\s+&[a-zA-Z0-9_:-]+)*)/g;

        let match;
        while ((match = orgRefV3Pattern.exec(text)) !== null) {
            const fullMatch = match[0];
            const keysStr = match[1];
            const keyParts = keysStr.split(/\s+/);
            const prefixLen = fullMatch.indexOf(':') + 1;

            let keyOffset = match.index + prefixLen;

            for (const keyPart of keyParts) {
                if (!keyPart) continue;
                const key = keyPart.replace(/^&/, ''); // Strip & prefix

                const entry = this.manager.getEntry(key);
                const startPos = document.positionAt(keyOffset);
                const endPos = document.positionAt(keyOffset + keyPart.length);
                const range = new vscode.Range(startPos, endPos);

                const link = new vscode.DocumentLink(range);

                if (entry) {
                    link.tooltip = `${formatAuthors(entry.author)} (${entry.year}): ${entry.title?.slice(0, 50) || 'Untitled'}...`;
                } else {
                    link.tooltip = `Citation: ${key} (not in bibliography - click to search)`;
                }

                link.target = vscode.Uri.parse(
                    `command:scimax.ref.citeAction?${encodeURIComponent(JSON.stringify(key))}`
                );

                links.push(link);
                // Find next key position (skip whitespace)
                keyOffset += keyPart.length;
                while (keyOffset < text.length && /\s/.test(text[keyOffset])) {
                    keyOffset++;
                }
            }
        }

        // org-ref v2 style: cite:key1,key2,key3 (comma-separated, no prefix)
        const orgRefV2Pattern = /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z][a-zA-Z0-9_:,-]*)/g;

        while ((match = orgRefV2Pattern.exec(text)) !== null) {
            const fullMatch = match[0];
            const keysStr = match[1];

            // Skip if this looks like v3 syntax (starts with &)
            if (keysStr.startsWith('&')) continue;

            const keys = keysStr.split(',');
            const prefixLen = fullMatch.indexOf(':') + 1;

            let keyOffset = match.index + prefixLen;

            for (const key of keys) {
                if (!key) continue;

                const entry = this.manager.getEntry(key);
                const startPos = document.positionAt(keyOffset);
                const endPos = document.positionAt(keyOffset + key.length);
                const range = new vscode.Range(startPos, endPos);

                const link = new vscode.DocumentLink(range);

                if (entry) {
                    link.tooltip = `${formatAuthors(entry.author)} (${entry.year}): ${entry.title?.slice(0, 50) || 'Untitled'}...`;
                } else {
                    link.tooltip = `Citation: ${key} (not in bibliography - click to search)`;
                }

                link.target = vscode.Uri.parse(
                    `command:scimax.ref.citeAction?${encodeURIComponent(JSON.stringify(key))}`
                );

                links.push(link);
                keyOffset += key.length + 1; // +1 for comma
            }
        }

        // Other patterns (single key only)
        const singleKeyPatterns = [
            // org-mode 9.5+ citation: [cite:@key] or [cite/style:@key]
            { regex: /\[cite(?:\/[^\]]*)?:@([a-zA-Z0-9_:-]+)[^\]]*\]/g, group: 1 },
            // Pandoc/markdown: [@key] or @key
            { regex: /\[@([a-zA-Z0-9_:-]+)\]/g, group: 1 },
            { regex: /(?<![\\w@])@([a-zA-Z][a-zA-Z0-9_:-]*)/g, group: 1 },
            // LaTeX: \cite{key}
            { regex: /\\cite[pt]?\{([a-zA-Z0-9_:-]+)\}/g, group: 1 }
        ];

        for (const { regex, group } of singleKeyPatterns) {
            let match;
            while ((match = regex.exec(text)) !== null) {
                const key = match[group];
                const entry = this.manager.getEntry(key);

                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const range = new vscode.Range(startPos, endPos);

                const link = new vscode.DocumentLink(range);

                if (entry) {
                    link.tooltip = `${formatAuthors(entry.author)} (${entry.year}): ${entry.title?.slice(0, 50) || 'Untitled'}...`;
                } else {
                    link.tooltip = `Citation: ${key} (not in bibliography - click to search)`;
                }

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
                items.push({
                    label: '$(references) Citing Works (OpenAlex)',
                    description: 'Show papers that cite this work',
                    action: 'citingWorks'
                });
                items.push({
                    label: '$(telescope) Related Works (OpenAlex)',
                    description: 'Show related papers',
                    action: 'relatedWorks'
                });
                items.push({
                    label: '$(graph) View in OpenAlex',
                    description: 'Open in OpenAlex web interface',
                    action: 'openAlex'
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
                case 'citingWorks':
                    await vscode.commands.executeCommand('scimax.ref.showCitingWorks', entry.doi);
                    break;
                case 'relatedWorks':
                    await vscode.commands.executeCommand('scimax.ref.showRelatedWorks', entry.doi);
                    break;
                case 'openAlex':
                    await vscode.env.openExternal(vscode.Uri.parse(`https://openalex.org/works/doi:${entry.doi}`));
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

/**
 * Diagnostic provider for bibliography links
 * Shows errors for invalid/missing bibliography files
 */
export class BibliographyDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];

    constructor(private manager: ReferenceManager) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('bibliography');
    }

    /**
     * Initialize the diagnostic provider
     */
    public initialize(): void {
        // Update diagnostics for open documents
        if (vscode.window.activeTextEditor) {
            this.updateDiagnostics(vscode.window.activeTextEditor.document);
        }

        // Update on document open
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.updateDiagnostics(editor.document);
                }
            })
        );

        // Update on document change
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                this.updateDiagnostics(event.document);
            })
        );

        // Clear diagnostics when document closes
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(document => {
                this.diagnosticCollection.delete(document.uri);
            })
        );
    }

    /**
     * Update diagnostics for a document
     */
    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'org' && !document.fileName.endsWith('.org')) {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const docDir = path.dirname(document.uri.fsPath);

        // Match bibliography:path (with optional comma-separated paths)
        const bibLinkRegex = /bibliography:([^\s<>\[\](){}]+)/gi;
        // Match #+BIBLIOGRAPHY: path
        const bibKeywordRegex = /^(#\+BIBLIOGRAPHY:\s*)(.+?\.bib)\s*$/gim;

        let match;

        // Check bibliography: links
        while ((match = bibLinkRegex.exec(text)) !== null) {
            const bibPaths = match[1].split(',');
            let offset = match.index + 'bibliography:'.length;

            for (const bibPath of bibPaths) {
                const trimmed = bibPath.trim();
                if (trimmed) {
                    let resolved = trimmed;
                    if (resolved.startsWith('~')) {
                        resolved = resolved.replace('~', homeDir);
                    } else if (!path.isAbsolute(resolved)) {
                        resolved = path.resolve(docDir, resolved);
                    }
                    // Add .bib extension if missing
                    if (!resolved.endsWith('.bib')) {
                        resolved = resolved + '.bib';
                    }

                    // Check if file exists
                    if (!fs.existsSync(resolved)) {
                        const startPos = document.positionAt(offset);
                        const endPos = document.positionAt(offset + trimmed.length);
                        const range = new vscode.Range(startPos, endPos);

                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Bibliography file not found: ${resolved}`,
                            vscode.DiagnosticSeverity.Error
                        );
                        diagnostic.source = 'scimax-ref';
                        diagnostic.code = 'missing-bibliography';
                        diagnostics.push(diagnostic);
                    }
                }
                offset += trimmed.length + 1; // +1 for comma
            }
        }

        // Check #+BIBLIOGRAPHY: keywords
        while ((match = bibKeywordRegex.exec(text)) !== null) {
            const bibPath = match[2].trim();
            if (bibPath) {
                let resolved = bibPath;
                if (resolved.startsWith('~')) {
                    resolved = resolved.replace('~', homeDir);
                } else if (!path.isAbsolute(resolved)) {
                    resolved = path.resolve(docDir, resolved);
                }

                if (!fs.existsSync(resolved)) {
                    const lineStart = text.lastIndexOf('\n', match.index) + 1;
                    const lineNum = document.positionAt(match.index).line;
                    const startChar = match[1].length;
                    const endChar = startChar + match[2].length;

                    const range = new vscode.Range(
                        new vscode.Position(lineNum, startChar),
                        new vscode.Position(lineNum, endChar)
                    );

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Bibliography file not found: ${resolved}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'scimax-ref';
                    diagnostic.code = 'missing-bibliography';
                    diagnostics.push(diagnostic);
                }
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.diagnosticCollection.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
