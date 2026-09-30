/**
 * Marp slide thumbnails, in two places: the Marp Slides view in the Explorer
 * sidebar and the Slide Sorter editor tab. Both show the active Marp deck.
 *
 * Each renders the deck with marp-core (each slide as an inline SVG, scaled by
 * the webview to a zoomable width) and highlights the slide under the cursor.
 * Double-clicking a thumbnail moves the editor cursor to that slide's source.
 *
 * Thumbnails can be selected (Cmd/Ctrl-click, Shift-click) and edited from a
 * context menu, the keyboard or drag and drop: cut, copy, paste, duplicate,
 * insert, move, hide and delete. Every operation is applied to the Markdown as
 * a single edit, so one undo in the editor reverses it. See slideModel.ts for
 * how slides are split and written back.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { isMarpText, renderDeck, slideStarts } from './slideRenderer';
import { setCurrentDeckSource } from './currentDeck';
import { editSlidesWithClaudeCode } from './claudeEdit';
import { replaceDocumentText } from './deckEdits';
import { copySlidesText, preparePaste } from './slideClipboard';
import { isMarpConfigFile } from './marpConfig';
import { affectsMarpRendering, marpHtmlEnabled, marpMathTypesetting, marpThemeUris } from './marpSettings';
import {
    assembleDeck, Deck, DeckEdit, deleteSlides, duplicateSlides, emptySlide, insertSlides,
    moveSlides, moveSlidesTo, normalizeSelection, parseDeck, setHidden, slideAtLine, slidesFromText,
} from './slideModel';

const SIDEBAR_VIEW_TYPE = 'scimax.marp.slides';

const RENDER_DEBOUNCE_MS = 300;

/** Thumbnail widths in pixels. The sidebar default is wider than the view, so it fills it. */
const ZOOM_MIN = 80;
const ZOOM_MAX = 640;
const ZOOM_DEFAULT: Record<SurfaceKind, number> = { sidebar: 640, sorter: 240 };

/** Operations on the selected slides, from the context menu or the keyboard shortcuts. */
const SLIDE_OPERATIONS = [
    'gotoSource', 'revealInPreview', 'present', 'editWithClaude', 'cut', 'copy', 'pasteAfter', 'pasteBefore',
    'duplicate', 'insertAfter', 'insertBefore', 'moveUp', 'moveDown',
    'hide', 'unhide', 'toggleHidden', 'delete', 'undo', 'redo',
] as const;
type SlideOperation = typeof SLIDE_OPERATIONS[number];

type SurfaceKind = 'sidebar' | 'sorter';

/** Grid of thumbnails, or one slide fitted to the view (the slide preview). */
type ViewMode = 'grid' | 'slide';

/** Messages the webview may send. Anything else is ignored. */
type WebviewMessage =
    | { type: 'ready' }
    | { type: 'goto'; slide: number }
    | { type: 'select'; indices: number[] }
    | { type: 'command'; command: SlideOperation; indices: number[] }
    | { type: 'moveTo'; indices: number[]; target: number }
    | { type: 'zoom'; width: number }
    | { type: 'mode'; mode: ViewMode };

/** What VS Code passes to a `webview/context` command: the thumbnail's `data-vscode-context`. */
interface ThumbnailContext {
    surface?: SurfaceKind;
    slideIndex?: number;
}

function parseText(text: string): Deck {
    return parseDeck(text, slideStarts(text));
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function isMarpDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'markdown' && isMarpText(document.getText());
}

/**
 * The deck both surfaces show: the Marp document in the active editor. When
 * focus moves to something that is not a text editor (the preview, the slide
 * sorter) the current deck is kept.
 */
class MarpDeckTracker implements vscode.Disposable {
    public document?: vscode.TextDocument;
    /** Cursor line in the deck when it became current. */
    public cursorLine = 0;

    private readonly changed = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            this.changed,
            vscode.window.onDidChangeActiveTextEditor(editor => this.follow(editor)),
            // Adding or removing `marp: true` switches the file over without reopening it.
            vscode.workspace.onDidChangeTextDocument(event => {
                const editor = vscode.window.activeTextEditor;
                if (editor && event.document === editor.document && event.contentChanges.some(c => c.range.start.line < 50)) {
                    this.follow(editor);
                }
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                if (document === this.document) {
                    this.set(undefined);
                }
            })
        );
        this.follow(vscode.window.activeTextEditor);
    }

    /** Show `document` if no deck is current (used when a sorter tab is restored). */
    public adopt(document: vscode.TextDocument): void {
        if (!this.document) {
            this.set(document);
        }
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    private follow(editor: vscode.TextEditor | undefined): void {
        if (!editor) {
            return;
        }
        const isMarp = isMarpDocument(editor.document);
        // Shows the sidebar view and the editor-title sorter button while a Marp deck is active.
        void vscode.commands.executeCommand('setContext', 'scimax.marp.isMarpDocument', isMarp);
        if (isMarp && editor.document !== this.document) {
            this.cursorLine = editor.selection.active.line;
            this.set(editor.document);
        }
    }

    private set(document: vscode.TextDocument | undefined): void {
        this.document = document;
        this.changed.fire();
    }
}

/** Where a controller's webview lives. */
interface Surface {
    kind: SurfaceKind;
    webview: vscode.Webview;
    isVisible(): boolean;
    /** Give focus back to the webview (after undo runs in the editor). */
    refocus(): Thenable<unknown>;
    /** The deck changed (the sorter shows its name in the tab title). */
    onDeck?(document: vscode.TextDocument | undefined): void;
}

/** Renders the current deck into one webview and carries out its commands. */
class SlideWebviewController implements vscode.Disposable {
    private document?: vscode.TextDocument;
    private deck?: Deck;
    private selection: number[] = [];
    private activeSlide = -1;
    /** Cursor line to highlight once a newly followed document's slides are known. */
    private pendingCursorLine?: number;
    private renderTimer?: ReturnType<typeof setTimeout>;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly globalState: vscode.Memento,
        private readonly tracker: MarpDeckTracker,
        public readonly surface: Surface
    ) {
        const webview = surface.webview;
        webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots() };
        webview.html = this.getHtml(webview);

        this.disposables.push(
            webview.onDidReceiveMessage((message: WebviewMessage) => this.onMessage(message)),
            tracker.onDidChange(() => this.followTracker()),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document === this.document) {
                    this.scheduleRender();
                }
            }),
            vscode.window.onDidChangeTextEditorSelection(event => {
                if (event.textEditor.document === this.document) {
                    this.updateActiveSlide(event.selections[0].active.line);
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (affectsMarpRendering(event)) {
                    this.scheduleRender();
                }
            }),
            // Saving one of the deck's theme files or a Marp CLI configuration updates the slides.
            vscode.workspace.onDidSaveTextDocument(saved => {
                if (this.document && (isMarpConfigFile(saved.uri.fsPath)
                    || marpThemeUris(this.document).some(uri => uri.fsPath === saved.uri.fsPath))) {
                    this.scheduleRender(0);
                }
            })
        );
        this.followTracker();
    }

    public refresh(): void {
        this.scheduleRender(0);
    }

    /** Switch between the grid and the single-slide preview. */
    public async setMode(mode: ViewMode): Promise<void> {
        await this.globalState.update(this.modeKey(), mode);
        void this.surface.webview.postMessage({ type: 'setMode', mode });
    }

    /** Called when the webview becomes visible again. */
    public onVisible(): void {
        this.scheduleRender(0);
    }

    public dispose(): void {
        clearTimeout(this.renderTimer);
        this.disposables.forEach(d => d.dispose());
    }

    /**
     * Run an operation from the context menu. The clicked thumbnail's operation
     * applies to the whole selection if the thumbnail is part of it; a click
     * on empty space in the view applies to no slide (paste and insert append).
     */
    public async runFromMenu(operation: SlideOperation, context?: ThumbnailContext): Promise<void> {
        const clicked = context?.slideIndex;
        let indices = this.selection;
        if (typeof clicked === 'number') {
            indices = this.selection.includes(clicked) ? this.selection : [clicked];
        } else if (context) {
            indices = [];
        }
        await this.run(operation, indices);
    }

    private followTracker(): void {
        const document = this.tracker.document;
        if (document === this.document) {
            return;
        }
        this.document = document;
        this.deck = undefined;
        this.selection = [];
        this.activeSlide = -1;
        this.pendingCursorLine = document ? this.tracker.cursorLine : undefined;
        // Images resolve relative to the deck, so its folder must be readable.
        this.surface.webview.options = { ...this.surface.webview.options, localResourceRoots: this.resourceRoots() };
        this.surface.onDeck?.(document);
        this.scheduleRender(0);
    }

    private resourceRoots(): vscode.Uri[] {
        const roots = [this.extensionUri, ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri)];
        const document = this.document ?? this.tracker.document;
        if (document && document.uri.scheme === 'file') {
            roots.push(vscode.Uri.file(path.dirname(document.uri.fsPath)));
        }
        return roots;
    }

    private zoomKey(): string {
        return `scimax.marp.thumbnailWidth.${this.surface.kind}`;
    }

    private modeKey(): string {
        return `scimax.marp.viewMode.${this.surface.kind}`;
    }

    private mode(): ViewMode {
        return this.globalState.get<ViewMode>(this.modeKey(), 'grid') === 'slide' ? 'slide' : 'grid';
    }

    private zoom(): number {
        const width = this.globalState.get<number>(this.zoomKey(), ZOOM_DEFAULT[this.surface.kind]);
        return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, width));
    }

    private scheduleRender(delayMs = RENDER_DEBOUNCE_MS): void {
        clearTimeout(this.renderTimer);
        this.renderTimer = setTimeout(() => void this.render(), delayMs);
    }

    private async render(): Promise<void> {
        if (!this.surface.isVisible()) {
            return;
        }
        const webview = this.surface.webview;
        const document = this.document;
        if (!document) {
            this.deck = undefined;
            void webview.postMessage({ type: 'empty' });
            return;
        }

        try {
            const text = document.getText();
            const deck = parseText(text);
            // Hidden slides are commented out of the deck, so render a copy
            // with them restored to get their thumbnails.
            const hidden = deck.slides.map(slide => slide.hidden);
            const displayText = hidden.some(Boolean) ? assembleDeck(deck, { revealHidden: true }) : text;
            const rendered = renderDeck(displayText, {
                enableHtml: marpHtmlEnabled(document),
                math: marpMathTypesetting(document),
                themes: await this.loadThemes(document),
            });
            if (document !== this.document) {
                return;
            }
            this.deck = deck;
            this.selection = normalizeSelection(deck, this.selection);
            if (this.pendingCursorLine !== undefined) {
                this.activeSlide = slideAtLine(deck.slides, this.pendingCursorLine);
                this.pendingCursorLine = undefined;
            }
            const dir = vscode.Uri.file(path.dirname(document.uri.fsPath));
            void webview.postMessage({
                type: 'render',
                html: rendered.html,
                css: rendered.css,
                hidden,
                baseUri: document.uri.scheme === 'file' ? webview.asWebviewUri(dir).toString() + '/' : '',
                uri: document.uri.toString(),
                title: path.basename(document.fileName),
                active: this.activeSlide,
                selection: this.selection,
            });
        } catch (error) {
            void webview.postMessage({ type: 'error', message: String(error) });
        }
    }

    /** Contents of the theme files in `scimax.marp.themes`. Missing files are skipped. */
    private async loadThemes(document: vscode.TextDocument): Promise<string[]> {
        const results: string[] = [];
        for (const uri of marpThemeUris(document)) {
            try {
                results.push(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
            } catch {
                // The deck falls back to a built-in theme, as in the Marp preview.
            }
        }
        return results;
    }

    private updateActiveSlide(line: number): void {
        const index = this.deck ? slideAtLine(this.deck.slides, line) : -1;
        if (index !== this.activeSlide) {
            this.activeSlide = index;
            void this.surface.webview.postMessage({ type: 'active', index });
        }
    }

    private async onMessage(message: WebviewMessage): Promise<void> {
        switch (message?.type) {
            case 'ready':
                this.scheduleRender(0);
                break;
            case 'goto':
                if (Number.isInteger(message.slide)) {
                    await this.gotoSlide(message.slide);
                }
                break;
            case 'select':
                if (Array.isArray(message.indices)) {
                    this.selection = message.indices.filter(Number.isInteger);
                }
                break;
            case 'command':
                if (SLIDE_OPERATIONS.includes(message.command) && Array.isArray(message.indices)) {
                    this.selection = message.indices.filter(Number.isInteger);
                    await this.run(message.command, this.selection);
                }
                break;
            case 'moveTo':
                if (Array.isArray(message.indices) && Number.isInteger(message.target)) {
                    await this.moveTo(message.indices.filter(Number.isInteger), message.target);
                }
                break;
            case 'mode':
                if (message.mode === 'grid' || message.mode === 'slide') {
                    await this.globalState.update(this.modeKey(), message.mode);
                }
                break;
            case 'zoom':
                if (Number.isFinite(message.width)) {
                    const width = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, message.width)));
                    await this.globalState.update(this.zoomKey(), width);
                }
                break;
        }
    }

    private async moveTo(indices: number[], target: number): Promise<void> {
        const document = this.document;
        if (!document) {
            return;
        }
        const text = document.getText();
        await this.apply(document, text, moveSlidesTo(parseText(text), indices, target));
    }

    private async run(operation: SlideOperation, requested: number[]): Promise<void> {
        const document = this.document;
        if (!document) {
            return;
        }
        // Parse the current text, not the last render, so edits made since are kept.
        const text = document.getText();
        const deck = parseText(text);
        const indices = normalizeSelection(deck, requested);
        const first = indices[0];
        const last = indices[indices.length - 1];

        switch (operation) {
            case 'gotoSource':
                if (indices.length > 0) {
                    await this.gotoSlide(first, deck);
                }
                return;
            case 'revealInPreview':
                if (indices.length > 0) {
                    // The slide preview follows the editor cursor.
                    await this.gotoSlide(first, deck);
                    await vscode.commands.executeCommand('scimax.marp.openSlidePreview');
                }
                return;
            case 'editWithClaude':
                await editSlidesWithClaudeCode(document, indices);
                return;
            case 'present': {
                // The slideshow numbers only the slides it shows.
                const at = indices.length > 0 ? first : 0;
                const slide = deck.slides.slice(0, at).filter(s => !s.hidden).length + 1;
                await vscode.commands.executeCommand('scimax.marp.present', { file: document.uri.fsPath, slide });
                return;
            }
            case 'copy':
            case 'cut':
                if (indices.length === 0) {
                    return;
                }
                await vscode.env.clipboard.writeText(copySlidesText(document, deck, indices));
                if (operation === 'copy') {
                    vscode.window.setStatusBarMessage(`Copied ${plural(indices.length, 'slide')}`, 3000);
                    return;
                }
                await this.apply(document, text, deleteSlides(deck, indices));
                return;
            case 'pasteAfter':
            case 'pasteBefore': {
                const clip = await vscode.env.clipboard.readText();
                if (slidesFromText(clip, slideStarts(clip)).length === 0) {
                    vscode.window.setStatusBarMessage('Nothing to paste', 3000);
                    return;
                }
                // Image paths are made relative to this deck; this may ask to copy the images.
                const ready = await preparePaste(clip, document);
                if (ready === undefined) {
                    return;
                }
                if (document.getText() !== text) {
                    vscode.window.setStatusBarMessage('The deck changed while pasting; paste again', 5000);
                    return;
                }
                const slides = slidesFromText(ready, slideStarts(ready));
                const at = operation === 'pasteAfter'
                    ? (indices.length > 0 ? last + 1 : deck.slides.length)
                    : (indices.length > 0 ? first : 0);
                await this.apply(document, text, insertSlides(deck, at, slides));
                return;
            }
            case 'insertAfter':
            case 'insertBefore': {
                const at = operation === 'insertAfter'
                    ? (indices.length > 0 ? last + 1 : deck.slides.length)
                    : (indices.length > 0 ? first : 0);
                const edit = insertSlides(deck, at, [emptySlide()]);
                if (await this.apply(document, text, edit)) {
                    // Put the cursor in the new slide, ready to type.
                    await this.gotoSlide(at, parseText(document.getText()), true);
                }
                return;
            }
            case 'duplicate':
                await this.apply(document, text, duplicateSlides(deck, indices));
                return;
            case 'moveUp':
            case 'moveDown':
                await this.apply(document, text, moveSlides(deck, indices, operation === 'moveUp' ? -1 : 1));
                return;
            case 'hide':
            case 'unhide':
            case 'toggleHidden': {
                const hide = operation === 'toggleHidden'
                    ? indices.some(i => !deck.slides[i].hidden)
                    : operation === 'hide';
                await this.apply(document, text, setHidden(deck, indices, hide));
                return;
            }
            case 'delete':
                await this.apply(document, text, deleteSlides(deck, indices));
                return;
            case 'undo':
            case 'redo':
                // Undo belongs to the editor, so run it there and come back.
                await vscode.window.showTextDocument(document, { viewColumn: this.editorColumn(document) });
                await vscode.commands.executeCommand(operation);
                await this.surface.refocus();
                return;
        }
    }

    /**
     * Write an edited deck back to the document, replacing only the text that
     * changed so the rest of the file (and its undo history) is untouched.
     */
    private async apply(document: vscode.TextDocument, oldText: string, edit: DeckEdit): Promise<boolean> {
        if (!(await replaceDocumentText(document, oldText, assembleDeck(edit.deck)))) {
            return false;
        }
        this.selection = edit.selection;
        this.scheduleRender(0);
        return true;
    }

    /**
     * Column to show the deck in: where it is already visible; otherwise, from
     * the sorter tab, the column beside it (so the sorter is not replaced).
     */
    private editorColumn(document: vscode.TextDocument): vscode.ViewColumn | undefined {
        const visible = vscode.window.visibleTextEditors.find(e => e.document === document);
        if (visible) {
            return visible.viewColumn;
        }
        return this.surface.kind === 'sorter' ? vscode.ViewColumn.Beside : undefined;
    }

    private async gotoSlide(index: number, deck = this.deck, focusBlank = false): Promise<void> {
        const slide = deck?.slides[index];
        const document = this.document;
        if (!slide || !document) {
            return;
        }
        // A new slide has no content yet: go to the blank line after its separator.
        const line = focusBlank
            ? Math.min(slide.startLine + (slide.sep !== null ? 1 : 0), document.lineCount - 1)
            : slide.contentLine;
        const position = new vscode.Position(line, 0);
        const editor = await vscode.window.showTextDocument(document, {
            viewColumn: this.editorColumn(document),
            selection: new vscode.Range(position, position),
        });
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const mediaUri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'marp', file));
        const csp = [
            `default-src 'none'`,
            // Marp's slide CSS and inline style attributes are injected at runtime.
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `img-src ${webview.cspSource} https: data:`,
            `font-src ${webview.cspSource} https: data:`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');
        const kind = this.surface.kind;
        const context = JSON.stringify({ webviewSection: 'deck', surface: kind, preventDefaultContextMenuItems: true });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${mediaUri('thumbnails.css')}">
</head>
<body class="${kind}" data-surface="${kind}" data-mode="${this.mode()}" data-zoom="${this.zoom()}"
      data-zoom-min="${ZOOM_MIN}" data-zoom-max="${ZOOM_MAX}" data-zoom-default="${ZOOM_DEFAULT[kind]}"
      data-vscode-context='${context}'>
    <div class="toolbar">
        <span class="modes" role="group" aria-label="View">
            <button id="modeGrid" class="mode-button" title="All slides (V)" aria-label="All slides">&#9638;</button>
            <button id="modeSlide" class="mode-button" title="One slide, following the cursor (V)" aria-label="One slide">&#9645;</button>
        </span>
        <button id="prev" class="nav-button" title="Previous slide (Left)" aria-label="Previous slide">&lsaquo;</button>
        <button id="next" class="nav-button" title="Next slide (Right)" aria-label="Next slide">&rsaquo;</button>
        <span id="count" class="count"></span>
        <button id="zoomOut" class="zoom-button" title="Smaller thumbnails (-)" aria-label="Smaller thumbnails">&minus;</button>
        <input id="zoom" class="zoom" type="range" min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="10"
               title="Thumbnail size (+, -, 0 to reset)" aria-label="Thumbnail size">
        <button id="zoomIn" class="zoom-button" title="Larger thumbnails (+)" aria-label="Larger thumbnails">+</button>
    </div>
    <div id="status" class="status">Open a Marp deck (front matter <code>marp: true</code>) to see its slides.</div>
    <div id="slides" class="slides" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="Slides"></div>
    <script nonce="${nonce}" src="${mediaUri('thumbnails.js')}"></script>
</body>
</html>`;
    }
}

/** The Slide Sorter editor tab (one at a time), restored after a reload. */
class SlideSorter implements vscode.WebviewPanelSerializer, vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    public controller?: SlideWebviewController;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly globalState: vscode.Memento,
        private readonly tracker: MarpDeckTracker
    ) {}

    public async open(mode?: ViewMode): Promise<void> {
        if (!this.tracker.document) {
            vscode.window.showInformationMessage('Open a Marp deck (a Markdown file with marp: true in its front matter) first.');
            return;
        }
        if (this.panel) {
            if (mode) {
                await this.controller?.setMode(mode);
            }
            this.panel.reveal(undefined, mode === 'slide');
            return;
        }
        if (mode) {
            // Read by the new panel's HTML.
            await this.globalState.update('scimax.marp.viewMode.sorter', mode);
        }
        const panel = vscode.window.createWebviewPanel(
            'scimax.marp.slideSorter',
            'Slides',
            // The preview keeps focus in the editor, so its cursor drives the slide shown.
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: mode === 'slide' },
            { enableScripts: true }
        );
        this.attach(panel);
    }

    public async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { uri?: string } | undefined): Promise<void> {
        if (typeof state?.uri === 'string') {
            try {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.uri));
                if (isMarpDocument(document)) {
                    this.tracker.adopt(document);
                }
            } catch {
                // The deck is gone; the sorter shows whichever deck is opened next.
            }
        }
        this.attach(panel);
    }

    public dispose(): void {
        this.panel?.dispose();
    }

    private attach(panel: vscode.WebviewPanel): void {
        this.panel = panel;
        const controller = new SlideWebviewController(this.extensionUri, this.globalState, this.tracker, {
            kind: 'sorter',
            webview: panel.webview,
            isVisible: () => panel.visible,
            refocus: () => {
                panel.reveal(undefined, false);
                return Promise.resolve();
            },
            onDeck: document => {
                panel.title = document ? `Slides: ${path.basename(document.fileName)}` : 'Slides';
            },
        });
        this.controller = controller;
        panel.onDidChangeViewState(() => {
            if (panel.visible) {
                controller.onVisible();
            }
        });
        panel.onDidDispose(() => {
            controller.dispose();
            if (this.panel === panel) {
                this.panel = undefined;
                this.controller = undefined;
            }
        });
    }
}

/** The Marp Slides view in the Explorer sidebar. */
class SlideSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public controller?: SlideWebviewController;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly globalState: vscode.Memento,
        private readonly tracker: MarpDeckTracker
    ) {}

    public resolveWebviewView(view: vscode.WebviewView): void {
        const controller = new SlideWebviewController(this.extensionUri, this.globalState, this.tracker, {
            kind: 'sidebar',
            webview: view.webview,
            isVisible: () => view.visible,
            refocus: () => vscode.commands.executeCommand(`${SIDEBAR_VIEW_TYPE}.focus`),
        });
        this.controller = controller;
        view.onDidChangeVisibility(() => {
            if (view.visible) {
                controller.onVisible();
            }
        });
        view.onDidDispose(() => {
            controller.dispose();
            if (this.controller === controller) {
                this.controller = undefined;
            }
        });
    }

    public dispose(): void {
        this.controller?.dispose();
    }
}

export function registerSlideThumbnailView(context: vscode.ExtensionContext): void {
    const tracker = new MarpDeckTracker();
    setCurrentDeckSource(() => tracker.document);
    const sidebar = new SlideSidebarProvider(context.extensionUri, context.globalState, tracker);
    const sorter = new SlideSorter(context.extensionUri, context.globalState, tracker);

    /** Menu commands go to the surface that was right-clicked. */
    const menu = (operation: SlideOperation) => (arg?: ThumbnailContext) => {
        const controller = arg?.surface === 'sorter' ? sorter.controller : sidebar.controller;
        return controller?.runFromMenu(operation, arg);
    };

    context.subscriptions.push(
        tracker,
        sidebar,
        sorter,
        vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_TYPE, sidebar),
        vscode.window.registerWebviewPanelSerializer('scimax.marp.slideSorter', sorter),
        vscode.commands.registerCommand('scimax.marp.openSlideSorter', () => sorter.open('grid')),
        vscode.commands.registerCommand('scimax.marp.openSlidePreview', () => sorter.open('slide')),
        vscode.commands.registerCommand('scimax.marp.refreshSlides', () => {
            sidebar.controller?.refresh();
            sorter.controller?.refresh();
        }),
        // Thumbnail context menu (webview/context).
        vscode.commands.registerCommand('scimax.marp.slide.gotoSource', menu('gotoSource')),
        vscode.commands.registerCommand('scimax.marp.slide.revealInPreview', menu('revealInPreview')),
        vscode.commands.registerCommand('scimax.marp.slide.present', menu('present')),
        vscode.commands.registerCommand('scimax.marp.slide.editWithClaude', menu('editWithClaude')),
        vscode.commands.registerCommand('scimax.marp.slide.cut', menu('cut')),
        vscode.commands.registerCommand('scimax.marp.slide.copy', menu('copy')),
        vscode.commands.registerCommand('scimax.marp.slide.pasteAfter', menu('pasteAfter')),
        vscode.commands.registerCommand('scimax.marp.slide.pasteBefore', menu('pasteBefore')),
        vscode.commands.registerCommand('scimax.marp.slide.duplicate', menu('duplicate')),
        vscode.commands.registerCommand('scimax.marp.slide.insertAfter', menu('insertAfter')),
        vscode.commands.registerCommand('scimax.marp.slide.insertBefore', menu('insertBefore')),
        vscode.commands.registerCommand('scimax.marp.slide.moveUp', menu('moveUp')),
        vscode.commands.registerCommand('scimax.marp.slide.moveDown', menu('moveDown')),
        vscode.commands.registerCommand('scimax.marp.slide.hide', menu('hide')),
        vscode.commands.registerCommand('scimax.marp.slide.unhide', menu('unhide')),
        vscode.commands.registerCommand('scimax.marp.slide.delete', menu('delete'))
    );
}
