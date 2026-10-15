/**
 * Line-level heading test for ad-hoc scanners that walk raw text instead of
 * the parsed AST.
 *
 * A line of stars is a heading only below the inline task level. Lines with
 * `inlinetaskMinLevel` or more stars open or close an inline task (org-inlinetask),
 * which belongs to the enclosing heading and is not a link target of its own.
 */

/** Default org-inlinetask-min-level. */
export const DEFAULT_INLINETASK_MIN_LEVEL = 15;

/** True when `line` is a real heading (not an inline task opening or END line). */
export function isHeadingLine(line: string, inlinetaskMinLevel = DEFAULT_INLINETASK_MIN_LEVEL): boolean {
    const m = line.match(/^(\*+)\s/);
    return !!m && m[1].length < inlinetaskMinLevel;
}
