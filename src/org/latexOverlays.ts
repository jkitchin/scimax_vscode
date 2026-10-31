/**
 * Inline LaTeX previews, like org's C-c C-x C-l (org-latex-preview): math
 * fragments and environments are drawn as rendered equations in the editor.
 *
 * The fragment's source is hidden (display:none, as the descriptive link
 * display does) and the equation is drawn in its place. It comes back while
 * the cursor is inside it, and an edit to it drops the preview, as in org.
 * Rendering reuses the hover preview's LaTeX pipeline and cache.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
    LatexFragment,
    findAllLatexFragments,
    findLatexFragmentAtPosition,
    getEquationNumber,
    invalidateEquationCounterCache,
    latexCacheDir,
    parseLatexSettings,
    renderLatexToSvg,
} from './latexPreviewProvider';
import { parseStartupOptions } from './speedCommands/visibility';
import { readImageSize } from './imageHover';
import {
    OffsetRange,
    OverlaySize,
    SvgBox,
    editorLineHeight,
    overlaySize,
    previewStripSvg,
    readSvgBox,
    sectionLines,
    shiftRanges,
} from './latexOverlayLayout';

/** A previewed fragment. Offsets follow edits; image is set once rendered. */
interface Preview extends OffsetRange {
    fragment: LatexFragment;
    /** One image per line the fragment spans */
    strips?: vscode.Uri[];
    size?: OverlaySize;
    failed?: string;
    /** Clicked: the source shows until the cursor leaves it */
    opened?: boolean;
    /** The source is showing, so edits to it are kept and re-rendered on leaving */
    showingSource?: boolean;
}

/** Fragments rendered at once */
const RENDER_CONCURRENCY = 4;

const previews = new Map<string, Preview[]>();
const startupChecked = new Set<string>();
let hideType: vscode.TextEditorDecorationType;
let imageType: vscode.TextEditorDecorationType;
let errorType: vscode.TextEditorDecorationType;

function isOrg(document: vscode.TextDocument): boolean {
    return document.languageId === 'org' || document.fileName.endsWith('.org');
}

function isDark(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}

/** Text colour for the equations: the user's setting, or a grey that reads on the theme */
function foreground(): string {
    const color = vscode.workspace.getConfiguration('scimax.latexPreview').get<string>('overlayForeground', 'auto');
    if (color && color !== 'auto' && /^[#\w(),.\s%]+$/.test(color)) return color;
    return isDark() ? '#d4d4d4' : '#1f1f1f';
}

function fontMetrics(document: vscode.TextDocument): { fontSize: number; lineHeight: number } {
    const editor = vscode.workspace.getConfiguration('editor', document);
    const fontSize = editor.get<number>('fontSize', 14);
    return { fontSize, lineHeight: editorLineHeight(fontSize, editor.get<number>('lineHeight', 0), process.platform) };
}

/** The rendered equation as an SVG dvisvgm would write (a PNG fallback is wrapped in one) */
function baseSvg(imagePath: string): string | undefined {
    if (imagePath.toLowerCase().endsWith('.svg')) return fs.readFileSync(imagePath, 'utf8');
    const size = readImageSize(imagePath);
    if (!size) return undefined;
    // pdftoppm renders at 150 dpi: back to points, with the baseline unknown (at the bottom)
    const w = size.width * 72 / 150;
    const h = size.height * 72 / 150;
    const data = fs.readFileSync(imagePath).toString('base64');
    const invert = isDark() ? " style='filter: invert(1)'" : '';
    return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 ${-h} ${w} ${h}'>`
        + `<image x='0' y='${-h}' width='${w}' height='${h}' preserveAspectRatio='none'${invert} xlink:href='data:image/png;base64,${data}'/></svg>`;
}

/** Write the per-line images for a rendered equation and return them */
function writeStrips(svg: string, box: SvgBox, size: OverlaySize, color: string): vscode.Uri[] {
    const dir = path.join(latexCacheDir(), 'overlays');
    fs.mkdirSync(dir, { recursive: true });
    const strips: vscode.Uri[] = [];
    for (let i = 0; i < size.lines; i++) {
        const strip = previewStripSvg(svg, box, size, i, color);
        const name = crypto.createHash('sha256').update(strip).digest('hex').slice(0, 24) + '.svg';
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) fs.writeFileSync(file, strip);
        strips.push(vscode.Uri.file(file));
    }
    return strips;
}

async function render(document: vscode.TextDocument, preview: Preview): Promise<void> {
    const fragment = preview.fragment;
    const result = await renderLatexToSvg(
        fragment,
        parseLatexSettings(document),
        getEquationNumber(document, fragment),
        false // black on transparent; recoloured for the theme below
    );
    const imagePath = result.svgPath || result.pngPath;
    if (!result.success || !imagePath) {
        preview.failed = result.error || 'LaTeX could not render this fragment';
        return;
    }
    const svg = baseSvg(imagePath);
    const box = svg && readSvgBox(svg);
    if (!svg || !box) {
        preview.failed = `Could not read the rendered image ${imagePath}`;
        return;
    }
    const { fontSize, lineHeight } = fontMetrics(document);
    const scale = vscode.workspace.getConfiguration('scimax.latexPreview').get<number>('overlayScale', 1);
    const lines = document.positionAt(preview.end).line - document.positionAt(preview.start).line + 1;
    preview.size = overlaySize(box, fontSize, lineHeight, lines, scale);
    preview.strips = writeStrips(svg, box, preview.size, foreground());
    preview.failed = undefined;
}

/** Render previews a few at a time, redrawing as they finish */
async function renderAll(document: vscode.TextDocument, todo: Preview[]): Promise<void> {
    if (todo.length === 0) return;
    invalidateEquationCounterCache(document);
    let next = 0;
    const work = async () => {
        while (next < todo.length) {
            const preview = todo[next++];
            try {
                await render(document, preview);
            } catch (err) {
                preview.failed = String(err);
            }
            redraw(document);
        }
    };
    const run = () => Promise.all(Array.from({ length: Math.min(RENDER_CONCURRENCY, todo.length) }, work));
    if (todo.length === 1) {
        await run();
    } else {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Rendering ${todo.length} LaTeX previews` },
            run
        );
    }
    const failed = todo.filter(p => p.failed && previewsOf(document).includes(p)).length;
    if (failed > 0) {
        vscode.window.showWarningMessage(
            `${failed} LaTeX fragment${failed === 1 ? '' : 's'} could not be rendered; hover the ⚠ for the error.`
        );
    }
}

function previewsOf(document: vscode.TextDocument): Preview[] {
    return previews.get(document.uri.toString()) ?? [];
}

/** Preview the fragments that lie in [start, end), replacing any already there */
async function previewRange(document: vscode.TextDocument, start: number, end: number): Promise<number> {
    const fragments = findAllLatexFragments(document)
        .filter(f => f.startOffset >= start && f.endOffset <= end);
    const kept = previewsOf(document).filter(p => !fragments.some(f => f.startOffset < p.end && f.endOffset > p.start));
    const added = fragments.map(fragment => ({ fragment, start: fragment.startOffset, end: fragment.endOffset }));
    previews.set(document.uri.toString(), [...kept, ...added].sort((a, b) => a.start - b.start));
    redraw(document);
    await renderAll(document, added);
    return added.length;
}

/** Remove previews overlapping [start, end); returns how many were removed */
function clearRange(document: vscode.TextDocument, start: number, end: number): number {
    const all = previewsOf(document);
    const kept = all.filter(p => p.end <= start || p.start >= end);
    previews.set(document.uri.toString(), kept);
    redraw(document);
    return all.length - kept.length;
}

/** Is the cursor in or at the edge of this preview? */
function cursorAt(editor: vscode.TextEditor, preview: Preview): boolean {
    const document = editor.document;
    return editor.selections.some(sel => {
        const offset = document.offsetAt(sel.active);
        return offset >= preview.start && offset <= preview.end;
    });
}

/** Is the cursor inside this preview (where its source shows instead)? */
function cursorIn(editor: vscode.TextEditor, preview: Preview): boolean {
    const document = editor.document;
    const startLine = document.positionAt(preview.start).line;
    const endLine = document.positionAt(preview.end).line;
    return editor.selections.some(sel => {
        if (!sel.isEmpty) {
            const a = document.offsetAt(sel.start);
            const b = document.offsetAt(sel.end);
            if (a < preview.end && b > preview.start) return true;
        }
        const line = sel.active.line;
        // A preview over several lines is a block: on any of its lines, show the source
        if (endLine > startLine) return line >= startLine && line <= endLine;
        const offset = document.offsetAt(sel.active);
        return offset > preview.start && offset < preview.end;
    });
}

function redrawEditor(editor: vscode.TextEditor): void {
    const document = editor.document;
    const hidden: vscode.Range[] = [];
    const images: vscode.DecorationOptions[] = [];
    const errors: vscode.DecorationOptions[] = [];
    const left: Preview[] = [];

    for (const preview of previewsOf(document)) {
        const range = new vscode.Range(document.positionAt(preview.start), document.positionAt(preview.end));
        if (preview.failed) {
            const hover = new vscode.MarkdownString();
            hover.appendMarkdown('**LaTeX preview failed**\n\n');
            hover.appendCodeblock(preview.failed.slice(0, 2000), 'text');
            errors.push({ range: new vscode.Range(range.end, range.end), hoverMessage: hover });
            continue;
        }
        // A clicked equation closes again once the cursor has left it
        if (preview.opened && !cursorAt(editor, preview) && !cursorIn(editor, preview)) preview.opened = false;
        const showing = preview.opened || cursorIn(editor, preview);
        if (preview.showingSource && !showing && preview.edited) left.push(preview);
        preview.showingSource = showing;
        if (!preview.strips || !preview.size || showing) continue;

        hidden.push(range);
        const size = preview.size;
        const oneLine = preview.strips.length === 1;
        preview.strips.forEach((strip, i) => {
            const line = range.start.line + i;
            const at = i === 0 ? range.start : new vscode.Position(line, 0);
            images.push({
                range: new vscode.Range(at, at),
                renderOptions: {
                    before: {
                        contentIconPath: strip,
                        width: `${size.width}px`,
                        height: `${oneLine ? size.height : size.lineHeight}px`,
                        // An inline equation sits on the text baseline; strips fill their line
                        textDecoration: oneLine && preview.fragment.type === 'inline'
                            ? `none; vertical-align: ${-size.depth}px;`
                            : 'none; vertical-align: top;',
                    },
                },
            });
        });
    }

    editor.setDecorations(hideType, hidden);
    editor.setDecorations(imageType, images);
    editor.setDecorations(errorType, errors);
    if (left.length > 0) void rerenderEdited(document, left);
}

/** Render edited fragments again once the cursor has left them; drop any that are no longer math */
async function rerenderEdited(document: vscode.TextDocument, edited: Preview[]): Promise<void> {
    const fragments = findAllLatexFragments(document);
    const todo: Preview[] = [];
    let list = previewsOf(document);
    for (const preview of edited) {
        preview.edited = false;
        const fragment = fragments.find(f => f.startOffset === preview.start)
            ?? fragments.find(f => f.startOffset < preview.end && f.endOffset > preview.start);
        if (!fragment) {
            list = list.filter(p => p !== preview);
            continue;
        }
        Object.assign(preview, {
            fragment, start: fragment.startOffset, end: fragment.endOffset,
            strips: undefined, size: undefined, failed: undefined,
        });
        todo.push(preview);
    }
    previews.set(document.uri.toString(), list);
    redraw(document);
    await renderAll(document, todo);
}

function redraw(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) redrawEditor(editor);
    }
}

/** Offsets of the selection if there is one, else undefined */
function regionOf(editor: vscode.TextEditor): { start: number; end: number } | undefined {
    const sel = editor.selection;
    if (sel.isEmpty) return undefined;
    return { start: editor.document.offsetAt(sel.start), end: editor.document.offsetAt(sel.end) };
}

/** Offsets of the section around the cursor, or of the region */
function sectionOrRegion(editor: vscode.TextEditor): { start: number; end: number } {
    const region = regionOf(editor);
    if (region) return region;
    const document = editor.document;
    const lines = document.getText().split('\n');
    const { start, end } = sectionLines(lines, editor.selection.active.line);
    return {
        start: document.offsetAt(new vscode.Position(start, 0)),
        end: end >= document.lineCount
            ? document.getText().length
            : document.offsetAt(new vscode.Position(end, 0)),
    };
}

function activeOrgEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isOrg(editor.document)) {
        vscode.window.showWarningMessage('LaTeX previews need an org file');
        return undefined;
    }
    return editor;
}

/** Put the cursor just after a fragment, where it doesn't keep the source showing */
function stepOut(editor: vscode.TextEditor, end: number): void {
    const after = editor.document.positionAt(end);
    editor.selection = new vscode.Selection(after, after);
}

/** Previews overlapping [start, end) */
function previewsIn(document: vscode.TextDocument, start: number, end: number): Preview[] {
    return previewsOf(document).filter(p => p.start < end && p.end > start);
}

/**
 * C-c C-x C-l: at a fragment, toggle its preview. Elsewhere, toggle the
 * previews in the region or the section: remove them if any are shown,
 * else preview its fragments.
 */
async function togglePreview(): Promise<void> {
    const editor = activeOrgEditor();
    if (!editor) return;
    const document = editor.document;

    const region = regionOf(editor);
    const fragment = region ? null : findLatexFragmentAtPosition(document, editor.selection.active);
    if (fragment) {
        const existing = previewsIn(document, fragment.startOffset, fragment.endOffset);
        if (existing.length > 0) {
            clearRange(document, fragment.startOffset, fragment.endOffset);
            vscode.window.setStatusBarMessage('LaTeX preview removed', 3000);
            return;
        }
        stepOut(editor, fragment.endOffset);
        await previewRange(document, fragment.startOffset, fragment.endOffset);
        return;
    }

    const where = region ? 'region' : 'section';
    const { start, end } = sectionOrRegion(editor);
    if (previewsIn(document, start, end).length > 0) {
        const n = clearRange(document, start, end);
        vscode.window.setStatusBarMessage(`LaTeX previews removed from ${where}: ${n}`, 3000);
        return;
    }
    const n = await previewRange(document, start, end);
    vscode.window.setStatusBarMessage(`LaTeX previews in ${where}: ${n}`, 3000);
}

/**
 * A click on a previewed equation shows its source, which stays until the
 * cursor leaves it (a click lands at the equation's edge, where the source
 * would otherwise stay hidden).
 */
function openOnClick(event: vscode.TextEditorSelectionChangeEvent): void {
    if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
    const editor = event.textEditor;
    const sel = editor.selection;
    if (editor.selections.length !== 1 || !sel.isEmpty) return;
    const offset = editor.document.offsetAt(sel.active);
    const clicked = previewsOf(editor.document).find(p => p.strips && offset >= p.start && offset <= p.end);
    if (clicked) clicked.opened = true;
}

/** C-u C-c C-x C-l: remove the previews in the section (or region) */
function clearSection(): void {
    const editor = activeOrgEditor();
    if (!editor) return;
    const section = sectionOrRegion(editor);
    const n = clearRange(editor.document, section.start, section.end);
    vscode.window.setStatusBarMessage(`LaTeX previews removed: ${n}`, 3000);
}

/** C-u C-u C-c C-x C-l: preview every fragment in the file */
async function previewBuffer(): Promise<void> {
    const editor = activeOrgEditor();
    if (!editor) return;
    const n = await previewRange(editor.document, 0, editor.document.getText().length);
    vscode.window.setStatusBarMessage(`LaTeX previews in buffer: ${n}`, 3000);
}

/** C-u C-u C-u C-c C-x C-l: remove every preview in the file */
function clearBuffer(): void {
    const editor = activeOrgEditor();
    if (!editor) return;
    const n = clearRange(editor.document, 0, Number.MAX_SAFE_INTEGER);
    vscode.window.setStatusBarMessage(`LaTeX previews removed from buffer: ${n}`, 3000);
}

/** Render every preview again, e.g. for a new theme or font size */
async function rerenderAll(): Promise<void> {
    for (const document of vscode.workspace.textDocuments) {
        const list = previews.get(document.uri.toString());
        if (list?.length) await renderAll(document, list);
    }
}

/** #+STARTUP: latexpreview (or scimax.latexPreview.startupWithPreview) previews a file when it opens */
function checkStartup(editor: vscode.TextEditor): void {
    const document = editor.document;
    const key = document.uri.toString();
    if (!isOrg(document) || startupChecked.has(key)) return;
    startupChecked.add(key);
    const options = parseStartupOptions(document);
    const byDefault = vscode.workspace.getConfiguration('scimax.latexPreview').get<boolean>('startupWithPreview', false);
    const wanted = options.includes('latexpreview') || (byDefault && !options.includes('nolatexpreview'));
    if (wanted) {
        void previewRange(document, 0, document.getText().length);
    }
}

export function registerLatexOverlays(context: vscode.ExtensionContext): void {
    hideType = vscode.window.createTextEditorDecorationType({
        // As in linkDisplayDecoration: removes the source from layout
        textDecoration: 'none; display: none;',
    });
    imageType = vscode.window.createTextEditorDecorationType({});
    errorType = vscode.window.createTextEditorDecorationType({
        after: { contentText: ' ⚠', color: new vscode.ThemeColor('errorForeground') },
    });

    for (const editor of vscode.window.visibleTextEditors) checkStartup(editor);

    context.subscriptions.push(
        hideType,
        imageType,
        errorType,
        vscode.commands.registerCommand('scimax.org.latexPreview', togglePreview),
        vscode.commands.registerCommand('scimax.org.latexPreviewClearSection', clearSection),
        vscode.commands.registerCommand('scimax.org.latexPreviewBuffer', previewBuffer),
        vscode.commands.registerCommand('scimax.org.latexPreviewClearBuffer', clearBuffer),
        vscode.workspace.onDidChangeTextDocument(event => {
            const key = event.document.uri.toString();
            const list = previews.get(key);
            if (!list?.length || event.contentChanges.length === 0) return;
            const kept = shiftRanges(list, event.contentChanges.map(c => ({
                offset: c.rangeOffset,
                length: c.rangeLength,
                textLength: c.text.length,
            })), p => !!p.showingSource);
            previews.set(key, kept);
            redraw(event.document);
        }),
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (previews.get(event.textEditor.document.uri.toString())?.length) {
                openOnClick(event);
                redrawEditor(event.textEditor);
            }
        }),
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                checkStartup(editor);
                if (previews.get(editor.document.uri.toString())?.length) redrawEditor(editor);
            }
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            previews.delete(document.uri.toString());
            startupChecked.delete(document.uri.toString());
        }),
        vscode.window.onDidChangeActiveColorTheme(() => void rerenderAll()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('editor.fontSize') || event.affectsConfiguration('editor.lineHeight')
                || event.affectsConfiguration('scimax.latexPreview.overlayScale')
                || event.affectsConfiguration('scimax.latexPreview.overlayForeground')) {
                void rerenderAll();
            }
        })
    );
}
