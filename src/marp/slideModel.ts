/**
 * A Marp deck as a list of slides that can be copied, moved, hidden and so on,
 * then written back as Markdown.
 *
 * `parseDeck` splits the source at the slide starts Marp reports and also
 * recognizes slides hidden by Scimax, which are wrapped in a comment:
 *
 *     <!-- scimax-hidden
 *     # A hidden slide
 *     scimax-hidden -->
 *
 * Marp does not render the comment, so the slide drops out of the deck (its
 * text becomes a presenter note of the slide before). Inside the comment every
 * `-->` is written as `-\->` so the slide's own comments cannot end it early.
 *
 * `assembleDeck` writes the slides back. A slide that is unchanged and still
 * follows the same slide as before is written exactly as it was, so an edit to
 * one slide never reformats the rest of the file. Other slides are written in
 * a normal form: a separator (the slide's own, or `---`) unless the slide is
 * the first visible one or starts with a heading that `headingDivider` already
 * splits on, then its content.
 *
 * All operations return a new deck and never change the one passed in.
 * This module has no VS Code dependency so it can be unit tested directly.
 */

const FRONT_MATTER_OPEN = /^---\s*$/;
const FRONT_MATTER_CLOSE = /^(---|\.\.\.)\s*$/;
const SLIDE_SEPARATOR = /^ {0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/;
const ATX_HEADING = /^ {0,3}(#{1,6})(\s|$)/;
const HEADING_DIVIDER = /^\s*(?:<!--\s*)?headingDivider\s*:\s*(\[[^\]]*\]|\d)/;
const HIDDEN_OPEN = '<!-- scimax-hidden';
const HIDDEN_CLOSE = 'scimax-hidden -->';

export interface Slide {
    /** Content lines, without the separator or hidden-slide markers. */
    body: string[];
    /** The slide's separator line from the source (`---`, `***`, ...), if it had one. */
    sep: string | null;
    hidden: boolean;
    /** Source lines exactly as parsed. Empty for a new slide. */
    raw: string[];
    /** Position in the parsed deck, or -1 for a new or edited slide. */
    origIndex: number;
    /** Whether this was the first visible slide when parsed. */
    origFirstVisible: boolean;
    /** 0-based source lines spanned when parsed (-1 for a new slide). */
    startLine: number;
    endLine: number;
    /** Line to put the cursor on to edit the slide. */
    contentLine: number;
}

export interface Deck {
    /** Front matter lines, including both fences. */
    preamble: string[];
    slides: Slide[];
    /** Heading levels that start a slide (the `headingDivider` directive). */
    dividerLevels: number[];
    eol: string;
    finalNewline: boolean;
}

/** Result of an operation: the new deck and the slides to select afterwards. */
export interface DeckEdit {
    deck: Deck;
    selection: number[];
}

function isBlank(line: string): boolean {
    return line.trim() === '';
}

function escapeHidden(line: string): string {
    return line.replace(/-->/g, '-\\->');
}

function unescapeHidden(line: string): string {
    return line.replace(/-\\->/g, '-->');
}

/**
 * First line in [from, to] that is not blank and not inside an HTML comment
 * (such as `<!-- _class: lead -->`), or -1 if there is none.
 */
export function firstContentLine(lines: string[], from: number, to: number): number {
    let inComment = false;
    for (let i = from; i <= to; i++) {
        let rest = lines[i].trim();
        if (inComment) {
            const close = rest.indexOf('-->');
            if (close < 0) {
                continue;
            }
            inComment = false;
            rest = rest.slice(close + 3).trim();
        }
        while (rest.startsWith('<!--')) {
            const close = rest.indexOf('-->', 4);
            if (close < 0) {
                inComment = true;
                break;
            }
            rest = rest.slice(close + 3).trim();
        }
        if (!inComment && rest !== '') {
            return i;
        }
    }
    return -1;
}

/** Hidden-slide comments in lines [from, to], as [openLine, closeLine] pairs. */
function findHiddenBlocks(lines: string[], from: number, to: number): Array<[number, number]> {
    const blocks: Array<[number, number]> = [];
    for (let i = from; i <= to; i++) {
        if (lines[i].trim() !== HIDDEN_OPEN) {
            continue;
        }
        let j = i + 1;
        while (j <= to && lines[j].trim() !== HIDDEN_CLOSE) {
            j++;
        }
        if (j > to) {
            break;
        }
        blocks.push([i, j]);
        i = j;
    }
    return blocks;
}

function newSlide(body: string[], hidden = false): Slide {
    return {
        body, sep: null, hidden, raw: [],
        origIndex: -1, origFirstVisible: false, startLine: -1, endLine: -1, contentLine: -1,
    };
}

/** A copy of a slide that will be written in normal form wherever it goes. */
function asNew(slide: Slide): Slide {
    return { ...newSlide([...slide.body], slide.hidden), sep: slide.sep };
}

/**
 * Split `text` into slides.
 *
 * @param starts Slide start lines from Marp (`slideStarts`).
 */
export function parseDeck(text: string, starts: number[]): Deck {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const last = lines.length - 1;

    let bodyStart = 0;
    let preamble: string[] = [];
    if (FRONT_MATTER_OPEN.test(lines[0]) && (starts[0] ?? 0) === 0) {
        let close = 1;
        while (close <= last && !FRONT_MATTER_CLOSE.test(lines[close])) {
            close++;
        }
        if (close <= last) {
            preamble = lines.slice(0, close + 1);
            bodyStart = close + 1;
        }
    }

    const slides: Slide[] = [];
    const chunkStarts = starts.length > 0 ? starts : [0];

    const addVisible = (from: number, to: number, atChunkStart: boolean, chunk: number) => {
        const raw = lines.slice(from, to + 1);
        const slide = newSlide(raw);
        slide.raw = raw;
        slide.startLine = from;
        slide.endLine = to;
        if (atChunkStart && chunk > 0 && SLIDE_SEPARATOR.test(raw[0] ?? '')) {
            slide.sep = raw[0];
            slide.body = raw.slice(1);
        }
        const bodyFrom = from + (slide.sep !== null ? 1 : 0);
        const content = firstContentLine(lines, bodyFrom, to);
        slide.contentLine = content >= 0 ? content : from;
        slides.push(slide);
    };

    const addHidden = (from: number, to: number, open: number, close: number) => {
        const slide = newSlide(lines.slice(open + 1, close).map(unescapeHidden), true);
        slide.raw = lines.slice(from, to + 1);
        slide.startLine = from;
        slide.endLine = to;
        const content = firstContentLine(lines, open + 1, close - 1);
        slide.contentLine = content >= 0 ? content : open;
        slides.push(slide);
    };

    chunkStarts.forEach((start, chunk) => {
        const from = chunk === 0 ? Math.max(start, bodyStart) : start;
        const to = chunk + 1 < chunkStarts.length ? chunkStarts[chunk + 1] - 1 : last;
        if (from > to) {
            // A deck with nothing after its front matter still has one (empty) slide.
            if (chunk === 0) {
                addVisible(from, from - 1, true, chunk);
            }
            return;
        }

        let cur = from;
        for (const [open, close] of findHiddenBlocks(lines, from, to)) {
            // Text before the comment is a visible slide, unless it is only blank lines.
            const before = lines.slice(cur, open);
            let hiddenFrom = cur;
            if (before.some(line => !isBlank(line))) {
                addVisible(cur, open - 1, cur === from, chunk);
                hiddenFrom = open;
            }
            let hiddenTo = close;
            while (hiddenTo + 1 <= to && isBlank(lines[hiddenTo + 1])) {
                hiddenTo++;
            }
            addHidden(hiddenFrom, hiddenTo, open, close);
            cur = hiddenTo + 1;
        }
        if (cur <= to) {
            if (cur === from || lines.slice(cur, to + 1).some(line => !isBlank(line))) {
                addVisible(cur, to, cur === from, chunk);
            } else {
                // Trailing blank lines stay with the hidden slide before them.
                const prev = slides[slides.length - 1];
                prev.raw = prev.raw.concat(lines.slice(cur, to + 1));
                prev.endLine = to;
            }
        }
    });

    let firstVisibleSeen = false;
    slides.forEach((slide, index) => {
        slide.origIndex = index;
        if (!slide.hidden && !firstVisibleSeen) {
            slide.origFirstVisible = true;
            firstVisibleSeen = true;
        }
    });

    return { preamble, slides, dividerLevels: parseHeadingDivider(lines), eol, finalNewline: lines[last] === '' && lines.length > 1 };
}

/**
 * Heading levels from the last `headingDivider` directive, in the front matter
 * or an HTML comment: `2` means levels 1 and 2, `[1, 3]` means exactly those.
 */
function parseHeadingDivider(lines: string[]): number[] {
    let levels: number[] = [];
    for (const line of lines) {
        const match = HEADING_DIVIDER.exec(line);
        if (!match) {
            continue;
        }
        const value = match[1];
        levels = value.startsWith('[')
            ? (value.match(/\d/g) ?? []).map(Number)
            : Array.from({ length: Number(value) }, (_, i) => i + 1);
    }
    return levels.filter(level => level >= 1 && level <= 6);
}

/** True if the slide's first content is a heading `headingDivider` starts a slide at. */
function startsWithDividerHeading(slide: Slide, levels: number[]): boolean {
    if (levels.length === 0) {
        return false;
    }
    const first = firstContentLine(slide.body, 0, slide.body.length - 1);
    const match = first >= 0 ? ATX_HEADING.exec(slide.body[first]) : null;
    return match !== null && levels.includes(match[1].length);
}

export interface AssembleOptions {
    /** Write hidden slides as ordinary slides (to render their thumbnails). */
    revealHidden?: boolean;
}

/** Write the deck back as Markdown. */
export function assembleDeck(deck: Deck, options: AssembleOptions = {}): string {
    const out = [...deck.preamble];
    const ensureBlank = () => {
        if (out.length > 0 && !isBlank(out[out.length - 1])) {
            out.push('');
        }
    };

    let visibleCount = 0;
    let prev: Slide | undefined;
    let prevVerbatim = true;
    for (const slide of deck.slides) {
        const hidden = slide.hidden && !options.revealHidden;
        const firstVisible = !hidden && visibleCount === 0;
        const followsSameSlide = prev ? prev.origIndex >= 0 && prev.origIndex === slide.origIndex - 1 : slide.origIndex === 0;
        const verbatim = slide.origIndex >= 0
            && followsSameSlide
            && hidden === slide.hidden
            && (hidden || firstVisible === slide.origFirstVisible);

        if (verbatim) {
            if (!prevVerbatim && slide.raw.length > 0 && !isBlank(slide.raw[0])) {
                ensureBlank();
            }
            out.push(...slide.raw);
        } else if (hidden) {
            ensureBlank();
            out.push(HIDDEN_OPEN, ...slide.body.map(escapeHidden), HIDDEN_CLOSE);
        } else if (firstVisible) {
            out.push(...slide.body);
        } else if (startsWithDividerHeading(slide, deck.dividerLevels)) {
            ensureBlank();
            out.push(...slide.body);
        } else {
            ensureBlank();
            out.push(slide.sep ?? '---', ...slide.body);
        }

        if (!hidden) {
            visibleCount++;
        }
        prev = slide;
        prevVerbatim = verbatim;
    }

    if (deck.finalNewline && out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
    }
    return out.join(deck.eol);
}

/** Valid, unique slide indices in ascending order. */
export function normalizeSelection(deck: Deck, indices: number[]): number[] {
    return [...new Set(indices)]
        .filter(i => Number.isInteger(i) && i >= 0 && i < deck.slides.length)
        .sort((a, b) => a - b);
}

function withSlides(deck: Deck, slides: Slide[]): Deck {
    return { ...deck, slides };
}

/** The selected slides as Markdown, for the clipboard. */
export function slidesToText(deck: Deck, indices: number[]): string {
    const slides = normalizeSelection(deck, indices).map(i => asNew(deck.slides[i]));
    return assembleDeck({ preamble: [], slides, dividerLevels: [], eol: deck.eol, finalNewline: true });
}

/**
 * Slides parsed from clipboard text. Front matter in the text is dropped;
 * text that is not a deck becomes a single slide.
 *
 * @param starts Slide start lines of `text` from Marp (`slideStarts`).
 */
export function slidesFromText(text: string, starts: number[]): Slide[] {
    if (text.trim() === '') {
        return [];
    }
    const parsed = parseDeck(text.replace(/(\r?\n)+$/, ''), starts);
    return parsed.slides
        .filter(slide => slide.hidden || slide.body.some(line => !isBlank(line)) || slide.sep !== null)
        .map(slide => {
            const copy = asNew(slide);
            // Pasted slides start on the line after their separator, like `---` then a blank line.
            if (copy.body.length === 0 || !isBlank(copy.body[0])) {
                copy.body = ['', ...copy.body];
            }
            return copy;
        });
}

/** Insert slides at `at` (0 = before the first slide). */
export function insertSlides(deck: Deck, at: number, slides: Slide[]): DeckEdit {
    const index = Math.max(0, Math.min(at, deck.slides.length));
    const next = [...deck.slides];
    next.splice(index, 0, ...slides);
    return { deck: withSlides(deck, next), selection: slides.map((_, k) => index + k) };
}

/** A new empty slide. */
export function emptySlide(): Slide {
    return newSlide(['']);
}

export function deleteSlides(deck: Deck, indices: number[]): DeckEdit {
    const selected = new Set(normalizeSelection(deck, indices));
    if (selected.size === 0) {
        return { deck, selection: [] };
    }
    const next = deck.slides.filter((_, i) => !selected.has(i));
    if (next.length === 0) {
        next.push(emptySlide());
    }
    const first = Math.min(...selected);
    return { deck: withSlides(deck, next), selection: [Math.min(first, next.length - 1)] };
}

/** Copies of the selected slides, placed after the last selected one. */
export function duplicateSlides(deck: Deck, indices: number[]): DeckEdit {
    const selected = normalizeSelection(deck, indices);
    if (selected.length === 0) {
        return { deck, selection: [] };
    }
    const copies = selected.map(i => asNew(deck.slides[i]));
    return insertSlides(deck, selected[selected.length - 1] + 1, copies);
}

/**
 * Move each selected slide one place up (-1) or down (+1). Selected slides
 * that are already at the edge, or blocked by a selected slide that cannot
 * move, stay put, so a selection moves as a group.
 */
export function moveSlides(deck: Deck, indices: number[], direction: -1 | 1): DeckEdit {
    const selected = normalizeSelection(deck, indices);
    const next = [...deck.slides];
    const isSelected = new Array(next.length).fill(false);
    selected.forEach(i => (isSelected[i] = true));

    const order = direction < 0 ? selected : [...selected].reverse();
    for (const i of order) {
        const j = i + direction;
        if (j < 0 || j >= next.length || isSelected[j]) {
            continue;
        }
        [next[i], next[j]] = [next[j], next[i]];
        isSelected[i] = false;
        isSelected[j] = true;
    }
    const selection = isSelected.flatMap((value, i) => (value ? [i] : []));
    return { deck: withSlides(deck, next), selection };
}

/**
 * Move the selected slides, as one block in their current order, so they
 * start at position `target` (counted in the deck before the move: 0 is the
 * front, `slides.length` the end). Used for drag and drop.
 */
export function moveSlidesTo(deck: Deck, indices: number[], target: number): DeckEdit {
    const selected = normalizeSelection(deck, indices);
    if (selected.length === 0) {
        return { deck, selection: [] };
    }
    const clamped = Math.max(0, Math.min(target, deck.slides.length));
    const chosen = new Set(selected);
    const rest = deck.slides.filter((_, i) => !chosen.has(i));
    const at = clamped - selected.filter(i => i < clamped).length;
    const next = [...rest];
    next.splice(at, 0, ...selected.map(i => deck.slides[i]));
    return { deck: withSlides(deck, next), selection: selected.map((_, k) => at + k) };
}

export function setHidden(deck: Deck, indices: number[], hidden: boolean): DeckEdit {
    const selected = new Set(normalizeSelection(deck, indices));
    const next = deck.slides.map((slide, i) =>
        selected.has(i) && slide.hidden !== hidden ? { ...asNew(slide), hidden } : slide
    );
    return { deck: withSlides(deck, next), selection: [...selected] };
}

/** Index of the slide containing source `line`, or -1 if there are no slides. */
export function slideAtLine(slides: Slide[], line: number): number {
    for (let i = slides.length - 1; i >= 0; i--) {
        if (slides[i].startLine >= 0 && line >= slides[i].startLine) {
            return i;
        }
    }
    return slides.length > 0 ? 0 : -1;
}
