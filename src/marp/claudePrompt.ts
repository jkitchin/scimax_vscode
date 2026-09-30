/**
 * The prompt Scimax prefills in Claude Code for "Edit with Claude Code":
 * which deck, which slides and where they are, ending where you type the
 * change. Claude Code reads the file itself, so the slide text is not copied.
 *
 * This module has no VS Code dependency so it can be unit tested directly.
 */

import type { Slide } from './slideModel';

/** Last line of a slide that is not blank (0-based), so ranges do not include trailing blank lines. */
function lastContentLine(lines: string[], slide: Slide): number {
    let end = slide.endLine;
    while (end > slide.startLine && (lines[end] ?? '').trim() === '') {
        end--;
    }
    return end;
}

function joinList(items: string[]): string {
    if (items.length <= 1) {
        return items.join('');
    }
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * @param filePath The deck, as Claude Code should see it (workspace-relative when possible).
 * @param lines The deck's lines.
 * @param slides All slides of the deck (from parseDeck).
 * @param indices The slides to edit (0-based).
 */
export function slideEditPrompt(filePath: string, lines: string[], slides: Slide[], indices: number[]): string {
    const chosen = [...new Set(indices)].filter(i => i >= 0 && i < slides.length).sort((a, b) => a - b);
    const ranges = chosen.map(i => {
        const slide = slides[i];
        return `${slide.startLine + 1}-${lastContentLine(lines, slide) + 1}`;
    });
    const numbers = chosen.map(i => String(i + 1));
    const hidden = chosen.filter(i => slides[i].hidden).map(i => String(i + 1));

    const which = chosen.length === 1
        ? `slide ${numbers[0]} (lines ${ranges[0]})`
        : `slides ${joinList(numbers)} (lines ${joinList(ranges)})`;
    const hiddenNote = hidden.length === 0
        ? ''
        : ` Slide${hidden.length === 1 ? '' : 's'} ${joinList(hidden)} ${hidden.length === 1 ? 'is' : 'are'} hidden `
            + '(inside a <!-- scimax-hidden ... scimax-hidden --> comment, with --> written as -\\->); keep it hidden.';
    return `In the Marp slide deck ${filePath}, edit ${which}. `
        + `Change only ${chosen.length === 1 ? 'that slide' : 'those slides'} and keep the rest of the deck as it is.`
        + `${hiddenNote} Change: `;
}

/**
 * The lines (0-based, inclusive) spanning slides `indices`, from the first
 * slide's first line to the last slide's last non-blank line. Used to select
 * the slides when handing them to an open Claude Code chat as an @-mention.
 * Returns undefined when no index names a slide.
 */
export function slideLineSpan(lines: string[], slides: Slide[], indices: number[]): { start: number; end: number } | undefined {
    const chosen = indices.filter(i => i >= 0 && i < slides.length);
    if (chosen.length === 0) {
        return undefined;
    }
    const first = slides[Math.min(...chosen)];
    const last = slides[Math.max(...chosen)];
    return { start: first.startLine, end: lastContentLine(lines, last) };
}
