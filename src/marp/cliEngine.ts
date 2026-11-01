/**
 * Marp CLI engine (`--engine`) for every Scimax slideshow and export: the
 * citation plugins of the previews (slideCitations.ts), so `[@key]` renders
 * as author-year text with the slide's references at its foot, and, for
 * decks with presenter tools, media/marpPresent/engine.cjs.
 *
 * Marp CLI runs in its own process, so the extension passes what it knows in
 * the environment:
 *
 * - SCIMAX_MARP_DECK: the deck's path, for its `bibliography:` and myst.yml
 * - SCIMAX_MARP_CITATIONS: a JSON file of reference manager entries
 *   ({key: BibEntry}) for keys the deck's own bibliography may not have
 * - SCIMAX_MARP_PRESENTER: "1" to add the presenter engine
 *
 * Pure: no vscode imports.
 */

import * as fs from 'fs';
import * as path from 'path';
import { useSlideCitations } from './slideCitations';
import { setFallbackCitationLookup } from '../markdown/citationPreview';
import { BibEntry } from '../references/bibtexParser';

/* eslint-disable @typescript-eslint/no-explicit-any -- Marp ships no types here */

/** Read the entries file written by the extension; {} if missing or unreadable. */
function readCitationEntries(file: string | undefined): Record<string, BibEntry> {
    if (!file) return {};
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

// An arrow function: Marp CLI takes a function with a prototype for an engine class and calls it with `new`.
const scimaxMarpEngine = ({ marp }: { marp: any }): any => {
    const entries = readCitationEntries(process.env.SCIMAX_MARP_CITATIONS);
    if (Object.keys(entries).length) {
        setFallbackCitationLookup(key => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : undefined));
    }
    const deck = process.env.SCIMAX_MARP_DECK;
    if (deck) {
        // The citation renderers find the deck's bibliography from env.currentDocument, as in the preview.
        marp.markdown.core.ruler.before('normalize', 'scimax_deck_path', (state: any) => {
            if (state.env && !state.env.currentDocument) state.env.currentDocument = { fsPath: deck };
        });
    }
    useSlideCitations(marp.markdown);
    if (process.env.SCIMAX_MARP_PRESENTER === '1') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- a plain .cjs file, found at run time
        require(path.join(__dirname, '..', '..', 'media', 'marpPresent', 'engine.cjs'))({ marp });
    }
    return marp;
};

export = scimaxMarpEngine;
