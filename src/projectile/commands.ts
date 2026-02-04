import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectileManager, Project } from './projectileManager';
import { walkDirectory } from '../shared';
import { showFuzzyQuickPick, FuzzyQuickPickItem } from '../utils/fuzzyQuickPick';

// Type for project quick pick items with buttons
type ProjectQuickPickItem = vscode.QuickPickItem & {
    project: Project;
    buttons?: vscode.QuickInputButton[];
    searchText?: string;
};

// Global reference to active project picker for M-o actions
let activeProjectPicker: vscode.QuickPick<ProjectQuickPickItem> | null = null;

// Button definitions
const excludeButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('trash'),
    tooltip: 'Exclude/Remove project [i]'
};

const findFileButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('go-to-file'),
    tooltip: 'Find file in project [f]'
};

/**
 * Switch to a project (C-c p p)
 * With alternate actions via M-o or item buttons
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

    const quickPick = vscode.window.createQuickPick<ProjectQuickPickItem>();
    quickPick.placeholder = 'Switch to project (C-c p p) - M-o for actions, space-separated terms';
    // Disable VS Code's built-in filtering - we do our own fuzzy matching
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;

    // Build items with buttons and searchText for fuzzy matching
    const items: ProjectQuickPickItem[] = projects.map(p => ({
        label: p.name,
        description: p.path,
        detail: getProjectDetail(p),
        project: p,
        buttons: [findFileButton, excludeButton],
        searchText: `${p.name} ${p.path} ${getProjectDetail(p) || ''}`.toLowerCase()
    }));
    quickPick.items = items;

    // Apply fuzzy filtering on input change (space-separated AND matching)
    const allItems = items;
    quickPick.onDidChangeValue(value => {
        if (!value.trim()) {
            quickPick.items = allItems;
            return;
        }
        const parts = value.toLowerCase().split(/\s+/).filter(p => p.length > 0);
        quickPick.items = allItems
            .filter(item => {
                const searchText = item.searchText || '';
                return parts.every(part => searchText.includes(part));
            })
            .map(item => ({ ...item, alwaysShow: true }));
    });

    // Set context for M-o keybinding
    activeProjectPicker = quickPick;
    vscode.commands.executeCommand('setContext', 'scimax.projectPickerActive', true);

    // Handle primary selection (Enter)
    quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            quickPick.hide();
            await openProject(manager, selected.project);
        }
    });

    // Handle button clicks
    quickPick.onDidTriggerItemButton(async (e) => {
        const item = e.item as ProjectQuickPickItem;

        if (e.button === excludeButton) {
            // Remove/exclude the project
            quickPick.hide();
            await manager.removeProject(item.project.path);
            vscode.window.showInformationMessage(`Removed project: ${item.project.name}`);
        } else if (e.button === findFileButton) {
            // Open file picker in that project (new window)
            quickPick.hide();
            await openProjectWithFilePicker(manager, item.project);
        }
    });

    // Clean up on hide
    quickPick.onDidHide(() => {
        activeProjectPicker = null;
        vscode.commands.executeCommand('setContext', 'scimax.projectPickerActive', false);
        quickPick.dispose();
    });

    quickPick.show();
}

/**
 * Show alternate actions for the selected project (M-o)
 */
async function showProjectActions(manager: ProjectileManager): Promise<void> {
    if (!activeProjectPicker) {
        return;
    }

    const selected = activeProjectPicker.activeItems[0];
    if (!selected) {
        vscode.window.showInformationMessage('No project selected');
        return;
    }

    // Hide the project picker temporarily
    const project = selected.project;
    activeProjectPicker.hide();

    // Show actions menu
    const actions = [
        { label: '[i] Exclude/Remove project', value: 'exclude', description: `Remove ${project.name} from project list` },
        { label: '[f] Find file in project', value: 'findFile', description: `Open ${project.name} in new window with file picker` }
    ];

    const action = await vscode.window.showQuickPick(actions, {
        placeHolder: `Actions for ${project.name}`
    });

    if (!action) {
        // Re-show project picker if cancelled
        await switchProject(manager);
        return;
    }

    switch (action.value) {
        case 'exclude':
            await manager.removeProject(project.path);
            vscode.window.showInformationMessage(`Removed project: ${project.name}`);
            break;
        case 'findFile':
            await openProjectWithFilePicker(manager, project);
            break;
    }
}

/**
 * Open a project in new window and immediately show file picker
 * Uses globalState to signal the new window to open file picker on activation
 */
async function openProjectWithFilePicker(manager: ProjectileManager, project: Project): Promise<void> {
    const uri = vscode.Uri.file(project.path);

    // Update last opened time
    await manager.touchProject(project.path);

    // Set flag to trigger file picker in the new window
    // The new window will check this on activation and clear it
    await manager.getContext().globalState.update('scimax.pendingFilePicker', project.path);

    // Open in new window
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
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
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Scanning for projects...',
            cancellable: false
        }, async () => {
            const found = await manager.scanDirectory(result[0].fsPath);
            vscode.window.showInformationMessage(`Found ${found} projects`);
        });
    }
}

/**
 * Find file in project (C-c p f)
 * Shows a fuzzy quickpick with files sorted by most recently modified
 */
async function findFileInProject(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showInformationMessage('No workspace folder open');
        return;
    }

    // Create QuickPick and show immediately with loading indicator
    const quickPick = vscode.window.createQuickPick<FuzzyQuickPickItem<string>>();
    quickPick.placeholder = 'Find file in project (C-c p f) - loading files...';
    quickPick.busy = true;
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.show();

    try {
        // Collect files from all workspace folders
        const fileStats: { filePath: string; mtime: number }[] = [];

        for (const folder of folders) {
            const result = await walkDirectory(folder.uri.fsPath, {
                maxFiles: 10000,
                includeHidden: false
            });

            // Get modification times for each file
            for (const file of result.files) {
                try {
                    const stat = await fs.promises.stat(file);
                    fileStats.push({ filePath: file, mtime: stat.mtimeMs });
                } catch {
                    // Skip files that can't be statted
                }
            }
        }

        // Sort by modification time (most recent first)
        fileStats.sort((a, b) => b.mtime - a.mtime);

        // Build quickpick items
        const items: FuzzyQuickPickItem<string>[] = fileStats.map(({ filePath, mtime }) => {
            // Find which workspace folder this file belongs to
            const folder = folders.find(f => filePath.startsWith(f.uri.fsPath));
            const relativePath = folder
                ? path.relative(folder.uri.fsPath, filePath)
                : filePath;
            const folderName = folders.length > 1 && folder ? `$(folder) ${folder.name}` : '';
            const fileName = path.basename(filePath);
            const dirPath = path.dirname(relativePath);

            return {
                label: fileName,
                description: dirPath !== '.' ? dirPath : undefined,
                detail: folderName || undefined,
                data: filePath,
                searchText: `${fileName} ${relativePath}`.toLowerCase()
            };
        });

        quickPick.busy = false;
        quickPick.placeholder = `Find file in project (${items.length} files) - type to filter...`;
        quickPick.items = items;

        // Apply fuzzy filtering on input change
        const allItems = items;
        quickPick.onDidChangeValue(value => {
            if (!value.trim()) {
                quickPick.items = allItems;
                return;
            }
            const parts = value.toLowerCase().split(/\s+/).filter(p => p.length > 0);
            quickPick.items = allItems
                .filter(item => {
                    const searchText = item.searchText || '';
                    return parts.every(part => searchText.includes(part));
                })
                .map(item => ({ ...item, alwaysShow: true }));
        });

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                quickPick.hide();
                const doc = await vscode.workspace.openTextDocument(selected.data);
                await vscode.window.showTextDocument(doc);
            }
        });

        quickPick.onDidHide(() => quickPick.dispose());
    } catch (error) {
        quickPick.hide();
        vscode.window.showErrorMessage(`Error scanning files: ${error}`);
    }
}

/**
 * Find file in all known projects (C-c p F)
 * Similar to Emacs projectile-find-file-in-known-projects
 */
async function findFileInKnownProjects(manager: ProjectileManager): Promise<void> {
    const projects = manager.getProjects();

    if (projects.length === 0) {
        vscode.window.showInformationMessage('No known projects. Use "Add Project" or "Scan Directory" first.');
        return;
    }

    // Create QuickPick for better UX with many items
    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { filePath: string; searchText?: string }>();
    quickPick.placeholder = 'Find file in known projects (C-c p F) - space-separated terms';
    // Disable VS Code's built-in filtering - we do our own fuzzy matching
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.busy = true;
    quickPick.show();

    // Collect files from all projects
    const items: (vscode.QuickPickItem & { filePath: string; searchText?: string })[] = [];

    for (const project of projects) {
        if (!fs.existsSync(project.path)) {
            continue;
        }

        try {
            // Use shared walkDirectory utility
            const result = await walkDirectory(project.path, {
                maxFiles: 5000,
                includeHidden: false
            });

            for (const file of result.files) {
                const relativePath = path.relative(project.path, file);
                const fileName = path.basename(file);
                items.push({
                    label: fileName,
                    description: relativePath,
                    detail: `$(folder) ${project.name}`,
                    filePath: file,
                    searchText: `${fileName} ${relativePath} ${project.name}`.toLowerCase()
                });
            }
        } catch (err) {
            // Skip projects that can't be read
            console.error(`Error scanning project ${project.name}:`, err);
        }
    }

    quickPick.busy = false;
    quickPick.items = items;

    if (items.length === 0) {
        quickPick.placeholder = 'No files found in known projects';
    }

    // Apply fuzzy filtering on input change (space-separated AND matching)
    const allItems = items;
    quickPick.onDidChangeValue(value => {
        if (!value.trim()) {
            quickPick.items = allItems;
            return;
        }
        const parts = value.toLowerCase().split(/\s+/).filter(p => p.length > 0);
        quickPick.items = allItems
            .filter(item => {
                const searchText = item.searchText || '';
                return parts.every(part => searchText.includes(part));
            })
            .map(item => ({ ...item, alwaysShow: true }));
    });

    quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            quickPick.hide();
            const doc = await vscode.workspace.openTextDocument(selected.filePath);
            await vscode.window.showTextDocument(doc);
        }
    });

    quickPick.onDidHide(() => quickPick.dispose());
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

        // Alternate actions for project picker (M-o)
        vscode.commands.registerCommand('scimax.projectile.switchActions', () => showProjectActions(manager)),

        // Find file in project (C-c p f)
        vscode.commands.registerCommand('scimax.projectile.findFile', findFileInProject),

        // Find file in known projects (C-c p F)
        vscode.commands.registerCommand('scimax.projectile.findFileInKnownProjects', () => findFileInKnownProjects(manager)),

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

/**
 * Check if there's a pending file picker request from opening a project with [f] action
 * Should be called after extension activation in the new window
 */
export async function checkPendingFilePicker(context: vscode.ExtensionContext): Promise<void> {
    const pendingPath = context.globalState.get<string>('scimax.pendingFilePicker');

    if (pendingPath) {
        // Clear the flag first
        await context.globalState.update('scimax.pendingFilePicker', undefined);

        // Check if we're in the expected project
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.some(f => f.uri.fsPath === pendingPath)) {
            // Small delay to let the window fully initialize
            setTimeout(() => {
                vscode.commands.executeCommand('scimax.projectile.findFile');
            }, 500);
        }
    }
}
