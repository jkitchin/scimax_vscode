/**
 * Clipboard Export (ox-clip style) - Copy org content to clipboard as rich text
 *
 * Enables pasting formatted org content into email clients, Word, Google Docs, etc.
 * Reference: https://github.com/jkitchin/ox-clip
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger';
import { parseOrgFast } from '../parser/orgExportParser';
import { exportToHtml, HtmlExportOptions } from '../parser/orgExportHtml';
import { exportToLatex, LatexExportOptions } from '../parser/orgExportLatex';
import { processIncludes, hasIncludes } from '../parser/orgInclude';
import { parseOptionsKeyword, type ExportOptions } from '../parser/orgExport';
import type { OrgDocumentNode } from '../parser/orgElementTypes';

const log = createLogger('ClipboardExport');

// =============================================================================
// Types
// =============================================================================

export interface ClipboardExportOptions {
    format: 'html' | 'latex' | 'markdown' | 'plain';
    scope: 'full' | 'subtree' | 'selection';
    richText: boolean;
}

interface PlatformCapabilities {
    hasRichClipboard: boolean;
    richClipboardTool: string | null;
    warningMessage?: string;
}

// =============================================================================
// Platform Detection
// =============================================================================

/**
 * Check if a command exists on the system
 */
async function commandExists(command: string): Promise<boolean> {
    return new Promise((resolve) => {
        const which = process.platform === 'win32' ? 'where' : 'which';
        const proc = spawn(which, [command]);
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}

/**
 * Detect platform-specific clipboard tools
 */
export async function detectPlatformTools(): Promise<PlatformCapabilities> {
    const platform = process.platform;

    switch (platform) {
        case 'darwin': {
            // macOS uses textutil + pbcopy for rich text
            const hasTextutil = await commandExists('textutil');
            const hasPbcopy = await commandExists('pbcopy');
            return {
                hasRichClipboard: hasTextutil && hasPbcopy,
                richClipboardTool: hasTextutil && hasPbcopy ? 'textutil+pbcopy' : null,
                warningMessage: hasTextutil && hasPbcopy
                    ? undefined
                    : 'macOS tools (textutil, pbcopy) not found. Using plain text clipboard.',
            };
        }

        case 'linux': {
            // Linux can use xclip with MIME types
            const hasXclip = await commandExists('xclip');
            const hasXsel = await commandExists('xsel');
            // wl-copy for Wayland
            const hasWlCopy = await commandExists('wl-copy');

            if (hasXclip) {
                return {
                    hasRichClipboard: true,
                    richClipboardTool: 'xclip',
                };
            } else if (hasWlCopy) {
                return {
                    hasRichClipboard: true,
                    richClipboardTool: 'wl-copy',
                };
            } else {
                return {
                    hasRichClipboard: false,
                    richClipboardTool: hasXsel ? 'xsel' : null,
                    warningMessage: 'xclip not found. Install xclip for rich text clipboard: sudo apt install xclip',
                };
            }
        }

        case 'win32': {
            // Windows uses PowerShell with System.Windows.Forms.Clipboard
            return {
                hasRichClipboard: true,
                richClipboardTool: 'powershell',
            };
        }

        default:
            return {
                hasRichClipboard: false,
                richClipboardTool: null,
                warningMessage: `Unsupported platform: ${platform}`,
            };
    }
}

// =============================================================================
// Platform-Specific Clipboard Operations
// =============================================================================

/**
 * Copy rich HTML to clipboard on macOS using textutil + pbcopy
 * Converts HTML to RTF and copies as rich text
 */
async function copyRichHtmlMacOS(html: string): Promise<boolean> {
    return new Promise((resolve) => {
        // Use textutil to convert HTML to RTF, then pipe to pbcopy with RTF type
        // textutil -convert rtf -stdin -stdout | pbcopy -Prefer rtf
        const textutil = spawn('textutil', [
            '-convert', 'rtf',
            '-stdin',
            '-stdout',
            '-inputencoding', 'UTF-8',
        ]);

        const pbcopy = spawn('pbcopy', ['-Prefer', 'rtf']);

        textutil.stdout.pipe(pbcopy.stdin);

        let error = false;

        textutil.on('error', (err) => {
            log.error('textutil error', err);
            error = true;
        });

        pbcopy.on('error', (err) => {
            log.error('pbcopy error', err);
            error = true;
        });

        pbcopy.on('close', (code) => {
            if (error) {
                resolve(false);
            } else {
                resolve(code === 0);
            }
        });

        // Write the HTML content to textutil stdin
        textutil.stdin.write(html);
        textutil.stdin.end();
    });
}

/**
 * Copy rich HTML to clipboard on Linux using xclip
 */
async function copyRichHtmlLinux(html: string, tool: string): Promise<boolean> {
    return new Promise((resolve) => {
        let proc;

        if (tool === 'wl-copy') {
            // Wayland
            proc = spawn('wl-copy', ['--type', 'text/html']);
        } else {
            // X11 with xclip
            proc = spawn('xclip', ['-selection', 'clipboard', '-t', 'text/html', '-i']);
        }

        proc.on('error', (err) => {
            log.error(`${tool} error`, err);
            resolve(false);
        });

        proc.on('close', (code) => {
            resolve(code === 0);
        });

        proc.stdin.write(html);
        proc.stdin.end();
    });
}

/**
 * Copy rich HTML to clipboard on Windows using PowerShell
 * Windows HTML clipboard format requires special header
 */
async function copyRichHtmlWindows(html: string): Promise<boolean> {
    // Windows HTML clipboard format requires a specific header
    // See: https://docs.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format
    const startHtml = html.indexOf('<html');
    const endHtml = html.length;
    const startFragment = html.indexOf('<!--StartFragment-->') + '<!--StartFragment-->'.length;
    const endFragment = html.indexOf('<!--EndFragment-->');

    // If the HTML doesn't have fragment markers, use the whole thing
    const actualStartFragment = startFragment > 0 ? startFragment : startHtml;
    const actualEndFragment = endFragment > 0 ? endFragment : endHtml;

    const header = [
        'Version:0.9',
        `StartHTML:${String(0).padStart(10, '0')}`,
        `EndHTML:${String(0).padStart(10, '0')}`,
        `StartFragment:${String(0).padStart(10, '0')}`,
        `EndFragment:${String(0).padStart(10, '0')}`,
    ].join('\r\n') + '\r\n';

    // Calculate offsets after header
    const headerLen = header.length;
    const startHtmlOffset = headerLen + (startHtml >= 0 ? startHtml : 0);
    const endHtmlOffset = headerLen + endHtml;
    const startFragmentOffset = headerLen + actualStartFragment;
    const endFragmentOffset = headerLen + actualEndFragment;

    // Rebuild header with correct offsets
    const finalHeader = [
        'Version:0.9',
        `StartHTML:${String(startHtmlOffset).padStart(10, '0')}`,
        `EndHTML:${String(endHtmlOffset).padStart(10, '0')}`,
        `StartFragment:${String(startFragmentOffset).padStart(10, '0')}`,
        `EndFragment:${String(endFragmentOffset).padStart(10, '0')}`,
    ].join('\r\n') + '\r\n';

    const htmlData = finalHeader + html;

    // Use PowerShell to set clipboard with HTML format
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$htmlData = @"
${htmlData.replace(/"/g, '`"')}
"@
$dataObj = New-Object Windows.Forms.DataObject
$dataObj.SetData([Windows.Forms.DataFormats]::Html, $htmlData)
$dataObj.SetText(@"
${html.replace(/"/g, '`"')}
"@)
[Windows.Forms.Clipboard]::SetDataObject($dataObj, $true)
`;

    return new Promise((resolve) => {
        const proc = spawn('powershell', [
            '-ExecutionPolicy', 'Bypass',
            '-Command', psScript
        ], { windowsHide: true });

        proc.on('error', (err) => {
            log.error('PowerShell clipboard error', err);
            resolve(false);
        });

        proc.on('close', (code) => {
            resolve(code === 0);
        });
    });
}

/**
 * Copy rich HTML to clipboard using platform-specific tools
 * Returns true if successful, false if should fall back to plain text
 */
export async function copyRichHtml(html: string): Promise<boolean> {
    const capabilities = await detectPlatformTools();

    if (!capabilities.hasRichClipboard) {
        if (capabilities.warningMessage) {
            log.warn(capabilities.warningMessage);
        }
        return false;
    }

    switch (process.platform) {
        case 'darwin':
            return copyRichHtmlMacOS(html);
        case 'linux':
            return copyRichHtmlLinux(html, capabilities.richClipboardTool!);
        case 'win32':
            return copyRichHtmlWindows(html);
        default:
            return false;
    }
}

// =============================================================================
// Content Extraction
// =============================================================================

/**
 * Extract document metadata from keywords
 */
function extractMetadata(doc: OrgDocumentNode): Partial<ExportOptions> {
    const options: Partial<ExportOptions> = {};

    if (doc.keywords) {
        if (doc.keywords.TITLE) options.title = doc.keywords.TITLE;
        if (doc.keywords.AUTHOR) options.author = doc.keywords.AUTHOR;
        if (doc.keywords.DATE) options.date = doc.keywords.DATE;
        if (doc.keywords.EMAIL) options.email = doc.keywords.EMAIL;
        if (doc.keywords.OPTIONS) {
            Object.assign(options, parseOptionsKeyword(doc.keywords.OPTIONS));
        }
    }

    return options;
}

/**
 * Find headline boundaries at cursor position for subtree export
 */
function findHeadlineBoundaries(
    content: string,
    cursorLine: number
): { startLine: number; endLine: number; level: number } | null {
    const lines = content.split('\n');

    // Find the headline at or before cursor
    let headlineStart = -1;
    let headlineLevel = 0;

    for (let i = cursorLine; i >= 0; i--) {
        const match = lines[i].match(/^(\*+)\s+/);
        if (match) {
            headlineStart = i;
            headlineLevel = match[1].length;
            break;
        }
    }

    if (headlineStart === -1) {
        return null;
    }

    // Find the end of this headline (next headline at same or higher level)
    let headlineEnd = lines.length - 1;
    for (let i = headlineStart + 1; i < lines.length; i++) {
        const match = lines[i].match(/^(\*+)\s+/);
        if (match && match[1].length <= headlineLevel) {
            headlineEnd = i - 1;
            break;
        }
    }

    return { startLine: headlineStart, endLine: headlineEnd, level: headlineLevel };
}

/**
 * Extract content based on scope
 */
function extractContentByScope(
    document: vscode.TextDocument,
    scope: ClipboardExportOptions['scope'],
    editor: vscode.TextEditor
): string {
    const fullContent = document.getText();

    switch (scope) {
        case 'full':
            return fullContent;

        case 'subtree': {
            const boundaries = findHeadlineBoundaries(fullContent, editor.selection.active.line);
            if (!boundaries) {
                vscode.window.showWarningMessage('No headline found at cursor. Using selection.');
                return editor.document.getText(editor.selection);
            }
            const lines = fullContent.split('\n').slice(boundaries.startLine, boundaries.endLine + 1);
            return lines.join('\n');
        }

        case 'selection': {
            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showWarningMessage('No selection. Using full document.');
                return fullContent;
            }
            return document.getText(selection);
        }

        default:
            return fullContent;
    }
}

/**
 * Preprocess content - handles #+INCLUDE: directives
 */
function preprocessContent(content: string, basePath: string): string {
    if (!hasIncludes(content)) {
        return content;
    }
    return processIncludes(content, {
        basePath,
        recursive: true,
        maxDepth: 10,
    });
}

// =============================================================================
// Export Functions
// =============================================================================

/**
 * Export content to HTML
 */
async function exportToHtmlString(
    content: string,
    basePath: string,
    bodyOnly: boolean
): Promise<string> {
    const doc = parseOrgFast(content);
    const metadata = extractMetadata(doc);

    const htmlOptions: HtmlExportOptions = {
        ...metadata,
        bodyOnly,
    };

    return exportToHtml(doc, htmlOptions);
}

/**
 * Export content to LaTeX
 */
async function exportToLatexString(
    content: string,
    bodyOnly: boolean
): Promise<string> {
    const doc = parseOrgFast(content);
    const metadata = extractMetadata(doc);

    const latexOptions: LatexExportOptions = {
        ...metadata,
        bodyOnly,
    };

    return exportToLatex(doc, latexOptions);
}

/**
 * Export content to Markdown (simple conversion)
 */
async function exportToMarkdownString(content: string): Promise<string> {
    const doc = parseOrgFast(content);
    const lines: string[] = [];

    function convertElement(elem: any): void {
        switch (elem.type) {
            case 'headline':
                const level = elem.properties?.level || 1;
                const title = elem.properties?.rawValue || '';
                lines.push(`${'#'.repeat(level)} ${title}`);
                if (elem.section?.children) {
                    for (const child of elem.section.children) {
                        convertElement(child);
                    }
                }
                if (elem.children) {
                    for (const child of elem.children) {
                        convertElement(child);
                    }
                }
                break;

            case 'section':
                if (elem.children) {
                    for (const child of elem.children) {
                        convertElement(child);
                    }
                }
                break;

            case 'paragraph':
                const text = convertObjects(elem.children || []);
                lines.push(text, '');
                break;

            case 'src-block':
                const lang = elem.properties?.language || '';
                const code = elem.properties?.value || '';
                lines.push('```' + lang);
                lines.push(code);
                lines.push('```', '');
                break;

            case 'plain-list':
                if (elem.children) {
                    for (const item of elem.children) {
                        if (item.type === 'item') {
                            const bullet = elem.properties?.listType === 'ordered' ? '1.' : '-';
                            const itemText = convertObjects(item.children?.[0]?.children || []);
                            lines.push(`${bullet} ${itemText}`);
                        }
                    }
                    lines.push('');
                }
                break;
        }
    }

    function convertObjects(objects: any[]): string {
        return objects.map((obj: any) => {
            switch (obj.type) {
                case 'plain-text':
                    return obj.properties?.value || '';
                case 'bold':
                    return `**${convertObjects(obj.children || [])}**`;
                case 'italic':
                    return `*${convertObjects(obj.children || [])}*`;
                case 'code':
                case 'verbatim':
                    return `\`${obj.properties?.value || ''}\``;
                case 'link':
                    const url = obj.properties?.path || '';
                    const desc = obj.children?.[0]?.properties?.value || url;
                    return `[${desc}](${url})`;
                default:
                    return obj.properties?.value || '';
            }
        }).join('');
    }

    // Process document section (preamble)
    if (doc.section?.children) {
        for (const child of doc.section.children) {
            convertElement(child);
        }
    }

    // Process headlines
    for (const child of doc.children || []) {
        convertElement(child);
    }

    return lines.join('\n');
}

// =============================================================================
// Main Export Command
// =============================================================================

/**
 * Copy to clipboard with given options
 */
export async function copyToClipboard(options: ClipboardExportOptions): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    if (editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('Clipboard export only works with org-mode files');
        return;
    }

    const document = editor.document;
    const basePath = path.dirname(document.uri.fsPath);

    // Extract content based on scope
    let content = extractContentByScope(document, options.scope, editor);

    // Preprocess includes
    content = preprocessContent(content, basePath);

    let exportedContent: string;
    let formatLabel: string;

    try {
        switch (options.format) {
            case 'html':
                exportedContent = await exportToHtmlString(content, basePath, !options.richText);
                formatLabel = options.richText ? 'rich HTML' : 'HTML source';
                break;

            case 'latex':
                exportedContent = await exportToLatexString(content, false);
                formatLabel = 'LaTeX';
                break;

            case 'markdown':
                exportedContent = await exportToMarkdownString(content);
                formatLabel = 'Markdown';
                break;

            case 'plain':
            default:
                exportedContent = content;
                formatLabel = 'plain text';
                break;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Export failed: ${message}`);
        return;
    }

    // Try rich clipboard for HTML
    if (options.format === 'html' && options.richText) {
        const config = vscode.workspace.getConfiguration('scimax.export.clipboard');
        const preferRich = config.get<boolean>('preferRichText', true);

        if (preferRich) {
            const success = await copyRichHtml(exportedContent);
            if (success) {
                const scopeLabel = options.scope === 'full' ? 'document' :
                    options.scope === 'subtree' ? 'subtree' : 'selection';
                vscode.window.showInformationMessage(`Copied ${scopeLabel} as ${formatLabel} to clipboard`);
                log.info(`Copied ${scopeLabel} as rich HTML to clipboard`);
                return;
            }
            // Fall through to plain text if rich clipboard failed
            log.warn('Rich clipboard failed, falling back to plain text');
        }
    }

    // Fall back to VS Code plain text clipboard
    await vscode.env.clipboard.writeText(exportedContent);
    const scopeLabel = options.scope === 'full' ? 'document' :
        options.scope === 'subtree' ? 'subtree' : 'selection';
    vscode.window.showInformationMessage(`Copied ${scopeLabel} as ${formatLabel} to clipboard`);
    log.info(`Copied ${scopeLabel} as ${formatLabel} to clipboard (plain text)`);
}

// =============================================================================
// Command Handlers
// =============================================================================

/**
 * Copy as rich HTML (formatted text)
 */
export async function clipboardHtmlRich(): Promise<void> {
    const config = vscode.workspace.getConfiguration('scimax.export.clipboard');
    const defaultScope = config.get<string>('defaultScope', 'subtree') as 'full' | 'subtree' | 'selection';

    await copyToClipboard({
        format: 'html',
        scope: defaultScope,
        richText: true,
    });
}

/**
 * Copy HTML source code
 */
export async function clipboardHtmlSource(): Promise<void> {
    const config = vscode.workspace.getConfiguration('scimax.export.clipboard');
    const defaultScope = config.get<string>('defaultScope', 'subtree') as 'full' | 'subtree' | 'selection';

    await copyToClipboard({
        format: 'html',
        scope: defaultScope,
        richText: false,
    });
}

/**
 * Copy LaTeX source
 */
export async function clipboardLatex(): Promise<void> {
    const config = vscode.workspace.getConfiguration('scimax.export.clipboard');
    const defaultScope = config.get<string>('defaultScope', 'subtree') as 'full' | 'subtree' | 'selection';

    await copyToClipboard({
        format: 'latex',
        scope: defaultScope,
        richText: false,
    });
}

/**
 * Copy Markdown
 */
export async function clipboardMarkdown(): Promise<void> {
    const config = vscode.workspace.getConfiguration('scimax.export.clipboard');
    const defaultScope = config.get<string>('defaultScope', 'subtree') as 'full' | 'subtree' | 'selection';

    await copyToClipboard({
        format: 'markdown',
        scope: defaultScope,
        richText: false,
    });
}

/**
 * Register clipboard export commands
 */
export function registerClipboardCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.clipboardHtmlRich', clipboardHtmlRich),
        vscode.commands.registerCommand('scimax.org.clipboardHtmlSource', clipboardHtmlSource),
        vscode.commands.registerCommand('scimax.org.clipboardLatex', clipboardLatex),
        vscode.commands.registerCommand('scimax.org.clipboardMarkdown', clipboardMarkdown)
    );

    log.info('Clipboard export commands registered');
}
