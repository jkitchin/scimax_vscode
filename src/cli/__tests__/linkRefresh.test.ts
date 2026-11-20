/**
 * Tests for repointing an `npm link`ed scimax CLI after an extension update (issue #97).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { globalModulesDir, npmGlobalPrefixes, refreshCliLink, PACKAGE_NAME } from '../linkRefresh';

const unix = process.platform !== 'win32';

describe.runIf(unix)('refreshCliLink', () => {
    let root: string;
    let prefix: string;
    let extensions: string;
    let link: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-link-'));
        prefix = path.join(root, 'prefix');
        extensions = path.join(root, 'extensions');
        fs.mkdirSync(globalModulesDir(prefix), { recursive: true });
        fs.mkdirSync(extensions);
        link = path.join(globalModulesDir(prefix), PACKAGE_NAME);
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const ext = (version: string) => {
        const dir = path.join(extensions, `jkitchin.scimax-vscode-${version}`);
        fs.mkdirSync(path.join(dir, 'out', 'cli'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'out', 'cli', 'index.js'), `// ${version}\n`, { mode: 0o644 });
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, bin: { scimax: './out/cli/index.js' } }));
        return dir;
    };

    it('does nothing without a link', () => {
        expect(refreshCliLink(ext('1.0.1'), { prefixes: [prefix] }).status).toBe('no-link');
        expect(fs.existsSync(link)).toBe(false);
    });

    it('repoints a link to an old version that was deleted', () => {
        const old = ext('1.0.0');
        fs.symlinkSync(old, link);
        fs.rmSync(old, { recursive: true });
        const current = ext('1.0.1');

        const result = refreshCliLink(current, { prefixes: [prefix] });
        expect(result.status).toBe('refreshed');
        expect(result.previousTarget).toBe(old);
        expect(fs.realpathSync(link)).toBe(fs.realpathSync(current));
        // The bin entry goes through the package link.
        expect(fs.readFileSync(path.join(link, 'out', 'cli', 'index.js'), 'utf-8')).toContain('1.0.1');
        expect(fs.readdirSync(globalModulesDir(prefix))).toEqual([PACKAGE_NAME]);
        // npm link makes bin files executable; an unpacked VSIX does not.
        expect(fs.statSync(path.join(current, 'out', 'cli', 'index.js')).mode & 0o111).toBe(0o111);
    });

    it('repoints a link to another installed version that still exists', () => {
        fs.symlinkSync(ext('1.0.0'), link);
        const current = ext('1.0.1');
        expect(refreshCliLink(current, { prefixes: [prefix] }).status).toBe('refreshed');
        expect(fs.realpathSync(link)).toBe(fs.realpathSync(current));
    });

    it('leaves a link that already points here', () => {
        const current = ext('1.0.1');
        fs.symlinkSync(current, link);
        expect(refreshCliLink(current, { prefixes: [prefix] }).status).toBe('up-to-date');
    });

    it('leaves a link to a development checkout', () => {
        const checkout = path.join(root, 'scimax_vscode');
        fs.mkdirSync(checkout);
        fs.symlinkSync(checkout, link);
        const result = refreshCliLink(ext('1.0.1'), { prefixes: [prefix] });
        expect(result.status).toBe('not-ours');
        expect(fs.readlinkSync(link)).toBe(checkout);
    });

    it('leaves a real global install alone', () => {
        fs.mkdirSync(link);
        expect(refreshCliLink(ext('1.0.1'), { prefixes: [prefix] }).status).toBe('no-link');
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    });
});

describe('npmGlobalPrefixes', () => {
    it('uses npm_config_prefix and the prefix of node on PATH', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-prefix-'));
        try {
            const bin = path.join(root, 'node-prefix', 'bin');
            fs.mkdirSync(bin, { recursive: true });
            fs.writeFileSync(path.join(bin, 'node'), '');
            const prefixes = npmGlobalPrefixes({ npm_config_prefix: path.join(root, 'custom'), PATH: bin }, 'linux');
            expect(prefixes[0]).toBe(path.join(root, 'custom'));
            expect(prefixes).toContain(fs.realpathSync(path.join(root, 'node-prefix')));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
