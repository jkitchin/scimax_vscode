/**
 * Languages that use Markdown structure (ATX headings, fenced code blocks,
 * pipe tables), so scimax's markdown editing applies to them. Quarto
 * documents (.qmd, language id from the Quarto extension) are Pandoc
 * Markdown with executable chunks.
 */
export const MARKDOWN_LIKE_LANGUAGES = ['markdown', 'quarto'];

export function isMarkdownLike(languageId: string | undefined): boolean {
    return languageId !== undefined && MARKDOWN_LIKE_LANGUAGES.includes(languageId);
}
