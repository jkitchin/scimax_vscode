/**
 * Journal Abbreviation Service
 *
 * Manages journal name abbreviations for BibTeX entries.
 * Data sourced from JabRef's abbreviation repository:
 * https://github.com/JabRef/abbrv.jabref.org
 *
 * Features:
 * - Toggle between full journal name and ISO 4 abbreviation
 * - Multiple discipline-specific abbreviation lists
 * - User-customizable overrides
 * - Online update capability
 *
 * Data Sources:
 * - JabRef abbreviation repository (https://abbrv.jabref.org/)
 * - ISSN LTWA (List of Title Word Abbreviations) - ISO 4 standard
 * - CASSI (Chemical Abstracts Service Source Index) for chemistry
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as https from 'https';

/**
 * Available abbreviation sources from JabRef repository
 */
export const ABBREVIATION_SOURCES = {
    general: {
        name: 'General',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_general.csv',
        description: 'General/cross-discipline abbreviations'
    },
    acs: {
        name: 'ACS (Chemistry)',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_acs.csv',
        description: 'American Chemical Society journals'
    },
    aea: {
        name: 'AEA (Economics)',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_aea.csv',
        description: 'American Economic Association journals'
    },
    ams: {
        name: 'AMS (Mathematics)',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_ams.csv',
        description: 'American Mathematical Society journals'
    },
    astronomy: {
        name: 'Astronomy',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_astronomy.csv',
        description: 'Astronomy and astrophysics journals'
    },
    entrez: {
        name: 'Entrez/PubMed',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_entrez.csv',
        description: 'Medline (dotless) abbreviations from PubMed'
    },
    geology_physics: {
        name: 'Geology & Physics',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_geology_physics.csv',
        description: 'Geology and physics journals'
    },
    ieee: {
        name: 'IEEE',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_ieee.csv',
        description: 'IEEE journals and conferences'
    },
    lifescience: {
        name: 'Life Science',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_lifescience.csv',
        description: 'Life science and biology journals'
    },
    mathematics: {
        name: 'Mathematics',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_mathematics.csv',
        description: 'Mathematics journals from MathSciNet'
    },
    mechanical: {
        name: 'Mechanical & Biomechanical',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_mechanical.csv',
        description: 'Mechanical and biomechanical engineering journals'
    },
    medicus: {
        name: 'Index Medicus',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_medicus.csv',
        description: 'Index Medicus/NLM abbreviations'
    },
    meteorology: {
        name: 'Meteorology',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_meteorology.csv',
        description: 'Meteorology and atmospheric science journals'
    },
    sociology: {
        name: 'Sociology',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_sociology.csv',
        description: 'Sociology journals'
    },
    webofscience: {
        name: 'Web of Science',
        url: 'https://raw.githubusercontent.com/JabRef/abbrv.jabref.org/main/journals/journal_abbreviations_webofscience-dots.csv',
        description: 'Web of Science abbreviations (with dots)'
    }
} as const;

export type AbbreviationSourceKey = keyof typeof ABBREVIATION_SOURCES;

interface JournalEntry {
    fullName: string;
    abbreviation: string;
    shortestAbbreviation?: string;
    source: string;
}

/**
 * Journal Abbreviation Service
 * Provides lookup and toggle functionality for journal abbreviations
 */
export class JournalAbbreviationService {
    private fullToAbbrev: Map<string, JournalEntry> = new Map();
    private abbrevToFull: Map<string, JournalEntry> = new Map();
    private context: vscode.ExtensionContext;
    private initialized: boolean = false;
    private _onDidUpdate = new vscode.EventEmitter<void>();
    readonly onDidUpdate = this._onDidUpdate.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Initialize the service by loading all abbreviations
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        await this.loadAllAbbreviations();
        this.initialized = true;
    }

    /**
     * Get the data directory path
     */
    private getDataDir(): string {
        return path.join(this.context.extensionPath, 'data', 'journal-abbreviations');
    }

    /**
     * Get path for user custom abbreviations
     */
    private getUserAbbreviationsPath(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'journal-abbreviations-custom.csv');
    }

    /**
     * Load all abbreviations from bundled CSV files and user customizations
     */
    public async loadAllAbbreviations(): Promise<void> {
        this.fullToAbbrev.clear();
        this.abbrevToFull.clear();

        const dataDir = this.getDataDir();

        // Load bundled abbreviations
        if (fs.existsSync(dataDir)) {
            const files = await fsPromises.readdir(dataDir);
            for (const file of files) {
                if (file.endsWith('.csv')) {
                    const filePath = path.join(dataDir, file);
                    const source = file.replace('.csv', '').replace('journal_abbreviations_', '');
                    await this.loadCsvFile(filePath, source);
                }
            }
        }

        // Load user custom abbreviations (these override bundled ones)
        const userPath = this.getUserAbbreviationsPath();
        if (fs.existsSync(userPath)) {
            await this.loadCsvFile(userPath, 'custom');
        }

        console.log(`Journal abbreviations loaded: ${this.fullToAbbrev.size} entries`);
        this._onDidUpdate.fire();
    }

    /**
     * Load abbreviations from a CSV file
     * Format: "Full Name","Abbreviation"[,"Shortest Abbreviation"]
     */
    private async loadCsvFile(filePath: string, source: string): Promise<void> {
        try {
            const content = await fsPromises.readFile(filePath, 'utf8');
            const lines = content.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;

                // Parse CSV line - handle quoted fields
                const fields = this.parseCsvLine(trimmed);
                if (fields.length < 2) continue;

                const fullName = fields[0].trim();
                const abbreviation = fields[1].trim();
                const shortestAbbreviation = fields[2]?.trim();

                if (!fullName || !abbreviation) continue;

                const entry: JournalEntry = {
                    fullName,
                    abbreviation,
                    shortestAbbreviation,
                    source
                };

                // Normalize keys for case-insensitive lookup
                const fullKey = this.normalizeKey(fullName);
                const abbrevKey = this.normalizeKey(abbreviation);

                // Only add if not already present (first source wins, except custom overrides)
                if (source === 'custom' || !this.fullToAbbrev.has(fullKey)) {
                    this.fullToAbbrev.set(fullKey, entry);
                }
                if (source === 'custom' || !this.abbrevToFull.has(abbrevKey)) {
                    this.abbrevToFull.set(abbrevKey, entry);
                }

                // Also map shortest abbreviation if present
                if (shortestAbbreviation) {
                    const shortKey = this.normalizeKey(shortestAbbreviation);
                    if (source === 'custom' || !this.abbrevToFull.has(shortKey)) {
                        this.abbrevToFull.set(shortKey, entry);
                    }
                }
            }
        } catch (error) {
            console.warn(`Failed to load abbreviations from ${filePath}:`, error);
        }
    }

    /**
     * Parse a CSV line handling quoted fields
     */
    private parseCsvLine(line: string): string[] {
        const fields: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                fields.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        fields.push(current);

        return fields;
    }

    /**
     * Normalize a key for case-insensitive lookup
     */
    private normalizeKey(name: string): string {
        return name.toLowerCase()
            .replace(/[.,:;]/g, '')  // Remove punctuation
            .replace(/\s+/g, ' ')     // Normalize whitespace
            .trim();
    }

    /**
     * Look up abbreviation for a full journal name
     */
    public getAbbreviation(fullName: string): string | undefined {
        const key = this.normalizeKey(fullName);
        const entry = this.fullToAbbrev.get(key);
        return entry?.abbreviation;
    }

    /**
     * Look up full name for an abbreviation
     */
    public getFullName(abbreviation: string): string | undefined {
        const key = this.normalizeKey(abbreviation);
        const entry = this.abbrevToFull.get(key);
        return entry?.fullName;
    }

    /**
     * Toggle a journal name between full and abbreviated forms
     * Returns the toggled form, or undefined if not found
     */
    public toggle(journalName: string): { result: string; wasAbbreviated: boolean } | undefined {
        const key = this.normalizeKey(journalName);

        // First check if it's a full name
        const fromFull = this.fullToAbbrev.get(key);
        if (fromFull) {
            return { result: fromFull.abbreviation, wasAbbreviated: false };
        }

        // Then check if it's an abbreviation
        const fromAbbrev = this.abbrevToFull.get(key);
        if (fromAbbrev) {
            return { result: fromAbbrev.fullName, wasAbbreviated: true };
        }

        return undefined;
    }

    /**
     * Check if a journal name is recognized (full or abbreviated)
     */
    public isKnown(journalName: string): boolean {
        const key = this.normalizeKey(journalName);
        return this.fullToAbbrev.has(key) || this.abbrevToFull.has(key);
    }

    /**
     * Get entry info for a journal name
     */
    public getEntry(journalName: string): JournalEntry | undefined {
        const key = this.normalizeKey(journalName);
        return this.fullToAbbrev.get(key) || this.abbrevToFull.get(key);
    }

    /**
     * Add a custom abbreviation (persisted to user file)
     */
    public async addCustomAbbreviation(fullName: string, abbreviation: string): Promise<void> {
        const userPath = this.getUserAbbreviationsPath();

        // Ensure directory exists
        const userDir = path.dirname(userPath);
        if (!fs.existsSync(userDir)) {
            await fsPromises.mkdir(userDir, { recursive: true });
        }

        // Append to user file
        const line = `"${fullName.replace(/"/g, '""')}","${abbreviation.replace(/"/g, '""')}"\n`;

        await fsPromises.appendFile(userPath, line, 'utf8');

        // Update in-memory maps
        const entry: JournalEntry = {
            fullName,
            abbreviation,
            source: 'custom'
        };

        const fullKey = this.normalizeKey(fullName);
        const abbrevKey = this.normalizeKey(abbreviation);

        this.fullToAbbrev.set(fullKey, entry);
        this.abbrevToFull.set(abbrevKey, entry);

        this._onDidUpdate.fire();
    }

    /**
     * Remove a custom abbreviation
     */
    public async removeCustomAbbreviation(fullName: string): Promise<boolean> {
        const userPath = this.getUserAbbreviationsPath();

        if (!fs.existsSync(userPath)) {
            return false;
        }

        const content = await fsPromises.readFile(userPath, 'utf8');
        const lines = content.split('\n');
        const normalizedTarget = this.normalizeKey(fullName);

        const newLines = lines.filter(line => {
            const fields = this.parseCsvLine(line.trim());
            if (fields.length < 2) return true;
            return this.normalizeKey(fields[0]) !== normalizedTarget;
        });

        if (newLines.length === lines.length) {
            return false; // Not found
        }

        await fsPromises.writeFile(userPath, newLines.join('\n'), 'utf8');

        // Reload to update in-memory maps
        await this.loadAllAbbreviations();

        return true;
    }

    /**
     * Get all custom abbreviations
     */
    public async getCustomAbbreviations(): Promise<JournalEntry[]> {
        const userPath = this.getUserAbbreviationsPath();

        if (!fs.existsSync(userPath)) {
            return [];
        }

        const entries: JournalEntry[] = [];
        const content = await fsPromises.readFile(userPath, 'utf8');
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const fields = this.parseCsvLine(trimmed);
            if (fields.length < 2) continue;

            entries.push({
                fullName: fields[0].trim(),
                abbreviation: fields[1].trim(),
                shortestAbbreviation: fields[2]?.trim(),
                source: 'custom'
            });
        }

        return entries;
    }

    /**
     * Download abbreviation list from JabRef repository
     */
    public async downloadAbbreviations(sourceKey: AbbreviationSourceKey): Promise<void> {
        const source = ABBREVIATION_SOURCES[sourceKey];
        if (!source) {
            throw new Error(`Unknown source: ${sourceKey}`);
        }

        return new Promise((resolve, reject) => {
            const dataDir = this.getDataDir();
            const filename = `journal_abbreviations_${sourceKey}.csv`;
            const filePath = path.join(dataDir, filename);

            // Ensure directory exists
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            const file = fs.createWriteStream(filePath);

            https.get(source.url, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    // Handle redirect
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        https.get(redirectUrl, (redirectResponse) => {
                            redirectResponse.pipe(file);
                            file.on('finish', () => {
                                file.close();
                                resolve();
                            });
                        }).on('error', (err) => {
                            fs.unlink(filePath, () => { });
                            reject(err);
                        });
                    } else {
                        reject(new Error('Redirect without location'));
                    }
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(filePath, () => { });
                reject(err);
            });
        });
    }

    /**
     * Download all abbreviation lists
     */
    public async downloadAllAbbreviations(
        progress?: (source: string, current: number, total: number) => void
    ): Promise<{ success: string[]; failed: string[] }> {
        const sources = Object.keys(ABBREVIATION_SOURCES) as AbbreviationSourceKey[];
        const success: string[] = [];
        const failed: string[] = [];

        for (let i = 0; i < sources.length; i++) {
            const sourceKey = sources[i];
            const source = ABBREVIATION_SOURCES[sourceKey];

            if (progress) {
                progress(source.name, i + 1, sources.length);
            }

            try {
                await this.downloadAbbreviations(sourceKey);
                success.push(source.name);
            } catch (error) {
                console.error(`Failed to download ${source.name}:`, error);
                failed.push(source.name);
            }
        }

        // Reload abbreviations after download
        await this.loadAllAbbreviations();

        return { success, failed };
    }

    /**
     * Get statistics about loaded abbreviations
     */
    public getStats(): { total: number; bySources: Record<string, number> } {
        const bySources: Record<string, number> = {};

        for (const entry of this.fullToAbbrev.values()) {
            bySources[entry.source] = (bySources[entry.source] || 0) + 1;
        }

        return {
            total: this.fullToAbbrev.size,
            bySources
        };
    }

    /**
     * Search for journals matching a query
     */
    public search(query: string, limit: number = 50): JournalEntry[] {
        const queryLower = query.toLowerCase();
        const results: JournalEntry[] = [];

        for (const entry of this.fullToAbbrev.values()) {
            if (results.length >= limit) break;

            if (entry.fullName.toLowerCase().includes(queryLower) ||
                entry.abbreviation.toLowerCase().includes(queryLower)) {
                results.push(entry);
            }
        }

        return results;
    }

    /**
     * Check if abbreviation data is available
     */
    public isDataAvailable(): boolean {
        const dataDir = this.getDataDir();
        if (!fs.existsSync(dataDir)) return false;

        const files = fs.readdirSync(dataDir);
        return files.some(f => f.endsWith('.csv'));
    }

    /**
     * Get list of available abbreviation sources
     */
    public getAvailableSources(): { key: string; name: string; description: string; installed: boolean }[] {
        const dataDir = this.getDataDir();
        const installedFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

        return Object.entries(ABBREVIATION_SOURCES).map(([key, source]) => ({
            key,
            name: source.name,
            description: source.description,
            installed: installedFiles.includes(`journal_abbreviations_${key}.csv`)
        }));
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this._onDidUpdate.dispose();
    }
}

// Singleton instance
let abbreviationService: JournalAbbreviationService | undefined;

/**
 * Get the journal abbreviation service instance
 */
export function getJournalAbbreviationService(context?: vscode.ExtensionContext): JournalAbbreviationService {
    if (!abbreviationService) {
        if (!context) {
            throw new Error('JournalAbbreviationService not initialized');
        }
        abbreviationService = new JournalAbbreviationService(context);
    }
    return abbreviationService;
}
