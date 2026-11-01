/**
 * Hover previews of LaTeX math in Markdown and Quarto files, as in org:
 * `$...$`, `$$...$$` (one line or several), `\(...\)`, `\[...\]` and math
 * environments (`\begin{equation}` ...). Math in fenced code, inline code,
 * front matter or HTML comments is not math. Rendering is the org renderer
 * (latexPreviewProvider), so it follows `scimax.latexPreview.*`.
 */

import * as vscode from 'vscode';
import {
    LatexFragment,
    findLatexFragmentsInLine,
    MATH_ENVIRONMENTS,
    NUMBERED_ENVIRONMENTS,
    createLatexHover,
} from '../org/latexPreviewProvider';
import { markdownNonProseMask } from '../shared/markdownFences';

/** Line start offsets, for lines split on '\n'. */
function lineOffsets(lines: string[]): number[] {
    const offsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        offsets.push(offset);
        offset += line.length + 1;
    }
    return offsets;
}

/** [start, end) columns of inline code spans on a line. */
function codeSpans(line: string): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    const re = /(`+)[\s\S]*?\1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
        spans.push([m.index, m.index + m[0].length]);
    }
    return spans;
}

function fragment(
    text: string,
    offsets: number[],
    startOffset: number,
    endOffset: number,
    open: string,
    close: string,
    env?: string
): LatexFragment {
    const raw = text.slice(startOffset, endOffset);
    const line = lineOf(offsets, startOffset);
    const endLine = lineOf(offsets, endOffset - 1);
    return {
        raw,
        content: env ? raw : raw.slice(open.length, raw.length - close.length),
        type: env ? 'environment' : 'display',
        environment: env,
        numbered: !!env && NUMBERED_ENVIRONMENTS.has(env) && !env.endsWith('*'),
        startCol: startOffset - offsets[line],
        endCol: endOffset - offsets[endLine],
        line,
        startOffset,
        endOffset,
    };
}

function lineOf(offsets: number[], offset: number): number {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
}

/**
 * Math that spans lines, or an environment: `\begin{env}...\end{env}`
 * anywhere in prose, and `$$` / `\[` opening a line and closed on a later
 * one (display math in Markdown has no blank line inside).
 */
function blockMath(text: string, lines: string[], mask: boolean[], offsets: number[]): LatexFragment[] {
    const found: LatexFragment[] = [];
    const envRe = /\\begin\{(\w+\*?)\}[\s\S]*?\\end\{\1\}/g;
    let m: RegExpExecArray | null;
    while ((m = envRe.exec(text)) !== null) {
        if (!MATH_ENVIRONMENTS.has(m[1])) continue;
        const start = lineOf(offsets, m.index);
        const end = lineOf(offsets, m.index + m[0].length - 1);
        if (mask.slice(start, end + 1).some(Boolean)) continue;
        found.push(fragment(text, offsets, m.index, m.index + m[0].length, '', '', m[1]));
    }
    for (let i = 0; i < lines.length; i++) {
        if (mask[i]) continue;
        const open = /^\s*(\$\$|\\\[)/.exec(lines[i]);
        if (!open) continue;
        const close = open[1] === '$$' ? '$$' : '\\]';
        const col = lines[i].indexOf(open[1]);
        if (lines[i].indexOf(close, col + open[1].length) >= 0) continue; // one line
        for (let j = i + 1; j < lines.length && !mask[j] && lines[j].trim() !== ''; j++) {
            const at = lines[j].indexOf(close);
            if (at < 0) continue;
            found.push(fragment(text, offsets, offsets[i] + col, offsets[j] + at + close.length, open[1], close));
            i = j;
            break;
        }
    }
    return found;
}

/** The LaTeX fragment at (line, character) in Markdown text, or null. */
export function findMarkdownMathAt(text: string, line: number, character: number): LatexFragment | null {
    const lines = text.split('\n');
    if (line < 0 || line >= lines.length) return null;
    const mask = markdownNonProseMask(lines);
    if (mask[line]) return null;
    const offsets = lineOffsets(lines);
    const spans = codeSpans(lines[line]);
    if (spans.some(([s, e]) => character >= s && character < e)) return null;
    const hit = findLatexFragmentsInLine(lines[line], line, offsets[line]).find(
        f => character >= f.startCol && character <= f.endCol
            && !spans.some(([s, e]) => f.startCol < e && f.endCol > s)
    );
    if (hit) return hit;
    const offset = offsets[line] + character;
    return blockMath(text, lines, mask, offsets)
        .find(f => offset >= f.startOffset && offset <= f.endOffset) ?? null;
}

class MarkdownMathHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        if (!vscode.workspace.getConfiguration('scimax').get<boolean>('latexPreview.enabled', true)) {
            return null;
        }
        const fragment = findMarkdownMathAt(document.getText(), position.line, position.character);
        if (!fragment) return null;
        // The org equation counter does not know Markdown's code fences, so
        // a number could be wrong; show the math without one.
        return createLatexHover(document, { ...fragment, numbered: false }, position);
    }
}

export function registerMarkdownMathHover(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = [
        { language: 'markdown', scheme: 'file' },
        { language: 'quarto', scheme: 'file' },
    ];
    context.subscriptions.push(vscode.languages.registerHoverProvider(selector, new MarkdownMathHoverProvider()));
}
