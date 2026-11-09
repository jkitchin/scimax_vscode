/**
 * Git conflict blocks: find them in a file and work out what each resolution
 * leaves behind. Pure functions over lines, used by smerge mode
 * (smergeMode.ts) and its tests.
 *
 *   <<<<<<< HEAD          start      mine follows
 *   ||||||| base          base       optional (merge.conflictStyle diff3/zdiff3)
 *   =======               separator  theirs follows
 *   >>>>>>> feature       end
 */

export type ConflictSide = 'mine' | 'base' | 'theirs';
export type ConflictChoice = ConflictSide | 'both';

export interface Conflict {
    /** 0-based line numbers of the marker lines */
    start: number;
    base?: number;
    separator: number;
    end: number;
    /** Text after each marker (e.g. HEAD, a branch name or commit) */
    mineLabel: string;
    baseLabel?: string;
    theirsLabel: string;
    mine: string[];
    baseLines?: string[];
    theirs: string[];
}

const START = /^<{7}(?:[ \t](.*))?$/;
const BASE = /^\|{7}(?:[ \t](.*))?$/;
const SEPARATOR = /^={7}[ \t]*$/;
const END = /^>{7}(?:[ \t](.*))?$/;

function stripCr(line: string): string {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** True when the line is one of the four conflict marker lines */
export function isMarkerLine(line: string): boolean {
    const text = stripCr(line);
    return START.test(text) || BASE.test(text) || SEPARATOR.test(text) || END.test(text);
}

/** Quick check before splitting a large file into lines */
export function mayHaveConflicts(text: string): boolean {
    return text.includes('<<<<<<<');
}

/**
 * All complete conflict blocks, in order. A block with a missing marker
 * (e.g. a stray `<<<<<<<` in prose) is skipped.
 */
export function parseConflicts(lines: string[]): Conflict[] {
    const conflicts: Conflict[] = [];
    let i = 0;
    while (i < lines.length) {
        const startMatch = START.exec(stripCr(lines[i]));
        if (!startMatch) {
            i++;
            continue;
        }
        const start = i;
        let base: number | undefined;
        let baseLabel: string | undefined;
        let separator: number | undefined;
        let end: number | undefined;
        let j = i + 1;
        for (; j < lines.length; j++) {
            const text = stripCr(lines[j]);
            if (START.test(text)) break;  // a new block starts; this one is incomplete
            if (separator === undefined) {
                const baseMatch = base === undefined ? BASE.exec(text) : null;
                if (baseMatch) {
                    base = j;
                    baseLabel = (baseMatch[1] ?? '').trim();
                } else if (SEPARATOR.test(text)) {
                    separator = j;
                }
            } else {
                const endMatch = END.exec(text);
                if (endMatch) {
                    end = j;
                    conflicts.push({
                        start,
                        base,
                        separator,
                        end,
                        mineLabel: (startMatch[1] ?? '').trim(),
                        baseLabel,
                        theirsLabel: (endMatch[1] ?? '').trim(),
                        mine: lines.slice(start + 1, base ?? separator),
                        baseLines: base === undefined ? undefined : lines.slice(base + 1, separator),
                        theirs: lines.slice(separator + 1, end),
                    });
                    break;
                }
            }
        }
        i = end !== undefined ? end + 1 : j;
    }
    return conflicts;
}

/** The lines that replace the whole block, or undefined (no base section) */
export function resolveConflict(conflict: Conflict, choice: ConflictChoice): string[] | undefined {
    switch (choice) {
        case 'mine': return conflict.mine;
        case 'theirs': return conflict.theirs;
        case 'both': return [...conflict.mine, ...conflict.theirs];
        case 'base': return conflict.baseLines;
    }
}

/** The conflict whose block contains the line */
export function conflictAt(conflicts: Conflict[], line: number): Conflict | undefined {
    return conflicts.find((c) => c.start <= line && line <= c.end);
}

/** True when the line is a marker line of one of the conflicts */
export function isConflictMarkerAt(conflicts: Conflict[], line: number): boolean {
    const c = conflictAt(conflicts, line);
    return !!c && (line === c.start || line === c.base || line === c.separator || line === c.end);
}

/** The first conflict starting below the line */
export function nextConflict(conflicts: Conflict[], line: number): Conflict | undefined {
    return conflicts.find((c) => c.start > line);
}

/** The last conflict starting above the line */
export function previousConflict(conflicts: Conflict[], line: number): Conflict | undefined {
    for (let k = conflicts.length - 1; k >= 0; k--) {
        if (conflicts[k].start < line) return conflicts[k];
    }
    return undefined;
}

/**
 * The side RET keeps: the side whose marker the cursor is on, or the side it
 * is inside. Undefined on the ======= line, which belongs to neither side.
 */
export function sideAt(conflict: Conflict, line: number): ConflictSide | undefined {
    if (line === conflict.separator) return undefined;
    if (line > conflict.separator) return 'theirs';
    if (conflict.base !== undefined && line >= conflict.base) return 'base';
    return 'mine';
}

/** 1-based position of the conflict at or after the line, for "smerge 2/5" */
export function conflictIndex(conflicts: Conflict[], line: number): number {
    const at = conflicts.findIndex((c) => c.end >= line);
    return at === -1 ? conflicts.length : at + 1;
}

/** Name of a side for messages, with its marker label: "mine (HEAD)" */
export function sideName(conflict: Conflict, side: ConflictChoice): string {
    const label = side === 'mine' ? conflict.mineLabel
        : side === 'theirs' ? conflict.theirsLabel
        : side === 'base' ? conflict.baseLabel
        : '';
    return label ? `${side} (${label})` : side;
}
