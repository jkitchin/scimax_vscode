/**
 * Find File Commands
 * VS Code command registrations for find-file
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { FindFilePanel } from './findFilePanel';
import { OriginalPosition } from './findFileTypes';
import { DiredPanel } from '../dired/diredPanel';

/**
 * Where C-x C-f starts: the directory a focused dired panel shows, else the
 * active file's folder, else the first workspace folder, else home.
 */
export function findFileStartDir(
    diredDir: string | undefined,
    editorUri: { scheme: string; fsPath: string } | undefined,
    workspaceDir: string | undefined,
    home: string,
): string {
    if (diredDir) return diredDir;
    if (editorUri && editorUri.scheme === 'file') return path.dirname(editorUri.fsPath);
    return workspaceDir ?? home;
}

/** findFileStartDir for the current window. */
function currentStartDir(): string {
    return findFileStartDir(
        DiredPanel.activeDirectory(),
        vscode.window.activeTextEditor?.document.uri,
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        os.homedir(),
    );
}

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

            // Determine starting directory (a focused dired panel's directory first)
            const startDir = currentStartDir();

            FindFilePanel.createOrShow(context.extensionUri, startDir, originalPosition);
        })
    );

    // Find file and open it in a new floating window (C-x 5 f)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.findFileOtherWindow', async () => {
            const editor = vscode.window.activeTextEditor;
            const originalPosition: OriginalPosition | null = editor
                ? { uri: editor.document.uri, position: editor.selection.active }
                : null;
            const startDir = currentStartDir();
            FindFilePanel.createOrShow(context.extensionUri, startDir, originalPosition, true);
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
