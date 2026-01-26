/**
 * Find File Panel
 * Webview panel UI for Emacs-style find-file navigation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { FindFileManager } from './findFileManager';
import {
    FindFileState,
    FindFileMessageFromWebview,
    FindFileMessageToWebview,
    OriginalPosition,
    serializeState,
    formatSize,
    FindFileAction
} from './findFileTypes';

export class FindFilePanel {
    public static currentPanel: FindFilePanel | undefined;
    private static readonly viewType = 'scimaxFindFile';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly manager: FindFileManager;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        initialDirectory?: string,
        originalPosition?: OriginalPosition | null
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.manager = new FindFileManager(initialDirectory, originalPosition);

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Subscribe to state changes
        this.manager.onStateChange(state => this.updateWebview(state));

        // Initial render
        this.panel.webview.html = this.getHtmlContent();
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        directory?: string,
        originalPosition?: OriginalPosition | null
    ): FindFilePanel {
        const column = vscode.ViewColumn.Active;

        // If we already have a panel, dispose it and create a new one
        // (unlike dired, we want fresh state for each find-file invocation)
        if (FindFilePanel.currentPanel) {
            FindFilePanel.currentPanel.dispose();
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            FindFilePanel.viewType,
            'Find File',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        FindFilePanel.currentPanel = new FindFilePanel(panel, extensionUri, directory, originalPosition);
        return FindFilePanel.currentPanel;
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: FindFileMessageFromWebview): Promise<void> {
        try {
            switch (message.command) {
                case 'ready':
                    await this.manager.loadDirectory();
                    break;

                case 'navigate':
                    switch (message.direction) {
                        case 'up':
                            this.manager.moveSelection(-1);
                            break;
                        case 'down':
                            this.manager.moveSelection(1);
                            break;
                        case 'pageUp':
                            this.manager.moveSelection(-10);
                            break;
                        case 'pageDown':
                            this.manager.moveSelection(10);
                            break;
                        case 'home':
                            this.manager.selectFirst();
                            break;
                        case 'end':
                            this.manager.selectLast();
                            break;
                    }
                    break;

                case 'navigateInto':
                    await this.manager.navigateIntoSelected();
                    break;

                case 'navigateUp':
                    await this.manager.navigateToParent();
                    break;

                case 'open':
                    await this.handleOpen();
                    break;

                case 'showActions':
                    await this.showActionsMenu();
                    break;

                case 'filter':
                    this.manager.setFilter(message.text);
                    break;

                case 'backspace':
                    this.manager.backspaceFilter();
                    break;

                case 'clearFilter':
                    this.manager.clearFilter();
                    break;

                case 'toggleHidden':
                    this.manager.toggleHidden();
                    break;

                case 'quit':
                    this.dispose();
                    break;
            }
        } catch (error: any) {
            this.sendMessage({ command: 'error', message: error.message });
        }
    }

    /**
     * Handle opening the selected entry
     */
    private async handleOpen(): Promise<void> {
        const entry = this.manager.getSelectedEntry();
        if (!entry) return;

        if (entry.isDirectory) {
            // If it's "..", just navigate up
            if (entry.name === '..') {
                await this.manager.navigateToParent();
            } else {
                // Open directory in dired
                this.dispose();
                await vscode.commands.executeCommand('scimax.dired', entry.path);
            }
        } else {
            // Open file in editor and close panel
            this.dispose();
            await vscode.window.showTextDocument(vscode.Uri.file(entry.path));
        }
    }

    /**
     * Show the actions menu (M-o)
     */
    private async showActionsMenu(): Promise<void> {
        const entry = this.manager.getSelectedEntry();
        if (!entry || entry.name === '..') {
            this.sendMessage({ command: 'info', message: 'No file selected' });
            return;
        }

        const originalPosition = this.manager.getOriginalPosition();
        const hasOriginalPosition = originalPosition !== null;

        interface ActionItem extends vscode.QuickPickItem {
            action: FindFileAction;
        }

        const actions: ActionItem[] = [
            {
                label: '$(file) Insert relative path',
                description: hasOriginalPosition ? undefined : '(no original position)',
                action: 'insertRelative'
            },
            {
                label: '$(file-symlink-directory) Insert absolute path',
                description: hasOriginalPosition ? undefined : '(no original position)',
                action: 'insertAbsolute'
            },
            {
                label: '$(link) Insert org-link (relative)',
                description: hasOriginalPosition ? undefined : '(no original position)',
                action: 'orgLinkRelative'
            },
            {
                label: '$(link) Insert org-link (absolute)',
                description: hasOriginalPosition ? undefined : '(no original position)',
                action: 'orgLinkAbsolute'
            },
            {
                label: '$(folder-opened) Open in Finder/Explorer',
                action: 'openExternal'
            },
            {
                label: '$(copy) Copy relative path',
                action: 'copyRelative'
            },
            {
                label: '$(copy) Copy absolute path',
                action: 'copyAbsolute'
            },
            {
                label: '$(folder) Open directory in dired',
                action: 'openDired'
            },
            {
                label: '$(trash) Delete',
                action: 'delete'
            },
            {
                label: '$(edit) Rename',
                action: 'rename'
            },
            {
                label: '$(split-horizontal) Open in split',
                action: 'openSplit'
            }
        ];

        const selected = await vscode.window.showQuickPick(actions, {
            placeHolder: `Actions for ${entry.name}`
        });

        if (!selected) return;

        await this.executeAction(selected.action, entry);
    }

    /**
     * Execute an action on the selected entry
     */
    private async executeAction(action: FindFileAction, entry: { name: string; path: string; isDirectory: boolean }): Promise<void> {
        const originalPosition = this.manager.getOriginalPosition();

        switch (action) {
            case 'insertRelative':
                if (originalPosition) {
                    const relativePath = this.manager.getRelativePath(entry.path);
                    await this.insertAtOriginalPosition(originalPosition, relativePath);
                    this.dispose();
                }
                break;

            case 'insertAbsolute':
                if (originalPosition) {
                    await this.insertAtOriginalPosition(originalPosition, entry.path);
                    this.dispose();
                }
                break;

            case 'orgLinkRelative':
                if (originalPosition) {
                    const orgLink = this.manager.formatOrgLink(entry.path, true);
                    await this.insertAtOriginalPosition(originalPosition, orgLink);
                    this.dispose();
                }
                break;

            case 'orgLinkAbsolute':
                if (originalPosition) {
                    const orgLink = this.manager.formatOrgLink(entry.path, false);
                    await this.insertAtOriginalPosition(originalPosition, orgLink);
                    this.dispose();
                }
                break;

            case 'openExternal':
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
                break;

            case 'copyRelative':
                const relativePath = this.manager.getRelativePath(entry.path);
                await vscode.env.clipboard.writeText(relativePath);
                this.sendMessage({ command: 'info', message: 'Relative path copied' });
                break;

            case 'copyAbsolute':
                await vscode.env.clipboard.writeText(entry.path);
                this.sendMessage({ command: 'info', message: 'Absolute path copied' });
                break;

            case 'openDired':
                this.dispose();
                const dirPath = entry.isDirectory ? entry.path : path.dirname(entry.path);
                await vscode.commands.executeCommand('scimax.dired', dirPath);
                break;

            case 'delete':
                const confirm = await vscode.window.showWarningMessage(
                    `Delete "${entry.name}"?`,
                    { modal: true },
                    'Move to Trash',
                    'Delete Permanently'
                );
                if (confirm) {
                    const useTrash = confirm === 'Move to Trash';
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.file(entry.path), {
                            recursive: entry.isDirectory,
                            useTrash
                        });
                        this.sendMessage({ command: 'info', message: `Deleted ${entry.name}` });
                        await this.manager.loadDirectory();
                    } catch (error: any) {
                        this.sendMessage({ command: 'error', message: error.message });
                    }
                }
                break;

            case 'rename':
                const newName = await vscode.window.showInputBox({
                    prompt: 'New name',
                    value: entry.name,
                    valueSelection: [0, entry.name.lastIndexOf('.') > 0
                        ? entry.name.lastIndexOf('.')
                        : entry.name.length]
                });
                if (newName && newName !== entry.name) {
                    try {
                        const newPath = path.join(path.dirname(entry.path), newName);
                        await vscode.workspace.fs.rename(
                            vscode.Uri.file(entry.path),
                            vscode.Uri.file(newPath),
                            { overwrite: false }
                        );
                        this.sendMessage({ command: 'info', message: `Renamed to ${newName}` });
                        await this.manager.loadDirectory();
                    } catch (error: any) {
                        this.sendMessage({ command: 'error', message: error.message });
                    }
                }
                break;

            case 'openSplit':
                this.dispose();
                await vscode.window.showTextDocument(
                    vscode.Uri.file(entry.path),
                    { viewColumn: vscode.ViewColumn.Beside }
                );
                break;
        }
    }

    /**
     * Insert text at the original cursor position
     */
    private async insertAtOriginalPosition(original: OriginalPosition, text: string): Promise<void> {
        const editor = await vscode.window.showTextDocument(original.uri);
        await editor.edit(editBuilder => {
            editBuilder.insert(original.position, text);
        });
    }

    /**
     * Send message to webview
     */
    private sendMessage(message: FindFileMessageToWebview): void {
        this.panel.webview.postMessage(message);
    }

    /**
     * Update webview with new state
     */
    private updateWebview(state: FindFileState): void {
        this.panel.title = `Find: ${path.basename(state.currentDirectory)}`;
        this.sendMessage({
            command: 'update',
            state: serializeState(state)
        });
    }

    /**
     * Generate HTML content for the webview
     */
    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>Find File</title>
    <style>
        :root {
            --selected-bg: var(--vscode-list-activeSelectionBackground, #0066cc);
            --selected-fg: var(--vscode-list-activeSelectionForeground, #ffffff);
            --hover-bg: var(--vscode-list-hoverBackground, #e0e0e0);
            --dir-color: var(--vscode-textLink-foreground, #0066cc);
        }

        body {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
            font-size: var(--vscode-editor-font-size, 13px);
            line-height: 1.4;
            color: var(--vscode-foreground, #333);
            background-color: var(--vscode-editor-background, #fff);
            margin: 0;
            padding: 0;
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            padding: 8px 12px;
            background-color: var(--vscode-editorGroupHeader-tabsBackground, #f3f3f3);
            border-bottom: 1px solid var(--vscode-panel-border, #ccc);
            flex-shrink: 0;
        }

        .path {
            font-weight: bold;
            margin-bottom: 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .filter-container {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-label {
            color: var(--vscode-descriptionForeground, #666);
        }

        .filter-input {
            flex: 1;
            background: var(--vscode-input-background, #fff);
            color: var(--vscode-input-foreground, #000);
            border: 1px solid var(--vscode-input-border, #ccc);
            padding: 4px 8px;
            font-family: inherit;
            font-size: inherit;
            border-radius: 3px;
        }

        .filter-input:focus {
            outline: 1px solid var(--vscode-focusBorder, #007acc);
        }

        .content {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .file-list {
            width: 100%;
            border-collapse: collapse;
        }

        .file-row {
            cursor: pointer;
            user-select: none;
        }

        .file-row:hover {
            background-color: var(--hover-bg);
        }

        .file-row.selected {
            background-color: var(--selected-bg);
            color: var(--selected-fg);
        }

        .file-row.selected .file-name.directory {
            color: var(--selected-fg);
        }

        .file-row td {
            padding: 4px 12px;
            white-space: nowrap;
        }

        .icon-col {
            width: 24px;
            text-align: center;
        }

        .size-col {
            text-align: right;
            color: var(--vscode-descriptionForeground, #666);
            width: 60px;
        }

        .file-name {
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .file-name.directory {
            color: var(--dir-color);
            font-weight: bold;
        }

        .status-bar {
            padding: 6px 12px;
            background-color: var(--vscode-editorGroupHeader-tabsBackground, #f3f3f3);
            color: var(--vscode-foreground, #333);
            border-top: 1px solid var(--vscode-panel-border, #ccc);
            font-size: 11px;
            flex-shrink: 0;
        }

        .status-bar kbd {
            background: var(--vscode-keybindingLabel-background, #dddddd);
            color: var(--vscode-keybindingLabel-foreground, #333);
            border: 1px solid var(--vscode-keybindingLabel-border, #ccc);
            border-radius: 3px;
            padding: 1px 5px;
            font-family: inherit;
            font-weight: 500;
        }

        .message {
            position: fixed;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            padding: 8px 16px;
            border-radius: 4px;
            animation: fadeOut 3s forwards;
            z-index: 1000;
        }

        .message.info {
            background: var(--vscode-notificationsInfoIcon-foreground, #0066cc);
            color: white;
        }

        .message.error {
            background: var(--vscode-notificationsErrorIcon-foreground, #f44336);
            color: white;
        }

        @keyframes fadeOut {
            0%, 70% { opacity: 1; }
            100% { opacity: 0; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="path" id="current-path">/</div>
        <div class="filter-container">
            <span class="filter-label">Filter:</span>
            <input type="text" class="filter-input" id="filter-input" placeholder="Type to filter..." readonly>
        </div>
    </div>

    <div class="content" id="content">
        <table class="file-list" id="file-list">
            <tbody id="file-body"></tbody>
        </table>
    </div>

    <div class="status-bar">
        <kbd>Tab</kbd> enter dir |
        <kbd>Enter</kbd> open |
        <kbd>a</kbd>/<kbd>C-o</kbd> actions |
        <kbd>Backspace</kbd> up/clear |
        <kbd>.</kbd> hidden |
        <kbd>Esc</kbd> quit
    </div>

    <div id="message-container"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let state = null;

        // Send ready message
        vscode.postMessage({ command: 'ready' });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'update':
                    state = message.state;
                    render();
                    break;
                case 'info':
                    showMessage(message.message, 'info');
                    break;
                case 'error':
                    showMessage(message.message, 'error');
                    break;
            }
        });

        function render() {
            if (!state) return;

            // Update path
            document.getElementById('current-path').textContent = 'Find File: ' + state.currentDirectory;

            // Update filter input
            document.getElementById('filter-input').value = state.filterText;

            // Update file list
            const tbody = document.getElementById('file-body');
            tbody.innerHTML = '';

            state.filteredEntries.forEach((entry, index) => {
                const tr = document.createElement('tr');
                tr.className = 'file-row' + (index === state.selectedIndex ? ' selected' : '');
                tr.dataset.index = index;

                // Icon column
                const iconTd = document.createElement('td');
                iconTd.className = 'icon-col';
                iconTd.textContent = entry.isDirectory ? '\ud83d\udcc1' : '\ud83d\udcc4';
                tr.appendChild(iconTd);

                // Name column
                const nameTd = document.createElement('td');
                nameTd.className = 'file-name';
                if (entry.isDirectory) {
                    nameTd.classList.add('directory');
                }
                nameTd.textContent = entry.name + (entry.isDirectory && entry.name !== '..' ? '/' : '');
                tr.appendChild(nameTd);

                // Size column
                const sizeTd = document.createElement('td');
                sizeTd.className = 'size-col';
                sizeTd.textContent = entry.isDirectory ? '' : formatSize(entry.size);
                tr.appendChild(sizeTd);

                // Event listeners
                tr.addEventListener('click', () => {
                    state.selectedIndex = index;
                    render();
                });
                tr.addEventListener('dblclick', () => {
                    if (entry.isDirectory) {
                        vscode.postMessage({ command: 'navigateInto' });
                    } else {
                        vscode.postMessage({ command: 'open' });
                    }
                });

                tbody.appendChild(tr);
            });

            // Scroll selected into view
            const selectedRow = document.querySelector('.file-row.selected');
            if (selectedRow) {
                selectedRow.scrollIntoView({ block: 'nearest' });
            }
        }

        function formatSize(bytes) {
            if (bytes === 0) return '-';
            const units = ['B', 'K', 'M', 'G', 'T'];
            let unitIndex = 0;
            let size = bytes;
            while (size >= 1024 && unitIndex < units.length - 1) {
                size /= 1024;
                unitIndex++;
            }
            if (unitIndex === 0) return size.toString();
            return size.toFixed(1) + units[unitIndex];
        }

        function showMessage(text, type) {
            const container = document.getElementById('message-container');
            const msg = document.createElement('div');
            msg.className = 'message ' + type;
            msg.textContent = text;
            container.appendChild(msg);
            setTimeout(() => msg.remove(), 3000);
        }

        // Keyboard handling
        document.addEventListener('keydown', (e) => {
            // Tab - enter directory
            if (e.key === 'Tab') {
                e.preventDefault();
                const selected = state?.filteredEntries[state.selectedIndex];
                if (selected?.isDirectory) {
                    vscode.postMessage({ command: 'navigateInto' });
                }
                return;
            }

            // Enter - open
            if (e.key === 'Enter') {
                e.preventDefault();
                vscode.postMessage({ command: 'open' });
                return;
            }

            // Ctrl+O - show actions (M-o doesn't work on macOS)
            if (e.key === 'o' && e.ctrlKey) {
                e.preventDefault();
                vscode.postMessage({ command: 'showActions' });
                return;
            }

            // 'a' for actions when filter is empty
            if (e.key === 'a' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (!state?.filterText || state.filterText === '') {
                    e.preventDefault();
                    vscode.postMessage({ command: 'showActions' });
                    return;
                }
            }

            // Escape - quit
            if (e.key === 'Escape') {
                e.preventDefault();
                vscode.postMessage({ command: 'quit' });
                return;
            }

            // Backspace - delete filter char or navigate up
            if (e.key === 'Backspace') {
                e.preventDefault();
                if (state?.filterText && state.filterText.length > 0) {
                    vscode.postMessage({ command: 'backspace' });
                } else {
                    vscode.postMessage({ command: 'navigateUp' });
                }
                return;
            }

            // Navigation keys
            if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
                e.preventDefault();
                vscode.postMessage({ command: 'navigate', direction: 'down' });
                return;
            }
            if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
                e.preventDefault();
                vscode.postMessage({ command: 'navigate', direction: 'up' });
                return;
            }
            if (e.key === 'PageDown') {
                e.preventDefault();
                vscode.postMessage({ command: 'navigate', direction: 'pageDown' });
                return;
            }
            if (e.key === 'PageUp') {
                e.preventDefault();
                vscode.postMessage({ command: 'navigate', direction: 'pageUp' });
                return;
            }
            if (e.key === 'Home') {
                e.preventDefault();
                vscode.postMessage({ command: 'navigate', direction: 'home' });
                return;
            }
            if (e.key === 'End') {
                e.preventDefault();
                vscode.postMessage({ command: 'navigate', direction: 'end' });
                return;
            }

            // Period - toggle hidden
            if (e.key === '.' && !e.ctrlKey && !e.altKey) {
                // Only if at beginning of filter or filter is empty
                if (!state?.filterText || state.filterText === '') {
                    e.preventDefault();
                    vscode.postMessage({ command: 'toggleHidden' });
                    return;
                }
            }

            // Clear filter with Ctrl+U
            if (e.key === 'u' && e.ctrlKey) {
                e.preventDefault();
                vscode.postMessage({ command: 'clearFilter' });
                return;
            }

            // Type characters to filter (printable characters)
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
                e.preventDefault();
                const newFilter = (state?.filterText || '') + e.key;
                vscode.postMessage({ command: 'filter', text: newFilter });
                return;
            }
        });
    </script>
</body>
</html>`;
    }

    /**
     * Dispose the panel
     */
    public dispose(): void {
        FindFilePanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
