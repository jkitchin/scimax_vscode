/**
 * LaTeX Live Preview Provider
 * Provides incremental PDF building with SyncTeX support for bidirectional sync
 * between org-mode files and PDF output.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { exportToLatex } from '../parser/orgExport';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Represents a mapping between org file positions and LaTeX positions
 */
export interface LineMapping {
    /** Original org file line (1-indexed) */
    orgLine: number;
    /** Corresponding LaTeX file line (1-indexed) */
    texLine: number;
    /** Column in org file */
    orgColumn?: number;
    /** Column in LaTeX file */
    texColumn?: number;
}

/**
 * SyncTeX record from .synctex.gz file
 */
export interface SyncTeXRecord {
    type: 'h' | 'v' | 'x' | 'k' | 'g' | '$' | '(' | ')' | '[' | ']';
    page: number;
    x: number;
    y: number;
    width?: number;
    height?: number;
    depth?: number;
    line: number;
    column: number;
    input: number;
}

/**
 * Parsed SyncTeX data for a document
 */
export interface SyncTeXData {
    inputs: Map<number, string>;
    records: SyncTeXRecord[];
    version: number;
}

/**
 * Build status for a document
 */
export interface BuildStatus {
    building: boolean;
    lastBuildTime?: Date;
    lastBuildSuccess?: boolean;
    pdfPath?: string;
    synctexPath?: string;
    error?: string;
    lineMappings: LineMapping[];
}

/**
 * Preview panel state
 */
interface PreviewState {
    panel: vscode.WebviewPanel;
    document: vscode.TextDocument;
    buildStatus: BuildStatus;
    tempDir: string;
    buildProcess?: ChildProcess;
    debounceTimer?: NodeJS.Timeout;
    synctexData?: SyncTeXData;
}

// ============================================================================
// Live Preview Manager
// ============================================================================

/**
 * Manages live LaTeX preview with SyncTeX support
 */
export class LatexLivePreviewManager {
    private previews: Map<string, PreviewState> = new Map();
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('LaTeX Live Preview');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'scimax.latex.showOutput';

        // Watch for document saves
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
                this.onDocumentSaved(doc);
            })
        );

        // Watch for document changes (for idle-based builds)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
                this.onDocumentChanged(event);
            })
        );

        // Watch for document close
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc: vscode.TextDocument) => {
                this.closePreview(doc.uri.toString());
            })
        );
    }

    /**
     * Open or focus the live preview for a document
     */
    async openPreview(document: vscode.TextDocument): Promise<void> {
        const key = document.uri.toString();

        // Check if preview already exists
        if (this.previews.has(key)) {
            const state = this.previews.get(key)!;
            state.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        // Check LaTeX availability
        const latexCheck = await this.checkLatexTools();
        if (!latexCheck.available) {
            vscode.window.showErrorMessage(latexCheck.message);
            return;
        }

        // Create temp directory for this preview
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-preview-'));

        // Create webview panel
        const panel = vscode.window.createWebviewPanel(
            'latexPreview',
            `PDF: ${path.basename(document.fileName)}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(tempDir),
                    vscode.Uri.file(path.dirname(document.uri.fsPath)),
                ],
            }
        );

        const state: PreviewState = {
            panel,
            document,
            tempDir,
            buildStatus: {
                building: false,
                lineMappings: [],
            },
        };

        // Handle panel close
        panel.onDidDispose(() => {
            this.closePreview(key);
        });

        // Handle messages from webview
        panel.webview.onDidReceiveMessage((message: { command: string; page?: number; x?: number; y?: number }) => {
            this.handleWebviewMessage(key, message);
        });

        this.previews.set(key, state);

        // Initial build
        await this.buildDocument(key);
    }

    /**
     * Close a preview
     */
    closePreview(key: string): void {
        const state = this.previews.get(key);
        if (!state) return;

        // Cancel any pending build
        if (state.buildProcess) {
            state.buildProcess.kill();
        }
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
        }

        // Clean up temp directory
        try {
            fs.rmSync(state.tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }

        // Dispose panel if not already disposed
        try {
            state.panel.dispose();
        } catch {
            // Already disposed
        }

        this.previews.delete(key);
    }

    /**
     * Handle document save
     */
    private onDocumentSaved(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'org') return;

        const key = doc.uri.toString();
        if (!this.previews.has(key)) return;

        const config = vscode.workspace.getConfiguration('scimax.latexLivePreview');
        const buildOnSave = config.get<boolean>('buildOnSave', true);

        if (buildOnSave) {
            this.buildDocument(key);
        }
    }

    /**
     * Handle document change (for idle builds)
     */
    private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
        if (event.document.languageId !== 'org') return;

        const key = event.document.uri.toString();
        const state = this.previews.get(key);
        if (!state) return;

        const config = vscode.workspace.getConfiguration('scimax.latexLivePreview');
        const buildOnIdle = config.get<boolean>('buildOnIdle', false);
        const idleDelay = config.get<number>('idleDelay', 2000);

        if (!buildOnIdle) return;

        // Debounce the build
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
        }

        state.debounceTimer = setTimeout(() => {
            this.buildDocument(key);
        }, idleDelay);
    }

    /**
     * Build the document
     */
    async buildDocument(key: string): Promise<void> {
        const state = this.previews.get(key);
        if (!state) return;

        // Cancel any existing build
        if (state.buildProcess) {
            state.buildProcess.kill();
        }

        state.buildStatus.building = true;
        this.updateStatusBar(state);
        this.updateWebview(state, 'building');

        try {
            // Export org to LaTeX with line mapping
            const { latex, lineMappings } = await this.exportWithMappings(state.document);
            state.buildStatus.lineMappings = lineMappings;

            // Write LaTeX file
            const texPath = path.join(state.tempDir, 'document.tex');
            fs.writeFileSync(texPath, latex);

            // Copy any referenced files (images, etc.)
            await this.copyReferencedFiles(state.document, state.tempDir);

            // Run LaTeX compilation
            const result = await this.runLatex(texPath, state);

            if (result.success) {
                state.buildStatus.lastBuildSuccess = true;
                state.buildStatus.pdfPath = path.join(state.tempDir, 'document.pdf');
                state.buildStatus.synctexPath = path.join(state.tempDir, 'document.synctex.gz');
                state.buildStatus.error = undefined;

                // Parse SyncTeX data
                if (fs.existsSync(state.buildStatus.synctexPath)) {
                    state.synctexData = await this.parseSyncTeX(state.buildStatus.synctexPath);
                }

                this.updateWebview(state, 'ready');
            } else {
                state.buildStatus.lastBuildSuccess = false;
                state.buildStatus.error = result.error;
                this.updateWebview(state, 'error', result.error);
            }
        } catch (err) {
            state.buildStatus.lastBuildSuccess = false;
            state.buildStatus.error = err instanceof Error ? err.message : String(err);
            this.updateWebview(state, 'error', state.buildStatus.error);
        } finally {
            state.buildStatus.building = false;
            state.buildStatus.lastBuildTime = new Date();
            this.updateStatusBar(state);
        }
    }

    /**
     * Export org to LaTeX with line mappings
     */
    private async exportWithMappings(document: vscode.TextDocument): Promise<{
        latex: string;
        lineMappings: LineMapping[];
    }> {
        const text = document.getText();
        const lineMappings: LineMapping[] = [];

        // Use the existing export function
        const latex = exportToLatex(text, {
            toc: false,
            standalone: true,
            syntexEnabled: true,  // Enable SyncTeX
        });

        // Generate line mappings by analyzing the export
        // This is a simplified mapping - real implementation would track during export
        const orgLines = text.split('\n');
        const texLines = latex.split('\n');

        let texLineNum = 1;
        let inPreamble = true;

        for (let orgLineNum = 1; orgLineNum <= orgLines.length; orgLineNum++) {
            const orgLine = orgLines[orgLineNum - 1];

            // Skip empty lines and comments in mapping
            if (orgLine.trim() === '' || orgLine.startsWith('#')) {
                continue;
            }

            // Find corresponding line in LaTeX
            // This is approximate - real SyncTeX will provide accurate data
            if (inPreamble) {
                // Look for \begin{document}
                while (texLineNum <= texLines.length) {
                    if (texLines[texLineNum - 1].includes('\\begin{document}')) {
                        inPreamble = false;
                        texLineNum++;
                        break;
                    }
                    texLineNum++;
                }
            }

            if (!inPreamble && texLineNum <= texLines.length) {
                lineMappings.push({
                    orgLine: orgLineNum,
                    texLine: texLineNum,
                });
                texLineNum++;
            }
        }

        return { latex, lineMappings };
    }

    /**
     * Copy referenced files to temp directory
     */
    private async copyReferencedFiles(document: vscode.TextDocument, tempDir: string): Promise<void> {
        const text = document.getText();
        const docDir = path.dirname(document.uri.fsPath);

        // Find image references
        const imagePattern = /\[\[(?:file:)?([^\]]+\.(png|jpe?g|gif|svg|pdf))\]\]/gi;
        let match;

        while ((match = imagePattern.exec(text)) !== null) {
            const imagePath = match[1];
            const srcPath = path.isAbsolute(imagePath)
                ? imagePath
                : path.resolve(docDir, imagePath);

            if (fs.existsSync(srcPath)) {
                const destPath = path.join(tempDir, path.basename(imagePath));
                try {
                    fs.copyFileSync(srcPath, destPath);
                } catch {
                    // Ignore copy errors
                }
            }
        }

        // Copy bibliography files if referenced
        const bibPattern = /^#\+BIBLIOGRAPHY:\s*(.+)$/gmi;
        while ((match = bibPattern.exec(text)) !== null) {
            const bibPath = match[1].trim();
            const srcPath = path.isAbsolute(bibPath)
                ? bibPath
                : path.resolve(docDir, bibPath);

            if (fs.existsSync(srcPath)) {
                const destPath = path.join(tempDir, path.basename(bibPath));
                try {
                    fs.copyFileSync(srcPath, destPath);
                } catch {
                    // Ignore copy errors
                }
            }
        }
    }

    /**
     * Run LaTeX compilation
     */
    private runLatex(
        texPath: string,
        state: PreviewState
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            const config = vscode.workspace.getConfiguration('scimax.latexLivePreview');
            const compiler = config.get<string>('compiler', 'pdflatex');
            const useLatexmk = config.get<boolean>('useLatexmk', true);

            const cwd = path.dirname(texPath);
            const texFile = path.basename(texPath);

            let cmd: string;
            let args: string[];

            // Get shell escape setting (shared with export.pdf)
            const pdfConfig = vscode.workspace.getConfiguration('scimax.export.pdf');
            const shellEscape = pdfConfig.get<string>('shellEscape', 'restricted');
            let shellFlag: string;
            if (shellEscape === 'restricted') {
                shellFlag = '-shell-restricted';
            } else if (shellEscape === 'full') {
                shellFlag = '-shell-escape';
            } else {
                shellFlag = ''; // disabled
            }

            if (useLatexmk) {
                cmd = 'latexmk';
                args = [
                    `-${compiler}`,
                    ...(shellFlag ? [shellFlag] : []),
                    '-interaction=nonstopmode',
                    '-synctex=1',
                    '-file-line-error',
                    texFile,
                ];
            } else {
                cmd = compiler;
                args = [
                    ...(shellFlag ? [shellFlag] : []),
                    '-interaction=nonstopmode',
                    '-synctex=1',
                    '-file-line-error',
                    texFile,
                ];
            }

            this.outputChannel.appendLine(`Running: ${cmd} ${args.join(' ')}`);
            this.outputChannel.appendLine(`Working directory: ${cwd}`);

            // Extend PATH to include common locations for pygmentize (required by minted)
            const extraPaths = [
                '/usr/local/bin',
                '/opt/homebrew/bin',
                `${process.env.HOME}/.local/bin`,
                `${process.env.HOME}/Dropbox/uv/.venv/bin`,
                `${process.env.HOME}/.pyenv/shims`,
            ].join(':');
            const env = {
                ...process.env,
                PATH: `${extraPaths}:${process.env.PATH || ''}`,
            };

            const proc = spawn(cmd, args, {
                cwd,
                timeout: 60000,
                env,
            });

            state.buildProcess = proc;

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                this.outputChannel.append(text);
            });

            proc.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                this.outputChannel.append(text);
            });

            proc.on('error', (err: Error) => {
                state.buildProcess = undefined;
                resolve({ success: false, error: err.message });
            });

            proc.on('close', async (code: number | null) => {
                state.buildProcess = undefined;

                // Check if PDF was actually created - latexmk can return non-zero
                // for warnings like "references changed" even when PDF is fine
                const pdfPath = path.join(cwd, texFile.replace(/\.tex$/, '.pdf'));
                const pdfCreated = fs.existsSync(pdfPath);

                if (code === 0 || pdfCreated) {
                    resolve({ success: true });
                } else {
                    // Extract error from log - get multiple lines of context
                    const combined = stdout + '\n' + stderr;

                    // Look for LaTeX errors (lines starting with !)
                    const errorLines: string[] = [];
                    const lines = combined.split('\n');
                    let inError = false;
                    for (const line of lines) {
                        if (line.startsWith('!')) {
                            inError = true;
                            errorLines.push(line);
                        } else if (inError) {
                            // Capture context lines after error (up to 5 lines or until empty line)
                            if (line.trim() === '' || errorLines.length > 10) {
                                inError = false;
                            } else {
                                errorLines.push(line);
                            }
                        }
                    }

                    let error: string;
                    if (errorLines.length > 0) {
                        error = errorLines.join('\n');
                    } else {
                        // Try to read the .log file for more details
                        const logPath = path.join(cwd, 'document.log');
                        let logContent = '';
                        try {
                            if (fs.existsSync(logPath)) {
                                logContent = fs.readFileSync(logPath, 'utf-8');
                                // Extract errors from log file
                                const logLines = logContent.split('\n');
                                for (const line of logLines) {
                                    if (line.startsWith('!') || line.includes('Error:') || line.includes('Fatal error')) {
                                        errorLines.push(line);
                                        // Get a few following lines for context
                                        const idx = logLines.indexOf(line);
                                        for (let i = 1; i <= 3 && idx + i < logLines.length; i++) {
                                            if (logLines[idx + i].trim()) {
                                                errorLines.push(logLines[idx + i]);
                                            }
                                        }
                                    }
                                }
                            }
                        } catch {
                            // Ignore log read errors
                        }

                        if (errorLines.length > 0) {
                            error = errorLines.slice(0, 20).join('\n');
                        } else {
                            // Show last 30 lines of output as fallback
                            const lastLines = lines.filter(l => l.trim()).slice(-30);
                            error = `LaTeX exited with code ${code}.\n\n--- Last output ---\n${lastLines.join('\n')}`;
                        }
                    }
                    resolve({ success: false, error });
                }
            });
        });
    }

    /**
     * Parse SyncTeX file
     */
    private async parseSyncTeX(synctexPath: string): Promise<SyncTeXData | undefined> {
        // Use synctex command-line tool if available
        // For now, return undefined - full SyncTeX parsing is complex
        // We'll use the synctex tool for lookups instead
        return undefined;
    }

    /**
     * Forward sync: Jump from org position to PDF position
     */
    async forwardSync(document: vscode.TextDocument, position: vscode.Position): Promise<void> {
        const key = document.uri.toString();
        const state = this.previews.get(key);

        if (!state || !state.buildStatus.pdfPath) {
            vscode.window.showWarningMessage('No PDF preview available. Open preview first.');
            return;
        }

        // Map org line to tex line
        const orgLine = position.line + 1;
        const mapping = state.buildStatus.lineMappings.find(m => m.orgLine === orgLine);
        const texLine = mapping?.texLine || orgLine;

        // Use synctex to find PDF position
        const texPath = path.join(state.tempDir, 'document.tex');
        const result = await this.runSyncTeX('view', texPath, texLine, position.character + 1);

        if (result.success && result.page !== undefined) {
            // Send message to webview to scroll to position
            state.panel.webview.postMessage({
                command: 'scrollTo',
                page: result.page,
                x: result.x,
                y: result.y,
            });
        }
    }

    /**
     * Inverse sync: Jump from PDF position to org position
     */
    async inverseSync(key: string, page: number, x: number, y: number): Promise<void> {
        const state = this.previews.get(key);
        if (!state) return;

        const pdfPath = state.buildStatus.pdfPath;
        if (!pdfPath) return;

        // Use synctex to find source position
        const result = await this.runSyncTeX('edit', pdfPath, page, 0, x, y);

        if (result.success && result.line !== undefined) {
            // Map tex line back to org line
            const mapping = state.buildStatus.lineMappings.find(m => m.texLine === result.line);
            const orgLine = mapping?.orgLine || result.line;

            // Jump to position in org file
            const editor = await vscode.window.showTextDocument(state.document);
            const position = new vscode.Position(orgLine - 1, result.column || 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    }

    /**
     * Run synctex command
     */
    private runSyncTeX(
        mode: 'view' | 'edit',
        filePath: string,
        lineOrPage: number,
        column: number,
        x?: number,
        y?: number
    ): Promise<{
        success: boolean;
        page?: number;
        x?: number;
        y?: number;
        line?: number;
        column?: number;
    }> {
        return new Promise((resolve) => {
            let args: string[];

            if (mode === 'view') {
                // Forward sync: source -> PDF
                args = [
                    'view',
                    '-i',
                    `${lineOrPage}:${column}:${filePath}`,
                    '-o',
                    filePath.replace('.tex', '.pdf'),
                ];
            } else {
                // Inverse sync: PDF -> source
                args = [
                    'edit',
                    '-o',
                    `${lineOrPage}:${x}:${y}:${filePath}`,
                ];
            }

            const proc = spawn('synctex', args, {
                timeout: 5000,
            });

            let stdout = '';

            proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.on('error', () => {
                resolve({ success: false });
            });

            proc.on('close', (code: number | null) => {
                if (code !== 0) {
                    resolve({ success: false });
                    return;
                }

                // Parse synctex output
                if (mode === 'view') {
                    const pageMatch = stdout.match(/Page:(\d+)/);
                    const xMatch = stdout.match(/x:([0-9.]+)/);
                    const yMatch = stdout.match(/y:([0-9.]+)/);

                    resolve({
                        success: true,
                        page: pageMatch ? parseInt(pageMatch[1]) : 1,
                        x: xMatch ? parseFloat(xMatch[1]) : 0,
                        y: yMatch ? parseFloat(yMatch[1]) : 0,
                    });
                } else {
                    const lineMatch = stdout.match(/Line:(\d+)/);
                    const colMatch = stdout.match(/Column:(\d+)/);

                    resolve({
                        success: true,
                        line: lineMatch ? parseInt(lineMatch[1]) : 1,
                        column: colMatch ? parseInt(colMatch[1]) : 0,
                    });
                }
            });
        });
    }

    /**
     * Handle messages from webview
     */
    private handleWebviewMessage(key: string, message: { command: string; page?: number; x?: number; y?: number }): void {
        switch (message.command) {
            case 'inverseSync':
                if (message.page !== undefined && message.x !== undefined && message.y !== undefined) {
                    this.inverseSync(key, message.page, message.x, message.y);
                }
                break;
            case 'rebuild':
                this.buildDocument(key);
                break;
            case 'ready':
                // Webview is ready
                break;
        }
    }

    /**
     * Update the webview content
     */
    private updateWebview(state: PreviewState, status: 'building' | 'ready' | 'error', error?: string): void {
        const webview = state.panel.webview;

        if (status === 'building') {
            webview.html = this.getBuildingHtml();
        } else if (status === 'error') {
            webview.html = this.getErrorHtml(error || 'Unknown error');
        } else if (status === 'ready' && state.buildStatus.pdfPath) {
            const pdfUri = webview.asWebviewUri(vscode.Uri.file(state.buildStatus.pdfPath));
            webview.html = this.getPdfViewerHtml(pdfUri.toString());
        }
    }

    /**
     * Update status bar
     */
    private updateStatusBar(state: PreviewState): void {
        if (state.buildStatus.building) {
            this.statusBarItem.text = '$(sync~spin) Building PDF...';
            this.statusBarItem.tooltip = 'LaTeX compilation in progress';
        } else if (state.buildStatus.lastBuildSuccess) {
            this.statusBarItem.text = '$(check) PDF Ready';
            this.statusBarItem.tooltip = `Last build: ${state.buildStatus.lastBuildTime?.toLocaleTimeString()}`;
        } else {
            this.statusBarItem.text = '$(error) Build Failed';
            this.statusBarItem.tooltip = state.buildStatus.error || 'Build failed';
        }
        this.statusBarItem.show();
    }

    /**
     * Check LaTeX tools availability
     */
    private checkLatexTools(): Promise<{ available: boolean; message: string }> {
        return new Promise((resolve) => {
            const proc = spawn('pdflatex', ['--version'], {
                timeout: 5000,
            });

            proc.on('error', () => {
                resolve({
                    available: false,
                    message: 'pdflatex not found. Please install TeX Live, MiKTeX, or MacTeX.',
                });
            });

            proc.on('close', (code: number | null) => {
                resolve({
                    available: code === 0,
                    message: code === 0
                        ? 'LaTeX tools available'
                        : 'pdflatex not available',
                });
            });
        });
    }

    /**
     * Get HTML for building state
     */
    private getBuildingHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid var(--vscode-editor-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .message {
            margin-top: 20px;
            font-size: 14px;
        }
        .container {
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <div class="message">Building PDF...</div>
    </div>
</body>
</html>`;
    }

    /**
     * Get HTML for error state
     */
    private getErrorHtml(error: string): string {
        const escapedError = error.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 20px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
        }
        .error-container {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 15px;
            border-radius: 4px;
        }
        h2 {
            color: var(--vscode-errorForeground);
            margin-top: 0;
        }
        pre {
            white-space: pre-wrap;
            word-wrap: break-word;
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            margin-top: 10px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="error-container">
        <h2>Build Failed</h2>
        <pre>${escapedError}</pre>
        <button onclick="rebuild()">Rebuild</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        function rebuild() {
            vscode.postMessage({ command: 'rebuild' });
        }
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for PDF viewer
     */
    private getPdfViewerHtml(pdfUri: string): string {
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            background: #525659;
            height: 100vh;
            overflow: hidden;
        }
        .toolbar {
            background: var(--vscode-editor-background);
            padding: 8px;
            display: flex;
            gap: 10px;
            align-items: center;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .toolbar button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 12px;
        }
        .toolbar button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .toolbar .page-info {
            color: var(--vscode-editor-foreground);
            font-size: 12px;
            font-family: var(--vscode-font-family);
        }
        .toolbar input {
            width: 50px;
            padding: 2px 4px;
            text-align: center;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
        }
        #pdf-container {
            height: calc(100vh - 40px);
            overflow: auto;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
        }
        canvas {
            margin-bottom: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            cursor: crosshair;
        }
        .sync-indicator {
            position: fixed;
            width: 20px;
            height: 20px;
            background: rgba(255, 255, 0, 0.5);
            border: 2px solid #ff0;
            border-radius: 50%;
            pointer-events: none;
            transform: translate(-50%, -50%);
            animation: pulse 1s ease-out;
            display: none;
        }
        @keyframes pulse {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
    <div class="toolbar">
        <button onclick="prevPage()">◀ Prev</button>
        <span class="page-info">
            Page <input type="number" id="pageNum" value="1" min="1" onchange="goToPage(this.value)">
            of <span id="pageCount">-</span>
        </span>
        <button onclick="nextPage()">Next ▶</button>
        <span style="flex-grow: 1"></span>
        <button onclick="zoomOut()">−</button>
        <span class="page-info"><span id="zoomLevel">100</span>%</span>
        <button onclick="zoomIn()">+</button>
        <button onclick="fitWidth()">Fit Width</button>
        <button onclick="rebuild()">⟳ Rebuild</button>
    </div>
    <div id="pdf-container"></div>
    <div class="sync-indicator" id="syncIndicator"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let pdfDoc = null;
        let currentPage = 1;
        let scale = 1.5;
        let pageCanvases = [];

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        async function loadPdf() {
            try {
                pdfDoc = await pdfjsLib.getDocument('${pdfUri}').promise;
                document.getElementById('pageCount').textContent = pdfDoc.numPages;
                await renderAllPages();
            } catch (err) {
                console.error('Error loading PDF:', err);
            }
        }

        async function renderAllPages() {
            const container = document.getElementById('pdf-container');
            container.innerHTML = '';
            pageCanvases = [];

            for (let i = 1; i <= pdfDoc.numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                canvas.dataset.page = i;
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.addEventListener('click', handleCanvasClick);
                canvas.addEventListener('dblclick', handleCanvasDoubleClick);

                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;

                container.appendChild(canvas);
                pageCanvases.push({ canvas, viewport });
            }
        }

        function handleCanvasClick(e) {
            const canvas = e.target;
            const page = parseInt(canvas.dataset.page);
            currentPage = page;
            document.getElementById('pageNum').value = page;
        }

        function handleCanvasDoubleClick(e) {
            const canvas = e.target;
            const page = parseInt(canvas.dataset.page);
            const rect = canvas.getBoundingClientRect();

            // Convert click position to PDF coordinates
            const canvasInfo = pageCanvases[page - 1];
            const x = (e.clientX - rect.left) * (canvasInfo.viewport.width / rect.width);
            const y = (canvasInfo.viewport.height - (e.clientY - rect.top) * (canvasInfo.viewport.height / rect.height));

            // Request inverse sync
            vscode.postMessage({
                command: 'inverseSync',
                page: page,
                x: x,
                y: y
            });
        }

        function prevPage() {
            if (currentPage > 1) {
                currentPage--;
                document.getElementById('pageNum').value = currentPage;
                scrollToPage(currentPage);
            }
        }

        function nextPage() {
            if (currentPage < pdfDoc.numPages) {
                currentPage++;
                document.getElementById('pageNum').value = currentPage;
                scrollToPage(currentPage);
            }
        }

        function goToPage(num) {
            const page = parseInt(num);
            if (page >= 1 && page <= pdfDoc.numPages) {
                currentPage = page;
                scrollToPage(page);
            }
        }

        function scrollToPage(page) {
            const canvas = pageCanvases[page - 1]?.canvas;
            if (canvas) {
                canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        function zoomIn() {
            scale *= 1.25;
            updateZoom();
        }

        function zoomOut() {
            scale /= 1.25;
            if (scale < 0.25) scale = 0.25;
            updateZoom();
        }

        function fitWidth() {
            const container = document.getElementById('pdf-container');
            if (pdfDoc && pageCanvases.length > 0) {
                const viewport = pageCanvases[0].viewport;
                const containerWidth = container.clientWidth - 40;
                scale = (containerWidth / viewport.width) * scale;
                updateZoom();
            }
        }

        function updateZoom() {
            document.getElementById('zoomLevel').textContent = Math.round(scale * 100 / 1.5);
            renderAllPages();
        }

        function rebuild() {
            vscode.postMessage({ command: 'rebuild' });
        }

        function showSyncIndicator(x, y) {
            const indicator = document.getElementById('syncIndicator');
            indicator.style.left = x + 'px';
            indicator.style.top = y + 'px';
            indicator.style.display = 'block';
            setTimeout(() => {
                indicator.style.display = 'none';
            }, 1000);
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'scrollTo':
                    if (message.page) {
                        goToPage(message.page);
                        // Show sync indicator
                        const canvas = pageCanvases[message.page - 1]?.canvas;
                        if (canvas) {
                            const rect = canvas.getBoundingClientRect();
                            const viewport = pageCanvases[message.page - 1].viewport;
                            const screenX = rect.left + (message.x / viewport.width) * rect.width;
                            const screenY = rect.top + (1 - message.y / viewport.height) * rect.height;
                            showSyncIndicator(screenX, screenY);
                        }
                    }
                    break;
            }
        });

        // Load PDF when ready
        loadPdf();
        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
    }

    /**
     * Show output channel
     */
    showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        // Close all previews
        for (const key of this.previews.keys()) {
            this.closePreview(key);
        }

        // Dispose other resources
        this.outputChannel.dispose();
        this.statusBarItem.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

// ============================================================================
// Singleton instance and exports
// ============================================================================

let previewManager: LatexLivePreviewManager | undefined;

/**
 * Initialize the live preview manager
 */
export function initLatexLivePreview(context: vscode.ExtensionContext): LatexLivePreviewManager {
    previewManager = new LatexLivePreviewManager(context);
    context.subscriptions.push({
        dispose: () => previewManager?.dispose(),
    });
    return previewManager;
}

/**
 * Get the preview manager instance
 */
export function getPreviewManager(): LatexLivePreviewManager | undefined {
    return previewManager;
}

/**
 * Register live preview commands
 */
export function registerLatexLivePreviewCommands(context: vscode.ExtensionContext): void {
    const manager = initLatexLivePreview(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.openPreview', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'org') {
                vscode.window.showWarningMessage('Open an org-mode file to use LaTeX preview');
                return;
            }
            await manager.openPreview(editor.document);
        }),

        vscode.commands.registerCommand('scimax.latex.forwardSync', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'org') {
                return;
            }
            await manager.forwardSync(editor.document, editor.selection.active);
        }),

        vscode.commands.registerCommand('scimax.latex.rebuild', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'org') {
                return;
            }
            const key = editor.document.uri.toString();
            await manager.buildDocument(key);
        }),

        vscode.commands.registerCommand('scimax.latex.showOutput', () => {
            manager.showOutput();
        })
    );
}
