/**
 * Diagnostic Commands
 * Register commands for the diagnostic/debug info feature
 */

import * as vscode from 'vscode';
import { DiagnosticPanel } from './diagnosticPanel';
import { gatherDiagnosticInfo } from './diagnosticReport';

/**
 * Register all diagnostic commands
 */
export function registerDiagnosticCommands(context: vscode.ExtensionContext): void {
    // Main command to show diagnostic info
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.showDebugInfo', async () => {
            await showDiagnosticReport(context);
        })
    );

    // Internal command to refresh the report (called from webview)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.refreshDebugInfo', async () => {
            if (DiagnosticPanel.currentPanel) {
                await refreshDiagnosticReport(context);
            }
        })
    );
}

/**
 * Show the diagnostic report in a webview panel
 */
async function showDiagnosticReport(context: vscode.ExtensionContext): Promise<void> {
    // Create or show the panel
    const panel = DiagnosticPanel.createOrShow(context.extensionUri);

    // Show loading state
    panel.showLoading();

    try {
        // Gather diagnostic info
        const info = await gatherDiagnosticInfo(context);

        // Update the panel with the info
        panel.update(info);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to gather diagnostic info: ${error}`);
    }
}

/**
 * Refresh the diagnostic report
 */
async function refreshDiagnosticReport(context: vscode.ExtensionContext): Promise<void> {
    const panel = DiagnosticPanel.currentPanel;
    if (!panel) return;

    // Show loading state
    panel.showLoading();

    try {
        // Gather fresh diagnostic info
        const info = await gatherDiagnosticInfo(context);

        // Update the panel
        panel.update(info);

        vscode.window.showInformationMessage('Diagnostic report refreshed');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh diagnostic info: ${error}`);
    }
}
