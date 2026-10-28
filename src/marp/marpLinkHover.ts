/**
 * Hover for marp: links in org files: a picture of the deck's first slide and
 * links to edit the deck, open its preview and present it.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marpLinkArgs } from './marpExport';
import { marpRenderOptionsSync } from './marpSettings';
import { firstSlideSvg, isMarpText, slideStarts } from './slideRenderer';

/** Width of the slide picture in the hover, in pixels. */
const PREVIEW_WIDTH = 400;

interface CachedSlide {
    key: string;
    /** Path of the rendered slide's SVG file. */
    image: string;
    slides: number;
}

/** Rendered first slides by deck path, reused until the deck text changes. */
const cache = new Map<string, CachedSlide>();

/**
 * Directory for the rendered slide files, in the extension's storage: hover
 * images must come from a folder VS Code serves, which the temp dir is not.
 */
let imageDir: string | undefined;

/** Set up the slide image directory, removing files from earlier sessions. */
export function initMarpLinkHover(context: vscode.ExtensionContext): void {
    imageDir = path.join(context.globalStorageUri.fsPath, 'marp-hover');
    fs.rmSync(imageDir, { recursive: true, force: true });
    fs.mkdirSync(imageDir, { recursive: true });
}

function commandLink(label: string, command: string, args: unknown[], tooltip: string): string {
    return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify(args))} "${tooltip}")`;
}

/** The deck's text: the open editor's (perhaps unsaved) text, or the file's. */
function deckText(file: string): string {
    const open = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === file);
    return open ? open.getText() : fs.readFileSync(file, 'utf8');
}

function renderedSlide(file: string, text: string): CachedSlide {
    const options = marpRenderOptionsSync({ uri: vscode.Uri.file(file) });
    const key = JSON.stringify([text, options]);
    const cached = cache.get(file);
    if (cached?.key === key) {
        return cached;
    }
    const { svg } = firstSlideSvg(text, path.dirname(file), options);
    // The slide goes in a file rather than a data: URI: slides embed their
    // images, and VS Code truncates hover markdown at 100,000 characters,
    // which cuts the <img> tag off and shows it as text.
    if (!imageDir) {
        throw new Error('initMarpLinkHover has not run');
    }
    const name = crypto.createHash('sha256').update(file).update(key).digest('hex').slice(0, 32);
    const imageFile = path.join(imageDir, `${name}.svg`);
    fs.writeFileSync(imageFile, svg);
    if (cached && cached.image !== imageFile) {
        fs.rmSync(cached.image, { force: true });
    }
    const entry = {
        key,
        image: imageFile,
        slides: slideStarts(text).length,
    };
    cache.set(file, entry);
    return entry;
}

/** Hover for the marp: link under the cursor, or null if there is none. */
export function getMarpLinkHover(
    line: string,
    position: vscode.Position,
    document: vscode.TextDocument
): vscode.Hover | null {
    const linkPattern = /\[\[marp:([^\]]+?)(?:\]\[([^\]]*))?\]\]/g;
    let match;
    while ((match = linkPattern.exec(line)) !== null) {
        const startCol = match.index;
        const endCol = match.index + match[0].length;
        if (position.character < startCol || position.character > endCol) {
            continue;
        }
        const args = marpLinkArgs(match[1], document.uri.fsPath, os.homedir());
        const uri = vscode.Uri.file(args.file);
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;
        markdown.appendMarkdown(`**Marp slides:** ${match[2] || path.basename(args.file)}\n\n`);

        if (!fs.existsSync(args.file)) {
            markdown.appendMarkdown(`*File not found:* \`${args.file}\``);
            return new vscode.Hover(markdown, new vscode.Range(position.line, startCol, position.line, endCol));
        }

        let slides: number | undefined;
        try {
            const text = deckText(args.file);
            if (isMarpText(text)) {
                const slide = renderedSlide(args.file, text);
                slides = slide.slides;
                markdown.appendMarkdown(`<img src="${vscode.Uri.file(slide.image).toString()}" width="${PREVIEW_WIDTH}" />\n\n`);
            } else {
                markdown.appendMarkdown('*Not a Marp deck (no `marp: true` in its front matter)*\n\n');
            }
        } catch {
            markdown.appendMarkdown('*Preview not available*\n\n');
        }

        const actions = [
            commandLink('Edit', 'vscode.open', [uri], 'Open the deck to edit'),
            commandLink('Preview', 'markdown.showPreviewToSide', [uri], 'Open the slide preview'),
            commandLink('Present', 'scimax.marp.present', [args],
                args.slide ? `Present from slide ${args.slide}` : 'Present the slideshow'),
        ];
        const count = slides === undefined ? '' : `${slides} slide${slides === 1 ? '' : 's'} · `;
        markdown.appendMarkdown(count + actions.join(' · '));
        return new vscode.Hover(markdown, new vscode.Range(position.line, startCol, position.line, endCol));
    }
    return null;
}
