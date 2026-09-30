/**
 * Slides on the clipboard, with their images. See slideLinks.ts.
 *
 * Copied slides carry absolute paths, so their images still resolve when they
 * are pasted into a deck in another folder. Pasting makes the paths relative to
 * the target deck. When some images live outside the target deck's folder,
 * paste asks whether to copy them next to the deck or link to the originals.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Deck, slidesToText } from './slideModel';
import {
    absolutizeLinks, assetTargets, isInside, numberedName, planAssetCopies, relativizeLinks,
} from './slideLinks';

/** Folder of a deck on disk, or undefined for an untitled or remote document. */
function deckFolder(document: vscode.TextDocument): string | undefined {
    return document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined;
}

/** The last copy made here, so a paste knows which folder the slides came from. */
let lastCopy: { text: string; folder: string } | undefined;

/** The selected slides as clipboard text, with absolute image paths. */
export function copySlidesText(document: vscode.TextDocument, deck: Deck, indices: number[]): string {
    const folder = deckFolder(document);
    const text = folder ? absolutizeLinks(slidesToText(deck, indices), folder) : slidesToText(deck, indices);
    lastCopy = folder ? { text, folder } : undefined;
    return text;
}

function isFile(file: string): boolean {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

function sameContent(a: string, b: string): boolean {
    try {
        return fs.readFileSync(a).equals(fs.readFileSync(b));
    } catch {
        return false;
    }
}

/**
 * Settle destinations: a file already there with the same content is reused;
 * a different one gets a numbered name. Returns the copies still to make.
 */
function settleDestinations(plan: Map<string, string>): Map<string, string> {
    const taken = new Set<string>();
    for (const [source, wanted] of plan) {
        let destination = wanted;
        for (let n = 1; taken.has(destination) || (isFile(destination) && !sameContent(source, destination)); n++) {
            destination = numberedName(wanted, n);
        }
        taken.add(destination);
        plan.set(source, destination);
    }
    return new Map([...plan].filter(([source, destination]) => !isFile(destination) || !sameContent(source, destination)));
}

/**
 * Clipboard text ready to paste into `document`, with paths relative to it,
 * or undefined if the user cancelled. May copy images next to the deck.
 */
export async function preparePaste(clip: string, document: vscode.TextDocument): Promise<string | undefined> {
    const folder = deckFolder(document);
    if (!folder) {
        return clip;
    }
    const sourceFolder = lastCopy?.text === clip ? lastCopy.folder : undefined;
    const outside = assetTargets(clip).filter(file => !isInside(file, folder) && isFile(file));
    if (outside.length === 0 || sourceFolder === folder) {
        return relativizeLinks(clip, folder);
    }

    const plan = planAssetCopies(outside, folder, sourceFolder);
    const shown = (file: string) => path.relative(folder, file).split(path.sep).join('/');
    const images = outside.length === 1 ? '1 image' : `${outside.length} images`;
    const copyItem = {
        label: `$(files) Copy ${images} into this deck's folder`,
        detail: [...plan.values()].map(shown).join(', '),
    };
    const linkItem = {
        label: '$(link) Link to the original images',
        detail: outside.map(shown).join(', '),
    };
    const cancelItem = { label: '$(close) Cancel paste' };
    const choice = await vscode.window.showQuickPick([copyItem, linkItem, cancelItem], {
        title: `The pasted slides show ${images} from outside ${path.basename(folder)}`,
        ignoreFocusOut: true,
    });
    if (choice === linkItem) {
        return relativizeLinks(clip, folder);
    }
    if (choice !== copyItem) {
        return undefined;
    }

    const copies = settleDestinations(plan);
    try {
        for (const [source, destination] of copies) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(destination)));
            await vscode.workspace.fs.copy(vscode.Uri.file(source), vscode.Uri.file(destination), { overwrite: false });
        }
    } catch (error) {
        void vscode.window.showErrorMessage(`Could not copy the images: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
    if (copies.size > 0) {
        vscode.window.setStatusBarMessage(`Copied ${copies.size === 1 ? '1 image' : `${copies.size} images`}`, 3000);
    }
    return relativizeLinks(clip, folder, plan);
}
