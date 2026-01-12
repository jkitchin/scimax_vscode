/**
 * VS Code Commands for Jupyter Kernel Management
 */

import * as vscode from 'vscode';
import { getKernelManager, disposeKernelManager } from './kernelManager';
import { discoverKernelSpecsViaJupyter, findKernelForLanguage } from './kernelSpec';
import { jupyterExecutor, shouldUseJupyter } from './jupyterExecutor';
import { executorRegistry } from '../parser/orgBabel';
import type { KernelSpec, KernelState } from './types';

// =============================================================================
// Status Bar
// =============================================================================

let statusBarItem: vscode.StatusBarItem | null = null;

/**
 * Create or update status bar item
 */
function updateStatusBar(state: KernelState, language?: string): void {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
    }

    const icon = state === 'busy' ? '$(sync~spin)'
        : state === 'idle' ? '$(check)'
        : state === 'starting' ? '$(loading~spin)'
        : state === 'dead' ? '$(error)'
        : '$(question)';

    statusBarItem.text = `${icon} Jupyter${language ? `: ${language}` : ''}`;
    statusBarItem.tooltip = `Kernel state: ${state}`;
    statusBarItem.command = 'scimax.jupyter.showKernels';
    statusBarItem.show();
}

/**
 * Hide status bar
 */
function hideStatusBar(): void {
    if (statusBarItem) {
        statusBarItem.hide();
    }
}

// =============================================================================
// Output Channel
// =============================================================================

let outputChannel: vscode.OutputChannel | null = null;

/**
 * Get output channel
 */
function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Jupyter Kernels');
    }
    return outputChannel;
}

// =============================================================================
// Commands
// =============================================================================

/**
 * Show available kernels and allow selection
 */
async function showAvailableKernels(): Promise<void> {
    const specs = await discoverKernelSpecsViaJupyter();

    const items: Array<vscode.QuickPickItem & { spec: KernelSpec }> = [];
    for (const spec of specs.values()) {
        items.push({
            label: spec.displayName,
            description: spec.language,
            detail: spec.resourceDir,
            spec,
        });
    }

    if (items.length === 0) {
        vscode.window.showWarningMessage(
            'No Jupyter kernels found. Install kernels with: pip install ipykernel'
        );
        return;
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a kernel to start',
        title: 'Available Jupyter Kernels',
    });

    if (selected) {
        await startKernelForSpec(selected.spec);
    }
}

/**
 * Start a kernel for a specific spec
 */
async function startKernelForSpec(spec: KernelSpec): Promise<void> {
    const manager = getKernelManager();
    const channel = getOutputChannel();

    channel.appendLine(`Starting kernel: ${spec.displayName} (${spec.name})`);
    channel.show();

    try {
        const kernelId = await manager.startKernel(spec.name);
        channel.appendLine(`Kernel started: ${kernelId}`);
        updateStatusBar('idle', spec.language);
        vscode.window.showInformationMessage(`Jupyter kernel started: ${spec.displayName}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        channel.appendLine(`Failed to start kernel: ${message}`);
        vscode.window.showErrorMessage(`Failed to start kernel: ${message}`);
    }
}

/**
 * Show running kernels
 */
async function showRunningKernels(): Promise<void> {
    const manager = getKernelManager();
    const sessions = manager.getSessions();

    if (sessions.length === 0) {
        vscode.window.showInformationMessage('No running Jupyter kernels');
        return;
    }

    const items = sessions.map(session => ({
        label: `${session.language} (${session.name})`,
        description: session.state,
        detail: `Kernel ID: ${session.kernelId}`,
        session,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a kernel to manage',
        title: 'Running Jupyter Kernels',
    });

    if (selected) {
        const action = await vscode.window.showQuickPick([
            { label: 'Restart', action: 'restart' },
            { label: 'Interrupt', action: 'interrupt' },
            { label: 'Shutdown', action: 'shutdown' },
            { label: 'Show Info', action: 'info' },
        ], {
            placeHolder: 'Select action',
        });

        if (action) {
            switch (action.action) {
                case 'restart':
                    await restartKernel(selected.session.kernelId);
                    break;
                case 'interrupt':
                    await interruptKernel(selected.session.kernelId);
                    break;
                case 'shutdown':
                    await shutdownKernel(selected.session.kernelId);
                    break;
                case 'info':
                    showKernelInfo(selected.session.kernelId);
                    break;
            }
        }
    }
}

/**
 * Restart a kernel
 */
async function restartKernel(kernelId: string): Promise<void> {
    const manager = getKernelManager();
    const channel = getOutputChannel();

    channel.appendLine(`Restarting kernel: ${kernelId}`);

    try {
        await manager.restartKernel(kernelId);
        channel.appendLine('Kernel restarted');
        vscode.window.showInformationMessage('Jupyter kernel restarted');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        channel.appendLine(`Failed to restart kernel: ${message}`);
        vscode.window.showErrorMessage(`Failed to restart kernel: ${message}`);
    }
}

/**
 * Interrupt a kernel
 */
async function interruptKernel(kernelId: string): Promise<void> {
    const manager = getKernelManager();
    const channel = getOutputChannel();

    channel.appendLine(`Interrupting kernel: ${kernelId}`);

    try {
        await manager.interruptKernel(kernelId);
        channel.appendLine('Kernel interrupted');
        vscode.window.showInformationMessage('Jupyter kernel interrupted');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        channel.appendLine(`Failed to interrupt kernel: ${message}`);
        vscode.window.showErrorMessage(`Failed to interrupt kernel: ${message}`);
    }
}

/**
 * Shutdown a kernel
 */
async function shutdownKernel(kernelId: string): Promise<void> {
    const manager = getKernelManager();
    const channel = getOutputChannel();

    channel.appendLine(`Shutting down kernel: ${kernelId}`);

    try {
        await manager.stopKernel(kernelId);
        channel.appendLine('Kernel shutdown complete');
        vscode.window.showInformationMessage('Jupyter kernel shutdown');

        // Update status bar
        const sessions = manager.getSessions();
        if (sessions.length === 0) {
            hideStatusBar();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        channel.appendLine(`Failed to shutdown kernel: ${message}`);
        vscode.window.showErrorMessage(`Failed to shutdown kernel: ${message}`);
    }
}

/**
 * Show kernel info
 */
function showKernelInfo(kernelId: string): void {
    const manager = getKernelManager();
    const info = manager.getKernelInfo(kernelId);

    if (!info) {
        vscode.window.showWarningMessage('Kernel not found');
        return;
    }

    const channel = getOutputChannel();
    channel.appendLine('');
    channel.appendLine('='.repeat(60));
    channel.appendLine(`Kernel: ${info.spec.displayName}`);
    channel.appendLine('='.repeat(60));
    channel.appendLine(`Name: ${info.spec.name}`);
    channel.appendLine(`Language: ${info.spec.language}`);
    channel.appendLine(`State: ${info.state}`);
    channel.appendLine(`PID: ${info.pid || 'unknown'}`);
    channel.appendLine(`Session: ${info.sessionId}`);
    channel.appendLine(`IP: ${info.connection.ip}`);
    channel.appendLine(`Shell Port: ${info.connection.shell_port}`);
    channel.appendLine(`IOPub Port: ${info.connection.iopub_port}`);
    channel.appendLine('='.repeat(60));
    channel.show();
}

/**
 * Shutdown all kernels
 */
async function shutdownAllKernels(): Promise<void> {
    const manager = getKernelManager();
    const channel = getOutputChannel();

    channel.appendLine('Shutting down all kernels...');

    try {
        await manager.shutdownAll();
        channel.appendLine('All kernels shutdown');
        hideStatusBar();
        vscode.window.showInformationMessage('All Jupyter kernels shutdown');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        channel.appendLine(`Failed to shutdown kernels: ${message}`);
        vscode.window.showErrorMessage(`Failed to shutdown kernels: ${message}`);
    }
}

/**
 * Start kernel for current file's language
 */
async function startKernelForCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    // Determine language from file or current source block
    let language = 'python'; // default

    if (editor.document.languageId === 'org') {
        // Try to detect language from source block at cursor
        const line = editor.document.lineAt(editor.selection.active.line).text;
        const srcMatch = line.match(/^\s*#\+BEGIN_SRC\s+(\S+)/i);
        if (srcMatch) {
            language = srcMatch[1];
        }
    } else if (editor.document.languageId === 'python') {
        language = 'python';
    } else if (editor.document.languageId === 'r') {
        language = 'r';
    } else if (editor.document.languageId === 'julia') {
        language = 'julia';
    }

    // Find kernel for language
    const spec = await findKernelForLanguage(language);
    if (!spec) {
        vscode.window.showWarningMessage(`No Jupyter kernel found for: ${language}`);
        return;
    }

    await startKernelForSpec(spec);
}

/**
 * Change kernel for session
 */
async function changeKernel(): Promise<void> {
    const specs = await discoverKernelSpecsViaJupyter();

    const items: Array<vscode.QuickPickItem & { spec: KernelSpec }> = [];
    for (const spec of specs.values()) {
        items.push({
            label: spec.displayName,
            description: spec.language,
            spec,
        });
    }

    if (items.length === 0) {
        vscode.window.showWarningMessage('No Jupyter kernels available');
        return;
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a kernel',
        title: 'Change Jupyter Kernel',
    });

    if (selected) {
        // Get current session or create default
        const manager = getKernelManager();
        const sessions = manager.getSessions();

        let sessionName = 'default';
        if (sessions.length > 0) {
            const sessionItems = sessions.map(s => ({
                label: s.name,
                description: `${s.language} (${s.state})`,
                session: s,
            }));

            const selectedSession = await vscode.window.showQuickPick(sessionItems, {
                placeHolder: 'Select session to change',
            });

            if (selectedSession) {
                sessionName = selectedSession.session.name;
                // Stop old kernel
                await manager.stopKernel(selectedSession.session.kernelId);
            }
        }

        // Start new kernel
        await manager.startKernel(selected.spec.name, sessionName);
        vscode.window.showInformationMessage(`Switched to: ${selected.spec.displayName}`);
    }
}

// =============================================================================
// Registration
// =============================================================================

/**
 * Register Jupyter executor with Babel
 */
function registerJupyterExecutor(): void {
    // Register the Jupyter executor for supported languages
    executorRegistry.register(jupyterExecutor);
}

/**
 * Register all Jupyter commands
 */
export function registerJupyterCommands(context: vscode.ExtensionContext): void {
    // Register Jupyter executor
    registerJupyterExecutor();

    // Set up kernel manager event handlers
    const manager = getKernelManager();

    manager.on('kernelStateChanged', (kernelId: string, state: KernelState) => {
        const info = manager.getKernelInfo(kernelId);
        updateStatusBar(state, info?.spec.language);
    });

    manager.on('kernelStopped', () => {
        const sessions = manager.getSessions();
        if (sessions.length === 0) {
            hideStatusBar();
        }
    });

    manager.on('output', (kernelId: string, type: string, text: string) => {
        getOutputChannel().append(text);
    });

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.jupyter.showKernels', showAvailableKernels),
        vscode.commands.registerCommand('scimax.jupyter.showRunning', showRunningKernels),
        vscode.commands.registerCommand('scimax.jupyter.startKernel', startKernelForCurrentFile),
        vscode.commands.registerCommand('scimax.jupyter.changeKernel', changeKernel),
        vscode.commands.registerCommand('scimax.jupyter.restartKernel', async () => {
            const sessions = manager.getSessions();
            if (sessions.length === 0) {
                vscode.window.showWarningMessage('No running kernels');
                return;
            }
            if (sessions.length === 1) {
                await restartKernel(sessions[0].kernelId);
            } else {
                await showRunningKernels();
            }
        }),
        vscode.commands.registerCommand('scimax.jupyter.interruptKernel', async () => {
            const sessions = manager.getSessions();
            if (sessions.length === 0) {
                vscode.window.showWarningMessage('No running kernels');
                return;
            }
            if (sessions.length === 1) {
                await interruptKernel(sessions[0].kernelId);
            } else {
                await showRunningKernels();
            }
        }),
        vscode.commands.registerCommand('scimax.jupyter.shutdownKernel', async () => {
            const sessions = manager.getSessions();
            if (sessions.length === 0) {
                vscode.window.showWarningMessage('No running kernels');
                return;
            }
            if (sessions.length === 1) {
                await shutdownKernel(sessions[0].kernelId);
            } else {
                await showRunningKernels();
            }
        }),
        vscode.commands.registerCommand('scimax.jupyter.shutdownAll', shutdownAllKernels),
    );

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: async () => {
            await disposeKernelManager();
            statusBarItem?.dispose();
            outputChannel?.dispose();
        },
    });
}
