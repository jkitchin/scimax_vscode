/**
 * Which slide of an org file's Marp export the cursor is on.
 */
import { slideStarts } from './slideRenderer';
import { parseDeck } from './slideModel';

/**
 * 1-based number (counting shown slides only) of the slide that org `line`
 * exports to. The org text up to the end of that line is exported with
 * `exportDeck` (the same exporter as the full deck), so headings, title
 * slides, noexport subtrees and `-----` breaks count exactly as they do in
 * the deck; the last slide of that partial deck is the cursor's.
 */
export function orgSlideNumber(orgText: string, line: number, exportDeck: (org: string) => string): number {
    const lines = orgText.split(/\r?\n/);
    const head = lines.slice(0, Math.max(0, Math.min(line, lines.length - 1)) + 1).join('\n');
    const deck = exportDeck(head);
    const slides = parseDeck(deck, slideStarts(deck)).slides;
    if (slides.length === 0) {
        return 1;
    }
    return slides.slice(0, -1).filter(slide => !slide.hidden).length + 1;
}
