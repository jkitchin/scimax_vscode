/**
 * Run a Marp deck's ```python run cells in VS Code, in a Python panel beside
 * the deck, so they can be tried while writing the slides. The panel uses
 * the same Pyodide worker as the slideshow (media/marpPresent/pycells.js), so
 * code that works here works in the talk. All cells of a deck share one
 * Python; `hidden` setup cells run first, as in the slideshow.
 *
 * C-c C-c in a run cell runs it (context key scimax.marp.inRunCell).
 */

import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { isMarpText, slideStarts } from './slideRenderer';
import { parseDeck } from './slideModel';
import { frontMatterValue } from './marpAuthoring';
import { presenterOffline, RunCell, runCellAt, runCells } from './presenterBundle';
import { offlinePythonFiles } from './marpExportCommands';

/** 1-based number of the slide (counting all slides) that contains 0-based `line`. */
function slideOf(text: string, line: number): number {
    const slides = parseDeck(text, slideStarts(text)).slides;
    let index = slides.findIndex((slide, i) => line >= slide.startLine && (i + 1 >= slides.length || line < slides[i + 1].startLine));
    if (index < 0) {
        index = 0;
    }
    return index + 1;
}

/** The webview page: pycells.js (for its worker) and runner.js, with VS Code's colours. */
export function runnerPage(webview: Pick<vscode.Webview, 'asWebviewUri' | 'cspSource'>, mediaDir: vscode.Uri, title: string): string {
    const nonce = randomBytes(16).toString('base64');
    const pycells = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'pycells.js'));
    const runner = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'runner.js'));
    // The worker loads Pyodide from jsdelivr and packages from PyPI; Pyodide compiles WebAssembly.
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net 'wasm-unsafe-eval' 'unsafe-eval' blob: data:`,
        `worker-src blob: data:`,
        `connect-src https: data: blob:`,
    ].join('; ');
    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
  background: var(--vscode-editor-background); margin: 0; }
.bar { position: sticky; top: 0; display: flex; gap: 0.5em; align-items: center; padding: 6px 10px; z-index: 1;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background)); border-bottom: 1px solid var(--vscode-panel-border, transparent); }
.bar #status { flex: 1; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
  border: 0; padding: 3px 10px; border-radius: 2px; cursor: pointer; }
.bar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
#status.busy::before { content: ""; display: inline-block; width: 0.8em; height: 0.8em; margin-right: 0.4em; border-radius: 50%;
  border: 2px solid var(--vscode-progressBar-background); border-right-color: transparent; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
#log { padding: 4px 10px 40px; }
#log:empty::before { content: "Press C-c C-c in a \`\`\`python run cell of the deck to run it here."; color: var(--vscode-descriptionForeground); }
.entry { margin: 10px 0; border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 8px; }
.entry.failed { border-left-color: var(--vscode-errorForeground); }
.head { display: flex; gap: 0.6em; align-items: baseline; font-size: 0.9em; }
.head .n { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); }
.head a { color: var(--vscode-textLink-foreground); text-decoration: none; white-space: nowrap; }
.head code { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
body .pyc-out { background: transparent; border: 0; overflow: visible; }
/* "body" outranks the styles pycells.js adds for the slides. */
body .pyc-out pre { margin: 2px 0; padding: 0; white-space: pre-wrap; font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size); color: var(--vscode-foreground); background: none; }
body .pyc-out pre.stderr { color: var(--vscode-editorWarning-foreground); }
body .pyc-out pre.error { color: var(--vscode-errorForeground); background: none !important; }
body .pyc-out pre.result { color: var(--vscode-textPreformat-foreground, var(--vscode-foreground)); }
body .pyc-out pre.note { color: var(--vscode-descriptionForeground); font-style: italic; }
body .pyc-out img { display: block; max-width: 100%; max-height: none; margin: 4px 0; background: white; cursor: default; }
</style>
</head>
<body>
<div class="bar"><span id="status">Python starts when you run a cell</span>
<button id="clear" title="Remove the output">Clear</button>
<button id="restart" title="A fresh Python (clears all variables)">Restart</button></div>
<div id="log"></div>
<script nonce="${nonce}" src="${pycells}"></script>
<script nonce="${nonce}" src="${runner}"></script>
</body>
</html>`;
}

/** The Python panel: one at a time, for one deck. */
class PythonRunner {
    private panel: vscode.WebviewPanel | undefined;
    private deck: string | undefined;
    private ready: Promise<void> = Promise.resolve();
    private offlineSent = false;

    constructor(private readonly context: vscode.ExtensionContext) {}

    /** The panel for `document`, a fresh Python if it was showing another deck. */
    private async open(document: vscode.TextDocument): Promise<vscode.WebviewPanel> {
        const title = `Python: ${path.basename(document.fileName)}`;
        if (this.panel && this.deck !== document.uri.fsPath) {
            await this.post({ type: 'restart' });
            await this.post({ type: 'clear' });
            this.offlineSent = false;
        }
        this.deck = document.uri.fsPath;
        if (this.panel) {
            this.panel.title = title;
            this.panel.reveal(vscode.ViewColumn.Beside, true);
            return this.panel;
        }
        const mediaDir = vscode.Uri.file(this.context.asAbsolutePath(path.join('media', 'marpPresent')));
        const panel = vscode.window.createWebviewPanel('scimax.marpPython', title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            retainContextWhenHidden: true,   // keep the Python session while the panel is hidden
            localResourceRoots: [mediaDir],
        });
        this.panel = panel;
        this.offlineSent = false;
        this.ready = new Promise(resolve => {
            const sub = panel.webview.onDidReceiveMessage(message => {
                if (message?.type === 'ready') {
                    sub.dispose();
                    resolve();
                }
            });
        });
        panel.webview.onDidReceiveMessage(message => {
            if (message?.type === 'reveal' && typeof message.line === 'number' && this.deck) {
                void this.reveal(this.deck, message.line);
            }
        });
        panel.onDidDispose(() => {
            if (this.panel === panel) {
                this.panel = undefined;
                this.deck = undefined;
            }
        });
        panel.webview.html = runnerPage(panel.webview, mediaDir, title);
        return panel;
    }

    private async post(message: unknown): Promise<void> {
        await this.ready;
        await this.panel?.webview.postMessage(message);
    }

    private async reveal(file: string, line: number): Promise<void> {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    /** An offline deck's Python runs here from the same cached files as in the slideshow. */
    private async sendOffline(document: vscode.TextDocument): Promise<void> {
        if (this.offlineSent || !presenterOffline(frontMatterValue(document.getText().split(/\r?\n/), 'presenter'))) {
            return;
        }
        this.offlineSent = true;
        try {
            const { files } = await offlinePythonFiles(this.context, document.getText());
            const encoded: Record<string, string> = {};
            for (const [name, data] of Object.entries(files)) {
                encoded[name] = data.toString('base64');
            }
            await this.post({ type: 'offline', files: encoded });
        } catch {
            // Without the cached files the panel downloads Python like an online deck.
        }
    }

    async run(document: vscode.TextDocument, cells: RunCell[]): Promise<void> {
        await this.open(document);
        await this.sendOffline(document);
        const text = document.getText();
        const all = runCells(text);
        const setup = all.filter(cell => cell.flags.includes('hidden')).map(cell => cell.code);
        for (const cell of cells) {
            const number = all.findIndex(c => c.startLine === cell.startLine) + 1;
            const hidden = cell.flags.includes('hidden') ? ', hidden' : '';
            await this.post({
                type: 'run',
                code: cell.code,
                name: `<cell ${number}>`,
                label: `Slide ${slideOf(text, cell.startLine)}, cell ${number}${hidden}`,
                line: cell.startLine + 1,
                setup,
            });
        }
    }

    async restart(): Promise<void> {
        if (this.panel) {
            await this.post({ type: 'restart' });
        }
    }
}

/** The active editor's Marp deck, if Python may run for it. */
function deckEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown' || !isMarpText(editor.document.getText())) {
        vscode.window.showInformationMessage('This works in a Marp deck (a Markdown file with marp: true in its front matter).');
        return undefined;
    }
    if (!vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage('Python cells run only in a trusted workspace.');
        return undefined;
    }
    return editor;
}

function updateContext(editor: vscode.TextEditor | undefined): void {
    const inCell = !!editor && editor.document.languageId === 'markdown' && isMarpText(editor.document.getText())
        && runCellAt(editor.document.getText(), editor.selection.active.line) !== undefined;
    void vscode.commands.executeCommand('setContext', 'scimax.marp.inRunCell', inCell);
}

export function registerMarpPythonRunner(context: vscode.ExtensionContext): void {
    const runner = new PythonRunner(context);
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.marp.runCell', async () => {
            const editor = deckEditor();
            if (!editor) {
                return;
            }
            const cell = runCellAt(editor.document.getText(), editor.selection.active.line);
            if (!cell) {
                vscode.window.showInformationMessage('Put the cursor in a ```python run cell to run it.');
                return;
            }
            await runner.run(editor.document, [cell]);
        }),
        vscode.commands.registerCommand('scimax.marp.runAllCells', async () => {
            const editor = deckEditor();
            if (!editor) {
                return;
            }
            const cells = runCells(editor.document.getText()).filter(cell => !cell.flags.includes('hidden'));
            if (cells.length === 0) {
                vscode.window.showInformationMessage('This deck has no ```python run cells.');
                return;
            }
            await runner.restart();
            await runner.run(editor.document, cells);
        }),
        vscode.commands.registerCommand('scimax.marp.restartPython', () => runner.restart()),
        vscode.window.onDidChangeTextEditorSelection(event => updateContext(event.textEditor)),
        vscode.window.onDidChangeActiveTextEditor(updateContext)
    );
    updateContext(vscode.window.activeTextEditor);
}
