/**
 * PDF Viewer Panel
 * Webview-based PDF viewer with SyncTeX support for Overleaf-like experience
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PdfViewerPanel {
    public static currentPanel: PdfViewerPanel | undefined;
    private static readonly viewType = 'scimaxPdfViewer';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private pdfPath: string | undefined;
    private sourceFile: string | undefined;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, pdfPath: string, sourceFile: string): PdfViewerPanel {
        const column = vscode.ViewColumn.Beside;

        // If we already have a panel, show it
        if (PdfViewerPanel.currentPanel) {
            PdfViewerPanel.currentPanel.panel.reveal(column);
            PdfViewerPanel.currentPanel.loadPdf(pdfPath, sourceFile);
            return PdfViewerPanel.currentPanel;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            PdfViewerPanel.viewType,
            'PDF Preview',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.dirname(pdfPath)),
                    extensionUri
                ]
            }
        );

        PdfViewerPanel.currentPanel = new PdfViewerPanel(panel, extensionUri);
        PdfViewerPanel.currentPanel.loadPdf(pdfPath, sourceFile);
        return PdfViewerPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set the webview's initial html content
        this.panel.webview.html = this.getLoadingHtml();

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public loadPdf(pdfPath: string, sourceFile: string): void {
        this.pdfPath = pdfPath;
        this.sourceFile = sourceFile;

        // Update panel title
        this.panel.title = path.basename(pdfPath);

        // Set up file watcher for auto-refresh
        this.setupFileWatcher(pdfPath);

        // Load the PDF
        this.updateContent();
    }

    public scrollToLine(line: number): void {
        // Send message to webview to scroll to the line via SyncTeX
        this.panel.webview.postMessage({
            type: 'scrollToLine',
            line: line
        });
    }

    public refresh(): void {
        this.updateContent();
    }

    private setupFileWatcher(pdfPath: string): void {
        // Dispose existing watcher
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }

        // Watch for PDF changes
        const pattern = new vscode.RelativePattern(
            path.dirname(pdfPath),
            path.basename(pdfPath)
        );
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.fileWatcher.onDidChange(() => {
            // Small delay to ensure file is fully written
            setTimeout(() => this.updateContent(), 100);
        });

        this.disposables.push(this.fileWatcher);
    }

    private updateContent(): void {
        if (!this.pdfPath || !fs.existsSync(this.pdfPath)) {
            this.panel.webview.html = this.getErrorHtml('PDF file not found. Compile your document first.');
            return;
        }

        // Read PDF and convert to base64 for embedding
        const pdfData = fs.readFileSync(this.pdfPath);
        const pdfBase64 = pdfData.toString('base64');

        this.panel.webview.html = this.getHtmlContent(pdfBase64);
    }

    private handleMessage(message: { type: string; line?: number; file?: string }): void {
        switch (message.type) {
            case 'syncTexClick':
                // Handle click in PDF - jump to source
                if (message.line && this.sourceFile) {
                    this.jumpToSource(this.sourceFile, message.line);
                }
                break;
            case 'refresh':
                this.updateContent();
                break;
        }
    }

    private async jumpToSource(file: string, line: number): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            const position = new vscode.Position(Math.max(0, line - 1), 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        } catch (error) {
            console.error('Failed to jump to source:', error);
        }
    }

    private getLoadingHtml(): string {
        return `
            <!DOCTYPE html>
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
                </style>
            </head>
            <body>
                <p>Loading PDF...</p>
            </body>
            </html>
        `;
    }

    private getErrorHtml(message: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        text-align: center;
                        padding: 20px;
                    }
                    button {
                        margin-top: 10px;
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <p>${message}</p>
                    <button onclick="vscode.postMessage({type: 'refresh'})">Refresh</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                </script>
            </body>
            </html>
        `;
    }

    private getHtmlContent(pdfBase64: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    html, body {
                        height: 100%;
                        overflow: hidden;
                        background: var(--vscode-editor-background);
                    }
                    .toolbar {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        height: 36px;
                        background: var(--vscode-editorWidget-background);
                        border-bottom: 1px solid var(--vscode-editorWidget-border);
                        display: flex;
                        align-items: center;
                        padding: 0 10px;
                        gap: 8px;
                        z-index: 100;
                    }
                    .toolbar button {
                        padding: 4px 8px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        cursor: pointer;
                        font-size: 12px;
                    }
                    .toolbar button:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }
                    .toolbar span {
                        color: var(--vscode-foreground);
                        font-size: 12px;
                    }
                    .toolbar input {
                        width: 50px;
                        padding: 2px 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        text-align: center;
                    }
                    #pdf-container {
                        position: absolute;
                        top: 36px;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        overflow: auto;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        padding: 10px;
                        background: #525659;
                    }
                    #pdf-container canvas {
                        margin-bottom: 10px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    }
                    .page-info {
                        flex: 1;
                        text-align: center;
                    }
                </style>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
            </head>
            <body>
                <div class="toolbar">
                    <button id="zoom-out">−</button>
                    <span id="zoom-level">100%</span>
                    <button id="zoom-in">+</button>
                    <button id="zoom-fit">Fit</button>
                    <span class="page-info">
                        Page <input type="number" id="page-num" value="1" min="1"> of <span id="page-count">-</span>
                    </span>
                    <button id="prev-page">◀</button>
                    <button id="next-page">▶</button>
                    <button id="refresh">↻ Refresh</button>
                </div>
                <div id="pdf-container"></div>

                <script>
                    const vscode = acquireVsCodeApi();

                    // PDF.js configuration
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

                    let pdfDoc = null;
                    let currentScale = 1.0;
                    let renderedPages = new Map();
                    const container = document.getElementById('pdf-container');

                    // Load PDF from base64
                    const pdfData = atob('${pdfBase64}');
                    const pdfArray = new Uint8Array(pdfData.length);
                    for (let i = 0; i < pdfData.length; i++) {
                        pdfArray[i] = pdfData.charCodeAt(i);
                    }

                    pdfjsLib.getDocument({ data: pdfArray }).promise.then(pdf => {
                        pdfDoc = pdf;
                        document.getElementById('page-count').textContent = pdf.numPages;
                        document.getElementById('page-num').max = pdf.numPages;
                        renderAllPages();
                    }).catch(err => {
                        container.innerHTML = '<p style="color: red; padding: 20px;">Error loading PDF: ' + err.message + '</p>';
                    });

                    async function renderAllPages() {
                        container.innerHTML = '';
                        renderedPages.clear();

                        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                            const page = await pdfDoc.getPage(pageNum);
                            const viewport = page.getViewport({ scale: currentScale * 1.5 }); // 1.5 for better quality

                            const canvas = document.createElement('canvas');
                            canvas.id = 'page-' + pageNum;
                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            canvas.dataset.pageNum = pageNum;
                            container.appendChild(canvas);

                            const context = canvas.getContext('2d');
                            await page.render({
                                canvasContext: context,
                                viewport: viewport
                            }).promise;

                            renderedPages.set(pageNum, canvas);
                        }
                    }

                    // Zoom controls
                    document.getElementById('zoom-in').onclick = () => {
                        currentScale = Math.min(currentScale + 0.25, 3.0);
                        updateZoom();
                    };

                    document.getElementById('zoom-out').onclick = () => {
                        currentScale = Math.max(currentScale - 0.25, 0.5);
                        updateZoom();
                    };

                    document.getElementById('zoom-fit').onclick = () => {
                        currentScale = 1.0;
                        updateZoom();
                    };

                    function updateZoom() {
                        document.getElementById('zoom-level').textContent = Math.round(currentScale * 100) + '%';
                        renderAllPages();
                    }

                    // Page navigation
                    document.getElementById('prev-page').onclick = () => {
                        const input = document.getElementById('page-num');
                        const page = Math.max(1, parseInt(input.value) - 1);
                        input.value = page;
                        scrollToPage(page);
                    };

                    document.getElementById('next-page').onclick = () => {
                        const input = document.getElementById('page-num');
                        const page = Math.min(pdfDoc.numPages, parseInt(input.value) + 1);
                        input.value = page;
                        scrollToPage(page);
                    };

                    document.getElementById('page-num').onchange = (e) => {
                        const page = Math.max(1, Math.min(pdfDoc.numPages, parseInt(e.target.value)));
                        e.target.value = page;
                        scrollToPage(page);
                    };

                    function scrollToPage(pageNum) {
                        const canvas = document.getElementById('page-' + pageNum);
                        if (canvas) {
                            canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }

                    // Refresh button
                    document.getElementById('refresh').onclick = () => {
                        vscode.postMessage({ type: 'refresh' });
                    };

                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'scrollToLine') {
                            // For now, just scroll to top - full SyncTeX would need synctex parsing
                            container.scrollTop = 0;
                        }
                    });

                    // Update page number on scroll
                    container.addEventListener('scroll', () => {
                        const containerRect = container.getBoundingClientRect();
                        const containerCenter = containerRect.top + containerRect.height / 2;

                        for (const [pageNum, canvas] of renderedPages) {
                            const rect = canvas.getBoundingClientRect();
                            if (rect.top <= containerCenter && rect.bottom >= containerCenter) {
                                document.getElementById('page-num').value = pageNum;
                                break;
                            }
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    public dispose(): void {
        PdfViewerPanel.currentPanel = undefined;

        // Clean up resources
        this.panel.dispose();

        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

/**
 * Open PDF in the built-in viewer panel
 */
export async function openPdfInPanel(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') {
        vscode.window.showWarningMessage('No LaTeX document open');
        return;
    }

    const filePath = editor.document.uri.fsPath;
    const pdfPath = filePath.replace(/\.tex$/, '.pdf');

    if (!fs.existsSync(pdfPath)) {
        const compile = await vscode.window.showWarningMessage(
            'PDF not found. Compile the document first?',
            'Compile',
            'Cancel'
        );
        if (compile === 'Compile') {
            await vscode.commands.executeCommand('scimax.latex.compile');
            // Wait for compilation
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!fs.existsSync(pdfPath)) {
                return;
            }
        } else {
            return;
        }
    }

    PdfViewerPanel.createOrShow(context.extensionUri, pdfPath, filePath);
}

/**
 * Forward sync - scroll to current line in PDF viewer
 */
export function syncForwardToPanel(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !PdfViewerPanel.currentPanel) {
        return;
    }

    const line = editor.selection.active.line + 1;
    PdfViewerPanel.currentPanel.scrollToLine(line);
}
