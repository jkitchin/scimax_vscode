/**
 * Fenced code block detection for Markdown (CommonMark rules).
 *
 * Lines inside a fenced block are code, so a `# comment` there must not be
 * treated as an ATX heading by folding or visibility cycling.
 */

export interface FencedBlock {
    start: number;  // line of the opening fence
    end: number;    // line of the closing fence, or the last line if unclosed
}

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Find all fenced code blocks (``` or ~~~) in the given lines.
 * A closing fence must use the same character and be at least as long as the
 * opening fence. An unclosed fence runs to the end of the document.
 */
export function findMarkdownFencedBlocks(lines: string[]): FencedBlock[] {
    const blocks: FencedBlock[] = [];
    let i = 0;
    while (i < lines.length) {
        const match = lines[i].match(OPENING_FENCE);
        // A backtick fence's info string may not contain backticks
        if (!match || (match[1][0] === '`' && match[2].includes('`'))) {
            i++;
            continue;
        }
        const fenceChar = match[1][0];
        const closing = new RegExp(`^ {0,3}${fenceChar === '`' ? '`' : '~'}{${match[1].length},}\\s*$`);
        let end = lines.length - 1;
        for (let j = i + 1; j < lines.length; j++) {
            if (closing.test(lines[j])) {
                end = j;
                break;
            }
        }
        blocks.push({ start: i, end });
        i = end + 1;
    }
    return blocks;
}

/**
 * Return a per-line flag that is true for lines that are part of a fenced
 * code block (including the fence lines themselves).
 */
export function markdownFencedLineMask(lines: string[]): boolean[] {
    const mask = new Array<boolean>(lines.length).fill(false);
    for (const block of findMarkdownFencedBlocks(lines)) {
        for (let k = block.start; k <= block.end; k++) {
            mask[k] = true;
        }
    }
    return mask;
}
