/**
 * Syntax highlighting for DOCX export using Shiki
 * Converts code to styled TextRun arrays for Word documents
 */

import { TextRun } from 'docx';
import type { Highlighter, ThemedToken } from 'shiki';
import { DOCX_COLORS } from './orgExportDocxStyles';

/**
 * Lazy-loaded Shiki highlighter instance
 */
let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Map of common language aliases to canonical names
 */
const LANGUAGE_ALIASES: Record<string, string> = {
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'emacs-lisp': 'lisp',
    'elisp': 'lisp',
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'rb': 'ruby',
    'yml': 'yaml',
    'md': 'markdown',
    'plaintext': 'text',
    'text': 'text',
};

/**
 * Languages supported by Shiki (commonly used subset)
 */
const SUPPORTED_LANGUAGES = new Set([
    'javascript', 'typescript', 'python', 'shell', 'bash', 'json', 'yaml',
    'html', 'css', 'sql', 'rust', 'go', 'java', 'c', 'cpp', 'csharp',
    'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'julia', 'matlab',
    'lua', 'perl', 'haskell', 'lisp', 'clojure', 'scheme', 'latex', 'tex',
    'markdown', 'xml', 'toml', 'ini', 'dockerfile', 'makefile', 'cmake',
    'diff', 'git-commit', 'regex', 'graphql', 'vue', 'svelte', 'jsx', 'tsx',
    'text',
]);

/**
 * Highlighting configuration
 */
export interface HighlightOptions {
    /** Shiki theme to use (default: 'github-light') */
    theme?: string;
    /** Code font family (default: Consolas) */
    fontFamily?: string;
    /** Code font size in half-points (default: 20 = 10pt) */
    fontSize?: number;
    /** Whether highlighting is enabled (default: true) */
    enabled?: boolean;
}

const DEFAULT_HIGHLIGHT_OPTIONS: Required<HighlightOptions> = {
    theme: 'github-light',
    fontFamily: 'Consolas',
    fontSize: 20, // 10pt in half-points
    enabled: true,
};

/**
 * Get or create the Shiki highlighter instance
 */
async function getHighlighter(theme: string): Promise<Highlighter | null> {
    try {
        // Dynamic import to avoid loading Shiki until needed
        const { createHighlighter } = await import('shiki');

        if (!highlighterPromise) {
            highlighterPromise = createHighlighter({
                themes: [theme, 'github-dark', 'github-light'],
                langs: Array.from(SUPPORTED_LANGUAGES),
            });
        }

        return await highlighterPromise;
    } catch (error) {
        // Shiki initialization failed - will fall back to plain text
        console.warn('Shiki highlighter initialization failed:', error);
        return null;
    }
}

/**
 * Normalize language name to a supported Shiki language
 */
function normalizeLanguage(lang: string): string {
    const lower = lang.toLowerCase().trim();

    // Check aliases first
    if (LANGUAGE_ALIASES[lower]) {
        return LANGUAGE_ALIASES[lower];
    }

    // Check if directly supported
    if (SUPPORTED_LANGUAGES.has(lower)) {
        return lower;
    }

    // Default to text for unknown languages
    return 'text';
}

/**
 * Convert a Shiki themed token to a docx TextRun
 */
function tokenToTextRun(
    token: ThemedToken,
    options: Required<HighlightOptions>
): TextRun {
    // Extract color from token (remove # prefix if present)
    let color = token.color?.replace('#', '') || DOCX_COLORS.code;

    // Handle 8-character hex colors (with alpha) by stripping alpha
    if (color.length === 8) {
        color = color.substring(0, 6);
    }

    // FontStyle enum values: NotSet=undefined, None=0, Bold=1, Italic=2, Underline=4, etc.
    // In shiki, fontStyle can be a bitmask or enum value
    const fontStyle = token.fontStyle ?? 0;
    const isBold = (fontStyle & 1) !== 0; // Bold bit
    const isItalic = (fontStyle & 2) !== 0; // Italic bit

    return new TextRun({
        text: token.content,
        font: options.fontFamily,
        size: options.fontSize,
        color,
        bold: isBold,
        italics: isItalic,
    });
}

/**
 * Create a plain text run (for fallback when highlighting fails)
 */
function createPlainTextRun(
    text: string,
    options: Required<HighlightOptions>
): TextRun {
    return new TextRun({
        text,
        font: options.fontFamily,
        size: options.fontSize,
        color: DOCX_COLORS.code,
    });
}

/**
 * Highlight code and return an array of TextRun objects
 *
 * Each line of code becomes a separate array of TextRuns
 * (caller should join lines with line breaks)
 */
export async function highlightCode(
    code: string,
    language: string,
    options: HighlightOptions = {}
): Promise<TextRun[][]> {
    const opts = { ...DEFAULT_HIGHLIGHT_OPTIONS, ...options };

    // If highlighting is disabled, return plain text
    if (!opts.enabled) {
        return code.split('\n').map(line => [createPlainTextRun(line, opts)]);
    }

    // Normalize the language name
    const normalizedLang = normalizeLanguage(language);

    // Get the highlighter
    const highlighter = await getHighlighter(opts.theme);

    if (!highlighter) {
        // Fallback to plain text if highlighter not available
        return code.split('\n').map(line => [createPlainTextRun(line, opts)]);
    }

    try {
        // Check if we need to load this language
        const loadedLangs = highlighter.getLoadedLanguages();
        if (!loadedLangs.includes(normalizedLang) && normalizedLang !== 'text') {
            try {
                await highlighter.loadLanguage(normalizedLang as any);
            } catch {
                // Language not available, fall back to text
                return code.split('\n').map(line => [createPlainTextRun(line, opts)]);
            }
        }

        // Tokenize the code
        const tokens = highlighter.codeToTokens(code, {
            lang: normalizedLang as any,
            theme: opts.theme,
        });

        // Convert tokens to TextRuns, grouped by line
        return tokens.tokens.map(lineTokens =>
            lineTokens.map(token => tokenToTextRun(token, opts))
        );
    } catch (error) {
        // Highlighting failed - fall back to plain text
        console.warn(`Code highlighting failed for language '${language}':`, error);
        return code.split('\n').map(line => [createPlainTextRun(line, opts)]);
    }
}

/**
 * Highlight code synchronously using a pre-initialized highlighter
 * Falls back to plain text if highlighter not ready
 */
export function highlightCodeSync(
    code: string,
    highlighter: Highlighter | null,
    language: string,
    options: HighlightOptions = {}
): TextRun[][] {
    const opts = { ...DEFAULT_HIGHLIGHT_OPTIONS, ...options };

    if (!opts.enabled || !highlighter) {
        return code.split('\n').map(line => [createPlainTextRun(line, opts)]);
    }

    const normalizedLang = normalizeLanguage(language);

    try {
        const tokens = highlighter.codeToTokens(code, {
            lang: normalizedLang as any,
            theme: opts.theme,
        });

        return tokens.tokens.map(lineTokens =>
            lineTokens.map(token => tokenToTextRun(token, opts))
        );
    } catch {
        return code.split('\n').map(line => [createPlainTextRun(line, opts)]);
    }
}

/**
 * Create a code block as an array of paragraphs
 * Each line becomes a paragraph with styled TextRuns
 */
export async function createHighlightedCodeBlock(
    code: string,
    language: string,
    options: HighlightOptions = {}
): Promise<TextRun[][]> {
    return highlightCode(code, language, options);
}

/**
 * Pre-load the highlighter for faster subsequent highlighting
 */
export async function preloadHighlighter(theme: string = 'github-light'): Promise<void> {
    await getHighlighter(theme);
}

/**
 * Check if a language is supported for syntax highlighting
 */
export function isLanguageSupported(language: string): boolean {
    const normalized = normalizeLanguage(language);
    return SUPPORTED_LANGUAGES.has(normalized);
}

/**
 * Get list of supported languages
 */
export function getSupportedLanguages(): string[] {
    return Array.from(SUPPORTED_LANGUAGES);
}
