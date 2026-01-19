/**
 * PDF Viewer Panel
 * Webview-based PDF viewer with SyncTeX support for Overleaf-like experience
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runSyncTeXInverse, SyncTeXForwardResult } from './synctexUtils';
import { orgInverseSync, hasSyncData } from '../org/orgPdfSync';

export class PdfViewerPanel {
    public static currentPanel: PdfViewerPanel | undefined;
    private static readonly viewType = 'scimaxPdfViewer';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private pdfPath: string | undefined;
    private sourceFile: string | undefined;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];
    private currentHighlight: vscode.TextEditorDecorationType | undefined;
    private highlightCleanupListeners: vscode.Disposable[] = [];
    private ignoreNextSelectionChange: boolean = false;

    public static createOrShow(extensionUri: vscode.Uri, pdfPath: string, sourceFile: string): PdfViewerPanel {
        const column = vscode.ViewColumn.Beside;

        // If we already have a panel, show it
        if (PdfViewerPanel.currentPanel) {
            PdfViewerPanel.currentPanel.panel.reveal(column);
            PdfViewerPanel.currentPanel.loadPdf(pdfPath, sourceFile);
            return PdfViewerPanel.currentPanel;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            PdfViewerPanel.viewType,
            'PDF Preview',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.dirname(pdfPath)),
                    extensionUri
                ]
            }
        );

        PdfViewerPanel.currentPanel = new PdfViewerPanel(panel, extensionUri);
        PdfViewerPanel.currentPanel.loadPdf(pdfPath, sourceFile);
        return PdfViewerPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set the webview's initial html content
        this.panel.webview.html = this.getLoadingHtml();

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public loadPdf(pdfPath: string, sourceFile: string): void {
        this.pdfPath = pdfPath;
        this.sourceFile = sourceFile;

        // Update panel title
        this.panel.title = path.basename(pdfPath);

        // Set up file watcher for auto-refresh
        this.setupFileWatcher(pdfPath);

        // Load the PDF
        this.updateContent();
    }

    public get currentPdfPath(): string | undefined {
        return this.pdfPath;
    }

    public get currentSourceFile(): string | undefined {
        return this.sourceFile;
    }

    public scrollToLine(line: number): void {
        // Send message to webview to scroll to the line via SyncTeX
        this.panel.webview.postMessage({
            type: 'scrollToLine',
            line: line
        });
    }

    /**
     * Scroll to a specific position in the PDF (from SyncTeX forward lookup)
     * @param result SyncTeX forward result with page, x, y coordinates
     * @param debugInfo Optional debug info including searchWord for precise text highlighting
     */
    public scrollToPosition(result: SyncTeXForwardResult, debugInfo?: { line: number; column: number; text: string; file: string; searchWord?: string }): void {
        // Check if debug popup is enabled
        const config = vscode.workspace.getConfiguration('scimax.latex');
        const showDebugPopup = config.get<boolean>('showSyncDebugPopup', false);

        this.panel.webview.postMessage({
            type: 'scrollToPosition',
            page: result.page,
            x: result.x,
            y: result.y,
            width: result.width,
            height: result.height,
            debugInfo: debugInfo,
            searchWord: debugInfo?.searchWord || '',
            showDebugPopup: showDebugPopup
        });
    }

    public refresh(): void {
        this.updateContent();
    }

    private setupFileWatcher(pdfPath: string): void {
        // Dispose existing watcher
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }

        // Watch for PDF changes
        const pattern = new vscode.RelativePattern(
            path.dirname(pdfPath),
            path.basename(pdfPath)
        );
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.fileWatcher.onDidChange(() => {
            // Small delay to ensure file is fully written
            setTimeout(() => this.updateContent(), 100);
        });

        this.disposables.push(this.fileWatcher);
    }

    private updateContent(): void {
        if (!this.pdfPath || !fs.existsSync(this.pdfPath)) {
            this.panel.webview.html = this.getErrorHtml('PDF file not found. Compile your document first.');
            return;
        }

        // Read PDF and convert to base64 for embedding
        const pdfData = fs.readFileSync(this.pdfPath);
        const pdfBase64 = pdfData.toString('base64');

        this.panel.webview.html = this.getHtmlContent(pdfBase64);
    }

    private handleMessage(message: { type: string; line?: number; file?: string; page?: number; x?: number; y?: number; clickedText?: string; contextText?: string }): void {
        switch (message.type) {
            case 'syncTexClick':
                // Handle click in PDF - jump to source
                if (message.line && this.sourceFile) {
                    this.jumpToSource(this.sourceFile, message.line);
                }
                break;
            case 'inverseSync':
                // Handle double-click in PDF - run SyncTeX inverse lookup
                if (message.page !== undefined && message.x !== undefined && message.y !== undefined && this.pdfPath) {
                    this.handleInverseSync(message.page, message.x, message.y, message.clickedText, message.contextText);
                }
                break;
            case 'refresh':
                this.updateContent();
                break;
        }
    }

    /**
     * Handle inverse SyncTeX lookup (PDF click -> source line)
     * Supports both LaTeX (.tex) and Org-mode (.org) source files
     */
    private async handleInverseSync(page: number, x: number, y: number, clickedText?: string, contextText?: string): Promise<void> {
        if (!this.pdfPath) {
            return;
        }

        // Check if source is an org file with sync data
        if (this.sourceFile && this.sourceFile.endsWith('.org') && hasSyncData(this.sourceFile)) {
            console.log('Inverse sync: Using org-mode sync for', this.sourceFile);
            const orgResult = await orgInverseSync(this.sourceFile, page, x, y);
            if (orgResult) {
                // Send result back to webview
                const filename = path.basename(this.sourceFile);
                this.panel.webview.postMessage({
                    type: 'syncTexResult',
                    file: filename,
                    line: orgResult.line,
                    column: orgResult.column
                });

                // Jump to the org file
                if (clickedText) {
                    await this.jumpToSourceWithText(this.sourceFile, orgResult.line, orgResult.column, clickedText, contextText);
                } else {
                    await this.jumpToSource(this.sourceFile, orgResult.line, orgResult.column);
                }
                return;
            }
        }

        // Default: use standard SyncTeX (for LaTeX files)
        const result = await runSyncTeXInverse(this.pdfPath, page, x, y);
        if (result) {
            // Send SyncTeX result back to webview to update the debug popup
            const filename = result.file.split('/').pop() || result.file;
            this.panel.webview.postMessage({
                type: 'syncTexResult',
                file: filename,
                line: result.line,
                column: result.column
            });

            // Use offset if available, otherwise fall back to column
            let col = result.offset > 0 ? result.offset : result.column;

            // If we have clicked text, try to find it in the source line for more precise positioning
            if (clickedText) {
                console.log(`Looking for clicked text "${clickedText}" in source`);
                await this.jumpToSourceWithText(result.file, result.line, col, clickedText, contextText);
            } else {
                await this.jumpToSource(result.file, result.line, col);
            }
        } else {
            vscode.window.showWarningMessage('SyncTeX: Could not find source location for this position');
        }
    }

    private async jumpToSource(file: string, line: number, column: number = 0, highlightLength: number = 0): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

            // Use the column/offset from SyncTeX, clamping to line length
            const lineIndex = Math.max(0, line - 1);
            const lineText = doc.lineAt(lineIndex);
            const col = Math.min(column, lineText.text.length);

            console.log(`Jumping to ${file}:${line}:${col} (requested col: ${column})`);

            const startPos = new vscode.Position(lineIndex, col);

            // If we have a highlight length, select that text; otherwise select the word at cursor
            let endPos: vscode.Position;
            if (highlightLength > 0) {
                endPos = new vscode.Position(lineIndex, Math.min(col + highlightLength, lineText.text.length));
            } else {
                // Try to select the word at cursor position
                const wordRange = doc.getWordRangeAtPosition(startPos);
                if (wordRange) {
                    endPos = wordRange.end;
                } else {
                    endPos = startPos;
                }
            }

            // First, force focus to the editor area (away from webview)
            await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');

            // Small delay to ensure focus switch completes
            await new Promise(resolve => setTimeout(resolve, 100));

            // Re-show the document to ensure it's the active editor
            const focusedEditor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: false,
                preview: false
            });

            // Clear old highlight first
            this.clearHighlight();

            // Set up listeners BEFORE setting selection (so flag is ready)
            this.setupHighlightCleanupListeners();

            // Now set selection on the focused editor
            const range = new vscode.Range(startPos, endPos);
            focusedEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            focusedEditor.selection = new vscode.Selection(startPos, startPos); // Cursor at start

            // Add a visible highlight decoration
            this.currentHighlight = vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 255, 0, 0.4)',
                border: '2px solid #ff9900',
                borderRadius: '3px'
            });
            focusedEditor.setDecorations(this.currentHighlight, [range]);

            console.log('Selection set:', startPos.line, startPos.character, '-', endPos.line, endPos.character);
        } catch (error) {
            console.error('Failed to jump to source:', error);
        }
    }

    /**
     * Clear the current highlight and its cleanup listeners
     */
    private clearHighlight(): void {
        if (this.currentHighlight) {
            this.currentHighlight.dispose();
            this.currentHighlight = undefined;
        }
        // Dispose all cleanup listeners
        for (const listener of this.highlightCleanupListeners) {
            listener.dispose();
        }
        this.highlightCleanupListeners = [];
    }

    /**
     * Set up listeners to clear highlight on user interaction
     */
    private setupHighlightCleanupListeners(): void {
        // Clear existing listeners first
        for (const listener of this.highlightCleanupListeners) {
            listener.dispose();
        }
        this.highlightCleanupListeners = [];

        // Set flag to ignore the next selection change (caused by us setting the cursor)
        this.ignoreNextSelectionChange = true;

        // Clear on any text change (typing)
        this.highlightCleanupListeners.push(
            vscode.workspace.onDidChangeTextDocument(() => {
                this.clearHighlight();
            })
        );

        // Clear on selection change (clicking) - but ignore the first one
        this.highlightCleanupListeners.push(
            vscode.window.onDidChangeTextEditorSelection(() => {
                if (this.ignoreNextSelectionChange) {
                    this.ignoreNextSelectionChange = false;
                    return;
                }
                this.clearHighlight();
            })
        );
    }

    /**
     * Flash a highlight decoration on the matched text
     */
    private flashHighlight(editor: vscode.TextEditor, start: vscode.Position, end: vscode.Position): void {
        // Skip if start and end are the same (nothing to highlight)
        if (start.isEqual(end)) {
            console.log('flashHighlight: skipping empty range');
            return;
        }

        const highlightDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.6)',
            border: '2px solid rgba(255, 150, 0, 1)',
            borderRadius: '3px',
        });

        const range = new vscode.Range(start, end);
        editor.setDecorations(highlightDecoration, [range]);
        console.log('flashHighlight: highlighting range', start.line, start.character, '-', end.line, end.character);

        // Remove decoration after 3 seconds
        setTimeout(() => {
            highlightDecoration.dispose();
        }, 3000);
    }

    /**
     * Strip LaTeX markup from text, leaving just the content
     * e.g., "\textbf{hello} \emph{world}" -> "hello world"
     */
    private stripLatexMarkup(text: string): string {
        let result = text;

        // Remove LaTeX comments
        result = result.replace(/%.*$/gm, '');

        // Remove common LaTeX commands with braces: \command{content} -> content
        // Handles: \textbf, \textit, \emph, \underline, \texttt, \textrm, \textsf, \textsc
        // Also: \section, \subsection, \chapter, \paragraph, \caption, \label, \ref, \cite
        result = result.replace(/\\(?:textbf|textit|emph|underline|texttt|textrm|textsf|textsc|section|subsection|subsubsection|chapter|paragraph|caption|title|author)\*?\{([^}]*)\}/g, '$1');

        // Remove \label{...} and \ref{...} entirely (they don't produce visible text)
        result = result.replace(/\\(?:label|ref|eqref|cite|citep|citet|pageref)\{[^}]*\}/g, '');

        // Remove remaining simple commands like \\ \, \; \: \! \@
        result = result.replace(/\\[\\,;:!@]/g, ' ');

        // Remove other commands without braces: \command -> ''
        result = result.replace(/\\[a-zA-Z]+\*?/g, '');

        // Remove remaining braces and brackets
        result = result.replace(/[{}[\]]/g, '');

        // Remove $ for math mode
        result = result.replace(/\$/g, '');

        // Normalize whitespace
        result = result.replace(/\s+/g, ' ').trim();

        return result;
    }

    /**
     * Score how well a source line matches the target text
     * Returns { score: number, column: number }
     */
    private scoreLineMatch(sourceLine: string, targetWords: string[], requiredWord?: string): { score: number; column: number } {
        // Strip LaTeX from the source line
        const strippedLine = this.stripLatexMarkup(sourceLine).toLowerCase();
        const lowerSourceLine = sourceLine.toLowerCase();

        // If a required word is specified, the line MUST contain it
        if (requiredWord) {
            const lowerRequired = requiredWord.toLowerCase();
            if (!strippedLine.includes(lowerRequired)) {
                return { score: 0, column: 0 }; // Line doesn't have the clicked word
            }
        }

        let matchCount = 0;
        let firstMatchCol = -1;

        for (const word of targetWords) {
            const lowerWord = word.toLowerCase();

            // Check in stripped line (LaTeX-free)
            if (strippedLine.includes(lowerWord)) {
                matchCount++;

                // Find position in original line
                if (firstMatchCol === -1) {
                    const idx = lowerSourceLine.indexOf(lowerWord);
                    if (idx !== -1) {
                        firstMatchCol = idx;
                    } else {
                        // Word might be inside a LaTeX command, search more carefully
                        const pattern = new RegExp(lowerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                        const match = sourceLine.match(pattern);
                        if (match && match.index !== undefined) {
                            firstMatchCol = match.index;
                        }
                    }
                }
            }
        }

        // Base score: fraction of words matched
        let score = targetWords.length > 0 ? matchCount / targetWords.length : 0;

        // Bonus for consecutive word sequences (n-grams)
        // This is crucial for distinguishing between different occurrences of the same word
        // e.g., "four gaseous reactants" vs "multiple gaseous and liquid"
        let bigramCount = 0;
        let trigramCount = 0;

        if (targetWords.length >= 2) {
            for (let i = 0; i < targetWords.length - 1; i++) {
                const bigram = targetWords[i].toLowerCase() + ' ' + targetWords[i + 1].toLowerCase();
                if (strippedLine.includes(bigram)) {
                    bigramCount++;
                    score += 0.3; // Strong bonus for each consecutive pair found
                }
            }
        }

        // Bonus for 3-word sequences (even stronger signal)
        if (targetWords.length >= 3) {
            for (let i = 0; i < targetWords.length - 2; i++) {
                const trigram = targetWords[i].toLowerCase() + ' ' + targetWords[i + 1].toLowerCase() + ' ' + targetWords[i + 2].toLowerCase();
                if (strippedLine.includes(trigram)) {
                    trigramCount++;
                    score += 0.5; // Very strong bonus for trigrams
                }
            }
        }

        // Log scoring for debugging
        if (score > 0.3) {
            console.log(`  Line scoring: base=${(matchCount / targetWords.length).toFixed(2)}, bigrams=${bigramCount}, trigrams=${trigramCount}, total=${score.toFixed(2)}`);
        }

        return { score, column: firstMatchCol >= 0 ? firstMatchCol : 0 };
    }

    /**
     * Find the position of a specific word within a line, accounting for LaTeX markup
     */
    private findWordInLine(lineText: string, word: string): number {
        const lowerLine = lineText.toLowerCase();
        const lowerWord = word.toLowerCase();

        // Direct match first
        let idx = lowerLine.indexOf(lowerWord);
        if (idx !== -1) return idx;

        // Try finding inside LaTeX commands like \textbf{word}
        const patterns = [
            new RegExp(`\\\\\\w+\\{[^}]*${this.escapeRegex(lowerWord)}`, 'i'),
            new RegExp(`\\\\\\w+\\[[^\\]]*\\]\\{[^}]*${this.escapeRegex(lowerWord)}`, 'i'),
        ];

        for (const pattern of patterns) {
            const match = lineText.match(pattern);
            if (match && match.index !== undefined) {
                // Find the word within the match
                const matchLower = match[0].toLowerCase();
                const wordPos = matchLower.indexOf(lowerWord);
                if (wordPos !== -1) {
                    return match.index + wordPos;
                }
            }
        }

        return -1;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Check if text looks like math/equation content
     */
    private looksLikeMath(text: string): boolean {
        // Greek letters (rendered), math operators, numbers with symbols
        const mathPatterns = [
            /[αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/,  // Greek letters
            /[∫∑∏∂∇∞±×÷≈≠≤≥∈∉⊂⊃∪∩√∝∀∃]/,  // Math symbols
            /^\s*[\d\.\-\+\=\(\)]+\s*$/,  // Just numbers and operators
            /^[a-zA-Z]\s*[=<>≤≥]\s*/,  // Variable = something
            /\d+\s*[×·]\s*\d+/,  // Multiplication
            /^[A-Z]\([a-z]+\)$/i,  // F(liq), x(t), etc. - function notation
            /^[A-Z]_?[a-z]+$/,  // Subscript-like: Fliq, Xmax, etc.
            /^[a-z]\d+$/i,  // Variable with number: x1, t0
        ];

        // Also consider very short text with parentheses as likely math
        if (text.length < 12 && /\(.*\)/.test(text)) {
            console.log(`Short text with parens "${text}" treated as math`);
            return true;
        }

        return mathPatterns.some(p => p.test(text));
    }

    /**
     * Jump to source with text-based refinement
     * Uses SyncTeX for approximate location, then searches for best matching line
     * @param clickedText - The specific word/text that was clicked
     * @param contextText - The broader context (all nearby words) for line matching
     */
    private async jumpToSourceWithText(file: string, line: number, column: number, clickedText: string, contextText?: string): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

            // Check if this looks like math content - check both clicked word AND context phrase
            const isMathContent = this.looksLikeMath(clickedText) || (contextText && this.looksLikeMath(contextText));
            if (isMathContent) {
                console.log(`Detected math content: clicked="${clickedText}", context="${contextText}", using SyncTeX position directly`);
                // For math, SyncTeX is usually accurate enough - just go there
                await this.jumpToSource(file, line, column);
                return;
            }

            // The clicked word is what we want to position cursor at
            const targetWord = clickedText.replace(/[.,;:!?'"()[\]{}]/g, '').trim();

            // Use context (or clicked text) for finding the correct line
            const searchText = contextText || clickedText;
            const cleanedSearchText = searchText.replace(/[.,;:!?'"()[\]{}]/g, '').trim();
            const searchWords = cleanedSearchText.split(/\s+/).filter(w => w.length >= 2);

            console.log(`Target word: "${targetWord}", Search words: ${JSON.stringify(searchWords)} near line ${line}`);

            if (searchWords.length === 0) {
                // No words to search for, just go to SyncTeX location
                await this.jumpToSource(file, line, column);
                return;
            }

            // Search the ENTIRE file for the best match
            // SyncTeX position is used only as a tiebreaker, not to limit search range
            const lineIndex = Math.max(0, line - 1); // SyncTeX line (for tiebreaking)

            let bestMatch = { lineIdx: lineIndex, score: 0, column: 0 };

            for (let i = 0; i < doc.lineCount; i++) {
                const lineText = doc.lineAt(i).text;
                // Pass targetWord as required - line MUST contain the clicked word
                const { score, column: col } = this.scoreLineMatch(lineText, searchWords, targetWord);

                // Use SyncTeX position as a very small tiebreaker (0.001 per line of distance)
                // This only matters when scores are nearly identical
                const distancePenalty = Math.abs(i - lineIndex) * 0.001;
                const adjustedScore = score - distancePenalty;

                if (adjustedScore > bestMatch.score) {
                    bestMatch = { lineIdx: i, score: adjustedScore, column: col };
                }
            }

            let finalLine = lineIndex;
            let finalCol = column;

            if (bestMatch.score > 0.3) {
                // Good enough match found
                finalLine = bestMatch.lineIdx;
                const matchedLineText = doc.lineAt(finalLine).text;
                console.log(`Best match: line ${finalLine + 1} (SyncTeX said ${line}), score=${bestMatch.score.toFixed(2)}`);
                console.log(`  Matched text: "${matchedLineText.substring(0, 80)}..."`);

                // Now find the SPECIFIC clicked word within the matched line
                // Important: Find the occurrence that's near the context words, not just the first one
                // e.g., for "liquid" in phrase "and liquid reactants", find that "liquid", not "vapor-liquid"
                const lowerLine = matchedLineText.toLowerCase();
                const lowerTarget = targetWord.toLowerCase();

                // Find ALL occurrences of the target word
                const occurrences: number[] = [];
                let searchStart = 0;
                while (true) {
                    const idx = lowerLine.indexOf(lowerTarget, searchStart);
                    if (idx === -1) break;
                    occurrences.push(idx);
                    searchStart = idx + 1;
                }

                console.log(`Found ${occurrences.length} occurrences of "${targetWord}" at positions:`, occurrences);

                if (occurrences.length === 1) {
                    // Only one occurrence, use it
                    finalCol = occurrences[0];
                    console.log(`Single occurrence of "${targetWord}" at column ${finalCol}`);
                } else if (occurrences.length > 1) {
                    // Multiple occurrences - find the one with best context match
                    // Look for adjacent words from the search phrase
                    let bestOccurrence = occurrences[0];
                    let bestContextScore = 0;

                    for (const pos of occurrences) {
                        let contextScore = 0;
                        // Check words before and after this position
                        const before = lowerLine.substring(Math.max(0, pos - 20), pos);
                        const after = lowerLine.substring(pos + lowerTarget.length, pos + lowerTarget.length + 20);

                        // Score based on how many search words appear nearby
                        for (const word of searchWords) {
                            const lowerWord = word.toLowerCase();
                            if (lowerWord !== lowerTarget) {
                                if (before.includes(lowerWord) || after.includes(lowerWord)) {
                                    contextScore++;
                                }
                            }
                        }

                        console.log(`  Occurrence at ${pos}: contextScore=${contextScore}, before="${before}", after="${after.substring(0, 15)}..."`);

                        if (contextScore > bestContextScore) {
                            bestContextScore = contextScore;
                            bestOccurrence = pos;
                        }
                    }

                    finalCol = bestOccurrence;
                    console.log(`Best occurrence of "${targetWord}" at column ${finalCol} (context score: ${bestContextScore})`);
                } else {
                    // No occurrences found, fall back to column from scoreLineMatch
                    finalCol = bestMatch.column;
                    console.log(`Target word "${targetWord}" not found, using match column ${finalCol}`);
                }

                console.log(`Found match at line ${finalLine + 1} with score ${bestMatch.score.toFixed(2)}`);
            } else {
                console.log(`No good match found (best score: ${bestMatch.score.toFixed(2)}), using SyncTeX position`);
                finalCol = Math.min(column, doc.lineAt(finalLine).text.length);
            }

            console.log(`Jumping to ${file}:${finalLine + 1}:${finalCol} (clicked: "${clickedText}")`);

            const lineText = doc.lineAt(finalLine).text;
            const lowerLineText = lineText.toLowerCase();

            // Find the extent of the PHRASE in the line (not just the clicked word)
            // Look for where the search words appear and highlight that span
            let phraseStart = lineText.length;
            let phraseEnd = 0;

            // Find positions of all matching search words
            for (const word of searchWords) {
                const lowerWord = word.toLowerCase();
                let pos = 0;
                while ((pos = lowerLineText.indexOf(lowerWord, pos)) !== -1) {
                    // Check if this is near the clicked word position (within 50 chars)
                    if (Math.abs(pos - finalCol) < 50) {
                        phraseStart = Math.min(phraseStart, pos);
                        phraseEnd = Math.max(phraseEnd, pos + word.length);
                    }
                    pos++;
                }
            }

            // If we found phrase bounds, use them; otherwise fall back to just the clicked word
            let selectionStart: number;
            let selectionEnd: number;

            if (phraseEnd > phraseStart) {
                selectionStart = phraseStart;
                selectionEnd = phraseEnd;
                console.log(`Found phrase span: cols ${selectionStart}-${selectionEnd}`);
            } else {
                // Fall back to just the clicked word
                selectionStart = finalCol;
                selectionEnd = finalCol + targetWord.length;
                console.log(`Using clicked word only: cols ${selectionStart}-${selectionEnd}`);
            }

            // Ensure we have valid positions
            selectionStart = Math.max(0, Math.min(selectionStart, lineText.length));
            selectionEnd = Math.max(selectionStart, Math.min(selectionEnd, lineText.length));

            const startPos = new vscode.Position(finalLine, selectionStart);
            const endPos = new vscode.Position(finalLine, selectionEnd);

            console.log(`Selecting: line ${finalLine + 1}, cols ${selectionStart}-${selectionEnd}, text: "${lineText.substring(selectionStart, selectionEnd)}"`);

            // First, force focus to the editor area (away from webview)
            await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');

            // Small delay to ensure focus switch completes
            await new Promise(resolve => setTimeout(resolve, 100));

            // Re-show the document to ensure it's the active editor
            const focusedEditor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: false,
                preview: false
            });

            // Phrase range for highlighting
            const phraseRange = new vscode.Range(startPos, endPos);

            // Cursor position: on the clicked word, not the whole phrase
            const cursorPos = new vscode.Position(finalLine, finalCol);

            // Clear old highlight first
            this.clearHighlight();

            // Set up listeners BEFORE setting selection (so flag is ready)
            this.setupHighlightCleanupListeners();

            // Reveal the phrase and set cursor on the clicked word
            focusedEditor.revealRange(phraseRange, vscode.TextEditorRevealType.InCenter);
            focusedEditor.selection = new vscode.Selection(cursorPos, cursorPos);

            // Add a visible highlight decoration on the PHRASE
            this.currentHighlight = vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 255, 0, 0.4)',
                border: '2px solid #ff9900',
                borderRadius: '3px'
            });
            focusedEditor.setDecorations(this.currentHighlight, [phraseRange]);

            // Verify selection was set
            console.log('Selection set:', focusedEditor.selection.start.line, focusedEditor.selection.start.character, '-', focusedEditor.selection.end.line, focusedEditor.selection.end.character);
            console.log('Selection empty?', focusedEditor.selection.isEmpty);
        } catch (error) {
            console.error('Failed to jump to source with text:', error);
            await this.jumpToSource(file, line, column);
        }
    }

    private getLoadingHtml(): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-font-family);
                    }
                </style>
            </head>
            <body>
                <p>Loading PDF...</p>
            </body>
            </html>
        `;
    }

    private getErrorHtml(message: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        text-align: center;
                        padding: 20px;
                    }
                    button {
                        margin-top: 10px;
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <p>${message}</p>
                    <button onclick="vscode.postMessage({type: 'refresh'})">Refresh</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                </script>
            </body>
            </html>
        `;
    }

    private getHtmlContent(pdfBase64: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    html, body {
                        height: 100%;
                        overflow: hidden;
                        background: var(--vscode-editor-background);
                    }
                    .toolbar {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        height: 36px;
                        background: var(--vscode-editorWidget-background);
                        border-bottom: 1px solid var(--vscode-editorWidget-border);
                        display: flex;
                        align-items: center;
                        padding: 0 10px;
                        gap: 8px;
                        z-index: 100;
                    }
                    .toolbar button {
                        padding: 4px 8px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        cursor: pointer;
                        font-size: 12px;
                    }
                    .toolbar button:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }
                    .toolbar span {
                        color: var(--vscode-foreground);
                        font-size: 12px;
                    }
                    .toolbar input {
                        width: 50px;
                        padding: 2px 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        text-align: center;
                    }
                    #pdf-container {
                        position: absolute;
                        top: 36px;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        overflow: auto;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        padding: 10px;
                        background: #525659;
                    }
                    #pdf-container canvas {
                        margin-bottom: 10px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        cursor: crosshair;
                    }
                    .page-info {
                        flex: 1;
                        text-align: center;
                    }
                    .sync-indicator {
                        position: absolute;
                        background: rgba(255, 255, 0, 0.5);
                        border: 3px solid rgba(255, 100, 0, 0.9);
                        border-radius: 4px;
                        pointer-events: none;
                        z-index: 50;
                        box-shadow: 0 0 10px rgba(255, 200, 0, 0.8);
                        animation: sync-flash 3s ease-out forwards;
                    }
                    @keyframes sync-flash {
                        0% { opacity: 1; transform: scale(1); }
                        10% { transform: scale(1.05); }
                        20% { transform: scale(1); }
                        80% { opacity: 1; }
                        100% { opacity: 0; }
                    }
                    .text-highlight {
                        position: absolute;
                        background: rgba(255, 200, 0, 0.6);
                        border: 2px solid rgba(255, 100, 0, 0.9);
                        border-radius: 3px;
                        pointer-events: none;
                        z-index: 50;
                        box-shadow: 0 0 8px rgba(255, 200, 0, 0.8);
                        animation: text-highlight-flash 3s ease-out forwards;
                    }
                    @keyframes text-highlight-flash {
                        0% { opacity: 1; transform: scale(1); }
                        10% { transform: scale(1.1); }
                        20% { transform: scale(1); }
                        70% { opacity: 1; }
                        100% { opacity: 0; }
                    }
                    .debug-popup {
                        position: fixed;
                        top: 50px;
                        right: 10px;
                        background: rgba(0, 0, 0, 0.9);
                        color: #fff;
                        padding: 12px 16px;
                        border-radius: 6px;
                        font-family: monospace;
                        font-size: 12px;
                        max-width: 400px;
                        z-index: 1000;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                        white-space: pre-wrap;
                        word-break: break-all;
                    }
                    .debug-popup .title {
                        color: #4fc3f7;
                        font-weight: bold;
                        margin-bottom: 8px;
                    }
                    .debug-popup .label {
                        color: #81c784;
                    }
                    .debug-popup .value {
                        color: #fff176;
                    }
                    .page-wrapper {
                        position: relative;
                        margin-bottom: 10px;
                    }
                    /* Text layer for selection */
                    .text-layer {
                        position: absolute;
                        left: 0;
                        top: 0;
                        right: 0;
                        bottom: 0;
                        overflow: hidden;
                        opacity: 0.2;
                        line-height: 1.0;
                    }
                    .text-layer > span {
                        color: transparent;
                        position: absolute;
                        white-space: pre;
                        cursor: text;
                        transform-origin: 0% 0%;
                    }
                    .text-layer ::selection {
                        background: rgba(0, 0, 255, 0.3);
                    }
                    .text-layer .highlight {
                        background-color: rgba(255, 255, 0, 0.5);
                        color: transparent;
                    }
                    /* Search box */
                    .search-box {
                        display: none;
                        position: fixed;
                        top: 45px;
                        right: 10px;
                        background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        padding: 8px;
                        z-index: 100;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    }
                    .search-box.visible {
                        display: flex;
                        gap: 4px;
                        align-items: center;
                    }
                    .search-box input {
                        padding: 4px 8px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px;
                        width: 200px;
                    }
                    .search-box button {
                        padding: 4px 8px;
                    }
                    .search-info {
                        color: var(--vscode-foreground);
                        font-size: 11px;
                        margin-left: 8px;
                    }
                    /* Context menu */
                    .context-menu {
                        position: fixed;
                        background: var(--vscode-menu-background, #252526);
                        border: 1px solid var(--vscode-menu-border, #454545);
                        border-radius: 4px;
                        padding: 4px 0;
                        min-width: 150px;
                        z-index: 1000;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                    }
                    .context-menu-item {
                        padding: 6px 12px;
                        cursor: pointer;
                        color: var(--vscode-menu-foreground, #ccc);
                        font-size: 13px;
                    }
                    .context-menu-item:hover {
                        background: var(--vscode-menu-selectionBackground, #094771);
                        color: var(--vscode-menu-selectionForeground, #fff);
                    }
                    .context-menu-separator {
                        height: 1px;
                        background: var(--vscode-menu-separatorBackground, #454545);
                        margin: 4px 0;
                    }
                </style>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
            </head>
            <body>
                <div class="toolbar">
                    <button id="zoom-out">−</button>
                    <span id="zoom-level">100%</span>
                    <button id="zoom-in">+</button>
                    <button id="zoom-fit">Fit</button>
                    <span class="page-info">
                        Page <input type="number" id="page-num" value="1" min="1"> of <span id="page-count">-</span>
                    </span>
                    <button id="prev-page">◀</button>
                    <button id="next-page">▶</button>
                    <button id="refresh">↻ Refresh</button>
                    <button id="search-btn">🔍 Search</button>
                </div>
                <div class="search-box" id="search-box">
                    <input type="text" id="search-input" placeholder="Search in PDF...">
                    <button id="search-prev">◀</button>
                    <button id="search-next">▶</button>
                    <button id="search-close">✕</button>
                    <span class="search-info" id="search-info"></span>
                </div>
                <div id="pdf-container"></div>

                <script>
                    const vscode = acquireVsCodeApi();

                    // PDF.js configuration
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

                    let pdfDoc = null;
                    let currentScale = 1.0;
                    let renderedPages = new Map();
                    let pageViewports = new Map(); // Store viewports for coordinate conversion
                    let pageWrappers = new Map(); // Store page wrapper elements
                    let pageTextContent = new Map(); // Store text content for each page
                    const container = document.getElementById('pdf-container');

                    // Load PDF from base64
                    const pdfData = atob('${pdfBase64}');
                    const pdfArray = new Uint8Array(pdfData.length);
                    for (let i = 0; i < pdfData.length; i++) {
                        pdfArray[i] = pdfData.charCodeAt(i);
                    }

                    pdfjsLib.getDocument({ data: pdfArray }).promise.then(pdf => {
                        pdfDoc = pdf;
                        document.getElementById('page-count').textContent = pdf.numPages;
                        document.getElementById('page-num').max = pdf.numPages;
                        renderAllPages();
                    }).catch(err => {
                        container.innerHTML = '<p style="color: red; padding: 20px;">Error loading PDF: ' + err.message + '</p>';
                    });

                    async function renderAllPages() {
                        container.innerHTML = '';
                        renderedPages.clear();
                        pageViewports.clear();
                        pageWrappers.clear();
                        pageTextContent.clear();

                        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                            const page = await pdfDoc.getPage(pageNum);
                            // Get the base viewport at scale 1.0 for coordinate conversion
                            const baseViewport = page.getViewport({ scale: 1.0 });
                            const renderScale = currentScale * 1.5; // 1.5 for better quality
                            const viewport = page.getViewport({ scale: renderScale });

                            // Create wrapper for positioning sync indicator
                            const wrapper = document.createElement('div');
                            wrapper.className = 'page-wrapper';
                            wrapper.id = 'wrapper-' + pageNum;

                            const canvas = document.createElement('canvas');
                            canvas.id = 'page-' + pageNum;
                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            canvas.dataset.pageNum = pageNum;
                            canvas.dataset.renderScale = renderScale;

                            wrapper.appendChild(canvas);
                            container.appendChild(wrapper);

                            const context = canvas.getContext('2d');
                            await page.render({
                                canvasContext: context,
                                viewport: viewport
                            }).promise;

                            // Get text content for this page (for click-to-text mapping)
                            const textContent = await page.getTextContent();
                            pageTextContent.set(pageNum, { content: textContent, viewport: baseViewport });

                            // Create text layer for selection
                            const textLayerDiv = document.createElement('div');
                            textLayerDiv.className = 'text-layer';
                            textLayerDiv.style.width = canvas.style.width || (viewport.width + 'px');
                            textLayerDiv.style.height = canvas.style.height || (viewport.height + 'px');
                            textLayerDiv.dataset.pageNum = pageNum;

                            // Render text items into the text layer
                            for (const item of textContent.items) {
                                if (!item.str) continue;

                                const tx = item.transform;
                                const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
                                const fontHeight = Math.abs(tx[3]);

                                // Convert PDF coords to canvas coords
                                const x = tx[4] * renderScale;
                                const y = (baseViewport.height - tx[5]) * renderScale - fontHeight * renderScale;

                                const span = document.createElement('span');
                                span.textContent = item.str;
                                span.style.left = x + 'px';
                                span.style.top = y + 'px';
                                span.style.fontSize = (fontSize * renderScale) + 'px';
                                span.style.fontFamily = item.fontName || 'sans-serif';
                                span.dataset.text = item.str;

                                textLayerDiv.appendChild(span);
                            }

                            wrapper.appendChild(textLayerDiv);

                            renderedPages.set(pageNum, canvas);
                            pageViewports.set(pageNum, { base: baseViewport, render: viewport });
                            pageWrappers.set(pageNum, wrapper);

                            // Add double-click handler for inverse sync (on both canvas and text layer)
                            canvas.addEventListener('dblclick', (e) => handleCanvasDoubleClick(e, pageNum));
                            textLayerDiv.addEventListener('dblclick', (e) => handleCanvasDoubleClick(e, pageNum));
                        }
                    }

                    /**
                     * Convert screen coordinates to PDF coordinates
                     * PDF coordinate system: origin at bottom-left, units in points (72 DPI)
                     */
                    function screenToPdf(canvas, clientX, clientY, pageNum) {
                        const vpInfo = pageViewports.get(pageNum);
                        if (!vpInfo) return null;

                        const rect = canvas.getBoundingClientRect();
                        const renderScale = parseFloat(canvas.dataset.renderScale);

                        // Position within canvas (0 to canvas.width/height)
                        const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
                        const canvasY = (clientY - rect.top) * (canvas.height / rect.height);

                        // Convert to PDF coordinates (72 DPI)
                        // PDF origin is bottom-left, so we need to flip Y
                        const pdfX = canvasX / renderScale;
                        const pdfY = vpInfo.base.height - (canvasY / renderScale);

                        return { x: pdfX, y: pdfY };
                    }

                    /**
                     * Convert PDF coordinates to screen position (relative to page wrapper)
                     */
                    function pdfToScreen(pdfX, pdfY, pageNum) {
                        const vpInfo = pageViewports.get(pageNum);
                        const canvas = renderedPages.get(pageNum);
                        if (!vpInfo || !canvas) return null;

                        const renderScale = parseFloat(canvas.dataset.renderScale);

                        // Convert from PDF coordinates (bottom-left origin) to canvas coordinates (top-left origin)
                        const canvasX = pdfX * renderScale;
                        const canvasY = (vpInfo.base.height - pdfY) * renderScale;

                        return { x: canvasX, y: canvasY };
                    }

                    /**
                     * Find text at a given PDF position
                     * Uses a simple "find closest text item" approach
                     */
                    function findTextAtPosition(pageNum, pdfX, pdfY) {
                        const textData = pageTextContent.get(pageNum);
                        if (!textData) {
                            console.log('No text data for page', pageNum);
                            return null;
                        }

                        const { content, viewport } = textData;
                        const pageHeight = viewport.height;

                        console.log('Looking for text at PDF coords:', pdfX.toFixed(1), pdfY.toFixed(1), 'page height:', pageHeight.toFixed(1));
                        console.log('Total text items on page:', content.items.length);

                        // Debug: show sample text items to understand coordinate system
                        const sampleItems = content.items.filter(i => i.str && i.str.trim()).slice(0, 5);
                        console.log('Sample text items:', sampleItems.map(i => ({
                            text: i.str.substring(0, 20),
                            x: i.transform[4].toFixed(1),
                            y: i.transform[5].toFixed(1),
                            width: (i.width || 0).toFixed(1)
                        })));

                        // Get all text items with content
                        const textItems = content.items.filter(i => i.str && i.str.trim());

                        // Log coordinate range for debugging
                        if (textItems.length > 0) {
                            const yValues = textItems.map(i => i.transform[5]);
                            const minY = Math.min(...yValues);
                            const maxY = Math.max(...yValues);
                            console.log('Text Y range on page:', minY.toFixed(1), 'to', maxY.toFixed(1));
                            console.log('Click Y:', pdfY.toFixed(1));
                        }

                        // APPROACH 1: Find items where click is inside bounding box (with padding)
                        const padding = 5; // pixels of tolerance
                        let hitItems = [];

                        for (const item of textItems) {
                            const transform = item.transform;
                            const itemX = transform[4];
                            const itemY = transform[5];
                            const itemWidth = item.width || (item.str.length * 6);
                            const itemHeight = Math.abs(transform[3]) || 12;

                            // Check if click is inside bounding box (with padding)
                            // PDF coords: Y increases upward, itemY is baseline
                            const inX = pdfX >= (itemX - padding) && pdfX <= (itemX + itemWidth + padding);
                            const inY = pdfY >= (itemY - padding) && pdfY <= (itemY + itemHeight + padding);

                            if (inX && inY) {
                                hitItems.push({ item, x: itemX, y: itemY, width: itemWidth });
                            }
                        }

                        console.log('Direct hits:', hitItems.length);

                        // APPROACH 2: If no direct hit, find items on same line (similar Y)
                        if (hitItems.length === 0) {
                            const lineThreshold = 15; // items within 15 points vertically
                            const sameLineItems = textItems.filter(item => {
                                const itemY = item.transform[5];
                                return Math.abs(pdfY - itemY) < lineThreshold;
                            });

                            console.log('Items on same line:', sameLineItems.length);

                            // Find the item closest horizontally on this line
                            let closestOnLine = null;
                            let closestXDist = Infinity;

                            for (const item of sameLineItems) {
                                const itemX = item.transform[4];
                                const itemWidth = item.width || (item.str.length * 6);
                                const itemCenter = itemX + itemWidth / 2;
                                const xDist = Math.abs(pdfX - itemCenter);

                                if (xDist < closestXDist) {
                                    closestXDist = xDist;
                                    closestOnLine = item;
                                }
                            }

                            if (closestOnLine) {
                                hitItems = [{ item: closestOnLine, x: closestOnLine.transform[4], y: closestOnLine.transform[5] }];
                                console.log('Closest on line at X distance:', closestXDist.toFixed(1));
                            }
                        }

                        // APPROACH 3: Fall back to closest item overall
                        let closestItem = hitItems.length > 0 ? hitItems[0].item : null;
                        let closestDistance = 0;

                        if (!closestItem) {
                            closestDistance = Infinity;
                            for (const item of textItems) {
                                const transform = item.transform;
                                const itemX = transform[4];
                                const itemY = transform[5];
                                const itemWidth = item.width || (item.str.length * 6);
                                const centerX = itemX + itemWidth / 2;
                                const centerY = itemY + 6;

                                const distance = Math.sqrt(Math.pow(pdfX - centerX, 2) + Math.pow(pdfY - centerY, 2));
                                if (distance < closestDistance) {
                                    closestDistance = distance;
                                    closestItem = item;
                                }
                            }
                            console.log('Fallback: closest at distance', closestDistance.toFixed(1));
                        }

                        // Accept the item
                        if (closestItem && (hitItems.length > 0 || closestDistance < 100)) {
                            const text = closestItem.str.trim();
                            console.log('Found text span:', text);
                            console.log('Text span length:', text.length);

                            // Calculate character position based on click X relative to text item
                            const itemX = closestItem.transform[4];
                            const itemWidth = closestItem.width || (text.length * 6);
                            const relativeX = Math.max(0, Math.min(1, (pdfX - itemX) / itemWidth));
                            const charIndex = Math.floor(relativeX * text.length);

                            console.log('Click at relative X:', relativeX.toFixed(2), 'char index:', charIndex);

                            // Find word boundaries around the click position
                            // Word characters: letters, numbers, hyphens
                            const isWordChar = (c) => /[a-zA-Z0-9\-]/.test(c);

                            let wordStart = charIndex;
                            let wordEnd = charIndex;

                            // Scan backward to find word start
                            while (wordStart > 0 && isWordChar(text[wordStart - 1])) {
                                wordStart--;
                            }

                            // Scan forward to find word end
                            while (wordEnd < text.length && isWordChar(text[wordEnd])) {
                                wordEnd++;
                            }

                            // Extract the clicked word
                            let clickedWord = text.substring(wordStart, wordEnd).trim();

                            // If we didn't find a word at click position, try to find nearest word
                            if (!clickedWord || clickedWord.length < 2) {
                                // Find all words and pick closest to click position
                                const wordMatches = [...text.matchAll(/[a-zA-Z0-9\-]+/g)];
                                if (wordMatches.length > 0) {
                                    let closest = wordMatches[0];
                                    let closestDist = Math.abs(charIndex - closest.index);
                                    for (const match of wordMatches) {
                                        const dist = Math.abs(charIndex - match.index);
                                        if (dist < closestDist) {
                                            closest = match;
                                            closestDist = dist;
                                        }
                                    }
                                    clickedWord = closest[0];
                                }
                            }

                            console.log('Clicked word:', clickedWord, 'from position', wordStart, '-', wordEnd);

                            return {
                                word: clickedWord || text.split(/\s+/)[0] || text,
                                context: text,
                                allText: text
                            };
                        }

                        console.log('No text found within range');
                        return null;
                    }

                    /**
                     * Show debug popup with click information
                     */
                    function showDebugPopup(info) {
                        // Remove existing popup
                        const existing = document.querySelector('.debug-popup');
                        if (existing) existing.remove();

                        const popup = document.createElement('div');
                        popup.className = 'debug-popup';
                        popup.innerHTML = \`
                            <div class="title">Click Debug Info <span class="close-btn" style="float: right; cursor: pointer; font-size: 18px; line-height: 1;">&times;</span></div>
                            <div><span class="label">Page:</span> <span class="value">\${info.page}</span></div>
                            <div><span class="label">PDF coords:</span> <span class="value">(\${info.pdfX.toFixed(1)}, \${info.pdfY.toFixed(1)})</span></div>
                            <hr style="border-color: #555; margin: 8px 0;">
                            <div><span class="label">SyncTeX target:</span></div>
                            <div id="synctex-info" class="value" style="color: #ffa726;">Loading...</div>
                            <hr style="border-color: #555; margin: 8px 0;">
                            <div><span class="label">Phrase (for matching line):</span></div>
                            <div class="value" style="margin-top: 4px; font-size: 13px; max-width: 280px; word-wrap: break-word; background: #333; padding: 4px; border-radius: 3px;">\${info.phrase || '(none)'}</div>
                            <hr style="border-color: #555; margin: 8px 0;">
                            <div><span class="label">Clicked word (for cursor):</span></div>
                            <div class="value" style="margin-top: 4px; font-size: 16px; color: #4fc3f7; font-weight: bold;">\${info.clickedWord || '(none)'}</div>
                        \`;
                        document.body.appendChild(popup);

                        // Close button handler
                        popup.querySelector('.close-btn').addEventListener('click', () => popup.remove());
                    }

                    /**
                     * Show debug popup for forward sync (TeX → PDF)
                     */
                    function showForwardSyncDebugPopup(info) {
                        // Remove existing popup
                        const existing = document.querySelector('.debug-popup');
                        if (existing) existing.remove();

                        // Extract just the filename from the path
                        const filename = info.file ? info.file.split('/').pop() : '(unknown)';

                        const popup = document.createElement('div');
                        popup.className = 'debug-popup';
                        popup.innerHTML = \`
                            <div class="title">Forward Sync Debug <span class="close-btn" style="float: right; cursor: pointer; font-size: 18px; line-height: 1;">&times;</span></div>
                            <hr style="border-color: #555; margin: 8px 0;">
                            <div><span class="label">Source:</span></div>
                            <div class="value" style="font-size: 12px; color: #aaa;">\${filename}</div>
                            <div><span class="label">Line:</span> <span class="value">\${info.line}</span> &nbsp; <span class="label">Col:</span> <span class="value">\${info.column}</span></div>
                            <hr style="border-color: #555; margin: 8px 0;">
                            <div><span class="label">Source text:</span></div>
                            <div class="value" style="margin-top: 4px; font-size: 13px; max-width: 280px; word-wrap: break-word; background: #333; padding: 4px; border-radius: 3px;">\${info.text || '(none)'}</div>
                            <hr style="border-color: #555; margin: 8px 0;">
                            <div><span class="label">PDF target:</span></div>
                            <div><span class="label">Page:</span> <span class="value">\${info.page}</span></div>
                            <div><span class="label">PDF coords:</span> <span class="value">(\${info.pdfX.toFixed(1)}, \${info.pdfY.toFixed(1)})</span></div>
                        \`;
                        document.body.appendChild(popup);

                        // Close button handler
                        popup.querySelector('.close-btn').addEventListener('click', () => popup.remove());
                    }

                    /**
                     * Handle double-click on canvas for inverse sync
                     */
                    function handleCanvasDoubleClick(event, pageNum) {
                        // Prevent default behavior and stop propagation to avoid any scrolling
                        event.preventDefault();
                        event.stopPropagation();

                        console.log('Double-click on page', pageNum, 'at', event.clientX, event.clientY);

                        const canvas = renderedPages.get(pageNum);
                        if (!canvas) {
                            console.log('Canvas not found for page', pageNum);
                            return;
                        }

                        const pdfCoords = screenToPdf(canvas, event.clientX, event.clientY, pageNum);
                        if (!pdfCoords) {
                            console.log('Could not convert to PDF coords');
                            return;
                        }

                        // Try to find text at the click position
                        const textInfo = findTextAtPosition(pageNum, pdfCoords.x, pdfCoords.y);
                        const clickedWord = textInfo ? textInfo.word : null;
                        const phrase = textInfo ? textInfo.context : null;

                        // Show debug popup with both phrase and clicked word
                        showDebugPopup({
                            page: pageNum,
                            pdfX: pdfCoords.x,
                            pdfY: pdfCoords.y,
                            phrase: phrase,
                            clickedWord: clickedWord
                        });

                        console.log('Phrase:', phrase, 'Clicked word:', clickedWord);
                        console.log('Sending inverseSync:', { page: pageNum, x: pdfCoords.x, y: pdfCoords.y, word: clickedWord, phrase: phrase });

                        // Send inverse sync request to extension with both phrase and clicked word
                        vscode.postMessage({
                            type: 'inverseSync',
                            page: pageNum,
                            x: pdfCoords.x,
                            y: pdfCoords.y,
                            clickedText: clickedWord,
                            contextText: phrase
                        });
                    }

                    /**
                     * Find text spans in the text layer near a given Y position that contain the search word
                     * @param pageNum Page number
                     * @param pdfY Y coordinate in PDF points (from bottom)
                     * @param searchWord Word to search for
                     * @param tolerance How many PDF points above/below to search (default 50)
                     * @returns Array of matching span elements, sorted by distance from target Y
                     */
                    function findTextNearPosition(pageNum, pdfY, searchWord, tolerance = 50) {
                        if (!searchWord || searchWord.length < 2) return [];

                        const wrapper = pageWrappers.get(pageNum);
                        const vpInfo = pageViewports.get(pageNum);
                        const canvas = renderedPages.get(pageNum);
                        if (!wrapper || !vpInfo || !canvas) return [];

                        const textLayer = wrapper.querySelector('.text-layer');
                        if (!textLayer) return [];

                        const renderScale = parseFloat(canvas.dataset.renderScale);
                        const searchLower = searchWord.toLowerCase();

                        // Convert PDF Y to screen Y for comparison
                        const targetScreenY = (vpInfo.base.height - pdfY) * renderScale;
                        const toleranceScreen = tolerance * renderScale;

                        const matches = [];
                        const spans = textLayer.querySelectorAll('span');

                        for (const span of spans) {
                            const spanText = span.textContent || '';
                            const spanTextLower = spanText.toLowerCase();

                            // Check if span contains the search word
                            if (spanTextLower.includes(searchLower)) {
                                const spanTop = parseFloat(span.style.top) || 0;
                                const distance = Math.abs(spanTop - targetScreenY);

                                // Only include if within tolerance
                                if (distance <= toleranceScreen) {
                                    matches.push({
                                        span: span,
                                        distance: distance,
                                        text: spanText
                                    });
                                }
                            }
                        }

                        // Sort by distance from target Y
                        matches.sort((a, b) => a.distance - b.distance);
                        console.log('findTextNearPosition: Found', matches.length, 'matches for "' + searchWord + '" near Y=' + pdfY);
                        return matches;
                    }

                    /**
                     * Highlight a specific text span in the PDF
                     * @param span The span element to highlight
                     * @param searchWord The word to highlight within the span (optional, highlights whole span if not provided)
                     */
                    function highlightTextSpan(span, searchWord = '') {
                        if (!span) return;

                        // Remove any existing highlights
                        const existing = document.querySelectorAll('.text-highlight');
                        existing.forEach(el => el.remove());

                        // Get span position and dimensions
                        const rect = span.getBoundingClientRect();
                        const wrapper = span.closest('.page-wrapper');
                        if (!wrapper) return;

                        const wrapperRect = wrapper.getBoundingClientRect();
                        const left = rect.left - wrapperRect.left;
                        const top = rect.top - wrapperRect.top;

                        const highlight = document.createElement('div');
                        highlight.className = 'text-highlight';
                        highlight.style.left = left + 'px';
                        highlight.style.top = top + 'px';
                        highlight.style.width = rect.width + 'px';
                        highlight.style.height = rect.height + 'px';

                        wrapper.appendChild(highlight);

                        // Remove after animation
                        setTimeout(() => highlight.remove(), 3000);

                        return highlight;
                    }

                    /**
                     * Show sync indicator at a position in the PDF (fallback when text search fails)
                     */
                    function showSyncIndicator(pageNum, pdfX, pdfY, width, height) {
                        const wrapper = pageWrappers.get(pageNum);
                        const canvas = renderedPages.get(pageNum);
                        if (!wrapper || !canvas) return;

                        // Remove any existing indicator
                        const existing = document.querySelector('.sync-indicator');
                        if (existing) existing.remove();

                        const screenPos = pdfToScreen(pdfX, pdfY, pageNum);
                        if (!screenPos) return;

                        const renderScale = parseFloat(canvas.dataset.renderScale);
                        const canvasWidth = canvas.width / renderScale;

                        // Make indicator span most of the page width for visibility
                        // Start from left margin (about 72 PDF points = 1 inch)
                        const leftMargin = 50 * renderScale;
                        const indicatorWidth = canvasWidth - leftMargin * 2;
                        const indicatorHeight = Math.max(height * renderScale, 24);

                        const indicator = document.createElement('div');
                        indicator.className = 'sync-indicator';
                        indicator.style.left = leftMargin + 'px';
                        indicator.style.top = (screenPos.y - indicatorHeight / 2) + 'px';
                        indicator.style.width = indicatorWidth + 'px';
                        indicator.style.height = indicatorHeight + 'px';

                        wrapper.appendChild(indicator);

                        // Remove after animation (matches CSS animation duration)
                        setTimeout(() => indicator.remove(), 3000);
                    }

                    // Zoom controls
                    document.getElementById('zoom-in').onclick = () => {
                        currentScale = Math.min(currentScale + 0.25, 3.0);
                        updateZoom();
                    };

                    document.getElementById('zoom-out').onclick = () => {
                        currentScale = Math.max(currentScale - 0.25, 0.5);
                        updateZoom();
                    };

                    document.getElementById('zoom-fit').onclick = () => {
                        currentScale = 1.0;
                        updateZoom();
                    };

                    function updateZoom() {
                        document.getElementById('zoom-level').textContent = Math.round(currentScale * 100) + '%';
                        renderAllPages();
                    }

                    // Page navigation
                    document.getElementById('prev-page').onclick = () => {
                        const input = document.getElementById('page-num');
                        const page = Math.max(1, parseInt(input.value) - 1);
                        input.value = page;
                        scrollToPage(page);
                    };

                    document.getElementById('next-page').onclick = () => {
                        const input = document.getElementById('page-num');
                        const page = Math.min(pdfDoc.numPages, parseInt(input.value) + 1);
                        input.value = page;
                        scrollToPage(page);
                    };

                    document.getElementById('page-num').onchange = (e) => {
                        const page = Math.max(1, Math.min(pdfDoc.numPages, parseInt(e.target.value)));
                        e.target.value = page;
                        scrollToPage(page);
                    };

                    function scrollToPage(pageNum) {
                        const canvas = document.getElementById('page-' + pageNum);
                        if (canvas) {
                            canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }

                    // Refresh button
                    document.getElementById('refresh').onclick = () => {
                        vscode.postMessage({ type: 'refresh' });
                    };

                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        console.log('Received message from extension:', message);

                        switch (message.type) {
                            case 'scrollToLine':
                                // Legacy: just scroll to top
                                container.scrollTop = 0;
                                break;

                            case 'scrollToPosition':
                                // Forward sync: scroll to position and show indicator
                                console.log('scrollToPosition: SyncTeX result:', message);
                                console.log('Available pages:', Array.from(pageWrappers.keys()));
                                const { page, x, y, width, height, debugInfo, searchWord, showDebugPopup } = message;

                                // Show debug popup for forward sync (TeX → PDF) only if enabled
                                if (showDebugPopup && debugInfo) {
                                    showForwardSyncDebugPopup({
                                        page: page,
                                        pdfX: x,
                                        pdfY: y,
                                        line: debugInfo.line,
                                        column: debugInfo.column,
                                        text: debugInfo.text,
                                        file: debugInfo.file
                                    });
                                }

                                const wrapper = pageWrappers.get(page);
                                if (wrapper) {
                                    console.log('Found wrapper for page', page, 'scrolling to PDF coords:', x, y);
                                    console.log('Search word for precise highlighting:', searchWord);

                                    // First scroll the page into view at top
                                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });

                                    // Update page number display
                                    document.getElementById('page-num').value = page;

                                    // After page scrolls into view, scroll to the specific Y position
                                    setTimeout(() => {
                                        // Try to find the exact text in the text layer
                                        let textFound = false;
                                        let matchedSpan = null;

                                        if (searchWord && searchWord.length >= 2) {
                                            // Search this page first, then adjacent pages if not found
                                            // Use very large tolerance (1000 = entire page height)
                                            const pagesToSearch = [page];
                                            // Add adjacent pages (previous and next)
                                            if (page > 1) pagesToSearch.push(page - 1);
                                            if (page < pdfDoc.numPages) pagesToSearch.push(page + 1);

                                            for (const searchPage of pagesToSearch) {
                                                const matches = findTextNearPosition(searchPage, y, searchWord, 1000);

                                                if (matches.length > 0) {
                                                    // Found it! Use the closest match
                                                    const match = matches[0];
                                                    matchedSpan = match.span;
                                                    const foundWrapper = pageWrappers.get(searchPage);

                                                    if (searchPage !== page) {
                                                        console.log('Word found on adjacent page', searchPage, 'instead of', page);
                                                    }
                                                    console.log('Found text match:', match.text, 'at distance:', match.distance, 'PDF points from SyncTeX y');

                                                    if (foundWrapper) {
                                                        // Scroll to the correct page first if different
                                                        if (searchPage !== page) {
                                                            foundWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                            document.getElementById('page-num').value = searchPage;
                                                        }

                                                        // Then scroll to position the matched text nicely
                                                        setTimeout(() => {
                                                            const spanRect = match.span.getBoundingClientRect();
                                                            const container = document.getElementById('pdf-container');
                                                            const containerRect = container.getBoundingClientRect();
                                                            const wrapperRect = foundWrapper.getBoundingClientRect();
                                                            const currentScroll = container.scrollTop;
                                                            const wrapperTop = wrapperRect.top - containerRect.top + currentScroll;
                                                            const spanTop = spanRect.top - wrapperRect.top;

                                                            container.scrollTo({
                                                                top: wrapperTop + spanTop - 100, // 100px from top for better visibility
                                                                behavior: 'smooth'
                                                            });

                                                            // Highlight the specific text span
                                                            highlightTextSpan(match.span, searchWord);
                                                        }, searchPage !== page ? 200 : 0);
                                                    }

                                                    textFound = true;
                                                    break;
                                                }
                                            }

                                            if (!textFound) {
                                                console.log('Word "' + searchWord + '" not found on page', page, 'or adjacent pages');
                                            }
                                        }

                                        // Fall back to full-width indicator if text search failed
                                        if (!textFound) {
                                            console.log('Text not found on page, using SyncTeX position indicator');
                                            const screenPos = pdfToScreen(x, y, page);
                                            console.log('Screen position for highlight:', screenPos);

                                            if (screenPos) {
                                                const container = document.getElementById('pdf-container');
                                                const wrapperRect = wrapper.getBoundingClientRect();
                                                const containerRect = container.getBoundingClientRect();

                                                // Calculate offset to put the target line near the top (with some margin)
                                                const targetOffset = screenPos.y - 50; // 50px from top
                                                const currentScroll = container.scrollTop;
                                                const wrapperTop = wrapperRect.top - containerRect.top + currentScroll;

                                                console.log('Scroll calculation: wrapperTop=', wrapperTop, 'targetOffset=', targetOffset);

                                                container.scrollTo({
                                                    top: wrapperTop + targetOffset,
                                                    behavior: 'smooth'
                                                });
                                            }

                                            // Show full-width highlight indicator as fallback
                                            console.log('Showing sync indicator at PDF coords:', x, y, 'with size:', width, height);
                                            showSyncIndicator(page, x, y, width || 400, height || 12);
                                        }
                                    }, 300);
                                } else {
                                    console.log('ERROR: Wrapper not found for page', page, '- available pages:', Array.from(pageWrappers.keys()));
                                }
                                break;

                            case 'syncTexResult':
                                // Update the debug popup with SyncTeX result
                                const synctexInfo = document.getElementById('synctex-info');
                                if (synctexInfo) {
                                    synctexInfo.innerHTML = \`<span style="color: #aaa;">\${message.file}</span> line <span style="font-weight: bold;">\${message.line}</span>\`;
                                }
                                break;
                        }
                    });

                    // Update page number on scroll
                    container.addEventListener('scroll', () => {
                        const containerRect = container.getBoundingClientRect();
                        const containerCenter = containerRect.top + containerRect.height / 2;

                        for (const [pageNum, canvas] of renderedPages) {
                            const rect = canvas.getBoundingClientRect();
                            if (rect.top <= containerCenter && rect.bottom >= containerCenter) {
                                document.getElementById('page-num').value = pageNum;
                                break;
                            }
                        }
                    });

                    // ==================== SEARCH FUNCTIONALITY ====================
                    let searchResults = [];
                    let currentSearchIndex = -1;

                    const searchBox = document.getElementById('search-box');
                    const searchInput = document.getElementById('search-input');
                    const searchInfo = document.getElementById('search-info');

                    document.getElementById('search-btn').onclick = () => {
                        searchBox.classList.toggle('visible');
                        if (searchBox.classList.contains('visible')) {
                            searchInput.focus();
                        }
                    };

                    document.getElementById('search-close').onclick = () => {
                        searchBox.classList.remove('visible');
                        clearHighlights();
                    };

                    // Ctrl+F to open search
                    document.addEventListener('keydown', (e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                            e.preventDefault();
                            searchBox.classList.add('visible');
                            searchInput.focus();
                            searchInput.select();
                        }
                        if (e.key === 'Escape' && searchBox.classList.contains('visible')) {
                            searchBox.classList.remove('visible');
                            clearHighlights();
                        }
                    });

                    searchInput.addEventListener('input', debounce(() => {
                        performSearch(searchInput.value);
                    }, 300));

                    searchInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            if (e.shiftKey) {
                                navigateSearch(-1);
                            } else {
                                navigateSearch(1);
                            }
                        }
                    });

                    document.getElementById('search-prev').onclick = () => navigateSearch(-1);
                    document.getElementById('search-next').onclick = () => navigateSearch(1);

                    function debounce(fn, ms) {
                        let timeout;
                        return (...args) => {
                            clearTimeout(timeout);
                            timeout = setTimeout(() => fn(...args), ms);
                        };
                    }

                    function performSearch(query) {
                        clearHighlights();
                        searchResults = [];
                        currentSearchIndex = -1;

                        if (!query || query.length < 2) {
                            searchInfo.textContent = '';
                            return;
                        }

                        const lowerQuery = query.toLowerCase();

                        // Search through all text layer spans
                        const allSpans = document.querySelectorAll('.text-layer span');
                        allSpans.forEach((span, idx) => {
                            const text = span.textContent.toLowerCase();
                            if (text.includes(lowerQuery)) {
                                span.classList.add('highlight');
                                searchResults.push(span);
                            }
                        });

                        if (searchResults.length > 0) {
                            currentSearchIndex = 0;
                            searchInfo.textContent = '1 of ' + searchResults.length;
                            scrollToResult(0);
                        } else {
                            searchInfo.textContent = 'No results';
                        }
                    }

                    function navigateSearch(direction) {
                        if (searchResults.length === 0) return;

                        currentSearchIndex += direction;
                        if (currentSearchIndex >= searchResults.length) currentSearchIndex = 0;
                        if (currentSearchIndex < 0) currentSearchIndex = searchResults.length - 1;

                        searchInfo.textContent = (currentSearchIndex + 1) + ' of ' + searchResults.length;
                        scrollToResult(currentSearchIndex);
                    }

                    function scrollToResult(index) {
                        const span = searchResults[index];
                        if (span) {
                            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Flash effect
                            span.style.backgroundColor = 'rgba(255, 100, 0, 0.7)';
                            setTimeout(() => {
                                span.style.backgroundColor = '';
                            }, 500);
                        }
                    }

                    function clearHighlights() {
                        document.querySelectorAll('.text-layer .highlight').forEach(el => {
                            el.classList.remove('highlight');
                        });
                    }

                    // ==================== CONTEXT MENU ====================
                    let contextMenu = null;

                    function showContextMenu(x, y, pageNum, selectedText) {
                        hideContextMenu();

                        contextMenu = document.createElement('div');
                        contextMenu.className = 'context-menu';

                        // Jump to Source option
                        const jumpItem = document.createElement('div');
                        jumpItem.className = 'context-menu-item';
                        jumpItem.textContent = '📍 Jump to LaTeX Source';
                        jumpItem.onclick = () => {
                            hideContextMenu();
                            jumpToSourceFromSelection(pageNum, x, y, selectedText);
                        };
                        contextMenu.appendChild(jumpItem);

                        // Copy option (if text selected)
                        if (selectedText) {
                            const copyItem = document.createElement('div');
                            copyItem.className = 'context-menu-item';
                            copyItem.textContent = '📋 Copy "' + selectedText.substring(0, 20) + (selectedText.length > 20 ? '...' : '') + '"';
                            copyItem.onclick = () => {
                                hideContextMenu();
                                navigator.clipboard.writeText(selectedText);
                            };
                            contextMenu.appendChild(copyItem);
                        }

                        // Search option
                        if (selectedText) {
                            const searchItem = document.createElement('div');
                            searchItem.className = 'context-menu-item';
                            searchItem.textContent = '🔍 Search for "' + selectedText.substring(0, 15) + (selectedText.length > 15 ? '...' : '') + '"';
                            searchItem.onclick = () => {
                                hideContextMenu();
                                searchBox.classList.add('visible');
                                searchInput.value = selectedText;
                                performSearch(selectedText);
                            };
                            contextMenu.appendChild(searchItem);
                        }

                        document.body.appendChild(contextMenu);

                        // Position menu (keep on screen)
                        const menuRect = contextMenu.getBoundingClientRect();
                        const finalX = Math.min(x, window.innerWidth - menuRect.width - 10);
                        const finalY = Math.min(y, window.innerHeight - menuRect.height - 10);
                        contextMenu.style.left = finalX + 'px';
                        contextMenu.style.top = finalY + 'px';
                    }

                    function hideContextMenu() {
                        if (contextMenu) {
                            contextMenu.remove();
                            contextMenu = null;
                        }
                    }

                    function jumpToSourceFromSelection(pageNum, clickX, clickY, selectedText) {
                        const canvas = renderedPages.get(pageNum);
                        if (!canvas) return;

                        const pdfCoords = screenToPdf(canvas, clickX, clickY, pageNum);
                        if (!pdfCoords) return;

                        // Get text info at click position for better matching
                        const textInfo = findTextAtPosition(pageNum, pdfCoords.x, pdfCoords.y);
                        const clickedWord = textInfo ? textInfo.word : selectedText;
                        const phrase = textInfo ? textInfo.context : selectedText;

                        console.log('Jump to source from right-click:', clickedWord, 'phrase:', phrase, 'at page', pageNum);

                        // Show debug popup with click info
                        showDebugPopup({
                            page: pageNum,
                            pdfX: pdfCoords.x,
                            pdfY: pdfCoords.y,
                            phrase: phrase,
                            clickedWord: clickedWord
                        });

                        // Send inverse sync request
                        vscode.postMessage({
                            type: 'inverseSync',
                            page: pageNum,
                            x: pdfCoords.x,
                            y: pdfCoords.y,
                            clickedText: clickedWord,
                            contextText: phrase
                        });
                    }

                    // Right-click handler
                    document.addEventListener('contextmenu', (e) => {
                        // Only handle in PDF container or text layer
                        const container = document.getElementById('pdf-container');
                        if (!container || !container.contains(e.target)) return;

                        e.preventDefault();
                        e.stopPropagation();

                        // Find which page was clicked
                        let pageNum = 1;
                        let clickedCanvas = null;
                        for (const [num, canvas] of renderedPages) {
                            const wrapper = pageWrappers.get(num);
                            if (wrapper) {
                                const rect = wrapper.getBoundingClientRect();
                                if (e.clientY >= rect.top && e.clientY <= rect.bottom &&
                                    e.clientX >= rect.left && e.clientX <= rect.right) {
                                    pageNum = num;
                                    clickedCanvas = canvas;
                                    break;
                                }
                            }
                        }

                        // Get selected text from browser selection
                        const selection = window.getSelection();
                        let selectedText = selection ? selection.toString().trim() : '';

                        // If no selection, try to find text at click position
                        if (!selectedText && clickedCanvas) {
                            const pdfCoords = screenToPdf(clickedCanvas, e.clientX, e.clientY, pageNum);
                            if (pdfCoords) {
                                const textInfo = findTextAtPosition(pageNum, pdfCoords.x, pdfCoords.y);
                                if (textInfo) {
                                    selectedText = textInfo.allText || textInfo.word;
                                    console.log('Auto-detected text at click:', selectedText);
                                }
                            }
                        }

                        console.log('Context menu: page', pageNum, 'text:', selectedText);
                        showContextMenu(e.clientX, e.clientY, pageNum, selectedText);
                    });

                    // Hide context menu on click elsewhere
                    document.addEventListener('click', (e) => {
                        if (contextMenu && !contextMenu.contains(e.target)) {
                            hideContextMenu();
                        }
                    });

                    document.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            hideContextMenu();
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    public dispose(): void {
        PdfViewerPanel.currentPanel = undefined;

        // Clean up resources
        this.panel.dispose();

        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

/**
 * Open PDF in the built-in viewer panel
 */
export async function openPdfInPanel(context: vscode.ExtensionContext): Promise<void> {
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
            // Wait for compilation
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!fs.existsSync(pdfPath)) {
                return;
            }
        } else {
            return;
        }
    }

    PdfViewerPanel.createOrShow(context.extensionUri, pdfPath, filePath);
}

/**
 * Forward sync - scroll to current line in PDF viewer
 */
export function syncForwardToPanel(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !PdfViewerPanel.currentPanel) {
        return;
    }

    const line = editor.selection.active.line + 1;
    PdfViewerPanel.currentPanel.scrollToLine(line);
}
