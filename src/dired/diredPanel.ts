/**
 * Dired Panel
 * Webview panel UI for the dired file manager
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DiredManager } from './diredManager';
import {
    DiredState,
    DiredMessageFromWebview,
    DiredMessageToWebview,
    serializeState,
    formatSize,
    formatDate,
    formatPermissions
} from './diredTypes';

export class DiredPanel {
    public static currentPanel: DiredPanel | undefined;
    private static readonly viewType = 'scimaxDired';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly manager: DiredManager;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        initialDirectory?: string
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.manager = new DiredManager(initialDirectory);

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

    public static createOrShow(extensionUri: vscode.Uri, directory?: string): DiredPanel {
        const column = vscode.ViewColumn.Active;

        // If we already have a panel, update it with new directory
        if (DiredPanel.currentPanel) {
            DiredPanel.currentPanel.panel.reveal(column);
            if (directory) {
                DiredPanel.currentPanel.manager.loadDirectory(directory);
            }
            return DiredPanel.currentPanel;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            DiredPanel.viewType,
            'Dired',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        DiredPanel.currentPanel = new DiredPanel(panel, extensionUri, directory);
        return DiredPanel.currentPanel;
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: DiredMessageFromWebview): Promise<void> {
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

                case 'select':
                    this.manager.selectIndex(message.index);
                    break;

                case 'open':
                    const entry = await this.manager.openAtIndex(message.index);
                    if (entry) {
                        await vscode.window.showTextDocument(vscode.Uri.file(entry.path));
                    }
                    break;

                case 'openInEditor':
                    const entryToOpen = this.manager.getState().entries[message.index];
                    if (entryToOpen && !entryToOpen.isDirectory) {
                        await vscode.window.showTextDocument(vscode.Uri.file(entryToOpen.path));
                    }
                    break;

                case 'openExternal':
                    const entryToReveal = this.manager.getState().entries[message.index];
                    if (entryToReveal) {
                        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entryToReveal.path));
                    }
                    break;

                case 'copyPath':
                    const entryToCopy = this.manager.getState().entries[message.index];
                    if (entryToCopy) {
                        await vscode.env.clipboard.writeText(entryToCopy.path);
                        this.sendMessage({ command: 'info', message: 'Path copied to clipboard' });
                    }
                    break;

                case 'openParent':
                    await this.manager.navigateToParent();
                    break;

                case 'mark':
                    this.manager.selectIndex(message.index);
                    this.manager.markCurrent();
                    break;

                case 'unmark':
                    this.manager.selectIndex(message.index);
                    this.manager.unmarkCurrent();
                    break;

                case 'toggleMark':
                    this.manager.selectIndex(message.index);
                    this.manager.toggleMarkCurrent();
                    break;

                case 'flag':
                    this.manager.selectIndex(message.index);
                    this.manager.flagCurrent();
                    break;

                case 'unmarkAll':
                    this.manager.unmarkAll();
                    break;

                case 'toggleAllMarks':
                    this.manager.toggleAllMarks();
                    break;

                case 'markRegex':
                    const count = this.manager.markByRegex(message.pattern);
                    this.sendMessage({ command: 'info', message: `Marked ${count} files` });
                    break;

                case 'delete':
                    await this.handleDelete();
                    break;

                case 'copy':
                    await this.handleCopy();
                    break;

                case 'rename':
                    await this.handleRename();
                    break;

                case 'createDir':
                    if (message.name) {
                        // Name provided directly
                        try {
                            await this.manager.createDirectory(message.name);
                            this.sendMessage({ command: 'info', message: `Created directory: ${message.name}` });
                        } catch (error: any) {
                            this.sendMessage({ command: 'error', message: error.message });
                        }
                    } else {
                        // Prompt for name using VS Code's input box
                        const name = await vscode.window.showInputBox({
                            prompt: 'New directory name',
                            placeHolder: 'Enter directory name'
                        });
                        if (name) {
                            try {
                                await this.manager.createDirectory(name);
                                this.sendMessage({ command: 'info', message: `Created directory: ${name}` });
                            } catch (error: any) {
                                this.sendMessage({ command: 'error', message: error.message });
                            }
                        }
                    }
                    break;

                case 'refresh':
                    await this.manager.loadDirectory();
                    break;

                case 'toggleHidden':
                    this.manager.toggleHidden();
                    break;

                case 'sort':
                    this.manager.setSort(message.field);
                    break;

                case 'filter':
                    this.manager.setFilter(message.pattern);
                    break;

                case 'promptFilter':
                    // Prompt for filter pattern using VS Code's input box
                    const filterPattern = await vscode.window.showInputBox({
                        prompt: 'Filter pattern (glob)',
                        placeHolder: 'e.g., *.txt'
                    });
                    if (filterPattern !== undefined) {
                        this.manager.setFilter(filterPattern);
                    }
                    break;

                case 'findFile':
                    // Find file - create if it doesn't exist
                    const fileName = await vscode.window.showInputBox({
                        prompt: 'File name (creates if not exists)',
                        placeHolder: 'Enter file name'
                    });
                    if (fileName) {
                        const currentDir = this.manager.getState().currentDirectory;
                        const filePath = vscode.Uri.joinPath(vscode.Uri.file(currentDir), fileName);
                        try {
                            await vscode.workspace.fs.stat(filePath);
                        } catch {
                            // File doesn't exist - create it
                            await vscode.workspace.fs.writeFile(filePath, new Uint8Array());
                        }
                        await vscode.commands.executeCommand('vscode.open', filePath);
                    }
                    break;

                case 'promptMarkRegex':
                    // Prompt for regex pattern to mark files
                    const regexPattern = await vscode.window.showInputBox({
                        prompt: 'Mark files matching (regex)',
                        placeHolder: 'e.g., \\.txt$'
                    });
                    if (regexPattern) {
                        const count = this.manager.markByRegex(regexPattern);
                        this.sendMessage({ command: 'info', message: `Marked ${count} files` });
                    }
                    break;

                case 'wdiredEnter':
                    this.manager.enterWdiredMode();
                    break;

                case 'wdiredCommit':
                    for (const { original, newName } of message.renames) {
                        this.manager.addPendingRename(original, newName);
                    }
                    const result = await this.manager.commitWdiredRenames();
                    if (result.errors.length > 0) {
                        this.sendMessage({
                            command: 'error',
                            message: `Errors: ${result.errors.join(', ')}`
                        });
                    }
                    if (result.renamed.length > 0) {
                        this.sendMessage({
                            command: 'info',
                            message: `Renamed ${result.renamed.length} files`
                        });
                    }
                    break;

                case 'wdiredCancel':
                    this.manager.exitWdiredMode();
                    break;

                case 'showActions':
                    await this.showActionsMenu();
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
     * Handle delete operation with confirmation
     */
    private async handleDelete(): Promise<void> {
        const files = this.manager.getFilesToOperateOn();
        if (files.length === 0) return;

        const config = vscode.workspace.getConfiguration('scimax.dired');
        const confirmDelete = config.get<boolean>('confirmDelete', true);

        if (confirmDelete) {
            const dirs = files.filter(f => f.isDirectory);
            const regularFiles = files.filter(f => !f.isDirectory);

            let message: string;
            if (files.length === 1) {
                if (dirs.length === 1) {
                    message = `Recursively delete directory "${dirs[0].name}" and all its contents?`;
                } else {
                    message = `Delete "${files[0].name}"?`;
                }
            } else {
                const parts: string[] = [];
                if (regularFiles.length > 0) {
                    parts.push(`${regularFiles.length} file${regularFiles.length > 1 ? 's' : ''}`);
                }
                if (dirs.length > 0) {
                    parts.push(`${dirs.length} director${dirs.length > 1 ? 'ies' : 'y'} (recursively)`);
                }
                message = `Delete ${parts.join(' and ')}?`;
            }

            const choice = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Move to Trash',
                'Delete Permanently'
            );

            if (!choice) return;

            const useTrash = choice === 'Move to Trash';
            const result = await this.manager.deleteFiles(useTrash);

            if (result.errors.length > 0) {
                vscode.window.showErrorMessage(`Delete errors: ${result.errors.join(', ')}`);
            }
            if (result.deleted.length > 0) {
                vscode.window.showInformationMessage(
                    `Deleted ${result.deleted.length} files`
                );
            }
        } else {
            const result = await this.manager.deleteFiles(true);
            if (result.deleted.length > 0) {
                this.sendMessage({
                    command: 'info',
                    message: `Deleted ${result.deleted.length} files`
                });
            }
        }
    }

    /**
     * Handle copy operation with destination prompt
     */
    private async handleCopy(): Promise<void> {
        const files = this.manager.getFilesToOperateOn();
        if (files.length === 0) return;

        const destination = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Copy Here',
            title: `Copy ${files.length} file(s) to...`,
            defaultUri: vscode.Uri.file(this.manager.getState().currentDirectory)
        });

        if (!destination || destination.length === 0) return;

        const result = await this.manager.copyFiles(destination[0].fsPath);

        if (result.errors.length > 0) {
            vscode.window.showErrorMessage(`Copy errors: ${result.errors.join(', ')}`);
        }
        if (result.copied.length > 0) {
            vscode.window.showInformationMessage(`Copied ${result.copied.length} files`);
        }
    }

    /**
     * Handle rename/move operation
     */
    private async handleRename(): Promise<void> {
        const files = this.manager.getFilesToOperateOn();
        if (files.length === 0) return;

        // Single file - allow rename in place
        if (files.length === 1) {
            const newName = await vscode.window.showInputBox({
                prompt: 'New name',
                value: files[0].name,
                valueSelection: [0, files[0].name.lastIndexOf('.') > 0
                    ? files[0].name.lastIndexOf('.')
                    : files[0].name.length]
            });

            if (!newName || newName === files[0].name) return;

            const destination = path.dirname(files[0].path);
            this.manager.addPendingRename(files[0].name, newName);
            const result = await this.manager.commitWdiredRenames();

            if (result.errors.length > 0) {
                vscode.window.showErrorMessage(`Rename error: ${result.errors.join(', ')}`);
            } else {
                vscode.window.showInformationMessage(`Renamed to ${newName}`);
            }
            return;
        }

        // Multiple files - move to destination
        const destination = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Move Here',
            title: `Move ${files.length} file(s) to...`,
            defaultUri: vscode.Uri.file(this.manager.getState().currentDirectory)
        });

        if (!destination || destination.length === 0) return;

        const result = await this.manager.renameFiles(destination[0].fsPath);

        if (result.errors.length > 0) {
            vscode.window.showErrorMessage(`Move errors: ${result.errors.join(', ')}`);
        }
        if (result.renamed.length > 0) {
            vscode.window.showInformationMessage(`Moved ${result.renamed.length} files`);
        }
    }

    /**
     * Show the actions menu (M-o)
     */
    private async showActionsMenu(): Promise<void> {
        const state = this.manager.getState();
        const entry = state.entries[state.selectedIndex];
        if (!entry || entry.name === '.' || entry.name === '..') {
            this.sendMessage({ command: 'info', message: 'No file selected' });
            return;
        }

        interface ActionItem extends vscode.QuickPickItem {
            action: string;
        }

        const actions: ActionItem[] = [
            { label: '$(file) Open in Editor', action: 'openInEditor' },
            { label: '$(folder-opened) Open in Finder/Explorer', action: 'openExternal' },
            { label: '$(copy) Copy Path', action: 'copyPath' },
            { label: '$(files) Copy File', action: 'copy' },
            { label: '$(edit) Rename/Move', action: 'rename' },
            { label: '$(trash) Delete', action: 'delete' },
            { label: '$(check) Mark', action: 'mark' },
            { label: '$(circle-slash) Unmark', action: 'unmark' },
            { label: '$(warning) Flag for Deletion', action: 'flag' },
        ];

        if (entry.isDirectory) {
            actions.unshift({ label: '$(folder) Enter Directory', action: 'enter' });
        }

        const selected = await vscode.window.showQuickPick(actions, {
            placeHolder: `Actions for ${entry.name}`
        });

        if (!selected) return;

        switch (selected.action) {
            case 'enter':
                await this.manager.openAtIndex(state.selectedIndex);
                break;
            case 'openInEditor':
                if (!entry.isDirectory) {
                    await vscode.window.showTextDocument(vscode.Uri.file(entry.path));
                }
                break;
            case 'openExternal':
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
                break;
            case 'copyPath':
                await vscode.env.clipboard.writeText(entry.path);
                this.sendMessage({ command: 'info', message: 'Path copied to clipboard' });
                break;
            case 'copy':
                await this.handleCopy();
                break;
            case 'rename':
                await this.handleRename();
                break;
            case 'delete':
                await this.handleDelete();
                break;
            case 'mark':
                this.manager.markCurrent();
                break;
            case 'unmark':
                this.manager.unmarkCurrent();
                break;
            case 'flag':
                this.manager.flagCurrent();
                break;
        }
    }

    /**
     * Send message to webview
     */
    private sendMessage(message: DiredMessageToWebview): void {
        this.panel.webview.postMessage(message);
    }

    /**
     * Update webview with new state
     */
    private updateWebview(state: DiredState): void {
        this.panel.title = `Dired: ${path.basename(state.currentDirectory)}`;
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
    <title>Dired</title>
    <style>
        :root {
            --mark-color: #4CAF50;
            --flag-color: #f44336;
            --selected-bg: var(--vscode-list-activeSelectionBackground, #0066cc);
            --selected-fg: var(--vscode-list-activeSelectionForeground, #ffffff);
            --hover-bg: var(--vscode-list-hoverBackground, #e0e0e0);
            --dir-color: var(--vscode-textLink-foreground, #0066cc);
            --symlink-color: #9C27B0;
            --exec-color: #4CAF50;
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
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        .path {
            font-weight: bold;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .toolbar {
            display: flex;
            gap: 4px;
        }

        .toolbar button {
            background: var(--vscode-button-secondaryBackground, #5f5f5f);
            color: var(--vscode-button-secondaryForeground, #fff);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }

        .toolbar button:hover {
            background: var(--vscode-button-secondaryHoverBackground, #4f4f4f);
        }

        .toolbar button.primary {
            background: var(--vscode-button-background, #0066cc);
            color: var(--vscode-button-foreground, #fff);
        }

        .toolbar button.primary:hover {
            background: var(--vscode-button-hoverBackground, #0055aa);
        }

        .status-bar {
            padding: 4px 12px;
            background-color: var(--vscode-statusBar-background, #007acc);
            color: var(--vscode-statusBar-foreground, #fff);
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            flex-shrink: 0;
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
            padding: 2px 8px;
            white-space: nowrap;
        }

        .mark-col {
            width: 20px;
            text-align: center;
            font-weight: bold;
        }

        .mark-col.marked {
            color: var(--mark-color);
        }

        .mark-col.flagged {
            color: var(--flag-color);
        }

        .perms-col {
            font-family: monospace;
            color: var(--vscode-descriptionForeground, #666);
        }

        .size-col {
            text-align: right;
            color: var(--vscode-descriptionForeground, #666);
            width: 60px;
        }

        .date-col {
            color: var(--vscode-descriptionForeground, #666);
            width: 100px;
        }

        .file-name {
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .file-name.directory {
            color: var(--dir-color);
            font-weight: bold;
        }

        .file-name.symlink {
            color: var(--symlink-color);
            font-style: italic;
        }

        .file-name.executable {
            color: var(--exec-color);
        }

        .symlink-target {
            color: var(--vscode-descriptionForeground, #666);
            font-style: italic;
        }

        .wdired-mode .file-name-input {
            background: var(--vscode-input-background, #fff);
            color: var(--vscode-input-foreground, #000);
            border: 1px solid var(--vscode-input-border, #ccc);
            font-family: inherit;
            font-size: inherit;
            padding: 1px 4px;
            width: 300px;
        }

        .wdired-mode .file-name-input.changed {
            background: var(--vscode-inputValidation-warningBackground, #fff3cd);
            border-color: var(--vscode-inputValidation-warningBorder, #ffc107);
        }

        .help-text {
            padding: 12px;
            color: var(--vscode-descriptionForeground, #666);
            font-size: 11px;
        }

        .help-text kbd {
            background: var(--vscode-keybindingLabel-background, #ddd);
            border: 1px solid var(--vscode-keybindingLabel-border, #ccc);
            border-radius: 3px;
            padding: 1px 4px;
            font-family: inherit;
        }

        .message {
            position: fixed;
            bottom: 30px;
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
        <button onclick="goUp()" title="Parent directory (^)">↑</button>
        <span class="path" id="current-path">/</span>
        <div class="toolbar">
            <button onclick="toggleHidden()" title="Toggle hidden files (.)">.*</button>
            <button onclick="refresh()" title="Refresh (g)">↻</button>
            <button onclick="promptFilter()" title="Filter (/)">Filter</button>
            <button onclick="createDir()" title="Create directory (+)">+ Dir</button>
        </div>
    </div>

    <div class="content" id="content">
        <table class="file-list" id="file-list">
            <tbody id="file-body"></tbody>
        </table>
    </div>

    <div class="status-bar">
        <span id="status-left">Loading...</span>
        <span id="status-right"></span>
    </div>

    <div id="message-container"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let state = null;
        let wdiredOriginalNames = {};

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
            document.getElementById('current-path').textContent = state.currentDirectory;

            // Update file list
            const tbody = document.getElementById('file-body');
            tbody.innerHTML = '';

            // Store original names for wdired
            if (state.wdiredMode) {
                wdiredOriginalNames = {};
                state.entries.forEach(entry => {
                    wdiredOriginalNames[entry.index] = entry.name;
                });
            }

            state.entries.forEach((entry, index) => {
                const tr = document.createElement('tr');
                tr.className = 'file-row' + (index === state.selectedIndex ? ' selected' : '');
                tr.dataset.index = index;

                // Mark column
                const markTd = document.createElement('td');
                markTd.className = 'mark-col';
                if (entry.mark === 'marked') {
                    markTd.textContent = '*';
                    markTd.classList.add('marked');
                } else if (entry.mark === 'flagged') {
                    markTd.textContent = 'D';
                    markTd.classList.add('flagged');
                }
                tr.appendChild(markTd);

                // Permissions column
                const permsTd = document.createElement('td');
                permsTd.className = 'perms-col';
                permsTd.textContent = formatPermissions(entry.mode, entry.isDirectory, entry.isSymlink);
                tr.appendChild(permsTd);

                // Size column
                const sizeTd = document.createElement('td');
                sizeTd.className = 'size-col';
                sizeTd.textContent = entry.isDirectory ? '<DIR>' : formatSize(entry.size);
                tr.appendChild(sizeTd);

                // Date column
                const dateTd = document.createElement('td');
                dateTd.className = 'date-col';
                dateTd.textContent = formatDate(new Date(entry.mtime));
                tr.appendChild(dateTd);

                // Name column
                const nameTd = document.createElement('td');
                nameTd.className = 'file-name';

                if (state.wdiredMode) {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'file-name-input';
                    input.value = entry.name;
                    input.dataset.original = entry.name;
                    input.addEventListener('input', () => {
                        if (input.value !== input.dataset.original) {
                            input.classList.add('changed');
                        } else {
                            input.classList.remove('changed');
                        }
                        updateWdiredStatus();
                    });
                    nameTd.appendChild(input);
                } else {
                    if (entry.isDirectory) {
                        nameTd.classList.add('directory');
                    } else if (entry.isSymlink) {
                        nameTd.classList.add('symlink');
                    } else if (entry.mode & 0o111) {
                        nameTd.classList.add('executable');
                    }

                    let displayName = entry.name;
                    if (entry.isDirectory) displayName += '/';
                    if (entry.isSymlink && entry.symlinkTarget) {
                        displayName += ' → ' + entry.symlinkTarget;
                    }
                    nameTd.textContent = displayName;
                }
                tr.appendChild(nameTd);

                // Event listeners
                tr.addEventListener('click', (e) => {
                    if (e.target.tagName !== 'INPUT') {
                        selectRow(index);
                    }
                });
                tr.addEventListener('dblclick', (e) => {
                    if (e.target.tagName !== 'INPUT') {
                        openEntry(index);
                    }
                });
                tr.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showContextMenu(e, index);
                });

                tbody.appendChild(tr);
            });

            // Update status bar
            const markedCount = state.entries.filter(e => e.mark === 'marked').length;
            const flaggedCount = state.entries.filter(e => e.mark === 'flagged').length;

            let statusLeft = state.entries.length + ' files';
            if (markedCount > 0) statusLeft += ', ' + markedCount + ' marked';
            if (flaggedCount > 0) statusLeft += ', ' + flaggedCount + ' flagged';
            if (state.filterPattern) statusLeft += ' [filter: ' + state.filterPattern + ']';

            let statusRight = 'Sort: ' + state.sort.field + ' ' + (state.sort.direction === 'asc' ? '↑' : '↓');
            if (state.showHidden) statusRight += ' | Hidden: ON';
            if (state.wdiredMode) statusRight = 'WDIRED MODE - C-c C-c to commit, C-c C-k to cancel';

            document.getElementById('status-left').textContent = statusLeft;
            document.getElementById('status-right').textContent = statusRight;

            // Add wdired class to body
            document.body.classList.toggle('wdired-mode', state.wdiredMode);

            // Scroll selected into view
            const selectedRow = document.querySelector('.file-row.selected');
            if (selectedRow) {
                selectedRow.scrollIntoView({ block: 'nearest' });
            }
        }

        function selectRow(index) {
            vscode.postMessage({ command: 'select', index });
        }

        function openEntry(index) {
            vscode.postMessage({ command: 'open', index });
        }

        function goUp() {
            vscode.postMessage({ command: 'openParent' });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function toggleHidden() {
            vscode.postMessage({ command: 'toggleHidden' });
        }

        function promptFilter() {
            // Don't use prompt() - it's blocked in webviews
            vscode.postMessage({ command: 'promptFilter' });
        }

        function createDir() {
            // Don't use prompt() - it's blocked in webviews
            // Send message without name, extension will show VS Code's input box
            vscode.postMessage({ command: 'createDir' });
        }

        function showContextMenu(e, index) {
            // Simple context menu using prompt for now
            // A real implementation would use a custom menu
            const entry = state.entries[index];
            const actions = [
                '1. Open',
                '2. Open in Finder/Explorer',
                '3. Copy path',
                '4. Mark',
                '5. Flag for delete',
                '6. Delete'
            ];
            // For simplicity, we'll just log - a proper implementation would create a menu
        }

        function showMessage(text, type) {
            const container = document.getElementById('message-container');
            const msg = document.createElement('div');
            msg.className = 'message ' + type;
            msg.textContent = text;
            container.appendChild(msg);
            setTimeout(() => msg.remove(), 3000);
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

        function formatDate(date) {
            const now = new Date();
            const isThisYear = date.getFullYear() === now.getFullYear();
            const month = date.toLocaleString('en-US', { month: 'short' });
            const day = date.getDate().toString().padStart(2, ' ');
            if (isThisYear) {
                const hours = date.getHours().toString().padStart(2, '0');
                const minutes = date.getMinutes().toString().padStart(2, '0');
                return month + ' ' + day + ' ' + hours + ':' + minutes;
            } else {
                return month + ' ' + day + '  ' + date.getFullYear();
            }
        }

        function formatPermissions(mode, isDirectory, isSymlink) {
            const typeChar = isSymlink ? 'l' : isDirectory ? 'd' : '-';
            const perms = [
                (mode & 0o400) ? 'r' : '-',
                (mode & 0o200) ? 'w' : '-',
                (mode & 0o100) ? 'x' : '-',
                (mode & 0o040) ? 'r' : '-',
                (mode & 0o020) ? 'w' : '-',
                (mode & 0o010) ? 'x' : '-',
                (mode & 0o004) ? 'r' : '-',
                (mode & 0o002) ? 'w' : '-',
                (mode & 0o001) ? 'x' : '-'
            ].join('');
            return typeChar + perms;
        }

        function updateWdiredStatus() {
            const inputs = document.querySelectorAll('.file-name-input');
            let hasChanges = false;
            inputs.forEach(input => {
                if (input.value !== input.dataset.original) {
                    hasChanges = true;
                }
            });
            // Could send message to extension about changes
        }

        function getWdiredRenames() {
            const renames = [];
            const inputs = document.querySelectorAll('.file-name-input');
            inputs.forEach(input => {
                if (input.value !== input.dataset.original) {
                    renames.push({
                        original: input.dataset.original,
                        newName: input.value
                    });
                }
            });
            return renames;
        }

        // Keyboard handling
        document.addEventListener('keydown', (e) => {
            // In wdired mode, most keys should work normally for editing
            if (state?.wdiredMode) {
                if (e.ctrlKey && e.key === 'c') {
                    // Wait for second key
                    const handler = (e2) => {
                        if (e2.ctrlKey && e2.key === 'c') {
                            e2.preventDefault();
                            // Commit
                            const renames = getWdiredRenames();
                            vscode.postMessage({ command: 'wdiredCommit', renames });
                        } else if (e2.ctrlKey && e2.key === 'k') {
                            e2.preventDefault();
                            vscode.postMessage({ command: 'wdiredCancel' });
                        }
                        document.removeEventListener('keydown', handler);
                    };
                    document.addEventListener('keydown', handler, { once: true });
                    return;
                }
                return;
            }

            // Normal mode keyboard shortcuts
            switch (e.key) {
                case 'n':
                case 'ArrowDown':
                case 'j':
                    e.preventDefault();
                    vscode.postMessage({ command: 'navigate', direction: 'down' });
                    break;
                case 'p':
                case 'ArrowUp':
                case 'k':
                    e.preventDefault();
                    vscode.postMessage({ command: 'navigate', direction: 'up' });
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (state?.selectedIndex >= 0) {
                        vscode.postMessage({ command: 'open', index: state.selectedIndex });
                    }
                    break;
                case '^':
                    e.preventDefault();
                    vscode.postMessage({ command: 'openParent' });
                    break;
                case 'g':
                    e.preventDefault();
                    vscode.postMessage({ command: 'refresh' });
                    break;
                case 'm':
                    e.preventDefault();
                    if (state?.selectedIndex >= 0) {
                        vscode.postMessage({ command: 'mark', index: state.selectedIndex });
                    }
                    break;
                case 'u':
                    e.preventDefault();
                    if (state?.selectedIndex >= 0) {
                        vscode.postMessage({ command: 'unmark', index: state.selectedIndex });
                    }
                    break;
                case 'U':
                    e.preventDefault();
                    vscode.postMessage({ command: 'unmarkAll' });
                    break;
                case 't':
                    e.preventDefault();
                    vscode.postMessage({ command: 'toggleAllMarks' });
                    break;
                case 'd':
                    e.preventDefault();
                    if (state?.selectedIndex >= 0) {
                        vscode.postMessage({ command: 'flag', index: state.selectedIndex });
                    }
                    break;
                case 'x':
                    // Execute flagged deletions (like Emacs dired)
                    e.preventDefault();
                    vscode.postMessage({ command: 'delete' });
                    break;
                case 'D':
                    e.preventDefault();
                    vscode.postMessage({ command: 'delete' });
                    break;
                case 'C':
                    e.preventDefault();
                    vscode.postMessage({ command: 'copy' });
                    break;
                case 'R':
                    e.preventDefault();
                    vscode.postMessage({ command: 'rename' });
                    break;
                case '+':
                    e.preventDefault();
                    createDir();
                    break;
                case 'f':
                    // Find file - create if it doesn't exist
                    e.preventDefault();
                    vscode.postMessage({ command: 'findFile' });
                    break;
                case 'q':
                    e.preventDefault();
                    vscode.postMessage({ command: 'quit' });
                    break;
                case '.':
                    e.preventDefault();
                    vscode.postMessage({ command: 'toggleHidden' });
                    break;
                case '/':
                    e.preventDefault();
                    promptFilter();
                    break;
                case '%':
                    // Wait for 'm' for mark regex
                    const handler = (e2) => {
                        if (e2.key === 'm') {
                            e2.preventDefault();
                            // Don't use prompt() - it's blocked in webviews
                            // Send message to extension which will show VS Code's input box
                            vscode.postMessage({ command: 'promptMarkRegex' });
                        }
                        document.removeEventListener('keydown', handler);
                    };
                    document.addEventListener('keydown', handler, { once: true });
                    break;
                case 's':
                    // Sort by name
                    e.preventDefault();
                    vscode.postMessage({ command: 'sort', field: 'name' });
                    break;
                case 'S':
                    // Sort by size
                    e.preventDefault();
                    vscode.postMessage({ command: 'sort', field: 'size' });
                    break;
                case 'PageDown':
                    e.preventDefault();
                    vscode.postMessage({ command: 'navigate', direction: 'pageDown' });
                    break;
                case 'PageUp':
                    e.preventDefault();
                    vscode.postMessage({ command: 'navigate', direction: 'pageUp' });
                    break;
                case 'Home':
                    e.preventDefault();
                    vscode.postMessage({ command: 'navigate', direction: 'home' });
                    break;
                case 'End':
                    e.preventDefault();
                    vscode.postMessage({ command: 'navigate', direction: 'end' });
                    break;
            }

            // M-o (Alt+O) for actions menu
            if (e.altKey && e.key === 'o') {
                e.preventDefault();
                vscode.postMessage({ command: 'showActions' });
                return;
            }

            // C-x C-q for wdired mode
            if (e.ctrlKey && e.key === 'x') {
                const handler = (e2) => {
                    if (e2.ctrlKey && e2.key === 'q') {
                        e2.preventDefault();
                        vscode.postMessage({ command: 'wdiredEnter' });
                    }
                    document.removeEventListener('keydown', handler);
                };
                document.addEventListener('keydown', handler, { once: true });
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
        DiredPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
