/**
 * Diagnostic Panel
 * Webview panel to display the diagnostic report with markdown rendering
 */

import * as vscode from 'vscode';
import { DiagnosticInfo, formatReportAsMarkdown } from './diagnosticReport';

export class DiagnosticPanel {
    public static currentPanel: DiagnosticPanel | undefined;
    private static readonly viewType = 'scimaxDiagnostic';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private markdownContent: string = '';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'copy':
                        await vscode.env.clipboard.writeText(this.markdownContent);
                        vscode.window.showInformationMessage('Diagnostic report copied to clipboard');
                        break;
                    case 'refresh':
                        // Request refresh from the command
                        await vscode.commands.executeCommand('scimax.refreshDebugInfo');
                        break;
                }
            },
            null,
            this.disposables
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri): DiagnosticPanel {
        const column = vscode.ViewColumn.One;

        // If we already have a panel, show it
        if (DiagnosticPanel.currentPanel) {
            DiagnosticPanel.currentPanel.panel.reveal(column);
            return DiagnosticPanel.currentPanel;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            DiagnosticPanel.viewType,
            'Scimax Diagnostics',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        DiagnosticPanel.currentPanel = new DiagnosticPanel(panel, extensionUri);
        return DiagnosticPanel.currentPanel;
    }

    /**
     * Update the panel with diagnostic info
     */
    public update(info: DiagnosticInfo): void {
        this.markdownContent = formatReportAsMarkdown(info);
        this.panel.webview.html = this.getHtmlContent(this.markdownContent);
    }

    /**
     * Show a loading state
     */
    public showLoading(): void {
        this.panel.webview.html = this.getLoadingHtml();
    }

    /**
     * Generate HTML content for the webview
     */
    private getHtmlContent(markdown: string): string {
        const htmlContent = this.markdownToHtml(markdown);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>Scimax Diagnostics</title>
    <style>
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            line-height: 1.6;
            color: var(--vscode-foreground, #333);
            background-color: var(--vscode-editor-background, #fff);
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }

        h1 {
            color: var(--vscode-textLink-foreground, #0066cc);
            border-bottom: 2px solid var(--vscode-textLink-foreground, #0066cc);
            padding-bottom: 10px;
        }

        h2 {
            color: var(--vscode-foreground, #333);
            border-bottom: 1px solid var(--vscode-panel-border, #ccc);
            padding-bottom: 5px;
            margin-top: 30px;
        }

        h3 {
            color: var(--vscode-foreground, #333);
            margin-top: 20px;
        }

        table {
            border-collapse: collapse;
            width: 100%;
            margin: 10px 0 20px 0;
        }

        th, td {
            border: 1px solid var(--vscode-panel-border, #ccc);
            padding: 8px 12px;
            text-align: left;
        }

        th {
            background-color: var(--vscode-editor-lineHighlightBackground, #f5f5f5);
            font-weight: 600;
        }

        tr:hover {
            background-color: var(--vscode-list-hoverBackground, #f0f0f0);
        }

        code {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
            font-size: 0.9em;
            background-color: var(--vscode-textCodeBlock-background, #f4f4f4);
            padding: 2px 6px;
            border-radius: 3px;
        }

        pre {
            background-color: var(--vscode-textCodeBlock-background, #f4f4f4);
            padding: 12px;
            border-radius: 5px;
            overflow-x: auto;
        }

        pre code {
            background: none;
            padding: 0;
        }

        ul {
            padding-left: 20px;
        }

        li {
            margin: 5px 0;
        }

        .toolbar {
            position: sticky;
            top: 0;
            background-color: var(--vscode-editor-background, #fff);
            padding: 10px 0;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border, #ccc);
            z-index: 100;
            display: flex;
            gap: 10px;
        }

        button {
            background-color: var(--vscode-button-background, #0066cc);
            color: var(--vscode-button-foreground, #fff);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground, #0055aa);
        }

        button.secondary {
            background-color: var(--vscode-button-secondaryBackground, #5f5f5f);
            color: var(--vscode-button-secondaryForeground, #fff);
        }

        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground, #4f4f4f);
        }

        .success {
            color: var(--vscode-testing-iconPassed, #4caf50);
        }

        .warning {
            color: var(--vscode-editorWarning-foreground, #ff9800);
        }

        .error {
            color: var(--vscode-editorError-foreground, #f44336);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="copyReport()">
            <span>Copy Report</span>
        </button>
        <button class="secondary" onclick="refreshReport()">
            <span>Refresh</span>
        </button>
    </div>

    <div id="content">
        ${htmlContent}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function copyReport() {
            vscode.postMessage({ command: 'copy' });
        }

        function refreshReport() {
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
    }

    /**
     * Generate loading HTML
     */
    private getLoadingHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Scimax Diagnostics</title>
    <style>
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            color: var(--vscode-foreground, #333);
            background-color: var(--vscode-editor-background, #fff);
        }

        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid var(--vscode-panel-border, #ccc);
            border-top-color: var(--vscode-textLink-foreground, #0066cc);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        p {
            margin-top: 20px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="spinner"></div>
    <p>Gathering diagnostic information...</p>
</body>
</html>`;
    }

    /**
     * Convert markdown to HTML (simple implementation)
     */
    private markdownToHtml(markdown: string): string {
        let html = markdown;

        // Escape HTML entities first (but preserve our markdown syntax)
        html = html
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks (```...```)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
        });

        // Inline code (`...`)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Headers
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Tables
        html = this.convertTables(html);

        // Lists
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

        // Paragraphs (lines that aren't already wrapped)
        html = html.replace(/^(?!<[huplo]|$)(.+)$/gm, '<p>$1</p>');

        // Clean up extra newlines
        html = html.replace(/\n{3,}/g, '\n\n');

        return html;
    }

    /**
     * Convert markdown tables to HTML
     */
    private convertTables(html: string): string {
        const lines = html.split('\n');
        const result: string[] = [];
        let inTable = false;
        let tableRows: string[] = [];

        for (const line of lines) {
            if (line.startsWith('|') && line.endsWith('|')) {
                if (!inTable) {
                    inTable = true;
                    tableRows = [];
                }
                tableRows.push(line);
            } else {
                if (inTable) {
                    result.push(this.buildHtmlTable(tableRows));
                    inTable = false;
                    tableRows = [];
                }
                result.push(line);
            }
        }

        if (inTable) {
            result.push(this.buildHtmlTable(tableRows));
        }

        return result.join('\n');
    }

    /**
     * Build HTML table from markdown table rows
     */
    private buildHtmlTable(rows: string[]): string {
        if (rows.length < 2) return rows.join('\n');

        const headerRow = rows[0];
        // Skip the separator row (|---|---|)
        const dataRows = rows.slice(2);

        const parseRow = (row: string): string[] => {
            return row
                .slice(1, -1) // Remove leading/trailing |
                .split('|')
                .map((cell) => cell.trim());
        };

        const headers = parseRow(headerRow);
        const headerHtml = headers.map((h) => `<th>${h}</th>`).join('');

        const bodyHtml = dataRows
            .map((row) => {
                const cells = parseRow(row);
                return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
            })
            .join('\n');

        return `<table>
<thead><tr>${headerHtml}</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>`;
    }

    /**
     * Dispose the panel
     */
    public dispose(): void {
        DiagnosticPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
