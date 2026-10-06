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

import * as fs from 'fs';
import * as path from 'path';
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

let presenterEngine: ((args: { marp: Marp }) => Marp) | null | undefined;

/**
 * The presenter tools' Marp engine (media/marpPresent/engine.cjs), so the
 * preview and thumbnails show ```countdown boxes as the slideshow does.
 * Null if it cannot be found (the preview then shows a code block).
 */
function loadPresenterEngine(): ((args: { marp: Marp }) => Marp) | null {
    if (presenterEngine === undefined) {
        try {
            // out/marp or src/marp (or out/, bundled) -> media/marpPresent
            const engine = [path.join(__dirname, '..', '..'), path.join(__dirname, '..')]
                .map(root => path.join(root, 'media', 'marpPresent', 'engine.cjs'))
                .find(file => fs.existsSync(file));
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            presenterEngine = engine ? require(engine) : null;
        } catch {
            presenterEngine = null;
        }
    }
    return presenterEngine ?? null;
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
function newMarp<T extends Marp>(
    MarpClass: new (options?: MarpOptions) => T,
    options: RenderOptions,
    extra: MarpOptions = {}
): T {
    const marp = new MarpClass({
        ...extra,
        inlineSVG: true,
        // `undefined` keeps Marp's default allowlist of safe HTML elements.
        html: options.enableHtml ? true : undefined,
        math: options.math === 'off' ? false : (options.math ?? 'mathjax'),
    });
    loadPresenterEngine()?.({ marp });
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

const IMAGE_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
};

/** Local images larger than this are left out of a slide image. */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * A local image as a data URI, or undefined for a remote, missing or large
 * image. An SVG shown as an image loads nothing itself, so images go inline.
 */
function imageDataUri(src: string, baseDir: string): string | undefined {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('file:')) {
        return undefined;
    }
    let file = src.startsWith('file://') ? decodeURIComponent(src.slice(7)) : src;
    file = decodeURI(file.split(/[?#]/)[0]);
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type) {
        return undefined;
    }
    const absolute = path.resolve(baseDir, file);
    try {
        if (fs.statSync(absolute).size > MAX_INLINE_IMAGE_BYTES) {
            return undefined;
        }
        return `data:${type};base64,${fs.readFileSync(absolute).toString('base64')}`;
    } catch {
        return undefined;
    }
}

/**
 * The first slide of a deck as a standalone SVG document, for showing as an
 * image (e.g. `<img src="data:image/svg+xml;base64,...">` in a hover).
 *
 * The slide is Marp's inline SVG with its theme CSS, wrapped so it is valid
 * XML: markdown-it writes XHTML, the slide elements get their namespaces, the
 * browser script is left out and the CSS goes in a CDATA section. Raw HTML is
 * limited to Marp's safe allowlist, whatever the deck's settings, so it stays
 * well formed. Local images are inlined from `baseDir`; remote images and web
 * fonts do not load in an SVG image.
 */
export function firstSlideSvg(text: string, baseDir: string, options: RenderOptions = {}): { svg: string; width: number; height: number } {
    const starts = slideStarts(text);
    const firstSlide = starts.length > 1 ? text.split(/\r?\n/).slice(0, starts[1]).join('\n') : text;
    const marp = newMarp(loadMarp(), { ...options, enableHtml: false }, { script: false });
    marp.markdown.set({ xhtmlOut: true });
    const { html, css } = marp.render(firstSlide);

    const viewBox = /<svg data-marpit-svg="" viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(html);
    const width = viewBox ? Number(viewBox[1]) : 1280;
    const height = viewBox ? Number(viewBox[2]) : 720;

    const body = html
        .replace(/^<div class="marpit">/, '<div xmlns="http://www.w3.org/1999/xhtml" class="marpit">')
        .replace(/<svg data-marpit-svg=""/g, '<svg xmlns="http://www.w3.org/2000/svg" data-marpit-svg=""')
        .replace(/(<foreignObject[^>]*>)<section/g, '$1<section xmlns="http://www.w3.org/1999/xhtml"')
        .replace(/(<img\b[^>]*?\bsrc=")([^"]*)"/g, (whole, start: string, src: string) => {
            const uri = imageDataUri(src.replace(/&amp;/g, '&'), baseDir);
            return uri ? `${start}${uri}"` : whole;
        })
        .replace(/url\(&quot;(.*?)&quot;\)/g, (whole, src: string) => {
            const uri = imageDataUri(src.replace(/&amp;/g, '&'), baseDir);
            return uri ? `url(&quot;${uri}&quot;)` : whole;
        });
    // @charset is invalid inside <style>; @import (web fonts) cannot load.
    const style = css.replace(/@charset "[^"]*";/g, '').replace(/@import [^;]+;/g, '').replace(/]]>/g, ']] >');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + `<foreignObject width="${width}" height="${height}">`
        + body.replace('class="marpit">', `class="marpit"><style><![CDATA[${style}]]></style>`)
        + '</foreignObject></svg>';
    return { svg, width, height };
}
