/**
 * Citations in Marp slides, with a reference list on each slide.
 *
 * The MyST preview plugin (src/markdown/mystPreview.ts) renders `[@key]`,
 * `@key` and `{cite}` roles as author-year text. In a deck this plugin also
 * puts the full reference for each source cited on a slide at the bottom of
 * that slide, like a footnote, so the audience can see what it is.
 *
 * Used by the Markdown preview's Marp plugin and by renderDeck (the slide
 * preview). Pure: no vscode imports.
 */

import { mystPreviewPlugin, MystPreviewOptions } from '../markdown/mystPreview';
import { bibliographyPaths, frontMatterBibliography, lookupCitation } from '../markdown/citationPreview';

// markdown-it has no type declarations in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarkdownIt = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Token = any;

/** Keys cited by the inline children of a slide, in order of first use. */
function citedKeys(children: Token[], into: string[]): void {
    for (const child of children) {
        if (child.type === 'scimax_cite') {
            for (const item of child.meta.items) into.push(item.key);
        } else if (child.type === 'myst_role' && /^cite(?::|$)/.test(child.meta.name) && !child.meta.xref) {
            for (const key of String(child.meta.content).split(',')) {
                if (key.trim()) into.push(key.trim());
            }
        }
    }
}

/** Puts a `scimax_slide_refs` token before each slide's end that cites anything. */
export function slideReferencesPlugin(md: MarkdownIt): void {
    const escape: (s: string) => string = md.utils.escapeHtml;

    md.core.ruler.push('scimax_slide_refs', (state: { src: string; tokens: Token[]; Token: new (type: string, tag: string, nesting: number) => Token }) => {
        const frontBibs = frontMatterBibliography(state.src);
        const tokens = state.tokens;
        let keys: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.type === 'marpit_slide_open') {
                keys = [];
            } else if (token.type === 'inline' && token.children) {
                citedKeys(token.children, keys);
            } else if (token.type === 'marpit_slide_close' && keys.length) {
                const refs = new state.Token('scimax_slide_refs', 'div', 0);
                refs.block = true;
                refs.meta = { keys: [...new Set(keys)], frontBibs };
                tokens.splice(i, 0, refs);
                i++;
                keys = [];
            }
        }
    });

    md.renderer.rules.scimax_slide_refs = (tokens: Token[], idx: number, _opts: unknown, env: any) => {
        const { keys, frontBibs } = tokens[idx].meta as { keys: string[]; frontBibs: string[] };
        const docPath: string | undefined = env?.currentDocument?.fsPath;
        const files = docPath ? bibliographyPaths(docPath, frontBibs) : [];
        const items = keys
            .map(key => lookupCitation(key, files))
            .filter((found): found is NonNullable<typeof found> => !!found)
            .map(found => `<li>${escape(found.full)}</li>`);
        if (!items.length) return '';
        // Inline styles, so it works in every theme and in both previews.
        // Marp's section is position: relative; this sits above the footer.
        return '<div class="scimax-slide-refs" style="position:absolute;left:var(--scimax-refs-inset,70px);'
            + 'right:var(--scimax-refs-inset,70px);bottom:var(--scimax-refs-bottom,40px);'
            + 'font-size:var(--scimax-refs-size,0.5em);line-height:1.3;opacity:0.85;'
            + 'border-top:1px solid currentColor;padding-top:0.3em;text-align:left">'
            + `<ul style="list-style:none;margin:0;padding:0">${items.join('')}</ul></div>\n`;
    };
}

/** The citation plugins for a Marp instance's markdown-it. */
export function useSlideCitations(marpMarkdown: MarkdownIt, mystOptions: MystPreviewOptions = {}): MarkdownIt {
    return marpMarkdown.use(mystPreviewPlugin, mystOptions).use(slideReferencesPlugin);
}
