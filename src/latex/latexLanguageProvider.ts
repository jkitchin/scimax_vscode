/**
 * LaTeX Language Providers
 * Provides definition, references, completion, and diagnostics for LaTeX files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import {
    getSections,
    getLabels,
    getEnvironments,
    LaTeXSection,
    LaTeXLabel,
    LaTeXEnvironment,
} from './latexDocumentSymbolProvider';
import {
    BibEntry,
    parseBibTeX,
    formatCitation,
    formatAuthors,
    searchEntries,
} from '../references/bibtexParser';

// =============================================================================
// Multi-file Project Support
// =============================================================================

interface LaTeXProject {
    masterFile: string;
    includedFiles: string[];
    labels: Map<string, { file: string; line: number; context: string }>;
    bibFiles: string[];
    bibEntries: Map<string, BibEntry & { sourceFile: string }>;
}

const projectCache = new Map<string, LaTeXProject>();

/**
 * Find the master document for a LaTeX project
 */
export function findMasterDocument(document: vscode.TextDocument): string {
    const filePath = document.uri.fsPath;
    const dir = path.dirname(filePath);

    // Check if this file has \documentclass (it's the master)
    const text = document.getText();
    if (/\\documentclass/.test(text)) {
        return filePath;
    }

    // Look for files that include this one
    const fileName = path.basename(filePath, '.tex');
    const texFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tex'));

    for (const texFile of texFiles) {
        const fullPath = path.join(dir, texFile);
        if (fullPath === filePath) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            // Check for \input{thisfile} or \include{thisfile}
            const includePattern = new RegExp(`\\\\(input|include)\\{[^}]*${fileName}(\\.tex)?\\}`, 'g');
            if (includePattern.test(content) && /\\documentclass/.test(content)) {
                return fullPath;
            }
        } catch {
            // Ignore read errors
        }
    }

    // No master found, treat this as master
    return filePath;
}

/**
 * Parse a LaTeX project and cache the results
 */
export async function parseProject(masterFile: string): Promise<LaTeXProject> {
    const cached = projectCache.get(masterFile);
    if (cached) {
        return cached;
    }

    const project: LaTeXProject = {
        masterFile,
        includedFiles: [masterFile],
        labels: new Map(),
        bibFiles: [],
        bibEntries: new Map(),
    };

    const dir = path.dirname(masterFile);
    const visited = new Set<string>();

    // Recursively find all included files
    async function processFile(filePath: string): Promise<void> {
        if (visited.has(filePath)) return;
        visited.add(filePath);

        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return;
        }

        // Find \input and \include
        const includePattern = /\\(input|include)\{([^}]+)\}/g;
        let match;
        while ((match = includePattern.exec(content)) !== null) {
            let includedPath = match[2];
            if (!includedPath.endsWith('.tex')) {
                includedPath += '.tex';
            }
            const fullPath = path.resolve(path.dirname(filePath), includedPath);
            if (!project.includedFiles.includes(fullPath)) {
                project.includedFiles.push(fullPath);
                await processFile(fullPath);
            }
        }

        // Find \bibliography
        const bibPattern = /\\bibliography\{([^}]+)\}/g;
        while ((match = bibPattern.exec(content)) !== null) {
            const bibFiles = match[1].split(',').map(f => f.trim());
            for (let bibFile of bibFiles) {
                if (!bibFile.endsWith('.bib')) {
                    bibFile += '.bib';
                }
                const fullPath = path.resolve(path.dirname(filePath), bibFile);
                if (!project.bibFiles.includes(fullPath)) {
                    project.bibFiles.push(fullPath);
                }
            }
        }

        // Find \addbibresource (biblatex)
        const addbibPattern = /\\addbibresource\{([^}]+)\}/g;
        while ((match = addbibPattern.exec(content)) !== null) {
            let bibFile = match[1];
            const fullPath = path.resolve(path.dirname(filePath), bibFile);
            if (!project.bibFiles.includes(fullPath)) {
                project.bibFiles.push(fullPath);
            }
        }

        // Extract labels
        const labelPattern = /\\label\{([^}]+)\}/g;
        const lines = content.split('\n');
        let lineNum = 0;
        for (const line of lines) {
            const labelMatch = line.match(/\\label\{([^}]+)\}/);
            if (labelMatch) {
                const labelName = labelMatch[1];
                // Get context (surrounding text)
                const context = line.trim().substring(0, 80);
                project.labels.set(labelName, {
                    file: filePath,
                    line: lineNum,
                    context,
                });
            }
            lineNum++;
        }
    }

    await processFile(masterFile);

    // Load bibliography files
    for (const bibFile of project.bibFiles) {
        try {
            const content = fs.readFileSync(bibFile, 'utf-8');
            const result = parseBibTeX(content);
            for (const entry of result.entries) {
                project.bibEntries.set(entry.key, { ...entry, sourceFile: bibFile });
            }
        } catch {
            // Ignore read errors
        }
    }

    // Also look for .bib files in the same directory
    try {
        const bibFilesInDir = fs.readdirSync(dir).filter(f => f.endsWith('.bib'));
        for (const bibFile of bibFilesInDir) {
            const fullPath = path.join(dir, bibFile);
            if (!project.bibFiles.includes(fullPath)) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const result = parseBibTeX(content);
                    for (const entry of result.entries) {
                        if (!project.bibEntries.has(entry.key)) {
                            project.bibEntries.set(entry.key, { ...entry, sourceFile: fullPath });
                        }
                    }
                } catch {
                    // Ignore
                }
            }
        }
    } catch {
        // Ignore
    }

    projectCache.set(masterFile, project);
    return project;
}

/**
 * Clear the project cache
 */
export function clearProjectCache(): void {
    projectCache.clear();
}

// =============================================================================
// Definition Provider
// =============================================================================

export class LaTeXDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | null> {
        const line = document.lineAt(position.line).text;

        // Check for \ref{label} - jump to \label{label}
        // Do this BEFORE wordRange check so it works when cursor is on \, {, or }
        const refMatch = this.matchAtPosition(line, position.character, /\\(ref|eqref|pageref|autoref|cref|Cref)\{([^}]+)\}/g);
        if (refMatch) {
            const labelName = refMatch[2];
            return this.findLabelDefinition(document, labelName);
        }

        // Check for \cite{key} - jump to bib entry
        const citeMatch = this.matchAtPosition(line, position.character, /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite)\{([^}]+)\}/g);
        if (citeMatch) {
            const keys = citeMatch[2].split(',').map(k => k.trim());
            // Find which key the cursor is on
            const beforeCursor = line.substring(0, position.character);
            const lastComma = beforeCursor.lastIndexOf(',');
            const keyStart = lastComma >= 0 ? lastComma + 1 : citeMatch.index + citeMatch[1].length + 2;

            for (const key of keys) {
                const keyIndex = line.indexOf(key, keyStart);
                if (position.character >= keyIndex && position.character <= keyIndex + key.length) {
                    return this.findCitationDefinition(document, key);
                }
            }
            // Default to first key
            return this.findCitationDefinition(document, keys[0]);
        }

        // Check for \input{file} or \include{file} - jump to file
        const inputMatch = this.matchAtPosition(line, position.character, /\\(input|include)\{([^}]+)\}/g);
        if (inputMatch) {
            const filePath = inputMatch[2];
            return this.findFileDefinition(document, filePath);
        }

        // For command definitions, we need a word at the cursor position
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_:-]+/);
        if (!wordRange) return null;

        const word = document.getText(wordRange);

        // Check if cursor is on a command that might be user-defined
        if (line.charAt(position.character - word.length - 1) === '\\') {
            return this.findCommandDefinition(document, word);
        }

        return null;
    }

    private matchAtPosition(line: string, col: number, pattern: RegExp): RegExpExecArray | null {
        let match;
        while ((match = pattern.exec(line)) !== null) {
            if (col >= match.index && col <= match.index + match[0].length) {
                return match;
            }
        }
        return null;
    }

    private async findLabelDefinition(document: vscode.TextDocument, labelName: string): Promise<vscode.Location | null> {
        // First search current document
        const text = document.getText();
        const labelPattern = new RegExp(`\\\\label\\{${labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`);
        const match = labelPattern.exec(text);
        if (match) {
            const pos = document.positionAt(match.index);
            return new vscode.Location(document.uri, pos);
        }

        // Search project files
        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);
        const labelInfo = project.labels.get(labelName);
        if (labelInfo) {
            const uri = vscode.Uri.file(labelInfo.file);
            const pos = new vscode.Position(labelInfo.line, 0);
            return new vscode.Location(uri, pos);
        }

        return null;
    }

    private async findCitationDefinition(document: vscode.TextDocument, key: string): Promise<vscode.Location | null> {
        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);
        const entry = project.bibEntries.get(key);

        if (entry) {
            // Find the entry in the bib file
            try {
                const content = fs.readFileSync(entry.sourceFile, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(`@`) && lines[i].includes(key)) {
                        return new vscode.Location(
                            vscode.Uri.file(entry.sourceFile),
                            new vscode.Position(i, 0)
                        );
                    }
                }
            } catch {
                // Fall through
            }
        }

        return null;
    }

    private findFileDefinition(document: vscode.TextDocument, filePath: string): vscode.Location | null {
        const dir = path.dirname(document.uri.fsPath);
        let fullPath = path.resolve(dir, filePath);
        if (!fullPath.endsWith('.tex')) {
            fullPath += '.tex';
        }

        if (fs.existsSync(fullPath)) {
            return new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0));
        }

        return null;
    }

    private async findCommandDefinition(document: vscode.TextDocument, cmdName: string): Promise<vscode.Location | null> {
        // Search for \newcommand{\cmdName} or \renewcommand{\cmdName} or \def\cmdName
        const patterns = [
            new RegExp(`\\\\newcommand\\*?\\{?\\\\${cmdName}\\}?`),
            new RegExp(`\\\\renewcommand\\*?\\{?\\\\${cmdName}\\}?`),
            new RegExp(`\\\\def\\\\${cmdName}`),
            new RegExp(`\\\\DeclareMathOperator\\*?\\{\\\\${cmdName}\\}`),
        ];

        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);

        for (const file of project.includedFiles) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                for (const pattern of patterns) {
                    const match = pattern.exec(content);
                    if (match) {
                        const lines = content.substring(0, match.index).split('\n');
                        const line = lines.length - 1;
                        return new vscode.Location(
                            vscode.Uri.file(file),
                            new vscode.Position(line, 0)
                        );
                    }
                }
            } catch {
                // Continue
            }
        }

        return null;
    }
}

// =============================================================================
// Reference Provider
// =============================================================================

export class LaTeXReferenceProvider implements vscode.ReferenceProvider {
    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const line = document.lineAt(position.line).text;
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_:-]+/);
        if (!wordRange) return [];

        const word = document.getText(wordRange);

        // Check if on a \label{} - find all \ref{} to this label
        const labelMatch = line.match(/\\label\{([^}]+)\}/);
        if (labelMatch && line.indexOf(labelMatch[0]) <= position.character &&
            position.character <= line.indexOf(labelMatch[0]) + labelMatch[0].length) {
            const labelName = labelMatch[1];
            return this.findLabelReferences(document, labelName, context.includeDeclaration);
        }

        // Check if on a citation key
        const citeKeyPattern = /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite)\{([^}]+)\}/g;
        let match;
        while ((match = citeKeyPattern.exec(line)) !== null) {
            if (position.character >= match.index && position.character <= match.index + match[0].length) {
                // Find which key
                const keys = match[2].split(',').map(k => k.trim());
                for (const key of keys) {
                    if (line.indexOf(key, match.index) <= position.character) {
                        return this.findCitationReferences(document, key, context.includeDeclaration);
                    }
                }
            }
        }

        return [];
    }

    private async findLabelReferences(
        document: vscode.TextDocument,
        labelName: string,
        includeDeclaration: boolean
    ): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);

        const escapedLabel = labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const refPattern = new RegExp(`\\\\(ref|eqref|pageref|autoref|cref|Cref)\\{[^}]*${escapedLabel}[^}]*\\}`, 'g');
        const labelPattern = new RegExp(`\\\\label\\{${escapedLabel}\\}`);

        for (const file of project.includedFiles) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const uri = vscode.Uri.file(file);

                // Find references
                let match;
                while ((match = refPattern.exec(content)) !== null) {
                    const pos = this.offsetToPosition(content, match.index);
                    locations.push(new vscode.Location(uri, pos));
                }

                // Find declaration if requested
                if (includeDeclaration) {
                    const labelMatch = labelPattern.exec(content);
                    if (labelMatch) {
                        const pos = this.offsetToPosition(content, labelMatch.index);
                        locations.push(new vscode.Location(uri, pos));
                    }
                }
            } catch {
                // Continue
            }
        }

        return locations;
    }

    private async findCitationReferences(
        document: vscode.TextDocument,
        key: string,
        includeDeclaration: boolean
    ): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];
        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);

        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const citePattern = new RegExp(`\\\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite)\\{[^}]*${escapedKey}[^}]*\\}`, 'g');

        for (const file of project.includedFiles) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const uri = vscode.Uri.file(file);

                let match;
                while ((match = citePattern.exec(content)) !== null) {
                    const pos = this.offsetToPosition(content, match.index);
                    locations.push(new vscode.Location(uri, pos));
                }
            } catch {
                // Continue
            }
        }

        // Include declaration in bib file
        if (includeDeclaration) {
            const entry = project.bibEntries.get(key);
            if (entry) {
                try {
                    const content = fs.readFileSync(entry.sourceFile, 'utf-8');
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes(`@`) && lines[i].includes(key)) {
                            locations.push(new vscode.Location(
                                vscode.Uri.file(entry.sourceFile),
                                new vscode.Position(i, 0)
                            ));
                            break;
                        }
                    }
                } catch {
                    // Ignore
                }
            }
        }

        return locations;
    }

    private offsetToPosition(content: string, offset: number): vscode.Position {
        const before = content.substring(0, offset);
        const lines = before.split('\n');
        return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    }
}

// =============================================================================
// Completion Provider
// =============================================================================

export class LaTeXCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const line = document.lineAt(position.line).text;
        const linePrefix = line.substring(0, position.character);

        // Check for \ref{...} completion
        if (/\\(ref|eqref|pageref|autoref|cref|Cref)\{[^}]*$/.test(linePrefix)) {
            return this.provideLabelCompletions(document);
        }

        // Check for \cite{...} completion
        if (/\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite)\{[^}]*$/.test(linePrefix)) {
            return this.provideCitationCompletions(document);
        }

        // Check for \begin{...} completion
        if (/\\begin\{[^}]*$/.test(linePrefix)) {
            return this.provideEnvironmentCompletions();
        }

        // Check for \usepackage{...} completion
        if (/\\usepackage(\[[^\]]*\])?\{[^}]*$/.test(linePrefix)) {
            return this.providePackageCompletions();
        }

        // Check for \includegraphics{...} completion
        if (/\\includegraphics(\[[^\]]*\])?\{[^}]*$/.test(linePrefix)) {
            return this.provideImageCompletions(document, linePrefix);
        }

        // Check for \input{...} or \include{...} completion
        if (/\\(input|include)\{[^}]*$/.test(linePrefix)) {
            return this.provideFileCompletions(document);
        }

        return [];
    }

    private async provideLabelCompletions(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);
        const items: vscode.CompletionItem[] = [];

        for (const [labelName, info] of project.labels) {
            const item = new vscode.CompletionItem(labelName, vscode.CompletionItemKind.Reference);
            item.detail = path.basename(info.file);
            item.documentation = new vscode.MarkdownString(`**Line ${info.line + 1}**\n\n\`${info.context}\``);
            item.insertText = labelName;
            items.push(item);
        }

        return items;
    }

    private async provideCitationCompletions(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);
        const items: vscode.CompletionItem[] = [];

        for (const [key, entry] of project.bibEntries) {
            const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Reference);
            item.detail = formatAuthors(entry.author) + (entry.year ? ` (${entry.year})` : '');
            item.documentation = new vscode.MarkdownString(
                `**${entry.title || 'Untitled'}**\n\n` +
                `${formatAuthors(entry.author)} (${entry.year || 'n.d.'})\n\n` +
                (entry.journal ? `*${entry.journal}*\n\n` : '') +
                (entry.booktitle ? `In *${entry.booktitle}*\n\n` : '') +
                (entry.abstract ? `---\n\n${entry.abstract.substring(0, 200)}...` : '')
            );
            item.insertText = key;
            item.sortText = `0_${key}`; // Prioritize exact matches
            items.push(item);
        }

        return items;
    }

    private provideEnvironmentCompletions(): vscode.CompletionItem[] {
        const environments = [
            // Document structure
            { name: 'document', desc: 'Main document content' },
            { name: 'abstract', desc: 'Document abstract' },
            // Math
            { name: 'equation', desc: 'Numbered equation' },
            { name: 'equation*', desc: 'Unnumbered equation' },
            { name: 'align', desc: 'Aligned equations (numbered)' },
            { name: 'align*', desc: 'Aligned equations (unnumbered)' },
            { name: 'gather', desc: 'Gathered equations' },
            { name: 'multline', desc: 'Multi-line equation' },
            { name: 'split', desc: 'Split equation' },
            { name: 'cases', desc: 'Piecewise functions' },
            { name: 'matrix', desc: 'Matrix without brackets' },
            { name: 'pmatrix', desc: 'Matrix with parentheses' },
            { name: 'bmatrix', desc: 'Matrix with square brackets' },
            // Floats
            { name: 'figure', desc: 'Floating figure' },
            { name: 'table', desc: 'Floating table' },
            { name: 'tabular', desc: 'Table content' },
            // Lists
            { name: 'itemize', desc: 'Bulleted list' },
            { name: 'enumerate', desc: 'Numbered list' },
            { name: 'description', desc: 'Description list' },
            // Text
            { name: 'center', desc: 'Centered content' },
            { name: 'quote', desc: 'Short quotation' },
            { name: 'verbatim', desc: 'Literal text' },
            { name: 'minipage', desc: 'Box with specified width' },
            // Theorems
            { name: 'theorem', desc: 'Theorem statement' },
            { name: 'lemma', desc: 'Lemma statement' },
            { name: 'proof', desc: 'Proof' },
            { name: 'definition', desc: 'Definition' },
            // Code
            { name: 'lstlisting', desc: 'Code listing (listings)' },
            { name: 'minted', desc: 'Code listing (minted)' },
            // Beamer
            { name: 'frame', desc: 'Beamer slide' },
            { name: 'block', desc: 'Beamer block' },
            { name: 'columns', desc: 'Multi-column layout' },
        ];

        return environments.map(env => {
            const item = new vscode.CompletionItem(env.name, vscode.CompletionItemKind.Struct);
            item.detail = env.desc;
            item.insertText = new vscode.SnippetString(`${env.name}}\n\t$0\n\\\\end{${env.name}`);
            return item;
        });
    }

    private providePackageCompletions(): vscode.CompletionItem[] {
        const packages = [
            { name: 'amsmath', desc: 'Enhanced math environments' },
            { name: 'amssymb', desc: 'Additional math symbols' },
            { name: 'amsthm', desc: 'Theorem environments' },
            { name: 'graphicx', desc: 'Include graphics' },
            { name: 'hyperref', desc: 'Hyperlinks and PDF metadata' },
            { name: 'geometry', desc: 'Page layout' },
            { name: 'xcolor', desc: 'Extended colors' },
            { name: 'tikz', desc: 'Programmatic graphics' },
            { name: 'booktabs', desc: 'Professional tables' },
            { name: 'siunitx', desc: 'SI units' },
            { name: 'biblatex', desc: 'Modern bibliography' },
            { name: 'natbib', desc: 'Natural citations' },
            { name: 'cleveref', desc: 'Intelligent cross-references' },
            { name: 'listings', desc: 'Code listings' },
            { name: 'minted', desc: 'Syntax highlighting' },
            { name: 'microtype', desc: 'Microtypography' },
            { name: 'fontspec', desc: 'Font selection (XeLaTeX/LuaLaTeX)' },
            { name: 'babel', desc: 'Multilingual support' },
            { name: 'enumitem', desc: 'Customizable lists' },
            { name: 'subcaption', desc: 'Subfigures' },
        ];

        return packages.map(pkg => {
            const item = new vscode.CompletionItem(pkg.name, vscode.CompletionItemKind.Module);
            item.detail = pkg.desc;
            item.insertText = pkg.name;
            return item;
        });
    }

    private provideImageCompletions(document: vscode.TextDocument, linePrefix: string): vscode.CompletionItem[] {
        const dir = path.dirname(document.uri.fsPath);
        const items: vscode.CompletionItem[] = [];

        // Get partial path from line
        const match = linePrefix.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)$/);
        const partial = match ? match[1] : '';
        const searchDir = partial ? path.resolve(dir, path.dirname(partial)) : dir;

        try {
            const files = fs.readdirSync(searchDir);
            const imageExts = ['.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg'];

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                const fullPath = path.join(searchDir, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    const item = new vscode.CompletionItem(file + '/', vscode.CompletionItemKind.Folder);
                    items.push(item);
                } else if (imageExts.includes(ext)) {
                    const item = new vscode.CompletionItem(file, vscode.CompletionItemKind.File);
                    item.detail = `${(stat.size / 1024).toFixed(1)} KB`;
                    items.push(item);
                }
            }
        } catch {
            // Ignore errors
        }

        return items;
    }

    private provideFileCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
        const dir = path.dirname(document.uri.fsPath);
        const items: vscode.CompletionItem[] = [];

        try {
            const files = fs.readdirSync(dir);

            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    const item = new vscode.CompletionItem(file + '/', vscode.CompletionItemKind.Folder);
                    items.push(item);
                } else if (file.endsWith('.tex')) {
                    const item = new vscode.CompletionItem(file.replace('.tex', ''), vscode.CompletionItemKind.File);
                    item.detail = 'TeX file';
                    items.push(item);
                }
            }
        } catch {
            // Ignore errors
        }

        return items;
    }
}

// =============================================================================
// Diagnostics Provider (ChkTeX Integration)
// =============================================================================

const diagnosticCollection = vscode.languages.createDiagnosticCollection('latex');

export async function runChkTeX(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'latex') return;

    const config = vscode.workspace.getConfiguration('scimax.latex');
    if (!config.get<boolean>('enableChktex', true)) {
        diagnosticCollection.delete(document.uri);
        return;
    }

    const filePath = document.uri.fsPath;
    const diagnostics: vscode.Diagnostic[] = [];

    try {
        const result = await runChkTeXProcess(filePath);
        const lines = result.split('\n');

        // ChkTeX output format: filename:line:column:warning-number:message
        const pattern = /^[^:]+:(\d+):(\d+):(\d+):(.+)$/;

        for (const line of lines) {
            const match = pattern.exec(line);
            if (match) {
                const lineNum = parseInt(match[1], 10) - 1;
                const colNum = parseInt(match[2], 10) - 1;
                const warningNum = match[3];
                const message = match[4].trim();

                const range = new vscode.Range(
                    new vscode.Position(lineNum, Math.max(0, colNum)),
                    new vscode.Position(lineNum, colNum + 10)
                );

                const severity = warningNum === '1' ? vscode.DiagnosticSeverity.Error :
                                 warningNum === '2' ? vscode.DiagnosticSeverity.Warning :
                                 vscode.DiagnosticSeverity.Information;

                const diagnostic = new vscode.Diagnostic(range, message, severity);
                diagnostic.source = 'ChkTeX';
                diagnostic.code = `W${warningNum}`;
                diagnostics.push(diagnostic);
            }
        }
    } catch (error) {
        // ChkTeX not available or failed
        console.log('ChkTeX not available:', error);
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

function runChkTeXProcess(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn('chktex', ['-q', '-f', '%f:%l:%c:%n:%m\\n', filePath]);
        let output = '';
        let error = '';

        proc.stdout?.on('data', (data: Buffer) => {
            output += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
            error += data.toString();
        });

        proc.on('close', (code) => {
            // ChkTeX returns non-zero even for warnings
            resolve(output);
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

export function clearDiagnostics(document: vscode.TextDocument): void {
    diagnosticCollection.delete(document.uri);
}

export function disposeDiagnostics(): void {
    diagnosticCollection.dispose();
}

// =============================================================================
// Enhanced Hover for Citations
// =============================================================================

// =============================================================================
// Rename Provider
// =============================================================================

export class LaTeXRenameProvider implements vscode.RenameProvider {
    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken
    ): Promise<vscode.WorkspaceEdit | null> {
        const line = document.lineAt(position.line).text;

        // Check if on a \label{} or \ref{}
        const labelMatch = this.matchLabelOrRef(line, position.character);
        if (labelMatch) {
            return this.renameLabelReferences(document, labelMatch.name, newName);
        }

        return null;
    }

    async prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Range | { range: vscode.Range; placeholder: string } | null> {
        const line = document.lineAt(position.line).text;

        const labelMatch = this.matchLabelOrRef(line, position.character);
        if (labelMatch) {
            const startCol = line.indexOf(labelMatch.name, labelMatch.braceStart);
            const endCol = startCol + labelMatch.name.length;
            return {
                range: new vscode.Range(position.line, startCol, position.line, endCol),
                placeholder: labelMatch.name
            };
        }

        return null;
    }

    private matchLabelOrRef(line: string, col: number): { name: string; braceStart: number } | null {
        // Match \label{name} or \ref{name} variants
        const pattern = /\\(label|ref|eqref|pageref|autoref|cref|Cref)\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (col >= start && col <= end) {
                const braceStart = match.index + match[1].length + 2; // after \cmd{
                return { name: match[2], braceStart };
            }
        }
        return null;
    }

    private async renameLabelReferences(
        document: vscode.TextDocument,
        oldName: string,
        newName: string
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const masterFile = findMasterDocument(document);
        const project = await parseProject(masterFile);

        const escapedOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Pattern to match both \label{name} and all \ref{name} variants
        const patterns = [
            new RegExp(`(\\\\label\\{)${escapedOld}(\\})`, 'g'),
            new RegExp(`(\\\\(?:ref|eqref|pageref|autoref|cref|Cref)\\{)${escapedOld}(\\})`, 'g'),
        ];

        for (const file of project.includedFiles) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const uri = vscode.Uri.file(file);
                const lines = content.split('\n');

                for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                    const lineText = lines[lineNum];
                    for (const pattern of patterns) {
                        pattern.lastIndex = 0;
                        let match;
                        while ((match = pattern.exec(lineText)) !== null) {
                            // Calculate position of the label name (after the opening brace)
                            const nameStart = match.index + match[1].length;
                            const nameEnd = nameStart + oldName.length;
                            const range = new vscode.Range(lineNum, nameStart, lineNum, nameEnd);
                            edit.replace(uri, range, newName);
                        }
                    }
                }
            } catch {
                // Skip files that can't be read
            }
        }

        return edit;
    }
}

// =============================================================================
// Reference Validation (Diagnostics for undefined/unused labels)
// =============================================================================

const refValidationDiagnostics = vscode.languages.createDiagnosticCollection('latex-refs');

export async function validateReferences(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'latex') return;

    const config = vscode.workspace.getConfiguration('scimax.latex');
    if (!config.get<boolean>('validateReferences', true)) {
        refValidationDiagnostics.delete(document.uri);
        return;
    }

    const masterFile = findMasterDocument(document);
    const project = await parseProject(masterFile);

    // Collect all defined labels and their locations
    const definedLabels = new Map<string, { file: string; line: number }>();
    // Collect all referenced labels and their locations
    const referencedLabels = new Map<string, { file: string; line: number; col: number }[]>();

    for (const file of project.includedFiles) {
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');

            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const lineText = lines[lineNum];

                // Find defined labels
                const labelPattern = /\\label\{([^}]+)\}/g;
                let match;
                while ((match = labelPattern.exec(lineText)) !== null) {
                    definedLabels.set(match[1], { file, line: lineNum });
                }

                // Find referenced labels
                const refPattern = /\\(ref|eqref|pageref|autoref|cref|Cref)\{([^}]+)\}/g;
                while ((match = refPattern.exec(lineText)) !== null) {
                    const labelName = match[2];
                    const col = match.index + match[1].length + 2;
                    if (!referencedLabels.has(labelName)) {
                        referencedLabels.set(labelName, []);
                    }
                    referencedLabels.get(labelName)!.push({ file, line: lineNum, col });
                }
            }
        } catch {
            // Skip unreadable files
        }
    }

    // Create diagnostics per file
    const diagnosticsMap = new Map<string, vscode.Diagnostic[]>();

    // Check for undefined references
    for (const [labelName, refs] of referencedLabels) {
        if (!definedLabels.has(labelName)) {
            for (const ref of refs) {
                if (!diagnosticsMap.has(ref.file)) {
                    diagnosticsMap.set(ref.file, []);
                }
                const range = new vscode.Range(ref.line, ref.col, ref.line, ref.col + labelName.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Undefined reference: \\label{${labelName}} not found`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'LaTeX References';
                diagnostic.code = 'undefined-ref';
                diagnosticsMap.get(ref.file)!.push(diagnostic);
            }
        }
    }

    // Check for unused labels (warning, not error)
    for (const [labelName, def] of definedLabels) {
        if (!referencedLabels.has(labelName)) {
            if (!diagnosticsMap.has(def.file)) {
                diagnosticsMap.set(def.file, []);
            }
            // Find the column of the label in the line
            const content = fs.readFileSync(def.file, 'utf-8');
            const lines = content.split('\n');
            const lineText = lines[def.line];
            const labelMatch = lineText.match(/\\label\{([^}]+)\}/);
            const col = labelMatch ? lineText.indexOf(labelMatch[0]) : 0;

            const range = new vscode.Range(def.line, col, def.line, col + `\\label{${labelName}}`.length);
            const diagnostic = new vscode.Diagnostic(
                range,
                `Unused label: ${labelName} is defined but never referenced`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = 'LaTeX References';
            diagnostic.code = 'unused-label';
            diagnosticsMap.get(def.file)!.push(diagnostic);
        }
    }

    // Apply diagnostics
    for (const [file, diagnostics] of diagnosticsMap) {
        refValidationDiagnostics.set(vscode.Uri.file(file), diagnostics);
    }

    // Clear diagnostics for files with no issues
    for (const file of project.includedFiles) {
        if (!diagnosticsMap.has(file)) {
            refValidationDiagnostics.delete(vscode.Uri.file(file));
        }
    }
}

export function clearRefValidationDiagnostics(): void {
    refValidationDiagnostics.clear();
}

export function disposeRefValidationDiagnostics(): void {
    refValidationDiagnostics.dispose();
}

// =============================================================================
// Document Formatting Provider (latexindent integration)
// =============================================================================

export class LaTeXFormattingProvider implements vscode.DocumentFormattingEditProvider {
    async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[]> {
        const config = vscode.workspace.getConfiguration('scimax.latex');
        if (!config.get<boolean>('formatOnSave', false)) {
            return [];
        }

        try {
            const formatted = await runLatexindent(document.getText(), document.uri.fsPath);
            if (formatted && formatted !== document.getText()) {
                const fullRange = new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(document.getText().length)
                );
                return [vscode.TextEdit.replace(fullRange, formatted)];
            }
        } catch (error) {
            console.log('latexindent not available or failed:', error);
        }

        return [];
    }
}

export class LaTeXRangeFormattingProvider implements vscode.DocumentRangeFormattingEditProvider {
    async provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[]> {
        try {
            const text = document.getText(range);
            const formatted = await runLatexindent(text, document.uri.fsPath);
            if (formatted && formatted !== text) {
                return [vscode.TextEdit.replace(range, formatted)];
            }
        } catch (error) {
            console.log('latexindent failed:', error);
        }

        return [];
    }
}

/**
 * Parse latexindent errors and return a user-friendly message
 */
function parseLatexindentError(stderr: string, code: number): string {
    // Check for missing Perl modules
    if (stderr.includes("Can't locate") && stderr.includes('.pm')) {
        const moduleMatch = stderr.match(/Can't locate ([^\s]+\.pm)/);
        const moduleName = moduleMatch ? moduleMatch[1].replace(/\//g, '::').replace('.pm', '') : 'a Perl module';
        return `latexindent requires the Perl module '${moduleName}'. ` +
            `Install it with: cpan ${moduleName} (or: sudo cpan ${moduleName})`;
    }

    // Check for YAML::Tiny specifically (common issue)
    if (stderr.includes('YAML/Tiny.pm') || stderr.includes('YAML::Tiny')) {
        return 'latexindent requires YAML::Tiny. Install with: cpan YAML::Tiny';
    }

    // Check for Log::Log4perl (another common missing module)
    if (stderr.includes('Log4perl') || stderr.includes('Log/Log4perl')) {
        return 'latexindent requires Log::Log4perl. Install with: cpan Log::Log4perl';
    }

    // Check if latexindent is not found
    if (stderr.includes('command not found') || stderr.includes('not recognized')) {
        return 'latexindent not found. Install it via your TeX distribution or set scimax.latex.latexindentPath';
    }

    // Generic error - truncate to something readable
    const firstLine = stderr.split('\n')[0];
    if (firstLine.length > 100) {
        return `latexindent error: ${firstLine.substring(0, 100)}...`;
    }
    return `latexindent error (code ${code}): ${firstLine || 'unknown error'}`;
}

async function runLatexindent(text: string, filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const config = vscode.workspace.getConfiguration('scimax.latex');
        const latexindentPath = config.get<string>('latexindentPath', 'latexindent');
        const args = ['-m', '-']; // -m for modifylinebreaks, - for stdin

        const proc = spawn(latexindentPath, args, {
            cwd: path.dirname(filePath)
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                const errorMsg = parseLatexindentError(stderr, code || -1);
                reject(new Error(errorMsg));
            }
        });

        proc.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                reject(new Error('latexindent not found. Install it via your TeX distribution or set scimax.latex.latexindentPath'));
            } else {
                reject(err);
            }
        });

        // Write input to stdin
        proc.stdin?.write(text);
        proc.stdin?.end();
    });
}

// Manual format command
export async function formatLatexDocument(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') {
        vscode.window.showWarningMessage('No LaTeX document is open');
        return;
    }

    try {
        const document = editor.document;
        const formatted = await runLatexindent(document.getText(), document.uri.fsPath);
        if (formatted && formatted !== document.getText()) {
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            await editor.edit(editBuilder => {
                editBuilder.replace(fullRange, formatted);
            });
            vscode.window.showInformationMessage('Document formatted with latexindent');
        } else {
            vscode.window.showInformationMessage('Document is already properly formatted');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Formatting failed: ${error}`);
    }
}

// =============================================================================
// Inverse SyncTeX (PDF to source)
// =============================================================================

export async function inverseSyncTeX(pdfPath: string, page: number, x: number, y: number): Promise<void> {
    try {
        // Run synctex view to get source location
        const result = await runSyncTeXView(pdfPath, page, x, y);
        if (result) {
            const uri = vscode.Uri.file(result.file);
            const position = new vscode.Position(result.line - 1, result.column);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    } catch (error) {
        console.error('Inverse SyncTeX failed:', error);
    }
}

interface SyncTeXResult {
    file: string;
    line: number;
    column: number;
}

async function runSyncTeXView(pdfPath: string, page: number, x: number, y: number): Promise<SyncTeXResult | null> {
    return new Promise((resolve, reject) => {
        // synctex view -i "page:x:y:pdffile"
        const proc = spawn('synctex', ['view', '-i', `${page}:${x}:${y}:${pdfPath}`]);
        let output = '';

        proc.stdout?.on('data', (data: Buffer) => {
            output += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                // Parse synctex output
                const inputMatch = output.match(/Input:(.+)/);
                const lineMatch = output.match(/Line:(\d+)/);
                const columnMatch = output.match(/Column:(\d+)/);

                if (inputMatch && lineMatch) {
                    resolve({
                        file: inputMatch[1].trim(),
                        line: parseInt(lineMatch[1], 10),
                        column: columnMatch ? parseInt(columnMatch[1], 10) : 0
                    });
                } else {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });

        proc.on('error', () => {
            resolve(null);
        });
    });
}

// Start listening for inverse SyncTeX from PDF viewers
export function startInverseSyncTeXServer(context: vscode.ExtensionContext): void {
    // For Skim on macOS: it can call a custom URL scheme
    // For SumatraPDF: it can execute a command
    // For Zathura: it uses D-Bus

    // We'll register a URI handler for synctex:// URLs
    const handler = vscode.window.registerUriHandler({
        handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
            // Expected format: synctex://open?file=path&line=123
            if (uri.path === '/open') {
                const params = new URLSearchParams(uri.query);
                const file = params.get('file');
                const line = params.get('line');

                if (file && line) {
                    const fileUri = vscode.Uri.file(file);
                    const position = new vscode.Position(parseInt(line, 10) - 1, 0);
                    vscode.workspace.openTextDocument(fileUri).then(doc => {
                        vscode.window.showTextDocument(doc).then(editor => {
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                        });
                    });
                }
            }
        }
    });

    context.subscriptions.push(handler);
}

// Get the inverse SyncTeX command for different PDF viewers
export function getInverseSyncTeXCommand(): string {
    const config = vscode.workspace.getConfiguration('scimax.latex');
    const viewer = config.get<string>('pdfViewer', 'auto');

    // Return command that PDF viewer should execute for inverse search
    // This is used when configuring the PDF viewer
    const extensionId = 'scimax-vscode';

    switch (viewer) {
        case 'skim':
            // Skim uses AppleScript or custom URL
            return `code --goto "%file:%line"`;
        case 'sumatra':
            // SumatraPDF: use -inverse-search option
            return `code --goto "%f:%l"`;
        case 'zathura':
            // Zathura: use synctex-editor-command
            return `code --goto "%{input}:%{line}"`;
        default:
            return `code --goto "%file:%line"`;
    }
}

// =============================================================================
// LaTeX-aware Spell Checking
// =============================================================================

// Regions to skip during spell checking
const SKIP_PATTERNS = [
    /\\[a-zA-Z]+(\[[^\]]*\])?(\{[^}]*\})?/g,  // Commands with optional args
    /\$[^$]+\$/g,                               // Inline math
    /\$\$[\s\S]*?\$\$/g,                        // Display math
    /\\\[[^\]]*\\\]/g,                          // \[...\] math
    /\\\([^)]*\\\)/g,                           // \(...\) math
    /\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g,  // Environments
    /%[^\n]*/g,                                  // Comments
    /\\[a-zA-Z]+/g,                             // Bare commands
];

export interface SpellCheckRegion {
    start: number;
    end: number;
    text: string;
}

/**
 * Extract regions of text that should be spell-checked (excluding LaTeX commands/math)
 */
export function extractSpellCheckRegions(text: string): SpellCheckRegion[] {
    // Create a mask of characters to skip
    const skip = new Array(text.length).fill(false);

    for (const pattern of SKIP_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            for (let i = match.index; i < match.index + match[0].length; i++) {
                if (i < skip.length) skip[i] = true;
            }
        }
    }

    // Extract contiguous non-skipped regions
    const regions: SpellCheckRegion[] = [];
    let regionStart: number | null = null;

    for (let i = 0; i <= text.length; i++) {
        const shouldSkip = i === text.length || skip[i];

        if (!shouldSkip && regionStart === null) {
            regionStart = i;
        } else if (shouldSkip && regionStart !== null) {
            const regionText = text.substring(regionStart, i).trim();
            if (regionText.length > 0) {
                regions.push({
                    start: regionStart,
                    end: i,
                    text: regionText
                });
            }
            regionStart = null;
        }
    }

    return regions;
}

/**
 * Check if a position is within a spell-checkable region
 */
export function isSpellCheckable(text: string, offset: number): boolean {
    const regions = extractSpellCheckRegions(text);
    return regions.some(r => offset >= r.start && offset < r.end);
}

/**
 * Get words that should be spell-checked from a LaTeX document
 */
export function getSpellCheckableWords(text: string): { word: string; start: number; end: number }[] {
    const regions = extractSpellCheckRegions(text);
    const words: { word: string; start: number; end: number }[] = [];
    const wordPattern = /\b[a-zA-Z']+\b/g;

    for (const region of regions) {
        wordPattern.lastIndex = 0;
        let match;
        while ((match = wordPattern.exec(region.text)) !== null) {
            // Skip very short words
            if (match[0].length < 2) continue;

            words.push({
                word: match[0],
                start: region.start + match.index,
                end: region.start + match.index + match[0].length
            });
        }
    }

    return words;
}

// Diagnostic collection for spell checking
const spellCheckDiagnostics = vscode.languages.createDiagnosticCollection('latex-spelling');

// Simple word list for demonstration - in production, use a real dictionary
const KNOWN_WORDS = new Set<string>();

/**
 * Add words to the known words list (user dictionary)
 */
export function addToUserDictionary(word: string): void {
    KNOWN_WORDS.add(word.toLowerCase());
}

/**
 * Load user dictionary from workspace state
 */
export function loadUserDictionary(context: vscode.ExtensionContext): void {
    const words = context.workspaceState.get<string[]>('latexUserDictionary', []);
    for (const word of words) {
        KNOWN_WORDS.add(word.toLowerCase());
    }
}

/**
 * Save user dictionary to workspace state
 */
export async function saveUserDictionary(context: vscode.ExtensionContext): Promise<void> {
    await context.workspaceState.update('latexUserDictionary', Array.from(KNOWN_WORDS));
}

/**
 * Check if a word is likely misspelled
 * This is a simple heuristic - real implementation would use a dictionary
 */
function isLikelyMisspelled(word: string): boolean {
    // Skip known words
    if (KNOWN_WORDS.has(word.toLowerCase())) return false;

    // Skip words that look like proper nouns (capitalized)
    if (word[0] === word[0].toUpperCase() && word.length > 1) return false;

    // Skip words that look like acronyms (all caps)
    if (word === word.toUpperCase()) return false;

    // Skip words with numbers
    if (/\d/.test(word)) return false;

    // Skip very common LaTeX-related words
    const latexWords = new Set([
        'latex', 'tex', 'pdf', 'eps', 'png', 'jpg', 'svg',
        'documentclass', 'usepackage', 'begin', 'end',
        'section', 'subsection', 'chapter', 'paragraph',
        'figure', 'table', 'equation', 'align', 'enumerate', 'itemize',
        'ref', 'cite', 'label', 'caption', 'includegraphics',
        'textbf', 'textit', 'emph', 'texttt',
        'bibitem', 'bibliography', 'bibliographystyle',
    ]);
    if (latexWords.has(word.toLowerCase())) return false;

    return false; // Disabled by default - need real dictionary
}

export function disposeSpellCheckDiagnostics(): void {
    spellCheckDiagnostics.dispose();
}

export async function getCitationHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    line: string
): Promise<vscode.Hover | null> {
    // Include all common citation commands from natbib, biblatex, and custom packages
    // Pattern handles optional arguments [..] and whitespace before {
    const citePattern = /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|citenum|citeyearpar|citetext|Cite|Citep|Citet|Citealp|Citealt|Citeauthor|nocite|textcite|parencite|footcite|autocite|fullcite|smartcite|supercite|Textcite|Parencite|Footcite|Autocite|Smartcite|Supercite|Citeyear|Citetitle)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    let match;

    while ((match = citePattern.exec(line)) !== null) {
        const startCol = match.index;
        const endCol = startCol + match[0].length;

        if (position.character >= startCol && position.character <= endCol) {
            const keys = match[2].split(',').map(k => k.trim());
            const masterFile = findMasterDocument(document);
            const project = await parseProject(masterFile);

            const md = new vscode.MarkdownString();
            md.isTrusted = true;

            for (const key of keys) {
                const entry = project.bibEntries.get(key);
                if (entry) {
                    md.appendMarkdown(`### ${entry.title || 'Untitled'}\n\n`);
                    md.appendMarkdown(`**${formatAuthors(entry.author)}** (${entry.year || 'n.d.'})\n\n`);

                    if (entry.journal) {
                        md.appendMarkdown(`*${entry.journal}*`);
                        if (entry.volume) {
                            md.appendMarkdown(`, ${entry.volume}`);
                            if (entry.number) md.appendMarkdown(`(${entry.number})`);
                        }
                        if (entry.pages) md.appendMarkdown(`, pp. ${entry.pages}`);
                        md.appendMarkdown('\n\n');
                    } else if (entry.booktitle) {
                        md.appendMarkdown(`In *${entry.booktitle}*\n\n`);
                    }

                    if (entry.doi) {
                        md.appendMarkdown(`[DOI: ${entry.doi}](https://doi.org/${entry.doi})\n\n`);
                    }

                    if (entry.abstract) {
                        md.appendMarkdown('---\n\n');
                        md.appendMarkdown(`${entry.abstract.substring(0, 300)}${entry.abstract.length > 300 ? '...' : ''}\n\n`);
                    }

                    md.appendMarkdown(`\`[${key}]\` from \`${path.basename(entry.sourceFile)}\`\n\n`);
                } else {
                    md.appendMarkdown(`**${key}**: *Citation not found*\n\n`);
                }
            }

            return new vscode.Hover(md);
        }
    }

    return null;
}
