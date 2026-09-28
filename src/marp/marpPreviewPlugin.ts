/**
 * Marp slides in VS Code's built-in Markdown preview.
 *
 * A markdown-it plugin (contributed through `markdown.markdownItPlugins`)
 * that renders a deck with `marp: true` in its front matter with Marp Core
 * instead of plain markdown-it, so the preview shows slides without the Marp
 * for VS Code extension. Other Markdown files are rendered as before.
 *
 * Every block element gets VS Code's `code-line` class and `data-line`
 * attribute, so the preview's scroll sync works and the double-click script
 * (media/marp/marpPreview.js) can jump to the source.
 *
 * The preview script media/marp/marpPreview.js turns off VS Code's own
 * Markdown styles while a deck is shown, since they would leak into slides.
 */

import { createPreviewMarp, isMarpText, PreviewMarp, RenderOptions } from './slideRenderer';

export interface MarpPreviewOptions {
    /**
     * Rendering options for a deck, read each time one is rendered. `env` is
     * markdown-it's environment; VS Code's preview puts the document's URI in
     * `env.currentDocument`.
     */
    renderOptions?: (env: unknown) => RenderOptions;
}

// markdown-it has no type declarations in this project (as in mystPreview.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarkdownIt = any;
type Token = { type: string; block: boolean; nesting: number; map: [number, number] | null; attrJoin(name: string, value: string): void; attrSet(name: string, value: string): void };

/** Add `code-line` and `data-line` to every block element, as VS Code's own plugin does. */
function addSourceMap(marp: PreviewMarp): void {
    marp.markdown.core.ruler.push('scimax_marp_source_map', (state: { tokens: Token[] }) => {
        for (const token of state.tokens) {
            if (token.block && token.map && token.nesting >= 0 && !token.type.startsWith('marpit_inline_svg')) {
                token.attrJoin('class', 'code-line');
                token.attrSet('data-line', String(token.map[0]));
            }
        }
    });
}

export function marpPreviewPlugin(md: MarkdownIt, options: MarpPreviewOptions = {}): void {
    // Tokens of decks parsed by Marp, and the Marp instance that parsed them.
    // VS Code caches tokens and may render them with a different env, so the
    // tokens themselves are the key.
    const decks = new WeakMap<object, PreviewMarp>();

    const parse = md.parse;
    md.parse = function (src: string, env: unknown) {
        if (!isMarpText(src)) {
            return parse.call(this, src, env);
        }
        const marp = createPreviewMarp(options.renderOptions?.(env) ?? {});
        addSourceMap(marp);
        const tokens = marp.markdown.parse(src, env ?? {});
        decks.set(tokens, marp);
        return tokens;
    };

    const renderer = md.renderer;
    const render = renderer.render;
    renderer.render = function (tokens: object, renderOptions: unknown, env: unknown) {
        const marp = decks.get(tokens);
        if (!marp) {
            return render.call(this, tokens, renderOptions, env);
        }
        const html = marp.markdown.renderer.render(tokens, marp.markdown.options, env);
        const css = marp.deckStyle();
        return `<style id="scimax-marp-style">${css}</style>${html}`;
    };
}
