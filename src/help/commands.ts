/**
 * Help Commands - Register help system commands
 */

import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { HelpSystem } from './describeKey';

const GITHUB_REPO = 'jkitchin/scimax_vscode';

interface GitHubRelease {
    tag_name: string;
    name: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
}

/**
 * Fetch JSON from a URL
 */
function fetchJson(url: string): Promise<GitHubRelease> {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 'User-Agent': 'scimax-vscode' }
        };
        https.get(url, options, (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (res.headers.location) {
                    fetchJson(res.headers.location).then(resolve).catch(reject);
                    return;
                }
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

/**
 * Download a file from URL to destination
 */
function downloadFile(url: string, dest: string, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 'User-Agent': 'scimax-vscode' }
        };
        https.get(url, options, (res) => {
            // Handle redirects (GitHub uses them for asset downloads)
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (res.headers.location) {
                    downloadFile(res.headers.location, dest, progress).then(resolve).catch(reject);
                    return;
                }
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const totalSize = parseInt(res.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const file = fs.createWriteStream(dest);
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalSize > 0) {
                    const percent = Math.round((downloaded / totalSize) * 100);
                    progress.report({ message: `Downloading... ${percent}%` });
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
            file.on('error', (err) => {
                fs.unlink(dest, () => {}); // Clean up on error
                reject(err);
            });
        }).on('error', reject);
    });
}

/**
 * Install a VSIX file using the VS Code CLI
 */
async function installVsix(vsixPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Find the VS Code CLI
        let codePath: string;
        if (process.platform === 'darwin') {
            codePath = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
        } else if (process.platform === 'win32') {
            codePath = 'code.cmd';
        } else {
            codePath = 'code';
        }

        const child = spawn(codePath, ['--install-extension', vsixPath, '--force'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (data) => stdout += data);
        child.stderr?.on('data', (data) => stderr += data);

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(stderr || `Exit code ${code}`));
            }
        });
        child.on('error', reject);
    });
}

/**
 * Update scimax-vscode from GitHub releases
 */
async function updateFromGitHub(): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Scimax Update',
        cancellable: false
    }, async (progress) => {
        try {
            // Get latest release
            progress.report({ message: 'Checking for updates...' });
            const release = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);

            // Find VSIX asset
            const vsixAsset = release.assets.find(a => a.name.endsWith('.vsix'));
            if (!vsixAsset) {
                throw new Error('No VSIX found in latest release');
            }

            // Get current version
            const currentVersion = vscode.extensions.getExtension('jkitchin.scimax-vscode')?.packageJSON.version || 'unknown';
            const releaseVersion = release.tag_name.replace(/^v/, '');

            // Ask user to confirm
            const choice = await vscode.window.showInformationMessage(
                `Update scimax-vscode?\n\nCurrent: v${currentVersion}\nLatest: ${release.tag_name}`,
                { modal: true },
                'Update',
                'Cancel'
            );

            if (choice !== 'Update') {
                return;
            }

            // Download to temp directory
            const tmpDir = os.tmpdir();
            const vsixPath = path.join(tmpDir, vsixAsset.name);

            progress.report({ message: 'Downloading...' });
            await downloadFile(vsixAsset.browser_download_url, vsixPath, progress);

            // Install
            progress.report({ message: 'Installing...' });
            await installVsix(vsixPath);

            // Clean up
            fs.unlink(vsixPath, () => {});

            // Prompt to reload
            const reload = await vscode.window.showInformationMessage(
                `Scimax updated to ${release.tag_name}. Reload to activate?`,
                'Reload Now',
                'Later'
            );

            if (reload === 'Reload Now') {
                await vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('404') || message.includes('Not Found')) {
                vscode.window.showErrorMessage('No releases found on GitHub. The repository may not have any releases yet.');
            } else {
                vscode.window.showErrorMessage(`Update failed: ${message}`);
            }
        }
    });
}

let helpSystem: HelpSystem | undefined;

/**
 * Register all help commands
 */
export function registerHelpCommands(context: vscode.ExtensionContext): void {
    // Create help system instance
    helpSystem = new HelpSystem(context);

    // C-h k: Describe Key
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.describeKey', async () => {
            if (helpSystem) {
                await helpSystem.describeKey();
            }
        })
    );

    // C-h b: List Keybindings
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.listKeybindings', async () => {
            if (helpSystem) {
                await helpSystem.listKeybindings();
            }
        })
    );

    // C-h f: Describe Command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.describeCommand', async () => {
            if (helpSystem) {
                await helpSystem.describeCommand();
            }
        })
    );

    // C-h v: Describe Variable/Setting
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.describeVariable', async () => {
            if (helpSystem) {
                await helpSystem.describeVariable();
            }
        })
    );

    // C-h a: Apropos (Search Documentation)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.apropos', async () => {
            if (helpSystem) {
                await helpSystem.apropos();
            }
        })
    );

    // Update from GitHub releases
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.update', async () => {
            await updateFromGitHub();
        })
    );
}

/**
 * Get the help system instance
 */
export function getHelpSystem(): HelpSystem | undefined {
    return helpSystem;
}
