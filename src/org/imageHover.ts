/**
 * Image preview markup for hovers. VS Code caps a hover's height, so an image
 * sized by width alone (a tall or 4:3 plot) gets clipped and pushes the links
 * under it out of view. These helpers size the image to fit a box from its
 * real dimensions and put the actions above it. No vscode import, so it is
 * unit-testable; callers wrap the markdown in a trusted MarkdownString.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ImageSize {
    width: number;
    height: number;
}

/** Largest preview that stays inside the default hover without scrolling */
export const HOVER_IMAGE_MAX_WIDTH = 480;
export const HOVER_IMAGE_MAX_HEIGHT = 260;

/**
 * Read an image's pixel size from its header (PNG, GIF, BMP, JPEG, WebP VP8X,
 * SVG width/height or viewBox). Returns undefined when it can't tell.
 */
export function readImageSize(filePath: string): ImageSize | undefined {
    try {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.svg') {
            const head = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
            const svgTag = head.match(/<svg\b[^>]*>/i)?.[0] ?? '';
            const num = (attr: string) => {
                const m = svgTag.match(new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i'));
                return m ? parseFloat(m[1]) : undefined;
            };
            const w = num('width');
            const h = num('height');
            if (w && h) return { width: w, height: h };
            const vb = svgTag.match(/\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
            return vb ? { width: parseFloat(vb[1]), height: parseFloat(vb[2]) } : undefined;
        }

        const buf = readHead(filePath, 64 * 1024);
        if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
            return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
        }
        if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
            return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
        }
        if (buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') {
            return { width: buf.readUInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
        }
        if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
            && buf.toString('ascii', 12, 16) === 'VP8X') {
            return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
        }
        if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
            return jpegSize(buf);
        }
    } catch {
        // Unreadable: no size
    }
    return undefined;
}

function readHead(filePath: string, bytes: number): Buffer {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(bytes);
        const n = fs.readSync(fd, buf, 0, bytes, 0);
        return buf.subarray(0, n);
    } finally {
        fs.closeSync(fd);
    }
}

/** Scan JPEG segments for a start-of-frame marker */
function jpegSize(buf: Buffer): ImageSize | undefined {
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return undefined;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        // SOF0-SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
    }
    return undefined;
}

/**
 * Scale size down (never up) to fit inside maxWidth x maxHeight, keeping its
 * aspect ratio. Without a size, fall back to a box-sized width.
 */
export function fitImageBox(
    size: ImageSize | undefined,
    maxWidth = HOVER_IMAGE_MAX_WIDTH,
    maxHeight = HOVER_IMAGE_MAX_HEIGHT
): { width: number; height?: number } {
    if (!size || size.width <= 0 || size.height <= 0) {
        return { width: Math.min(maxWidth, Math.round(maxHeight * 4 / 3)) };
    }
    const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
    return {
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
    };
}

/**
 * Hover markdown for an image file: a title line with the size and actions,
 * then the image fitted to the hover. uri is the file's vscode.Uri (passed in
 * to keep this module vscode-free); imageSrc overrides the image source, e.g.
 * a data: URI for a generated preview.
 */
export function imageHoverMarkdown(
    filePath: string,
    uri: { toString(): string },
    options: { title?: string; info?: string; imageSrc?: string; size?: ImageSize } = {}
): string {
    const size = options.size ?? readImageSize(filePath);
    const box = fitImageBox(size);
    const args = encodeURIComponent(JSON.stringify([uri]));
    const title = options.title || path.basename(filePath);

    const details = [
        size ? `${Math.round(size.width)}×${Math.round(size.height)}` : undefined,
        options.info,
    ].filter(Boolean).join(' · ');

    const actions = [
        `[Open](command:vscode.open?${args} "Open the image in an editor tab")`,
        `[Reveal](command:revealFileInOS?${args} "Reveal in the file manager")`,
    ].join(' · ');

    const dims = box.height !== undefined
        ? `width="${box.width}" height="${box.height}"`
        : `width="${box.width}"`;
    const src = options.imageSrc ?? uri.toString();

    return `**${escapeMd(title)}**${details ? ` — ${details}` : ''} · ${actions}\n\n`
        + `<img src="${src}" ${dims} />\n\n`;
}

function escapeMd(text: string): string {
    return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}
