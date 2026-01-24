/**
 * Screenshot capture and insertion for org-mode and markdown
 * Cross-platform support: macOS, Windows, Linux
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger';

const log = createLogger('Screenshot');

// =============================================================================
// Image Dimensions (pure TypeScript, no external deps)
// =============================================================================

interface ImageDimensions {
    width: number;
    height: number;
}

/**
 * Get PNG dimensions by reading the IHDR chunk
 * PNG format: 8-byte signature, then IHDR chunk with width/height at bytes 16-23
 */
function getPngDimensions(filePath: string): ImageDimensions | null {
    try {
        const buffer = Buffer.alloc(24);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, 24, 0);
        fs.closeSync(fd);

        // Check PNG signature
        const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        if (!buffer.subarray(0, 8).equals(pngSignature)) {
            return null;
        }

        // Width and height are at bytes 16-19 and 20-23 (big-endian)
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);

        return { width, height };
    } catch (error) {
        log.warn('Failed to read PNG dimensions', { error: String(error) });
        return null;
    }
}

/**
 * Get image dimensions (currently supports PNG)
 */
function getImageDimensions(filePath: string): ImageDimensions | null {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') {
        return getPngDimensions(filePath);
    }
    // Could add JPEG support later if needed
    return null;
}

// =============================================================================
// Platform-Specific Screenshot Commands
// =============================================================================

interface ScreenshotResult {
    success: boolean;
    filePath?: string;
    error?: string;
    cancelled?: boolean;
}

/**
 * Take screenshot on macOS using screencapture
 * -i: interactive mode (select area or window)
 * -x: no sound
 */
async function screenshotMacOS(outputPath: string): Promise<ScreenshotResult> {
    return new Promise((resolve) => {
        const proc = spawn('screencapture', ['-i', '-x', outputPath]);

        proc.on('close', (code) => {
            if (code === 0) {
                // Check if file was actually created (user might have pressed Escape)
                if (fs.existsSync(outputPath)) {
                    resolve({ success: true, filePath: outputPath });
                } else {
                    resolve({ success: false, cancelled: true });
                }
            } else {
                resolve({ success: false, error: `screencapture exited with code ${code}` });
            }
        });

        proc.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

/**
 * Take screenshot on Windows using PowerShell and .NET
 * Falls back to SnippingTool if available
 */
async function screenshotWindows(outputPath: string): Promise<ScreenshotResult> {
    // Try using PowerShell with Windows Forms for screen capture
    // This creates a selection rectangle UI
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Hide PowerShell window
$signature = @"
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
"@
$type = Add-Type -MemberDefinition $signature -Name Win32ShowWindow -Namespace Win32Functions -PassThru
$hwnd = $type::GetConsoleWindow()
$type::ShowWindow($hwnd, 0) | Out-Null

# Use SnippingTool for interactive capture
$snippingTool = Get-Command "SnippingTool.exe" -ErrorAction SilentlyContinue
if ($snippingTool) {
    Start-Process "SnippingTool.exe" -ArgumentList "/clip" -Wait
    Start-Sleep -Milliseconds 500

    # Get image from clipboard and save
    $img = [System.Windows.Forms.Clipboard]::GetImage()
    if ($img) {
        $img.Save("${outputPath.replace(/\\/g, '\\\\')}")
        exit 0
    }
}
exit 1
`;

    return new Promise((resolve) => {
        const proc = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', psScript], {
            windowsHide: true
        });

        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve({ success: true, filePath: outputPath });
            } else {
                resolve({ success: false, cancelled: code !== 0 });
            }
        });

        proc.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

/**
 * Take screenshot on Linux - tries multiple tools in order of preference
 */
async function screenshotLinux(outputPath: string): Promise<ScreenshotResult> {
    // Tools to try, in order of preference
    const tools: Array<{ name: string; args: string[] }> = [
        { name: 'gnome-screenshot', args: ['-a', '-f', outputPath] },
        { name: 'scrot', args: ['-s', outputPath] },
        { name: 'flameshot', args: ['gui', '-r'] },  // outputs to stdout, needs special handling
        { name: 'maim', args: ['-s', outputPath] },
        { name: 'import', args: [outputPath] }  // ImageMagick
    ];

    for (const tool of tools) {
        try {
            // Check if tool exists
            const whichResult = await new Promise<boolean>((resolve) => {
                const which = spawn('which', [tool.name]);
                which.on('close', (code) => resolve(code === 0));
                which.on('error', () => resolve(false));
            });

            if (!whichResult) {
                continue;
            }

            log.info(`Using ${tool.name} for screenshot`);

            // Special handling for flameshot (outputs to stdout)
            if (tool.name === 'flameshot') {
                return new Promise((resolve) => {
                    const proc = spawn('flameshot', ['gui', '-r']);
                    const chunks: Buffer[] = [];

                    proc.stdout.on('data', (chunk) => chunks.push(chunk));

                    proc.on('close', (code) => {
                        if (code === 0 && chunks.length > 0) {
                            fs.writeFileSync(outputPath, Buffer.concat(chunks));
                            resolve({ success: true, filePath: outputPath });
                        } else {
                            resolve({ success: false, cancelled: true });
                        }
                    });

                    proc.on('error', (err) => {
                        resolve({ success: false, error: err.message });
                    });
                });
            }

            // Standard tool handling
            return new Promise((resolve) => {
                const proc = spawn(tool.name, tool.args);

                proc.on('close', (code) => {
                    if (code === 0 && fs.existsSync(outputPath)) {
                        resolve({ success: true, filePath: outputPath });
                    } else {
                        resolve({ success: false, cancelled: true });
                    }
                });

                proc.on('error', (err) => {
                    resolve({ success: false, error: err.message });
                });
            });
        } catch {
            continue;
        }
    }

    return {
        success: false,
        error: 'No screenshot tool found. Please install one of: gnome-screenshot, scrot, flameshot, maim, or imagemagick'
    };
}

/**
 * Take a screenshot using platform-appropriate tool
 */
async function takeScreenshot(outputPath: string): Promise<ScreenshotResult> {
    const platform = process.platform;

    switch (platform) {
        case 'darwin':
            return screenshotMacOS(outputPath);
        case 'win32':
            return screenshotWindows(outputPath);
        case 'linux':
            return screenshotLinux(outputPath);
        default:
            return { success: false, error: `Unsupported platform: ${platform}` };
    }
}

// =============================================================================
// Screenshot Command
// =============================================================================

/**
 * Generate a timestamped filename for screenshot
 */
function generateScreenshotFilename(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');

    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

    return `screenshot-${date}-${time}.png`;
}

/**
 * Insert screenshot link at cursor position
 */
export async function insertScreenshot(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const document = editor.document;
    const isOrg = document.languageId === 'org';
    const isMd = document.languageId === 'markdown';

    if (!isOrg && !isMd) {
        vscode.window.showErrorMessage('Screenshot insertion only works in org-mode or markdown files');
        return;
    }

    // Get the directory of the current file
    const fileDir = path.dirname(document.uri.fsPath);
    const screenshotsDir = path.join(fileDir, 'screenshots');

    // Create screenshots directory if it doesn't exist
    if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const filename = generateScreenshotFilename();
    const outputPath = path.join(screenshotsDir, filename);

    // Show status message
    const statusMessage = vscode.window.setStatusBarMessage('$(camera) Select area for screenshot...');

    try {
        const result = await takeScreenshot(outputPath);

        statusMessage.dispose();

        if (result.cancelled) {
            vscode.window.setStatusBarMessage('Screenshot cancelled', 2000);
            return;
        }

        if (!result.success) {
            vscode.window.showErrorMessage(`Screenshot failed: ${result.error}`);
            return;
        }

        // Get image dimensions
        const dimensions = getImageDimensions(outputPath);
        const width = dimensions ? Math.min(800, dimensions.width) : 800;

        // Build the link text
        let linkText: string;
        const relativePath = `./screenshots/${filename}`;

        if (isOrg) {
            linkText = `\n#+attr_org: :width ${width}\n[[${relativePath}]]\n`;
        } else {
            // Markdown
            linkText = `\n![screenshot](${relativePath})\n`;
        }

        // Insert at cursor position
        await editor.edit((editBuilder) => {
            editBuilder.insert(editor.selection.active, linkText);
        });

        vscode.window.setStatusBarMessage(`Screenshot saved: ${filename}`, 3000);
        log.info(`Screenshot saved to ${outputPath}`);

        // Trigger image preview refresh if available
        vscode.commands.executeCommand('scimax.org.refreshInlineImages').then(
            () => {},
            () => {} // Command might not exist, ignore
        );

    } catch (error) {
        statusMessage.dispose();
        const err = error instanceof Error ? error : new Error(String(error));
        log.error('Screenshot failed', err);
        vscode.window.showErrorMessage(`Screenshot failed: ${err.message}`);
    }
}

/**
 * Register screenshot commands
 */
export function registerScreenshotCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.insertScreenshot', insertScreenshot)
    );

    log.info('Screenshot commands registered');
}
