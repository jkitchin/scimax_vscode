/**
 * Launch an external terminal application in a given directory.
 *
 * This is the "Reveal in Finder" analogue for terminals: instead of opening
 * VS Code's integrated terminal, it opens the user's real terminal app
 * (iTerm, Terminal.app, gnome-terminal, Windows Terminal, ...) in the
 * directory containing a file.
 *
 * Configuration:
 *   scimax.externalTerminal.app     - macOS application name (open -a <app>)
 *   scimax.externalTerminal.command - explicit executable, overrides everything
 *   scimax.externalTerminal.args    - args for the explicit command; ${dir} is
 *                                     replaced with the target directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

/** A resolved launch: spawn(command, args, { cwd }). Never uses a shell. */
export interface TerminalLaunch {
    command: string;
    args: string[];
    /** Working directory for the spawned process (how most Linux terminals inherit cwd). */
    cwd?: string;
}

export interface ResolveOptions {
    /** Explicit executable from settings (wins over everything else). */
    command?: string;
    /** Args for the explicit executable; ${dir} is substituted. */
    args?: string[];
    /** macOS application name, e.g. "iTerm", "Terminal", "Warp". */
    app?: string;
    /** Platform to resolve for; defaults to process.platform. */
    platform?: NodeJS.Platform;
    /** Predicate for "does this macOS app bundle / Linux executable exist". Injectable for tests. */
    exists?: (name: string) => boolean;
}

/** macOS apps we look for, in preference order, when no app is configured. */
const MAC_TERMINALS = ['iTerm', 'Ghostty', 'WezTerm', 'kitty', 'Alacritty', 'Warp', 'Terminal'];

/**
 * Linux terminals, in preference order. Each entry is the executable plus any
 * args it needs; the directory is passed via the spawned process's cwd, which
 * every one of these inherits for the shell it starts.
 */
const LINUX_TERMINALS: Array<{ command: string; args: string[] }> = [
    { command: 'x-terminal-emulator', args: [] },
    { command: 'gnome-terminal', args: [] },
    { command: 'konsole', args: [] },
    { command: 'xfce4-terminal', args: [] },
    { command: 'ghostty', args: [] },
    { command: 'wezterm', args: [] },
    { command: 'kitty', args: [] },
    { command: 'alacritty', args: [] },
    { command: 'xterm', args: [] }
];

/** Is there a `<name>.app` bundle in one of the usual macOS application folders? */
function macAppExists(name: string): boolean {
    const home = process.env.HOME ?? '';
    const roots = ['/Applications', '/System/Applications', path.join(home, 'Applications')];
    return roots.some(root => fs.existsSync(path.join(root, `${name}.app`)));
}

/** Is `name` an executable on PATH? */
function onPath(name: string): boolean {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    return dirs.some(dir => {
        try {
            fs.accessSync(path.join(dir, name), fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}

/**
 * Work out how to open an external terminal at `dir`.
 * Returns undefined when no terminal could be found on this platform.
 */
export function resolveExternalTerminal(dir: string, options: ResolveOptions = {}): TerminalLaunch | undefined {
    const platform = options.platform ?? process.platform;

    // Explicit command wins on every platform.
    const command = options.command?.trim();
    if (command) {
        const args = (options.args ?? []).map(arg => arg.replace(/\$\{dir\}/g, dir));
        return { command, args, cwd: dir };
    }

    if (platform === 'darwin') {
        const exists = options.exists ?? macAppExists;
        const app = options.app?.trim() || MAC_TERMINALS.find(exists) || 'Terminal';
        // `open -a <app> <dir>` starts the app with the directory as its cwd.
        return { command: 'open', args: ['-a', app, dir] };
    }

    if (platform === 'win32') {
        const exists = options.exists ?? onPath;
        if (exists('wt.exe')) {
            return { command: 'wt.exe', args: ['-d', dir] };
        }
        // start needs cmd.exe; /D sets the working directory of the new window.
        return { command: 'cmd.exe', args: ['/c', 'start', '', '/D', dir, 'cmd.exe'] };
    }

    const exists = options.exists ?? onPath;
    const term = LINUX_TERMINALS.find(t => exists(t.command));
    return term ? { command: term.command, args: term.args, cwd: dir } : undefined;
}

/**
 * Spawn the terminal, detached so it outlives VS Code.
 * Rejects if the process cannot be started.
 */
export function launchExternalTerminal(launch: TerminalLaunch): Promise<void> {
    return new Promise((resolve, reject) => {
        // Note: no `shell: true` - args are passed as an array so a directory
        // name can never be interpreted as a command.
        const child = spawn(launch.command, launch.args, {
            cwd: launch.cwd,
            detached: true,
            stdio: 'ignore'
        });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}
