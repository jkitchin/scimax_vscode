/**
 * LaTeX Hover Provider
 * Provides tooltips for references, citations, packages, commands, and environments
 * Now includes rendered equation previews and figure previews
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import {
    getSections,
    getLabels,
    getEnvironments,
    findSectionAtLine,
    LaTeXLabel
} from './latexDocumentSymbolProvider';
import {
    renderLatexToSvg,
    LatexFragment,
    LatexDocumentSettings,
    initLatexPreviewCache,
} from '../org/latexPreviewProvider';
import { getCitationHover } from './latexLanguageProvider';

// =============================================================================
// PDF to PNG Conversion for Figure Previews
// =============================================================================

// Cache for converted PDF previews: maps PDF path + mtime to PNG path
const pdfPreviewCache = new Map<string, string>();

/**
 * Convert a PDF file to PNG for preview
 * Tries multiple tools: pdftoppm (poppler), convert (ImageMagick), gs (Ghostscript)
 */
async function convertPdfToPng(pdfPath: string): Promise<string | null> {
    // Create cache key based on path and modification time
    const stats = fs.statSync(pdfPath);
    const cacheKey = `${pdfPath}:${stats.mtimeMs}`;

    // Check cache
    const cached = pdfPreviewCache.get(cacheKey);
    if (cached && fs.existsSync(cached)) {
        return cached;
    }

    // Generate output path in temp directory
    const hash = crypto.createHash('md5').update(cacheKey).digest('hex');
    const tmpDir = path.join(os.tmpdir(), 'scimax-pdf-preview');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }
    const outputPath = path.join(tmpDir, `${hash}.png`);

    // If output already exists, use it
    if (fs.existsSync(outputPath)) {
        pdfPreviewCache.set(cacheKey, outputPath);
        return outputPath;
    }

    // Try different conversion tools
    const converters = [
        // pdftoppm from poppler-utils (best quality, most common on Linux/macOS)
        {
            cmd: 'pdftoppm',
            args: ['-png', '-f', '1', '-l', '1', '-r', '150', '-singlefile', pdfPath, outputPath.replace('.png', '')],
            outputFile: outputPath,
        },
        // ImageMagick convert
        {
            cmd: 'convert',
            args: ['-density', '150', `${pdfPath}[0]`, '-quality', '90', outputPath],
            outputFile: outputPath,
        },
        // Ghostscript
        {
            cmd: 'gs',
            args: [
                '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dFirstPage=1', '-dLastPage=1',
                '-sDEVICE=png16m', '-r150', `-sOutputFile=${outputPath}`, pdfPath
            ],
            outputFile: outputPath,
        },
    ];

    for (const converter of converters) {
        try {
            const success = await runConverter(converter.cmd, converter.args);
            if (success && fs.existsSync(converter.outputFile)) {
                pdfPreviewCache.set(cacheKey, converter.outputFile);
                return converter.outputFile;
            }
        } catch {
            // Try next converter
        }
    }

    return null;
}

/**
 * Run a converter command and return success/failure
 */
function runConverter(cmd: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, { stdio: 'pipe' });

        proc.on('close', (code) => {
            resolve(code === 0);
        });

        proc.on('error', () => {
            resolve(false);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
            proc.kill();
            resolve(false);
        }, 10000);
    });
}

/**
 * Cache for kpsewhich results to avoid repeated calls
 */
const kpsewhichCache = new Map<string, string | null>();

/**
 * Run kpsewhich to find TeX files (packages, styles, etc.)
 * Returns the path or null if not found
 */
async function kpsewhich(filename: string): Promise<string | null> {
    // Check cache first
    if (kpsewhichCache.has(filename)) {
        return kpsewhichCache.get(filename)!;
    }

    return new Promise((resolve) => {
        const proc = spawn('kpsewhich', [filename], { stdio: 'pipe' });
        let output = '';

        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0 && output.trim()) {
                const result = output.trim();
                kpsewhichCache.set(filename, result);
                resolve(result);
            } else {
                kpsewhichCache.set(filename, null);
                resolve(null);
            }
        });

        proc.on('error', () => {
            kpsewhichCache.set(filename, null);
            resolve(null);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
            proc.kill();
            kpsewhichCache.set(filename, null);
            resolve(null);
        }, 5000);
    });
}

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

    // Structure - section commands handled by hoverForSection for hierarchy path
    // 'part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'
    // are intentionally excluded - see hoverForSection() for richer hover info

    // References
    'ref': 'Reference to a label',
    'eqref': 'Reference to an equation (with parentheses)',
    'pageref': 'Reference to page number of a label',
    'cite': 'Citation to bibliography entry',
    'citep': 'Parenthetical citation (natbib)',
    'citet': 'Textual citation (natbib)',
    'citenum': 'Citation number only, no brackets (natbib)',
    'citealp': 'Citation without parentheses (natbib)',
    'citealt': 'Citation without parentheses, no "and" (natbib)',
    'citeauthor': 'Author name only (natbib)',
    'citeyear': 'Year only (natbib)',
    'citeyearpar': 'Year in parentheses (natbib)',
    'nocite': 'Add to bibliography without citing',
    'textcite': 'Textual citation (biblatex)',
    'parencite': 'Parenthetical citation (biblatex)',
    'footcite': 'Footnote citation (biblatex)',
    'autocite': 'Automatic citation style (biblatex)',
    'fullcite': 'Full citation in text (biblatex)',
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

// Element data for chemical formula tooltips
const ELEMENTS: { [symbol: string]: { name: string; number: number; mass: number } } = {
    'H': { name: 'Hydrogen', number: 1, mass: 1.008 },
    'He': { name: 'Helium', number: 2, mass: 4.003 },
    'Li': { name: 'Lithium', number: 3, mass: 6.941 },
    'Be': { name: 'Beryllium', number: 4, mass: 9.012 },
    'B': { name: 'Boron', number: 5, mass: 10.81 },
    'C': { name: 'Carbon', number: 6, mass: 12.01 },
    'N': { name: 'Nitrogen', number: 7, mass: 14.01 },
    'O': { name: 'Oxygen', number: 8, mass: 16.00 },
    'F': { name: 'Fluorine', number: 9, mass: 19.00 },
    'Ne': { name: 'Neon', number: 10, mass: 20.18 },
    'Na': { name: 'Sodium', number: 11, mass: 22.99 },
    'Mg': { name: 'Magnesium', number: 12, mass: 24.31 },
    'Al': { name: 'Aluminum', number: 13, mass: 26.98 },
    'Si': { name: 'Silicon', number: 14, mass: 28.09 },
    'P': { name: 'Phosphorus', number: 15, mass: 30.97 },
    'S': { name: 'Sulfur', number: 16, mass: 32.07 },
    'Cl': { name: 'Chlorine', number: 17, mass: 35.45 },
    'Ar': { name: 'Argon', number: 18, mass: 39.95 },
    'K': { name: 'Potassium', number: 19, mass: 39.10 },
    'Ca': { name: 'Calcium', number: 20, mass: 40.08 },
    'Sc': { name: 'Scandium', number: 21, mass: 44.96 },
    'Ti': { name: 'Titanium', number: 22, mass: 47.87 },
    'V': { name: 'Vanadium', number: 23, mass: 50.94 },
    'Cr': { name: 'Chromium', number: 24, mass: 52.00 },
    'Mn': { name: 'Manganese', number: 25, mass: 54.94 },
    'Fe': { name: 'Iron', number: 26, mass: 55.85 },
    'Co': { name: 'Cobalt', number: 27, mass: 58.93 },
    'Ni': { name: 'Nickel', number: 28, mass: 58.69 },
    'Cu': { name: 'Copper', number: 29, mass: 63.55 },
    'Zn': { name: 'Zinc', number: 30, mass: 65.38 },
    'Ga': { name: 'Gallium', number: 31, mass: 69.72 },
    'Ge': { name: 'Germanium', number: 32, mass: 72.63 },
    'As': { name: 'Arsenic', number: 33, mass: 74.92 },
    'Se': { name: 'Selenium', number: 34, mass: 78.97 },
    'Br': { name: 'Bromine', number: 35, mass: 79.90 },
    'Kr': { name: 'Krypton', number: 36, mass: 83.80 },
    'Rb': { name: 'Rubidium', number: 37, mass: 85.47 },
    'Sr': { name: 'Strontium', number: 38, mass: 87.62 },
    'Y': { name: 'Yttrium', number: 39, mass: 88.91 },
    'Zr': { name: 'Zirconium', number: 40, mass: 91.22 },
    'Nb': { name: 'Niobium', number: 41, mass: 92.91 },
    'Mo': { name: 'Molybdenum', number: 42, mass: 95.95 },
    'Tc': { name: 'Technetium', number: 43, mass: 98.00 },
    'Ru': { name: 'Ruthenium', number: 44, mass: 101.07 },
    'Rh': { name: 'Rhodium', number: 45, mass: 102.91 },
    'Pd': { name: 'Palladium', number: 46, mass: 106.42 },
    'Ag': { name: 'Silver', number: 47, mass: 107.87 },
    'Cd': { name: 'Cadmium', number: 48, mass: 112.41 },
    'In': { name: 'Indium', number: 49, mass: 114.82 },
    'Sn': { name: 'Tin', number: 50, mass: 118.71 },
    'Sb': { name: 'Antimony', number: 51, mass: 121.76 },
    'Te': { name: 'Tellurium', number: 52, mass: 127.60 },
    'I': { name: 'Iodine', number: 53, mass: 126.90 },
    'Xe': { name: 'Xenon', number: 54, mass: 131.29 },
    'Cs': { name: 'Cesium', number: 55, mass: 132.91 },
    'Ba': { name: 'Barium', number: 56, mass: 137.33 },
    'La': { name: 'Lanthanum', number: 57, mass: 138.91 },
    'Ce': { name: 'Cerium', number: 58, mass: 140.12 },
    'Pr': { name: 'Praseodymium', number: 59, mass: 140.91 },
    'Nd': { name: 'Neodymium', number: 60, mass: 144.24 },
    'Pm': { name: 'Promethium', number: 61, mass: 145.00 },
    'Sm': { name: 'Samarium', number: 62, mass: 150.36 },
    'Eu': { name: 'Europium', number: 63, mass: 151.96 },
    'Gd': { name: 'Gadolinium', number: 64, mass: 157.25 },
    'Tb': { name: 'Terbium', number: 65, mass: 158.93 },
    'Dy': { name: 'Dysprosium', number: 66, mass: 162.50 },
    'Ho': { name: 'Holmium', number: 67, mass: 164.93 },
    'Er': { name: 'Erbium', number: 68, mass: 167.26 },
    'Tm': { name: 'Thulium', number: 69, mass: 168.93 },
    'Yb': { name: 'Ytterbium', number: 70, mass: 173.05 },
    'Lu': { name: 'Lutetium', number: 71, mass: 174.97 },
    'Hf': { name: 'Hafnium', number: 72, mass: 178.49 },
    'Ta': { name: 'Tantalum', number: 73, mass: 180.95 },
    'W': { name: 'Tungsten', number: 74, mass: 183.84 },
    'Re': { name: 'Rhenium', number: 75, mass: 186.21 },
    'Os': { name: 'Osmium', number: 76, mass: 190.23 },
    'Ir': { name: 'Iridium', number: 77, mass: 192.22 },
    'Pt': { name: 'Platinum', number: 78, mass: 195.08 },
    'Au': { name: 'Gold', number: 79, mass: 196.97 },
    'Hg': { name: 'Mercury', number: 80, mass: 200.59 },
    'Tl': { name: 'Thallium', number: 81, mass: 204.38 },
    'Pb': { name: 'Lead', number: 82, mass: 207.2 },
    'Bi': { name: 'Bismuth', number: 83, mass: 208.98 },
    'Po': { name: 'Polonium', number: 84, mass: 209.00 },
    'At': { name: 'Astatine', number: 85, mass: 210.00 },
    'Rn': { name: 'Radon', number: 86, mass: 222.00 },
    'Fr': { name: 'Francium', number: 87, mass: 223.00 },
    'Ra': { name: 'Radium', number: 88, mass: 226.00 },
    'Ac': { name: 'Actinium', number: 89, mass: 227.00 },
    'Th': { name: 'Thorium', number: 90, mass: 232.04 },
    'Pa': { name: 'Protactinium', number: 91, mass: 231.04 },
    'U': { name: 'Uranium', number: 92, mass: 238.03 },
    'Np': { name: 'Neptunium', number: 93, mass: 237.00 },
    'Pu': { name: 'Plutonium', number: 94, mass: 244.00 },
    'Am': { name: 'Americium', number: 95, mass: 243.00 },
    'Cm': { name: 'Curium', number: 96, mass: 247.00 },
    'Bk': { name: 'Berkelium', number: 97, mass: 247.00 },
    'Cf': { name: 'Californium', number: 98, mass: 251.00 },
    'Es': { name: 'Einsteinium', number: 99, mass: 252.00 },
    'Fm': { name: 'Fermium', number: 100, mass: 257.00 },
    'Md': { name: 'Mendelevium', number: 101, mass: 258.00 },
    'No': { name: 'Nobelium', number: 102, mass: 259.00 },
    'Lr': { name: 'Lawrencium', number: 103, mass: 262.00 },
};

/**
 * Parse a chemical formula from mhchem \ce{} notation
 * Returns array of { symbol, count } for each element
 * Handles formats like: W30Ta60Nb10, H2O, Fe2O3, CH3COOH
 */
function parseChemicalFormula(formula: string): Array<{ symbol: string; count: number }> {
    const elements: Array<{ symbol: string; count: number }> = [];

    // Remove mhchem syntax elements that aren't part of the formula
    // Keep only element symbols and numbers
    let cleaned = formula
        .replace(/\^{[^}]*}/g, '')  // Remove superscripts like ^{2+}
        .replace(/_{[^}]*}/g, '')    // Remove subscripts in braces
        .replace(/[\s\-\+\=\>\<\(\)\[\]]/g, '')  // Remove operators and brackets
        .replace(/\\[a-zA-Z]+/g, ''); // Remove LaTeX commands

    // Match element symbols (1-2 letters, capital followed by optional lowercase) followed by optional number
    const pattern = /([A-Z][a-z]?)(\d*\.?\d*)/g;
    let match;

    while ((match = pattern.exec(cleaned)) !== null) {
        const symbol = match[1];
        const countStr = match[2];

        // Skip if not a known element
        if (!ELEMENTS[symbol]) continue;

        const count = countStr ? parseFloat(countStr) : 1;
        elements.push({ symbol, count });
    }

    return elements;
}

export class LaTeXHoverProvider implements vscode.HoverProvider {
    private extensionContext: vscode.ExtensionContext | undefined;

    /**
     * Set the extension context for cache initialization
     */
    setContext(context: vscode.ExtensionContext): void {
        this.extensionContext = context;
        initLatexPreviewCache(context);
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const line = document.lineAt(position.line).text;
        const wordRange = document.getWordRangeAtPosition(position, /\\?[\w@*]+/);

        // First check for rendered equation hover (highest priority for math)
        const equationHover = await this.hoverForEquation(document, position, line);
        if (equationHover) return equationHover;

        // Check for figure/image hover (async for PDF/EPS conversion)
        const figureHover = await this.hoverForFigure(document, position, line);
        if (figureHover) return figureHover;

        // Check for chemical formula hover (\ce{...})
        const chemHover = this.hoverForChemicalFormula(document, position, line);
        if (chemHover) return chemHover;

        if (!wordRange) return null;
        const word = document.getText(wordRange);

        // Try different hover types (some are async now)
        const refHover = this.hoverForReference(document, position, line);
        if (refHover) return refHover;

        const citeHover = await this.hoverForCitation(document, position, line);
        if (citeHover) return citeHover;

        const labelHover = this.hoverForLabel(document, position, line);
        if (labelHover) return labelHover;

        // Bibliography and package hovers are async (use kpsewhich)
        const bibHover = await this.hoverForBibliography(document, position, line);
        if (bibHover) return bibHover;

        const bibStyleHover = await this.hoverForBibliographyStyle(document, position, line);
        if (bibStyleHover) return bibStyleHover;

        const pkgHover = await this.hoverForPackage(document, position, line);
        if (pkgHover) return pkgHover;

        const docClassHover = await this.hoverForDocumentClass(document, position, line);
        if (docClassHover) return docClassHover;

        return this.hoverForEnvironment(document, position, line) ||
            this.hoverForSection(document, position, line) ||  // Before hoverForCommand for hierarchy path
            this.hoverForCommand(word) ||
            this.hoverForMathSymbol(word) ||
            this.hoverForInclude(document, position, line) ||
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

                // Create range for the entire \ref{...} so Go to Definition link works
                const hoverRange = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );

                if (label) {
                    const md = new vscode.MarkdownString();
                    md.isTrusted = true;
                    md.supportHtml = true;
                    md.appendMarkdown(`**\\\\${refType}** to \`${labelName}\`\n\n`);

                    // Create clickable link to jump to the label using file URI with line fragment
                    const labelUri = document.uri.with({ fragment: `L${label.line + 1}` });
                    md.appendMarkdown(`**Location:** [Line ${label.line + 1}](${labelUri.toString()}) \n\n`);

                    if (label.context) {
                        md.appendMarkdown(`**Context:** ${label.context}\n\n`);
                    }

                    // Show preview of the labeled content
                    const labelLine = document.lineAt(label.line).text.trim();
                    md.appendCodeblock(labelLine, 'latex');

                    return new vscode.Hover(md, hoverRange);
                } else {
                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`**\\\\${refType}** to \`${labelName}\`\n\n`);
                    md.appendMarkdown(`*Label not found in this document*`);
                    return new vscode.Hover(md, hoverRange);
                }
            }
        }

        return null;
    }

    /**
     * Hover for \cite{...} - show citation info from BibTeX
     */
    private async hoverForCitation(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): Promise<vscode.Hover | null> {
        // Use the enhanced citation hover that looks up BibTeX entries
        return getCitationHover(document, position, line);
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
     * Hover for \bibliography{...} or \addbibresource{...} - show info about the bib files
     */
    private async hoverForBibliography(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): Promise<vscode.Hover | null> {
        // Handle both \bibliography{...} and \addbibresource{...} (biblatex)
        const bibPattern = /\\(bibliography|addbibresource)\{([^}]+)\}/g;
        let match;

        while ((match = bibPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const cmdName = match[1];
                // \bibliography can have comma-separated files, \addbibresource typically has one
                const bibFiles = match[2].split(',').map(f => f.trim());
                const docDir = path.dirname(document.uri.fsPath);

                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.appendMarkdown(`**Bibliography Files:**\n\n`);

                for (const bibFile of bibFiles) {
                    const bibName = bibFile.endsWith('.bib') ? bibFile : `${bibFile}.bib`;
                    md.appendMarkdown(`### ${bibName}\n`);

                    // Try to find the file
                    const localPath = path.resolve(docDir, bibName);
                    if (fs.existsSync(localPath)) {
                        try {
                            const stats = fs.statSync(localPath);
                            md.appendMarkdown(`**Location:** \`${localPath}\`\n\n`);
                            md.appendMarkdown(`**Size:** ${(stats.size / 1024).toFixed(1)} KB\n\n`);
                            md.appendMarkdown(`**Modified:** ${stats.mtime.toLocaleDateString()}\n\n`);

                            // Count entries in the bib file
                            const content = fs.readFileSync(localPath, 'utf-8');
                            const entryMatches = content.match(/@\w+\s*\{/g);
                            const entryCount = entryMatches ? entryMatches.length : 0;
                            md.appendMarkdown(`**Entries:** ${entryCount}\n\n`);

                            // Show preview of first few entries
                            if (entryCount > 0) {
                                const keyPattern = /@\w+\s*\{\s*([^,\s]+)/g;
                                const keys: string[] = [];
                                let keyMatch;
                                while ((keyMatch = keyPattern.exec(content)) !== null && keys.length < 5) {
                                    keys.push(keyMatch[1]);
                                }
                                if (keys.length > 0) {
                                    md.appendMarkdown(`**Sample keys:** ${keys.join(', ')}${entryCount > 5 ? '...' : ''}\n\n`);
                                }
                            }
                        } catch {
                            md.appendMarkdown(`**Location:** \`${localPath}\`\n\n`);
                        }
                    } else {
                        // Try kpsewhich to find in TeX installation
                        const kpsePath = await kpsewhich(bibName);
                        if (kpsePath) {
                            md.appendMarkdown(`**Location (kpsewhich):** \`${kpsePath}\`\n\n`);
                            try {
                                const stats = fs.statSync(kpsePath);
                                md.appendMarkdown(`**Size:** ${(stats.size / 1024).toFixed(1)} KB\n\n`);
                            } catch {
                                // Ignore stat errors
                            }
                        } else {
                            md.appendMarkdown(`*File not found locally or via kpsewhich*\n\n`);
                            md.appendMarkdown(`Searched in: \`${docDir}\`\n\n`);
                        }
                    }
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for \bibliographystyle{...} - show style file location via kpsewhich
     */
    private async hoverForBibliographyStyle(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): Promise<vscode.Hover | null> {
        const stylePattern = /\\bibliographystyle\{([^}]+)\}/g;
        let match;

        while ((match = stylePattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const styleName = match[1];

                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.appendMarkdown(`**Bibliography Style:** \`${styleName}\`\n\n`);

                // Common style descriptions
                const styleDescriptions: { [key: string]: string } = {
                    'plain': 'Entries sorted alphabetically, labeled with numbers',
                    'unsrt': 'Entries in citation order, labeled with numbers',
                    'alpha': 'Entries sorted alphabetically, labeled with author-year abbreviations',
                    'abbrv': 'Like plain but with abbreviated first names and journal names',
                    'acm': 'ACM Transactions style',
                    'ieeetr': 'IEEE Transactions style, entries in citation order',
                    'siam': 'SIAM style',
                    'apalike': 'APA-like style with author-year citations',
                    'apa': 'American Psychological Association style',
                    'chicago': 'Chicago Manual of Style',
                    'nature': 'Nature journal style',
                    'science': 'Science journal style',
                    'apsrev': 'American Physical Society review style',
                    'apsrev4-1': 'American Physical Society review style (REVTeX 4.1)',
                    'apsrev4-2': 'American Physical Society review style (REVTeX 4.2)',
                    'achemso': 'American Chemical Society style',
                    'rsc': 'Royal Society of Chemistry style',
                    'plainnat': 'Natural bibliography style (natbib)',
                    'abbrvnat': 'Abbreviated natural style (natbib)',
                    'unsrtnat': 'Unsorted natural style (natbib)',
                };

                const description = styleDescriptions[styleName];
                if (description) {
                    md.appendMarkdown(`${description}\n\n`);
                }

                // Look up location via kpsewhich
                const bstPath = await kpsewhich(`${styleName}.bst`);
                if (bstPath) {
                    md.appendMarkdown(`**Location:** \`${bstPath}\`\n\n`);

                    // Show file size and modification date
                    try {
                        const stats = fs.statSync(bstPath);
                        md.appendMarkdown(`**Size:** ${(stats.size / 1024).toFixed(1)} KB\n\n`);
                        md.appendMarkdown(`**Modified:** ${stats.mtime.toLocaleDateString()}\n\n`);
                    } catch {
                        // Ignore stat errors
                    }
                } else {
                    md.appendMarkdown(`*Style file not found via kpsewhich*\n\n`);
                    md.appendMarkdown(`This style may be provided by a package or may not be installed.\n`);
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for \usepackage{...} - show package description and location via kpsewhich
     */
    private async hoverForPackage(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): Promise<vscode.Hover | null> {
        const pkgPattern = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;
        let match;

        while ((match = pkgPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const packages = match[1].split(',').map(p => p.trim());

                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.appendMarkdown(`**Packages:**\n\n`);

                for (const pkg of packages) {
                    const description = LATEX_PACKAGES[pkg] || 'No description available';
                    md.appendMarkdown(`### ${pkg}\n`);
                    md.appendMarkdown(`${description}\n\n`);

                    // Look up location via kpsewhich
                    const styPath = await kpsewhich(`${pkg}.sty`);
                    if (styPath) {
                        md.appendMarkdown(`**Location:** \`${styPath}\`\n\n`);
                    } else {
                        md.appendMarkdown(`*Location not found via kpsewhich*\n\n`);
                    }
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }

    /**
     * Hover for \documentclass{...} - show class description and location via kpsewhich
     * Supports multi-line options like:
     *   \documentclass[
     *     journal=iecred,
     *     manuscript=article
     *   ]{achemso}
     */
    private async hoverForDocumentClass(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): Promise<vscode.Hover | null> {
        // Use full document text to handle multi-line documentclass
        const text = document.getText();
        const offset = document.offsetAt(position);

        // Pattern that handles multi-line options ([\s\S]*? matches across lines)
        const classPattern = /\\documentclass(?:\[([\s\S]*?)\])?\{([^}]+)\}/g;
        let match;

        while ((match = classPattern.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;

            // Check if cursor is within this match
            if (offset >= startOffset && offset <= endOffset) {
                const options = match[1] || '';
                const className = match[2];

                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.appendMarkdown(`**Document Class:** \`${className}\`\n\n`);

                // Common document class descriptions
                const classDescriptions: { [key: string]: string } = {
                    // Standard classes
                    'article': 'Standard class for short documents, journal articles, and documentation. No chapters.',
                    'report': 'Standard class for longer documents with chapters, suitable for theses and reports.',
                    'book': 'Standard class for books with chapters, front/back matter, and two-sided layout.',
                    'letter': 'Standard class for writing letters.',
                    'slides': 'Standard class for creating slides (largely superseded by beamer).',
                    'minimal': 'Minimal class for debugging, defines only page size and base font.',

                    // KOMA-Script classes
                    'scrartcl': 'KOMA-Script article class with European typography defaults.',
                    'scrreprt': 'KOMA-Script report class with European typography defaults.',
                    'scrbook': 'KOMA-Script book class with European typography defaults.',
                    'scrlttr2': 'KOMA-Script letter class with extensive customization.',

                    // Presentation
                    'beamer': 'Class for creating presentations with slides, overlays, and themes.',
                    'powerdot': 'Alternative presentation class with different styling options.',

                    // Academic
                    'memoir': 'Flexible class combining features of book, report, and article.',
                    'thesis': 'Class for writing theses (various implementations exist).',

                    // AMS classes
                    'amsart': 'American Mathematical Society article class.',
                    'amsbook': 'American Mathematical Society book class.',
                    'amsproc': 'American Mathematical Society proceedings class.',

                    // Scientific journals
                    'revtex4-2': 'American Physical Society journal class (Physical Review, etc.).',
                    'revtex4-1': 'American Physical Society journal class (older version).',
                    'revtex4': 'American Physical Society journal class (legacy).',
                    'aastex63': 'American Astronomical Society journal class.',
                    'aastex62': 'American Astronomical Society journal class (older).',
                    'achemso': 'American Chemical Society journal class.',
                    'elsarticle': 'Elsevier journal article class.',
                    'IEEEtran': 'IEEE Transactions and journals class.',
                    'llncs': 'Springer Lecture Notes in Computer Science class.',
                    'svjour3': 'Springer journal article class.',
                    'sn-jnl': 'Springer Nature journal class.',

                    // Letters and CVs
                    'moderncv': 'Modern curriculum vitae/resume class.',
                    'europecv': 'European curriculum vitae class.',
                    'newlfm': 'Letter, fax, and memo class.',

                    // Other
                    'standalone': 'Class for compiling standalone pictures/diagrams.',
                    'tufte-book': 'Book class inspired by Edward Tufte\'s designs.',
                    'tufte-handout': 'Handout class inspired by Edward Tufte\'s designs.',
                    'exam': 'Class for writing exams with questions and solutions.',
                    'flashcards': 'Class for creating flashcards.',
                    'tikzposter': 'Class for creating posters with TikZ.',
                    'a0poster': 'Class for creating large format posters.',
                    'sciposter': 'Class for scientific posters.',
                };

                const description = classDescriptions[className];
                if (description) {
                    md.appendMarkdown(`${description}\n\n`);
                }

                // Show options if present
                if (options) {
                    md.appendMarkdown(`**Options:** \`${options}\`\n\n`);

                    // Explain common options
                    const optionList = options.split(',').map(o => o.trim());
                    const optionDescriptions: { [key: string]: string } = {
                        // Paper sizes
                        'a4paper': 'A4 paper size (210mm × 297mm)',
                        'a5paper': 'A5 paper size (148mm × 210mm)',
                        'b5paper': 'B5 paper size (176mm × 250mm)',
                        'letterpaper': 'US Letter size (8.5in × 11in)',
                        'legalpaper': 'US Legal size (8.5in × 14in)',
                        'executivepaper': 'US Executive size (7.25in × 10.5in)',

                        // Font sizes
                        '10pt': '10 point base font size',
                        '11pt': '11 point base font size',
                        '12pt': '12 point base font size',

                        // Sides and columns
                        'oneside': 'One-sided document layout',
                        'twoside': 'Two-sided document layout (different odd/even margins)',
                        'onecolumn': 'Single column layout',
                        'twocolumn': 'Two column layout',

                        // Title page
                        'titlepage': 'Title on separate page',
                        'notitlepage': 'Title on first page with content',

                        // Equations
                        'leqno': 'Equation numbers on the left',
                        'fleqn': 'Flush left equations',

                        // Draft mode
                        'draft': 'Draft mode (shows overfull boxes, no images)',
                        'final': 'Final mode (default)',

                        // Opening
                        'openright': 'Chapters open on right-hand pages',
                        'openany': 'Chapters can open on any page',

                        // Landscape
                        'landscape': 'Landscape orientation',
                        'portrait': 'Portrait orientation (default)',
                    };

                    const knownOptions = optionList.filter(o => optionDescriptions[o]);
                    if (knownOptions.length > 0) {
                        md.appendMarkdown(`**Option details:**\n`);
                        for (const opt of knownOptions) {
                            md.appendMarkdown(`- \`${opt}\`: ${optionDescriptions[opt]}\n`);
                        }
                        md.appendMarkdown('\n');
                    }
                }

                // Look up location via kpsewhich
                const clsPath = await kpsewhich(`${className}.cls`);
                if (clsPath) {
                    md.appendMarkdown(`**Location:** \`${clsPath}\`\n\n`);

                    // Show file size and modification date
                    try {
                        const stats = fs.statSync(clsPath);
                        md.appendMarkdown(`**Size:** ${(stats.size / 1024).toFixed(1)} KB\n\n`);
                        md.appendMarkdown(`**Modified:** ${stats.mtime.toLocaleDateString()}\n\n`);
                    } catch {
                        // Ignore stat errors
                    }
                } else {
                    md.appendMarkdown(`*Class file not found via kpsewhich*\n\n`);
                }

                // Create range for multi-line match
                const startPos = document.positionAt(startOffset);
                const endPos = document.positionAt(endOffset);
                return new vscode.Hover(md, new vscode.Range(startPos, endPos));
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
     * Hover for \ce{...} - show chemical formula information (mhchem package)
     * Parses the formula and shows element details, composition, and molecular weight
     */
    private hoverForChemicalFormula(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): vscode.Hover | null {
        // Find \ce{...} at position
        const cePattern = /\\ce\{([^}]+)\}/g;
        let match;

        while ((match = cePattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const formula = match[1];
                const elements = parseChemicalFormula(formula);

                if (elements.length === 0) {
                    return null;
                }

                const md = new vscode.MarkdownString();
                md.isTrusted = true;

                md.appendMarkdown(`**Chemical Formula:** \`${formula}\`\n\n`);

                // Calculate total for percentage (for alloy-style notation like W30Ta60Nb10)
                const totalCount = elements.reduce((sum, e) => sum + e.count, 0);
                const isPercentageNotation = totalCount === 100 ||
                    (totalCount > 1 && elements.every(e => e.count >= 1 && Number.isInteger(e.count)));

                // Element details table
                md.appendMarkdown('| Element | Symbol | Z | Mass (u) | Amount |\n');
                md.appendMarkdown('|---------|--------|---|----------|--------|\n');

                let totalMass = 0;
                for (const { symbol, count } of elements) {
                    const el = ELEMENTS[symbol];
                    if (el) {
                        const contribution = el.mass * count;
                        totalMass += contribution;

                        let amountStr: string;
                        if (isPercentageNotation && totalCount === 100) {
                            amountStr = `${count}%`;
                        } else if (count === 1) {
                            amountStr = '1';
                        } else if (Number.isInteger(count)) {
                            amountStr = count.toString();
                        } else {
                            amountStr = count.toFixed(2);
                        }

                        md.appendMarkdown(`| ${el.name} | ${symbol} | ${el.number} | ${el.mass.toFixed(2)} | ${amountStr} |\n`);
                    }
                }

                md.appendMarkdown('\n');

                // Show molecular/formula weight for molecular formulas
                if (!isPercentageNotation || totalCount !== 100) {
                    md.appendMarkdown(`**Formula Weight:** ${totalMass.toFixed(2)} g/mol\n\n`);
                }

                // For alloy notation, show weighted average atomic mass
                if (isPercentageNotation && totalCount === 100) {
                    const avgMass = elements.reduce((sum, { symbol, count }) => {
                        const el = ELEMENTS[symbol];
                        return sum + (el ? el.mass * count / 100 : 0);
                    }, 0);
                    md.appendMarkdown(`**Average Atomic Mass:** ${avgMass.toFixed(2)} g/mol\n\n`);
                    md.appendMarkdown(`*Composition notation (atomic %)*\n`);
                }

                // Add note about mhchem package
                md.appendMarkdown('\n---\n*Requires `mhchem` package*');

                const hoverRange = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );

                return new vscode.Hover(md, hoverRange);
            }
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

    /**
     * Hover for equations - render math expressions
     * Handles inline $...$, display $$...$$, \(...\), \[...\], and math environments
     */
    private async hoverForEquation(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): Promise<vscode.Hover | null> {
        // Find if cursor is inside any math expression
        const text = document.getText();
        const offset = document.offsetAt(position);

        // Try to find math at current position
        const fragment = this.findMathAtPosition(text, offset, document);
        if (!fragment) return null;

        // Create document settings for LaTeX rendering
        const settings = this.parseDocumentSettings(document);

        // Detect dark mode
        const isDarkMode = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
                          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

        // Render the equation
        const result = await renderLatexToSvg(fragment, settings, null, isDarkMode);

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        if (result.success) {
            const imagePath = result.svgPath || result.pngPath;
            if (imagePath && fs.existsSync(imagePath)) {
                const imageUri = vscode.Uri.file(imagePath);

                // Add type label
                const typeLabel = fragment.type === 'inline' ? 'Inline Math' :
                                 fragment.type === 'display' ? 'Display Math' :
                                 `Environment: ${fragment.environment}`;
                md.appendMarkdown(`**${typeLabel}**\n\n`);

                // Add rendered image
                md.appendMarkdown(`<img src="${imageUri.toString()}" style="max-width: 500px;" />\n\n`);

                // Show source LaTeX
                md.appendMarkdown('---\n\n');
                md.appendMarkdown('**Source:**\n');
                md.appendCodeblock(fragment.content.trim(), 'latex');
            }
        } else {
            // Show error with the LaTeX source
            md.appendMarkdown('**LaTeX Preview**\n\n');
            md.appendMarkdown(`*Rendering unavailable: ${result.error || 'LaTeX tools not found'}*\n\n`);
            md.appendMarkdown('---\n\n');
            md.appendCodeblock(fragment.content.trim(), 'latex');
        }

        // Calculate range for the hover
        const startPos = document.positionAt(fragment.startOffset);
        const endPos = document.positionAt(fragment.endOffset);

        return new vscode.Hover(md, new vscode.Range(startPos, endPos));
    }

    /**
     * Find math expression at a given position
     */
    private findMathAtPosition(
        text: string,
        offset: number,
        document: vscode.TextDocument
    ): LatexFragment | null {
        // Check for environment first (multi-line)
        const envPattern = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g;
        let match: RegExpExecArray | null;

        while ((match = envPattern.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;

            if (offset >= startOffset && offset <= endOffset) {
                const startPos = document.positionAt(startOffset);
                return {
                    raw: match[0],
                    content: match[2],
                    type: 'environment',
                    environment: match[1],
                    numbered: !match[1].endsWith('*'),
                    startCol: startPos.character,
                    endCol: 0,
                    line: startPos.line,
                    startOffset,
                    endOffset,
                };
            }
        }

        // Check for display math $$...$$
        const displayDollarPattern = /\$\$([^$]+?)\$\$/g;
        while ((match = displayDollarPattern.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;

            if (offset >= startOffset && offset <= endOffset) {
                const startPos = document.positionAt(startOffset);
                return {
                    raw: match[0],
                    content: match[1],
                    type: 'display',
                    numbered: false,
                    startCol: startPos.character,
                    endCol: 0,
                    line: startPos.line,
                    startOffset,
                    endOffset,
                };
            }
        }

        // Check for display math \[...\]
        const displayBracketPattern = /\\\[([\s\S]*?)\\\]/g;
        while ((match = displayBracketPattern.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;

            if (offset >= startOffset && offset <= endOffset) {
                const startPos = document.positionAt(startOffset);
                return {
                    raw: match[0],
                    content: match[1],
                    type: 'display',
                    numbered: false,
                    startCol: startPos.character,
                    endCol: 0,
                    line: startPos.line,
                    startOffset,
                    endOffset,
                };
            }
        }

        // Check for inline math $...$
        const inlineDollarPattern = /(?<![\\$])\$(?!\$)([^$\n]+?)(?<![\\$])\$(?!\$)/g;
        while ((match = inlineDollarPattern.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;

            if (offset >= startOffset && offset <= endOffset) {
                const content = match[1];
                // Skip if it looks like currency
                if (/^\d/.test(content.trim())) continue;

                const startPos = document.positionAt(startOffset);
                return {
                    raw: match[0],
                    content,
                    type: 'inline',
                    numbered: false,
                    startCol: startPos.character,
                    endCol: 0,
                    line: startPos.line,
                    startOffset,
                    endOffset,
                };
            }
        }

        // Check for inline math \(...\)
        const inlineParenPattern = /\\\(([\s\S]*?)\\\)/g;
        while ((match = inlineParenPattern.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;

            if (offset >= startOffset && offset <= endOffset) {
                const startPos = document.positionAt(startOffset);
                return {
                    raw: match[0],
                    content: match[1],
                    type: 'inline',
                    numbered: false,
                    startCol: startPos.character,
                    endCol: 0,
                    line: startPos.line,
                    startOffset,
                    endOffset,
                };
            }
        }

        return null;
    }

    /**
     * Parse document for LaTeX header settings
     */
    private parseDocumentSettings(document: vscode.TextDocument): LatexDocumentSettings {
        const settings: LatexDocumentSettings = {
            packages: [],
            preamble: '',
            documentClass: 'standalone',
            classOptions: ['preview', 'border=2pt'],
        };

        const text = document.getText();
        const preambleLines: string[] = [];

        // Extract usepackage commands from preamble (before \begin{document})
        const docStartMatch = text.match(/\\begin\{document\}/);
        const preambleText = docStartMatch ? text.substring(0, docStartMatch.index) : text;

        // Find all \usepackage commands
        const pkgPattern = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;
        let match;
        while ((match = pkgPattern.exec(preambleText)) !== null) {
            const pkgs = match[1].split(',').map(p => p.trim());
            settings.packages.push(...pkgs);
            preambleLines.push(match[0]);
        }

        // Find custom commands
        const cmdPattern = /\\(newcommand|renewcommand|DeclareMathOperator)(\*?)(\{[^}]+\}|\[[^\]]*\])*\{[^}]*\}/g;
        while ((match = cmdPattern.exec(preambleText)) !== null) {
            preambleLines.push(match[0]);
        }

        if (preambleLines.length > 0) {
            settings.preamble = preambleLines.join('\n');
        }

        return settings;
    }

    /**
     * Hover for figures - show image preview for \includegraphics
     * Converts PDF/EPS to PNG for preview using available system tools
     */
    private async hoverForFigure(
        document: vscode.TextDocument,
        position: vscode.Position,
        line: string
    ): Promise<vscode.Hover | null> {
        // Find \includegraphics[options]{filename}
        const graphicsPattern = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
        let match;

        while ((match = graphicsPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = startCol + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                let imagePath = match[1];

                // Resolve path relative to document
                const docDir = path.dirname(document.uri.fsPath);

                // Try with common extensions if not specified
                const extensions = ['', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg'];
                let fullPath: string | null = null;

                for (const ext of extensions) {
                    const tryPath = path.resolve(docDir, imagePath + ext);
                    if (fs.existsSync(tryPath)) {
                        fullPath = tryPath;
                        break;
                    }
                }

                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.supportHtml = true;

                md.appendMarkdown(`**Figure:** \`${imagePath}\`\n\n`);

                if (fullPath) {
                    const ext = path.extname(fullPath).toLowerCase();

                    // Get configured max preview width (default 300px ~ 3 inches at 96dpi)
                    const config = vscode.workspace.getConfiguration('scimax');
                    const maxPreviewWidth = config.get<number>('latex.imagePreviewMaxWidth', 300);

                    // Check if it's a displayable image format
                    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
                        const imageUri = vscode.Uri.file(fullPath);
                        // Use HTML width attribute for reliable sizing in VS Code hovers
                        md.appendMarkdown(`<img src="${imageUri.toString()}" width="${maxPreviewWidth}" />\n\n`);
                    } else if (ext === '.pdf' || ext === '.eps') {
                        // Try to convert PDF/EPS to PNG for preview
                        const pngPath = await convertPdfToPng(fullPath);
                        if (pngPath) {
                            const imageUri = vscode.Uri.file(pngPath);
                            md.appendMarkdown(`<img src="${imageUri.toString()}" width="${maxPreviewWidth}" />\n\n`);
                            md.appendMarkdown(`*(${ext.toUpperCase().slice(1)} converted to PNG for preview)*\n\n`);
                        } else {
                            md.appendMarkdown(`*${ext.toUpperCase().slice(1)} preview requires pdftoppm, ImageMagick, or Ghostscript*\n\n`);
                        }
                    }

                    // Show file info
                    try {
                        const stats = fs.statSync(fullPath);
                        md.appendMarkdown('---\n\n');
                        md.appendMarkdown(`**Path:** \`${fullPath}\`\n\n`);
                        md.appendMarkdown(`**Size:** ${(stats.size / 1024).toFixed(1)} KB\n\n`);
                        md.appendMarkdown(`**Modified:** ${stats.mtime.toLocaleDateString()}`);
                    } catch {
                        // Ignore stat errors
                    }
                } else {
                    md.appendMarkdown(`*File not found*\n\n`);
                    md.appendMarkdown(`Searched in: \`${docDir}\``);
                }

                return new vscode.Hover(md);
            }
        }

        return null;
    }
}
