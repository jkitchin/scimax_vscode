/**
 * Marp directives: what they do, their values, and where the cursor is when
 * writing one (for completion and hover in src/marp/marpDirectiveProvider.ts).
 *
 * Directives go in the front matter or in HTML comments, `<!-- class: lead -->`.
 * Global directives apply to the deck. Local directives apply from their slide
 * on; with a leading underscore (`_class`) only to their own slide.
 *
 * This module has no VS Code dependency so it can be unit tested directly.
 */

export interface DirectiveSpec {
    name: string;
    scope: 'global' | 'local';
    description: string;
    values?: string[];
}

export const BUILTIN_THEMES = ['default', 'gaia', 'uncover'];

const TRANSITIONS = [
    'none', 'clockwise', 'counterclockwise', 'cover', 'coverflow', 'cube', 'cylinder', 'diamond', 'drop',
    'explode', 'fade', 'fade-out', 'fall', 'flip', 'glow', 'implode', 'in-out', 'iris-in', 'iris-out',
    'melt', 'overlap', 'pivot', 'pull', 'push', 'reveal', 'rotate', 'slide', 'star', 'swap', 'swipe',
    'swoosh', 'wipe', 'wiper', 'zoom',
];

export const DIRECTIVES: DirectiveSpec[] = [
    { name: 'marp', scope: 'global', description: 'Turns on Marp for this Markdown file.', values: ['true'] },
    { name: 'theme', scope: 'global', description: 'Theme of the deck. Built in: `default`, `gaia`, `uncover`; custom themes come from `scimax.marp.themes`.', values: BUILTIN_THEMES },
    { name: 'style', scope: 'global', description: 'Extra CSS for the deck, to adjust the theme. Use a YAML block (`style: |`).' },
    { name: 'headingDivider', scope: 'global', description: 'Start a new slide before every heading at this level or above (1 to 6), or at the levels in a list such as `[1, 3]`.', values: ['1', '2', '3', '4', '5', '6'] },
    { name: 'size', scope: 'global', description: 'Slide size preset from the theme, such as `16:9` (default) or `4:3`.', values: ['16:9', '4:3'] },
    { name: 'math', scope: 'global', description: 'Math typesetting library for this deck.', values: ['mathjax', 'katex'] },
    { name: 'lang', scope: 'global', description: 'Language of the deck (the `lang` attribute of the exported HTML), such as `en-US`.' },
    { name: 'title', scope: 'global', description: 'Title of the deck, used by HTML, PDF and PowerPoint exports.' },
    { name: 'author', scope: 'global', description: 'Author of the deck, used by HTML, PDF and PowerPoint exports.' },
    { name: 'description', scope: 'global', description: 'Description of the deck, used by HTML, PDF and PowerPoint exports.' },
    { name: 'keywords', scope: 'global', description: 'Keywords of the deck (comma separated), used by exports.' },
    { name: 'url', scope: 'global', description: 'Canonical URL of the deck, for the exported HTML.' },
    { name: 'image', scope: 'global', description: 'Open Graph image URL for the exported HTML.' },
    { name: 'presenter', scope: 'global', description: 'Scimax presenter tools in the slideshow and HTML export: `a` pen, `l` laser, `n` sticky note, `s` save the deck with ink; ```` ```python run ```` cells run in the browser. `offline` also puts Python and the packages the cells import inside the deck, so they run without internet.', values: ['true', 'offline', 'false'] },
    { name: 'timer', scope: 'global', description: 'Talk timer (with `presenter: true`): a countdown in the corner of every slide and in the presenter view, kept in step between windows. Minutes (`20`), or `20m`, `45:00`, `1h30m`. It starts when you leave the first slide; `t` or a click starts and pauses it, `T` resets it.', values: ['10', '15', '20', '30', '45', '60'] },
    { name: 'paginate', scope: 'local', description: 'Show the page number: `true` or `false`; `hold` shows it without counting the slide, `skip` hides it without counting.', values: ['true', 'false', 'hold', 'skip'] },
    { name: 'header', scope: 'local', description: 'Text at the top of each slide (Markdown allowed).' },
    { name: 'footer', scope: 'local', description: 'Text at the bottom of each slide (Markdown allowed).' },
    { name: 'class', scope: 'local', description: 'CSS class for the slide, such as `lead` (centered title slide) or `invert` (dark colors).', values: ['lead', 'invert'] },
    { name: 'backgroundColor', scope: 'local', description: 'Background color of the slide, such as `#fff` or `aliceblue`.' },
    { name: 'backgroundImage', scope: 'local', description: 'Background image of the slide, as `url(...)` or a CSS gradient.' },
    { name: 'backgroundPosition', scope: 'local', description: 'CSS position of the background image.', values: ['center', 'top', 'bottom', 'left', 'right'] },
    { name: 'backgroundRepeat', scope: 'local', description: 'CSS repeat of the background image.', values: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'] },
    { name: 'backgroundSize', scope: 'local', description: 'CSS size of the background image.', values: ['cover', 'contain', 'auto'] },
    { name: 'color', scope: 'local', description: 'Text color of the slide.' },
    { name: 'transition', scope: 'local', description: 'Transition to the slide in the HTML slideshow, such as `fade` or `push`.', values: TRANSITIONS },
];

const BY_NAME = new Map(DIRECTIVES.map(d => [d.name, d]));

/** The directive named `name`, with or without the one-slide `_` prefix. */
export function findDirective(name: string): DirectiveSpec | undefined {
    const bare = name.startsWith('_') ? name.slice(1) : name;
    const spec = BY_NAME.get(bare);
    // Only local directives take the underscore.
    return spec && (bare === name || spec.scope === 'local') ? spec : undefined;
}

/** Theme names declared by theme CSS files (`/* @theme name *\/`). */
export function themeNames(css: string): string[] {
    return [...css.matchAll(/@theme\s+([\w-]+)/g)].map(match => match[1]);
}

export type DirectiveContext =
    | { kind: 'name'; region: 'frontMatter' | 'comment'; prefix: string }
    | { kind: 'value'; region: 'frontMatter' | 'comment'; directive: string; prefix: string };

/** Lines of the front matter (between the fences), or undefined if there is none. */
function frontMatterEnd(lines: string[]): number | undefined {
    if (!/^---\s*$/.test(lines[0] ?? '')) {
        return undefined;
    }
    for (let i = 1; i < lines.length; i++) {
        if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
            return i;
        }
    }
    return undefined;
}

/**
 * What a directive completion at (line, character) would complete: a
 * directive name or a value, in the front matter or a comment. Undefined
 * outside those places. Only the current line and a few lines above it are
 * examined, so this is cheap on large decks.
 */
export function directiveContext(lines: string[], line: number, character: number): DirectiveContext | undefined {
    const current = lines[line] ?? '';
    const before = current.slice(0, character);

    let region: 'frontMatter' | 'comment' | undefined;
    let text = before;

    const fmEnd = frontMatterEnd(lines);
    if (fmEnd !== undefined && line > 0 && line < fmEnd) {
        region = 'frontMatter';
    } else {
        // Inside a comment: an opening <!-- before the cursor with no --> after it.
        const open = before.lastIndexOf('<!--');
        if (open >= 0 && before.indexOf('-->', open) < 0) {
            region = 'comment';
            text = before.slice(open + 4);
        } else if (before.indexOf('-->') < 0) {
            for (let i = line - 1; i >= Math.max(0, line - 30); i--) {
                const l = lines[i];
                const closeAt = l.lastIndexOf('-->');
                const openAt = l.lastIndexOf('<!--');
                if (closeAt >= 0 && closeAt > openAt) {
                    break;
                }
                if (openAt >= 0) {
                    // Scimax hidden slides are comments too, but hold slides, not directives.
                    if (!l.slice(openAt).startsWith('<!-- scimax-hidden')) {
                        region = 'comment';
                    }
                    break;
                }
            }
        }
    }
    if (!region) {
        return undefined;
    }

    const value = /^\s*(_?[A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(text);
    if (value) {
        return { kind: 'value', region, directive: value[1], prefix: value[2] };
    }
    const name = /^\s*(_?[A-Za-z]*)$/.exec(text);
    if (name) {
        return { kind: 'name', region, prefix: name[1] };
    }
    return undefined;
}

/**
 * The directive name at (line, character), for hover: a `name:` at the start
 * of a front matter line or of a comment's text.
 */
export function directiveAt(lines: string[], line: number, character: number): { name: string; start: number; end: number } | undefined {
    const text = lines[line] ?? '';
    const re = /(^|<!--)\s*(_?[A-Za-z][\w-]*)\s*:/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
        const start = match.index + match[0].indexOf(match[2]);
        const end = start + match[2].length;
        if (character >= start && character <= end) {
            const context = directiveContext(lines, line, start);
            return context ? { name: match[2], start, end } : undefined;
        }
    }
    return undefined;
}
