/**
 * Link Graph Webview Provider
 *
 * Provides a VS Code webview panel for visualizing file link graphs.
 * Uses vis.js Network for interactive graph rendering with draggable nodes.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Client } from '@libsql/client';
import { LinkGraphQueryService, LinkGraphFilters, GraphData } from './linkGraphQueries';
import { databaseLogger as log } from '../utils/logger';

/**
 * Link Graph Provider
 * Manages the webview panel for graph visualization
 */
export class LinkGraphProvider {
    private panel: vscode.WebviewPanel | undefined;
    private queryService: LinkGraphQueryService;
    private currentFile: string = '';
    private currentDepth: number = 1;
    private currentDirection: 'both' | 'outgoing' | 'incoming' = 'both';
    private currentFilters: LinkGraphFilters = {};

    constructor(
        private context: vscode.ExtensionContext,
        private db: Client
    ) {
        this.queryService = new LinkGraphQueryService(db);
    }

    /**
     * Show the link graph for a file
     */
    async show(filePath: string): Promise<void> {
        this.currentFile = filePath;

        if (this.panel) {
            this.panel.reveal();
            this.panel.title = `Link Graph: ${path.basename(filePath)}`;
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'scimaxLinkGraph',
                `Link Graph: ${path.basename(filePath)}`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'media')
                    ]
                }
            );

            this.panel.webview.html = this.getWebviewContent();

            this.panel.webview.onDidReceiveMessage(
                (message: any) => this.handleMessage(message),
                undefined,
                this.context.subscriptions
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }

        await this.updateGraph();
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'openFile':
                try {
                    const doc = await vscode.workspace.openTextDocument(message.path);
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
                } catch (e) {
                    vscode.window.showErrorMessage(`Could not open file: ${message.path}`);
                }
                break;

            case 'recenterGraph':
                this.currentFile = message.path;
                if (this.panel) {
                    this.panel.title = `Link Graph: ${path.basename(message.path)}`;
                }
                await this.updateGraph();
                break;

            case 'updateDepth':
                this.currentDepth = message.depth;
                await this.updateGraph();
                break;

            case 'updateDirection':
                this.currentDirection = message.direction;
                await this.updateGraph();
                break;

            case 'updateFilters':
                this.currentFilters = this.parseFilters(message.filters);
                await this.updateGraph();
                break;

            case 'refresh':
                await this.updateGraph();
                break;

            case 'ready':
                // Webview is ready, send initial data
                await this.updateGraph();
                break;
        }
    }

    /**
     * Parse filters from webview message
     */
    private parseFilters(rawFilters: any): LinkGraphFilters {
        const filters: LinkGraphFilters = {};

        if (rawFilters.tags?.length) {
            filters.tags = rawFilters.tags;
        }
        if (rawFilters.excludeDone) {
            filters.excludeDone = true;
        }
        if (rawFilters.hasDeadline) {
            filters.hasDeadline = true;
        }
        if (rawFilters.fileTypes?.length) {
            filters.fileTypes = rawFilters.fileTypes;
        }
        if (rawFilters.modifiedAfter) {
            filters.modifiedAfter = rawFilters.modifiedAfter;
        }

        return filters;
    }

    /**
     * Update the graph with current settings
     */
    private async updateGraph(): Promise<void> {
        if (!this.panel) return;

        try {
            const graphData = await this.queryService.buildGraph(
                this.currentFile,
                this.currentDepth,
                this.currentDirection,
                this.currentFilters,
                100  // max nodes
            );

            this.panel.webview.postMessage({
                type: 'setGraphData',
                data: graphData,
                centerFile: this.currentFile
            });
        } catch (error) {
            log.error('Failed to build graph', error as Error);
            vscode.window.showErrorMessage(`Failed to build link graph: ${error}`);
        }
    }

    /**
     * Get the webview HTML content
     */
    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline'; img-src data:;">
    <title>Link Graph</title>
    <script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #cccccc);
            overflow: hidden;
        }

        .controls {
            position: absolute;
            top: 10px;
            left: 10px;
            z-index: 100;
            background: var(--vscode-sideBar-background, #252526);
            padding: 12px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-width: 280px;
            font-size: 12px;
        }

        .control-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .control-row label {
            min-width: 70px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #858585);
        }

        select, input[type="range"] {
            flex: 1;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            padding: 4px 6px;
            border-radius: 3px;
            font-size: 11px;
        }

        select:focus, input:focus {
            outline: 1px solid var(--vscode-focusBorder, #007fd4);
        }

        .filter-section {
            border-top: 1px solid var(--vscode-widget-border, #454545);
            padding-top: 8px;
            margin-top: 4px;
        }

        .filter-section summary {
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-foreground, #cccccc);
            user-select: none;
        }

        .filter-section summary:hover {
            color: var(--vscode-textLink-foreground, #3794ff);
        }

        .filter-group {
            margin-top: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
        }

        .checkbox-row input[type="checkbox"] {
            width: 14px;
            height: 14px;
        }

        .tag-input {
            display: flex;
            gap: 4px;
        }

        .tag-input input {
            flex: 1;
            font-size: 11px;
            padding: 4px 6px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 3px;
        }

        .tag-input button {
            padding: 4px 8px;
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #ffffff);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }

        .tag-input button:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }

        .tag-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 4px;
        }

        .tag-chip {
            background: var(--vscode-badge-background, #4d4d4d);
            color: var(--vscode-badge-foreground, #ffffff);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .tag-chip:hover {
            background: var(--vscode-badge-background, #5a5a5a);
        }

        .tag-chip .remove {
            font-weight: bold;
            opacity: 0.7;
        }

        .tag-chip:hover .remove {
            opacity: 1;
        }

        .stats {
            font-size: 10px;
            color: var(--vscode-descriptionForeground, #858585);
            padding-top: 8px;
            border-top: 1px solid var(--vscode-widget-border, #454545);
        }

        #graph {
            width: 100vw;
            height: 100vh;
        }

        .legend {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: var(--vscode-sideBar-background, #252526);
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 11px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .legend-title {
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--vscode-foreground, #cccccc);
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 4px 0;
            color: var(--vscode-descriptionForeground, #858585);
        }

        .legend-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .help-text {
            font-size: 10px;
            color: var(--vscode-descriptionForeground, #858585);
            margin-top: 8px;
            line-height: 1.4;
        }

        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 14px;
            color: var(--vscode-descriptionForeground, #858585);
        }

        .empty-state {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: var(--vscode-descriptionForeground, #858585);
        }

        .empty-state h3 {
            margin-bottom: 8px;
            color: var(--vscode-foreground, #cccccc);
        }
    </style>
</head>
<body>
    <div class="controls">
        <div class="control-row">
            <label>Depth:</label>
            <input type="range" id="depth" min="1" max="3" value="1">
            <span id="depthValue" style="min-width: 16px; text-align: center;">1</span>
        </div>

        <div class="control-row">
            <label>Direction:</label>
            <select id="direction">
                <option value="both">Both directions</option>
                <option value="outgoing">Outgoing only →</option>
                <option value="incoming">← Incoming only</option>
            </select>
        </div>

        <details class="filter-section">
            <summary>Filters</summary>
            <div class="filter-group">
                <div class="control-row">
                    <label>Modified:</label>
                    <select id="modifiedFilter">
                        <option value="">Any time</option>
                        <option value="1">Last 24 hours</option>
                        <option value="7">Last 7 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="90">Last 90 days</option>
                    </select>
                </div>

                <div class="control-row">
                    <label>File type:</label>
                    <select id="fileTypeFilter">
                        <option value="">All types</option>
                        <option value="org">Org only</option>
                        <option value="md">Markdown only</option>
                    </select>
                </div>

                <div class="checkbox-row">
                    <input type="checkbox" id="excludeDone">
                    <label for="excludeDone">Exclude DONE items</label>
                </div>

                <div class="checkbox-row">
                    <input type="checkbox" id="hasDeadline">
                    <label for="hasDeadline">Has deadline</label>
                </div>

                <div class="control-row">
                    <label>Tags:</label>
                </div>
                <div class="tag-input">
                    <input type="text" id="tagInput" placeholder="Add tag filter...">
                    <button id="addTag">+</button>
                </div>
                <div class="tag-chips" id="tagChips"></div>
            </div>
        </details>

        <div class="stats" id="stats">Loading...</div>

        <div class="help-text">
            Click node to open file<br>
            Double-click to recenter graph<br>
            Drag nodes to rearrange
        </div>
    </div>

    <div id="graph"></div>
    <div class="loading" id="loading">Loading graph...</div>

    <div class="legend">
        <div class="legend-title">Legend</div>
        <div class="legend-item">
            <div class="legend-dot" style="background: #e74c3c;"></div>
            <span>Center file</span>
        </div>
        <div class="legend-item">
            <div class="legend-dot" style="background: #3498db;"></div>
            <span>Depth 1</span>
        </div>
        <div class="legend-item">
            <div class="legend-dot" style="background: #2ecc71;"></div>
            <span>Depth 2</span>
        </div>
        <div class="legend-item">
            <div class="legend-dot" style="background: #9b59b6;"></div>
            <span>Depth 3</span>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let network = null;
        let currentFilters = { tags: [] };

        const depthColors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];

        // Receive messages from extension
        window.addEventListener('message', event => {
            const { type, data, centerFile } = event.data;
            if (type === 'setGraphData') {
                document.getElementById('loading').style.display = 'none';
                renderGraph(data, centerFile);
                updateStats(data);
            }
        });

        function renderGraph(data, centerFile) {
            const container = document.getElementById('graph');

            if (data.nodes.length === 0) {
                container.innerHTML = '<div class="empty-state"><h3>No links found</h3><p>This file has no links to other indexed files.</p></div>';
                if (network) {
                    network.destroy();
                    network = null;
                }
                return;
            }

            // Transform nodes for vis.js
            const nodes = data.nodes.map(node => ({
                id: node.id,
                label: node.label,
                title: node.title,
                color: {
                    background: node.isCenter ? '#e74c3c' : depthColors[node.level] || '#95a5a6',
                    border: node.isCenter ? '#c0392b' : '#7f8c8d',
                    highlight: { background: '#f39c12', border: '#e67e22' },
                    hover: { background: '#f1c40f', border: '#f39c12' }
                },
                size: node.isCenter ? 25 : 15 + Math.min(node.linkCount, 10),
                font: {
                    size: node.isCenter ? 14 : 11,
                    color: '#ecf0f1'
                },
                borderWidth: node.hasUpcomingDeadline ? 3 : 2,
                borderWidthSelected: 4
            }));

            // Transform edges for vis.js
            const edges = data.edges.map(edge => ({
                id: edge.id,
                from: edge.from,
                to: edge.to,
                title: edge.title,
                arrows: 'to',
                width: Math.min(1 + edge.count, 5),
                color: {
                    color: '#7f8c8d',
                    highlight: '#f39c12',
                    hover: '#bdc3c7'
                },
                smooth: { type: 'curvedCW', roundness: 0.2 }
            }));

            const options = {
                physics: {
                    forceAtlas2Based: {
                        gravitationalConstant: -50,
                        centralGravity: 0.01,
                        springLength: 150,
                        springConstant: 0.08
                    },
                    maxVelocity: 50,
                    solver: 'forceAtlas2Based',
                    stabilization: { iterations: 100 }
                },
                interaction: {
                    hover: true,
                    tooltipDelay: 100,
                    dragNodes: true,
                    dragView: true,
                    zoomView: true
                }
            };

            if (network) {
                network.setData({ nodes, edges });
            } else {
                network = new vis.Network(container, { nodes, edges }, options);

                // Click to open file
                network.on('click', params => {
                    if (params.nodes.length > 0) {
                        vscode.postMessage({ type: 'openFile', path: params.nodes[0] });
                    }
                });

                // Double-click to recenter
                network.on('doubleClick', params => {
                    if (params.nodes.length > 0) {
                        vscode.postMessage({ type: 'recenterGraph', path: params.nodes[0] });
                    }
                });
            }
        }

        function updateStats(data) {
            const stats = document.getElementById('stats');
            const truncatedMsg = data.truncated ? ' (truncated)' : '';
            stats.textContent = data.nodes.length + ' nodes, ' + data.edges.length + ' edges' + truncatedMsg;
        }

        function sendFilters() {
            const filters = {
                tags: currentFilters.tags,
                excludeDone: document.getElementById('excludeDone').checked,
                hasDeadline: document.getElementById('hasDeadline').checked,
                fileTypes: document.getElementById('fileTypeFilter').value
                    ? [document.getElementById('fileTypeFilter').value]
                    : undefined,
                modifiedAfter: document.getElementById('modifiedFilter').value
                    ? Date.now() - (parseInt(document.getElementById('modifiedFilter').value) * 24 * 60 * 60 * 1000)
                    : undefined
            };
            vscode.postMessage({ type: 'updateFilters', filters });
        }

        // Event listeners
        document.getElementById('depth').addEventListener('input', e => {
            document.getElementById('depthValue').textContent = e.target.value;
            vscode.postMessage({ type: 'updateDepth', depth: parseInt(e.target.value) });
        });

        document.getElementById('direction').addEventListener('change', e => {
            vscode.postMessage({ type: 'updateDirection', direction: e.target.value });
        });

        document.getElementById('modifiedFilter').addEventListener('change', sendFilters);
        document.getElementById('fileTypeFilter').addEventListener('change', sendFilters);
        document.getElementById('excludeDone').addEventListener('change', sendFilters);
        document.getElementById('hasDeadline').addEventListener('change', sendFilters);

        // Tag management
        document.getElementById('addTag').addEventListener('click', () => {
            const input = document.getElementById('tagInput');
            const tag = input.value.trim().replace(/^:/, '').replace(/:$/, '');
            if (tag && !currentFilters.tags.includes(tag)) {
                currentFilters.tags.push(tag);
                renderTagChips();
                sendFilters();
            }
            input.value = '';
        });

        document.getElementById('tagInput').addEventListener('keypress', e => {
            if (e.key === 'Enter') {
                document.getElementById('addTag').click();
            }
        });

        function renderTagChips() {
            const container = document.getElementById('tagChips');
            container.innerHTML = currentFilters.tags.map(tag =>
                '<span class="tag-chip" data-tag="' + tag + '">' + tag + ' <span class="remove">×</span></span>'
            ).join('');

            container.querySelectorAll('.tag-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const tag = chip.dataset.tag;
                    currentFilters.tags = currentFilters.tags.filter(t => t !== tag);
                    renderTagChips();
                    sendFilters();
                });
            });
        }

        // Signal ready
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }

    /**
     * Dispose of the provider
     */
    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
}
