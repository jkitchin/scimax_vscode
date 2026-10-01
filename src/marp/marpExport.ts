/**
 * Marp CLI export: formats, command-line arguments and error messages.
 *
 * The commands in marpExportCommands.ts run the CLI (and Pandoc); this module
 * only builds their input and arguments and explains failures, so it has no
 * VS Code dependency.
 */

import * as path from 'path';
import { parseDeck } from './slideModel';

/** Formats exported with Marp CLI. (Editable PowerPoint through Pandoc is separate, see below.) */
export type MarpExportFormat =
    | 'pdf' | 'pdfNotes' | 'pptx' | 'pptxEditable' | 'googleSlides' | 'html' | 'images' | 'notes';

interface FormatSpec {
    /** Appended to the deck's base name for the output file. */
    suffix: string;
    args: string[];
    /** Rendered in a browser, so local images need --allow-local-files. */
    usesBrowser: boolean;
    label: string;
}

export const MARP_FORMATS: Record<MarpExportFormat, FormatSpec> = {
    pdf: { suffix: '.pdf', args: ['--pdf', '--pdf-outlines'], usesBrowser: true, label: 'PDF' },
    pdfNotes: { suffix: '-notes.pdf', args: ['--pdf', '--pdf-outlines', '--pdf-notes'], usesBrowser: true, label: 'PDF with notes' },
    pptx: { suffix: '.pptx', args: ['--pptx'], usesBrowser: true, label: 'PowerPoint' },
    pptxEditable: { suffix: '-editable.pptx', args: ['--pptx', '--pptx-editable'], usesBrowser: true, label: 'editable PowerPoint' },
    googleSlides: { suffix: '-editable.pptx', args: ['--pptx', '--pptx-editable'], usesBrowser: true, label: 'PowerPoint for Google Slides' },
    // The format follows from the .html output name. (`--html` means "allow raw HTML".)
    html: { suffix: '.html', args: [], usesBrowser: false, label: 'HTML' },
    // Marp numbers the files: deck.001.png, deck.002.png, ...
    images: { suffix: '.png', args: ['--images', 'png'], usesBrowser: true, label: 'PNG images' },
    notes: { suffix: '-notes.txt', args: ['--notes'], usesBrowser: false, label: 'presenter notes' },
};

/** Exit codes from Marp CLI's CLIError. */
export const EXIT_BROWSER_NOT_FOUND = 2;
export const EXIT_LIBREOFFICE_NOT_FOUND = 5;

export interface MarpArgOptions {
    /** Allow local images and files (only for trusted workspaces). */
    allowLocalFiles?: boolean;
    /** Allow raw HTML in the Markdown (`scimax.marp.enableHtml`). */
    enableHtml?: boolean;
    /** Theme CSS files (`scimax.marp.themes`). */
    themeFiles?: string[];
    /** Browser executable to use instead of the one Marp finds. */
    browserPath?: string;
    /** Marp engine module (`--engine`), e.g. the presenter tools' engine.cjs. */
    engine?: string;
}

/** Output file for a deck, next to it: deck.md -> deck.pdf, deck-editable.pptx, ... */
export function marpOutputPath(inputPath: string, format: MarpExportFormat): string {
    const parsed = path.parse(inputPath);
    return path.join(parsed.dir, parsed.name + MARP_FORMATS[format].suffix);
}

/** Arguments for Marp CLI (after the command itself). */
export function buildMarpArgs(
    inputPath: string,
    outputPath: string,
    format: MarpExportFormat,
    options: MarpArgOptions = {}
): string[] {
    const spec = MARP_FORMATS[format];
    // Without --no-stdin, Marp CLI can wait for Markdown on stdin.
    const args = ['--no-stdin', ...spec.args];
    if (options.enableHtml) {
        args.push('--html');
    }
    if (spec.usesBrowser && options.allowLocalFiles) {
        args.push('--allow-local-files');
    }
    if (spec.usesBrowser && options.browserPath) {
        args.push('--browser-path', options.browserPath);
    }
    if (options.themeFiles && options.themeFiles.length > 0) {
        args.push('--theme-set', ...options.themeFiles);
    }
    if (options.engine) {
        args.push('--engine', options.engine);
    }
    // `--` so a file name starting with "-" is not read as an option.
    args.push('-o', outputPath, '--', inputPath);
    return args;
}

/** The `[ ERROR ]` messages from Marp CLI's output, joined into one line. */
export function marpErrorText(output: string): string {
    const errors: string[][] = [];
    let inError = false;
    for (const line of output.split(/\r?\n/)) {
        const match = /^\[\s*ERROR\s*\]\s*(.*)$/.exec(line);
        if (match) {
            errors.push([match[1].trim()]);
            inError = true;
        } else if (inError && /^\s{4,}\S/.test(line)) {
            // Marp wraps long messages onto indented continuation lines.
            errors[errors.length - 1].push(line.trim());
        } else {
            inError = false;
        }
    }
    return errors.map(parts => parts.join(' ')).join(' ');
}

export type MarpFailure =
    | { kind: 'browser'; message: string }
    | { kind: 'libreoffice'; message: string }
    | { kind: 'other'; message: string };

/** Explain why an export failed, from Marp CLI's exit code and output. */
export function describeMarpFailure(exitCode: number | null, output: string): MarpFailure {
    const error = marpErrorText(output);
    if (exitCode === EXIT_LIBREOFFICE_NOT_FOUND || /soffice binary could not be found/i.test(error)) {
        return {
            kind: 'libreoffice',
            message: 'Editable PowerPoint export needs LibreOffice Impress. Install it from libreoffice.org, '
                + 'or set scimax.marp.libreOfficePath to its soffice program.',
        };
    }
    if (exitCode === EXIT_BROWSER_NOT_FOUND || /no suitable browser|browser could not be found/i.test(error)) {
        return {
            kind: 'browser',
            message: 'Marp needs Google Chrome, Microsoft Edge or Firefox to export PDF, PowerPoint and images. '
                + 'Install one, or set scimax.marp.browserPath.',
        };
    }
    const detail = error || output.trim().split(/\r?\n/).filter(Boolean).pop() || `exit code ${exitCode}`;
    return { kind: 'other', message: `Marp export failed: ${detail}` };
}

/** True if Marp skipped local files because --allow-local-files was not given. */
export function localFilesWereBlocked(output: string): boolean {
    return /blocked by security reason/i.test(output);
}

// =============================================================================
// Editable PowerPoint through Pandoc
// =============================================================================

/** Marp directive names (global and local), from the Marpit and Marp Core docs. */
const MARP_DIRECTIVES = new Set([
    'marp', 'theme', 'style', 'headingDivider', 'lang', 'size', 'math', 'title', 'author',
    'description', 'image', 'keywords', 'url', 'paginate', 'header', 'footer', 'class',
    'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundRepeat',
    'backgroundSize', 'color', 'transition', 'inlineSVG',
]);

/** Marp image keywords in alt text: `![bg left:40% w:300](x.png)`. */
const IMAGE_KEYWORD = /^(bg|left|right|vertical|fit|contain|cover|auto|sepia|grayscale|invert|opacity|saturate|contrast|brightness|blur|drop-shadow|hue-rotate|\d+(\.\d+)?%|(w|h|width|height|left|right|sepia|grayscale|invert|opacity|saturate|contrast|brightness|blur|drop-shadow|hue-rotate):\S*)$/;

/** Alt text without Marp's image keywords, which Pandoc would show as a caption. */
export function cleanImageAlt(alt: string): string {
    return alt.split(/\s+/).filter(word => word !== '' && !IMAGE_KEYWORD.test(word)).join(' ');
}

/** True if a comment's text only sets Marp directives, like `_class: lead`. */
export function isDirectiveComment(body: string): boolean {
    const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return lines.length > 0 && lines.every(line => {
        const match = /^_?([A-Za-z][\w-]*)\s*:/.exec(line);
        return match !== null && MARP_DIRECTIVES.has(match[1]);
    });
}

const IMAGE_LINE = /^\s*(!\[[^\]]*\]\([^)]*\)\s*)+$/;
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;

/**
 * One Marp slide's lines for Pandoc: presenter-note comments become
 * `::: notes` (after the content), directive comments are dropped, and Marp
 * keywords are removed from image alt text. Pandoc's PowerPoint writer moves
 * text that shares a slide with a picture onto a slide of its own, so a slide
 * with both gets two columns: text, and pictures (first for `bg left`).
 * Code blocks are left alone.
 */
function slideForPandoc(body: string[]): string[] {
    const ordered: string[] = [];
    const text: string[] = [];
    const images: string[] = [];
    const notes: string[] = [];
    let imagesLeft = false;
    let fence: string | null = null;

    for (let i = 0; i < body.length; i++) {
        const line = body[i];
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence || fenceMatch) {
            if (fence && fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
                fence = null;
            } else if (!fence && fenceMatch) {
                fence = fenceMatch[1];
            }
            ordered.push(line);
            text.push(line);
            continue;
        }

        if (line.trim().startsWith('<!--')) {
            let end = i;
            while (end < body.length && !body[end].includes('-->')) {
                end++;
            }
            if (end < body.length) {
                const joined = body.slice(i, end + 1).join('\n');
                const close = joined.indexOf('-->');
                const comment = joined.slice(joined.indexOf('<!--') + 4, close);
                const after = joined.slice(close + 3).trim();
                i = end;
                if (after !== '') {
                    // Text after a comment on its line is kept; the comment is dropped.
                    ordered.push(after);
                    text.push(after);
                } else if (!isDirectiveComment(comment) && comment.trim() !== '') {
                    notes.push('', '::: notes', comment.trim(), ':::');
                }
                continue;
            }
        }

        if (IMAGE_LINE.test(line)) {
            const cleaned = line.replace(/!\[([^\]]*)\]\(/g, (_, alt: string) => {
                if (/(^|\s)left(\s|:|$)/.test(alt)) {
                    imagesLeft = true;
                }
                return `![${cleanImageAlt(alt)}](`;
            });
            ordered.push(cleaned);
            images.push(cleaned, '');
            continue;
        }
        ordered.push(line);
        text.push(line);
    }

    const firstText = text.findIndex(line => line.trim() !== '');
    const heading = firstText >= 0 && ATX_HEADING.test(text[firstText]) ? text[firstText] : undefined;
    const rest = heading !== undefined ? text.filter((_, k) => k !== firstText) : text;
    if (images.length === 0 || !rest.some(line => line.trim() !== '')) {
        return [...ordered, ...notes];
    }

    const textColumn = ['::: column', ...trimBlankLines(rest), ':::'];
    const imageColumn = ['::: column', ...trimBlankLines(images), ':::'];
    return [
        ...(heading !== undefined ? [heading, ''] : []),
        ':::: columns',
        ...(imagesLeft ? [...imageColumn, ...textColumn] : [...textColumn, ...imageColumn]),
        '::::',
        ...notes,
    ];
}

/** Runs of blank lines (left where comments were removed) as one, except in code blocks. */
function collapseBlankLines(lines: string[]): string[] {
    const out: string[] = [];
    let fence: string | null = null;
    for (const line of lines) {
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence && fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
            fence = null;
        } else if (!fence && fenceMatch) {
            fence = fenceMatch[1];
        } else if (!fence && line.trim() === '' && out.length > 0 && out[out.length - 1].trim() === '') {
            continue;
        }
        out.push(line);
    }
    return out;
}

function trimBlankLines(lines: string[]): string[] {
    let from = 0;
    let to = lines.length;
    while (from < to && lines[from].trim() === '') {
        from++;
    }
    while (to > from && lines[to - 1].trim() === '') {
        to--;
    }
    return lines.slice(from, to);
}

/**
 * Prepare a Marp deck for Pandoc's PowerPoint writer, to be run with
 * `--slide-level=0` so that only `---` starts a slide. Every visible Marp
 * slide (including those split by `headingDivider`) is written out between
 * `---` lines; hidden slides are left out. The front matter is kept, so a
 * `title:` gives a title slide.
 *
 * @param starts Slide start lines from Marp (`slideStarts`).
 */
export function marpToPandocMarkdown(text: string, starts: number[]): string {
    const deck = parseDeck(text, starts);
    const out = [...deck.preamble];
    deck.slides
        .filter(slide => !slide.hidden)
        .forEach((slide, index) => {
            if (index > 0) {
                out.push('', '---');
            }
            out.push('', ...trimBlankLines(collapseBlankLines(slideForPandoc(slide.body))));
        });
    return out.join('\n') + '\n';
}

/**
 * Pandoc arguments to write `outputPath` as PowerPoint from Markdown on
 * stdin, finding images relative to `resourceDir` (the deck's folder).
 */
export function buildPandocPptxArgs(outputPath: string, resourceDir: string, referenceDoc?: string): string[] {
    const args = ['--from', 'markdown', '--to', 'pptx', '--slide-level=0', '--resource-path', resourceDir, '--output', outputPath];
    if (referenceDoc) {
        args.push('--reference-doc', referenceDoc);
    }
    return args;
}

// =============================================================================
// Slideshow
// =============================================================================

/** How an open slideshow notices that the deck was rebuilt (see liveReloadScript). */
export interface LiveReload {
    /** file: URL of the version script written next to the slideshow */
    url: string;
    /** This build's version */
    version: string;
}

/**
 * A script that reloads the slideshow when the deck is rebuilt. Every second
 * it loads the version script (`reload.url`), which calls
 * `__marpLiveReload(version, slide)`; a version other than this page's
 * reloads it, first moving to `slide` when one is given. A <script> element
 * can load a file: URL where fetch() cannot, so this needs no server.
 */
export function liveReloadScript(reload: LiveReload): string {
    const url = JSON.stringify(reload.url).replace(/</g, '\\u003c');
    const version = JSON.stringify(reload.version).replace(/</g, '\\u003c');
    return '<script>(() => {' +
        `const url = ${url}, mine = ${version};` +
        'window.__marpLiveReload = (version, slide) => {' +
        'if (version === mine) return;' +
        // An absolute URL: '#n' alone would resolve against the <base> (the deck's folder).
        "if (slide) history.replaceState(null, '', location.href.split('#')[0] + '#' + slide);" +
        'location.reload();' +
        '};' +
        'setInterval(() => {' +
        "const s = document.createElement('script');" +
        "s.src = url + '?t=' + Date.now();" +
        's.onload = s.onerror = () => s.remove();' +
        'document.head.appendChild(s);' +
        '}, 1000);' +
        '})();</script>';
}

/** The version script for liveReloadScript: tells the page the current version and slide. */
export function liveReloadVersionScript(version: string, slide?: number): string {
    const at = slide !== undefined && Number.isInteger(slide) && slide > 0 ? `, ${slide}` : '';
    return `window.__marpLiveReload && window.__marpLiveReload(${JSON.stringify(version)}${at});\n`;
}

/**
 * Make Marp's HTML slideshow work from a temporary file: relative images
 * resolve against the deck's folder (`deckFolderUrl`, a file: URL ending in
 * "/"), and the show opens at `startSlide` (1-based) when given. With
 * `reload`, the page also reloads itself when the deck is rebuilt.
 */
export function prepareSlideshowHtml(html: string, deckFolderUrl: string, startSlide?: number, reload?: LiveReload): string {
    const escaped = deckFolderUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    let inject = `<base href="${escaped}">`;
    if (startSlide !== undefined && Number.isInteger(startSlide) && startSlide > 1) {
        // Marp's slideshow shows the slide named by the URL hash. The URL is absolute
        // because a relative '#n' would resolve against the <base> (the deck's folder).
        inject += `<script>if (!location.hash) { history.replaceState(null, '', location.href.split('#')[0] + '#${startSlide}'); }</script>`;
    }
    if (reload) {
        inject += liveReloadScript(reload);
    }
    const head = /<head(\s[^>]*)?>/i.exec(html);
    if (!head) {
        return inject + html;
    }
    const at = head.index + head[0].length;
    return html.slice(0, at) + inject + html.slice(at);
}

/**
 * Parse a `marp:` org link path, `deck.md` or `deck.md::3` (start at slide
 * 3), into the arguments of `scimax.marp.present`. A relative path is taken
 * from the folder of the file containing the link; `~` is the home folder.
 */
export function marpLinkArgs(linkPath: string, linkingFile: string, home: string): { file: string; slide?: number } {
    const match = /^(.*?)::(\d+)$/.exec(linkPath.trim());
    let file = match ? match[1] : linkPath.trim();
    if (file === '~' || file.startsWith('~/')) {
        file = path.join(home, file.slice(1));
    } else if (!path.isAbsolute(file)) {
        file = path.resolve(path.dirname(linkingFile), file);
    }
    return match ? { file, slide: Number(match[2]) } : { file };
}
