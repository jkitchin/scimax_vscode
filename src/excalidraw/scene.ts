/**
 * Excalidraw scenes without VS Code: fill in element defaults from a compact
 * spec, check a scene for broken references, render it to SVG, and read or
 * write the scene payload that `.excalidraw.svg` files carry so the
 * Excalidraw editor can reopen them.
 *
 * Links from a drawing back into org files use the scimax URI handler:
 *
 *   vscode://jkitchin.scimax-vscode/org-link?from=<file>&link=<org link>
 *
 * The Excalidraw VS Code editor hands any non-file link to the OS, which
 * routes `vscode://` URIs back to VS Code and on to scimax. `link` is always
 * the last parameter and is read to the end of the query, so an org link may
 * contain `&` or `=` (VS Code decodes the query before handlers see it).
 */
import * as crypto from 'crypto';
import * as zlib from 'zlib';

export const ORG_LINK_URI_PREFIX = 'vscode://jkitchin.scimax-vscode/org-link';
const PAYLOAD_TYPE = 'application/vnd.excalidraw+json';

export interface ExcalidrawElement {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    angle?: number;
    strokeColor?: string;
    backgroundColor?: string;
    fillStyle?: string;
    strokeWidth?: number;
    strokeStyle?: string;
    roughness?: number;
    opacity?: number;
    roundness?: { type: number; value?: number } | null;
    isDeleted?: boolean;
    boundElements?: { id: string; type: string }[] | null;
    link?: string | null;
    customData?: Record<string, unknown>;
    // text
    text?: string;
    originalText?: string;
    fontSize?: number;
    fontFamily?: number;
    textAlign?: string;
    verticalAlign?: string;
    containerId?: string | null;
    lineHeight?: number;
    // linear
    points?: [number, number][];
    startBinding?: { elementId: string; focus?: number; gap?: number } | null;
    endBinding?: { elementId: string; focus?: number; gap?: number } | null;
    startArrowhead?: string | null;
    endArrowhead?: string | null;
    // image
    fileId?: string | null;
    [key: string]: unknown;
}

export interface ExcalidrawScene {
    type: 'excalidraw';
    version: number;
    source?: string;
    elements: ExcalidrawElement[];
    appState?: { viewBackgroundColor?: string; gridSize?: number | null; [key: string]: unknown };
    files?: Record<string, { mimeType: string; id: string; dataURL: string; [key: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// Org links
// ---------------------------------------------------------------------------

/** URI that asks scimax to follow an org link. */
export function orgLinkUri(link: string, from?: string): string {
    const fromPart = from ? `from=${encodeURIComponent(from)}&` : '';
    return `${ORG_LINK_URI_PREFIX}?${fromPart}link=${encodeURIComponent(link)}`;
}

/**
 * Read `from` and `link` out of an org-link query. Accepts the query either
 * still encoded (from an SVG href) or already decoded (from a VS Code Uri).
 */
export function parseOrgLinkQuery(query: string, encoded: boolean): { link: string; from?: string } | null {
    const at = query.startsWith('link=') ? 0 : query.indexOf('&link=') + 1;
    if (at <= 0 && !query.startsWith('link=')) return null;
    const decode = (s: string) => {
        if (!encoded) return s;
        try { return decodeURIComponent(s); } catch { return s; }
    };
    const link = decode(query.slice(at + 'link='.length));
    let from: string | undefined;
    const head = query.slice(0, Math.max(0, at - 1));
    for (const part of head.split('&')) {
        if (part.startsWith('from=')) from = decode(part.slice(5));
    }
    return link ? { link, from } : null;
}

/** The org link inside a scimax org-link URI, or null for any other href. */
export function parseOrgLinkUri(href: string): { link: string; from?: string } | null {
    if (!href.startsWith(ORG_LINK_URI_PREFIX + '?')) return null;
    return parseOrgLinkQuery(href.slice(ORG_LINK_URI_PREFIX.length + 1), true);
}

// ---------------------------------------------------------------------------
// Normalizing a compact spec into a full scene
// ---------------------------------------------------------------------------

const CONTAINER_TYPES = new Set(['rectangle', 'ellipse', 'diamond']);
const LINEAR_TYPES = new Set(['arrow', 'line']);
/** Average glyph width as a fraction of font size (Excalifont runs wide). */
const CHAR_WIDTH = 0.6;
const LINE_HEIGHT = 1.25;
const LABEL_PADDING = 20;

function randomInt(): number {
    return crypto.randomInt(1, 2 ** 31 - 1);
}

function textSize(text: string, fontSize: number, lineHeight = LINE_HEIGHT): { width: number; height: number } {
    const lines = text.split('\n');
    const longest = Math.max(...lines.map(l => [...l].length), 1);
    return {
        width: Math.ceil(longest * fontSize * CHAR_WIDTH),
        height: Math.ceil(lines.length * fontSize * lineHeight),
    };
}

function baseDefaults(el: Partial<ExcalidrawElement>): ExcalidrawElement {
    return {
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: el.type === 'rectangle' || el.type === 'diamond' ? { type: 3 }
            : LINEAR_TYPES.has(el.type ?? '') ? { type: 2 } : null,
        seed: randomInt(),
        version: 1,
        versionNonce: randomInt(),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        ...el,
    } as ExcalidrawElement;
}

/** Point where the ray from the box centre toward (tx, ty) leaves the box. */
function edgePoint(el: ExcalidrawElement, tx: number, ty: number, gap: number): [number, number] {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) return [cx, cy];
    const hw = el.width / 2 + gap;
    const hh = el.height / 2 + gap;
    let t: number;
    if (el.type === 'ellipse') {
        t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
    } else if (el.type === 'diamond') {
        t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    } else {
        t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
    }
    return [cx + dx * t, cy + dy * t];
}

function addBound(el: ExcalidrawElement, id: string, type: string): void {
    const list = el.boundElements ?? [];
    if (!list.some(b => b.id === id)) list.push({ id, type });
    el.boundElements = list;
}

/**
 * Expand a compact spec into a scene the Excalidraw editor loads as is.
 * Shorthands, removed once expanded so the result normalizes to itself:
 *
 *   - `label` on a rectangle, ellipse, diamond or arrow: a bound text element
 *     (`<id>-label`); a shape without width/height is sized to fit it
 *   - `from` / `to` on an arrow or line: ids of the shapes it connects; points
 *     and bindings are computed from the shapes' edges
 *   - `orgLink`: an org link (`file:notes.org::*Heading`, `id:...`,
 *     `cite:&key`, ...) followed by scimax; sets `link` to the scimax URI and
 *     keeps the org link in `customData.orgLink`
 *
 * Missing fields (seed, version, roundness, ...) are filled with defaults.
 */
export function normalizeScene(input: unknown): ExcalidrawScene {
    const raw = (Array.isArray(input) ? { elements: input } : input ?? {}) as Partial<ExcalidrawScene>;
    const specs = (Array.isArray(raw.elements) ? raw.elements : []) as (Partial<ExcalidrawElement> & Record<string, unknown>)[];
    const elements: ExcalidrawElement[] = [];
    const byId = new Map<string, ExcalidrawElement>();
    const labels: { owner: ExcalidrawElement; text: string; spec: Record<string, unknown> }[] = [];
    const connections: { arrow: ExcalidrawElement; from?: string; to?: string }[] = [];
    let counter = 0;

    for (const spec of specs) {
        const { label, from, to, orgLink, labelFontSize, ...rest } = spec;
        const type = String(rest.type ?? 'rectangle');
        const id = String(rest.id ?? `${type}-${++counter}-${crypto.randomBytes(3).toString('hex')}`);
        const el = baseDefaults({ ...rest, id, type, x: Number(rest.x ?? 0), y: Number(rest.y ?? 0) } as Partial<ExcalidrawElement>);

        if (type === 'text') {
            const text = String(el.text ?? '');
            el.text = text;
            el.originalText = el.originalText ?? text;
            el.fontSize = el.fontSize ?? 20;
            el.fontFamily = el.fontFamily ?? 5;
            el.textAlign = el.textAlign ?? 'left';
            el.verticalAlign = el.verticalAlign ?? 'top';
            el.containerId = el.containerId ?? null;
            el.lineHeight = el.lineHeight ?? LINE_HEIGHT;
            el.autoResize = el.autoResize ?? true;
            const size = textSize(text, el.fontSize, el.lineHeight);
            el.width = Number(rest.width ?? size.width);
            el.height = Number(rest.height ?? size.height);
        }

        if (LINEAR_TYPES.has(type)) {
            el.points = el.points ?? [[0, 0], [Number(rest.width ?? 100), Number(rest.height ?? 0)]];
            el.lastCommittedPoint = el.lastCommittedPoint ?? null;
            el.startBinding = el.startBinding ?? null;
            el.endBinding = el.endBinding ?? null;
            el.startArrowhead = el.startArrowhead ?? null;
            el.endArrowhead = el.endArrowhead !== undefined ? el.endArrowhead : (type === 'arrow' ? 'arrow' : null);
            if (type === 'arrow') el.elbowed = el.elbowed ?? false;
            if (from !== undefined || to !== undefined) {
                connections.push({ arrow: el, from: from as string | undefined, to: to as string | undefined });
            }
        }

        if (typeof label === 'string' && label !== '') {
            labels.push({ owner: el, text: label, spec: { fontSize: labelFontSize } });
        }

        if (typeof orgLink === 'string' && orgLink.trim()) {
            el.link = orgLinkUri(orgLink.trim());
            el.customData = { ...(el.customData ?? {}), orgLink: orgLink.trim() };
        }

        el.width = Number(el.width ?? 0);
        el.height = Number(el.height ?? 0);
        elements.push(el);
        byId.set(id, el);
    }

    // Size shapes to their labels before arrows are routed between them.
    for (const { owner, text, spec } of labels) {
        if (!CONTAINER_TYPES.has(owner.type)) continue;
        const size = textSize(text, Number(spec.fontSize ?? 20));
        const grow = owner.type === 'rectangle' ? 1 : 1.5;
        if (!owner.width) owner.width = Math.ceil(size.width * grow + 2 * LABEL_PADDING);
        if (!owner.height) owner.height = Math.ceil(size.height * grow + 2 * LABEL_PADDING);
    }

    for (const { arrow, from, to } of connections) {
        const start = from ? byId.get(from) : undefined;
        const end = to ? byId.get(to) : undefined;
        const gap = 4;
        const centre = (e: ExcalidrawElement): [number, number] => [e.x + e.width / 2, e.y + e.height / 2];
        const pts = arrow.points ?? [];
        let p0: [number, number] = [arrow.x + (pts[0]?.[0] ?? 0), arrow.y + (pts[0]?.[1] ?? 0)];
        let p1: [number, number] = [arrow.x + (pts[pts.length - 1]?.[0] ?? 100), arrow.y + (pts[pts.length - 1]?.[1] ?? 0)];
        if (start && end) {
            p0 = edgePoint(start, ...centre(end), gap);
            p1 = edgePoint(end, ...centre(start), gap);
        } else if (start) {
            p0 = edgePoint(start, ...p1, gap);
        } else if (end) {
            p1 = edgePoint(end, ...p0, gap);
        }
        arrow.x = p0[0];
        arrow.y = p0[1];
        arrow.points = [[0, 0], [p1[0] - p0[0], p1[1] - p0[1]]];
        arrow.width = Math.abs(p1[0] - p0[0]);
        arrow.height = Math.abs(p1[1] - p0[1]);
        if (start) {
            arrow.startBinding = { elementId: start.id, focus: 0, gap };
            addBound(start, arrow.id, 'arrow');
        }
        if (end) {
            arrow.endBinding = { elementId: end.id, focus: 0, gap };
            addBound(end, arrow.id, 'arrow');
        }
    }

    for (const { owner, text, spec } of labels) {
        const fontSize = Number(spec.fontSize ?? (LINEAR_TYPES.has(owner.type) ? 16 : 20));
        const size = textSize(text, fontSize);
        let cx = owner.x + owner.width / 2;
        let cy = owner.y + owner.height / 2;
        if (LINEAR_TYPES.has(owner.type) && owner.points?.length) {
            const mid = owner.points[Math.floor((owner.points.length - 1) / 2)];
            const next = owner.points[Math.min(owner.points.length - 1, Math.floor((owner.points.length - 1) / 2) + 1)];
            cx = owner.x + (mid[0] + next[0]) / 2;
            cy = owner.y + (mid[1] + next[1]) / 2;
        }
        const textId = `${owner.id}-label`;
        const textEl = baseDefaults({
            id: textId,
            type: 'text',
            x: cx - size.width / 2,
            y: cy - size.height / 2,
            width: size.width,
            height: size.height,
            text,
            originalText: text,
            fontSize,
            fontFamily: 5,
            textAlign: 'center',
            verticalAlign: 'middle',
            containerId: owner.id,
            lineHeight: LINE_HEIGHT,
            autoResize: true,
            strokeColor: owner.strokeColor,
            roundness: null,
        });
        addBound(owner, textId, 'text');
        const at = elements.indexOf(owner);
        elements.splice(at + 1, 0, textEl);
        byId.set(textId, textEl);
    }

    return {
        type: 'excalidraw',
        version: 2,
        source: raw.source ?? 'https://github.com/jkitchin/scimax_vscode',
        elements,
        appState: { gridSize: null, viewBackgroundColor: '#ffffff', ...(raw.appState ?? {}) },
        files: raw.files ?? {},
    };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/** Problems that make the editor drop or misplace elements. */
export function checkScene(scene: ExcalidrawScene): string[] {
    const problems: string[] = [];
    if (scene.type !== 'excalidraw') problems.push('top-level "type" must be "excalidraw"');
    if (!Array.isArray(scene.elements)) return [...problems, '"elements" must be an array'];
    const byId = new Map<string, ExcalidrawElement>();
    for (const el of scene.elements) {
        if (!el.id) problems.push(`a ${el.type} element has no id`);
        else if (byId.has(el.id)) problems.push(`duplicate id "${el.id}"`);
        else byId.set(el.id, el);
    }
    for (const el of scene.elements) {
        if (el.isDeleted) continue;
        for (const f of ['x', 'y', 'width', 'height'] as const) {
            if (typeof el[f] !== 'number' || !Number.isFinite(el[f])) problems.push(`${el.id}: ${f} is not a number`);
        }
        if (el.containerId) {
            const c = byId.get(el.containerId);
            if (!c) problems.push(`${el.id}: containerId "${el.containerId}" does not exist`);
            else if (!c.boundElements?.some(b => b.id === el.id)) {
                problems.push(`${el.id}: container "${c.id}" does not list it in boundElements`);
            }
        }
        for (const b of el.boundElements ?? []) {
            const other = byId.get(b.id);
            if (!other) problems.push(`${el.id}: bound element "${b.id}" does not exist`);
            else if (b.type === 'text' && other.containerId !== el.id) {
                problems.push(`${el.id}: bound text "${b.id}" has containerId "${other.containerId}"`);
            }
        }
        for (const which of ['startBinding', 'endBinding'] as const) {
            const binding = el[which];
            if (binding && !byId.has(binding.elementId)) {
                problems.push(`${el.id}: ${which} points at missing "${binding.elementId}"`);
            }
        }
        if (LINEAR_TYPES.has(el.type) && (!Array.isArray(el.points) || el.points.length < 2)) {
            problems.push(`${el.id}: ${el.type} needs at least two points`);
        }
        if (el.type === 'text' && typeof el.text !== 'string') problems.push(`${el.id}: text element has no text`);
        if (el.type === 'image' && el.fileId && !scene.files?.[el.fileId]) {
            problems.push(`${el.id}: image file "${el.fileId}" is not in "files"`);
        }
    }
    return problems;
}

/** Every element link, with the org link behind it when it is a scimax URI. */
export function sceneLinks(scene: ExcalidrawScene): { id: string; text?: string; link: string; orgLink?: string }[] {
    const textOf = new Map<string, string>();
    for (const el of scene.elements) {
        if (el.type === 'text' && el.containerId && !el.isDeleted) textOf.set(el.containerId, String(el.text ?? ''));
    }
    return scene.elements
        .filter(el => !el.isDeleted && el.link)
        .map(el => ({
            id: el.id,
            text: el.type === 'text' ? el.text : textOf.get(el.id),
            link: el.link as string,
            orgLink: parseOrgLinkUri(el.link as string)?.link,
        }));
}

// ---------------------------------------------------------------------------
// Payload embedded in .excalidraw.svg
// ---------------------------------------------------------------------------

/** Base64 payload in the format Excalidraw writes (v2, deflated byte string). */
export function encodeScenePayload(scene: ExcalidrawScene): string {
    const json = JSON.stringify(scene);
    const deflated = zlib.deflateSync(Buffer.from(json, 'utf8'));
    const wrapper = { version: '1', encoding: 'bstring', compressed: true, encoded: deflated.toString('latin1') };
    return Buffer.from(JSON.stringify(wrapper), 'latin1').toString('base64');
}

/** Scene stored in an `.excalidraw.svg`, or null when there is none. */
export function decodeScenePayload(svg: string): ExcalidrawScene | null {
    if (!svg.includes(`payload-type:${PAYLOAD_TYPE}`)) return null;
    const match = svg.match(/<!-- payload-start -->\s*(.+?)\s*<!-- payload-end -->/s);
    if (!match) return null;
    const version = svg.match(/<!-- payload-version:(\d+) -->/)?.[1] ?? '1';
    try {
        const bytes = Buffer.from(match[1], 'base64');
        const text = version === '1' ? bytes.toString('utf8') : bytes.toString('latin1');
        const parsed = JSON.parse(text);
        if (!('encoded' in parsed)) return parsed.type === 'excalidraw' ? parsed : null;
        const raw = Buffer.from(parsed.encoded as string, 'latin1');
        const json = parsed.compressed ? zlib.inflateSync(raw).toString('utf8') : raw.toString('utf8');
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/** Read a scene from `.excalidraw` / `.excalidraw.json` JSON or an `.excalidraw.svg`. */
export function parseSceneFile(content: string, fileName: string): ExcalidrawScene | null {
    if (/\.svg$/i.test(fileName)) return decodeScenePayload(content);
    try {
        const parsed = JSON.parse(content);
        return parsed && Array.isArray(parsed.elements) ? parsed : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderOptions {
    /** Fit inside this box (keeps aspect ratio, never scales up). */
    maxWidth?: number;
    maxHeight?: number;
    /** Padding around the drawing, in scene units (default 10). */
    padding?: number;
    /** Embed the scene so the Excalidraw editor can reopen the SVG. */
    embedScene?: boolean;
    /** Wrap linked elements in <a href> (default true). */
    links?: boolean;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function color(c: string | undefined, fallback: string): string {
    if (!c || c === 'transparent') return fallback;
    return /^[#\w(),.\s%-]+$/.test(c) ? c : fallback;
}

function fontFamilyCss(family: number | undefined): string {
    switch (family) {
        case 2: case 6: return "Helvetica, Arial, 'Segoe UI', sans-serif";
        case 3: case 8: return "'Cascadia Code', Menlo, Consolas, monospace";
        default: return "Excalifont, Virgil, 'Comic Sans MS', 'Segoe Print', 'Chalkboard SE', cursive";
    }
}

function dashArray(el: ExcalidrawElement): string {
    const sw = el.strokeWidth ?? 2;
    if (el.strokeStyle === 'dashed') return ` stroke-dasharray="8 ${8 + sw}"`;
    if (el.strokeStyle === 'dotted') return ` stroke-dasharray="1.5 ${6 + sw}" stroke-linecap="round"`;
    return '';
}

function cornerRadius(el: ExcalidrawElement): number {
    if (!el.roundness) return 0;
    const size = Math.min(el.width, el.height);
    if (el.roundness.type === 3) return size <= 128 ? size * 0.25 : 32;
    return size * 0.25;
}

function boundsOf(elements: ExcalidrawElement[]): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
        const pts: [number, number][] = el.points?.length
            ? el.points.map(([px, py]) => [el.x + px, el.y + py])
            : [[el.x, el.y], [el.x + (el.width || 0), el.y + (el.height || 0)]];
        for (const [px, py] of pts) {
            minX = Math.min(minX, px); minY = Math.min(minY, py);
            maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
        }
    }
    return [minX, minY, maxX, maxY];
}

function arrowhead(kind: string | null | undefined, tip: [number, number], from: [number, number], stroke: string, sw: number): string {
    if (!kind) return '';
    const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    const size = 10 + sw * 2;
    const [x, y] = tip;
    const wing = (a: number) => `${x - size * Math.cos(angle + a)},${y - size * Math.sin(angle + a)}`;
    switch (kind) {
        case 'triangle':
            return `<polygon points="${x},${y} ${wing(0.4)} ${wing(-0.4)}" fill="${stroke}" stroke="${stroke}" stroke-width="${sw}"/>`;
        case 'dot': case 'circle':
            return `<circle cx="${x}" cy="${y}" r="${3 + sw}" fill="${stroke}"/>`;
        case 'bar':
            return `<polyline points="${wing(Math.PI / 2)} ${wing(-Math.PI / 2)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
        default:
            return `<polyline points="${wing(0.45)} ${x},${y} ${wing(-0.45)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
}

/**
 * Render a scene to standalone SVG. This is a clean, non-sketchy rendering
 * (no rough.js); the Excalidraw editor redraws it in its own style the next
 * time it saves the file.
 */
export function renderSceneSvg(scene: ExcalidrawScene, options: RenderOptions = {}): string | null {
    const elements = (scene.elements ?? []).filter(el => !el.isDeleted);
    if (elements.length === 0) return null;
    const padding = options.padding ?? 10;
    const [minX0, minY0, maxX0, maxY0] = boundsOf(elements);
    const minX = minX0 - padding, minY = minY0 - padding;
    const width = maxX0 - minX0 + 2 * padding;
    const height = maxY0 - minY0 + 2 * padding;
    const scale = Math.min(
        options.maxWidth ? options.maxWidth / width : 1,
        options.maxHeight ? options.maxHeight / height : 1,
        1
    );
    const bg = color(scene.appState?.viewBackgroundColor, '#ffffff');
    const byId = new Map(elements.map(el => [el.id, el]));
    const useLinks = options.links !== false;
    const patterns = new Map<string, string>();

    const fillFor = (el: ExcalidrawElement): string => {
        const bgColor = el.backgroundColor;
        if (!bgColor || bgColor === 'transparent') return 'none';
        const c = color(bgColor, 'none');
        if (el.fillStyle === 'solid' || c === 'none') return c;
        const key = `${el.fillStyle}-${c}`;
        if (!patterns.has(key)) {
            const id = `fill-${patterns.size}`;
            const cross = el.fillStyle === 'cross-hatch'
                ? `<path d="M0,0 L0,8" stroke="${c}" stroke-width="1.5"/>` : '';
            patterns.set(key, `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0,0 L8,0" stroke="${c}" stroke-width="1.5"/>${cross}</pattern>`);
        }
        return `url(#${patterns.get(key)!.match(/id="([^"]+)"/)![1]})`;
    };

    const shapes: string[] = [];
    for (const el of elements) {
        const x = el.x - minX;
        const y = el.y - minY;
        const w = el.width || 0;
        const h = el.height || 0;
        const stroke = color(el.strokeColor, '#1e1e1e');
        const sw = el.strokeWidth ?? 2;
        const common = `stroke="${stroke}" stroke-width="${sw}"${dashArray(el)}`;
        let svg = '';

        switch (el.type) {
            case 'rectangle': case 'frame': case 'magicframe': {
                const r = cornerRadius(el);
                svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fillFor(el)}" ${common}/>`;
                break;
            }
            case 'ellipse':
                svg = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fillFor(el)}" ${common}/>`;
                break;
            case 'diamond': {
                const cx = x + w / 2, cy = y + h / 2;
                svg = `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fillFor(el)}" ${common} stroke-linejoin="round"/>`;
                break;
            }
            case 'line': case 'arrow': case 'freedraw': {
                const pts = (el.points ?? []).map(([px, py]) => [x + px, y + py] as [number, number]);
                if (pts.length < 2) break;
                const closed = el.type === 'line' && pts.length > 2
                    && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
                const fill = closed ? fillFor(el) : 'none';
                svg = `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="${fill}" ${common} stroke-linecap="round" stroke-linejoin="round"/>`;
                if (el.type === 'arrow') {
                    svg += arrowhead(el.endArrowhead, pts[pts.length - 1], pts[pts.length - 2], stroke, sw);
                    svg += arrowhead(el.startArrowhead, pts[0], pts[1], stroke, sw);
                }
                break;
            }
            case 'text': {
                const fontSize = el.fontSize ?? 20;
                const lh = fontSize * (el.lineHeight ?? LINE_HEIGHT);
                const lines = String(el.text ?? '').split('\n');
                const align = el.textAlign ?? 'left';
                const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
                const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
                const spans = lines.map((line, i) =>
                    `<tspan x="${tx}" y="${y + i * lh + lh / 2}">${esc(line) || ' '}</tspan>`).join('');
                // Labels on arrows hide the line behind them, as in Excalidraw
                const container = el.containerId ? byId.get(el.containerId) : undefined;
                const mask = container && LINEAR_TYPES.has(container.type)
                    ? `<rect x="${x - 4}" y="${y - 2}" width="${w + 8}" height="${h + 4}" fill="${bg}"/>`
                    : '';
                svg = mask + `<text font-family="${esc(fontFamilyCss(el.fontFamily))}" font-size="${fontSize}" fill="${stroke}" text-anchor="${anchor}" dominant-baseline="central" style="white-space: pre">${spans}</text>`;
                break;
            }
            case 'image': {
                const file = el.fileId ? scene.files?.[el.fileId] : undefined;
                svg = file?.dataURL && /^data:image\//.test(file.dataURL)
                    ? `<image href="${esc(file.dataURL)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`
                    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e0e0e0" stroke="#666"/>`;
                break;
            }
            default:
                continue;
        }
        if (!svg) continue;

        if (el.angle) {
            const deg = (el.angle * 180) / Math.PI;
            svg = `<g transform="rotate(${deg} ${x + w / 2} ${y + h / 2})">${svg}</g>`;
        }
        const opacity = (el.opacity ?? 100) / 100;
        if (opacity < 1) svg = `<g opacity="${opacity}">${svg}</g>`;

        // Bound text follows its container's link, so the label is clickable too
        const owner = el.link ? el : (el.containerId ? byId.get(el.containerId) : undefined);
        const link = owner?.link;
        if (useLinks && link && !/^\s*(javascript|data|vbscript):/i.test(link)) {
            const title = (owner?.customData?.orgLink as string | undefined) ?? parseOrgLinkUri(link)?.link ?? link;
            svg = `<a href="${esc(link)}"><title>${esc(title)}</title>${svg}</a>`;
        }
        shapes.push(svg);
    }

    const metadata = options.embedScene
        ? `<!-- svg-source:excalidraw --><metadata><!-- payload-type:${PAYLOAD_TYPE} --><!-- payload-version:2 --><!-- payload-start -->${encodeScenePayload(scene)}<!-- payload-end --></metadata>`
        : '';
    const defs = patterns.size ? `<defs>${[...patterns.values()].join('')}</defs>` : '';
    const vw = Math.ceil(width * scale);
    const vh = Math.ceil(height * scale);
    return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${vw}" height="${vh}" viewBox="0 0 ${width} ${height}">${metadata}${defs}
<rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>
${shapes.join('\n')}
</svg>
`;
}

// ---------------------------------------------------------------------------
// Using an SVG inside exported HTML
// ---------------------------------------------------------------------------

/**
 * Make an SVG safe to inline into HTML and rewrite its links: scripts,
 * foreignObject, event handlers and script URLs are dropped, and each href
 * goes through `rewrite` (return null to drop the link but keep its shape).
 */
export function prepareSvgForHtml(svg: string, rewrite: (href: string) => string | null): string {
    let out = svg
        .replace(/<\?xml[^>]*\?>/g, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<metadata>[\s\S]*?<\/metadata>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<script[^>]*\/>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');

    const decodeEntities = (s: string) => s
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    out = out.replace(/<a\b([^>]*?)\s(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>/gi,
        (_m, before: string, _attr: string, _q: string, dq: string | undefined, sq: string | undefined, after: string) => {
            const href = decodeEntities(dq ?? sq ?? '');
            const next = /^\s*(javascript|data|vbscript):/i.test(href) ? null : rewrite(href);
            const rest = `${before}${after}`.replace(/\s+target\s*=\s*("[^"]*"|'[^']*')/gi, '');
            return next === null ? `<a${rest}>` : `<a${rest} href="${esc(next)}">`;
        });
    return out.trim();
}
