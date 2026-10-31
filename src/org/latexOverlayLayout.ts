/**
 * Layout for inline LaTeX previews (org's C-c C-x C-l): keeping previewed
 * fragments' offsets in step with edits, sizing a rendered equation to the
 * editor font, and cutting a tall equation into one strip per source line.
 * VS Code cannot make a line taller, so an equation over several lines is
 * drawn a slice per line. No vscode import, so it is unit-testable.
 */

/** A previewed fragment's character offsets in the document, end exclusive */
export interface OffsetRange {
    start: number;
    end: number;
    /** Set when an edit inside the range was kept (see shiftRanges) */
    edited?: boolean;
}

/** One edit, in the coordinates of the document before any of the edits */
export interface OffsetChange {
    offset: number;
    /** Characters replaced */
    length: number;
    /** Characters inserted */
    textLength: number;
}

/**
 * Move ranges through a set of edits, in place. A range an edit touches the
 * inside of is dropped, as org drops a preview when its fragment is edited,
 * unless `editable` says it is being edited: then an edit wholly inside it
 * stretches it and marks it edited. Typing right before or after a range
 * keeps it. Returns the kept ranges.
 */
export function shiftRanges<T extends OffsetRange>(
    ranges: T[],
    changes: readonly OffsetChange[],
    editable: (range: T) => boolean = () => false
): T[] {
    // Edits are in the old document's coordinates: apply the last first so
    // each one only moves ranges after it.
    const sorted = [...changes].sort((a, b) => b.offset - a.offset);
    let kept = ranges;
    for (const change of sorted) {
        const changeEnd = change.offset + change.length;
        const delta = change.textLength - change.length;
        kept = kept.filter(r => {
            const touches = change.length === 0
                ? r.start < change.offset && change.offset < r.end
                : change.offset < r.end && changeEnd > r.start;
            if (touches) {
                if (!editable(r) || change.offset < r.start || changeEnd > r.end) return false;
                r.end += delta;
                r.edited = true;
                return r.end > r.start;
            }
            if (change.offset <= r.start) {
                r.start += delta;
                r.end += delta;
            }
            return true;
        });
    }
    return kept;
}

/** An SVG's size in points and where its baseline sits */
export interface SvgBox {
    /** viewBox origin and size, in the SVG's user units (points for dvisvgm) */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Distance below the baseline (y = 0 in dvisvgm output), clamped to the box */
    depth: number;
}

/** Read the viewBox of an SVG's root element (dvisvgm writes one) */
export function readSvgBox(svg: string): SvgBox | undefined {
    const tag = svg.match(/<svg\b[^>]*>/i)?.[0];
    const vb = tag?.match(/\bviewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/i);
    if (!vb) return undefined;
    const [x, y, width, height] = vb.slice(1, 5).map(Number);
    if (!(width > 0 && height > 0)) return undefined;
    // dvisvgm keeps TeX's coordinates, with the baseline at y = 0
    const depth = Math.min(Math.max(y + height, 0), height);
    return { x, y, width, height, depth };
}

/** How big to draw a preview, in CSS pixels */
export interface OverlaySize {
    width: number;
    /** Height of the whole equation */
    height: number;
    /** Pixels from the top of the first line to the top of the equation */
    top: number;
    /** Pixels the equation hangs below the text baseline (inline previews) */
    depth: number;
    /** Lines the preview is drawn over */
    lines: number;
    lineHeight: number;
}

/**
 * Size an equation rendered at 10pt (LaTeX's default size) so its text matches
 * the editor font, times `scale`. The preview has to fit the lines its source
 * takes up, so a tall one is shrunk to fit and a short one is centred.
 */
export function overlaySize(
    box: SvgBox,
    fontSizePx: number,
    lineHeightPx: number,
    lines: number,
    scale = 1
): OverlaySize {
    const room = lineHeightPx * lines;
    let s = (fontSizePx / 10) * scale;
    if (box.height * s > room) s = room / box.height;
    const width = box.width * s;
    const height = box.height * s;
    return {
        width,
        height,
        top: Math.max(0, (room - height) / 2),
        depth: box.depth * s,
        lines,
        lineHeight: lineHeightPx,
    };
}

/** The editor's line height in pixels, from editor.lineHeight as VS Code reads it */
export function editorLineHeight(fontSizePx: number, setting: number, platform: string): number {
    // 0 is "computed from the font size"; values under 8 are a multiplier
    if (!setting) return Math.round(fontSizePx * (platform === 'darwin' ? 1.5 : 1.35));
    if (setting < 8) return Math.round(fontSizePx * setting);
    return setting;
}

/**
 * The SVG for one line of a preview: the slice of the equation that falls on
 * line `index` (0 for a one-line preview), recoloured to `color`. A one-line
 * preview is the whole equation at its own height; a strip of a taller one is
 * a line high, so the strips stack into the equation.
 */
export function previewStripSvg(svg: string, box: SvgBox, size: OverlaySize, index: number, color: string): string {
    const units = box.height / size.height; // SVG units per pixel
    const oneLine = size.lines === 1;
    const heightPx = oneLine ? size.height : size.lineHeight;
    const y = oneLine ? box.y : box.y + (index * size.lineHeight - size.top) * units;
    const viewBox = `${fmt(box.x)} ${fmt(y)} ${fmt(box.width)} ${fmt(heightPx * units)}`;

    return svg.replace(/<svg\b[^>]*>/i, tag => {
        const attrs = tag
            .replace(/\s(width|height|viewBox|fill|color)\s*=\s*("[^"]*"|'[^']*')/gi, '')
            .replace(/\s*\/?>$/, '');
        return `${attrs} width='${fmt(size.width)}px' height='${fmt(heightPx)}px' viewBox='${viewBox}'`
            + ` preserveAspectRatio='none' fill='${color}' color='${color}'>`;
    });
}

/** Lines [start, end) of the section around `line`: from its heading (or the file start) to the next heading */
export function sectionLines(lines: readonly string[], line: number): { start: number; end: number } {
    const isHeading = (text: string) => /^\*+\s/.test(text);
    let start = line;
    while (start > 0 && !isHeading(lines[start])) start--;
    if (!isHeading(lines[start])) start = 0;
    let end = Math.max(line, start) + 1;
    while (end < lines.length && !isHeading(lines[end])) end++;
    return { start, end };
}

function fmt(n: number): string {
    return String(Math.round(n * 1000) / 1000);
}
