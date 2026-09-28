/**
 * Writing Marp decks: slide layouts, front matter settings, per-slide
 * directives and image syntax, for the Marp menu in the editor
 * (src/marp/marpEditorMenu.ts).
 *
 * Everything here works on text and returns new text, so it has no VS Code
 * dependency and can be unit tested directly.
 */

import { BUILTIN_THEMES } from './marpDirectives';
import type { Slide } from './slideModel';

// =============================================================================
// Layouts
// =============================================================================

export type LayoutName =
    | 'title' | 'section' | 'imageRight' | 'imageLeft' | 'fullImage'
    | 'twoColumns' | 'quote' | 'code' | 'table' | 'bigNumber';

export interface LayoutSpec {
    label: string;
    description: string;
    /** Asks for an image file. */
    needsImage?: boolean;
    /** Uses HTML elements, which render only with `scimax.marp.enableHtml`. */
    needsHtml?: boolean;
}

export const LAYOUTS: Record<LayoutName, LayoutSpec> = {
    title: { label: 'Title Slide', description: 'Centered title, subtitle, author and date' },
    section: { label: 'Section Divider', description: 'Centered heading on inverted colors, no page number' },
    imageRight: { label: 'Image Right', description: 'Text on the left, image filling the right 40%', needsImage: true },
    imageLeft: { label: 'Image Left', description: 'Image filling the left 40%, text on the right', needsImage: true },
    fullImage: { label: 'Full Image', description: 'Image covering the whole slide', needsImage: true },
    twoColumns: { label: 'Two Columns', description: 'Two columns of text (needs HTML in slides)', needsHtml: true },
    quote: { label: 'Quote', description: 'A large quotation with its source' },
    code: { label: 'Code', description: 'A heading and a code block' },
    table: { label: 'Table', description: 'A heading and a table' },
    bigNumber: { label: 'Big Number', description: 'One large figure with a caption' },
};

/**
 * Body of a new slide in `layout`, as a VS Code snippet (`${1:placeholder}`
 * tab stops). `image` is the image path for layouts that need one; `date` is
 * today's date for the title slide.
 */
export function layoutSnippet(layout: LayoutName, image = 'image.png', date = ''): string {
    const img = escapeSnippet(image);
    switch (layout) {
        case 'title':
            return [
                '<!-- _class: lead -->',
                '<!-- _paginate: false -->',
                '',
                '# ${1:Title}',
                '',
                '${2:Subtitle}',
                '',
                `\${3:Author} · \${4:${escapeSnippet(date)}}`,
            ].join('\n');
        case 'section':
            return [
                '<!-- _class: lead invert -->',
                '<!-- _paginate: false -->',
                '',
                '# ${1:Section}',
            ].join('\n');
        case 'imageRight':
            return [`![bg right:40%](${img})`, '', '## ${1:Heading}', '', '- ${2:Point}'].join('\n');
        case 'imageLeft':
            return [`![bg left:40%](${img})`, '', '## ${1:Heading}', '', '- ${2:Point}'].join('\n');
        case 'fullImage':
            return [`![bg](${img})`, '', '${1}'].join('\n');
        case 'twoColumns':
            return [
                '<style scoped>',
                '.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; }',
                '</style>',
                '',
                '## ${1:Heading}',
                '',
                '<div class="columns">',
                '<div>',
                '',
                '- ${2:Left point}',
                '',
                '</div>',
                '<div>',
                '',
                '- ${3:Right point}',
                '',
                '</div>',
                '</div>',
            ].join('\n');
        case 'quote':
            return ['<!-- _class: lead -->', '', '> ${1:The quotation.}', '>', '> — ${2:Source}'].join('\n');
        case 'code':
            return ['## ${1:Heading}', '', '```${2:python}', '${3}', '```'].join('\n');
        case 'table':
            return [
                '## ${1:Heading}',
                '',
                '| ${2:Column} | ${3:Column} |',
                '| --- | --- |',
                '| ${4} | ${5} |',
            ].join('\n');
        case 'bigNumber':
            return ['<!-- _class: lead -->', '', '# ${1:42%}', '', '${2:What the number means}'].join('\n');
    }
}

/** Escape text for a VS Code snippet. */
export function escapeSnippet(text: string): string {
    return text.replace(/[\\$}]/g, match => `\\${match}`);
}

// =============================================================================
// Images
// =============================================================================

export type ImagePlacement = 'inline' | 'inlineWidth' | 'bg' | 'bgContain' | 'bgRight' | 'bgLeft';
export type ImageFilter = 'none' | 'grayscale' | 'sepia' | 'blur' | 'opacity';

export const IMAGE_PLACEMENTS: Record<ImagePlacement, string> = {
    inline: 'Inline',
    inlineWidth: 'Inline, with a width',
    bg: 'Background, covering the slide',
    bgContain: 'Background, whole image visible',
    bgRight: 'Background, right 40% of the slide',
    bgLeft: 'Background, left 40% of the slide',
};

/** Marp image syntax, such as `![bg right:40% sepia](figure.png)`. */
export function imageMarkdown(file: string, placement: ImagePlacement, filter: ImageFilter = 'none', width?: number): string {
    const words: string[] = [];
    switch (placement) {
        case 'inlineWidth':
            words.push(`w:${width ?? 400}`);
            break;
        case 'bg':
            words.push('bg');
            break;
        case 'bgContain':
            words.push('bg', 'contain');
            break;
        case 'bgRight':
            words.push('bg', 'right:40%');
            break;
        case 'bgLeft':
            words.push('bg', 'left:40%');
            break;
    }
    if (filter !== 'none') {
        words.push(filter);
    }
    // Spaces in a path would end the URL, so encode them.
    return `![${words.join(' ')}](${file.replace(/ /g, '%20')})`;
}

// =============================================================================
// Front matter
// =============================================================================

/**
 * Marp front matter for a file that has none, as a snippet: theme and page
 * numbers are choices (`${1|a,b|}`), and the cursor ends after the header.
 */
export const MARP_HEADER_SNIPPET = [
    '---',
    'marp: true',
    `theme: \${1|${BUILTIN_THEMES.join(',')}|}`,
    'paginate: ${2|true,false|}',
    '---',
    '',
    '$0',
].join('\n');

const FENCE = /^---\s*$/;
const FENCE_CLOSE = /^(---|\.\.\.)\s*$/;

/** [open, close] line indices of the front matter, or undefined. */
export function frontMatterRange(lines: string[]): [number, number] | undefined {
    if (!FENCE.test(lines[0] ?? '')) {
        return undefined;
    }
    for (let i = 1; i < lines.length; i++) {
        if (FENCE_CLOSE.test(lines[i])) {
            return [0, i];
        }
    }
    return undefined;
}

/** Top-level `key: value` in the front matter, or undefined. */
export function frontMatterValue(lines: string[], key: string): string | undefined {
    const range = frontMatterRange(lines);
    if (!range) {
        return undefined;
    }
    const re = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.*)$`);
    for (let i = range[0] + 1; i < range[1]; i++) {
        const match = re.exec(lines[i]);
        if (match) {
            return unquote(match[1].trim());
        }
    }
    return undefined;
}

/**
 * Set a top-level front matter key (replacing its line, or adding it before
 * the closing fence), or remove it when `value` is undefined. A value that
 * YAML would misread is quoted. Adds a front matter block if there is none.
 */
export function setFrontMatterValue(lines: string[], key: string, value: string | undefined): string[] {
    const out = [...lines];
    let range = frontMatterRange(out);
    if (!range) {
        if (value === undefined) {
            return out;
        }
        out.unshift('---', 'marp: true', '---', '');
        range = [0, 2];
    }
    const re = new RegExp(`^${escapeRegExp(key)}\\s*:`);
    for (let i = range[0] + 1; i < range[1]; i++) {
        if (re.test(out[i])) {
            // A block value (`style: |`) continues on indented lines.
            let end = i + 1;
            while (end < range[1] && /^\s+\S/.test(out[end])) {
                end++;
            }
            if (value === undefined) {
                out.splice(i, end - i);
            } else {
                out.splice(i, end - i, `${key}: ${yamlScalar(value)}`);
            }
            return out;
        }
    }
    if (value !== undefined) {
        out.splice(range[1], 0, `${key}: ${yamlScalar(value)}`);
    }
    return out;
}

/** Quote a YAML scalar if it would otherwise be misread (colons, #, leading symbols...). */
export function yamlScalar(value: string): string {
    if (value === '' || /^[\s]|[\s]$|: |\s#|^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) {
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
}

function unquote(value: string): string {
    const match = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
    return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : value;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Line (0-based) of the front matter's `style: |` block content, adding an
 * empty block if there is none. Returns the new lines and the line to put the
 * cursor on.
 */
export function ensureStyleBlock(lines: string[]): { lines: string[]; cursorLine: number } {
    let out = [...lines];
    if (!frontMatterRange(out)) {
        out = setFrontMatterValue(out, 'marp', 'true');
    }
    const range = frontMatterRange(out)!;
    for (let i = range[0] + 1; i < range[1]; i++) {
        if (/^style\s*:/.test(out[i])) {
            return { lines: out, cursorLine: Math.min(i + 1, range[1] - 1) };
        }
    }
    const at = range[1];
    out.splice(at, 0, 'style: |', '  section {', '    ', '  }');
    return { lines: out, cursorLine: at + 2 };
}

// =============================================================================
// Per-slide directives
// =============================================================================

/**
 * Set a slide's own directive, `<!-- _name: value -->` (this slide only),
 * replacing an existing one-line comment for it in the slide, or adding it at
 * the top of the slide. Removes it when `value` is undefined.
 */
export function setSlideDirective(lines: string[], slide: Slide, name: string, value: string | undefined): string[] {
    const out = [...lines];
    const re = new RegExp(`^\\s*<!--\\s*_${escapeRegExp(name)}\\s*:.*-->\\s*$`);
    const from = slide.startLine >= 0 ? slide.startLine : 0;
    for (let i = from; i <= slide.endLine && i < out.length; i++) {
        if (re.test(out[i])) {
            if (value === undefined) {
                out.splice(i, 1);
            } else {
                out[i] = `<!-- _${name}: ${value} -->`;
            }
            return out;
        }
    }
    if (value === undefined) {
        return out;
    }
    // After the slide's separator (if any) and any blank line following it.
    let at = from + (slide.sep !== null ? 1 : 0);
    while (at <= slide.endLine && at < out.length && out[at].trim() === '') {
        at++;
    }
    out.splice(at, 0, `<!-- _${name}: ${value} -->`);
    return out;
}

/** A slide's own directive value (`<!-- _name: value -->`), or undefined. */
export function slideDirectiveValue(lines: string[], slide: Slide, name: string): string | undefined {
    const re = new RegExp(`^\\s*<!--\\s*_${escapeRegExp(name)}\\s*:\\s*(.*?)\\s*-->\\s*$`);
    for (let i = Math.max(0, slide.startLine); i <= slide.endLine && i < lines.length; i++) {
        const match = re.exec(lines[i]);
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

// =============================================================================
// Themes
// =============================================================================

/** Valid custom theme name: letters, digits and dashes, not a built-in name. */
export function validThemeName(name: string): string | undefined {
    if (!/^[a-z][a-z0-9-]*$/i.test(name)) {
        return 'Use letters, digits and dashes, starting with a letter.';
    }
    if (BUILTIN_THEMES.includes(name.toLowerCase())) {
        return `"${name}" is a built-in theme; choose another name.`;
    }
    return undefined;
}

/** CSS for a new custom theme based on a built-in one. */
export function customThemeCss(name: string, base: string): string {
    return `/* @theme ${name} */

/*
 * A Marp theme based on the built-in "${base}" theme. Change the rules
 * below; anything not set here comes from "${base}". Use it in a deck with
 * \`theme: ${name}\` in the front matter.
 * Theme CSS reference: https://marpit.marp.app/theme-css
 */

@import '${base}';

section {
  /* background: #fff; */
  /* color: #222; */
  /* font-family: 'Helvetica Neue', Arial, sans-serif; */
  /* font-size: 30px; */
  /* padding: 70px; */
}

h1,
h2 {
  /* color: #1a5fb4; */
}

a {
  /* color: #1a5fb4; */
}

/* Title and section slides: <!-- _class: lead --> */
section.lead {
  /* text-align: center; */
}

/* Page numbers (paginate: true) */
section::after {
  /* font-size: 0.6em; */
}

/* header: and footer: directives */
header,
footer {
  /* font-size: 0.6em; */
  /* color: #888; */
}
`;
}
