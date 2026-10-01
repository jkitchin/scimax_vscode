/**
 * The Marp menu in a Marp deck's editor (right-click > Marp): slide
 * operations, new slides from layouts, inserting images and other elements,
 * this slide's directives, deck settings in the front matter, and themes.
 *
 * Commands act on the slide under the cursor, or every slide the selection
 * touches. Text changes come from marpAuthoring.ts and slideModel.ts and are
 * applied as one edit each (deckEdits.ts), so one undo reverses them.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { isMarpText, slideStarts } from './slideRenderer';
import {
    assembleDeck, Deck, DeckEdit, deleteSlides, duplicateSlides, emptySlide, insertSlides,
    moveSlides, parseDeck, setHidden,
} from './slideModel';
import { parseDocument, replaceDocumentText, slidesInSelection } from './deckEdits';
import { marpHtmlEnabled, marpThemeUris } from './marpSettings';
import { BUILTIN_THEMES, themeNames } from './marpDirectives';
import { presenterRequested } from './presenterBundle';
import {
    customThemeCss, ensureStyleBlock, frontMatterRange, frontMatterValue, MARP_HEADER_SNIPPET, IMAGE_PLACEMENTS, ImageFilter, imageMarkdown,
    ImagePlacement, LayoutName, LAYOUTS, layoutSnippet, setFrontMatterValue, setSlideDirective,
    slideDirectiveValue, validThemeName,
} from './marpAuthoring';

const REMOVE = '(remove)';

// =============================================================================
// Helpers
// =============================================================================

/** The active editor, if it holds a Marp deck. */
function deckEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown' || !isMarpText(editor.document.getText())) {
        vscode.window.showInformationMessage('This works in a Marp deck (a Markdown file with marp: true in its front matter).');
        return undefined;
    }
    return editor;
}

function eolOf(text: string): string {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Replace the document's lines with `change(lines)`; undefined leaves it alone. */
async function editLines(editor: vscode.TextEditor, change: (lines: string[], deck: Deck) => string[] | undefined): Promise<boolean> {
    const text = editor.document.getText();
    const eol = eolOf(text);
    const lines = text.split(/\r?\n/);
    const next = change(lines, parseDeck(text, slideStarts(text)));
    if (!next) {
        return false;
    }
    return replaceDocumentText(editor.document, text, next.join(eol));
}

async function applyDeckEdit(editor: vscode.TextEditor, edit: DeckEdit): Promise<boolean> {
    const text = editor.document.getText();
    return replaceDocumentText(editor.document, text, assembleDeck(edit.deck));
}

function setCursor(editor: vscode.TextEditor, line: number, character = 0): void {
    const clamped = Math.max(0, Math.min(line, editor.document.lineCount - 1));
    const position = new vscode.Position(clamped, Math.min(character, editor.document.lineAt(clamped).text.length));
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** Put the cursor on slide `index`'s content line (after re-reading the deck). */
function cursorToSlide(editor: vscode.TextEditor, index: number, blankAfterSeparator = false): void {
    const slide = parseDocument(editor.document).slides[index];
    if (slide) {
        setCursor(editor, blankAfterSeparator ? slide.startLine + (slide.sep !== null ? 1 : 0) : slide.contentLine);
    }
}

/**
 * Insert a block (a snippet) as its own paragraph: on the cursor line if it
 * is blank, else after the current line with a blank line between.
 */
async function insertBlock(editor: vscode.TextEditor, snippet: string): Promise<void> {
    const line = editor.document.lineAt(editor.selection.active.line);
    if (line.isEmptyOrWhitespace) {
        await editor.insertSnippet(new vscode.SnippetString(snippet), line.range);
    } else {
        await editor.insertSnippet(new vscode.SnippetString(`\n\n${snippet}`), line.range.end);
    }
}

/** An image file chosen with the file picker, as a path relative to the deck. */
async function pickImage(document: vscode.TextDocument, title = 'Choose an image'): Promise<string | undefined> {
    const dir = path.dirname(document.uri.fsPath);
    const picked = await vscode.window.showOpenDialog({
        title,
        defaultUri: vscode.Uri.file(dir),
        canSelectMany: false,
        filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp'] },
    });
    if (!picked || picked.length === 0) {
        return undefined;
    }
    return path.relative(dir, picked[0].fsPath).split(path.sep).join('/');
}

/** Quick pick of values, with the current one marked and an option to remove it. */
async function pickValue(title: string, values: string[], current: string | undefined, allowRemove = true): Promise<string | null | undefined> {
    const items: vscode.QuickPickItem[] = values.map(value => ({
        label: value,
        description: value === current ? 'current' : undefined,
    }));
    if (allowRemove && current !== undefined) {
        items.push({ label: REMOVE, description: 'Use the default' });
    }
    const choice = await vscode.window.showQuickPick(items, { title, placeHolder: current ? `Now: ${current}` : undefined });
    if (!choice) {
        return undefined;
    }
    return choice.label === REMOVE ? null : choice.label;
}

// =============================================================================
// Making a deck
// =============================================================================

/**
 * Turn the Markdown file into a Marp deck: add `marp: true` to its front
 * matter, or insert a Marp header (with theme and page number choices) if it
 * has none.
 */
async function insertMarpHeader(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showInformationMessage('Open a Markdown file to make it a Marp deck.');
        return;
    }
    const text = editor.document.getText();
    if (isMarpText(text)) {
        vscode.window.showInformationMessage('This file is already a Marp deck (marp: true is in its front matter).');
        return;
    }
    if (frontMatterRange(text.split(/\r?\n/))) {
        await editLines(editor, lines => setFrontMatterValue(lines, 'marp', 'true'));
        vscode.window.setStatusBarMessage('Added marp: true to the front matter', 4000);
        return;
    }
    await editor.insertSnippet(new vscode.SnippetString(MARP_HEADER_SNIPPET), new vscode.Position(0, 0));
}

// =============================================================================
// Slides
// =============================================================================

async function newSlide(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const deck = parseDocument(editor.document);
    const current = slidesInSelection(editor, deck);
    const at = (current.length > 0 ? current[current.length - 1] : deck.slides.length - 1) + 1;
    if (await applyDeckEdit(editor, insertSlides(deck, at, [emptySlide()]))) {
        cursorToSlide(editor, at, true);
    }
}

/** Start a new slide at the cursor line: everything from there on moves to it. */
async function splitSlide(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const line = editor.selection.active.line;
    await editLines(editor, lines => {
        const out = [...lines];
        const insert = ['---', ''];
        // `---` right after text would underline it as a heading.
        if (line > 0 && out[line - 1].trim() !== '') {
            insert.unshift('');
        }
        out.splice(line, 0, ...insert);
        return out;
    });
}

async function slideOperation(operation: (deck: Deck, indices: number[]) => DeckEdit, cursorOnResult = true): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const deck = parseDocument(editor.document);
    const indices = slidesInSelection(editor, deck);
    if (indices.length === 0) {
        return;
    }
    const edit = operation(deck, indices);
    if (await applyDeckEdit(editor, edit) && cursorOnResult && edit.selection.length > 0) {
        cursorToSlide(editor, edit.selection[0]);
    }
}

// =============================================================================
// Layouts
// =============================================================================

async function insertLayout(layout: LayoutName): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const spec = LAYOUTS[layout];
    let image = 'image.png';
    if (spec.needsImage) {
        const picked = await pickImage(editor.document, `${spec.label}: choose the image`);
        if (!picked) {
            return;
        }
        image = picked;
    }
    if (spec.needsHtml && !(await ensureHtmlEnabled(editor.document))) {
        return;
    }

    const deck = parseDocument(editor.document);
    const current = slidesInSelection(editor, deck);
    const at = (current.length > 0 ? current[current.length - 1] : deck.slides.length - 1) + 1;
    if (!(await applyDeckEdit(editor, insertSlides(deck, at, [emptySlide()])))) {
        return;
    }
    const slide = parseDocument(editor.document).slides[at];
    if (!slide) {
        return;
    }
    // The new slide is a separator and a blank line; fill in the blank line,
    // keeping a blank line after it before the next separator.
    const line = Math.min(slide.startLine + (slide.sep !== null ? 1 : 0), editor.document.lineCount - 1);
    const date = new Date().toISOString().slice(0, 10);
    await editor.insertSnippet(new vscode.SnippetString(`${layoutSnippet(layout, image, date)}\n`), new vscode.Position(line, 0));
}

/** Two columns use HTML: offer to allow HTML in slides if it is off. */
async function ensureHtmlEnabled(document: vscode.TextDocument): Promise<boolean> {
    if (marpHtmlEnabled(document)) {
        return true;
    }
    const choice = await vscode.window.showWarningMessage(
        'Two columns use HTML, which Marp shows only when HTML is allowed in slides (scimax.marp.enableHtml). Allow it?',
        { modal: true },
        'Allow HTML',
        'Insert Anyway'
    );
    if (choice === 'Allow HTML') {
        const target = vscode.workspace.getWorkspaceFolder(document.uri)
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        await vscode.workspace.getConfiguration('scimax.marp').update('enableHtml', true, target);
        return true;
    }
    return choice === 'Insert Anyway';
}

// =============================================================================
// Insert
// =============================================================================

async function insertImage(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const file = await pickImage(editor.document);
    if (!file) {
        return;
    }
    const placement = await vscode.window.showQuickPick(
        (Object.keys(IMAGE_PLACEMENTS) as ImagePlacement[]).map(key => ({ label: IMAGE_PLACEMENTS[key], key })),
        { title: `Place ${path.basename(file)}` }
    );
    if (!placement) {
        return;
    }
    let width: number | undefined;
    if (placement.key === 'inlineWidth') {
        const answer = await vscode.window.showInputBox({
            title: 'Image width in pixels',
            value: '400',
            validateInput: value => /^\d+$/.test(value.trim()) ? undefined : 'A whole number of pixels',
        });
        if (answer === undefined) {
            return;
        }
        width = Number(answer.trim());
    }
    const filters: Array<{ label: string; key: ImageFilter }> = [
        { label: 'No filter', key: 'none' },
        { label: 'Grayscale', key: 'grayscale' },
        { label: 'Sepia', key: 'sepia' },
        { label: 'Blur', key: 'blur' },
        { label: 'Faded (opacity)', key: 'opacity' },
    ];
    const filter = await vscode.window.showQuickPick(filters, { title: 'Image filter' });
    if (!filter) {
        return;
    }
    const markdown = imageMarkdown(file, placement.key, filter.key, width);
    await insertBlock(editor, markdown.replace(/[\\$}]/g, match => `\\${match}`));
}

async function insertFitHeading(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const line = editor.document.lineAt(editor.selection.active.line);
    const heading = /^(#{1,6})\s+(?!<!--\s*fit\s*-->)(.*)$/.exec(line.text);
    if (heading) {
        // Make the heading on this line fit.
        await editor.edit(builder => builder.replace(line.range, `${heading[1]} <!-- fit --> ${heading[2]}`));
        return;
    }
    await insertBlock(editor, '# <!-- fit --> ${1:Title}');
}

async function insertSnippetBlock(snippet: string): Promise<void> {
    const editor = deckEditor();
    if (editor) {
        await insertBlock(editor, snippet);
    }
}

const PYTHON_CELLS = [
    { label: 'Live cell', description: '```python run', detail: 'Editable, with a Run button (Shift+Enter runs it)', flags: 'run' },
    { label: 'Runs when shown', description: '```python run auto', detail: 'Runs by itself the first time its slide is shown', flags: 'run auto' },
    { label: 'Hidden setup', description: '```python run hidden', detail: 'Not shown; runs before the first cell does (imports, data)', flags: 'run hidden' },
];

/**
 * Insert a ```python run cell, which runs in the browser while presenting.
 * Cells need the presenter tools, so this turns them on for the deck too.
 */
async function insertPythonCell(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const kind = await vscode.window.showQuickPick(PYTHON_CELLS, { title: 'Live Python cell (runs in the slideshow)' });
    if (!kind) {
        return;
    }
    if (!presenterRequested(frontMatterValue(editor.document.getText().split(/\r?\n/), 'presenter'))) {
        await editLines(editor, lines => setFrontMatterValue(lines, 'presenter', 'true'));
        vscode.window.setStatusBarMessage('Turned on presenter tools for this deck (presenter: true)', 5000);
    }
    await insertBlock(editor, `\`\`\`python ${kind.flags}\n\${1:print("hello")}\n\`\`\``);
}

// =============================================================================
// This slide
// =============================================================================

/** Set a directive on every slide under the cursor or selection. */
async function setThisSlide(name: string, ask: (current: string | undefined) => Promise<string | null | undefined>): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const deck = parseDocument(editor.document);
    const indices = slidesInSelection(editor, deck);
    if (indices.length === 0) {
        return;
    }
    const lines = editor.document.getText().split(/\r?\n/);
    const answer = await ask(slideDirectiveValue(lines, deck.slides[indices[0]], name));
    if (answer === undefined) {
        return;
    }
    await editLines(editor, (current, parsed) => {
        let out = current;
        let slides = parsed.slides;
        // Later slides first, so the earlier slides' lines do not move.
        for (const index of [...indices].reverse()) {
            out = setSlideDirective(out, slides[index], name, answer === null ? undefined : answer);
            const text = out.join('\n');
            slides = parseDeck(text, slideStarts(text)).slides;
        }
        return out;
    });
}

function askText(title: string, placeHolder: string) {
    return async (current: string | undefined) => {
        const value = await vscode.window.showInputBox({ title, value: current ?? '', placeHolder, prompt: 'Leave empty to remove it' });
        if (value === undefined) {
            return undefined;
        }
        return value.trim() === '' ? null : value.trim();
    };
}

function askChoice(title: string, values: string[]) {
    return (current: string | undefined) => pickValue(title, values, current);
}

async function slideBackgroundImage(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    await setThisSlide('backgroundImage', async current => {
        const picked = await vscode.window.showQuickPick(
            [{ label: 'Choose an image…' }, ...(current !== undefined ? [{ label: REMOVE }] : [])],
            { title: 'Slide background image' }
        );
        if (!picked) {
            return undefined;
        }
        if (picked.label === REMOVE) {
            return null;
        }
        const file = await pickImage(editor.document, 'Slide background image');
        return file ? `url(${file.replace(/ /g, '%20')})` : undefined;
    });
}

async function addScopedStyle(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const deck = parseDocument(editor.document);
    const [index] = slidesInSelection(editor, deck);
    const slide = deck.slides[index ?? 0];
    if (!slide) {
        return;
    }
    const line = slide.contentLine;
    await editor.insertSnippet(
        new vscode.SnippetString('<style scoped>\n${1:h1 { color: #c00; \\}}\n</style>\n\n'),
        new vscode.Position(line, 0)
    );
}

// =============================================================================
// Deck
// =============================================================================

async function setDeck(key: string, ask: (current: string | undefined) => Promise<string | null | undefined>): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const current = frontMatterValue(editor.document.getText().split(/\r?\n/), key);
    const answer = await ask(current);
    if (answer === undefined) {
        return;
    }
    await editLines(editor, lines => setFrontMatterValue(lines, key, answer === null ? undefined : answer));
}

/** Theme names: built in, then the ones in `scimax.marp.themes` files. */
async function allThemes(document: vscode.TextDocument): Promise<Array<{ name: string; file?: vscode.Uri }>> {
    const themes: Array<{ name: string; file?: vscode.Uri }> = BUILTIN_THEMES.map(name => ({ name }));
    for (const uri of marpThemeUris(document)) {
        try {
            const css = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            for (const name of themeNames(css)) {
                themes.push({ name, file: uri });
            }
        } catch {
            // Missing theme file.
        }
    }
    return themes;
}

/** Turn the presenter tools (pen, laser, notes, save with ink, live Python) on or off. */
async function setPresenter(): Promise<void> {
    await setDeck('presenter', async current => {
        const on = presenterRequested(current);
        const choice = await vscode.window.showQuickPick([
            { label: 'On', description: on ? 'current' : undefined, detail: 'Pen, laser, notes and save with ink in the slideshow and HTML export; ```python run cells run', value: 'true' },
            { label: 'Off', description: on ? undefined : 'current', detail: "Marp's plain slideshow", value: null },
        ], { title: 'Presenter tools' });
        return choice === undefined ? undefined : choice.value;
    });
}

async function setTheme(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const current = frontMatterValue(editor.document.getText().split(/\r?\n/), 'theme') ?? 'default';
    const themes = await allThemes(editor.document);
    const items: Array<vscode.QuickPickItem & { theme?: string; create?: boolean }> = [
        ...themes.map(t => ({
            label: t.name,
            theme: t.name,
            description: [t.name === current ? 'current' : '', t.file ? vscode.workspace.asRelativePath(t.file) : 'built in']
                .filter(Boolean).join(' · '),
        })),
        { label: '$(add) New custom theme…', create: true },
    ];
    const choice = await vscode.window.showQuickPick(items, { title: 'Deck theme', placeHolder: `Now: ${current}` });
    if (!choice) {
        return;
    }
    if (choice.create) {
        await newCustomTheme(BUILTIN_THEMES.includes(current) ? current : 'default');
        return;
    }
    await editLines(editor, lines => setFrontMatterValue(lines, 'theme', choice.theme));
}

async function setMetadata(): Promise<void> {
    const fields = [
        { label: 'title', description: 'Title of the deck' },
        { label: 'author', description: 'Author' },
        { label: 'description', description: 'Description' },
        { label: 'keywords', description: 'Keywords, comma separated' },
        { label: 'lang', description: 'Language, such as en-US' },
    ];
    const field = await vscode.window.showQuickPick(fields, { title: 'Deck information (used by exports)' });
    if (field) {
        await setDeck(field.label, askText(`Deck ${field.label}`, field.description));
    }
}

// =============================================================================
// Themes
// =============================================================================

/**
 * Write a new theme CSS file based on a built-in theme, add it to
 * `scimax.marp.themes`, use it in the deck, and open it.
 */
async function newCustomTheme(suggestedBase?: string): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const document = editor.document;
    const name = await vscode.window.showInputBox({
        title: 'New Marp theme: name',
        placeHolder: 'my-theme',
        validateInput: value => validThemeName(value.trim()),
    });
    if (!name) {
        return;
    }
    const base = (await vscode.window.showQuickPick(
        BUILTIN_THEMES.map(theme => ({ label: theme, description: theme === suggestedBase ? 'current theme' : undefined })),
        { title: `New Marp theme "${name.trim()}": start from` }
    ))?.label;
    if (!base) {
        return;
    }

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const root = folder ? folder.uri : vscode.Uri.file(path.dirname(document.uri.fsPath));
    const file = vscode.Uri.joinPath(root, 'themes', `${name.trim()}.css`);
    try {
        await vscode.workspace.fs.stat(file);
        vscode.window.showErrorMessage(`${vscode.workspace.asRelativePath(file)} already exists.`);
        return;
    } catch {
        // Good: it does not exist yet.
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, 'themes'));
    await vscode.workspace.fs.writeFile(file, Buffer.from(customThemeCss(name.trim(), base), 'utf8'));

    // Relative to the workspace folder when there is one (as scimax.marp.themes resolves it).
    const config = vscode.workspace.getConfiguration('scimax.marp', document.uri);
    const entry = folder ? `themes/${name.trim()}.css` : file.fsPath;
    const target = folder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    const inspected = config.inspect<string[]>('themes');
    const existing = (folder ? inspected?.workspaceValue : inspected?.globalValue) ?? [];
    if (!existing.includes(entry)) {
        await config.update('themes', [...existing, entry], target);
    }

    await editLines(editor, lines => setFrontMatterValue(lines, 'theme', name.trim()));
    await vscode.window.showTextDocument(file, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    vscode.window.setStatusBarMessage(`Theme ${name.trim()} created; saving the CSS updates the slides`, 6000);
}

async function editCurrentTheme(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    const current = frontMatterValue(editor.document.getText().split(/\r?\n/), 'theme') ?? 'default';
    const found = (await allThemes(editor.document)).find(t => t.name === current && t.file);
    if (found?.file) {
        await vscode.window.showTextDocument(found.file, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        return;
    }
    if (BUILTIN_THEMES.includes(current)) {
        const choice = await vscode.window.showInformationMessage(
            `"${current}" is a built-in theme and cannot be edited. Make a custom theme based on it?`,
            'New Custom Theme'
        );
        if (choice) {
            await newCustomTheme(current);
        }
        return;
    }
    vscode.window.showWarningMessage(`No theme file declares "${current}". Add its CSS file to scimax.marp.themes.`);
}

async function addStyleBlock(): Promise<void> {
    const editor = deckEditor();
    if (!editor) {
        return;
    }
    let cursorLine = 0;
    await editLines(editor, lines => {
        const result = ensureStyleBlock(lines);
        cursorLine = result.cursorLine;
        return result.lines;
    });
    setCursor(editor, cursorLine, Number.MAX_SAFE_INTEGER);
}

// =============================================================================
// Registration
// =============================================================================

export function registerMarpEditorMenu(context: vscode.ExtensionContext): void {
    const paginateValues = ['true', 'false', 'hold', 'skip'];
    const transitions = ['fade', 'push', 'reveal', 'cover', 'slide', 'wipe', 'zoom', 'none'];
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.marp.insertHeader', insertMarpHeader),
        // Slides
        vscode.commands.registerCommand('scimax.marp.newSlide', newSlide),
        vscode.commands.registerCommand('scimax.marp.splitSlide', splitSlide),
        vscode.commands.registerCommand('scimax.marp.duplicateCurrentSlide', () => slideOperation(duplicateSlides)),
        vscode.commands.registerCommand('scimax.marp.toggleHideCurrentSlide', () =>
            slideOperation((deck, indices) => setHidden(deck, indices, indices.some(i => !deck.slides[i].hidden)), false)
        ),
        vscode.commands.registerCommand('scimax.marp.moveCurrentSlideUp', () => slideOperation((deck, indices) => moveSlides(deck, indices, -1))),
        vscode.commands.registerCommand('scimax.marp.moveCurrentSlideDown', () => slideOperation((deck, indices) => moveSlides(deck, indices, 1))),
        vscode.commands.registerCommand('scimax.marp.deleteCurrentSlide', () => slideOperation(deleteSlides)),
        // Layouts
        vscode.commands.registerCommand('scimax.marp.layout.title', () => insertLayout('title')),
        vscode.commands.registerCommand('scimax.marp.layout.section', () => insertLayout('section')),
        vscode.commands.registerCommand('scimax.marp.layout.imageRight', () => insertLayout('imageRight')),
        vscode.commands.registerCommand('scimax.marp.layout.imageLeft', () => insertLayout('imageLeft')),
        vscode.commands.registerCommand('scimax.marp.layout.fullImage', () => insertLayout('fullImage')),
        vscode.commands.registerCommand('scimax.marp.layout.twoColumns', () => insertLayout('twoColumns')),
        vscode.commands.registerCommand('scimax.marp.layout.quote', () => insertLayout('quote')),
        vscode.commands.registerCommand('scimax.marp.layout.code', () => insertLayout('code')),
        vscode.commands.registerCommand('scimax.marp.layout.table', () => insertLayout('table')),
        vscode.commands.registerCommand('scimax.marp.layout.bigNumber', () => insertLayout('bigNumber')),
        // Insert
        vscode.commands.registerCommand('scimax.marp.insert.image', insertImage),
        vscode.commands.registerCommand('scimax.marp.insert.notes', () => insertSnippetBlock('<!--\n${1:Speaker notes}\n-->')),
        vscode.commands.registerCommand('scimax.marp.insert.fitHeading', insertFitHeading),
        vscode.commands.registerCommand('scimax.marp.insert.math', () => insertSnippetBlock('$$\n${1:E = mc^2}\n$$')),
        vscode.commands.registerCommand('scimax.marp.insert.code', () => insertSnippetBlock('```${1:python}\n${2}\n```')),
        vscode.commands.registerCommand('scimax.marp.insert.pythonCell', insertPythonCell),
        vscode.commands.registerCommand('scimax.marp.insert.table', () =>
            insertSnippetBlock('| ${1:Column} | ${2:Column} | ${3:Column} |\n| --- | --- | --- |\n| ${4} | ${5} | ${6} |')
        ),
        vscode.commands.registerCommand('scimax.marp.insert.buildList', () =>
            insertSnippetBlock('* ${1:First point}\n* ${2:Second point}\n* ${3:Third point}')
        ),
        // This slide
        vscode.commands.registerCommand('scimax.marp.thisSlide.class', () => setThisSlide('class', askChoice('Slide class', ['lead', 'invert', 'lead invert']))),
        vscode.commands.registerCommand('scimax.marp.thisSlide.backgroundColor', () => setThisSlide('backgroundColor', askText('Slide background color', '#1a5fb4, aliceblue, ...'))),
        vscode.commands.registerCommand('scimax.marp.thisSlide.backgroundImage', slideBackgroundImage),
        vscode.commands.registerCommand('scimax.marp.thisSlide.color', () => setThisSlide('color', askText('Slide text color', '#fff, black, ...'))),
        vscode.commands.registerCommand('scimax.marp.thisSlide.header', () => setThisSlide('header', askText('Slide header', 'Text at the top of this slide'))),
        vscode.commands.registerCommand('scimax.marp.thisSlide.footer', () => setThisSlide('footer', askText('Slide footer', 'Text at the bottom of this slide'))),
        vscode.commands.registerCommand('scimax.marp.thisSlide.paginate', () => setThisSlide('paginate', askChoice('Page number on this slide', paginateValues))),
        vscode.commands.registerCommand('scimax.marp.thisSlide.transition', () => setThisSlide('transition', askChoice('Transition to this slide (HTML slideshow)', transitions))),
        vscode.commands.registerCommand('scimax.marp.thisSlide.scopedStyle', addScopedStyle),
        // Deck
        vscode.commands.registerCommand('scimax.marp.deck.theme', setTheme),
        vscode.commands.registerCommand('scimax.marp.deck.size', () => setDeck('size', askChoice('Slide size', ['16:9', '4:3']))),
        vscode.commands.registerCommand('scimax.marp.deck.paginate', () => setDeck('paginate', askChoice('Page numbers', ['true', 'false']))),
        vscode.commands.registerCommand('scimax.marp.deck.header', () => setDeck('header', askText('Header on every slide', 'Text at the top of each slide'))),
        vscode.commands.registerCommand('scimax.marp.deck.footer', () => setDeck('footer', askText('Footer on every slide', 'Text at the bottom of each slide'))),
        vscode.commands.registerCommand('scimax.marp.deck.headingDivider', () =>
            setDeck('headingDivider', askChoice('New slide before headings at level (and above)', ['1', '2', '3', '4', '5', '6']))
        ),
        vscode.commands.registerCommand('scimax.marp.deck.math', () => setDeck('math', askChoice('Math typesetting', ['mathjax', 'katex']))),
        vscode.commands.registerCommand('scimax.marp.deck.metadata', setMetadata),
        vscode.commands.registerCommand('scimax.marp.deck.presenter', setPresenter),
        // Themes
        vscode.commands.registerCommand('scimax.marp.theme.new', () => newCustomTheme()),
        vscode.commands.registerCommand('scimax.marp.theme.edit', editCurrentTheme),
        vscode.commands.registerCommand('scimax.marp.theme.styleBlock', addStyleBlock)
    );
}
