/**
 * CLI Settings - Read VS Code settings for CLI operations
 *
 * This module reads the same settings that the VS Code extension uses,
 * ensuring CLI commands behave identically to the extension.
 */

import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

/**
 * Database settings (scimax.db.*)
 */
export interface DbSettings {
    include: string[];
    exclude: string[];
    maxFileSizeMB: number;
    maxFileLines: number;
}

/**
 * Agenda settings (scimax.agenda.*)
 */
export interface AgendaSettings {
    includeJournal: boolean;
    includeWorkspace: boolean;
    includeProjects: boolean;
    include: string[];
    exclude: string[];
    defaultSpan: number;
    showDone: boolean;
    showHabits: boolean;
    requireTodoState: boolean;
    todoStates: string[];
    doneStates: string[];
}

/**
 * Export settings (scimax.export.*)
 */
export interface ExportSettings {
    latex: {
        documentClass: string;
        classOptions: string;
        customHeader: string;
        defaultPreamble: string;
    };
    pdf: {
        compiler: string;
        bibtexCommand: string;
        extraArgs: string;
        shellEscape: string;
        cleanAuxFiles: boolean;
    };
    ipynb: {
        defaultKernel: string;
        embedImages: boolean;
        includeResults: boolean;
    };
}

/**
 * Journal settings (scimax.journal.*)
 */
export interface JournalSettings {
    directory: string;
    format: string;
    dateFormat: string;
}

/**
 * Reference settings (scimax.ref.*)
 */
export interface RefSettings {
    bibliographyFiles: string[];
    pdfDirectory: string;
    notesDirectory: string;
    citationSyntax: string;
}

/**
 * Embedding settings (scimax.db.* - embedding related)
 */
export interface EmbeddingSettings {
    provider: 'ollama' | 'none';
    ollamaUrl: string;
    ollamaModel: string;
}

/**
 * All scimax settings
 */
export interface ScimaxSettings {
    db: DbSettings;
    agenda: AgendaSettings;
    export: ExportSettings;
    journal: JournalSettings;
    ref: RefSettings;
    embedding: EmbeddingSettings;
}

/**
 * Get VS Code settings.json path for current platform
 */
export function getVSCodeSettingsPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const platform = process.platform;

    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    } else if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json');
    } else {
        return path.join(home, '.config', 'Code', 'User', 'settings.json');
    }
}

/**
 * Read and parse VS Code settings.json
 * Handles JSONC (comments) and control characters in string values
 */
function readVSCodeSettings(): Record<string, unknown> {
    try {
        const settingsPath = getVSCodeSettingsPath();
        if (!fs.existsSync(settingsPath)) {
            return {};
        }

        const content = fs.readFileSync(settingsPath, 'utf-8');

        // Try full JSON parse first (fastest if it works)
        try {
            // Remove single-line and multi-line comments
            const jsonContent = content
                .replace(/\/\/.*$/gm, '')
                .replace(/\/\*[\s\S]*?\*\//g, '');
            return JSON.parse(jsonContent);
        } catch {
            // Full parse failed, extract scimax settings with regex
        }

        // Fallback: Extract scimax.* settings using regex
        // This handles malformed JSON from other extensions
        const result: Record<string, unknown> = {};
        const settingRegex = /"(scimax\.[^"]+)":\s*("(?:[^"\\]|\\.)*"|true|false|null|\d+(?:\.\d+)?|\[[\s\S]*?\]|\{[\s\S]*?\})/g;

        let match;
        while ((match = settingRegex.exec(content)) !== null) {
            const key = match[1];
            const valueStr = match[2];
            try {
                result[key] = JSON.parse(valueStr);
            } catch {
                // If individual value parse fails, try with escaping
                try {
                    const escaped = valueStr.replace(/[\x00-\x1f]/g, (c) => {
                        if (c === '\n') return '\\n';
                        if (c === '\r') return '\\r';
                        if (c === '\t') return '\\t';
                        return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
                    });
                    result[key] = JSON.parse(escaped);
                } catch {
                    // Skip this setting
                }
            }
        }

        return result;
    } catch (err) {
        // Log error for debugging but don't crash
        console.error('Warning: Failed to read VS Code settings:', err instanceof Error ? err.message : String(err));
        return {};
    }
}

/**
 * Expand ~ to home directory in path
 */
export function expandPath(p: string): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (p.startsWith('~')) {
        return p.replace(/^~/, home);
    }
    return p;
}

/**
 * Check if a file path should be excluded based on patterns
 * Uses the same logic as ScimaxDb.shouldIgnore()
 */
export function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
    for (const pattern of excludePatterns) {
        // Expand ~ in pattern
        const expandedPattern = expandPath(pattern);

        if (pattern.includes('*')) {
            // It's a glob pattern - use minimatch
            if (minimatch(filePath, expandedPattern, { matchBase: true })) {
                return true;
            }
        } else {
            // It's an absolute path
            if (filePath === expandedPattern || filePath.startsWith(expandedPattern + path.sep)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Get a setting value with type safety and default fallback
 */
function getSetting<T>(settings: Record<string, unknown>, key: string, defaultValue: T): T {
    const value = settings[key];
    if (value === undefined) {
        return defaultValue;
    }
    return value as T;
}

/**
 * Load all scimax settings from VS Code settings.json
 */
export function loadSettings(): ScimaxSettings {
    const settings = readVSCodeSettings();

    // Default exclude patterns (same as ScimaxDb defaults)
    const defaultDbExclude = [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.ipynb_checkpoints/**'
    ];

    // Default agenda exclude patterns
    const defaultAgendaExclude = [
        '**/node_modules/**',
        '**/.git/**',
        '**/archive/**'
    ];

    return {
        db: {
            include: getSetting<string[]>(settings, 'scimax.db.include', []),
            exclude: getSetting<string[]>(settings, 'scimax.db.exclude', defaultDbExclude),
            maxFileSizeMB: getSetting<number>(settings, 'scimax.db.maxFileSizeMB', 10),
            maxFileLines: getSetting<number>(settings, 'scimax.db.maxFileLines', 5000),
        },
        agenda: {
            includeJournal: getSetting<boolean>(settings, 'scimax.agenda.includeJournal', true),
            includeWorkspace: getSetting<boolean>(settings, 'scimax.agenda.includeWorkspace', true),
            includeProjects: getSetting<boolean>(settings, 'scimax.agenda.includeProjects', true),
            include: getSetting<string[]>(settings, 'scimax.agenda.include', []),
            exclude: getSetting<string[]>(settings, 'scimax.agenda.exclude', defaultAgendaExclude),
            defaultSpan: getSetting<number>(settings, 'scimax.agenda.defaultSpan', 7),
            showDone: getSetting<boolean>(settings, 'scimax.agenda.showDone', false),
            showHabits: getSetting<boolean>(settings, 'scimax.agenda.showHabits', true),
            requireTodoState: getSetting<boolean>(settings, 'scimax.agenda.requireTodoState', true),
            todoStates: getSetting<string[]>(settings, 'scimax.agenda.todoStates', ['TODO', 'NEXT', 'WAITING']),
            doneStates: getSetting<string[]>(settings, 'scimax.agenda.doneStates', ['DONE', 'CANCELLED']),
        },
        export: {
            latex: {
                documentClass: getSetting<string>(settings, 'scimax.export.latex.documentClass', 'article'),
                classOptions: getSetting<string>(settings, 'scimax.export.latex.classOptions', '12pt,letterpaper'),
                customHeader: getSetting<string>(settings, 'scimax.export.latex.customHeader', ''),
                defaultPreamble: getSetting<string>(settings, 'scimax.export.latex.defaultPreamble', ''),
            },
            pdf: {
                compiler: getSetting<string>(settings, 'scimax.export.pdf.compiler', 'latexmk-lualatex'),
                bibtexCommand: getSetting<string>(settings, 'scimax.export.pdf.bibtexCommand', 'biber'),
                extraArgs: getSetting<string>(settings, 'scimax.export.pdf.extraArgs', ''),
                shellEscape: getSetting<string>(settings, 'scimax.export.pdf.shellEscape', 'restricted'),
                cleanAuxFiles: getSetting<boolean>(settings, 'scimax.export.pdf.cleanAuxFiles', true),
            },
            ipynb: {
                defaultKernel: getSetting<string>(settings, 'scimax.export.ipynb.defaultKernel', 'python3'),
                embedImages: getSetting<boolean>(settings, 'scimax.export.ipynb.embedImages', true),
                includeResults: getSetting<boolean>(settings, 'scimax.export.ipynb.includeResults', true),
            },
        },
        journal: {
            directory: getSetting<string>(settings, 'scimax.journal.directory', ''),
            format: getSetting<string>(settings, 'scimax.journal.format', 'org'),
            dateFormat: getSetting<string>(settings, 'scimax.journal.dateFormat', 'YYYY-MM-DD'),
        },
        ref: {
            bibliographyFiles: getSetting<string[]>(settings, 'scimax.ref.bibliographyFiles', []),
            pdfDirectory: getSetting<string>(settings, 'scimax.ref.pdfDirectory', ''),
            notesDirectory: getSetting<string>(settings, 'scimax.ref.notesDirectory', ''),
            citationSyntax: getSetting<string>(settings, 'scimax.ref.citationSyntax', 'org-ref-v3'),
        },
        embedding: {
            provider: getSetting<'ollama' | 'none'>(settings, 'scimax.db.embeddingProvider', 'none'),
            ollamaUrl: getSetting<string>(settings, 'scimax.db.ollamaUrl', 'http://localhost:11434'),
            ollamaModel: getSetting<string>(settings, 'scimax.db.ollamaModel', 'nomic-embed-text'),
        },
    };
}

/**
 * Find org files in a directory, respecting exclude patterns
 * This is the unified file discovery function that matches extension behavior
 */
export function findOrgFiles(
    dir: string,
    excludePatterns: string[],
    options: { maxFileSizeMB?: number } = {}
): string[] {
    const files: string[] = [];
    const maxBytes = (options.maxFileSizeMB || 10) * 1024 * 1024;

    const scan = (currentDir: string): void => {
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                // Check if path should be excluded
                if (shouldExclude(fullPath, excludePatterns)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    // Skip hidden directories (except those explicitly included)
                    if (entry.name.startsWith('.')) {
                        continue;
                    }
                    scan(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.org')) {
                    // Check file size
                    try {
                        const stats = fs.statSync(fullPath);
                        if (stats.size <= maxBytes) {
                            files.push(fullPath);
                        }
                    } catch {
                        // Skip files we can't stat
                    }
                }
            }
        } catch {
            // Ignore permission errors
        }
    };

    scan(dir);
    return files;
}

/**
 * Get directories to scan for org files
 * Combines configured includes with workspace/journal directories
 */
export function getDirectoriesToScan(settings: ScimaxSettings): string[] {
    const dirs: string[] = [];

    // Add scimax.db.include directories
    for (const dir of settings.db.include) {
        const expanded = expandPath(dir);
        if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
            dirs.push(expanded);
        }
    }

    // Add journal directory
    if (settings.journal.directory) {
        const expanded = expandPath(settings.journal.directory);
        if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
            if (!dirs.includes(expanded)) {
                dirs.push(expanded);
            }
        }
    }

    // Add agenda include directories
    for (const dir of settings.agenda.include) {
        const expanded = expandPath(dir);
        if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
            if (!dirs.includes(expanded)) {
                dirs.push(expanded);
            }
        }
    }

    return dirs;
}
