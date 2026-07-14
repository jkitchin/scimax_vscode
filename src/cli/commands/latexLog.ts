/**
 * Helpers for interpreting LaTeX .log output when a PDF compile fails.
 *
 * Kept dependency-free so it can be unit-tested without loading the full
 * export/parser chain. See GitHub issue #50.
 */

export interface LatexError {
    /** The error message (the text after the leading "! "). */
    message: string;
    /** The .tex line number the error points at, when the log provides one. */
    texLine?: number;
}

/**
 * Parse a LaTeX .log for the first fatal error.
 *
 * TeX writes errors as a line beginning with "! " followed (often several lines
 * later) by an "l.<N> ..." marker giving the .tex line number. Returns the
 * message and that line number when found, or undefined for a clean log.
 */
export function extractFirstLatexError(logContent: string): LatexError | undefined {
    const lines = logContent.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('! ')) {
            const message = lines[i].slice(2).trim();
            let texLine: number | undefined;
            for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
                const m = /^l\.(\d+)\b/.exec(lines[j]);
                if (m) {
                    texLine = parseInt(m[1], 10);
                    break;
                }
            }
            return { message, texLine };
        }
    }
    return undefined;
}
