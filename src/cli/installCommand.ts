/**
 * "Scimax: Install Command-Line Tool": put a `scimax` launcher on PATH that
 * always runs the newest installed version of the extension's CLI, and a
 * one-time notice for a `scimax` npm link that an update has left stale
 * (https://github.com/jkitchin/scimax_vscode/issues/97). See ./launcher.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    findOnPath,
    isForeignFile,
    isOnPath,
    isStaleNpmLink,
    launcherFiles,
    writeLauncher,
} from './launcher';

const STALE_LINK_NOTICE_KEY = 'scimax.cli.staleLinkNoticeDismissed';

export function registerCliInstallCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.cli.install', () => installCli(context))
    );
}

interface Target extends vscode.QuickPickItem {
    dir?: string;
}

function tilde(p: string): string {
    const home = os.homedir();
    return p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}

function writable(dir: string): boolean {
    try {
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function candidateDirs(context: vscode.ExtensionContext): Array<{ dir: string; note?: string }> {
    const out: Array<{ dir: string; note?: string }> = [];
    const add = (dir: string | undefined, note?: string) => {
        if (dir && !out.some(c => c.dir === dir)) out.push({ dir, note });
    };
    // Replace a stale npm link where it is, so nothing else on PATH shadows the launcher.
    const current = findOnPath();
    if (current && process.platform !== 'win32' && isStaleNpmLink(current, context.extensionPath)) {
        add(path.dirname(current), 'replaces the old npm link');
    }
    if (process.platform === 'win32') {
        if (process.env.APPDATA && fs.existsSync(path.join(process.env.APPDATA, 'npm'))) {
            add(path.join(process.env.APPDATA, 'npm'), "npm's folder");
        }
        if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'Programs', 'scimax'));
    } else {
        add(path.join(os.homedir(), '.local', 'bin'));
        if (fs.existsSync('/usr/local/bin') && writable('/usr/local/bin')) add('/usr/local/bin');
    }
    return out;
}

async function installCli(context: vscode.ExtensionContext): Promise<void> {
    const extensionsDir = path.dirname(context.extensionPath);
    if (!fs.existsSync(path.join(context.extensionPath, 'out', 'cli', 'index.js'))) {
        vscode.window.showErrorMessage('Scimax: this copy of the extension has no command-line tool (out/cli/index.js). Run `npm run compile` first.');
        return;
    }

    const items: Target[] = candidateDirs(context).map(({ dir, note }) => ({
        label: tilde(dir),
        description: [isOnPath(dir) ? 'on PATH' : 'not on PATH', note].filter(Boolean).join(', '),
        dir,
    }));
    // Folders on PATH first; the order is otherwise kept.
    items.sort((a, b) => Number(isOnPath(b.dir!)) - Number(isOnPath(a.dir!)));
    items.push({ label: 'Choose a folder...' });

    const choice = await vscode.window.showQuickPick(items, {
        placeHolder: 'Where should the `scimax` command go? (a folder on PATH)',
    });
    if (!choice) return;
    let binDir = choice.dir;
    if (!binDir) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Install scimax here',
        });
        if (!picked?.[0]) return;
        binDir = picked[0].fsPath;
    }

    const foreign = launcherFiles(binDir).filter(isForeignFile);
    const staleLink = foreign.length === 1 && process.platform !== 'win32' && isStaleNpmLink(foreign[0], context.extensionPath);
    if (foreign.length && !staleLink) {
        const replace = await vscode.window.showWarningMessage(
            `${foreign.map(tilde).join(' and ')} already exists and was not written by Scimax. Replace it?`,
            { modal: true },
            'Replace'
        );
        if (replace !== 'Replace') return;
    }

    let command: string;
    try {
        command = writeLauncher(binDir, extensionsDir);
    } catch (error) {
        vscode.window.showErrorMessage(`Scimax: could not write the command-line tool to ${binDir}: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    await context.globalState.update(STALE_LINK_NOTICE_KEY, true);

    if (!isOnPath(binDir)) {
        const line = process.platform === 'win32'
            ? `Add ${binDir} to your user PATH (Settings > System > About > Advanced system settings > Environment Variables).`
            : `export PATH="${binDir}:$PATH"`;
        const action = await vscode.window.showWarningMessage(
            process.platform === 'win32'
                ? `Installed ${command}. ${line} Then open a new terminal and run \`scimax --help\`.`
                : `Installed ${tilde(command)}, but ${tilde(binDir)} is not on PATH. Add this line to ~/.zshrc or ~/.bashrc, then open a new terminal: ${line}`,
            ...(process.platform === 'win32' ? [] : ['Copy Line'])
        );
        if (action === 'Copy Line') await vscode.env.clipboard.writeText(line);
        return;
    }

    const first = findOnPath();
    if (first && !sameFile(first, command)) {
        const stale = process.platform !== 'win32' && isStaleNpmLink(first, context.extensionPath);
        const fix = 'npm unlink -g scimax-vscode';
        const action = await vscode.window.showWarningMessage(
            `Installed ${tilde(command)}, but ${tilde(first)} comes first on PATH` +
            (stale ? `. It is an old npm link; remove it with \`${fix}\`.` : ', so `scimax` still runs that one.'),
            ...(stale ? ['Copy Command'] : [])
        );
        if (action === 'Copy Command') await vscode.env.clipboard.writeText(fix);
        return;
    }

    vscode.window.showInformationMessage(
        `Installed the scimax command-line tool at ${tilde(command)}. It follows extension updates. Try \`scimax --help\` in a new terminal.`
    );
}

function sameFile(a: string, b: string): boolean {
    const norm = (p: string) => {
        try { return fs.realpathSync(p); } catch { return path.resolve(p); }
    };
    return norm(a) === norm(b);
}

/**
 * Once: if the `scimax` on PATH is an npm link that an update left stale, say
 * so and offer the launcher instead.
 */
export async function checkStaleCliLink(context: vscode.ExtensionContext): Promise<void> {
    if (process.platform === 'win32' || context.globalState.get<boolean>(STALE_LINK_NOTICE_KEY)) return;
    const current = findOnPath();
    if (!current || !isStaleNpmLink(current, context.extensionPath)) return;
    const choice = await vscode.window.showInformationMessage(
        `The \`scimax\` command (${tilde(current)}) is an npm link to an older version of Scimax, so it breaks when the extension updates. ` +
        'Install the command-line tool to replace it with one that follows updates.',
        'Install Command-Line Tool',
        "Don't Show Again"
    );
    if (choice === 'Install Command-Line Tool') {
        await vscode.commands.executeCommand('scimax.cli.install');
    } else if (choice === "Don't Show Again") {
        await context.globalState.update(STALE_LINK_NOTICE_KEY, true);
    }
}
