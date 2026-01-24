import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import {
    BibEntry,
    parseBibTeX,
    formatCitation,
    formatAuthors,
    searchEntries,
    entryToBibTeX,
    generateKey,
    OrgCitationSyntax
} from './bibtexParser';

export interface ReferenceConfig {
    bibliographyFiles: string[];
    pdfDirectory: string;
    notesDirectory: string;
    defaultCiteStyle: 'cite' | 'citet' | 'citep' | 'citeauthor' | 'citeyear';
    citationSyntax: OrgCitationSyntax;
    autoDownloadPdf: boolean;
}

/**
 * Manages bibliography entries and reference operations
 */
export class ReferenceManager {
    private entries: Map<string, BibEntry> = new Map();
    private config: ReferenceConfig;
    private context: vscode.ExtensionContext;
    private fileWatchers: vscode.FileSystemWatcher[] = [];
    private _onDidUpdateEntries = new vscode.EventEmitter<void>();
    readonly onDidUpdateEntries = this._onDidUpdateEntries.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();

        // Watch for config changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.ref')) {
                this.reloadConfig();
            }
        });
    }

    /**
     * Load configuration from VS Code settings
     */
    private loadConfig(): ReferenceConfig {
        const config = vscode.workspace.getConfiguration('scimax.ref');
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';

        return {
            bibliographyFiles: config.get<string[]>('bibliographyFiles') || [],
            pdfDirectory: (config.get<string>('pdfDirectory') || '').replace('~', homeDir),
            notesDirectory: (config.get<string>('notesDirectory') || '').replace('~', homeDir),
            defaultCiteStyle: config.get<'cite' | 'citet' | 'citep' | 'citeauthor' | 'citeyear'>('defaultCiteStyle') || 'cite',
            citationSyntax: config.get<OrgCitationSyntax>('citationSyntax') || 'org-ref-v3',
            autoDownloadPdf: config.get<boolean>('autoDownloadPdf') || false
        };
    }

    /**
     * Reload configuration
     */
    public reloadConfig(): void {
        this.config = this.loadConfig();
        this.loadBibliographies();
    }

    /**
     * Get current config
     */
    public getConfig(): ReferenceConfig {
        return this.config;
    }

    /**
     * Initialize and load all bibliographies
     */
    public async initialize(): Promise<void> {
        await this.loadBibliographies();
        this.setupFileWatchers();
    }

    /**
     * Load all configured bibliography files
     */
    public async loadBibliographies(): Promise<void> {
        this.entries.clear();
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';

        for (const bibPath of this.config.bibliographyFiles) {
            const resolvedPath = bibPath.replace('~', homeDir);
            await this.loadBibFile(resolvedPath);
        }

        // Also look for .bib files in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const bibFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*.bib'),
                    '**/node_modules/**'
                );
                for (const bibUri of bibFiles) {
                    if (!this.config.bibliographyFiles.includes(bibUri.fsPath)) {
                        await this.loadBibFile(bibUri.fsPath);
                    }
                }
            }
        }

        this._onDidUpdateEntries.fire();
    }

    /**
     * Load a single .bib file (async to avoid blocking extension host)
     */
    private async loadBibFile(filePath: string): Promise<void> {
        try {
            // Use async file operations to avoid blocking the extension host
            try {
                await fsPromises.access(filePath);
            } catch {
                console.warn(`Bibliography file not found: ${filePath}`);
                return;
            }

            const content = await fsPromises.readFile(filePath, 'utf8');
            const result = parseBibTeX(content);

            for (const entry of result.entries) {
                // Store with file path for later reference
                (entry as any)._sourceFile = filePath;
                this.entries.set(entry.key, entry);
            }

            if (result.errors.length > 0) {
                console.warn(`Parse errors in ${filePath}:`, result.errors);
            }
        } catch (error) {
            console.error(`Failed to load ${filePath}:`, error);
        }
    }

    /**
     * Setup file watchers for bibliography files
     */
    private setupFileWatchers(): void {
        // Clean up existing watchers
        for (const watcher of this.fileWatchers) {
            watcher.dispose();
        }
        this.fileWatchers = [];

        // Watch for .bib file changes
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.bib');

        watcher.onDidChange(() => this.loadBibliographies());
        watcher.onDidCreate(() => this.loadBibliographies());
        watcher.onDidDelete(() => this.loadBibliographies());

        this.fileWatchers.push(watcher);
    }

    /**
     * Extract bibliography file paths from document text
     * Looks for bibliography: links and #+BIBLIOGRAPHY: keywords
     */
    public extractBibliographyPaths(documentText: string, documentPath: string): string[] {
        const paths: string[] = [];
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const docDir = path.dirname(documentPath);

        // Match bibliography:path1,path2 (comma-separated)
        const bibLinkRegex = /bibliography:([^\s<>\[\](){}]+)/gi;
        // Match #+BIBLIOGRAPHY: path
        const bibKeywordRegex = /^#\+BIBLIOGRAPHY:\s*(.+?\.bib)\s*$/gim;

        let match;

        // Extract from bibliography: links
        while ((match = bibLinkRegex.exec(documentText)) !== null) {
            const bibPaths = match[1].split(',');
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
                    if (!paths.includes(resolved)) {
                        paths.push(resolved);
                    }
                }
            }
        }

        // Extract from #+BIBLIOGRAPHY: keywords
        while ((match = bibKeywordRegex.exec(documentText)) !== null) {
            const bibPath = match[1].trim();
            if (bibPath) {
                let resolved = bibPath;
                if (resolved.startsWith('~')) {
                    resolved = resolved.replace('~', homeDir);
                } else if (!path.isAbsolute(resolved)) {
                    resolved = path.resolve(docDir, resolved);
                }
                if (!paths.includes(resolved)) {
                    paths.push(resolved);
                }
            }
        }

        return paths;
    }

    /**
     * Load bibliography entries from document-local bibliography links
     * Returns the entries found in those files (doesn't add to global entries)
     */
    public async loadDocumentBibliographies(document: vscode.TextDocument): Promise<BibEntry[]> {
        const bibPaths = this.extractBibliographyPaths(document.getText(), document.uri.fsPath);
        const entries: BibEntry[] = [];

        for (const bibPath of bibPaths) {
            try {
                await fsPromises.access(bibPath);
                const content = await fsPromises.readFile(bibPath, 'utf8');
                const result = parseBibTeX(content);

                for (const entry of result.entries) {
                    (entry as any)._sourceFile = bibPath;
                    entries.push(entry);
                    // Also add to global entries so they're available
                    if (!this.entries.has(entry.key)) {
                        this.entries.set(entry.key, entry);
                    }
                }
            } catch {
                // File doesn't exist or can't be read - will be handled by diagnostics
            }
        }

        return entries;
    }

    /**
     * Get all entries, optionally loading document-local bibliographies first
     */
    public getAllEntries(): BibEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * Get entry by key
     */
    public getEntry(key: string): BibEntry | undefined {
        return this.entries.get(key);
    }

    /**
     * Search entries
     */
    public search(query: string): BibEntry[] {
        return searchEntries(this.getAllEntries(), query);
    }

    /**
     * Find entry by DOI in a specific file only
     */
    public findByDOIInFile(doi: string, filePath: string): BibEntry | undefined {
        if (!doi || !filePath) return undefined;
        const normalizedDoi = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');

        // Check if file is open in editor (get latest content)
        const openDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.fsPath === filePath
        );

        const content = openDoc ? openDoc.getText() :
            (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');

        if (!content) return undefined;

        const result = parseBibTeX(content);
        for (const entry of result.entries) {
            if (entry.doi) {
                const entryDoi = entry.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
                if (entryDoi === normalizedDoi) {
                    return entry;
                }
            }
        }
        return undefined;
    }

    /**
     * Find entry by DOI, returns entry and source file
     */
    public findByDOI(doi: string): { entry: BibEntry; sourceFile: string } | undefined {
        if (!doi) return undefined;
        const normalizedDoi = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');

        // Search through each bib file to find the entry and its source
        for (const bibFile of this.config.bibliographyFiles) {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            const bibPath = bibFile.replace('~', homeDir);

            if (!fs.existsSync(bibPath)) continue;

            const content = fs.readFileSync(bibPath, 'utf8');
            const result = parseBibTeX(content);

            for (const entry of result.entries) {
                if (entry.doi) {
                    const entryDoi = entry.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
                    if (entryDoi === normalizedDoi) {
                        return { entry, sourceFile: bibPath };
                    }
                }
            }
        }

        // Also check any open bib documents not in config
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'bibtex') {
                const bibPath = doc.uri.fsPath;
                // Skip if already checked via config
                const homeDir = process.env.HOME || process.env.USERPROFILE || '';
                const configPaths = this.config.bibliographyFiles.map(f => f.replace('~', homeDir));
                if (configPaths.includes(bibPath)) continue;

                const result = parseBibTeX(doc.getText());
                for (const entry of result.entries) {
                    if (entry.doi) {
                        const entryDoi = entry.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
                        if (entryDoi === normalizedDoi) {
                            return { entry, sourceFile: bibPath };
                        }
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Show entry in its source file
     */
    public async showEntryInFile(entry: BibEntry): Promise<void> {
        // Find which file contains this entry
        for (const bibFile of this.config.bibliographyFiles) {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            const bibPath = bibFile.replace('~', homeDir);

            if (!fs.existsSync(bibPath)) continue;

            const content = fs.readFileSync(bibPath, 'utf8');
            const keyPattern = new RegExp(`@\\w+\\s*\\{\\s*${entry.key}\\s*,`, 'i');
            const match = keyPattern.exec(content);

            if (match) {
                // Found the entry - open file and go to position
                const doc = await vscode.workspace.openTextDocument(bibPath);
                const editor = await vscode.window.showTextDocument(doc);

                // Find line number
                const lines = content.substring(0, match.index).split('\n');
                const lineNumber = lines.length - 1;

                const pos = new vscode.Position(lineNumber, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                return;
            }
        }
    }

    /**
     * Get PDF path for an entry
     */
    public getPdfPath(entry: BibEntry): string | undefined {
        if (!this.config.pdfDirectory) return undefined;

        // Try various naming conventions
        const possibleNames = [
            `${entry.key}.pdf`,
            `${entry.author?.split(',')[0] || 'unknown'}_${entry.year || 'unknown'}.pdf`,
            entry.doi ? `${entry.doi.replace(/\//g, '_')}.pdf` : null
        ].filter(Boolean) as string[];

        for (const name of possibleNames) {
            const pdfPath = path.join(this.config.pdfDirectory, name);
            if (fs.existsSync(pdfPath)) {
                return pdfPath;
            }
        }

        return undefined;
    }

    /**
     * Get notes path for an entry
     */
    public getNotesPath(entry: BibEntry): string {
        const notesDir = this.config.notesDirectory ||
            path.join(this.context.globalStorageUri.fsPath, 'notes');

        if (!fs.existsSync(notesDir)) {
            fs.mkdirSync(notesDir, { recursive: true });
        }

        return path.join(notesDir, `${entry.key}.org`);
    }

    /**
     * Open or create notes for an entry
     */
    public async openNotes(entry: BibEntry): Promise<void> {
        const notesPath = this.getNotesPath(entry);

        if (!fs.existsSync(notesPath)) {
            // Create notes template
            const template = `#+TITLE: Notes on ${entry.title || entry.key}
#+AUTHOR: ${formatAuthors(entry.author)}
#+DATE: ${entry.year || 'n.d.'}
#+CITE_KEY: ${entry.key}

* Summary

* Key Points
-

* Quotes
#+BEGIN_QUOTE

#+END_QUOTE

* Notes

* References

`;
            fs.writeFileSync(notesPath, template, 'utf8');
        }

        const doc = await vscode.workspace.openTextDocument(notesPath);
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Fetch BibTeX from DOI using CrossRef API
     */
    public async fetchFromDOI(doi: string): Promise<BibEntry | null> {
        // Clean DOI
        doi = doi.replace(/^https?:\/\/doi\.org\//, '').trim();

        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.crossref.org',
                path: `/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`,
                method: 'GET',
                headers: {
                    'Accept': 'application/x-bibtex',
                    'User-Agent': 'scimax-vscode/1.0 (https://github.com/jkitchin/scimax_vscode)'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        const result = parseBibTeX(data);
                        if (result.entries.length > 0) {
                            resolve(result.entries[0]);
                        } else {
                            resolve(null);
                        }
                    } else if (res.statusCode === 404) {
                        resolve(null);
                    } else {
                        reject(new Error(`CrossRef returned status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });

            req.end();
        });
    }

    /**
     * Add entry to bibliography file
     */
    public async addEntry(entry: BibEntry, targetFile?: string): Promise<void> {
        // Determine target file
        let bibPath = targetFile;
        let sourceReason = 'provided as argument';

        if (!bibPath) {
            // First priority: currently focused .bib file
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document.languageId === 'bibtex') {
                bibPath = activeEditor.document.uri.fsPath;
                sourceReason = 'active editor is bibtex';
            }
            // Second priority: any visible .bib file editor
            if (!bibPath) {
                const visibleBibEditor = vscode.window.visibleTextEditors.find(
                    editor => editor.document.languageId === 'bibtex'
                );
                if (visibleBibEditor) {
                    bibPath = visibleBibEditor.document.uri.fsPath;
                    sourceReason = 'visible bibtex editor';
                }
            }
            // Third priority: any open .bib file in workspace
            if (!bibPath) {
                const openBibDoc = vscode.workspace.textDocuments.find(
                    doc => doc.languageId === 'bibtex'
                );
                if (openBibDoc) {
                    bibPath = openBibDoc.uri.fsPath;
                    sourceReason = 'open bibtex document';
                }
            }
            // Fourth priority: first configured bibliography file
            if (!bibPath && this.config.bibliographyFiles.length > 0) {
                const homeDir = process.env.HOME || process.env.USERPROFILE || '';
                bibPath = this.config.bibliographyFiles[0].replace('~', homeDir);
                sourceReason = 'configured bibliography file';
            }
            // Last resort: create default bibliography
            if (!bibPath) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    bibPath = path.join(workspaceFolder.uri.fsPath, 'references.bib');
                    sourceReason = 'default references.bib in workspace';
                } else {
                    throw new Error('No bibliography file configured and no workspace open');
                }
            }
        }

        // Append to file
        const bibtex = entryToBibTeX(entry);

        // Check if the file is open in an editor - if so, use workspace edit for immediate update
        const openDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.fsPath === bibPath
        );

        if (openDoc) {
            // File is open - use workspace edit to update the editor directly
            const edit = new vscode.WorkspaceEdit();
            const lastLine = openDoc.lineCount - 1;
            const lastChar = openDoc.lineAt(lastLine).text.length;
            const endPosition = new vscode.Position(lastLine, lastChar);
            edit.insert(openDoc.uri, endPosition, '\n' + bibtex);
            await vscode.workspace.applyEdit(edit);
            // Save the document
            await openDoc.save();
        } else {
            // File is not open - write directly
            const existingContent = fs.existsSync(bibPath) ? fs.readFileSync(bibPath, 'utf8') : '';
            const newContent = existingContent + '\n' + bibtex;
            fs.writeFileSync(bibPath, newContent, 'utf8');
        }

        // Reload bibliography cache
        await this.loadBibliographies();

        const fileName = path.basename(bibPath);
        vscode.window.showInformationMessage(`Added entry "${entry.key}" to ${fileName}`);
    }

    /**
     * Add entry with unique key (appends suffix if key exists)
     */
    public async addEntryWithUniqueKey(entry: BibEntry, targetFile?: string): Promise<void> {
        // Generate unique key if needed
        let key = entry.key;
        let suffix = 0;
        while (this.entries.has(key)) {
            suffix++;
            // Append letter suffix: a, b, c, ...
            const letter = String.fromCharCode(96 + suffix); // 'a' = 97
            key = `${entry.key}${letter}`;
        }
        entry.key = key;

        await this.addEntry(entry, targetFile);
    }

    /**
     * Remove entry from bibliography file by key
     */
    public async removeEntry(key: string): Promise<boolean> {
        const entry = this.entries.get(key);
        if (!entry) {
            return false;
        }

        // Find which file contains this entry
        for (const bibFile of this.config.bibliographyFiles) {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            const bibPath = bibFile.replace('~', homeDir);

            if (!fs.existsSync(bibPath)) continue;

            const content = fs.readFileSync(bibPath, 'utf8');

            // Match the entry pattern: @type{key, ... }
            // This regex finds the entire entry block
            const entryPattern = new RegExp(
                `@\\w+\\s*\\{\\s*${key}\\s*,[^@]*?\\n\\}`,
                'gs'
            );

            if (entryPattern.test(content)) {
                const newContent = content.replace(entryPattern, '').replace(/\n{3,}/g, '\n\n');

                // Check if file is open in editor
                const openDoc = vscode.workspace.textDocuments.find(
                    doc => doc.uri.fsPath === bibPath
                );

                if (openDoc) {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        new vscode.Position(0, 0),
                        new vscode.Position(openDoc.lineCount - 1, openDoc.lineAt(openDoc.lineCount - 1).text.length)
                    );
                    edit.replace(openDoc.uri, fullRange, newContent);
                    await vscode.workspace.applyEdit(edit);
                    await openDoc.save();
                } else {
                    fs.writeFileSync(bibPath, newContent, 'utf8');
                }

                await this.loadBibliographies();
                return true;
            }
        }

        return false;
    }

    /**
     * Open PDF for entry
     */
    public async openPdf(entry: BibEntry): Promise<boolean> {
        const pdfPath = this.getPdfPath(entry);
        if (pdfPath) {
            await vscode.env.openExternal(vscode.Uri.file(pdfPath));
            return true;
        }

        // Try to open from DOI
        if (entry.doi) {
            const action = await vscode.window.showInformationMessage(
                'PDF not found locally. Open DOI in browser?',
                'Open DOI', 'Cancel'
            );
            if (action === 'Open DOI') {
                await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${entry.doi}`));
                return true;
            }
        }

        return false;
    }

    /**
     * Open URL/DOI for entry
     */
    public async openUrl(entry: BibEntry): Promise<boolean> {
        if (entry.doi) {
            await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${entry.doi}`));
            return true;
        }
        if (entry.url) {
            await vscode.env.openExternal(vscode.Uri.parse(entry.url));
            return true;
        }
        return false;
    }

    /**
     * Format entry for display in quick pick
     */
    public formatForQuickPick(entry: BibEntry): vscode.QuickPickItem & { entry: BibEntry } {
        const author = formatAuthors(entry.author, 2);
        const year = entry.year || 'n.d.';
        const title = entry.title || 'Untitled';

        return {
            label: `$(book) ${entry.key}`,
            description: `${author} (${year})`,
            detail: title.length > 80 ? title.substring(0, 80) + '...' : title,
            entry
        };
    }

    /**
     * Get statistics
     */
    public getStats(): { totalEntries: number; byType: Record<string, number> } {
        const byType: Record<string, number> = {};

        for (const entry of this.entries.values()) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
        }

        return {
            totalEntries: this.entries.size,
            byType
        };
    }

    /**
     * Find all citations of a key in workspace
     */
    public async findCitations(key: string): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];

        // Search patterns for different citation styles
        const patterns = [
            `cite:${key}`,
            `citet:${key}`,
            `citep:${key}`,
            `@${key}`,
            `\\cite{${key}}`,
            `\\citet{${key}}`,
            `\\citep{${key}}`
        ];

        const files = await vscode.workspace.findFiles('**/*.{org,md,tex}', '**/node_modules/**');

        for (const fileUri of files) {
            try {
                const content = fs.readFileSync(fileUri.fsPath, 'utf8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    for (const pattern of patterns) {
                        const index = lines[i].indexOf(pattern);
                        if (index !== -1) {
                            const position = new vscode.Position(i, index);
                            const location = new vscode.Location(fileUri, position);
                            locations.push(location);
                        }
                    }
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }

        return locations;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        for (const watcher of this.fileWatchers) {
            watcher.dispose();
        }
        this._onDidUpdateEntries.dispose();
    }
}
