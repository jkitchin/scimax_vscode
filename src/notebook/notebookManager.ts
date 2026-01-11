import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Project/Notebook configuration stored in .scimax/config.json
 */
export interface NotebookConfig {
    name: string;
    description?: string;
    keywords?: string[];
    collaborators?: Collaborator[];
    masterFile?: string;
    journalDirectory?: string;
    bibliographyFiles?: string[];
    customCommands?: Record<string, string>;
}

export interface Collaborator {
    name: string;
    email: string;
    role?: string;
}

/**
 * Project/Notebook metadata
 */
export interface Notebook {
    id: string;
    name: string;
    path: string;
    description?: string;
    masterFile?: string;
    hasGit: boolean;
    hasProjectile: boolean;
    created: number;
    lastAccessed: number;
    config?: NotebookConfig;
}

/**
 * Markers used to identify project roots
 */
const PROJECT_MARKERS = [
    '.projectile',
    '.git',
    '.scimax',
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    '.project'
];

/**
 * Notebook Manager - Project-based organization inspired by scimax-notebook
 */
export class NotebookManager {
    private notebooks: Map<string, Notebook> = new Map();
    private currentNotebook: Notebook | undefined;
    private dataPath: string;
    private context: vscode.ExtensionContext;
    private _onNotebookChanged = new vscode.EventEmitter<Notebook | undefined>();
    public readonly onNotebookChanged = this._onNotebookChanged.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.dataPath = path.join(context.globalStorageUri.fsPath, 'notebooks.json');
    }

    /**
     * Initialize the notebook manager
     */
    public async initialize(): Promise<void> {
        const storageDir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        await this.load();
        this.detectWorkspaceProjects();
    }

    /**
     * Load notebooks from disk
     */
    private async load(): Promise<void> {
        try {
            if (fs.existsSync(this.dataPath)) {
                const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
                for (const nb of data.notebooks || []) {
                    this.notebooks.set(nb.path, nb);
                }
                console.log(`NotebookManager: Loaded ${this.notebooks.size} notebooks`);
            }
        } catch (error) {
            console.error('NotebookManager: Failed to load', error);
        }
    }

    /**
     * Save notebooks to disk
     */
    public async save(): Promise<void> {
        try {
            const data = {
                notebooks: Array.from(this.notebooks.values())
            };
            fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error('NotebookManager: Failed to save', error);
        }
    }

    /**
     * Detect projects in workspace folders
     */
    private detectWorkspaceProjects(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        for (const folder of workspaceFolders) {
            const projectRoot = this.findProjectRoot(folder.uri.fsPath);
            if (projectRoot) {
                this.registerNotebook(projectRoot);
            }
        }
    }

    /**
     * Find project root by looking for markers
     */
    private findProjectRoot(startPath: string): string | undefined {
        let current = startPath;
        const root = path.parse(current).root;

        while (current !== root) {
            for (const marker of PROJECT_MARKERS) {
                const markerPath = path.join(current, marker);
                if (fs.existsSync(markerPath)) {
                    return current;
                }
            }
            current = path.dirname(current);
        }

        return undefined;
    }

    /**
     * Register a notebook/project
     */
    public registerNotebook(projectPath: string): Notebook {
        const existing = this.notebooks.get(projectPath);
        if (existing) {
            existing.lastAccessed = Date.now();
            return existing;
        }

        const config = this.loadConfig(projectPath);
        const hasGit = fs.existsSync(path.join(projectPath, '.git'));
        const hasProjectile = fs.existsSync(path.join(projectPath, '.projectile'));

        const notebook: Notebook = {
            id: this.generateId(projectPath),
            name: config?.name || path.basename(projectPath),
            path: projectPath,
            description: config?.description,
            masterFile: this.findMasterFile(projectPath, config),
            hasGit,
            hasProjectile,
            created: Date.now(),
            lastAccessed: Date.now(),
            config
        };

        this.notebooks.set(projectPath, notebook);
        return notebook;
    }

    /**
     * Load notebook configuration from .scimax/config.json
     */
    private loadConfig(projectPath: string): NotebookConfig | undefined {
        const configPath = path.join(projectPath, '.scimax', 'config.json');
        try {
            if (fs.existsSync(configPath)) {
                return JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch (error) {
            console.error(`Failed to load config for ${projectPath}`, error);
        }
        return undefined;
    }

    /**
     * Save notebook configuration
     */
    public async saveConfig(projectPath: string, config: NotebookConfig): Promise<void> {
        const scimaxDir = path.join(projectPath, '.scimax');
        if (!fs.existsSync(scimaxDir)) {
            fs.mkdirSync(scimaxDir, { recursive: true });
        }

        const configPath = path.join(scimaxDir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

        const notebook = this.notebooks.get(projectPath);
        if (notebook) {
            notebook.config = config;
            notebook.name = config.name || notebook.name;
            notebook.description = config.description;
        }
    }

    /**
     * Find the master/entry file for a project
     */
    private findMasterFile(projectPath: string, config?: NotebookConfig): string | undefined {
        if (config?.masterFile) {
            const masterPath = path.join(projectPath, config.masterFile);
            if (fs.existsSync(masterPath)) {
                return masterPath;
            }
        }

        const candidates = [
            'README.org',
            'README.md',
            'index.org',
            'index.md',
            'main.org',
            'main.md'
        ];

        for (const candidate of candidates) {
            const candidatePath = path.join(projectPath, candidate);
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        }

        return undefined;
    }

    /**
     * Generate unique ID for a notebook
     */
    private generateId(projectPath: string): string {
        const hash = Buffer.from(projectPath).toString('base64')
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 12);
        return `nb-${hash}`;
    }

    /**
     * Create a new notebook/project
     */
    public async createNotebook(options: {
        name: string;
        directory: string;
        description?: string;
        initGit?: boolean;
        template?: 'empty' | 'research' | 'software' | 'notes';
    }): Promise<Notebook> {
        const projectPath = path.join(options.directory, options.name);

        // Create directory structure
        fs.mkdirSync(projectPath, { recursive: true });
        fs.mkdirSync(path.join(projectPath, '.scimax'), { recursive: true });

        // Create .projectile marker
        fs.writeFileSync(path.join(projectPath, '.projectile'), '');

        // Create config
        const config: NotebookConfig = {
            name: options.name,
            description: options.description,
            keywords: [],
            collaborators: []
        };

        // Apply template
        await this.applyTemplate(projectPath, options.template || 'empty', config);

        // Save config
        await this.saveConfig(projectPath, config);

        // Initialize git if requested
        if (options.initGit) {
            try {
                const { exec } = require('child_process');
                await new Promise<void>((resolve, reject) => {
                    exec('git init', { cwd: projectPath }, (error: any) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
            } catch (error) {
                console.error('Failed to initialize git', error);
            }
        }

        // Register and return
        const notebook = this.registerNotebook(projectPath);
        await this.save();

        return notebook;
    }

    /**
     * Apply a project template
     */
    private async applyTemplate(
        projectPath: string,
        template: string,
        config: NotebookConfig
    ): Promise<void> {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];

        switch (template) {
            case 'research':
                config.masterFile = 'README.org';
                fs.writeFileSync(
                    path.join(projectPath, 'README.org'),
                    `#+TITLE: ${config.name}
#+AUTHOR:
#+DATE: ${dateStr}
#+DESCRIPTION: ${config.description || ''}

* Overview

* Literature Review

* Methods

* Results

* Discussion

* References
`
                );
                fs.mkdirSync(path.join(projectPath, 'data'), { recursive: true });
                fs.mkdirSync(path.join(projectPath, 'figures'), { recursive: true });
                fs.mkdirSync(path.join(projectPath, 'scripts'), { recursive: true });
                fs.writeFileSync(path.join(projectPath, 'references.bib'), '');
                break;

            case 'software':
                config.masterFile = 'README.md';
                fs.writeFileSync(
                    path.join(projectPath, 'README.md'),
                    `# ${config.name}

${config.description || ''}

## Installation

## Usage

## Development

## License
`
                );
                fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
                fs.mkdirSync(path.join(projectPath, 'tests'), { recursive: true });
                fs.mkdirSync(path.join(projectPath, 'docs'), { recursive: true });
                break;

            case 'notes':
                config.masterFile = 'index.org';
                config.journalDirectory = 'journal';
                fs.writeFileSync(
                    path.join(projectPath, 'index.org'),
                    `#+TITLE: ${config.name} Notes
#+DATE: ${dateStr}

* Topics

* Journal
See [[file:journal/][journal entries]].

* References
`
                );
                fs.mkdirSync(path.join(projectPath, 'journal'), { recursive: true });
                break;

            case 'empty':
            default:
                config.masterFile = 'README.org';
                fs.writeFileSync(
                    path.join(projectPath, 'README.org'),
                    `#+TITLE: ${config.name}
#+DATE: ${dateStr}

* ${config.name}

${config.description || ''}
`
                );
                break;
        }
    }

    /**
     * Open/switch to a notebook
     */
    public async openNotebook(notebook: Notebook): Promise<void> {
        notebook.lastAccessed = Date.now();
        this.currentNotebook = notebook;
        this._onNotebookChanged.fire(notebook);

        // Open master file if available
        if (notebook.masterFile && fs.existsSync(notebook.masterFile)) {
            const doc = await vscode.workspace.openTextDocument(notebook.masterFile);
            await vscode.window.showTextDocument(doc);
        }

        await this.save();
    }

    /**
     * Get current notebook
     */
    public getCurrentNotebook(): Notebook | undefined {
        return this.currentNotebook;
    }

    /**
     * Get all notebooks
     */
    public getNotebooks(): Notebook[] {
        return Array.from(this.notebooks.values())
            .sort((a, b) => b.lastAccessed - a.lastAccessed);
    }

    /**
     * Get recent notebooks
     */
    public getRecentNotebooks(limit: number = 10): Notebook[] {
        return this.getNotebooks().slice(0, limit);
    }

    /**
     * Search notebooks by name or description
     */
    public searchNotebooks(query: string): Notebook[] {
        const queryLower = query.toLowerCase();
        return this.getNotebooks().filter(nb =>
            nb.name.toLowerCase().includes(queryLower) ||
            nb.description?.toLowerCase().includes(queryLower) ||
            nb.config?.keywords?.some(k => k.toLowerCase().includes(queryLower))
        );
    }

    /**
     * Get notebook for a file path
     */
    public getNotebookForFile(filePath: string): Notebook | undefined {
        for (const notebook of this.notebooks.values()) {
            if (filePath.startsWith(notebook.path)) {
                return notebook;
            }
        }

        // Try to find project root
        const projectRoot = this.findProjectRoot(path.dirname(filePath));
        if (projectRoot) {
            return this.registerNotebook(projectRoot);
        }

        return undefined;
    }

    /**
     * List files in a notebook
     */
    public async listNotebookFiles(notebook: Notebook, pattern?: string): Promise<string[]> {
        const files: string[] = [];
        const extensions = ['.org', '.md'];

        const walk = (dir: string) => {
            try {
                const items = fs.readdirSync(dir, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path.join(dir, item.name);

                    // Skip hidden directories
                    if (item.isDirectory() && item.name.startsWith('.')) continue;
                    // Skip common non-content directories
                    if (item.isDirectory() && ['node_modules', 'dist', 'build', '.git'].includes(item.name)) continue;

                    if (item.isDirectory()) {
                        walk(fullPath);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        if (extensions.includes(ext)) {
                            if (!pattern || item.name.includes(pattern)) {
                                files.push(fullPath);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Error walking ${dir}`, error);
            }
        };

        walk(notebook.path);
        return files;
    }

    /**
     * Get recent files in a notebook
     */
    public async getRecentFiles(notebook: Notebook, limit: number = 20): Promise<string[]> {
        const files = await this.listNotebookFiles(notebook);

        // Sort by modification time
        const filesWithStats = files.map(f => ({
            path: f,
            mtime: fs.statSync(f).mtimeMs
        }));

        filesWithStats.sort((a, b) => b.mtime - a.mtime);

        return filesWithStats.slice(0, limit).map(f => f.path);
    }

    /**
     * Add collaborator to notebook
     */
    public async addCollaborator(notebook: Notebook, collaborator: Collaborator): Promise<void> {
        if (!notebook.config) {
            notebook.config = { name: notebook.name };
        }
        if (!notebook.config.collaborators) {
            notebook.config.collaborators = [];
        }

        notebook.config.collaborators.push(collaborator);
        await this.saveConfig(notebook.path, notebook.config);
    }

    /**
     * Archive a notebook (create zip of committed files)
     */
    public async archiveNotebook(notebook: Notebook): Promise<string | undefined> {
        if (!notebook.hasGit) {
            vscode.window.showWarningMessage('Notebook must be a git repository to archive');
            return undefined;
        }

        const archiveName = `${notebook.name}-${new Date().toISOString().split('T')[0]}.zip`;
        const archivePath = path.join(path.dirname(notebook.path), archiveName);

        try {
            const { exec } = require('child_process');
            await new Promise<void>((resolve, reject) => {
                exec(
                    `git archive --format=zip --output="${archivePath}" HEAD`,
                    { cwd: notebook.path },
                    (error: any) => {
                        if (error) reject(error);
                        else resolve();
                    }
                );
            });

            vscode.window.showInformationMessage(`Archive created: ${archivePath}`);
            return archivePath;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create archive: ${error}`);
            return undefined;
        }
    }

    /**
     * Remove a notebook from tracking (doesn't delete files)
     */
    public removeNotebook(notebook: Notebook): void {
        this.notebooks.delete(notebook.path);
        if (this.currentNotebook?.path === notebook.path) {
            this.currentNotebook = undefined;
            this._onNotebookChanged.fire(undefined);
        }
    }

    /**
     * Dispose
     */
    public dispose(): void {
        this._onNotebookChanged.dispose();
    }
}
