/**
 * The `scimax` command-line launcher (https://github.com/jkitchin/scimax_vscode/issues/97).
 *
 * The CLI ships inside the extension (out/cli/index.js), and VS Code installs
 * each version in a new folder (`jkitchin.scimax-vscode-<version>`) and
 * deletes the old one, so anything that points at one folder, like `npm link`,
 * breaks on every update. "Scimax: Install Command-Line Tool" instead writes a
 * small launcher to a folder on PATH. Each time it runs, the launcher looks in
 * the extensions folder for the newest installed version and runs that
 * version's CLI, so an update needs nothing redone, even before VS Code
 * starts again.
 *
 * On Unix the launcher is one executable Node script named `scimax`. On
 * Windows it is `scimax-launcher.js` plus a `scimax.cmd` that runs it.
 *
 * No VS Code dependency, so it can be unit tested directly.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Identifies a launcher this module wrote, so it may be replaced. */
export const LAUNCHER_MARKER = 'scimax-vscode-launcher';

/** Installed extension folders: jkitchin.scimax-vscode-1.2.3 (or -1.2.3-linux-x64). */
export const EXTENSION_DIR_PATTERN = /^jkitchin\.scimax-vscode-(\d+)\.(\d+)\.(\d+)(?:$|-)/i;

/** The launcher's JavaScript, set to search `extensionsDir`. */
export function launcherSource(extensionsDir: string): string {
    return `#!/usr/bin/env node
// ${LAUNCHER_MARKER}: written by the Scimax VS Code extension
// ("Scimax: Install Command-Line Tool"). It runs the command-line tool of the
// newest installed jkitchin.scimax-vscode extension, so updates need no
// reinstall. Set SCIMAX_EXTENSIONS_DIR to search another extensions folder.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.env.SCIMAX_EXTENSIONS_DIR || ${JSON.stringify(extensionsDir)};
const pattern = ${EXTENSION_DIR_PATTERN.toString()};

// Folders VS Code has replaced but not yet deleted.
let obsolete = {};
try { obsolete = JSON.parse(fs.readFileSync(path.join(dir, '.obsolete'), 'utf8')) || {}; } catch (e) { /* none */ }

let names = [];
try { names = fs.readdirSync(dir); } catch (e) { /* reported below */ }
const found = names
    .map(name => ({ name, m: pattern.exec(name) }))
    .filter(x => x.m && !obsolete[x.name])
    .map(x => ({ cli: path.join(dir, x.name, 'out', 'cli', 'index.js'), v: x.m.slice(1, 4).map(Number) }))
    .filter(x => fs.existsSync(x.cli))
    .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);

if (!found.length) {
    console.error('scimax: no installed Scimax VS Code extension found in ' + dir + '.');
    console.error('Install the extension, or set SCIMAX_EXTENSIONS_DIR to its extensions folder.');
    process.exit(1);
}
require(found[0].cli);
`;
}

/** The Windows wrapper that runs scimax-launcher.js next to it. */
export function windowsCmdSource(): string {
    return `@rem ${LAUNCHER_MARKER}: runs scimax-launcher.js in this folder\r\n@node "%~dp0scimax-launcher.js" %*\r\n`;
}

/** The files a launcher in `binDir` consists of; the first is the one on PATH. */
export function launcherFiles(binDir: string, platform: NodeJS.Platform = process.platform): string[] {
    return platform === 'win32'
        ? [path.join(binDir, 'scimax.cmd'), path.join(binDir, 'scimax-launcher.js')]
        : [path.join(binDir, 'scimax')];
}

/** True when `file` exists and is not a launcher this module wrote. */
export function isForeignFile(file: string): boolean {
    try {
        if (fs.lstatSync(file).isSymbolicLink()) return true;
        return !fs.readFileSync(file, 'utf-8').includes(LAUNCHER_MARKER);
    } catch {
        return false;
    }
}

/** Write the launcher into `binDir` (created if needed). Returns the command file. */
export function writeLauncher(binDir: string, extensionsDir: string, platform: NodeJS.Platform = process.platform): string {
    fs.mkdirSync(binDir, { recursive: true });
    const [command, script] = launcherFiles(binDir, platform);
    if (platform === 'win32') {
        fs.writeFileSync(script, launcherSource(extensionsDir));
        fs.writeFileSync(command, windowsCmdSource());
    } else {
        // Replace rather than write through, in case `scimax` is a symlink (e.g. from npm link).
        try { fs.unlinkSync(command); } catch { /* not there */ }
        fs.writeFileSync(command, launcherSource(extensionsDir), { mode: 0o755 });
        fs.chmodSync(command, 0o755);
    }
    return command;
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
    return (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
    const norm = (p: string) => {
        const r = path.resolve(p).replace(/[\\/]+$/, '');
        return platform === 'win32' || platform === 'darwin' ? r.toLowerCase() : r;
    };
    return norm(a) === norm(b);
}

/** True when `dir` is on PATH. */
export function isOnPath(dir: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
    return pathEntries(env).some(p => samePath(p, dir, platform));
}

/** The `scimax` command a shell would run (the first on PATH), if any. */
export function findOnPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
    const names = platform === 'win32' ? ['scimax.cmd', 'scimax.exe', 'scimax.ps1'] : ['scimax'];
    for (const dir of pathEntries(env)) {
        for (const name of names) {
            const file = path.join(dir, name);
            try {
                fs.lstatSync(file);
                return file;
            } catch { /* not here */ }
        }
    }
    return undefined;
}

/**
 * True when `file` is an `npm link` to the extension left stale by an update:
 * a symlink through `scimax-vscode` whose target is gone, or that resolves
 * into an installed extension folder other than `currentExtensionPath`.
 * A link to a development checkout is not stale.
 */
export function isStaleNpmLink(file: string, currentExtensionPath: string): boolean {
    let link: string;
    try {
        if (!fs.lstatSync(file).isSymbolicLink()) return false;
        link = fs.readlinkSync(file);
    } catch {
        return false;
    }
    if (!/scimax-vscode/.test(link)) return false;
    let real: string;
    try {
        real = fs.realpathSync(file);
    } catch {
        return true; // the version it pointed at was deleted
    }
    let current = path.resolve(currentExtensionPath);
    try { current = fs.realpathSync(current); } catch { /* keep */ }
    if (real.startsWith(current + path.sep)) return false;
    const rel = path.relative(path.dirname(current), real);
    return !rel.startsWith('..') && EXTENSION_DIR_PATTERN.test(rel.split(path.sep)[0]);
}
