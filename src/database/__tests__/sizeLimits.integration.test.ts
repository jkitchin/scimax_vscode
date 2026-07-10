/**
 * Size-limit indexing tests (issue #47 audit, item D1).
 *
 * ScimaxDbCore honors maxFileSizeMB / maxParseSizeKB / maxFileLines, but the
 * VS Code ScimaxDb subclass never populated those options from configuration,
 * so the settings were silently ignored in the editor (they only worked in the
 * CLI). setSizeLimits() is the seam the subclass now uses; these tests exercise
 * it directly and guard the parity between package.json and CLI defaults.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ScimaxDbCore } from '../scimaxDbCore';

let baseDir: string;

beforeAll(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-sizelimit-'));
});

afterAll(() => {
    try {
        fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
        // best-effort
    }
});

/**
 * Write a fixture .org file with a known :ID: heading and index it into a
 * fresh core configured with the given size limits. Returns whether the
 * heading made it into the database (i.e. the file was not skipped).
 */
async function indexWithLimits(
    name: string,
    content: string,
    limits: { maxFileSizeMB?: number; maxParseSizeKB?: number; maxFileLines?: number },
): Promise<boolean> {
    const dir = fs.mkdtempSync(path.join(baseDir, `${name}-`));
    const filePath = path.join(dir, `${name}.org`);
    fs.writeFileSync(filePath, content);

    const db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
    db.setSizeLimits(limits);
    await db.initialize();
    try {
        await db.indexFile(filePath);
        const heading = await db.getHeadingById(`${name}-id`);
        return heading !== null;
    } finally {
        await db.close?.();
    }
}

function fixture(name: string, bodyLines = 0): string {
    const lines = [
        `* Heading for ${name}`,
        ':PROPERTIES:',
        `:ID: ${name}-id`,
        ':END:',
    ];
    for (let i = 0; i < bodyLines; i++) lines.push(`Body line ${i}`);
    return lines.join('\n');
}

describe('ScimaxDbCore size limits', () => {
    it('indexes a normal file under all default limits', async () => {
        const indexed = await indexWithLimits('normal', fixture('normal'), {});
        expect(indexed).toBe(true);
    });

    it('skips a file larger than maxFileSizeMB', async () => {
        const content = fixture('big') + '\n' + 'x'.repeat(2000);
        // ~0.001 MB ≈ 1 KB threshold; the >2 KB fixture exceeds it.
        const skipped = await indexWithLimits('big', content, { maxFileSizeMB: 0.001 });
        expect(skipped).toBe(false);
    });

    it('indexes the same file when maxFileSizeMB is generous', async () => {
        const content = fixture('big2') + '\n' + 'x'.repeat(2000);
        const indexed = await indexWithLimits('big2', content, { maxFileSizeMB: 10 });
        expect(indexed).toBe(true);
    });

    it('skips a file larger than maxParseSizeKB (but under maxFileSizeMB)', async () => {
        const content = fixture('parse') + '\n' + 'x'.repeat(3000);
        // maxFileSizeMB generous so the size gate passes; maxParseSizeKB tiny
        // (~1 KB) so the >3 KB fixture is skipped for parsing.
        const skipped = await indexWithLimits('parse', content, {
            maxFileSizeMB: 10,
            maxParseSizeKB: 1,
        });
        expect(skipped).toBe(false);
    });

    it('skips a file with more lines than maxFileLines', async () => {
        // Many short lines: small byte size (passes size/parse gates) but a
        // high line count that trips the maxFileLines guard.
        const content = fixture('lines', 60);
        const skipped = await indexWithLimits('lines', content, {
            maxFileSizeMB: 10,
            maxParseSizeKB: 500,
            maxFileLines: 5,
        });
        expect(skipped).toBe(false);
    });

    it('indexes a file whose line count is within maxFileLines', async () => {
        const content = fixture('lines2', 60);
        const indexed = await indexWithLimits('lines2', content, {
            maxFileSizeMB: 10,
            maxParseSizeKB: 500,
            maxFileLines: 5000,
        });
        expect(indexed).toBe(true);
    });
});

describe('size-limit defaults parity (package.json vs CLI)', () => {
    const pkg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    );
    const props: Record<string, any> = {};
    const cfg = pkg.contributes.configuration;
    for (const section of Array.isArray(cfg) ? cfg : [cfg]) {
        Object.assign(props, section.properties ?? {});
    }

    it('package.json declares the expected size-limit defaults', () => {
        expect(props['scimax.db.maxFileSizeMB'].default).toBe(10);
        expect(props['scimax.db.maxParseSizeKB'].default).toBe(500);
        expect(props['scimax.db.maxFileLines'].default).toBe(5000);
    });

    it('CLI settings defaults match package.json', () => {
        const cliSource = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'cli', 'settings.ts'),
            'utf8',
        );
        expect(cliSource).toContain("'scimax.db.maxFileSizeMB', 10");
        expect(cliSource).toContain("'scimax.db.maxFileLines', 5000");
    });
});
