/**
 * Heading level changes on raw org or markdown text (a killed or refiled
 * subtree, clipboard contents), where there is no VS Code document.
 */

import { markdownNonProseMask } from './markdownFences';

const MARKDOWN_MAX_LEVEL = 6;

/**
 * Shift every heading in `text` by `delta` levels, keeping each at level 1 or
 * more (and at most 6 for markdown). In markdown, `#` lines inside fenced
 * code, front matter and HTML comments are left alone.
 */
export function shiftHeadingLevels(text: string, delta: number, isOrg: boolean): string {
    if (delta === 0) return text;
    const lines = text.split('\n');
    const skip = isOrg ? undefined : markdownNonProseMask(lines.map(l => l.replace(/\r$/, '')));
    const pattern = isOrg ? /^(\*+)(\s)/ : /^(#{1,6})(\s|$)/;
    const char = isOrg ? '*' : '#';
    return lines.map((line, i) => {
        if (skip?.[i]) return line;
        return line.replace(pattern, (_m, marks: string, space: string) => {
            let level = Math.max(1, marks.length + delta);
            if (!isOrg) level = Math.min(MARKDOWN_MAX_LEVEL, level);
            return char.repeat(level) + space;
        });
    }).join('\n');
}

/**
 * Level of the first heading in `text`, or 0 if it has none.
 */
export function firstHeadingLevel(text: string, isOrg: boolean): number {
    const lines = text.split('\n');
    const skip = isOrg ? undefined : markdownNonProseMask(lines.map(l => l.replace(/\r$/, '')));
    const pattern = isOrg ? /^(\*+)\s/ : /^(#{1,6})(?:\s|$)/;
    for (let i = 0; i < lines.length; i++) {
        if (skip?.[i]) continue;
        const match = lines[i].match(pattern);
        if (match) return match[1].length;
    }
    return 0;
}
