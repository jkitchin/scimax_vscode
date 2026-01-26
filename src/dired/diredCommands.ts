/**
 * Dired Commands
 * VS Code command registrations for dired
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DiredPanel } from './diredPanel';

export function registerDiredCommands(context: vscode.ExtensionContext): void {
    // Open dired - prompts for directory or uses workspace
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.open', async () => {
            // Show directory picker
            const result = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Open in Dired',
                title: 'Select directory to browse'
            });

            const directory = result?.[0]?.fsPath ||
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            if (directory) {
                DiredPanel.createOrShow(context.extensionUri, directory);
            } else {
                vscode.window.showWarningMessage('No directory selected');
            }
        })
    );

    // Open dired for current file's directory
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.openCurrent', async () => {
            const editor = vscode.window.activeTextEditor;
            let directory: string | undefined;

            if (editor) {
                directory = path.dirname(editor.document.uri.fsPath);
            } else {
                directory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            }

            if (directory) {
                DiredPanel.createOrShow(context.extensionUri, directory);
            } else {
                vscode.window.showWarningMessage('No directory to open');
            }
        })
    );

    // Open dired for workspace root
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.openWorkspace', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;

            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            let directory: string;

            if (workspaceFolders.length === 1) {
                directory = workspaceFolders[0].uri.fsPath;
            } else {
                // Multiple workspace folders - let user choose
                const items = workspaceFolders.map(f => ({
                    label: f.name,
                    description: f.uri.fsPath,
                    uri: f.uri
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select workspace folder'
                });

                if (!selected) return;
                directory = selected.uri.fsPath;
            }

            DiredPanel.createOrShow(context.extensionUri, directory);
        })
    );

    // Refresh current dired panel
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.refresh', () => {
            if (DiredPanel.currentPanel) {
                // The panel handles refresh internally via webview messages
                vscode.window.showInformationMessage('Dired: Use "g" key in the dired panel to refresh');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Navigate to parent directory
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.up', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "^" key in the dired panel to go up');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Mark current file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.mark', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "m" key in the dired panel to mark');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Unmark current file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.unmark', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "u" key in the dired panel to unmark');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Unmark all files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.unmarkAll', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "U" key in the dired panel to unmark all');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Toggle all marks
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.toggleMarks', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "t" key in the dired panel to toggle marks');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Mark by regex
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.markRegex', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "% m" keys in the dired panel to mark by regex');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Flag for deletion
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.flagDelete', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "d" key in the dired panel to flag for deletion');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Delete marked/flagged files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.delete', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "D" key in the dired panel to delete');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Copy marked files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.copy', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "C" key in the dired panel to copy');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Rename/move files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.rename', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "R" key in the dired panel to rename/move');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Create directory
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.createDir', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "+" key in the dired panel to create directory');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Enter wdired mode
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.wdiredEnter', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "C-x C-q" in the dired panel to enter wdired mode');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Commit wdired changes
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.wdiredCommit', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "C-c C-c" in wdired mode to commit changes');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );

    // Cancel wdired mode
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.dired.wdiredCancel', () => {
            if (DiredPanel.currentPanel) {
                vscode.window.showInformationMessage('Dired: Use "C-c C-k" in wdired mode to cancel');
            } else {
                vscode.window.showWarningMessage('No dired panel open');
            }
        })
    );
}
