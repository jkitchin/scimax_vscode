/**
 * MyST Markdown in VS Code's built-in Markdown preview.
 *
 * Jupyter Book / MyST notes use directives (```{figure} ...```, :::{admonition})
 * and roles ({ref}`target`) that plain markdown-it shows as code blocks or
 * literal text. This markdown-it plugin, contributed through
 * `markdown.markdownItPlugins`, renders the common ones and gives every other
 * directive a labelled box, so a MyST file reads in the preview roughly as it
 * will in the built book.
 *
 * It is a preview aid, not a MyST implementation: roles such as {ref} are
 * shown as their text rather than resolved, empty `[](#label)` links take the
 * title of a target in the same file (the label itself otherwise), and index
 * entries are hidden.
 */

import {
    bibliographyPaths, CitationMode, frontMatterBibliography, parseCitationItems, renderCitation,
} from './citationPreview';

/* eslint-disable @typescript-eslint/no-explicit-any -- markdown-it ships no types here */
type MarkdownIt = any;
type Token = any;

export interface MystPreviewOptions {
    /** Checked on every parse, so the setting takes effect on preview refresh. */
    isEnabled?: () => boolean;
}

/** Admonition directives; each renders as a titled callout. */
const ADMONITIONS = new Set([
    'admonition', 'note', 'tip', 'hint', 'important', 'seealso', 'warning',
    'caution', 'attention', 'danger', 'error', 'todo', 'versionadded',
    'versionchanged', 'deprecated',
]);

/** Directives whose body is code rather than Markdown. */
const CODE_DIRECTIVES = new Set([
    'code', 'code-block', 'code-cell', 'sourcecode', 'eval-rst', 'raw', 'literalinclude',
]);

/** Directives with no visible output in a built book. */
const HIDDEN_DIRECTIVES = new Set(['index', 'tableofcontents', 'toctree', 'bibliography']);

/** Directives that are containers for Markdown with no title bar of their own. */
const PLAIN_CONTAINERS = new Set(['margin', 'sidebar', 'div', 'container', 'card', 'epigraph', 'topic']);

const OPEN_FENCE = /^(`{3,}|~{3,}|:{3,})\{([\w:.+-]+)\}[ \t]*(.*)$/;
const OPTION_LINE = /^:([\w-]+):[ \t]*(.*)$/;
const EQUATION_LABEL = /\$\$\s*\(([\w:.-]+)\)\s*$/;
/** Roles that point at a labelled section, figure or directive. */
const REF_ROLES = new Set(['ref', 'numref', 'prf:ref', 'doc']);
/** MyST {cite:...} role suffix to citation style. */
const CITE_MODES: Record<string, CitationMode> = {
    cite: 'p', 'cite:p': 'p', 'cite:ps': 'p', 'cite:t': 't', 'cite:ts': 't',
    'cite:alp': 'alp', 'cite:alps': 'alp', 'cite:author': 'author', 'cite:year': 'year',
};
const TARGET_LINE = /^\(([\w:.-]+)\)=\s*$/;
const CSS_LENGTH =/^\d+(\.\d+)?(px|%|em|rem|vw|pt|cm|mm|in)?$/;

interface Directive {
    name: string;
    arg: string;
    options: Record<string, string>;
}

/**
 * The highlighter's language for a code-cell argument, which is often a
 * Jupyter kernel name (`ipython3`, `ir`, `julia-1.10`) rather than a language.
 */
function highlightLanguage(arg: string): string {
    const lang = arg.trim().split(/\s+/)[0] || '';
    if (/^i?python\d*$/i.test(lang)) {
        return 'python';
    }
    if (/^julia-[\d.]+$/i.test(lang)) {
        return 'julia';
    }
    return lang.toLowerCase() === 'ir' ? 'r' : lang;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1).replace(/-/g, ' ');
}

/** Split "display text <target>" as used by {ref}, {doc}, {term}, ... */
function roleDisplay(content: string): { text: string; target: string } {
    const m = /^([\s\S]*?)\s*<([^<>]+)>\s*$/.exec(content);
    if (m && m[1]) {
        return { text: m[1], target: m[2] };
    }
    const target = m ? m[2] : content;
    return { text: target, target };
}

function safeClasses(value: string | undefined): string[] {
    return (value || '').split(/\s+/).filter(c => /^[\w-]+$/.test(c));
}

function lineAttrs(token: Token): string {
    return token.map ? ` data-line="${token.map[0]}"` : '';
}

export function mystPreviewPlugin(md: MarkdownIt, options: MystPreviewOptions = {}): void {
    const enabled = () => !options.isEnabled || options.isEnabled();
    const escape: (s: string) => string = md.utils.escapeHtml;

    function lineText(state: any, line: number): string {
        return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    }

    /**
     * Read ":key: value" option lines (or a --- YAML block of key: value pairs)
     * at the top of a directive body. Returns the first line after them.
     */
    function readOptions(state: any, from: number, to: number, into: Record<string, string>): number {
        let line = from;
        if (line < to && lineText(state, line).trim() === '---') {
            for (line++; line < to; line++) {
                const text = lineText(state, line);
                if (text.trim() === '---') {
                    return line + 1;
                }
                const m = /^([\w-]+):\s*(.*)$/.exec(text);
                if (m) {
                    into[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
                }
            }
            return line;
        }
        for (; line < to; line++) {
            const m = OPTION_LINE.exec(lineText(state, line));
            if (!m) {
                break;
            }
            into[m[1]] = m[2];
        }
        return line;
    }

    /** Parse lines [from, to) as nested Markdown blocks. */
    function tokenizeBody(state: any, from: number, to: number, indent: number): void {
        const oldParent = state.parentType;
        const oldLineMax = state.lineMax;
        const oldIndent = state.blkIndent;
        state.parentType = 'myst_directive';
        state.lineMax = to;
        state.blkIndent = indent;
        state.md.block.tokenize(state, from, to);
        state.parentType = oldParent;
        state.lineMax = oldLineMax;
        state.blkIndent = oldIndent;
    }

    function bodyText(state: any, from: number, to: number, indent: number): string {
        return from < to ? state.getLines(from, to, indent, true) : '';
    }

    function directiveRule(state: any, startLine: number, endLine: number, silent: boolean): boolean {
        if (state.sCount[startLine] - state.blkIndent >= 4 || !enabled()) {
            return false;
        }
        const open = OPEN_FENCE.exec(lineText(state, startLine));
        if (!open) {
            return false;
        }
        if (silent) {
            return true;
        }
        const [, fence, rawName, arg] = open;
        const closeFence = new RegExp(`^\\${fence[0]}{${fence.length},}\\s*$`);
        const indent = state.sCount[startLine];

        // Like a code fence: the first line of at least as many markers closes
        // it, and an unclosed directive runs to the end of its container.
        let close = startLine + 1;
        let closed = false;
        for (; close < endLine; close++) {
            const text = lineText(state, close);
            if (text && state.sCount[close] < indent) {
                break;
            }
            if (state.sCount[close] - indent < 4 && closeFence.test(text)) {
                closed = true;
                break;
            }
        }

        const directive: Directive = { name: rawName.toLowerCase(), arg: arg.trim(), options: {} };
        const bodyStart = readOptions(state, startLine + 1, close, directive.options);
        const map = [startLine, closed ? close + 1 : close];
        state.line = map[1];

        const { name } = directive;
        if (HIDDEN_DIRECTIVES.has(name)) {
            return true;
        }

        if (CODE_DIRECTIVES.has(name) || name === 'math') {
            const token = state.push(name === 'math' ? 'myst_math' : 'fence', name === 'math' ? 'div' : 'code', 0);
            token.info = name === 'math' ? '' : highlightLanguage(directive.arg);
            token.content = bodyText(state, bodyStart, close, indent);
            token.markup = fence;
            token.map = map;
            token.meta = directive;
            return true;
        }

        const openToken = state.push('myst_directive_open', 'div', 1);
        openToken.meta = directive;
        openToken.map = map;
        openToken.block = true;

        if (name === 'figure' || name === 'image') {
            // A Markdown image, so VS Code resolves the path like any other image.
            const alt = (directive.options.alt || '').replace(/([\\[\]])/g, '\\$1');
            const src = directive.arg.replace(/([<>])/g, '\\$1');
            const image = state.push('inline', '', 0);
            image.content = `![${alt}](<${src}>)`;
            image.map = map;
            image.children = [];
            if (name === 'figure' && bodyStart < close) {
                state.push('myst_caption_open', 'figcaption', 1);
                tokenizeBody(state, bodyStart, close, indent);
                state.push('myst_caption_close', 'figcaption', -1);
            }
        } else {
            // For typed admonitions the argument is the first line of the body.
            if (directive.arg && ADMONITIONS.has(name) && name !== 'admonition') {
                const first = state.push('paragraph_open', 'p', 1);
                first.map = [startLine, startLine + 1];
                const inline = state.push('inline', '', 0);
                inline.content = directive.arg;
                inline.map = first.map;
                inline.children = [];
                state.push('paragraph_close', 'p', -1);
            }
            tokenizeBody(state, bodyStart, close, indent);
        }

        const closeToken = state.push('myst_directive_close', 'div', -1);
        closeToken.meta = directive;
        closeToken.block = true;
        state.line = map[1];
        return true;
    }

    function roleRule(state: any, silent: boolean): boolean {
        if (state.src.charCodeAt(state.pos) !== 0x7b /* { */ || !enabled()) {
            return false;
        }
        const m = /^\{([\w:.+-]+)\}(`+)(?!`)([\s\S]*?[^`])\2(?!`)/.exec(state.src.slice(state.pos));
        if (!m) {
            return false;
        }
        if (!silent) {
            const token = state.push('myst_role', '', 0);
            token.meta = { name: m[1].toLowerCase(), content: m[3].trim() };
            token.content = m[3].trim();
        }
        state.pos += m[0].length;
        return true;
    }

    /** A `(label)=` target line, which names the block after it. */
    function targetRule(state: any, startLine: number, _endLine: number, silent: boolean): boolean {
        if (state.sCount[startLine] - state.blkIndent >= 4 || !enabled()) {
            return false;
        }
        const m = TARGET_LINE.exec(lineText(state, startLine));
        if (!m) {
            return false;
        }
        if (!silent) {
            const token = state.push('scimax_myst_target', '', 0);
            token.meta = { label: m[1] };
            token.map = [startLine, startLine + 1];
            token.block = true;
        }
        state.line = startLine + 1;
        return true;
    }

    /** The first line of text in the figure caption after token `from`. */
    function captionText(tokens: Token[], from: number): string {
        let inCaption = false;
        for (let i = from; i < tokens.length && tokens[i].type !== 'myst_directive_close'; i++) {
            if (tokens[i].type === 'myst_caption_open') {
                inCaption = true;
            } else if (inCaption && tokens[i].type === 'inline') {
                return tokens[i].content;
            }
        }
        return '';
    }

    /**
     * Fill empty `[](#label)` links with the target's title, as MyST does:
     * a section's heading, or a labelled directive's title (a figure's
     * caption). Labels from other files show as the label itself.
     */
    function resolveReferences(state: any): void {
        if (!enabled()) {
            return;
        }
        const tokens: Token[] = state.tokens;
        const titles = new Map<string, string>();
        const equations = new Map<string, string>();
        const anchors: { index: number; label: string }[] = [];
        let srcLines: string[] | undefined;
        tokens.forEach((token, i) => {
            // Labelled display math: `$$ ... $$ (label)` or {math} with :label:.
            let eqLabel: string | undefined;
            if (token.type === 'math_block' && token.map) {
                srcLines ??= state.src.split(/\r?\n/);
                eqLabel = EQUATION_LABEL.exec(srcLines![token.map[1] - 1] || '')?.[1];
            } else if (token.type === 'myst_math') {
                eqLabel = token.meta?.options?.label || token.meta?.options?.name;
            }
            if (eqLabel) {
                equations.set(eqLabel, token.content.trim());
                anchors.push({ index: i, label: eqLabel });
            }

            // The MyST Highlight extension may claim the line first: its
            // `myst_target` token keeps the label in `content`, with no meta.
            // Take it over so it renders as our hidden anchor.
            if (token.type === 'myst_target' && !token.meta && token.content) {
                token.type = 'scimax_myst_target';
                token.meta = { label: token.content };
            }
            if (token.type === 'scimax_myst_target') {
                const next = tokens[i + 1];
                titles.set(token.meta.label, next?.type === 'heading_open' ? tokens[i + 2].content : '');
            } else if (token.type === 'myst_directive_open') {
                const { name, arg, options: opts } = token.meta as Directive;
                const label = opts.label || opts.name;
                if (label) {
                    const caption = name === 'figure' ? captionText(tokens, i + 1) : '';
                    titles.set(label, caption || arg || capitalize(name.replace(/^\w+:/, '')));
                }
            }
        });

        // Anchors so {eq} links can jump to their equation.
        for (const { index, label } of anchors.reverse()) {
            const anchor = new state.Token('scimax_myst_target', '', 0);
            anchor.meta = { label };
            anchor.block = true;
            tokens.splice(index, 0, anchor);
        }

        const frontBibs = frontMatterBibliography(state.src);
        for (const token of tokens) {
            if (token.type !== 'inline' || !token.children) {
                continue;
            }
            const children: Token[] = token.children;
            for (const child of children) {
                if (child.type === 'scimax_cite') {
                    child.meta.frontBibs = frontBibs;
                } else if (child.type === 'myst_role') {
                    const meta = child.meta;
                    meta.frontBibs = frontBibs;
                    const { text, target } = roleDisplay(meta.content);
                    const explicit = text !== target;
                    if (meta.name === 'eq' && equations.has(target)) {
                        meta.xref = { href: target, text: explicit ? text : `(${target})`, tex: equations.get(target) };
                    } else if (REF_ROLES.has(meta.name) && titles.has(target)) {
                        meta.xref = { href: target, text: explicit ? text : (titles.get(target) || target) };
                    }
                }
            }
            for (let i = children.length - 2; i >= 0; i--) {
                const href = children[i].type === 'link_open' ? children[i].attrGet('href') : null;
                if (!href || !href.startsWith('#') || children[i + 1].type !== 'link_close') {
                    continue;
                }
                const label = decodeURIComponent(href.slice(1));
                const text = new state.Token('text', '', 0);
                text.content = titles.get(label) || label;
                children.splice(i + 1, 0, text);
            }
        }
    }

    /** `[@key]`, `[see @a, p. 3; @b]`: a bracketed citation that is not a link. */
    function bracketCitationRule(state: any, silent: boolean): boolean {
        if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */ || !enabled()) {
            return false;
        }
        const m = /^\[([^[\]\n]*@[^[\]\n]*)\](?![([:])/.exec(state.src.slice(state.pos));
        const items = m && parseCitationItems(m[1]);
        if (!m || !items) {
            return false;
        }
        if (!silent) {
            state.push('scimax_cite', '', 0).meta = { items, mode: 'p' };
        }
        state.pos += m[0].length;
        return true;
    }

    /** A bare `@key`, rendered as a narrative citation when the key is in the bibliography. */
    function bareCitationRule(state: any, silent: boolean): boolean {
        if (state.src.charCodeAt(state.pos) !== 0x40 /* @ */ || !enabled()) {
            return false;
        }
        if (state.pos > 0 && /[\w.@]/.test(state.src[state.pos - 1])) {
            return false; // an e-mail address or similar
        }
        const m = /^@([A-Za-z][\w:./-]*\w)/.exec(state.src.slice(state.pos));
        if (!m) {
            return false;
        }
        if (!silent) {
            state.push('scimax_cite', '', 0).meta = { items: [{ key: m[1] }], mode: 't', bare: true };
        }
        state.pos += m[0].length;
        return true;
    }

    md.block.ruler.before('fence', 'myst_directive', directiveRule, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
    });
    md.block.ruler.before('paragraph', 'scimax_myst_target', targetRule);
    md.inline.ruler.before('backticks', 'myst_role', roleRule);
    md.inline.ruler.before('link', 'scimax_cite', bracketCitationRule);
    md.inline.ruler.push('scimax_cite_bare', bareCitationRule);
    md.core.ruler.push('myst_references', resolveReferences);

    const rules = md.renderer.rules;

    rules.myst_directive_open = (tokens: Token[], idx: number, _opts: any, env: any) => {
        const token = tokens[idx];
        const { name, arg, options: opts } = token.meta as Directive;
        const classes = safeClasses(opts.class);
        const lines = lineAttrs(token);

        if (name === 'figure' || name === 'image') {
            const width = CSS_LENGTH.test(opts.width || '') ? `--myst-width:${opts.width};` : '';
            const align = /^(left|center|right)$/.test(opts.align || '') ? ` myst-align-${opts.align}` : '';
            const tag = name === 'figure' ? 'figure' : 'div';
            return `<${tag} class="code-line myst-figure${align} ${classes.join(' ')}"${lines}`
                + `${width ? ` style="${width}"` : ''}>\n`;
        }

        const isAdmonition = ADMONITIONS.has(name) || name === 'dropdown';
        if (isAdmonition) {
            // {admonition} Title with :class: tip takes its colour from the class.
            const kind = name === 'admonition'
                ? (classes.find(c => ADMONITIONS.has(c)) || 'note')
                : name;
            const title = name === 'admonition' || name === 'dropdown'
                ? (arg || capitalize(kind))
                : capitalize(name);
            const titleHtml = md.renderInline(title, env);
            const cls = `code-line myst-admonition myst-${kind} ${classes.join(' ')}`;
            if (name === 'dropdown' || classes.includes('dropdown')) {
                const open = 'open' in opts ? ' open' : '';
                return `<details class="${cls}"${lines}${open}><summary class="myst-admonition-title">${titleHtml}</summary>\n`;
            }
            return `<div class="${cls}"${lines}><p class="myst-admonition-title">${titleHtml}</p>\n`;
        }

        if (PLAIN_CONTAINERS.has(name)) {
            return `<div class="code-line myst-container myst-${escape(name)} ${classes.join(' ')}"${lines}>\n`;
        }

        const label = `{${escape(name)}}${arg ? ' ' + escape(arg) : ''}`;
        return `<div class="code-line myst-directive ${classes.join(' ')}"${lines}>`
            + `<p class="myst-directive-name">${label}</p>\n`;
    };

    rules.myst_directive_close = (tokens: Token[], idx: number) => {
        const { name, options: opts } = tokens[idx].meta as Directive;
        if (name === 'figure') {
            return '</figure>\n';
        }
        if (name === 'dropdown' || safeClasses(opts.class).includes('dropdown')) {
            return '</details>\n';
        }
        return '</div>\n';
    };

    // An anchor, so the preview can jump to the target from a `[](#label)` link.
    rules.scimax_myst_target = (tokens: Token[], idx: number) =>
        `<a id="${escape(tokens[idx].meta.label)}"></a>\n`;

    rules.myst_caption_open =() => '<figcaption>\n';
    rules.myst_caption_close = () => '</figcaption>\n';

    rules.myst_math = (tokens: Token[], idx: number, opts: any, env: any, self: any) => {
        // Delegate to VS Code's KaTeX plugin when math rendering is enabled.
        if (self.rules.math_block) {
            return self.rules.math_block(tokens, idx, opts, env, self);
        }
        return `<pre class="myst-math"${lineAttrs(tokens[idx])}>`
            + `${escape(tokens[idx].content)}</pre>\n`;
    };

    /** Bibliography files for the previewed document, found once per render. */
    function bibFiles(env: any, frontBibs: string[] = []): string[] {
        const docPath: string | undefined = env?.currentDocument?.fsPath;
        if (!docPath) {
            return [];
        }
        const memo = env.scimaxBibFiles ??= new Map<string, string[]>();
        const key = frontBibs.join('\n');
        if (!memo.has(key)) {
            memo.set(key, bibliographyPaths(docPath, frontBibs));
        }
        return memo.get(key);
    }

    rules.scimax_cite = (tokens: Token[], idx: number, _opts: any, env: any) => {
        const { items, mode, bare, frontBibs } = tokens[idx].meta;
        const files = bibFiles(env, frontBibs);
        if (bare && !files.length) {
            return escape(`@${items[0].key}`);
        }
        const html = renderCitation(items, mode, files, escape);
        // A bare @word that is not a key stays as typed (e.g. a handle).
        return bare && html.includes('scimax-cite-missing') ? escape(`@${items[0].key}`) : html;
    };

    /** A {eq} or {ref} link; an equation shows itself on hover. */
    function renderXref(xref: { href: string; text: string; tex?: string }, opts: any, env: any, self: any): string {
        const link = `<a class="myst-xref" href="#${escape(xref.href)}">${escape(xref.text)}`;
        if (xref.tex === undefined) {
            return `${link}</a>`;
        }
        const math = { type: 'math_inline', content: `\\displaystyle ${xref.tex}` };
        const rendered = self.rules.math_inline
            ? self.rules.math_inline([math], 0, opts, env, self)
            : `<code>${escape(xref.tex)}</code>`;
        return `${link}<span class="myst-eq-tip">${rendered}</span></a>`;
    }

    rules.myst_role = (tokens: Token[], idx: number, opts: any, env: any, self: any) => {
        const { name, content, xref, frontBibs } = tokens[idx].meta;
        if (xref) {
            return renderXref(xref, opts, env, self);
        }
        if (CITE_MODES[name]) {
            const items = content.split(',').map((key: string) => ({ key: key.trim() })).filter((i: { key: string }) => i.key);
            return renderCitation(items, CITE_MODES[name], bibFiles(env, frontBibs), escape);
        }
        switch (name) {
            case 'math':
                return self.rules.math_inline
                    ? self.rules.math_inline(tokens, idx, opts, env, self)
                    : `<code>${escape(content)}</code>`;
            case 'sub':
            case 'sup':
            case 'kbd':
                return `<${name}>${escape(content)}</${name}>`;
            case 'abbr': {
                const m = /^(.*?)\s*\((.*)\)\s*$/.exec(content);
                return m
                    ? `<abbr title="${escape(m[2])}">${escape(m[1])}</abbr>`
                    : `<abbr>${escape(content)}</abbr>`;
            }
            case 'index':
                return escape(roleDisplay(content).text);
            default: {
                const { text, target } = roleDisplay(content);
                return `<span class="myst-role myst-role-${escape(name.replace(/[^\w-]/g, '-'))}"`
                    + ` title="{${escape(name)}} ${escape(target)}">${escape(text)}</span>`;
            }
        }
    };
}
