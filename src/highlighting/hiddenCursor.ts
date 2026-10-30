/**
 * Keep the cursor out of hidden link text (the "[[target][" and "]]" parts
 * that descriptive link display hides), like Emacs skips invisible text.
 *
 * Hidden characters still occupy buffer columns, so without this the cursor
 * steps through them invisibly: it looks stuck for several key presses and
 * typing lands in the hidden target. No vscode import, so it is unit-testable.
 */

/** A hidden column range on one line, end exclusive */
export interface HiddenRange {
    start: number;
    end: number;
}

/**
 * Where the cursor should go when it moves from `from` to `to` on a line with
 * hidden ranges. `from` is undefined for a jump (a click, or a move from
 * another line); keyboard moves pass the previous column so the cursor keeps
 * going in the same direction. Returns `to` when it isn't inside hidden text.
 *
 * Positions at a hidden range's start and end draw at the same place, so a
 * move that would only cross a hidden range continues one more column to
 * show visible progress.
 */
export function skipHidden(
    hidden: readonly HiddenRange[],
    from: number | undefined,
    to: number,
    lineLength: number
): number {
    const inside = (col: number) => hidden.find(h => h.start < col && col < h.end);
    const dir = from === undefined || from === to ? 0 : to > from ? 1 : -1;

    let col = to;
    let prev = from;
    // A few rounds cover adjacent links, e.g. [[a][b]][[c][d]]
    for (let i = 0; i < 4; i++) {
        const h = inside(col);
        if (!h) return col;
        if (dir > 0) {
            col = prev !== undefined && prev <= h.start ? Math.min(h.end + 1, lineLength) : h.end;
            prev = h.end;
        } else if (dir < 0) {
            col = prev !== undefined && prev >= h.end ? Math.max(h.start - 1, 0) : h.start;
            prev = h.start;
        } else {
            // A jump: the nearer edge
            return col - h.start <= h.end - col ? h.start : h.end;
        }
    }
    return col;
}
