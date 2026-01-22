import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ScimaxDb, ProjectRecord } from '../database/scimaxDb';

export interface Project {
    name: string;
    path: string;
    type: 'git' | 'projectile' | 'manual';
    lastOpened?: number;
}

/**
 * Convert ProjectRecord from database to Project interface
 */
function projectRecordToProject(record: ProjectRecord): Project {
    return {
        name: record.name,
        path: record.path,
        type: record.type,
        lastOpened: record.last_opened || undefined
    };
}

/**
 * Projectile-style project manager
 * Tracks known projects and allows quick switching between them
 * Now uses ScimaxDb for persistence (with globalState fallback)
 */
export class ProjectileManager {
    private projects: Map<string, Project> = new Map();
    private context: vscode.ExtensionContext;
    private db: ScimaxDb | null = null;
    private _onProjectsChanged = new vscode.EventEmitter<void>();
    readonly onProjectsChanged = this._onProjectsChanged.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Set database reference for persistence
     * Must be called before initialize() for database-backed storage
     */
    setDatabase(db: ScimaxDb): void {
        this.db = db;
    }

    async initialize(): Promise<void> {
        // Load saved projects (prefer database if available)
        if (this.db) {
            const dbProjects = await this.db.getProjects();
            for (const record of dbProjects) {
                const project = projectRecordToProject(record);
                this.projects.set(project.path, project);
            }
        } else {
            // Fallback to globalState (for backward compatibility)
            const savedProjects = this.context.globalState.get<Project[]>('scimax.projects', []);
            for (const project of savedProjects) {
                this.projects.set(project.path, project);
            }
        }

        // Register current workspace as a project
        await this.registerCurrentWorkspace();

        // Watch for workspace changes
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await this.registerCurrentWorkspace();
        });

        // Notify listeners that projects have been loaded
        this._onProjectsChanged.fire();
    }

    /**
     * Register current workspace folder(s) as projects
     */
    private async registerCurrentWorkspace(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;

        for (const folder of folders) {
            await this.addProject(folder.uri.fsPath);
        }
    }

    /**
     * Add a project to the known projects list
     */
    async addProject(projectPath: string): Promise<Project | null> {
        // Normalize path
        projectPath = path.resolve(projectPath);

        // Check if directory exists
        if (!fs.existsSync(projectPath)) {
            return null;
        }

        // Determine project type
        const type = await this.detectProjectType(projectPath);

        const project: Project = {
            name: path.basename(projectPath),
            path: projectPath,
            type,
            lastOpened: Date.now()
        };

        // Save to database if available
        if (this.db) {
            await this.db.addProject(projectPath, project.name, type);
        }

        this.projects.set(projectPath, project);
        await this.saveProjects();
        this._onProjectsChanged.fire();

        return project;
    }

    /**
     * Detect if a directory is a git repo or has .projectile file
     */
    private async detectProjectType(projectPath: string): Promise<'git' | 'projectile' | 'manual'> {
        // Check for .git directory
        const gitPath = path.join(projectPath, '.git');
        if (fs.existsSync(gitPath)) {
            return 'git';
        }

        // Check for .projectile file
        const projectilePath = path.join(projectPath, '.projectile');
        if (fs.existsSync(projectilePath)) {
            return 'projectile';
        }

        return 'manual';
    }

    /**
     * Remove a project from the known projects list
     */
    async removeProject(projectPath: string): Promise<void> {
        projectPath = path.resolve(projectPath);

        // Remove from database if available
        if (this.db) {
            await this.db.removeProject(projectPath);
        }

        this.projects.delete(projectPath);
        await this.saveProjects();
        this._onProjectsChanged.fire();
    }

    /**
     * Get all known projects sorted by last opened
     */
    getProjects(): Project[] {
        return Array.from(this.projects.values())
            .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    }

    /**
     * Get a project by path
     */
    getProject(projectPath: string): Project | undefined {
        return this.projects.get(path.resolve(projectPath));
    }

    /**
     * Update last opened time for a project
     */
    async touchProject(projectPath: string): Promise<void> {
        projectPath = path.resolve(projectPath);
        const project = this.projects.get(projectPath);
        if (project) {
            project.lastOpened = Date.now();

            // Update in database if available
            if (this.db) {
                await this.db.touchProject(projectPath);
            }

            await this.saveProjects();
        }
    }

    /**
     * Save projects to global state (for backward compatibility)
     * Note: Database is the primary source of truth when available
     */
    private async saveProjects(): Promise<void> {
        // Always save to globalState for backward compatibility
        // (useful if user opens older version of extension)
        const projectsArray = Array.from(this.projects.values());
        await this.context.globalState.update('scimax.projects', projectsArray);
    }

    /**
     * Scan a directory for projects (git repos)
     * @param scanPath The directory to scan
     * @param maxDepth Maximum depth to scan (undefined = unlimited, uses config setting)
     */
    async scanDirectory(scanPath: string, maxDepth?: number): Promise<number> {
        // Get maxDepth from config if not provided
        if (maxDepth === undefined) {
            const configDepth = vscode.workspace.getConfiguration('scimax.projectile')
                .get<number>('scanMaxDepth');
            // undefined or 0 means unlimited
            maxDepth = configDepth === undefined || configDepth === 0 ? Infinity : configDepth;
        }

        let found = 0;

        const scan = async (dir: string, depth: number) => {
            if (depth > maxDepth!) return;

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                // Check if this directory is a project
                const isGit = entries.some(e => e.name === '.git' && e.isDirectory());
                const isProjectile = entries.some(e => e.name === '.projectile' && e.isFile());

                if (isGit || isProjectile) {
                    await this.addProject(dir);
                    found++;
                    // Continue scanning inside projects (nested projects are common)
                }

                // Scan subdirectories
                for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        await scan(path.join(dir, entry.name), depth + 1);
                    }
                }
            } catch (err) {
                // Ignore permission errors
            }
        };

        await scan(scanPath, 0);
        return found;
    }

    /**
     * Clear all projects that no longer exist
     */
    async cleanupProjects(): Promise<number> {
        // Use database cleanup if available
        if (this.db) {
            const removed = await this.db.cleanupProjects();

            // Sync local cache with database
            this.projects.clear();
            const dbProjects = await this.db.getProjects();
            for (const record of dbProjects) {
                const project = projectRecordToProject(record);
                this.projects.set(project.path, project);
            }

            await this.saveProjects();
            this._onProjectsChanged.fire();
            return removed;
        }

        // Fallback to local cleanup
        let removed = 0;
        const toRemove: string[] = [];

        for (const [projectPath, _] of this.projects) {
            if (!fs.existsSync(projectPath)) {
                toRemove.push(projectPath);
            }
        }

        for (const projectPath of toRemove) {
            this.projects.delete(projectPath);
            removed++;
        }

        if (removed > 0) {
            await this.saveProjects();
            this._onProjectsChanged.fire();
        }

        return removed;
    }

    dispose(): void {
        this._onProjectsChanged.dispose();
    }
}
