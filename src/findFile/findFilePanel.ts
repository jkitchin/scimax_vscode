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

                case 'action':
                    await this.executeAction(message.action);
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

        // If no entry selected but we have filter text, try to create the file
        if (!entry || this.manager.getState().filteredEntries.length === 0) {
            if (this.manager.canCreateFile()) {
                try {
                    const filePath = await this.manager.createFile();
                    if (filePath) {
                        this.dispose();
                        await vscode.window.showTextDocument(vscode.Uri.file(filePath));
                        return;
                    }
                } catch (error: any) {
                    this.sendMessage({ command: 'error', message: `Failed to create file: ${error.message}` });
                    return;
                }
            }
            return;
        }

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
     * Execute an action on the selected entry
     */
    private async executeAction(action: FindFileAction): Promise<void> {
        const entry = this.manager.getSelectedEntry();
        if (!entry || entry.name === '..') {
            this.sendMessage({ command: 'info', message: 'No file selected' });
            return;
        }

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
        const serialized = serializeState(state);
        // Add canCreateFile from manager
        serialized.canCreateFile = this.manager.canCreateFile();
        this.sendMessage({
            command: 'update',
            state: serialized
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

        .file-row.create-new .create-new-name {
            color: var(--vscode-textLink-activeForeground, #3794ff);
            font-style: italic;
        }

        .file-row.create-new.selected .create-new-name {
            color: var(--selected-fg);
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
            cursor: pointer;
        }

        .status-bar kbd:hover {
            background: var(--vscode-keybindingLabel-bottomBorder, #bbb);
        }

        .status-bar .clickable {
            cursor: pointer;
        }

        .status-bar .clickable:hover {
            text-decoration: underline;
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

        .actions-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 100;
            justify-content: center;
            align-items: center;
        }

        .actions-overlay.visible {
            display: flex;
        }

        .actions-panel {
            background: var(--vscode-editor-background, #fff);
            border: 1px solid var(--vscode-panel-border, #ccc);
            border-radius: 6px;
            padding: 16px;
            max-width: 500px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .actions-title {
            font-weight: bold;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border, #ccc);
        }

        .actions-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px 24px;
        }

        .action-item {
            display: flex;
            align-items: center;
            padding: 4px 6px;
            cursor: pointer;
            border-radius: 3px;
        }

        .action-item:hover {
            background: var(--vscode-list-hoverBackground, #e8e8e8);
        }

        .action-key {
            background: var(--vscode-keybindingLabel-background, #dddddd);
            color: var(--vscode-keybindingLabel-foreground, #333);
            border: 1px solid var(--vscode-keybindingLabel-border, #ccc);
            border-radius: 3px;
            padding: 1px 6px;
            font-family: monospace;
            font-weight: 600;
            min-width: 20px;
            text-align: center;
            margin-right: 8px;
        }

        .action-desc {
            color: var(--vscode-foreground, #333);
        }

        .actions-footer {
            margin-top: 12px;
            padding-top: 8px;
            border-top: 1px solid var(--vscode-panel-border, #ccc);
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #666);
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
        <span class="clickable" id="btn-tab"><kbd>Tab</kbd> enter dir</span> |
        <span class="clickable" id="btn-enter"><kbd>Enter</kbd> open</span> |
        <span class="clickable" id="btn-actions"><kbd>M-o</kbd> actions</span> |
        <span class="clickable" id="btn-backspace"><kbd>Backspace</kbd> up/clear</span> |
        <span class="clickable" id="btn-hidden"><kbd>.</kbd> hidden</span> |
        <span class="clickable" id="btn-quit"><kbd>Esc</kbd> quit</span>
    </div>

    <div class="actions-overlay" id="actions-overlay">
        <div class="actions-panel">
            <div class="actions-title">action:</div>
            <div class="actions-grid">
                <div class="action-item" data-action="open"><span class="action-key">o</span><span class="action-desc">open (default)</span></div>
                <div class="action-item" data-action="openSplit"><span class="action-key">j</span><span class="action-desc">open in split</span></div>
                <div class="action-item" data-action="insertRelative"><span class="action-key">p</span><span class="action-desc">insert relative path</span></div>
                <div class="action-item" data-action="insertAbsolute"><span class="action-key">P</span><span class="action-desc">insert absolute path</span></div>
                <div class="action-item" data-action="orgLinkRelative"><span class="action-key">l</span><span class="action-desc">insert org-link (rel)</span></div>
                <div class="action-item" data-action="orgLinkAbsolute"><span class="action-key">L</span><span class="action-desc">insert org-link (abs)</span></div>
                <div class="action-item" data-action="copyRelative"><span class="action-key">c</span><span class="action-desc">copy relative path</span></div>
                <div class="action-item" data-action="copyAbsolute"><span class="action-key">C</span><span class="action-desc">copy absolute path</span></div>
                <div class="action-item" data-action="openDired"><span class="action-key">d</span><span class="action-desc">open in dired</span></div>
                <div class="action-item" data-action="openExternal"><span class="action-key">e</span><span class="action-desc">open in Finder</span></div>
                <div class="action-item" data-action="rename"><span class="action-key">r</span><span class="action-desc">rename</span></div>
                <div class="action-item" data-action="delete"><span class="action-key">D</span><span class="action-desc">delete</span></div>
            </div>
            <div class="actions-footer"><kbd>M-o</kbd> or <kbd>Esc</kbd> to cancel</div>
        </div>
    </div>

    <div id="message-container"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let state = null;
        let actionsMode = false;

        // Action key mappings
        const actionKeys = {
            'o': 'open',
            'j': 'openSplit',
            'p': 'insertRelative',
            'P': 'insertAbsolute',
            'l': 'orgLinkRelative',
            'L': 'orgLinkAbsolute',
            'c': 'copyRelative',
            'C': 'copyAbsolute',
            'd': 'openDired',
            'e': 'openExternal',
            'r': 'rename',
            'D': 'delete'
        };

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

        function showActionsPanel() {
            actionsMode = true;
            document.getElementById('actions-overlay').classList.add('visible');
        }

        function hideActionsPanel() {
            actionsMode = false;
            document.getElementById('actions-overlay').classList.remove('visible');
        }

        // Set up click handlers for status bar buttons
        document.getElementById('btn-tab').addEventListener('click', () => {
            const selected = state?.filteredEntries[state.selectedIndex];
            if (selected?.isDirectory) {
                vscode.postMessage({ command: 'navigateInto' });
            }
        });
        document.getElementById('btn-enter').addEventListener('click', () => {
            vscode.postMessage({ command: 'open' });
        });
        document.getElementById('btn-actions').addEventListener('click', () => {
            showActionsPanel();
        });
        document.getElementById('btn-backspace').addEventListener('click', () => {
            if (state?.filterText && state.filterText.length > 0) {
                vscode.postMessage({ command: 'backspace' });
            } else {
                vscode.postMessage({ command: 'navigateUp' });
            }
        });
        document.getElementById('btn-hidden').addEventListener('click', () => {
            vscode.postMessage({ command: 'toggleHidden' });
        });
        document.getElementById('btn-quit').addEventListener('click', () => {
            vscode.postMessage({ command: 'quit' });
        });

        // Click on overlay background to close
        document.getElementById('actions-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'actions-overlay') {
                hideActionsPanel();
            }
        });

        // Click handlers for action items
        document.querySelectorAll('.action-item[data-action]').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                hideActionsPanel();
                if (action === 'open') {
                    vscode.postMessage({ command: 'open' });
                } else {
                    vscode.postMessage({ command: 'action', action: action });
                }
            });
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

            // Show "Create new file" option if applicable
            if (state.canCreateFile && state.filteredEntries.length === 0) {
                const tr = document.createElement('tr');
                tr.className = 'file-row selected create-new';
                tr.dataset.createNew = 'true';

                const iconTd = document.createElement('td');
                iconTd.className = 'icon-col';
                iconTd.textContent = '\u2795';  // Plus sign
                tr.appendChild(iconTd);

                const nameTd = document.createElement('td');
                nameTd.className = 'file-name create-new-name';
                nameTd.textContent = '[Create new file: ' + state.filterText + ']';
                tr.appendChild(nameTd);

                const sizeTd = document.createElement('td');
                sizeTd.className = 'size-col';
                sizeTd.textContent = '';
                tr.appendChild(sizeTd);

                tr.addEventListener('click', () => {
                    vscode.postMessage({ command: 'open' });
                });
                tr.addEventListener('dblclick', () => {
                    vscode.postMessage({ command: 'open' });
                });

                tbody.appendChild(tr);
            } else {
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
            }

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
            // Handle actions mode
            if (actionsMode) {
                e.preventDefault();

                // C-o, M-o, or Escape to cancel
                if ((e.key === 'o' && (e.altKey || e.ctrlKey)) ||
                    (e.code === 'KeyO' && (e.altKey || e.ctrlKey)) ||
                    e.key === 'ø' || e.key === 'œ' ||
                    e.key === 'Escape') {
                    hideActionsPanel();
                    return;
                }

                // Check for action key
                const action = actionKeys[e.key];
                if (action) {
                    hideActionsPanel();
                    if (action === 'open') {
                        vscode.postMessage({ command: 'open' });
                    } else {
                        vscode.postMessage({ command: 'action', action: action });
                    }
                }
                return;
            }

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

            // M-o (Alt/Option+O) or Ctrl+O - show actions panel
            // Check multiple variants for Mac compatibility
            if ((e.key === 'o' && (e.altKey || e.ctrlKey)) ||
                e.key === 'ø' || e.key === 'œ' || e.key === 'ο' ||
                (e.code === 'KeyO' && (e.altKey || e.ctrlKey))) {
                e.preventDefault();
                showActionsPanel();
                return;
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
