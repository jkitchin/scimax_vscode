/**
 * Tests for the `scimax` launcher that follows extension updates (issue #97).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    findOnPath,
    isForeignFile,
    isOnPath,
    isStaleNpmLink,
    launcherFiles,
    launcherSource,
    windowsCmdSource,
    writeLauncher,
} from '../launcher';

const unix = process.platform !== 'win32';

let root: string;
let extensions: string;
let bin: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-launcher-'));
    extensions = path.join(root, 'extensions');
    bin = path.join(root, 'bin');
    fs.mkdirSync(extensions);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** A fake installed extension whose CLI prints its version and arguments. */
function ext(folder: string, withCli = true): string {
    const dir = path.join(extensions, folder);
    fs.mkdirSync(path.join(dir, 'out', 'cli'), { recursive: true });
    if (withCli) {
        fs.writeFileSync(
            path.join(dir, 'out', 'cli', 'index.js'),
            `console.log(${JSON.stringify(folder)} + ' ' + process.argv.slice(2).join(','));\n`
        );
    }
    return dir;
}

function run(launcher: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): string {
    return execFileSync(process.execPath, [launcher, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, SCIMAX_EXTENSIONS_DIR: '', ...env },
    }).trim();
}

describe('launcher script', () => {
    it('runs the newest installed version, passing the arguments through', () => {
        ext('jkitchin.scimax-vscode-0.9.12');
        ext('jkitchin.scimax-vscode-0.15.3');
        ext('jkitchin.scimax-vscode-0.15.10-linux-x64');
        ext('jkitchin.scimax-vscode-0.16.0', false); // half-installed: no CLI
        ext('someone.else-9.9.9');
        const command = writeLauncher(bin, extensions, 'linux');
        expect(run(command, ['db', 'stats'])).toBe('jkitchin.scimax-vscode-0.15.10-linux-x64 db,stats');
    });

    it('picks up an update with nothing reinstalled', () => {
        ext('jkitchin.scimax-vscode-1.0.0');
        const command = writeLauncher(bin, extensions, 'linux');
        expect(run(command)).toMatch(/^jkitchin.scimax-vscode-1.0.0/);
        fs.rmSync(path.join(extensions, 'jkitchin.scimax-vscode-1.0.0'), { recursive: true });
        ext('jkitchin.scimax-vscode-1.0.1');
        expect(run(command)).toMatch(/^jkitchin.scimax-vscode-1.0.1/);
    });

    it('skips versions VS Code has marked obsolete', () => {
        ext('jkitchin.scimax-vscode-1.0.0');
        ext('jkitchin.scimax-vscode-2.0.0');
        fs.writeFileSync(path.join(extensions, '.obsolete'), JSON.stringify({ 'jkitchin.scimax-vscode-2.0.0': true }));
        expect(run(writeLauncher(bin, extensions, 'linux'))).toMatch(/^jkitchin.scimax-vscode-1.0.0/);
    });

    it('honours SCIMAX_EXTENSIONS_DIR', () => {
        const other = path.join(root, 'other');
        fs.mkdirSync(path.join(other, 'jkitchin.scimax-vscode-3.0.0', 'out', 'cli'), { recursive: true });
        fs.writeFileSync(path.join(other, 'jkitchin.scimax-vscode-3.0.0', 'out', 'cli', 'index.js'), 'console.log("other")\n');
        expect(run(writeLauncher(bin, extensions, 'linux'), [], { SCIMAX_EXTENSIONS_DIR: other })).toBe('other');
    });

    it('explains when no extension is installed', () => {
        expect(() => execFileSync(process.execPath, [writeLauncher(bin, extensions, 'linux')], { stdio: 'pipe' }))
            .toThrow(/no installed Scimax VS Code extension found/);
    });

    it.runIf(unix)('is an executable file that replaces an old npm link', () => {
        fs.mkdirSync(bin);
        fs.symlinkSync(path.join(root, 'gone', 'index.js'), path.join(bin, 'scimax'));
        ext('jkitchin.scimax-vscode-1.0.0');
        const command = writeLauncher(bin, extensions, 'linux');
        expect(fs.lstatSync(command).isSymbolicLink()).toBe(false);
        expect(fs.statSync(command).mode & 0o111).toBe(0o111);
        expect(execFileSync(command, ['x'], { encoding: 'utf-8' }).trim()).toBe('jkitchin.scimax-vscode-1.0.0 x');
        expect(isForeignFile(command)).toBe(false);
    });

    it('writes a .cmd wrapper and a script on Windows', () => {
        ext('jkitchin.scimax-vscode-1.0.0');
        const command = writeLauncher(bin, extensions, 'win32');
        expect(command).toBe(path.join(bin, 'scimax.cmd'));
        expect(fs.readFileSync(command, 'utf-8')).toBe(windowsCmdSource());
        expect(windowsCmdSource()).toContain('"%~dp0scimax-launcher.js" %*');
        expect(run(path.join(bin, 'scimax-launcher.js'))).toMatch(/^jkitchin.scimax-vscode-1.0.0/);
        expect(launcherFiles(bin, 'win32').every(f => !isForeignFile(f))).toBe(true);
    });

    it('embeds the extensions folder as a string literal', () => {
        expect(launcherSource('C:\\Users\\a "b"\\ext')).toContain(JSON.stringify('C:\\Users\\a "b"\\ext'));
    });
});

describe('PATH helpers', () => {
    it('finds the first scimax on PATH', () => {
        const a = path.join(root, 'a');
        const b = path.join(root, 'b');
        fs.mkdirSync(a);
        fs.mkdirSync(b);
        fs.writeFileSync(path.join(b, 'scimax'), '');
        const env = { PATH: [a, b].join(path.delimiter) };
        expect(findOnPath(env, 'linux')).toBe(path.join(b, 'scimax'));
        expect(isOnPath(b + path.sep, env, 'linux')).toBe(true);
        expect(isOnPath(path.join(root, 'c'), env, 'linux')).toBe(false);
    });

    it('treats files it did not write as foreign', () => {
        fs.writeFileSync(path.join(root, 'scimax'), '#!/bin/sh\necho mine\n');
        expect(isForeignFile(path.join(root, 'scimax'))).toBe(true);
        expect(isForeignFile(path.join(root, 'missing'))).toBe(false);
    });
});

describe.runIf(unix)('isStaleNpmLink', () => {
    /** An npm-style link: bin/scimax -> ../lib/node_modules/scimax-vscode/out/cli/index.js */
    function npmLink(target: string): string {
        const modules = path.join(root, 'prefix', 'lib', 'node_modules');
        fs.mkdirSync(modules, { recursive: true });
        fs.mkdirSync(path.join(root, 'prefix', 'bin'), { recursive: true });
        fs.symlinkSync(target, path.join(modules, 'scimax-vscode'));
        const link = path.join(root, 'prefix', 'bin', 'scimax');
        fs.symlinkSync('../lib/node_modules/scimax-vscode/out/cli/index.js', link);
        return link;
    }

    it('is stale when the linked version was deleted', () => {
        const old = ext('jkitchin.scimax-vscode-1.0.0');
        const link = npmLink(old);
        fs.rmSync(old, { recursive: true });
        expect(isStaleNpmLink(link, ext('jkitchin.scimax-vscode-1.0.1'))).toBe(true);
    });

    it('is stale when it points at another installed version', () => {
        const link = npmLink(ext('jkitchin.scimax-vscode-1.0.0'));
        expect(isStaleNpmLink(link, ext('jkitchin.scimax-vscode-1.0.1'))).toBe(true);
    });

    it('is fine when it points at this version or a development checkout', () => {
        const current = ext('jkitchin.scimax-vscode-1.0.1');
        expect(isStaleNpmLink(npmLink(current), current)).toBe(false);
        fs.rmSync(path.join(root, 'prefix'), { recursive: true });
        const checkout = path.join(root, 'scimax_vscode');
        fs.mkdirSync(path.join(checkout, 'out', 'cli'), { recursive: true });
        fs.writeFileSync(path.join(checkout, 'out', 'cli', 'index.js'), '');
        expect(isStaleNpmLink(npmLink(checkout), current)).toBe(false);
    });

    it('ignores plain files and other links', () => {
        fs.writeFileSync(path.join(root, 'plain'), '');
        fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'other-link'));
        expect(isStaleNpmLink(path.join(root, 'plain'), root)).toBe(false);
        expect(isStaleNpmLink(path.join(root, 'other-link'), root)).toBe(false);
    });
});
