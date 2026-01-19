/**
 * LaTeX Hover Provider
 * Provides tooltips for references, citations, packages, commands, and environments
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    getSections,
    getLabels,
    getEnvironments,
    findSectionAtLine,
    LaTeXLabel
} from './latexDocumentSymbolProvider';

// Common LaTeX commands with descriptions
const LATEX_COMMANDS: { [key: string]: string } = {
    // Text formatting
    'textbf': 'Bold text',
    'textit': 'Italic text',
    'texttt': 'Typewriter (monospace) text',
    'textsc': 'Small caps text',
    'textsf': 'Sans-serif text',
    'textrm': 'Roman (serif) text',
    'textsl': 'Slanted text',
    'emph': 'Emphasized text (usually italic)',
    'underline': 'Underlined text',
    'sout': 'Strikethrough text (requires ulem)',

    // Font sizes
    'tiny': 'Tiny text size',
    'scriptsize': 'Script size text',
    'footnotesize': 'Footnote size text',
    'small': 'Small text size',
    'normalsize': 'Normal text size',
    'large': 'Large text size',
    'Large': 'Larger text size',
    'LARGE': 'Even larger text size',
    'huge': 'Huge text size',
    'Huge': 'Largest text size',

    // Structure
    'part': 'Document part (book/report)',
    'chapter': 'Chapter heading (book/report)',
    'section': 'Section heading',
    'subsection': 'Subsection heading',
    'subsubsection': 'Subsubsection heading',
    'paragraph': 'Paragraph heading',
    'subparagraph': 'Subparagraph heading',

    // References
    'ref': 'Reference to a label',
    'eqref': 'Reference to an equation (with parentheses)',
    'pageref': 'Reference to page number of a label',
    'cite': 'Citation to bibliography entry',
    'citep': 'Parenthetical citation (natbib)',
    'citet': 'Textual citation (natbib)',
    'label': 'Create a label for cross-referencing',

    // Floats
    'caption': 'Caption for figure or table',
    'includegraphics': 'Include an image (graphicx)',
    'centering': 'Center content in environment',

    // Math
    'frac': 'Fraction: \\frac{numerator}{denominator}',
    'sqrt': 'Square root (or nth root with optional arg)',
    'sum': 'Summation symbol',
    'prod': 'Product symbol',
    'int': 'Integral symbol',
    'lim': 'Limit',
    'infty': 'Infinity symbol',
    'partial': 'Partial derivative symbol',
    'nabla': 'Nabla (gradient) symbol',
    'alpha': 'Greek letter alpha',
    'beta': 'Greek letter beta',
    'gamma': 'Greek letter gamma',
    'delta': 'Greek letter delta',
    'epsilon': 'Greek letter epsilon',
    'theta': 'Greek letter theta',
    'lambda': 'Greek letter lambda',
    'mu': 'Greek letter mu',
    'pi': 'Greek letter pi',
    'sigma': 'Greek letter sigma',
    'omega': 'Greek letter omega',

    // Lists
    'item': 'List item',

    // Document
    'documentclass': 'Set document class',
    'usepackage': 'Load a package',
    'input': 'Include another file',
    'include': 'Include another file (with \\clearpage)',
    'bibliography': 'Include bibliography file',
    'bibliographystyle': 'Set bibliography style',

    // Misc
    'newcommand': 'Define a new command',
    'renewcommand': 'Redefine an existing command',
    'newenvironment': 'Define a new environment',
    'def': 'Define a macro (TeX primitive)',
    'let': 'Copy a command definition',
    'hspace': 'Horizontal space',
    'vspace': 'Vertical space',
    'noindent': 'Suppress paragraph indentation',
    'par': 'End paragraph',
    'newpage': 'Start a new page',
    'clearpage': 'Start a new page, flush floats',
    'footnote': 'Add a footnote',
    'marginpar': 'Margin note',
};

// Common LaTeX environments with descriptions
const LATEX_ENVIRONMENTS: { [key: string]: string } = {
    // Document
    'document': 'Main document content',
    'abstract': 'Abstract of the document',

    // Math
    'equation': 'Numbered display equation',
    'equation*': 'Unnumbered display equation',
    'align': 'Aligned equations (numbered)',
    'align*': 'Aligned equations (unnumbered)',
    'gather': 'Gathered equations (numbered)',
    'gather*': 'Gathered equations (unnumbered)',
    'multline': 'Multi-line equation',
    'split': 'Split equation (inside equation env)',
    'cases': 'Piecewise functions',
    'matrix': 'Matrix without brackets',
    'pmatrix': 'Matrix with parentheses',
    'bmatrix': 'Matrix with square brackets',
    'vmatrix': 'Matrix with vertical bars (determinant)',
    'Vmatrix': 'Matrix with double vertical bars',

    // Floats
    'figure': 'Floating figure',
    'figure*': 'Two-column floating figure',
    'table': 'Floating table',
    'table*': 'Two-column floating table',
    'tabular': 'Table content',
    'tabular*': 'Fixed-width table',
    'longtable': 'Multi-page table',

    // Lists
    'itemize': 'Bulleted list',
    'enumerate': 'Numbered list',
    'description': 'Description list',

    // Text
    'center': 'Centered content',
    'flushleft': 'Left-aligned content',
    'flushright': 'Right-aligned content',
    'quote': 'Short quotation',
    'quotation': 'Long quotation with paragraph indentation',
    'verse': 'Poetry and verse',
    'verbatim': 'Literal text (no formatting)',
    'minipage': 'Box with specified width',

    // Theorems
    'theorem': 'Theorem statement',
    'lemma': 'Lemma statement',
    'proposition': 'Proposition statement',
    'corollary': 'Corollary statement',
    'definition': 'Definition',
    'proof': 'Proof',
    'example': 'Example',
    'remark': 'Remark',

    // Code
    'lstlisting': 'Code listing (listings package)',
    'minted': 'Code listing (minted package)',

    // Beamer
    'frame': 'Beamer slide',
    'block': 'Beamer content block',
    'columns': 'Beamer multi-column layout',
    'column': 'Beamer single column',
};

// Common LaTeX packages with descriptions
const LATEX_PACKAGES: { [key: string]: string } = {
    // Graphics
    'graphicx': 'Enhanced graphics support (\\includegraphics)',
    'tikz': 'Programmatic graphics and diagrams',
    'pgfplots': 'Plotting based on TikZ',
    'xcolor': 'Extended color support',

    // Math
    'amsmath': 'Enhanced math environments and commands',
    'amssymb': 'Additional math symbols',
    'amsthm': 'Theorem environments',
    'mathtools': 'Extensions to amsmath',
    'bm': 'Bold math symbols',
    'siunitx': 'SI units formatting',

    // Typography
    'microtype': 'Microtypographic enhancements',
    'fontspec': 'Font selection for XeLaTeX/LuaLaTeX',
    'babel': 'Multilingual support',
    'polyglossia': 'Multilingual support for XeLaTeX',

    // Layout
    'geometry': 'Page layout customization',
    'fancyhdr': 'Custom headers and footers',
    'setspace': 'Line spacing control',
    'titlesec': 'Section title formatting',
    'titletoc': 'TOC formatting',

    // Tables
    'booktabs': 'Professional table formatting',
    'longtable': 'Multi-page tables',
    'multirow': 'Multi-row cells in tables',
    'array': 'Extended array/tabular',
    'tabularx': 'Automatic column widths',

    // Code
    'listings': 'Source code listings',
    'minted': 'Syntax-highlighted code (requires pygments)',
    'verbatim': 'Enhanced verbatim',
    'fancyvrb': 'Fancy verbatim',

    // Bibliography
    'natbib': 'Natural bibliography citations',
    'biblatex': 'Modern bibliography management',

    // Hyperlinks
    'hyperref': 'Hyperlinks and PDF metadata',
    'url': 'URL formatting',
    'cleveref': 'Intelligent cross-references',

    // Floats
    'float': 'Improved float handling',
    'subfig': 'Subfigures',
    'subcaption': 'Subfigures and subtables',
    'wrapfig': 'Text wrapping around figures',
    'placeins': 'Float barriers',

    // Other
    'enumitem': 'Customizable lists',
    'xspace': 'Smart spacing after commands',
    'etoolbox': 'Programming tools',
    'ifthen': 'Conditional commands',
    'calc': 'Arithmetic in LaTeX',
    'inputenc': 'Input encoding (for pdfLaTeX)',
    'fontenc': 'Font encoding',
    'ulem': 'Underline and strikethrough',
    'soul': 'Highlighting and spacing',
    'todonotes': 'Margin TODO notes',
    'lipsum': 'Lorem ipsum text',
    'blindtext': 'Blind text for testing',
};

// Math symbols with Unicode equivalents
const MATH_SYMBOLS: { [key: string]: { unicode: string; description: string } } = {
    'alpha': { unicode: '\u03B1', description: 'Greek lowercase alpha' },
    'beta': { unicode: '\u03B2', description: 'Greek lowercase beta' },
    'gamma': { unicode: '\u03B3', description: 'Greek lowercase gamma' },
    'delta': { unicode: '\u03B4', description: 'Greek lowercase delta' },
    'epsilon': { unicode: '\u03B5', description: 'Greek lowercase epsilon' },
    'varepsilon': { unicode: '\u03B5', description: 'Greek epsilon variant' },
    'zeta': { unicode: '\u03B6', description: 'Greek lowercase zeta' },
    'eta': { unicode: '\u03B7', description: 'Greek lowercase eta' },
    'theta': { unicode: '\u03B8', description: 'Greek lowercase theta' },
    'vartheta': { unicode: '\u03D1', description: 'Greek theta variant' },
    'iota': { unicode: '\u03B9', description: 'Greek lowercase iota' },
    'kappa': { unicode: '\u03BA', description: 'Greek lowercase kappa' },
    'lambda': { unicode: '\u03BB', description: 'Greek lowercase lambda' },
    'mu': { unicode: '\u03BC', description: 'Greek lowercase mu' },
    'nu': { unicode: '\u03BD', description: 'Greek lowercase nu' },
    'xi': { unicode: '\u03BE', description: 'Greek lowercase xi' },
    'pi': { unicode: '\u03C0', description: 'Greek lowercase pi' },
    'varpi': { unicode: '\u03D6', description: 'Greek pi variant' },
    'rho': { unicode: '\u03C1', description: 'Greek lowercase rho' },
    'varrho': { unicode: '\u03F1', description: 'Greek rho variant' },
    'sigma': { unicode: '\u03C3', description: 'Greek lowercase sigma' },
    'varsigma': { unicode: '\u03C2', description: 'Greek final sigma' },
    'tau': { unicode: '\u03C4', description: 'Greek lowercase tau' },
    'upsilon': { unicode: '\u03C5', description: 'Greek lowercase upsilon' },
    'phi': { unicode: '\u03C6', description: 'Greek lowercase phi' },
    'varphi': { unicode: '\u03D5', description: 'Greek phi variant' },
    'chi': { unicode: '\u03C7', description: 'Greek lowercase chi' },
    'psi': { unicode: '\u03C8', description: 'Greek lowercase psi' },
    'omega': { unicode: '\u03C9', description: 'Greek lowercase omega' },
    'Gamma': { unicode: '\u0393', description: 'Greek uppercase gamma' },
    'Delta': { unicode: '\u0394', description: 'Greek uppercase delta' },
    'Theta': { unicode: '\u0398', description: 'Greek uppercase theta' },
    'Lambda': { unicode: '\u039B', description: 'Greek uppercase lambda' },
    'Xi': { unicode: '\u039E', description: 'Greek uppercase xi' },
    'Pi': { unicode: '\u03A0', description: 'Greek uppercase pi' },
    'Sigma': { unicode: '\u03A3', description: 'Greek uppercase sigma' },
    'Upsilon': { unicode: '\u03A5', description: 'Greek uppercase upsilon' },
    'Phi': { unicode: '\u03A6', description: 'Greek uppercase phi' },
    'Psi': { unicode: '\u03A8', description: 'Greek uppercase psi' },
    'Omega': { unicode: '\u03A9', description: 'Greek uppercase omega' },

    // Math operators
    'infty': { unicode: '\u221E', description: 'Infinity' },
    'partial': { unicode: '\u2202', description: 'Partial derivative' },
    'nabla': { unicode: '\u2207', description: 'Nabla/gradient' },
    'forall': { unicode: '\u2200', description: 'For all' },
    'exists': { unicode: '\u2203', description: 'There exists' },
    'nexists': { unicode: '\u2204', description: 'Does not exist' },
    'emptyset': { unicode: '\u2205', description: 'Empty set' },
    'in': { unicode: '\u2208', description: 'Element of' },
    'notin': { unicode: '\u2209', description: 'Not element of' },
    'subset': { unicode: '\u2282', description: 'Subset' },
    'supset': { unicode: '\u2283', description: 'Superset' },
    'subseteq': { unicode: '\u2286', description: 'Subset or equal' },
    'supseteq': { unicode: '\u2287', description: 'Superset or equal' },
    'cup': { unicode: '\u222A', description: 'Union' },
    'cap': { unicode: '\u2229', description: 'Intersection' },
    'times': { unicode: '\u00D7', description: 'Multiplication' },
    'div': { unicode: '\u00F7', description: 'Division' },
    'pm': { unicode: '\u00B1', description: 'Plus-minus' },
    'mp': { unicode: '\u2213', description: 'Minus-plus' },
    'cdot': { unicode: '\u00B7', description: 'Centered dot' },
    'circ': { unicode: '\u2218', description: 'Composition' },
    'bullet': { unicode: '\u2022', description: 'Bullet' },
    'leq': { unicode: '\u2264', description: 'Less than or equal' },
    'geq': { unicode: '\u2265', description: 'Greater than or equal' },
    'neq': { unicode: '\u2260', description: 'Not equal' },
    'approx': { unicode: '\u2248', description: 'Approximately' },
    'equiv': { unicode: '\u2261', description: 'Equivalent' },
    'sim': { unicode: '\u223C', description: 'Similar' },
    'propto': { unicode: '\u221D', description: 'Proportional to' },
    'rightarrow': { unicode: '\u2192', description: 'Right arrow' },
    'leftarrow': { unicode: '\u2190', description: 'Left arrow' },
    'Rightarrow': { unicode: '\u21D2', description: 'Double right arrow' },
    'Leftarrow': { unicode: '\u21D0', description: 'Double left arrow' },
    'leftrightarrow': { unicode: '\u2194', description: 'Left-right arrow' },
    'Leftrightarrow': { unicode: '\u21D4', description: 'Double left-right arrow' },
    'mapsto': { unicode: '\u21A6', description: 'Maps to' },
    'to': { unicode: '\u2192', description: 'To (arrow)' },
    'gets': { unicode: '\u2190', description: 'Gets (arrow)' },
    'sum': { unicode: '\u2211', description: 'Summation' },
    'prod': { unicode: '\u220F', description: 'Product' },
    'int': { unicode: '\u222B', description: 'Integral' },
    'oint': { unicode: '\u222E', description: 'Contour integral' },
    'sqrt': { unicode: '\u221A', description: 'Square root' },
    'prime': { unicode: '\u2032', description: 'Prime' },
    'angle': { unicode: '\u2220', description: 'Angle' },
    'perp': { unicode: '\u22A5', description: 'Perpendicular' },
    'parallel': { unicode: '\u2225', description: 'Parallel' },
    'therefore': { unicode: '\u2234', description: 'Therefore' },
    'because': { unicode: '\u2235', description: 'Because' },
    'ldots': { unicode: '\u2026', description: 'Horizontal ellipsis' },
    'cdots': { unicode: '\u22EF', description: 'Centered dots' },
    'vdots': { unicode: '\u22EE', description: 'Vertical dots' },
    'ddots': { unicode: '\u22F1', description: 'Diagonal dots' },
};

export class LaTeXHoverProvider implements vscode.HoverProvider {

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const line = document.lineAt(position.line).text;
        const wordRange = document.getWordRangeAtPosition(position, /\\?[\w@*]+/);
        if (!wordRange) return null;

        const word = document.getText(wordRange);

        // Try different hover types
        return this.hoverForReference(document, position, line) ||
            this.hoverForCitation(document, position, line) ||
            this.hoverForLabel(document, position, line) ||
            this.hoverForPackage(document, position, line) ||
            this.hoverForEnvironment(document, position, line) ||
            this.hoverForCommand(word) ||
            this.hoverForMathSymbol(word) ||
            this.hoverForInclude(document, position, line) ||
            this.hoverForSection(document, position, line) ||
            null;
    }

    /**
     * Hover for \ref{...} - show what the label refers to
     */
    private hoverForReference(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        // Find \ref{...} or \eqref{...} or \pageref{...} at position
        const refPattern = /\\(ref|eqref|pageref|autoref|cref|Cref)\{([^}]+)\}/g;
        let match;

        while ((match = refPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const refType = match[1];
                const labelName = match[2];

                // Find the label in this document
                const labels = getLabels(document);
                const label = labels.find(l => l.name === labelName);

                if (label) {
                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`**\\\\${refType}** to \`${labelName}\`\n\n`);
                    md.appendMarkdown(`**Location:** Line ${label.line + 1}\n\n`);
                    if (label.context) {
                        md.appendMarkdown(`**Context:** ${label.context}\n\n`);
                    }

                    // Show preview of the labeled content
                    const labelLine = document.lineAt(label.line).text.trim();
                    md.appendCodeblock(labelLine, 'latex');

                    return new vscode.Hover(md);
                } else {
                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`**\\\\${refType}** to \`${labelName}\`\n\n`);
                    md.appendMarkdown(`*Label not found in this document*`);
                    return new vscode.Hover(md);
                }
            }
        }

        return null;
    }

    /**
     * Hover for \cite{...} - show citation info
     */
    private hoverForCitation(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        const citePattern = /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite)\{([^}]+)\}/g;
        let match;

        while ((match = citePattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const citeType = match[1];
                const keys = match[2].split(',').map(k => k.trim());

                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**\\\\${citeType}** citation(s)\n\n`);

                for (const key of keys) {
                    md.appendMarkdown(`- \`${key}\`\n`);
                }

                md.appendMarkdown('\n*Citation details from .bib file not yet implemented*');

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for \label{...} - show where it's referenced
     */
    private hoverForLabel(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        const labelPattern = /\\label\{([^}]+)\}/g;
        let match;

        while ((match = labelPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const labelName = match[1];

                // Count references to this label
                const text = document.getText();
                const refPattern = new RegExp(`\\\\(ref|eqref|pageref|autoref|cref|Cref)\\{${labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
                const refs = text.match(refPattern) || [];

                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**Label:** \`${labelName}\`\n\n`);
                md.appendMarkdown(`**Referenced:** ${refs.length} time(s)\n\n`);

                // Show context
                const section = findSectionAtLine(document, position.line);
                if (section) {
                    md.appendMarkdown(`**In section:** ${section.title}`);
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for \usepackage{...} - show package description
     */
    private hoverForPackage(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        const pkgPattern = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;
        let match;

        while ((match = pkgPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const packages = match[1].split(',').map(p => p.trim());

                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**Packages:**\n\n`);

                for (const pkg of packages) {
                    const description = LATEX_PACKAGES[pkg] || 'No description available';
                    md.appendMarkdown(`- **${pkg}**: ${description}\n`);
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for \begin{...} - show environment description
     */
    private hoverForEnvironment(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        const beginPattern = /\\begin\{(\w+\*?)\}/g;
        let match;

        while ((match = beginPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const envName = match[1];
                const baseEnv = envName.replace('*', '');
                const description = LATEX_ENVIRONMENTS[envName] || LATEX_ENVIRONMENTS[baseEnv] || 'Custom environment';

                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**Environment:** \`${envName}\`\n\n`);
                md.appendMarkdown(`${description}\n\n`);

                if (envName.endsWith('*')) {
                    md.appendMarkdown(`*Starred variant (typically unnumbered)*`);
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for LaTeX commands
     */
    private hoverForCommand(word: string): vscode.Hover | null {
        if (!word.startsWith('\\')) return null;

        const cmd = word.substring(1).replace('*', '');
        const description = LATEX_COMMANDS[cmd];

        if (description) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**\\\\${cmd}**\n\n`);
            md.appendMarkdown(description);
            return new vscode.Hover(md);
        }

        return null;
    }

    /**
     * Hover for math symbols - show Unicode
     */
    private hoverForMathSymbol(word: string): vscode.Hover | null {
        const cmd = word.startsWith('\\') ? word.substring(1) : word;
        const symbol = MATH_SYMBOLS[cmd];

        if (symbol) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**\\\\${cmd}**\n\n`);
            md.appendMarkdown(`Unicode: ${symbol.unicode} (U+${symbol.unicode.charCodeAt(0).toString(16).toUpperCase()})\n\n`);
            md.appendMarkdown(symbol.description);
            return new vscode.Hover(md);
        }

        return null;
    }

    /**
     * Hover for \input{...} or \include{...} - show file info
     */
    private hoverForInclude(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        const includePattern = /\\(input|include|includeonly)\{([^}]+)\}/g;
        let match;

        while ((match = includePattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const cmd = match[1];
                let filePath = match[2];

                // Add .tex extension if not present
                if (!filePath.endsWith('.tex')) {
                    filePath += '.tex';
                }

                // Resolve relative to document
                const docDir = path.dirname(document.uri.fsPath);
                const fullPath = path.resolve(docDir, filePath);

                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**\\\\${cmd}** file\n\n`);
                md.appendMarkdown(`**Path:** \`${filePath}\`\n\n`);

                try {
                    const stats = fs.statSync(fullPath);
                    md.appendMarkdown(`**Size:** ${(stats.size / 1024).toFixed(1)} KB\n\n`);
                    md.appendMarkdown(`**Modified:** ${stats.mtime.toLocaleString()}\n\n`);

                    // Show first few lines
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const preview = content.split('\n').slice(0, 5).join('\n');
                    md.appendMarkdown(`**Preview:**\n`);
                    md.appendCodeblock(preview, 'latex');
                } catch {
                    md.appendMarkdown(`*File not found*`);
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for section commands - show hierarchy path
     */
    private hoverForSection(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        const sectionPattern = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*)?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/;
        const match = line.match(sectionPattern);

        if (match) {
            const startCol = line.indexOf('\\' + match[1]);
            const endCol = line.lastIndexOf('}') + 1;

            if (position.character >= startCol && position.character <= endCol) {
                const sectionType = match[1];
                const starred = match[2] === '*';
                const title = match[3];

                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**\\\\${sectionType}${starred ? '*' : ''}**\n\n`);
                md.appendMarkdown(`**Title:** ${title}\n\n`);

                if (starred) {
                    md.appendMarkdown(`*Unnumbered section (not in TOC)*\n\n`);
                }

                // Show hierarchy path
                const sections = getSections(document);
                const currentSection = sections.find(s => s.line === position.line);

                if (currentSection) {
                    const path: string[] = [];
                    let level = currentSection.level;

                    for (let i = sections.indexOf(currentSection) - 1; i >= 0; i--) {
                        const sec = sections[i];
                        if (sec.level < level) {
                            path.unshift(sec.title);
                            level = sec.level;
                        }
                    }

                    if (path.length > 0) {
                        md.appendMarkdown(`**Path:** ${path.join(' > ')} > ${title}`);
                    }
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }
}
