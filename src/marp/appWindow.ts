/**
 * Open a slideshow in a Chromium "app" window: a window with no tabs, address
 * bar or toolbar, which you can size and move like any other. The slides fill
 * the window, so it works as full screen in a window (for sharing one window
 * in a video call, or presenting beside your notes).
 *
 * `scimax.marp.presentWindow` = "app" turns this on for Present;
 * `scimax.marp.appBrowser` names the browser, or Chrome, Edge, Chromium or
 * Brave is found in the usual places.
 *
 * The browser search and the command line are plain functions, so they can be
 * unit tested; `openAppWindow` runs the command.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface LaunchCommand {
    command: string;
    args: string[];
}

/** What the search needs from the system, so tests can supply their own. */
export interface BrowserSearch {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    home: string;
    exists: (file: string) => boolean;
}

const MAC_APPS = ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'];
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable',
    'chromium', 'chromium-browser', 'brave-browser'];
const WINDOWS_PATHS = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Chromium', 'Application', 'chrome.exe'],
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
];

/** The first Chromium browser installed: a .app bundle on macOS, else an executable. */
export function findAppBrowser(search: BrowserSearch): string | undefined {
    const { platform, env, home, exists } = search;
    if (platform === 'darwin') {
        for (const name of MAC_APPS) {
            for (const dir of ['/Applications', path.posix.join(home, 'Applications')]) {
                const app = path.posix.join(dir, `${name}.app`);
                if (exists(app)) return app;
            }
        }
        return undefined;
    }
    if (platform === 'win32') {
        const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']].filter((r): r is string => !!r);
        for (const parts of WINDOWS_PATHS) {
            for (const root of roots) {
                const exe = path.win32.join(root, ...parts);
                if (exists(exe)) return exe;
            }
        }
        return undefined;
    }
    const dirs = (env['PATH'] ?? '').split(':').filter(Boolean);
    for (const name of LINUX_NAMES) {
        for (const dir of dirs) {
            const exe = path.posix.join(dir, name);
            if (exists(exe)) return exe;
        }
    }
    return undefined;
}

/**
 * The command that opens `url` in an app window of `browser`. A macOS .app
 * bundle is run by its executable (Contents/MacOS/<name>), which hands the
 * window to a running browser ("Opening in existing browser session");
 * `open -na … --args` does not pass --app to a browser that is already running.
 */
export function appWindowCommand(browser: string, url: string, platform: NodeJS.Platform): LaunchCommand {
    const app = browser.replace(/\/+$/, '');
    if (platform === 'darwin' && /\.app$/i.test(app)) {
        const name = path.posix.basename(app).replace(/\.app$/i, '');
        return { command: path.posix.join(app, 'Contents', 'MacOS', name), args: [`--app=${url}`] };
    }
    return { command: browser, args: [`--app=${url}`] };
}

/**
 * The browser to use: `configured` if it exists (a path, or on macOS also an
 * application name such as "Google Chrome"), otherwise the first one found.
 */
export function resolveAppBrowser(configured: string, search: BrowserSearch): string | undefined {
    const wanted = configured.trim();
    if (wanted) {
        if (search.exists(wanted)) return wanted;
        if (search.platform === 'darwin') {
            const name = wanted.replace(/\.app\/?$/i, '');
            for (const dir of ['/Applications', path.posix.join(search.home, 'Applications')]) {
                const app = path.posix.join(dir, `${name}.app`);
                if (search.exists(app)) return app;
            }
        }
        return undefined;
    }
    return findAppBrowser(search);
}

/** The real system, for `resolveAppBrowser`. */
export function systemSearch(): BrowserSearch {
    return {
        platform: process.platform,
        env: process.env,
        home: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
        exists: file => { try { fs.accessSync(file); return true; } catch { return false; } },
    };
}

/** Start the browser. Resolves once it has started, rejects if it could not be run. */
export function openAppWindow(launch: LaunchCommand): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
    });
}
