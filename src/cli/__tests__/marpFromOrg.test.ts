/**
 * Tests for the CLI's org -> Marp export (scimax export --format marp,
 * scimax marp build talk.org).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marpDeckPath, marpExportOptionsFromSettings, orgToMarp, writeMarpDeck } from '../marpFromOrg';

describe('marpExportOptionsFromSettings', () => {
    it('is empty with no settings, so the exporter defaults apply', () => {
        expect(marpExportOptionsFromSettings({})).toEqual({});
    });

    it('reads scimax.export.marp.* and lets workspace settings win', () => {
        const options = marpExportOptionsFromSettings(
            { 'scimax.export.marp.theme': 'gaia', 'scimax.export.marp.paginate': false, 'other.key': 1 },
            { 'scimax.export.marp.theme': 'scimax' },
        );
        expect(options).toEqual({ theme: 'scimax', paginate: false });
    });
});

describe('org to Marp', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-org-marp-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('names the deck after the org file, or #+EXPORT_FILE_NAME', () => {
        const org = path.join(dir, 'talk.org');
        expect(marpDeckPath(org, '* A\n')).toBe(path.join(dir, 'talk.md'));
        expect(marpDeckPath(org, '#+EXPORT_FILE_NAME: out/slides\n* A\n')).toBe(path.join(dir, 'out', 'slides.md'));
        expect(marpDeckPath(org, '#+EXPORT_FILE_NAME: slides.md\n* A\n')).toBe(path.join(dir, 'slides.md'));
    });

    it('writes a deck with the settings and in-file keywords', () => {
        const org = path.join(dir, 'talk.org');
        fs.writeFileSync(org, '#+TITLE: Talk\n#+MARP_PAGINATE: nil\n\n* First\n- a\n* Second\nHello\n');
        const deck = writeMarpDeck(org, { theme: 'gaia' });
        expect(deck).toBe(path.join(dir, 'talk.md'));
        const md = fs.readFileSync(deck, 'utf8');
        expect(md).toMatch(/^---\nmarp: true\n/);
        expect(md).toContain('theme: gaia');
        expect(md).toContain('paginate: false');
        expect(md).toContain('# First');
        expect(md).toContain('# Second');
    });

    it('expands #+INCLUDE relative to the org file', () => {
        fs.writeFileSync(path.join(dir, 'part.org'), '* Included slide\nFrom the include\n');
        const org = path.join(dir, 'talk.org');
        const md = orgToMarp(org, '#+TITLE: Talk\n\n* First\n#+INCLUDE: "part.org"\n');
        expect(md).toContain('Included slide');
        expect(md).toContain('From the include');
    });

    it('writes to --output when given', () => {
        const org = path.join(dir, 'talk.org');
        fs.writeFileSync(org, '* A\n');
        const out = path.join(dir, 'elsewhere.md');
        expect(writeMarpDeck(org, {}, out)).toBe(out);
        expect(fs.existsSync(out)).toBe(true);
    });
});
