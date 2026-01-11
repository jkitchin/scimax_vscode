import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectileManager, Project } from './projectileManager';

/**
 * Switch to a project (C-c p p)
 */
async function switchProject(manager: ProjectileManager): Promise<void> {
    const projects = manager.getProjects();

    if (projects.length === 0) {
        const action = await vscode.window.showInformationMessage(
            'No projects found. Would you like to add a project?',
            'Add Project',
            'Scan Directory'
        );

        if (action === 'Add Project') {
            await addProject(manager);
        } else if (action === 'Scan Directory') {
            await scanForProjects(manager);
        }
        return;
    }

    const items: (vscode.QuickPickItem & { project: Project })[] = projects.map(p => ({
        label: p.name,
        description: p.path,
        detail: getProjectDetail(p),
        project: p
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Switch to project (C-c p p)',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        await openProject(manager, selected.project);
    }
}

/**
 * Get detail string for project
 */
function getProjectDetail(project: Project): string {
    const typeIcon = project.type === 'git' ? '$(git-branch)' :
                     project.type === 'projectile' ? '$(file)' : '$(folder)';
    const lastOpened = project.lastOpened
        ? `Last opened: ${formatRelativeTime(project.lastOpened)}`
        : '';
    return `${typeIcon} ${project.type} ${lastOpened}`;
}

/**
 * Format relative time
 */
function formatRelativeTime(timestamp: number): string {
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

/**
 * Open a project
 */
async function openProject(manager: ProjectileManager, project: Project): Promise<void> {
    const uri = vscode.Uri.file(project.path);

    // Update last opened time
    await manager.touchProject(project.path);

    // Check if project is already open
    const currentFolders = vscode.workspace.workspaceFolders || [];
    const isAlreadyOpen = currentFolders.some(f => f.uri.fsPath === project.path);

    if (isAlreadyOpen) {
        vscode.window.showInformationMessage(`Project ${project.name} is already open`);
        return;
    }

    // Ask how to open
    const openIn = await vscode.window.showQuickPick([
        { label: '$(window) New Window', value: 'new' },
        { label: '$(folder-opened) Current Window', value: 'current' },
        { label: '$(add) Add to Workspace', value: 'add' }
    ], {
        placeHolder: `Open ${project.name}`
    });

    if (!openIn) return;

    switch (openIn.value) {
        case 'new':
            await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
            break;
        case 'current':
            await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
            break;
        case 'add':
            vscode.workspace.updateWorkspaceFolders(
                vscode.workspace.workspaceFolders?.length || 0,
                0,
                { uri }
            );
            break;
    }
}

/**
 * Add a new project manually
 */
async function addProject(manager: ProjectileManager): Promise<void> {
    const result = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Add Project'
    });

    if (result && result[0]) {
        const project = await manager.addProject(result[0].fsPath);
        if (project) {
            vscode.window.showInformationMessage(`Added project: ${project.name}`);
        }
    }
}

/**
 * Remove a project from the list
 */
async function removeProject(manager: ProjectileManager): Promise<void> {
    const projects = manager.getProjects();

    if (projects.length === 0) {
        vscode.window.showInformationMessage('No projects to remove');
        return;
    }

    const items: (vscode.QuickPickItem & { project: Project })[] = projects.map(p => ({
        label: p.name,
        description: p.path,
        project: p
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select project to remove',
        matchOnDescription: true
    });

    if (selected) {
        await manager.removeProject(selected.project.path);
        vscode.window.showInformationMessage(`Removed project: ${selected.project.name}`);
    }
}

/**
 * Scan a directory for projects
 */
async function scanForProjects(manager: ProjectileManager): Promise<void> {
    const result = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Scan Directory'
    });

    if (result && result[0]) {
        const depthInput = await vscode.window.showInputBox({
            prompt: 'Max scan depth',
            value: '2',
            validateInput: v => /^\d+$/.test(v) ? null : 'Enter a number'
        });

        const depth = depthInput ? parseInt(depthInput) : 2;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Scanning for projects...',
            cancellable: false
        }, async () => {
            const found = await manager.scanDirectory(result[0].fsPath, depth);
            vscode.window.showInformationMessage(`Found ${found} projects`);
        });
    }
}

/**
 * Find file in project (C-c p f)
 */
async function findFileInProject(): Promise<void> {
    // Use VS Code's built-in file finder, scoped to workspace
    await vscode.commands.executeCommand('workbench.action.quickOpen');
}

/**
 * Search in project (C-c p s)
 */
async function searchInProject(): Promise<void> {
    // Open search panel
    await vscode.commands.executeCommand('workbench.action.findInFiles');
}

/**
 * Open project root (C-c p d)
 */
async function openProjectRoot(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showInformationMessage('No project open');
        return;
    }

    if (folders.length === 1) {
        // Open the single folder
        const uri = folders[0].uri;
        await vscode.commands.executeCommand('revealInExplorer', uri);
    } else {
        // Let user choose which folder
        const items = folders.map(f => ({
            label: f.name,
            description: f.uri.fsPath,
            folder: f
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select project root'
        });

        if (selected) {
            await vscode.commands.executeCommand('revealInExplorer', selected.folder.uri);
        }
    }
}

/**
 * Show project info
 */
async function showProjectInfo(manager: ProjectileManager): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showInformationMessage('No project open');
        return;
    }

    const project = manager.getProject(folders[0].uri.fsPath);
    if (project) {
        const info = [
            `Name: ${project.name}`,
            `Path: ${project.path}`,
            `Type: ${project.type}`,
            `Last opened: ${project.lastOpened ? new Date(project.lastOpened).toLocaleString() : 'Unknown'}`
        ].join('\n');

        vscode.window.showInformationMessage(info, { modal: true });
    } else {
        vscode.window.showInformationMessage(`Project: ${folders[0].name}\nPath: ${folders[0].uri.fsPath}`);
    }
}

/**
 * Cleanup projects that no longer exist
 */
async function cleanupProjects(manager: ProjectileManager): Promise<void> {
    const removed = await manager.cleanupProjects();
    vscode.window.showInformationMessage(`Cleaned up ${removed} non-existent projects`);
}

/**
 * Register all projectile commands
 */
export function registerProjectileCommands(
    context: vscode.ExtensionContext,
    manager: ProjectileManager
): void {
    context.subscriptions.push(
        // Main project switching (C-c p p)
        vscode.commands.registerCommand('scimax.projectile.switch', () => switchProject(manager)),

        // Find file in project (C-c p f)
        vscode.commands.registerCommand('scimax.projectile.findFile', findFileInProject),

        // Search in project (C-c p s)
        vscode.commands.registerCommand('scimax.projectile.search', searchInProject),

        // Open project root (C-c p d)
        vscode.commands.registerCommand('scimax.projectile.root', openProjectRoot),

        // Add project
        vscode.commands.registerCommand('scimax.projectile.add', () => addProject(manager)),

        // Remove project
        vscode.commands.registerCommand('scimax.projectile.remove', () => removeProject(manager)),

        // Scan for projects
        vscode.commands.registerCommand('scimax.projectile.scan', () => scanForProjects(manager)),

        // Project info
        vscode.commands.registerCommand('scimax.projectile.info', () => showProjectInfo(manager)),

        // Cleanup non-existent projects
        vscode.commands.registerCommand('scimax.projectile.cleanup', () => cleanupProjects(manager))
    );
}
