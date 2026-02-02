/**
 * Link Graph Commands
 *
 * VS Code commands for the link graph visualization feature.
 * Uses lazy database loading to avoid blocking extension activation.
 */

import * as vscode from 'vscode';
import { LinkGraphProvider } from './linkGraphProvider';
import { LinkGraphQueryService } from './linkGraphQueries';
import { getDatabase } from '../database/lazyDb';
import { databaseLogger as log } from '../utils/logger';

let graphProvider: LinkGraphProvider | undefined;

/**
 * Get database client, showing error if not available
 */
async function getDatabaseClient() {
    const db = await getDatabase();
    if (!db) {
        vscode.window.showErrorMessage('Database not available. Try running "Scimax: Reindex Files" first.');
        return null;
    }
    const client = db.getClient();
    if (!client) {
        vscode.window.showErrorMessage('Database client not initialized.');
        return null;
    }
    return client;
}

/**
 * Register link graph commands
 */
export function registerLinkGraphCommands(
    context: vscode.ExtensionContext
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Show link graph for current file
    disposables.push(
        vscode.commands.registerCommand('scimax.showLinkGraph', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No file is currently open');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const ext = filePath.split('.').pop()?.toLowerCase();

            if (ext !== 'org' && ext !== 'md') {
                vscode.window.showWarningMessage('Link graph is only available for org and markdown files');
                return;
            }

            const client = await getDatabaseClient();
            if (!client) return;

            // Create or reuse provider
            if (!graphProvider) {
                graphProvider = new LinkGraphProvider(context, client);
            }

            await graphProvider.show(filePath);
        })
    );

    // Show link graph for a specific file (from context menu, etc.)
    disposables.push(
        vscode.commands.registerCommand('scimax.showLinkGraphForFile', async (uri?: vscode.Uri) => {
            let filePath: string | undefined;

            if (uri) {
                filePath = uri.fsPath;
            } else {
                filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
            }

            if (!filePath) {
                vscode.window.showWarningMessage('No file specified');
                return;
            }

            const client = await getDatabaseClient();
            if (!client) return;

            // Create or reuse provider
            if (!graphProvider) {
                graphProvider = new LinkGraphProvider(context, client);
            }

            await graphProvider.show(filePath);
        })
    );

    // Show link statistics for current file
    disposables.push(
        vscode.commands.registerCommand('scimax.showLinkStats', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No file is currently open');
                return;
            }

            const filePath = editor.document.uri.fsPath;

            const client = await getDatabaseClient();
            if (!client) return;

            const queryService = new LinkGraphQueryService(client);

            try {
                const stats = await queryService.getLinkStats(filePath);

                const typeBreakdown = Object.entries(stats.outgoingByType)
                    .map(([type, count]) => `  ${type}: ${count}`)
                    .join('\n');

                const message = [
                    `Link Statistics for ${filePath.split('/').pop()}`,
                    '',
                    `Outgoing links: ${stats.outgoing}`,
                    typeBreakdown ? `By type:\n${typeBreakdown}` : '',
                    `Incoming links (backlinks): ${stats.incoming}`
                ].filter(Boolean).join('\n');

                // Show in information message with option to open graph
                const action = await vscode.window.showInformationMessage(
                    message,
                    { modal: false },
                    'Show Graph'
                );

                if (action === 'Show Graph') {
                    // Create or reuse provider
                    if (!graphProvider) {
                        graphProvider = new LinkGraphProvider(context, client);
                    }
                    await graphProvider.show(filePath);
                }
            } catch (error) {
                log.error('Failed to get link statistics', error as Error);
                vscode.window.showErrorMessage(`Failed to get link statistics: ${error}`);
            }
        })
    );

    // Cleanup on deactivation
    disposables.push({
        dispose: () => {
            if (graphProvider) {
                graphProvider.dispose();
                graphProvider = undefined;
            }
        }
    });

    return disposables;
}
