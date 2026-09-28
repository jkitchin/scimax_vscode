/**
 * Render a Marp deck for the slide thumbnail view, and find where Marp starts
 * each slide.
 *
 * Slide boundaries come from Marp's own parser (the `map` of each
 * `marpit_slide_open` token), so they account for front matter, code fences
 * and the `headingDivider` directive exactly as Marp does.
 *
 * This module has no VS Code dependency so it can be unit tested directly.
 */

import type { Marp, MarpOptions } from '@marp-team/marp-core';

export interface RenderedDeck {
    html: string;
    css: string;
}

export interface RenderOptions {
    /** Allow all raw HTML (`scimax.marp.enableHtml`). Otherwise Marp's safe allowlist applies. */
    enableHtml?: boolean;
    /** Math typesetting (`scimax.marp.mathTypesetting`). */
    math?: 'mathjax' | 'katex' | 'off';
    /** Contents of custom theme CSS files. */
    themes?: string[];
}

type MarpConstructor = new (options?: MarpOptions) => Marp;
let marpClass: MarpConstructor | undefined;
let splitter: Marp | undefined;

/** marp-core loads MathJax and highlight.js eagerly, so require it only on first use. */
function loadMarp(): MarpConstructor {
    if (!marpClass) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        marpClass = require('@marp-team/marp-core').Marp as MarpConstructor;
    }
    return marpClass;
}

const FRONT_MATTER_OPEN = /^---\s*$/;
const FRONT_MATTER_CLOSE = /^(---|\.\.\.)\s*$/;

/** True if the text starts with YAML front matter containing `marp: true`. */
export function isMarpText(text: string): boolean {
    const lines = text.split(/\r?\n/, 200);
    if (!FRONT_MATTER_OPEN.test(lines[0] ?? '')) {
        return false;
    }
    for (let i = 1; i < lines.length; i++) {
        if (FRONT_MATTER_CLOSE.test(lines[i])) {
            return false;
        }
        if (/^marp\s*:\s*true\s*$/.test(lines[i])) {
            return true;
        }
    }
    return false;
}

/**
 * First source line (0-based) of each slide as Marp splits the text: the
 * slide's separator, its heading (with `headingDivider`) or 0 for slide 1.
 * Rendering options do not affect where slides split, so one parser is reused.
 */
export function slideStarts(text: string): number[] {
    splitter ??= new (loadMarp())({ math: false });
    const tokens: Array<{ type: string; map: [number, number] | null }> = splitter.markdown.parse(text, {});
    return tokens
        .filter(token => token.type === 'marpit_slide_open' && token.map)
        .map(token => token.map![0]);
}

/** A Marp instance with the deck's options and custom themes. */
function newMarp<T extends Marp>(MarpClass: new (options?: MarpOptions) => T, options: RenderOptions): T {
    const marp = new MarpClass({
        inlineSVG: true,
        // `undefined` keeps Marp's default allowlist of safe HTML elements.
        html: options.enableHtml ? true : undefined,
        math: options.math === 'off' ? false : (options.math ?? 'mathjax'),
    });
    for (const css of options.themes ?? []) {
        try {
            marp.themeSet.add(css);
        } catch {
            // A theme without a valid `@theme` comment is skipped, as Marp does.
        }
    }
    return marp;
}

/** Render a deck with each slide as an inline SVG (`<svg data-marpit-svg>`). */
export function renderDeck(text: string, options: RenderOptions = {}): RenderedDeck {
    const { html, css } = newMarp(loadMarp(), options).render(text);
    return { html, css };
}

/** A Marp instance that can also give the CSS for the deck it last parsed. */
export type PreviewMarp = Marp & { deckStyle(): string };

/**
 * A Marp instance for the Markdown preview, which parses and renders tokens
 * itself: after parsing a deck, `deckStyle()` gives the theme CSS for it.
 */
export function createPreviewMarp(options: RenderOptions = {}): PreviewMarp {
    const Base = loadMarp();
    class WithDeckStyle extends Base {
        deckStyle(): string {
            // Both are protected in Marpit's types, hence the subclass.
            return this.renderStyle(this.lastGlobalDirectives?.theme);
        }
    }
    return newMarp(WithDeckStyle, options);
}
