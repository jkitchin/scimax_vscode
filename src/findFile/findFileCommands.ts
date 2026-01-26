/**
 * Find File Commands
 * VS Code command registrations for find-file
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { FindFilePanel } from './findFilePanel';
import { OriginalPosition } from './findFileTypes';

/**
 * Register find-file commands
 */
export function registerFindFileCommands(context: vscode.ExtensionContext): void {
    // Main find-file command (C-x C-f)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.findFile', async () => {
            const editor = vscode.window.activeTextEditor;

            // Store original position for path insertion
            let originalPosition: OriginalPosition | null = null;
            if (editor) {
                originalPosition = {
                    uri: editor.document.uri,
                    position: editor.selection.active
                };
            }

            // Determine starting directory
            let startDir: string;
            if (editor && editor.document.uri.scheme === 'file') {
                startDir = path.dirname(editor.document.uri.fsPath);
            } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                startDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
            } else {
                startDir = os.homedir();
            }

            FindFilePanel.createOrShow(context.extensionUri, startDir, originalPosition);
        })
    );

    // Find file in home directory
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.findFileHome', async () => {
            const editor = vscode.window.activeTextEditor;

            let originalPosition: OriginalPosition | null = null;
            if (editor) {
                originalPosition = {
                    uri: editor.document.uri,
                    position: editor.selection.active
                };
            }

            FindFilePanel.createOrShow(context.extensionUri, os.homedir(), originalPosition);
        })
    );

    // Find file in workspace root
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.findFileWorkspace', async () => {
            const editor = vscode.window.activeTextEditor;

            let originalPosition: OriginalPosition | null = null;
            if (editor) {
                originalPosition = {
                    uri: editor.document.uri,
                    position: editor.selection.active
                };
            }

            let startDir: string;
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                startDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
            } else {
                startDir = os.homedir();
            }

            FindFilePanel.createOrShow(context.extensionUri, startDir, originalPosition);
        })
    );
}
