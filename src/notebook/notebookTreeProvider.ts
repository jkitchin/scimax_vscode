import * as vscode from 'vscode';
import * as path from 'path';
import { NotebookManager, Notebook } from './notebookManager';

type NotebookTreeItem = NotebookItem | NotebookSectionItem | NotebookFileItem | CollaboratorItem | InfoItem;

class NotebookItem extends vscode.TreeItem {
    constructor(
        public readonly notebook: Notebook,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(notebook.name, collapsibleState);
        this.tooltip = notebook.description || notebook.path;
        this.description = notebook.hasGit ? '$(git-branch)' : '';
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'notebook';
    }
}

class NotebookSectionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly notebook: Notebook,
        public readonly sectionType: 'files' | 'collaborators' | 'info'
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = `notebook-section-${sectionType}`;

        switch (sectionType) {
            case 'files':
                this.iconPath = new vscode.ThemeIcon('files');
                break;
            case 'collaborators':
                this.iconPath = new vscode.ThemeIcon('organization');
                break;
            case 'info':
                this.iconPath = new vscode.ThemeIcon('info');
                break;
        }
    }
}

class NotebookFileItem extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        public readonly notebook: Notebook
    ) {
        super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
        this.description = path.relative(notebook.path, path.dirname(filePath));
        this.tooltip = filePath;
        this.resourceUri = vscode.Uri.file(filePath);
        this.contextValue = 'notebook-file';

        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.org') {
            this.iconPath = new vscode.ThemeIcon('file-text');
        } else if (ext === '.md') {
            this.iconPath = new vscode.ThemeIcon('markdown');
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
        }

        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(filePath)]
        };
    }
}

class CollaboratorItem extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly email: string,
        public readonly role?: string
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = role || email;
        this.tooltip = `${name} <${email}>${role ? ` - ${role}` : ''}`;
        this.iconPath = new vscode.ThemeIcon('person');
        this.contextValue = 'notebook-collaborator';
    }
}

class InfoItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly value: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.contextValue = 'notebook-info';
    }
}

export class NotebookTreeProvider implements vscode.TreeDataProvider<NotebookTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NotebookTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private notebookManager: NotebookManager) {
        // Refresh when notebook changes
        notebookManager.onNotebookChanged(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NotebookTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: NotebookTreeItem): Promise<NotebookTreeItem[]> {
        if (!element) {
            // Root level: show all notebooks
            const notebooks = this.notebookManager.getNotebooks();
            return notebooks.map(nb => new NotebookItem(
                nb,
                vscode.TreeItemCollapsibleState.Collapsed
            ));
        }

        if (element instanceof NotebookItem) {
            // Show notebook sections
            return [
                new NotebookSectionItem('Files', element.notebook, 'files'),
                new NotebookSectionItem('Collaborators', element.notebook, 'collaborators'),
                new NotebookSectionItem('Info', element.notebook, 'info')
            ];
        }

        if (element instanceof NotebookSectionItem) {
            switch (element.sectionType) {
                case 'files':
                    return this.getFileItems(element.notebook);
                case 'collaborators':
                    return this.getCollaboratorItems(element.notebook);
                case 'info':
                    return this.getInfoItems(element.notebook);
            }
        }

        return [];
    }

    private async getFileItems(notebook: Notebook): Promise<NotebookFileItem[]> {
        const files = await this.notebookManager.getRecentFiles(notebook, 20);
        return files.map(f => new NotebookFileItem(f, notebook));
    }

    private getCollaboratorItems(notebook: Notebook): CollaboratorItem[] {
        const collaborators = notebook.config?.collaborators || [];
        return collaborators.map(c => new CollaboratorItem(c.name, c.email, c.role));
    }

    private getInfoItems(notebook: Notebook): InfoItem[] {
        const items: InfoItem[] = [];

        items.push(new InfoItem('Path', notebook.path));

        if (notebook.masterFile) {
            items.push(new InfoItem('Master File', path.basename(notebook.masterFile)));
        }

        items.push(new InfoItem('Git', notebook.hasGit ? 'Yes' : 'No'));
        items.push(new InfoItem('Created', new Date(notebook.created).toLocaleDateString()));
        items.push(new InfoItem('Last Accessed', new Date(notebook.lastAccessed).toLocaleDateString()));

        if (notebook.config?.keywords?.length) {
            items.push(new InfoItem('Keywords', notebook.config.keywords.join(', ')));
        }

        return items;
    }
}
