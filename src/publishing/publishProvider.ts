/**
 * VS Code Org Publishing Provider
 * Provides commands, wizard, and UI for org-mode project publishing
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import {
    PublishConfig,
    PublishProject,
    CONFIG_FILENAME,
    isPublishProject,
    mergeWithDefaults,
    validateConfig,
    GITHUB_PAGES_PRESET,
} from './publishProject';

import {
    loadConfig,
    saveConfig,
    publishProject,
    publishAll,
    createProjectConfig,
    PublishOptions,
    PublishProjectResult,
} from './orgPublish';

// =============================================================================
// Wizard
// =============================================================================

/**
 * Run the project initialization wizard
 */
async function runInitWizard(): Promise<void> {
    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Check if config already exists
    const existingConfig = await loadConfig(workspaceRoot);
    if (existingConfig) {
        const overwrite = await vscode.window.showWarningMessage(
            `${CONFIG_FILENAME} already exists. Do you want to overwrite it?`,
            'Overwrite',
            'Cancel'
        );
        if (overwrite !== 'Overwrite') {
            return;
        }
    }

    // Step 1: Project name
    const projectName = await vscode.window.showInputBox({
        title: 'Initialize Org Publishing Project (1/5)',
        prompt: 'Enter a name for your project',
        value: 'website',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Project name is required';
            }
            if (!/^[a-z0-9-]+$/i.test(value)) {
                return 'Project name should only contain letters, numbers, and hyphens';
            }
            return null;
        },
    });

    if (!projectName) return;

    // Step 2: Source directory
    const defaultOrgDir = './org';
    const orgDirOptions: vscode.QuickPickItem[] = [
        { label: './org', description: 'Create new org/ folder (Recommended)' },
        { label: './', description: 'Use current directory' },
        { label: '$(folder) Browse...', description: 'Select an existing folder' },
    ];

    const selectedOrgDir = await vscode.window.showQuickPick(orgDirOptions, {
        title: 'Initialize Org Publishing Project (2/5)',
        placeHolder: 'Where are your org files located?',
    });

    if (!selectedOrgDir) return;

    let baseDirectory: string;
    if (selectedOrgDir.label === '$(folder) Browse...') {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(workspaceRoot),
            title: 'Select source folder for org files',
        });

        if (!folderUri || folderUri.length === 0) return;

        baseDirectory = './' + path.relative(workspaceRoot, folderUri[0].fsPath);
    } else {
        baseDirectory = selectedOrgDir.label;
    }

    // Step 3: Output directory
    const defaultOutputDir = './docs';
    const outputDirOptions: vscode.QuickPickItem[] = [
        { label: './docs', description: 'GitHub Pages default (Recommended)' },
        { label: './public', description: 'Common static site folder' },
        { label: './build', description: 'Build output folder' },
        { label: '$(folder) Browse...', description: 'Select a different folder' },
    ];

    const selectedOutputDir = await vscode.window.showQuickPick(outputDirOptions, {
        title: 'Initialize Org Publishing Project (3/5)',
        placeHolder: 'Where should HTML files be published?',
    });

    if (!selectedOutputDir) return;

    let publishingDirectory: string;
    if (selectedOutputDir.label === '$(folder) Browse...') {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(workspaceRoot),
            title: 'Select output folder for published HTML',
        });

        if (!folderUri || folderUri.length === 0) return;

        publishingDirectory = './' + path.relative(workspaceRoot, folderUri[0].fsPath);
    } else {
        publishingDirectory = selectedOutputDir.label;
    }

    // Step 4: Publishing target
    const targetOptions: vscode.QuickPickItem[] = [
        {
            label: '$(github) GitHub Pages',
            description: 'Optimized for GitHub Pages hosting (Recommended)',
            picked: true,
        },
        {
            label: '$(server) Local/Custom',
            description: 'For other hosting or local preview',
        },
    ];

    const selectedTarget = await vscode.window.showQuickPick(targetOptions, {
        title: 'Initialize Org Publishing Project (4/5)',
        placeHolder: 'Where will you host your site?',
    });

    if (!selectedTarget) return;

    const useGitHubPages = selectedTarget.label.includes('GitHub Pages');

    // Step 5: Sitemap
    const sitemapOptions: vscode.QuickPickItem[] = [
        {
            label: '$(list-unordered) Yes, generate a sitemap',
            description: useGitHubPages ? 'Creates index.html with links to all pages' : 'Creates sitemap.html',
            picked: true,
        },
        {
            label: '$(x) No sitemap',
            description: 'I will create my own index page',
        },
    ];

    const selectedSitemap = await vscode.window.showQuickPick(sitemapOptions, {
        title: 'Initialize Org Publishing Project (5/5)',
        placeHolder: 'Generate a sitemap/index page?',
    });

    if (!selectedSitemap) return;

    const generateSitemap = selectedSitemap.label.includes('Yes');

    // Create configuration
    const config = createProjectConfig(
        projectName,
        baseDirectory,
        publishingDirectory,
        useGitHubPages,
        generateSitemap
    );

    // Save configuration
    await saveConfig(workspaceRoot, config);

    // Create directories if they don't exist
    const baseDirPath = path.resolve(workspaceRoot, baseDirectory);
    const outputDirPath = path.resolve(workspaceRoot, publishingDirectory);

    try {
        await fs.promises.mkdir(baseDirPath, { recursive: true });
        await fs.promises.mkdir(outputDirPath, { recursive: true });

        // Create .nojekyll for GitHub Pages
        if (useGitHubPages) {
            await fs.promises.writeFile(
                path.join(outputDirPath, '.nojekyll'),
                '',
                'utf-8'
            );
        }

        // Create a sample org file if org directory is empty
        const files = await fs.promises.readdir(baseDirPath);
        if (files.length === 0) {
            const sampleContent = `#+TITLE: Welcome
#+AUTHOR: ${process.env.USER || 'Author'}
#+DATE: ${new Date().toISOString().split('T')[0]}

* Introduction

Welcome to your new org-mode website!

This is a sample page to get you started. Edit this file or create new =.org= files in the =${baseDirectory}= directory.

* Getting Started

1. Edit this file or create new =.org= files
2. Run *Scimax: Publish Project* (=Ctrl+C Ctrl+P P=) to publish
3. Commit and push to deploy to GitHub Pages

* Features

- [[https://orgmode.org][Org-mode]] syntax support
- Automatic sitemap generation
- Table of contents
- Code syntax highlighting
- Math rendering with MathJax

* Example Code

#+BEGIN_SRC python
def hello():
    print("Hello from org-mode!")

hello()
#+END_SRC

* Example Math

The quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$
`;

            await fs.promises.writeFile(
                path.join(baseDirPath, 'index.org'),
                sampleContent,
                'utf-8'
            );
        }
    } catch (error) {
        // Non-fatal - directories might already exist
    }

    // Show success message with actions
    const action = await vscode.window.showInformationMessage(
        `Publishing project "${projectName}" initialized successfully!`,
        'Publish Now',
        'Open Config',
        'Done'
    );

    if (action === 'Publish Now') {
        await publishCurrentProject();
    } else if (action === 'Open Config') {
        const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);
    }
}

// =============================================================================
// Publishing Commands
// =============================================================================

/**
 * Get workspace root or show error
 */
function getWorkspaceRoot(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return null;
    }
    return workspaceFolders[0].uri.fsPath;
}

/**
 * Publish the current/default project
 */
async function publishCurrentProject(): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const config = await loadConfig(workspaceRoot);
    if (!config) {
        const init = await vscode.window.showWarningMessage(
            'No publishing project configured. Would you like to create one?',
            'Initialize Project',
            'Cancel'
        );
        if (init === 'Initialize Project') {
            await runInitWizard();
        }
        return;
    }

    // Get project names
    const projectNames = Object.keys(config.projects).filter(name =>
        isPublishProject(config.projects[name])
    );

    if (projectNames.length === 0) {
        vscode.window.showErrorMessage('No valid projects found in configuration.');
        return;
    }

    // If only one project, publish it directly
    let selectedProject: string;
    if (projectNames.length === 1) {
        selectedProject = projectNames[0];
    } else {
        // Let user pick a project
        const items = projectNames.map(name => {
            const project = config.projects[name];
            const desc = isPublishProject(project)
                ? `${project.baseDirectory} -> ${project.publishingDirectory}`
                : 'Component project';
            return { label: name, description: desc };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a project to publish',
            title: 'Publish Project',
        });

        if (!selected) return;
        selectedProject = selected.label;
    }

    // Publish with progress
    await publishWithProgress(config, selectedProject, workspaceRoot);
}

/**
 * Publish all projects
 */
async function publishAllProjects(): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const config = await loadConfig(workspaceRoot);
    if (!config) {
        vscode.window.showWarningMessage('No publishing configuration found.');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Publishing all projects...',
            cancellable: false,
        },
        async (progress) => {
            const options: PublishOptions = {
                onProgress: (current, total, file) => {
                    const percentage = Math.round((current / total) * 100);
                    progress.report({
                        message: `${file} (${current}/${total})`,
                        increment: 100 / total,
                    });
                },
            };

            const results = await publishAll(config, workspaceRoot, options);
            showPublishResults(results);
        }
    );
}

/**
 * Publish with progress indicator
 */
async function publishWithProgress(
    config: PublishConfig,
    projectName: string,
    workspaceRoot: string
): Promise<void> {
    const projectConfig = config.projects[projectName];

    if (!isPublishProject(projectConfig)) {
        vscode.window.showErrorMessage(`Project "${projectName}" is not a valid publish project.`);
        return;
    }

    const project = mergeWithDefaults({ ...projectConfig, name: projectName });

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Publishing ${projectName}...`,
            cancellable: false,
        },
        async (progress) => {
            const options: PublishOptions = {
                onProgress: (current, total, file) => {
                    progress.report({
                        message: `${file} (${current}/${total})`,
                        increment: 100 / total,
                    });
                },
            };

            const result = await publishProject(project, workspaceRoot, options);
            showPublishResults([result]);

            // Handle GitHub Pages setup
            if (config.githubPages) {
                const outputDir = path.resolve(workspaceRoot, project.publishingDirectory);

                // Ensure .nojekyll exists
                const nojekyllPath = path.join(outputDir, '.nojekyll');
                try {
                    await fs.promises.writeFile(nojekyllPath, '', 'utf-8');
                } catch {
                    // Ignore errors
                }
            }
        }
    );
}

/**
 * Show publishing results
 */
function showPublishResults(results: PublishProjectResult[]): void {
    let totalSuccess = 0;
    let totalErrors = 0;
    let totalDuration = 0;

    for (const result of results) {
        totalSuccess += result.successCount;
        totalErrors += result.errorCount;
        totalDuration += result.duration;
    }

    if (totalErrors === 0) {
        vscode.window.showInformationMessage(
            `Published ${totalSuccess} files in ${(totalDuration / 1000).toFixed(1)}s`
        );
    } else {
        const errorFiles = results
            .flatMap(r => r.files)
            .filter(f => !f.success)
            .map(f => path.basename(f.sourcePath))
            .slice(0, 3);

        const moreErrors = totalErrors > 3 ? ` and ${totalErrors - 3} more` : '';

        vscode.window.showWarningMessage(
            `Published ${totalSuccess} files, ${totalErrors} errors: ${errorFiles.join(', ')}${moreErrors}`
        );
    }
}

/**
 * Publish the current file only
 */
async function publishCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No file is currently open.');
        return;
    }

    if (editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('Current file is not an org-mode file.');
        return;
    }

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const config = await loadConfig(workspaceRoot);
    if (!config) {
        vscode.window.showWarningMessage('No publishing configuration found.');
        return;
    }

    const filePath = editor.document.uri.fsPath;

    // Find which project this file belongs to
    for (const [name, projectConfig] of Object.entries(config.projects)) {
        if (!isPublishProject(projectConfig)) continue;

        const project = mergeWithDefaults({ ...projectConfig, name });
        const baseDir = path.resolve(workspaceRoot, project.baseDirectory);

        if (filePath.startsWith(baseDir)) {
            // Found the project
            const { publishFile } = await import('./orgPublish');

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Publishing ${path.basename(filePath)}...`,
                    cancellable: false,
                },
                async () => {
                    const result = await publishFile(filePath, project, workspaceRoot, { force: true });

                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `Published to ${path.basename(result.outputPath)}`
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            `Failed to publish: ${result.error}`
                        );
                    }
                }
            );

            return;
        }
    }

    vscode.window.showWarningMessage(
        'Current file is not part of any configured publishing project.'
    );
}

/**
 * Preview the published site
 */
async function previewSite(): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const config = await loadConfig(workspaceRoot);
    if (!config) {
        vscode.window.showWarningMessage('No publishing configuration found.');
        return;
    }

    // Find the first project's output directory
    for (const projectConfig of Object.values(config.projects)) {
        if (!isPublishProject(projectConfig)) continue;

        const outputDir = path.resolve(workspaceRoot, projectConfig.publishingDirectory);
        const indexPath = path.join(outputDir, 'index.html');

        try {
            await fs.promises.access(indexPath);
            await vscode.env.openExternal(vscode.Uri.file(indexPath));
            return;
        } catch {
            // Try sitemap.html
            const sitemapPath = path.join(outputDir, 'sitemap.html');
            try {
                await fs.promises.access(sitemapPath);
                await vscode.env.openExternal(vscode.Uri.file(sitemapPath));
                return;
            } catch {
                // No index found
            }
        }
    }

    vscode.window.showWarningMessage(
        'No published site found. Run "Publish Project" first.'
    );
}

/**
 * Open the publish configuration file
 */
async function openConfig(): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const configPath = path.join(workspaceRoot, CONFIG_FILENAME);

    try {
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);
    } catch {
        const init = await vscode.window.showWarningMessage(
            'No publishing configuration found. Would you like to create one?',
            'Initialize Project',
            'Cancel'
        );
        if (init === 'Initialize Project') {
            await runInitWizard();
        }
    }
}

// =============================================================================
// Command Registration
// =============================================================================

/**
 * Register all publishing commands
 */
export function registerPublishCommands(context: vscode.ExtensionContext): void {
    // Initialize project wizard
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.publish.init',
            runInitWizard
        )
    );

    // Publish project (shows picker if multiple)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.publish.project',
            publishCurrentProject
        )
    );

    // Publish all projects
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.publish.all',
            publishAllProjects
        )
    );

    // Publish current file only
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.publish.file',
            publishCurrentFile
        )
    );

    // Preview published site
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.publish.preview',
            previewSite
        )
    );

    // Open config file
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.publish.openConfig',
            openConfig
        )
    );
}
