/**
 * Running fenced code blocks in Markdown files with Babel (C-c C-c).
 *
 * A fence may carry org header arguments after the language:
 *
 *     ```python :session none :results output
 *
 * Most Markdown code blocks have none, so a Markdown file gets defaults that
 * make it work like a notebook: its Python blocks share one session, so a
 * variable from one block is there in the next.
 */

import { matchCodeFenceOpen } from './markdownFences';
import { findMarkdownResults } from './markdownResults';

export interface MarkdownSourceBlock {
    language: string;
    /** Header arguments after the language, '' when there are none */
    parameters: string;
    code: string;
    /** 0-based line of the opening fence */
    startLine: number;
    /** 0-based line of the closing fence */
    endLine: number;
    codeStartLine: number;
    codeEndLine: number;
    /** Lines of the earlier results (between the results comments), if any */
    resultsLine?: number;
    resultsEndLine?: number;
}

/** The fenced code blocks in a Markdown file's lines, in order. Unclosed fences are skipped. */
export function findMarkdownSourceBlocks(lines: string[]): MarkdownSourceBlock[] {
    const blocks: MarkdownSourceBlock[] = [];
    let i = 0;
    while (i < lines.length) {
        const open = matchCodeFenceOpen(lines[i]);
        if (!open) {
            i++;
            continue;
        }
        const closing = new RegExp(`^${open.fence[0]}{${open.fence.length},}\\s*$`);
        let end = -1;
        for (let j = i + 1; j < lines.length; j++) {
            if (closing.test(lines[j])) {
                end = j;
                break;
            }
        }
        if (end < 0) {
            i++;
            continue;
        }
        const results = findMarkdownResults(lines, end);
        blocks.push({
            language: open.language || 'text',
            parameters: open.parameters ?? '',
            code: lines.slice(i + 1, end).join('\n'),
            startLine: i,
            endLine: end,
            codeStartLine: i + 1,
            codeEndLine: end - 1,
            resultsLine: results?.start,
            resultsEndLine: results?.end,
        });
        i = end + 1;
    }
    return blocks;
}

/** The block whose fences contain 0-based `line`, if any. */
export function markdownSourceBlockAt(lines: string[], line: number): MarkdownSourceBlock | undefined {
    return findMarkdownSourceBlocks(lines).find(block => line >= block.startLine && line <= block.endLine);
}

/**
 * Header arguments a Markdown file's blocks get when they do not set them:
 * one session per file, so the blocks share variables like notebook cells.
 */
export function markdownDefaultHeaders(filePath: string): Record<string, string> {
    return { session: `markdown:${filePath}` };
}

const PYTHON = new Set(['python', 'python3', 'py']);

/**
 * In a Marp deck, a plain Python block (no header arguments) runs in the
 * Python panel, like a ```python run cell: its output would otherwise be
 * written into the deck and show on the slide. A block with header arguments
 * runs with Babel and writes its results.
 */
export function runsInMarpPanel(block: Pick<MarkdownSourceBlock, 'language' | 'parameters'>): boolean {
    return PYTHON.has(block.language.toLowerCase()) && block.parameters.trim() === '';
}
