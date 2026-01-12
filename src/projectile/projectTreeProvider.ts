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

/**
 * Tree data provider for projects sidebar
 */
export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private manager: ProjectileManager) {
        // Refresh when projects change
        manager.onProjectsChanged(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ProjectItem): Thenable<ProjectItem[]> {
        if (element) {
            // Projects don't have children
            return Promise.resolve([]);
        }

        const projects = this.manager.getProjects();
        const currentFolders = vscode.workspace.workspaceFolders || [];
        const currentPaths = new Set(currentFolders.map(f => f.uri.fsPath));

        const items = projects.map(project =>
            new ProjectItem(project, currentPaths.has(project.path))
        );

        return Promise.resolve(items);
    }
}
