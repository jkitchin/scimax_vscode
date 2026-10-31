/**
 * Where the cursor goes when global visibility cycling (the `c` speed key)
 * folds the line it started on. VS Code leaves the cursor at the end of the
 * visible fold line, where the next `c` is typed instead of run as a speed
 * key. Org puts it on the visible heading that contains the hidden one, at
 * its start. No vscode import, so it is unit-testable.
 */

/** A folding range, as VS Code's folding range providers give it (lines, end inclusive) */
export interface LineRange {
    start: number;
    end: number;
}

/**
 * The line to put the cursor on after folding every range nested
 * `foldedFromDepth` or deeper (1 folds everything, 2 keeps the outermost
 * ranges open, Infinity folds nothing). Returns `home` if it stays visible,
 * else the first line of the outermost folded range that hides it.
 */
export function visibleLineFor(ranges: readonly LineRange[], home: number, foldedFromDepth: number): number {
    // Ranges that hide `home` when folded, outermost first. Ranges are nested
    // or disjoint, so the ones containing a line are ordered by their start.
    const containing = ranges
        .filter(r => r.start < home && home <= r.end)
        .sort((a, b) => a.start - b.start || b.end - a.end);
    const index = foldedFromDepth - 1;
    return index < containing.length ? containing[index].start : home;
}
