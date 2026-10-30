import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fitImageBox, imageHoverMarkdown, readImageSize, HOVER_IMAGE_MAX_HEIGHT } from '../imageHover';

function tmpFile(name: string, data: Buffer | string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imghover-'));
    const p = path.join(dir, name);
    fs.writeFileSync(p, data);
    return p;
}

function pngHeader(w: number, h: number): Buffer {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
}

describe('imageHover', () => {
    it('reads PNG and SVG sizes', () => {
        expect(readImageSize(tmpFile('a.png', pngHeader(640, 480)))).toEqual({ width: 640, height: 480 });
        expect(readImageSize(tmpFile('a.svg', '<svg xmlns="x" viewBox="0 0 120 60"></svg>')))
            .toEqual({ width: 120, height: 60 });
        expect(readImageSize(tmpFile('b.png', 'not a png'))).toBeUndefined();
    });

    it('fits an image inside the hover box without enlarging it', () => {
        expect(fitImageBox({ width: 640, height: 480 })).toEqual({ width: 347, height: HOVER_IMAGE_MAX_HEIGHT });
        expect(fitImageBox({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
        expect(fitImageBox({ width: 2000, height: 100 })).toEqual({ width: 480, height: 24 });
    });

    it('puts the actions before the image and sizes it', () => {
        const p = tmpFile('plot.png', pngHeader(640, 480));
        const md = imageHoverMarkdown(p, { toString: () => 'file:///x/plot.png' }, { info: '1.0 KB' });
        const img = md.indexOf('<img');
        expect(md.indexOf('command:vscode.open')).toBeGreaterThan(-1);
        expect(md.indexOf('command:vscode.open')).toBeLessThan(img);
        expect(md).toContain('640×480 · 1.0 KB');
        expect(md).toContain('width="347" height="260"');
    });
});
