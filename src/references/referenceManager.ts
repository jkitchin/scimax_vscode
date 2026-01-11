import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import {
    BibEntry,
    parseBibTeX,
    formatCitation,
    formatAuthors,
    searchEntries,
    entryToBibTeX,
    generateKey
} from './bibtexParser';

export interface ReferenceConfig {
    bibliographyFiles: string[];
    pdfDirectory: string;
    notesDirectory: string;
    defaultCiteStyle: 'cite' | 'citet' | 'citep' | 'citeauthor' | 'citeyear';
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
        console.log(`ReferenceManager: Loaded ${this.entries.size} entries`);
    }

    /**
     * Load a single .bib file
     */
    private async loadBibFile(filePath: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) {
                console.warn(`Bibliography file not found: ${filePath}`);
                return;
            }

            const content = fs.readFileSync(filePath, 'utf8');
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
     * Get all entries
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
        if (!bibPath) {
            if (this.config.bibliographyFiles.length > 0) {
                const homeDir = process.env.HOME || process.env.USERPROFILE || '';
                bibPath = this.config.bibliographyFiles[0].replace('~', homeDir);
            } else {
                // Create default bibliography
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    bibPath = path.join(workspaceFolder.uri.fsPath, 'references.bib');
                } else {
                    throw new Error('No bibliography file configured and no workspace open');
                }
            }
        }

        // Check for duplicate key
        if (this.entries.has(entry.key)) {
            const action = await vscode.window.showWarningMessage(
                `Entry with key "${entry.key}" already exists. Replace it?`,
                'Replace', 'Generate New Key', 'Cancel'
            );

            if (action === 'Cancel') {
                return;
            } else if (action === 'Generate New Key') {
                entry.key = generateKey(
                    entry.author || 'unknown',
                    entry.year || new Date().getFullYear().toString(),
                    entry.title || 'untitled'
                );
            }
        }

        // Append to file
        const bibtex = entryToBibTeX(entry);
        const existingContent = fs.existsSync(bibPath) ? fs.readFileSync(bibPath, 'utf8') : '';
        const newContent = existingContent + '\n' + bibtex;
        fs.writeFileSync(bibPath, newContent, 'utf8');

        // Reload
        await this.loadBibliographies();

        vscode.window.showInformationMessage(`Added entry: ${entry.key}`);
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
