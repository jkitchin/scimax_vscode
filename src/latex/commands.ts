/**
 * LaTeX Commands Registration
 * Registers all LaTeX navigation, structure, and environment commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { LaTeXDocumentSymbolProvider } from './latexDocumentSymbolProvider';
import { LaTeXHoverProvider } from './latexHoverProvider';
import * as navigation from './latexNavigation';
import * as structure from './latexStructure';
import * as environments from './latexEnvironments';
import { registerSpeedCommands } from './latexSpeedCommands';
import { initLatexPreviewCache } from '../org/latexPreviewProvider';

/**
 * Register all LaTeX-related commands
 */
export function registerLatexCommands(context: vscode.ExtensionContext): void {
    // Navigation commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.nextSection', navigation.nextSection),
        vscode.commands.registerCommand('scimax.latex.previousSection', navigation.previousSection),
        vscode.commands.registerCommand('scimax.latex.parentSection', navigation.parentSection),
        vscode.commands.registerCommand('scimax.latex.nextSiblingSection', navigation.nextSiblingSection),
        vscode.commands.registerCommand('scimax.latex.previousSiblingSection', navigation.previousSiblingSection),
        vscode.commands.registerCommand('scimax.latex.firstSection', navigation.firstSection),
        vscode.commands.registerCommand('scimax.latex.lastSection', navigation.lastSection),
        vscode.commands.registerCommand('scimax.latex.jumpToSection', navigation.jumpToSection),
        vscode.commands.registerCommand('scimax.latex.nextEnvironment', navigation.nextEnvironment),
        vscode.commands.registerCommand('scimax.latex.previousEnvironment', navigation.previousEnvironment),
        vscode.commands.registerCommand('scimax.latex.jumpToEnvironment', navigation.jumpToEnvironment),
        vscode.commands.registerCommand('scimax.latex.jumpToLabel', navigation.jumpToLabel),
        vscode.commands.registerCommand('scimax.latex.jumpToMatchingEnvironment', navigation.jumpToMatchingEnvironment),
    );

    // Structure editing commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.promoteSection', structure.promoteSection),
        vscode.commands.registerCommand('scimax.latex.demoteSection', structure.demoteSection),
        vscode.commands.registerCommand('scimax.latex.promoteSubtree', structure.promoteSubtree),
        vscode.commands.registerCommand('scimax.latex.demoteSubtree', structure.demoteSubtree),
        vscode.commands.registerCommand('scimax.latex.moveSectionUp', structure.moveSectionUp),
        vscode.commands.registerCommand('scimax.latex.moveSectionDown', structure.moveSectionDown),
        vscode.commands.registerCommand('scimax.latex.markSection', structure.markSection),
        vscode.commands.registerCommand('scimax.latex.killSection', structure.killSection),
        vscode.commands.registerCommand('scimax.latex.cloneSection', structure.cloneSection),
        vscode.commands.registerCommand('scimax.latex.insertSection', structure.insertSection),
        vscode.commands.registerCommand('scimax.latex.insertSubsection', structure.insertSubsection),
        vscode.commands.registerCommand('scimax.latex.narrowToSection', structure.narrowToSection),
        vscode.commands.registerCommand('scimax.latex.widen', structure.widen),
    );

    // Environment commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.selectEnvironment', environments.selectEnvironment),
        vscode.commands.registerCommand('scimax.latex.selectEnvironmentContent', environments.selectEnvironmentContent),
        vscode.commands.registerCommand('scimax.latex.changeEnvironment', environments.changeEnvironment),
        vscode.commands.registerCommand('scimax.latex.wrapInEnvironment', environments.wrapInEnvironment),
        vscode.commands.registerCommand('scimax.latex.unwrapEnvironment', environments.unwrapEnvironment),
        vscode.commands.registerCommand('scimax.latex.deleteEnvironment', environments.deleteEnvironment),
        vscode.commands.registerCommand('scimax.latex.toggleEnvironmentStar', environments.toggleEnvironmentStar),
        vscode.commands.registerCommand('scimax.latex.addLabel', environments.addLabelToEnvironment),
        vscode.commands.registerCommand('scimax.latex.addCaption', environments.addCaptionToEnvironment),
        vscode.commands.registerCommand('scimax.latex.environmentInfo', environments.environmentInfo),
    );

    // Register speed commands
    registerSpeedCommands(context);
}

/**
 * Register LaTeX language providers
 */
export function registerLatexProviders(context: vscode.ExtensionContext): void {
    // Document Symbol Provider (for outline view)
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: 'latex', scheme: 'file' },
            new LaTeXDocumentSymbolProvider()
        )
    );

    // Hover Provider (for tooltips)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'latex', scheme: 'file' },
            new LaTeXHoverProvider()
        )
    );
}

/**
 * Register LaTeX compile and preview commands
 */
export function registerLatexCompileCommands(context: vscode.ExtensionContext): void {
    // Compile LaTeX document
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.compile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            // Save the document first
            await editor.document.save();

            const filePath = editor.document.uri.fsPath;
            const dir = path.dirname(filePath);
            const fileName = path.basename(filePath);

            // Get compiler from settings
            const config = vscode.workspace.getConfiguration('scimax.latex');
            const compiler = config.get<string>('compiler', 'pdflatex');

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Compiling ${fileName}...`,
                cancellable: true
            }, async (progress, token) => {
                return new Promise<void>((resolve, reject) => {
                    const args = ['-interaction=nonstopmode', '-file-line-error', fileName];
                    const proc = spawn(compiler, args, {
                        cwd: dir,
                        env: {
                            ...process.env,
                            PATH: getEnhancedPath(),
                        }
                    });

                    let stdout = '';
                    let stderr = '';

                    proc.stdout?.on('data', (data: Buffer) => {
                        stdout += data.toString();
                    });

                    proc.stderr?.on('data', (data: Buffer) => {
                        stderr += data.toString();
                    });

                    token.onCancellationRequested(() => {
                        proc.kill();
                        reject(new Error('Compilation cancelled'));
                    });

                    proc.on('close', (code: number | null) => {
                        if (code === 0) {
                            vscode.window.showInformationMessage(`LaTeX compilation successful: ${fileName}`);
                            resolve();
                        } else {
                            // Parse error from output
                            const errorMatch = stdout.match(/^(.+):(\d+): (.+)$/m);
                            if (errorMatch) {
                                const [, file, line, message] = errorMatch;
                                vscode.window.showErrorMessage(`LaTeX error at line ${line}: ${message}`);
                            } else {
                                vscode.window.showErrorMessage('LaTeX compilation failed. Check Output for details.');
                            }

                            // Show output in output channel
                            const outputChannel = vscode.window.createOutputChannel('LaTeX');
                            outputChannel.clear();
                            outputChannel.appendLine(stdout);
                            if (stderr) {
                                outputChannel.appendLine('--- STDERR ---');
                                outputChannel.appendLine(stderr);
                            }
                            outputChannel.show(true);

                            resolve();
                        }
                    });

                    proc.on('error', (err: Error) => {
                        vscode.window.showErrorMessage(`Failed to run ${compiler}: ${err.message}`);
                        resolve();
                    });
                });
            });
        }),

        // View PDF command
        vscode.commands.registerCommand('scimax.latex.viewPdf', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const pdfPath = filePath.replace(/\.tex$/, '.pdf');

            if (!fs.existsSync(pdfPath)) {
                const compile = await vscode.window.showWarningMessage(
                    'PDF not found. Compile the document first?',
                    'Compile',
                    'Cancel'
                );
                if (compile === 'Compile') {
                    await vscode.commands.executeCommand('scimax.latex.compile');
                    // Wait a bit for compilation
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    if (!fs.existsSync(pdfPath)) {
                        return; // Compilation probably failed
                    }
                } else {
                    return;
                }
            }

            // Open PDF with default viewer or VS Code extension
            const pdfUri = vscode.Uri.file(pdfPath);

            // Try to open in VS Code if a PDF extension is available
            try {
                await vscode.commands.executeCommand('vscode.open', pdfUri);
            } catch {
                // Fallback to system default
                vscode.env.openExternal(pdfUri);
            }
        }),

        // Compile and view command
        vscode.commands.registerCommand('scimax.latex.compileAndView', async () => {
            await vscode.commands.executeCommand('scimax.latex.compile');
            // Wait for compilation to finish, then open PDF
            // The compile command shows progress, so user can see when it's done
            setTimeout(() => {
                vscode.commands.executeCommand('scimax.latex.viewPdf');
            }, 500);
        }),

        // Clean auxiliary files
        vscode.commands.registerCommand('scimax.latex.clean', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const dir = path.dirname(filePath);
            const baseName = path.basename(filePath, '.tex');

            const auxExtensions = [
                '.aux', '.log', '.out', '.toc', '.lof', '.lot',
                '.bbl', '.blg', '.bcf', '.run.xml',
                '.fls', '.fdb_latexmk', '.synctex.gz', '.synctex',
                '.nav', '.snm', '.vrb'  // Beamer
            ];

            let cleaned = 0;
            for (const ext of auxExtensions) {
                const auxFile = path.join(dir, baseName + ext);
                if (fs.existsSync(auxFile)) {
                    try {
                        fs.unlinkSync(auxFile);
                        cleaned++;
                    } catch {
                        // Ignore errors
                    }
                }
            }

            vscode.window.showInformationMessage(`Cleaned ${cleaned} auxiliary file(s)`);
        }),

        // SyncTeX forward search (jump from source to PDF)
        vscode.commands.registerCommand('scimax.latex.syncTexForward', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const pdfPath = filePath.replace(/\.tex$/, '.pdf');
            const line = editor.selection.active.line + 1;

            if (!fs.existsSync(pdfPath)) {
                vscode.window.showWarningMessage('PDF not found. Compile the document first.');
                return;
            }

            // Try common PDF viewers with SyncTeX support
            const config = vscode.workspace.getConfiguration('scimax.latex');
            const pdfViewer = config.get<string>('pdfViewer', 'auto');

            if (pdfViewer === 'auto' || pdfViewer === 'skim') {
                // Skim on macOS
                if (process.platform === 'darwin') {
                    // Escape paths for AppleScript (escape backslashes and quotes)
                    const escapedPdfPath = pdfPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    const escapedFilePath = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    spawn('osascript', [
                        '-e',
                        `tell application "Skim" to activate`,
                        '-e',
                        `tell application "Skim" to open "${escapedPdfPath}"`,
                        '-e',
                        `tell application "Skim" to go to TeX line ${line} from POSIX file "${escapedFilePath}"`
                    ]);
                    return;
                }
            }

            if (pdfViewer === 'auto' || pdfViewer === 'zathura') {
                // Zathura on Linux
                if (process.platform === 'linux') {
                    spawn('zathura', ['--synctex-forward', `${line}:1:${filePath}`, pdfPath]);
                    return;
                }
            }

            if (pdfViewer === 'auto' || pdfViewer === 'sumatra') {
                // SumatraPDF on Windows
                if (process.platform === 'win32') {
                    spawn('SumatraPDF', ['-forward-search', filePath, String(line), pdfPath]);
                    return;
                }
            }

            // Fallback: just open the PDF
            vscode.window.showInformationMessage('SyncTeX forward search: opening PDF at line ' + line);
            await vscode.commands.executeCommand('scimax.latex.viewPdf');
        }),

        // Word count
        vscode.commands.registerCommand('scimax.latex.wordCount', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const text = editor.document.getText();

            // Remove comments
            const noComments = text.replace(/%.*$/gm, '');

            // Remove commands (rough approximation)
            const noCommands = noComments.replace(/\\[a-zA-Z]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ');

            // Remove environments markers
            const noEnvMarkers = noCommands.replace(/\\(begin|end)\{[^}]+\}/g, '');

            // Count words
            const words = noEnvMarkers.match(/\b[a-zA-Z]+\b/g) || [];
            const wordCount = words.length;

            // Count characters (excluding whitespace)
            const charCount = noEnvMarkers.replace(/\s/g, '').length;

            vscode.window.showInformationMessage(
                `Word count: ${wordCount} words, ${charCount} characters (approximate)`
            );
        }),

        // Insert common LaTeX elements
        vscode.commands.registerCommand('scimax.latex.insertFigure', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const snippet = new vscode.SnippetString(
                '\\begin{figure}[${1:htbp}]\n' +
                '  \\centering\n' +
                '  \\includegraphics[width=${2:0.8}\\textwidth]{${3:filename}}\n' +
                '  \\caption{${4:Caption}}\n' +
                '  \\label{fig:${5:label}}\n' +
                '\\end{figure}\n'
            );

            await editor.insertSnippet(snippet);
        }),

        vscode.commands.registerCommand('scimax.latex.insertTable', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const snippet = new vscode.SnippetString(
                '\\begin{table}[${1:htbp}]\n' +
                '  \\centering\n' +
                '  \\caption{${2:Caption}}\n' +
                '  \\label{tab:${3:label}}\n' +
                '  \\begin{tabular}{${4:lcc}}\n' +
                '    \\toprule\n' +
                '    ${5:Header 1} & ${6:Header 2} & ${7:Header 3} \\\\\\\\\n' +
                '    \\midrule\n' +
                '    ${8:Data 1} & ${9:Data 2} & ${10:Data 3} \\\\\\\\\n' +
                '    \\bottomrule\n' +
                '  \\end{tabular}\n' +
                '\\end{table}\n'
            );

            await editor.insertSnippet(snippet);
        }),

        vscode.commands.registerCommand('scimax.latex.insertEquation', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const snippet = new vscode.SnippetString(
                '\\begin{equation}\n' +
                '  ${1:equation}\n' +
                '  \\label{eq:${2:label}}\n' +
                '\\end{equation}\n'
            );

            await editor.insertSnippet(snippet);
        })
    );
}

/**
 * Get enhanced PATH for LaTeX tools
 */
function getEnhancedPath(): string {
    const currentPath = process.env.PATH || '';
    const latexPaths = [
        '/Library/TeX/texbin',           // MacTeX
        '/usr/local/texlive/2025/bin/universal-darwin',
        '/usr/local/texlive/2024/bin/universal-darwin',
        '/usr/local/texlive/2023/bin/universal-darwin',
        '/opt/homebrew/bin',             // Homebrew on Apple Silicon
        '/usr/local/bin',                // Homebrew on Intel
        '/usr/bin',
    ];

    const pathSet = new Set(currentPath.split(path.delimiter));
    for (const p of latexPaths) {
        if (!pathSet.has(p)) {
            pathSet.add(p);
        }
    }

    return Array.from(pathSet).join(path.delimiter);
}

/**
 * Activate all LaTeX features
 */
export function activateLatexFeatures(context: vscode.ExtensionContext): void {
    // Initialize LaTeX preview cache
    initLatexPreviewCache(context);

    registerLatexCommands(context);
    registerLatexProviders(context);
    registerLatexCompileCommands(context);

    console.log('LaTeX navigation, structure, and compile features activated');
}
