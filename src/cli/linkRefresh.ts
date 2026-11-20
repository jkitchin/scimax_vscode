/**
 * Keep an `npm link`ed `scimax` command working across extension updates.
 *
 * `npm link` run in the installed extension's folder makes
 *
 *     <prefix>/lib/node_modules/scimax-vscode -> ~/.vscode/extensions/jkitchin.scimax-vscode-1.2.3
 *     <prefix>/bin/scimax -> ../lib/node_modules/scimax-vscode/out/cli/index.js
 *
 * (on Windows, `<prefix>\node_modules\scimax-vscode` and a `scimax.cmd` shim).
 * VS Code installs each version in a new folder and deletes the old one, so
 * after an update the package link points nowhere and `scimax` stops working
 * (https://github.com/jkitchin/scimax_vscode/issues/97). The `bin` entry goes
 * through the package link, so repointing that one link at the current
 * extension folder fixes the command.
 *
 * A link is only repointed when it already points at an installed copy of the
 * extension (a `*.scimax-vscode-<version>` folder) or at a folder that no
 * longer exists, so a link to a development checkout is left alone. Nothing is
 * created when there is no link.
 *
 * No VS Code dependency, so it can be unit tested directly.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const PACKAGE_NAME = 'scimax-vscode';

/** An installed extension folder, e.g. jkitchin.scimax-vscode-0.9.1 (or -0.9.1-linux-x64). */
const EXTENSION_DIR = /^[^.\\/]+\.scimax-vscode-\d+\.\d+\.\d+/i;

export type LinkRefreshStatus =
    | 'no-link'        // no linked package in any npm prefix
    | 'up-to-date'     // already points at this extension
    | 'not-ours'       // a working link to some other folder (e.g. a dev checkout): left alone
    | 'refreshed'      // repointed at this extension
    | 'failed';        // found a stale link but could not replace it

export interface LinkRefreshResult {
    status: LinkRefreshStatus;
    /** The package link that was examined. */
    link?: string;
    /** Where it pointed before. */
    previousTarget?: string;
    error?: string;
}

export interface LinkRefreshOptions {
    /** npm global prefixes to look in (default: npmGlobalPrefixes()). */
    prefixes?: string[];
    platform?: NodeJS.Platform;
}

/** `node_modules` under an npm global prefix. */
export function globalModulesDir(prefix: string, platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules');
}

/** `prefix=` from an .npmrc file, if it sets one. */
function npmrcPrefix(file: string): string | undefined {
    try {
        const m = /^\s*prefix\s*=\s*(.+?)\s*$/m.exec(fs.readFileSync(file, 'utf-8'));
        if (!m) return undefined;
        return m[1].replace(/^["']|["']$/g, '').replace(/^~(?=$|[\\/])/, os.homedir()).replace(/\$\{HOME\}/g, os.homedir());
    } catch {
        return undefined;
    }
}

/**
 * Likely npm global prefixes, without running npm: the npm_config_prefix and
 * PREFIX environment variables, `prefix=` in ~/.npmrc, and the prefix of each
 * `node` on PATH (nvm, Homebrew, /usr/local, Volta's and fnm's folders, ...).
 */
export function npmGlobalPrefixes(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
    const out: string[] = [];
    const add = (p?: string) => {
        if (p && !out.includes(path.resolve(p))) out.push(path.resolve(p));
    };
    add(env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX);
    add(npmrcPrefix(path.join(os.homedir(), '.npmrc')));
    if (platform === 'win32' && env.APPDATA) add(path.join(env.APPDATA, 'npm'));
    const nodeNames = platform === 'win32' ? ['node.exe'] : ['node'];
    for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
        for (const name of nodeNames) {
            const node = path.join(dir, name);
            if (!fs.existsSync(node)) continue;
            let real = node;
            try { real = fs.realpathSync(node); } catch { /* keep the PATH entry */ }
            // <prefix>/bin/node on Unix, <prefix>\node.exe on Windows.
            add(platform === 'win32' ? path.dirname(real) : path.dirname(path.dirname(real)));
        }
    }
    return out;
}

/** Repoint a stale `scimax-vscode` npm link at `extensionPath`. */
export function refreshCliLink(extensionPath: string, options: LinkRefreshOptions = {}): LinkRefreshResult {
    const platform = options.platform ?? process.platform;
    const prefixes = options.prefixes ?? npmGlobalPrefixes(process.env, platform);
    const here = path.resolve(extensionPath);
    let notOurs: LinkRefreshResult | undefined;

    for (const prefix of prefixes) {
        const link = path.join(globalModulesDir(prefix, platform), PACKAGE_NAME);
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(link);
        } catch {
            continue;
        }
        if (!stat.isSymbolicLink()) continue; // a real `npm install -g`: not a link to manage

        const raw = fs.readlinkSync(link);
        const target = path.resolve(path.dirname(link), raw);
        if (samePath(target, here)) {
            makeBinsExecutable(here, platform);
            return { status: 'up-to-date', link, previousTarget: target };
        }

        const stale = !fs.existsSync(target) || EXTENSION_DIR.test(path.basename(target));
        if (!stale) {
            notOurs ??= { status: 'not-ours', link, previousTarget: target };
            continue;
        }
        // Make the new link beside the old one, then rename over it, so there
        // is no moment without a link.
        const tmp = `${link}.scimax-${process.pid}-${Date.now()}`;
        try {
            fs.symlinkSync(here, tmp, platform === 'win32' ? 'junction' : 'dir');
            try {
                fs.renameSync(tmp, link);
            } catch {
                // Windows cannot rename over an existing junction.
                fs.unlinkSync(link);
                fs.renameSync(tmp, link);
            }
            makeBinsExecutable(here, platform);
            return { status: 'refreshed', link, previousTarget: target };
        } catch (error) {
            try { fs.unlinkSync(tmp); } catch { /* not created */ }
            return { status: 'failed', link, previousTarget: target, error: error instanceof Error ? error.message : String(error) };
        }
    }
    return notOurs ?? { status: 'no-link' };
}

/**
 * `npm link` marks the package's `bin` files executable; a freshly unpacked
 * extension does not keep that bit, so set it as npm would.
 */
export function makeBinsExecutable(extensionPath: string, platform: NodeJS.Platform = process.platform): void {
    if (platform === 'win32') return;
    let bins: Record<string, string> | string | undefined;
    try {
        bins = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf-8')).bin;
    } catch {
        return;
    }
    for (const rel of typeof bins === 'string' ? [bins] : Object.values(bins ?? {})) {
        const file = path.resolve(extensionPath, rel);
        if (!file.startsWith(path.resolve(extensionPath) + path.sep)) continue;
        try {
            const mode = fs.statSync(file).mode;
            if ((mode & 0o111) !== 0o111) fs.chmodSync(file, mode | 0o111);
        } catch { /* missing bin: nothing to do */ }
    }
}

function samePath(a: string, b: string): boolean {
    const norm = (p: string) => {
        try { return fs.realpathSync(p); } catch { return path.resolve(p); }
    };
    return norm(a) === norm(b);
}
