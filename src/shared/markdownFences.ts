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

const DIV_OPEN = /^ {0,3}:{3,}\s*(\{[^}]*\}|[\w-]+)\s*:*\s*$/;
const DIV_CLOSE = /^ {0,3}:{3,}\s*$/;

/**
 * Find Pandoc fenced divs (Quarto callouts, columns, panels; MyST colon
 * fences): `::: {.callout-note}` or `::: warning` up to a bare `:::`.
 * Divs nest, and a bare fence closes the innermost open div. Lines inside
 * fenced code blocks are skipped; unclosed divs are dropped.
 */
export function findFencedDivs(lines: string[], inCodeFence?: boolean[]): FencedBlock[] {
    const mask = inCodeFence ?? markdownFencedLineMask(lines);
    const divs: FencedBlock[] = [];
    const open: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (mask[i]) continue;
        if (DIV_OPEN.test(lines[i])) {
            open.push(i);
        } else if (DIV_CLOSE.test(lines[i]) && open.length > 0) {
            divs.push({ start: open.pop()!, end: i });
        }
    }
    return divs.sort((a, b) => a.start - b.start);
}

export interface CodeFenceOpen {
    fence: string;      // the fence characters (``` or ~~~, possibly longer)
    language: string;   // '' when the fence names no language
    braced: boolean;    // Quarto/Pandoc chunk form: ```{python} or ```{r, echo=FALSE}
}

const PLAIN_CODE_FENCE = /^(`{3,}|~{3,})(\w*)$/;
const BRACED_CODE_FENCE = /^(`{3,}|~{3,})\{[.=]?([\w+-]+)[^}]*\}\s*$/;

/**
 * Match the opening fence of a code block that names its language as a bare
 * word (```python) or in braces as Quarto and Pandoc do (```{python},
 * ```{r, echo=FALSE}, ```{.python}, ```{=html}).
 */
export function matchCodeFenceOpen(line: string): CodeFenceOpen | null {
    const plain = line.match(PLAIN_CODE_FENCE);
    if (plain) {
        return { fence: plain[1], language: plain[2], braced: false };
    }
    const braced = line.match(BRACED_CODE_FENCE);
    if (braced) {
        return { fence: braced[1], language: braced[2], braced: true };
    }
    return null;
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
