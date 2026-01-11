import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Scimax Spell Checker - jinx-style spell checking
 *
 * Features:
 * - Just-in-time checking of visible text
 * - Smart exclusions for scientific writing (citations, DOIs, code blocks, LaTeX)
 * - Quick correction via QuickPick
 * - Personal dictionary support
 * - Language-aware checking
 */

// Common English words (basic dictionary for fallback)
// In production, this would be loaded from a larger word list file
const COMMON_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    // Add more as needed
]);

// Patterns to exclude from spell checking
const EXCLUSION_PATTERNS = [
    // Citations
    /(?:cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):[a-zA-Z0-9_:,-]+/g,
    /\[@[a-zA-Z0-9_:-]+\]/g,
    /(?:^|[^\w@])@[a-zA-Z][a-zA-Z0-9_:-]*/g,
    /\\cite[pt]?\{[^}]+\}/g,
    /\[cite(?:\/[^\]]*)?:[^\]]+\]/g,

    // DOIs
    /doi:10\.\d{4,9}\/[^\s<>\[\](){}]+/gi,
    /https?:\/\/(?:dx\.)?doi\.org\/[^\s<>\[\](){}]+/gi,
    /10\.\d{4,9}\/[^\s<>\[\](){}]+/g,

    // URLs
    /https?:\/\/[^\s<>\[\](){}]+/gi,
    /www\.[^\s<>\[\](){}]+/gi,

    // Email addresses
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

    // Org-mode syntax
    /^#\+[A-Z_]+:.*/gm,
    /:PROPERTIES:/g,
    /:END:/g,
    /:[A-Z_]+:/g,
    /\[\[[^\]]+\]\]/g,  // Org links
    /<<[^>]+>>/g,       // Org targets

    // LaTeX
    /\$[^$]+\$/g,       // Inline math
    /\$\$[^$]+\$\$/g,   // Display math
    /\\[a-zA-Z]+\{[^}]*\}/g,  // LaTeX commands
    /\\[a-zA-Z]+/g,     // Simple LaTeX commands

    // Code-related
    /`[^`]+`/g,         // Inline code
    /```[\s\S]*?```/g,  // Code blocks
    /#+begin_src[\s\S]*?#+end_src/gi,
    /#+begin_example[\s\S]*?#+end_example/gi,

    // File paths
    /(?:\/|\.\/|~\/)[^\s<>\[\](){}]+/g,
    /[A-Za-z]:\\[^\s<>\[\](){}]+/g,

    // Programming identifiers (camelCase, snake_case, SCREAMING_CASE)
    /\b[a-z]+(?:[A-Z][a-z]+)+\b/g,  // camelCase
    /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g,  // PascalCase
    /\b[a-z]+(?:_[a-z]+)+\b/g,  // snake_case
    /\b[A-Z]+(?:_[A-Z]+)+\b/g,  // SCREAMING_SNAKE_CASE

    // Numbers and units
    /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\s*(?:km|m|cm|mm|nm|kg|g|mg|s|ms|Hz|kHz|MHz|GHz|V|mV|A|mA|K|°C|°F|mol|L|mL|%)\b/gi,

    // Abbreviations (all caps)
    /\b[A-Z]{2,}\b/g,

    // Hashtags and mentions
    /#[a-zA-Z][a-zA-Z0-9_]*/g,
    /@[a-zA-Z][a-zA-Z0-9_]*/g,
];

interface SpellingError {
    word: string;
    range: vscode.Range;
    suggestions: string[];
}

export class SpellChecker {
    private personalDictionary: Set<string> = new Set();
    private personalDictionaryPath: string;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private enabled: boolean = true;
    private checkDelay: number = 500;
    private checkTimer: NodeJS.Timeout | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.personalDictionaryPath = path.join(context.globalStorageUri.fsPath, 'personal-dictionary.txt');
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('scimax-spelling');
        context.subscriptions.push(this.diagnosticCollection);

        this.loadPersonalDictionary();
    }

    /**
     * Load personal dictionary from file
     */
    private async loadPersonalDictionary(): Promise<void> {
        try {
            // Ensure directory exists
            const dir = path.dirname(this.personalDictionaryPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(this.personalDictionaryPath)) {
                const content = fs.readFileSync(this.personalDictionaryPath, 'utf8');
                const words = content.split('\n').filter(w => w.trim());
                this.personalDictionary = new Set(words.map(w => w.toLowerCase()));
                console.log(`Scimax: Loaded ${this.personalDictionary.size} words from personal dictionary`);
            }
        } catch (error) {
            console.error('Scimax: Failed to load personal dictionary:', error);
        }
    }

    /**
     * Save personal dictionary to file
     */
    private async savePersonalDictionary(): Promise<void> {
        try {
            const dir = path.dirname(this.personalDictionaryPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const content = Array.from(this.personalDictionary).sort().join('\n');
            fs.writeFileSync(this.personalDictionaryPath, content);
        } catch (error) {
            console.error('Scimax: Failed to save personal dictionary:', error);
        }
    }

    /**
     * Add word to personal dictionary
     */
    async addToPersonalDictionary(word: string): Promise<void> {
        this.personalDictionary.add(word.toLowerCase());
        await this.savePersonalDictionary();
        vscode.window.showInformationMessage(`Added "${word}" to personal dictionary`);

        // Recheck current document
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            this.checkDocument(editor.document);
        }
    }

    /**
     * Remove word from personal dictionary
     */
    async removeFromPersonalDictionary(word: string): Promise<void> {
        this.personalDictionary.delete(word.toLowerCase());
        await this.savePersonalDictionary();
        vscode.window.showInformationMessage(`Removed "${word}" from personal dictionary`);
    }

    /**
     * Check if a word should be excluded from spell checking
     */
    private shouldExclude(text: string, wordStart: number, wordEnd: number): boolean {
        // Check each exclusion pattern
        for (const pattern of EXCLUSION_PATTERNS) {
            // Reset regex state
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;

                // Check if word overlaps with excluded region
                if (wordStart < matchEnd && wordEnd > matchStart) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if a word is spelled correctly
     */
    private isCorrectlySpelled(word: string): boolean {
        const lowerWord = word.toLowerCase();

        // Check personal dictionary first
        if (this.personalDictionary.has(lowerWord)) {
            return true;
        }

        // Check common words
        if (COMMON_WORDS.has(lowerWord)) {
            return true;
        }

        // Skip very short words
        if (word.length <= 2) {
            return true;
        }

        // Skip words with numbers
        if (/\d/.test(word)) {
            return true;
        }

        // Skip words that look like acronyms or abbreviations
        if (/^[A-Z]+$/.test(word) || /^[A-Z][a-z]?$/.test(word)) {
            return true;
        }

        // For now, use a simple heuristic: words with common patterns are likely correct
        // This is a placeholder - a real implementation would use a proper dictionary
        // or integrate with VS Code's spell check extension

        // Common English word patterns
        const commonPatterns = [
            /^[a-z]+(?:ing|ed|ly|er|est|tion|sion|ment|ness|ful|less|able|ible|ous|ive|al|ic|ical)$/i,
            /^(?:un|re|pre|dis|mis|over|under|out|up|down|non|anti|auto|bi|co|de|ex|inter|multi|post|semi|sub|super|trans|tri)[a-z]+$/i,
        ];

        for (const pattern of commonPatterns) {
            if (pattern.test(word)) {
                // Check if base word looks reasonable
                return true;
            }
        }

        // Default: assume misspelled for demonstration
        // In production, this would check against a real dictionary
        return false;
    }

    /**
     * Generate spelling suggestions for a word
     */
    private getSuggestions(word: string): string[] {
        // Simple suggestion generation using edit distance
        // In production, use a proper spell checking library

        const suggestions: string[] = [];

        // Common letter substitutions
        const substitutions: Record<string, string[]> = {
            'a': ['e', 'o'],
            'e': ['a', 'i'],
            'i': ['e', 'y'],
            'o': ['a', 'u'],
            'u': ['o', 'a'],
            'c': ['k', 's'],
            's': ['c', 'z'],
        };

        // Generate candidates by substitution
        for (let i = 0; i < word.length; i++) {
            const char = word[i].toLowerCase();
            if (substitutions[char]) {
                for (const sub of substitutions[char]) {
                    const candidate = word.slice(0, i) + sub + word.slice(i + 1);
                    if (this.isCorrectlySpelled(candidate)) {
                        suggestions.push(candidate);
                    }
                }
            }
        }

        // Try removing doubled letters
        for (let i = 0; i < word.length - 1; i++) {
            if (word[i] === word[i + 1]) {
                const candidate = word.slice(0, i) + word.slice(i + 1);
                if (this.isCorrectlySpelled(candidate)) {
                    suggestions.push(candidate);
                }
            }
        }

        // Try adding common letters
        const commonLetters = ['e', 's', 'd', 'r', 'n'];
        for (const letter of commonLetters) {
            const candidateEnd = word + letter;
            if (this.isCorrectlySpelled(candidateEnd)) {
                suggestions.push(candidateEnd);
            }
        }

        return [...new Set(suggestions)].slice(0, 5);
    }

    /**
     * Check document for spelling errors
     */
    checkDocument(document: vscode.TextDocument): void {
        if (!this.enabled) {
            this.diagnosticCollection.delete(document.uri);
            return;
        }

        // Only check org, markdown, and text files
        const supportedLanguages = ['org', 'markdown', 'plaintext', 'latex'];
        if (!supportedLanguages.includes(document.languageId)) {
            return;
        }

        const text = document.getText();
        const diagnostics: vscode.Diagnostic[] = [];

        // Find all words
        const wordPattern = /\b[a-zA-Z']+\b/g;
        let match;

        while ((match = wordPattern.exec(text)) !== null) {
            const word = match[0];
            const wordStart = match.index;
            const wordEnd = wordStart + word.length;

            // Skip if word is in an excluded region
            if (this.shouldExclude(text, wordStart, wordEnd)) {
                continue;
            }

            // Check spelling
            if (!this.isCorrectlySpelled(word)) {
                const startPos = document.positionAt(wordStart);
                const endPos = document.positionAt(wordEnd);
                const range = new vscode.Range(startPos, endPos);

                const suggestions = this.getSuggestions(word);
                const message = suggestions.length > 0
                    ? `"${word}" may be misspelled. Suggestions: ${suggestions.join(', ')}`
                    : `"${word}" may be misspelled`;

                const diagnostic = new vscode.Diagnostic(
                    range,
                    message,
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.source = 'scimax-spelling';
                diagnostic.code = 'spelling';

                // Store suggestions in diagnostic for quick fix
                (diagnostic as any).suggestions = suggestions;
                (diagnostic as any).word = word;

                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Schedule document check with debounce
     */
    scheduleCheck(document: vscode.TextDocument): void {
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
        }

        this.checkTimer = setTimeout(() => {
            this.checkDocument(document);
        }, this.checkDelay);
    }

    /**
     * Toggle spell checking
     */
    toggle(): void {
        this.enabled = !this.enabled;
        vscode.window.showInformationMessage(
            `Scimax spell checking ${this.enabled ? 'enabled' : 'disabled'}`
        );

        if (!this.enabled) {
            this.diagnosticCollection.clear();
        } else {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                this.checkDocument(editor.document);
            }
        }
    }

    /**
     * Get spelling errors at position
     */
    getErrorAtPosition(document: vscode.TextDocument, position: vscode.Position): SpellingError | null {
        const diagnostics = this.diagnosticCollection.get(document.uri);
        if (!diagnostics) return null;

        for (const diagnostic of diagnostics) {
            if (diagnostic.range.contains(position)) {
                return {
                    word: (diagnostic as any).word,
                    range: diagnostic.range,
                    suggestions: (diagnostic as any).suggestions || []
                };
            }
        }

        return null;
    }

    /**
     * Find next spelling error from position
     */
    findNextError(document: vscode.TextDocument, position: vscode.Position): SpellingError | null {
        const diagnostics = this.diagnosticCollection.get(document.uri);
        if (!diagnostics || diagnostics.length === 0) return null;

        // Sort by position
        const sorted = [...diagnostics].sort((a, b) => {
            const lineComp = a.range.start.line - b.range.start.line;
            return lineComp !== 0 ? lineComp : a.range.start.character - b.range.start.character;
        });

        // Find next error after position
        for (const diagnostic of sorted) {
            if (diagnostic.range.start.isAfter(position)) {
                return {
                    word: (diagnostic as any).word,
                    range: diagnostic.range,
                    suggestions: (diagnostic as any).suggestions || []
                };
            }
        }

        // Wrap around to first error
        const first = sorted[0];
        return {
            word: (first as any).word,
            range: first.range,
            suggestions: (first as any).suggestions || []
        };
    }

    /**
     * Find previous spelling error from position
     */
    findPrevError(document: vscode.TextDocument, position: vscode.Position): SpellingError | null {
        const diagnostics = this.diagnosticCollection.get(document.uri);
        if (!diagnostics || diagnostics.length === 0) return null;

        // Sort by position (reverse)
        const sorted = [...diagnostics].sort((a, b) => {
            const lineComp = b.range.start.line - a.range.start.line;
            return lineComp !== 0 ? lineComp : b.range.start.character - a.range.start.character;
        });

        // Find previous error before position
        for (const diagnostic of sorted) {
            if (diagnostic.range.start.isBefore(position)) {
                return {
                    word: (diagnostic as any).word,
                    range: diagnostic.range,
                    suggestions: (diagnostic as any).suggestions || []
                };
            }
        }

        // Wrap around to last error
        const last = sorted[0];
        return {
            word: (last as any).word,
            range: last.range,
            suggestions: (last as any).suggestions || []
        };
    }

    dispose(): void {
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
        }
        this.diagnosticCollection.dispose();
    }
}

/**
 * Correct word at cursor - jinx-style
 */
async function correctWordAtCursor(spellChecker: SpellChecker): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Get error at cursor
    let error = spellChecker.getErrorAtPosition(document, position);

    // If no error at cursor, find next error
    if (!error) {
        error = spellChecker.findNextError(document, position);
        if (!error) {
            vscode.window.showInformationMessage('No spelling errors found');
            return;
        }
        // Move cursor to error
        editor.selection = new vscode.Selection(error.range.start, error.range.start);
        editor.revealRange(error.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    // Build quick pick items
    const items: (vscode.QuickPickItem & { action: string; value?: string })[] = [];

    // Add suggestions
    for (const suggestion of error.suggestions) {
        items.push({
            label: suggestion,
            description: 'Replace with this word',
            action: 'replace',
            value: suggestion
        });
    }

    // Add other actions
    items.push({
        label: '$(add) Add to dictionary',
        description: `Add "${error.word}" to personal dictionary`,
        action: 'add'
    });

    items.push({
        label: '$(edit) Edit manually',
        description: 'Enter a custom correction',
        action: 'edit'
    });

    items.push({
        label: '$(arrow-right) Skip',
        description: 'Skip this word',
        action: 'skip'
    });

    items.push({
        label: '$(close) Ignore all',
        description: `Ignore "${error.word}" in this session`,
        action: 'ignore'
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Correct: "${error.word}"`,
        matchOnDescription: true
    });

    if (!selected) return;

    switch (selected.action) {
        case 'replace':
            await editor.edit(editBuilder => {
                editBuilder.replace(error!.range, selected.value!);
            });
            break;

        case 'add':
            await spellChecker.addToPersonalDictionary(error.word);
            break;

        case 'edit':
            const customWord = await vscode.window.showInputBox({
                prompt: `Replace "${error.word}" with:`,
                value: error.word
            });
            if (customWord) {
                await editor.edit(editBuilder => {
                    editBuilder.replace(error!.range, customWord);
                });
            }
            break;

        case 'skip':
            // Find and go to next error
            const nextError = spellChecker.findNextError(document, error.range.end);
            if (nextError) {
                editor.selection = new vscode.Selection(nextError.range.start, nextError.range.start);
                editor.revealRange(nextError.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
            break;

        case 'ignore':
            // Add to personal dictionary for this session
            await spellChecker.addToPersonalDictionary(error.word);
            break;
    }
}

/**
 * Go to next spelling error
 */
async function gotoNextError(spellChecker: SpellChecker): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const error = spellChecker.findNextError(editor.document, editor.selection.active);
    if (error) {
        editor.selection = new vscode.Selection(error.range.start, error.range.end);
        editor.revealRange(error.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } else {
        vscode.window.showInformationMessage('No spelling errors found');
    }
}

/**
 * Go to previous spelling error
 */
async function gotoPrevError(spellChecker: SpellChecker): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const error = spellChecker.findPrevError(editor.document, editor.selection.active);
    if (error) {
        editor.selection = new vscode.Selection(error.range.start, error.range.end);
        editor.revealRange(error.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } else {
        vscode.window.showInformationMessage('No spelling errors found');
    }
}

/**
 * Add word at cursor to dictionary
 */
async function addWordAtCursor(spellChecker: SpellChecker): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Get word at cursor
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
        vscode.window.showInformationMessage('No word at cursor');
        return;
    }

    const word = document.getText(wordRange);
    await spellChecker.addToPersonalDictionary(word);
}

/**
 * Register spell checking commands
 */
export function registerSpellCheckCommands(
    context: vscode.ExtensionContext,
    spellChecker: SpellChecker
): void {
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.spelling.correct', () =>
            correctWordAtCursor(spellChecker)
        ),
        vscode.commands.registerCommand('scimax.spelling.nextError', () =>
            gotoNextError(spellChecker)
        ),
        vscode.commands.registerCommand('scimax.spelling.prevError', () =>
            gotoPrevError(spellChecker)
        ),
        vscode.commands.registerCommand('scimax.spelling.addToDictionary', () =>
            addWordAtCursor(spellChecker)
        ),
        vscode.commands.registerCommand('scimax.spelling.toggle', () =>
            spellChecker.toggle()
        ),
        vscode.commands.registerCommand('scimax.spelling.checkDocument', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                spellChecker.checkDocument(editor.document);
                vscode.window.showInformationMessage('Spell check complete');
            }
        })
    );

    // Check on document open and change
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            spellChecker.scheduleCheck(doc);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            spellChecker.scheduleCheck(e.document);
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                spellChecker.scheduleCheck(editor.document);
            }
        })
    );

    // Check current document on activation
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        spellChecker.scheduleCheck(editor.document);
    }

    console.log('Scimax: Spell checking commands registered');
}

/**
 * Code action provider for quick fixes
 */
export class SpellingCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private spellChecker: SpellChecker) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'scimax-spelling') continue;

            const word = (diagnostic as any).word;
            const suggestions = (diagnostic as any).suggestions || [];

            // Add suggestion fixes
            for (const suggestion of suggestions) {
                const fix = new vscode.CodeAction(
                    `Replace with "${suggestion}"`,
                    vscode.CodeActionKind.QuickFix
                );
                fix.edit = new vscode.WorkspaceEdit();
                fix.edit.replace(document.uri, diagnostic.range, suggestion);
                fix.isPreferred = suggestions.indexOf(suggestion) === 0;
                fix.diagnostics = [diagnostic];
                actions.push(fix);
            }

            // Add to dictionary action
            const addAction = new vscode.CodeAction(
                `Add "${word}" to dictionary`,
                vscode.CodeActionKind.QuickFix
            );
            addAction.command = {
                command: 'scimax.spelling.addToDictionary',
                title: 'Add to dictionary'
            };
            addAction.diagnostics = [diagnostic];
            actions.push(addAction);
        }

        return actions;
    }
}
