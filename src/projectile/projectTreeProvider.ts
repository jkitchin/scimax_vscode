import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectileManager, Project } from './projectileManager';

/**
 * Tree item representing a project
 */
class ProjectItem extends vscode.TreeItem {
    constructor(
        public readonly project: Project,
        public readonly isCurrentProject: boolean
    ) {
        super(project.name, vscode.TreeItemCollapsibleState.None);

        this.tooltip = project.path;
        this.description = this.getDescription();
        this.iconPath = this.getIcon();
        this.contextValue = 'project';

        // Click to switch project
        this.command = {
            command: 'scimax.projectile.openProject',
            title: 'Open Project',
            arguments: [project]
        };
    }

    private getDescription(): string {
        if (this.isCurrentProject) {
            return '● current';
        }
        if (this.project.lastOpened) {
            return this.formatRelativeTime(this.project.lastOpened);
        }
        return '';
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.isCurrentProject) {
            return new vscode.ThemeIcon('folder-opened', new vscode.ThemeColor('charts.green'));
        }
        switch (this.project.type) {
            case 'git':
                return new vscode.ThemeIcon('git-branch');
            case 'projectile':
                return new vscode.ThemeIcon('file');
            default:
                return new vscode.ThemeIcon('folder');
        }
    }

    private formatRelativeTime(timestamp: number): string {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 30) return `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    }
}

export type ProjectSortBy = 'recent' | 'name' | 'name-desc';

/**
 * Tree data provider for projects sidebar
 */
export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private filterText: string = '';
    private sortBy: ProjectSortBy = 'recent';
    private treeView: vscode.TreeView<ProjectItem> | null = null;

    constructor(private manager: ProjectileManager) {
        // Refresh when projects change
        manager.onProjectsChanged(() => this.refresh());
    }

    /**
     * Set the tree view reference for updating description
     */
    setTreeView(treeView: vscode.TreeView<ProjectItem>): void {
        this.treeView = treeView;
        this.updateDescription();
    }

    private updateDescription(): void {
        if (this.treeView) {
            const count = this.manager.getProjects().length;
            this.treeView.description = `${count} projects`;
        }
    }

    refresh(): void {
        this.updateDescription();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Set the filter text for project search
     */
    setFilter(text: string): void {
        this.filterText = text.toLowerCase();
        this.refresh();
    }

    /**
     * Get the current filter text
     */
    getFilter(): string {
        return this.filterText;
    }

    /**
     * Set the sort order for projects
     */
    setSortBy(sort: ProjectSortBy): void {
        this.sortBy = sort;
        this.refresh();
    }

    /**
     * Get the current sort order
     */
    getSortBy(): ProjectSortBy {
        return this.sortBy;
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ProjectItem): Thenable<ProjectItem[]> {
        if (element) {
            // Projects don't have children
            return Promise.resolve([]);
        }

        let projects = this.manager.getProjects();
        const currentFolders = vscode.workspace.workspaceFolders || [];
        const currentPaths = new Set(currentFolders.map(f => f.uri.fsPath));

        // Apply filter
        if (this.filterText) {
            projects = projects.filter(project =>
                project.name.toLowerCase().includes(this.filterText) ||
                project.path.toLowerCase().includes(this.filterText)
            );
        }

        // Apply sort
        projects = [...projects].sort((a, b) => {
            switch (this.sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'name-desc':
                    return b.name.localeCompare(a.name);
                case 'recent':
                default:
                    // Sort by lastOpened descending (most recent first)
                    return (b.lastOpened || 0) - (a.lastOpened || 0);
            }
        });

        const items = projects.map(project =>
            new ProjectItem(project, currentPaths.has(project.path))
        );

        return Promise.resolve(items);
    }
}
