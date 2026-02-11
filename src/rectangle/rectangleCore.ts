/**
 * Rectangle editing core logic — pure functions, no VS Code dependency.
 *
 * A rectangle is a column-aligned region defined by two corner positions.
 * These functions compute the edits needed for each rectangle operation.
 */

export interface RectangleRegion {
    startLine: number;   // inclusive
    endLine: number;     // inclusive
    startCol: number;    // inclusive
    endCol: number;      // exclusive
}

/** One string per line within the rectangle */
export type RectangleText = string[];

/** Describes a single text edit on one line */
export interface EditDescriptor {
    line: number;
    startCol: number;
    endCol: number;
    /** Text to insert (undefined = delete only) */
    text?: string;
}

/**
 * Normalize two corner positions into a RectangleRegion.
 * Handles all four orientations of anchor vs active position.
 */
export function computeRectangle(
    anchorLine: number, anchorCol: number,
    activeLine: number, activeCol: number
): RectangleRegion {
    return {
        startLine: Math.min(anchorLine, activeLine),
        endLine: Math.max(anchorLine, activeLine),
        startCol: Math.min(anchorCol, activeCol),
        endCol: Math.max(anchorCol, activeCol),
    };
}

/**
 * Extract text from the rectangle region.
 * Lines shorter than startCol yield empty strings.
 * Lines shorter than endCol yield partial strings.
 */
export function extractRectangle(
    getLineText: (line: number) => string,
    region: RectangleRegion
): RectangleText {
    const result: string[] = [];
    for (let line = region.startLine; line <= region.endLine; line++) {
        const text = getLineText(line);
        if (text.length <= region.startCol) {
            result.push('');
        } else {
            result.push(text.substring(region.startCol, region.endCol));
        }
    }
    return result;
}

/**
 * Compute edits to delete the rectangle region.
 * Lines shorter than startCol are skipped (no-op).
 */
export function computeDeleteEdits(
    getLineText: (line: number) => string,
    region: RectangleRegion
): EditDescriptor[] {
    const edits: EditDescriptor[] = [];
    for (let line = region.startLine; line <= region.endLine; line++) {
        const text = getLineText(line);
        if (text.length <= region.startCol) {
            continue; // line too short, nothing to delete
        }
        edits.push({
            line,
            startCol: region.startCol,
            endCol: Math.min(region.endCol, text.length),
        });
    }
    return edits;
}

/**
 * Compute edits to clear (replace with spaces) the rectangle region.
 * Lines shorter than startCol are padded with spaces to fill the rectangle.
 */
export function computeClearEdits(
    getLineText: (line: number) => string,
    region: RectangleRegion
): EditDescriptor[] {
    const width = region.endCol - region.startCol;
    const edits: EditDescriptor[] = [];
    for (let line = region.startLine; line <= region.endLine; line++) {
        const text = getLineText(line);
        if (text.length <= region.startCol) {
            // Pad from end of line to endCol with spaces
            const padding = ' '.repeat(region.endCol - text.length);
            edits.push({
                line,
                startCol: text.length,
                endCol: text.length,
                text: padding,
            });
        } else {
            const actualEnd = Math.min(region.endCol, text.length);
            edits.push({
                line,
                startCol: region.startCol,
                endCol: actualEnd,
                text: ' '.repeat(width),
            });
        }
    }
    return edits;
}

/**
 * Compute edits to open (insert blank space for) the rectangle region.
 * Inserts spaces at startCol, pushing existing text right.
 * Lines shorter than startCol are padded to startCol first.
 */
export function computeOpenEdits(
    getLineText: (line: number) => string,
    region: RectangleRegion
): EditDescriptor[] {
    const width = region.endCol - region.startCol;
    const edits: EditDescriptor[] = [];
    for (let line = region.startLine; line <= region.endLine; line++) {
        const text = getLineText(line);
        if (text.length < region.startCol) {
            // Pad to startCol then add rectangle width of spaces
            const padding = ' '.repeat(region.startCol - text.length + width);
            edits.push({
                line,
                startCol: text.length,
                endCol: text.length,
                text: padding,
            });
        } else {
            edits.push({
                line,
                startCol: region.startCol,
                endCol: region.startCol, // insertion, no deletion
                text: ' '.repeat(width),
            });
        }
    }
    return edits;
}

/**
 * Compute edits to insert line numbers along the left edge of the rectangle.
 * Numbers are inserted at startCol, replacing the rectangle content.
 */
export function computeNumberLineEdits(
    getLineText: (line: number) => string,
    region: RectangleRegion,
    startNumber: number = 1,
    format?: string
): EditDescriptor[] {
    const lineCount = region.endLine - region.startLine + 1;
    const maxNumber = startNumber + lineCount - 1;
    const defaultWidth = String(maxNumber).length;
    const edits: EditDescriptor[] = [];

    for (let line = region.startLine; line <= region.endLine; line++) {
        const text = getLineText(line);
        const num = startNumber + (line - region.startLine);
        let numStr: string;
        if (format) {
            numStr = format.replace('%d', String(num));
        } else {
            numStr = String(num).padStart(defaultWidth, ' ') + ' ';
        }

        if (text.length <= region.startCol) {
            // Pad short line then insert number
            const padding = ' '.repeat(region.startCol - text.length);
            edits.push({
                line,
                startCol: text.length,
                endCol: text.length,
                text: padding + numStr,
            });
        } else {
            const actualEnd = Math.min(region.endCol, text.length);
            edits.push({
                line,
                startCol: region.startCol,
                endCol: actualEnd,
                text: numStr,
            });
        }
    }
    return edits;
}

/**
 * Compute edits to replace the rectangle content with a string on each line.
 */
export function computeStringEdits(
    getLineText: (line: number) => string,
    region: RectangleRegion,
    str: string
): EditDescriptor[] {
    const edits: EditDescriptor[] = [];
    for (let line = region.startLine; line <= region.endLine; line++) {
        const text = getLineText(line);
        if (text.length <= region.startCol) {
            // Pad short line to startCol then insert string
            const padding = ' '.repeat(region.startCol - text.length);
            edits.push({
                line,
                startCol: text.length,
                endCol: text.length,
                text: padding + str,
            });
        } else {
            const actualEnd = Math.min(region.endCol, text.length);
            edits.push({
                line,
                startCol: region.startCol,
                endCol: actualEnd,
                text: str,
            });
        }
    }
    return edits;
}

/**
 * Compute edits to yank (insert) a previously killed rectangle at a position.
 * If the document doesn't have enough lines, new lines are appended.
 */
export function computeYankEdits(
    getLineText: (line: number) => string,
    docLineCount: number,
    insertLine: number,
    insertCol: number,
    rectText: RectangleText
): EditDescriptor[] {
    const edits: EditDescriptor[] = [];
    for (let i = 0; i < rectText.length; i++) {
        const line = insertLine + i;
        if (line >= docLineCount) {
            // Need to append new lines
            // Insert at end of last existing line
            const lastLine = docLineCount - 1;
            const lastLineText = getLineText(lastLine);
            const newLinesNeeded = line - docLineCount + 1;
            let prefix = '';
            for (let n = 0; n < newLinesNeeded; n++) {
                prefix += '\n';
            }
            const padding = ' '.repeat(insertCol);
            edits.push({
                line: lastLine,
                startCol: lastLineText.length,
                endCol: lastLineText.length,
                text: prefix + padding + rectText[i],
            });
        } else {
            const text = getLineText(line);
            if (text.length < insertCol) {
                // Pad line to insertCol then insert rectangle text
                const padding = ' '.repeat(insertCol - text.length);
                edits.push({
                    line,
                    startCol: text.length,
                    endCol: text.length,
                    text: padding + rectText[i],
                });
            } else {
                edits.push({
                    line,
                    startCol: insertCol,
                    endCol: insertCol, // insertion, no deletion
                    text: rectText[i],
                });
            }
        }
    }
    return edits;
}
