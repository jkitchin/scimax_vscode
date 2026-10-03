/**
 * Line-level records of edits, so they can be undone and redone later even
 * after the files were saved (the project view's undo for Gantt drags).
 *
 * A change says what one line of a file was and became. Line numbers are
 * 0-based and refer to the file after all of a record's changes were made;
 * `before: undefined` marks a line that was inserted.
 */

export interface LineChange {
    file: string;
    line: number;
    before?: string;
    after: string;
}

/** One edit operation on a file, in the file's current line numbers. */
export type LineOp =
    | { kind: 'replace'; line: number; text: string }
    | { kind: 'delete'; line: number }
    | { kind: 'insert'; line: number; text: string };

/**
 * The operations that undo `changes` in a file whose current lines are
 * `lines`, or undefined if any changed line no longer reads as it was left
 * (the file was edited since), in which case nothing should be undone.
 */
export function undoOps(lines: string[], changes: LineChange[]): LineOp[] | undefined {
    const ops: LineOp[] = [];
    for (const c of changes) {
        if (lines[c.line] !== c.after) return undefined;
        ops.push(c.before === undefined ? { kind: 'delete', line: c.line } : { kind: 'replace', line: c.line, text: c.before });
    }
    return ops;
}

/**
 * The operations that redo `changes` in a file whose current lines are
 * `lines` (the file as it was before them), or undefined if the file was
 * edited since. Line numbers are moved back over the inserted lines.
 */
export function redoOps(lines: string[], changes: LineChange[]): LineOp[] | undefined {
    const inserted = changes.filter(c => c.before === undefined).map(c => c.line);
    const ops: LineOp[] = [];
    for (const c of changes) {
        const line = c.line - inserted.filter(i => i < c.line).length;
        if (c.before === undefined) {
            ops.push({ kind: 'insert', line, text: c.after });
        } else {
            if (lines[line] !== c.before) return undefined;
            ops.push({ kind: 'replace', line, text: c.after });
        }
    }
    return ops;
}

