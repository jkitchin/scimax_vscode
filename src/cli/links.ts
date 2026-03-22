/**
 * OSC 8 hyperlink support for terminal output.
 *
 * Supported by: iTerm2, macOS Terminal (v3.4+), GNOME Terminal, Kitty,
 * Windows Terminal, and most other modern terminal emulators.
 *
 * Format: ESC ] 8 ; ; URL ST  text  ESC ] 8 ; ; ST
 * where ST (string terminator) = ESC \
 */

/**
 * Terminals known to support OSC 8 hyperlinks.
 * macOS Terminal.app (Apple_Terminal) does NOT support OSC 8 — it ignores
 * the escape sequences and its plain-text URL detection routes clicks to
 * the browser instead of VS Code.
 */
const TERM_PROGRAM = process.env.TERM_PROGRAM ?? '';
const osc8Supported =
    TERM_PROGRAM === 'iTerm.app' ||       // iTerm2
    TERM_PROGRAM === 'WezTerm' ||          // WezTerm
    TERM_PROGRAM === 'Hyper' ||            // Hyper
    process.env.TERM === 'xterm-kitty' || // Kitty
    process.env.VTE_VERSION !== undefined; // GNOME Terminal and other VTE-based

const linksDisabled =
    !osc8Supported ||
    process.env.NO_COLOR !== undefined ||
    process.env.TERM === 'dumb';

const colorsDisabled =
    process.env.NO_COLOR !== undefined ||
    process.env.TERM === 'dumb';

/**
 * Wrap text in an OSC 8 hyperlink.
 * Falls back to plain text when NO_COLOR or TERM=dumb is set.
 */
export function hyperlink(text: string, url: string): string {
    if (linksDisabled) return text;
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/**
 * Return a clickable `vscode://file/` link that opens the file at the given line.
 * The link text shows the full path:line so the target is unambiguous.
 * filePath must be absolute; if not, it is resolved relative to cwd.
 */
export function vscodeLinkAt(filePath: string, lineNumber: number): string {
    const abs = filePath.startsWith('/') ? filePath : require('path').resolve(filePath);
    const label = `${abs}:${lineNumber}`;
    const url = `vscode://file${abs}:${lineNumber}`;
    const linked = hyperlink(label, url);
    if (colorsDisabled) return linked;
    return `\x1b[34m${linked}\x1b[0m`;
}
